import axios from 'axios';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { config } from '../config';
import type { RawSignal, AggregatedSignals } from '../types';
import dayjs from 'dayjs';

const CACHE_TTL_MINUTES = 15;

// ─── Internal: cache read/write ───


// Function to get cached signals for a source if they exist and are not expired
async function getCachedSignals(source: string): Promise<RawSignal[] | null> {
  const cached = await prisma.signalCache.findFirst({
    where: {
      source,
      expiresAt: { gt: new Date() },
    },
    orderBy: { fetchedAt: 'desc' },
  });

  if (!cached) return null;
  return cached.payload as unknown as RawSignal[];
}

// Function to cache signals for a source with an expiration time
async function cacheSignals(source: string, signals: RawSignal[]): Promise<void> {
  await prisma.signalCache.create({
    data: {
      source,
      payload:   signals as any,
      expiresAt: dayjs().add(CACHE_TTL_MINUTES, 'minute').toDate(),
    },
  });
}

// ─── NewsAPI ───

/**
 * Fetch financial and geopolitical news from NewsAPI.
 *
 * Queries: "Federal Reserve OR ECB OR inflation OR interest rates OR election"
 * Returns normalized RawSignal[]. Results are cached for 15 minutes.
 *
 * Free tier: 100 req/day. The cache prevents exceeding this.
 */
export async function fetchNewsSignals(): Promise<RawSignal[]> {
  const cached = await getCachedSignals('NEWSAPI');
  if (cached) {
    logger.debug('Using cached NewsAPI signals');
    return cached;
  }

  if (!config.NEWSAPI_KEY) {
    logger.warn('NEWSAPI_KEY not set — skipping news ingestion');
    return [];
  }

  try {
    const { data } = await axios.get<{ articles: any[] }>(
      'https://newsapi.org/v2/everything',
      {
        params: {
          q:        'Federal Reserve OR ECB OR inflation OR interest rates OR election OR geopolitical',
          language: 'en',
          sortBy:   'publishedAt',
          pageSize: 20,
          apiKey:   config.NEWSAPI_KEY,
        },
        timeout: 10_000,
      },
    );

    const signals: RawSignal[] = (data.articles ?? []).map((article: any) => ({
      source:         'NEWSAPI',
      title:          article.title ?? '',
      content:        article.description ?? article.content ?? '',
      publishedAt:    article.publishedAt ?? new Date().toISOString(),
      relevanceScore: 0.7,
      category:       classifyNewsCategory(article.title ?? ''),
    }));

    await cacheSignals('NEWSAPI', signals);
    logger.info({ count: signals.length }, 'Fetched news signals');
    return signals;
  } catch (err) {
    logger.error({ err }, 'Failed to fetch NewsAPI signals');
    return [];
  }
}

// ─── FRED API ───

/**
 * Fetch Federal Reserve economic data from FRED (St. Louis Fed).
 *
 * Series fetched:
 * - FEDFUNDS: Effective Federal Funds Rate
 * - CPIAUCSL: Consumer Price Index
 * - UNRATE:   Unemployment Rate
 * - T10Y2Y:   10Y-2Y Treasury Yield Spread
 *
 * Each series is returned as a normalized signal with its latest value.
 */
export async function fetchFedData(): Promise<RawSignal[]> {
  const cached = await getCachedSignals('FRED');
  if (cached) return cached;

  const series = ['FEDFUNDS', 'CPIAUCSL', 'UNRATE', 'T10Y2Y'];
  const signals: RawSignal[] = [];

  for (const seriesId of series) {
    try {
      const url = config.FRED_API_KEY
        ? `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${config.FRED_API_KEY}&file_type=json&sort_order=desc&limit=2`
        : `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&file_type=json&sort_order=desc&limit=2`;

      const { data } = await axios.get<{ observations: any[] }>(url, { timeout: 10_000 });
      const observations = data.observations ?? [];

      if (observations.length > 0) {
        const latest = observations[0];
        const previous = observations[1];
        const change = previous
          ? parseFloat(latest.value) - parseFloat(previous.value)
          : 0;

        signals.push({
          source:         'FRED',
          title:          `${seriesId}: ${latest.value}`,
          content:        `Latest ${seriesId} = ${latest.value} (${change >= 0 ? '+' : ''}${change.toFixed(3)} from prior). Date: ${latest.date}`,
          publishedAt:    new Date(latest.date).toISOString(),
          relevanceScore: 0.9,
          category:       'FED',
        });
      }
    } catch (err) {
      logger.warn({ err, seriesId }, 'Failed to fetch FRED series');
    }
  }

  if (signals.length > 0) await cacheSignals('FRED', signals);
  logger.info({ count: signals.length }, 'Fetched FRED signals');
  return signals;
}

// ─── GDELT API ───

/**
 * Fetch geopolitical events from GDELT (Global Database of Events, Language, Tone).
 *
 * GDELT monitors news media in 100+ languages and extracts structured event data.
 * We query for high-impact geopolitical events in the last 24 hours.
 * No API key required.
 */
export async function fetchMacroEvents(): Promise<RawSignal[]> {
  const cached = await getCachedSignals('GDELT');
  if (cached) return cached;

  try {
    // GDELT v2 article search — filter for financial/political topics
    const { data } = await axios.get<{ articles: any[] }>(
      'https://api.gdeltproject.org/api/v2/doc/doc',
      {
        params: {
          query:      'election OR "central bank" OR "interest rate" OR "geopolitical" OR "inflation"',
          mode:       'artlist',
          format:     'json',
          maxrecords: 15,
          timespan:   '1440', // Last 24 hours in minutes
        },
        timeout: 15_000,
      },
    );

    const articles = data.articles ?? [];
    const signals: RawSignal[] = articles.map((a: any) => ({
      source:         'GDELT',
      title:          a.title ?? '',
      content:        a.seendates?.[0] ?? '',
      publishedAt:    new Date().toISOString(),
      relevanceScore: 0.6,
      category:       'GEOPOLITICAL',
    }));

    if (signals.length > 0) await cacheSignals('GDELT', signals);
    logger.info({ count: signals.length }, 'Fetched GDELT signals');
    return signals;
  } catch (err) {
    logger.warn({ err }, 'GDELT fetch failed — returning empty');
    return [];
  }
}

// ─── Aggregator ───

/**
 * Aggregates all signal sources into a unified object.
 *
 * This is what Market Maker and Trader agents call.
 * Fetches run in parallel for speed; individual failures don't block others.
 */
export async function aggregateSignals(): Promise<AggregatedSignals> {
  const [newsRaw, fedRaw, macroRaw] = await Promise.allSettled([
    fetchNewsSignals(),
    fetchFedData(),
    fetchMacroEvents(),
  ]);

  const news  = newsRaw.status  === 'fulfilled' ? newsRaw.value  : [];
  const fed   = fedRaw.status   === 'fulfilled' ? fedRaw.value   : [];
  const macro = macroRaw.status === 'fulfilled' ? macroRaw.value : [];

  const total = news.length + fed.length + macro.length;
  logger.info({ news: news.length, fed: fed.length, macro: macro.length }, 'Signals aggregated');

  return {
    news,
    fed,
    macro,
    aggregatedAt: new Date(),
    signalCount:  total,
  };
}

// ─── Helper ───
function classifyNewsCategory(title: string): string {
  const t = title.toLowerCase();
  if (t.includes('fed') || t.includes('federal reserve') || t.includes('fomc')) return 'FED';
  if (t.includes('ecb') || t.includes('european central bank')) return 'ECB';
  if (t.includes('election') || t.includes('vote')) return 'ELECTION';
  if (t.includes('btc') || t.includes('bitcoin') || t.includes('crypto')) return 'CRYPTO';
  return 'MACRO';
}