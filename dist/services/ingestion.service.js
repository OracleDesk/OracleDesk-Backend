"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchNewsSignals = fetchNewsSignals;
exports.fetchFedData = fetchFedData;
exports.fetchMacroEvents = fetchMacroEvents;
exports.aggregateSignals = aggregateSignals;
const axios_1 = __importDefault(require("axios"));
const prisma_1 = require("../lib/prisma");
const logger_1 = require("../lib/logger");
const config_1 = require("../config");
const dayjs_1 = __importDefault(require("dayjs"));
const CACHE_TTL_MINUTES = 15;
// ─── Internal: cache read/write ───
// Function to get cached signals for a source if they exist and are not expired
async function getCachedSignals(source) {
    const cached = await prisma_1.prisma.signalCache.findFirst({
        where: {
            source,
            expiresAt: { gt: new Date() },
        },
        orderBy: { fetchedAt: 'desc' },
    });
    if (!cached)
        return null;
    return cached.payload;
}
// Function to cache signals for a source with an expiration time
async function cacheSignals(source, signals) {
    await prisma_1.prisma.signalCache.create({
        data: {
            source,
            payload: signals,
            expiresAt: (0, dayjs_1.default)().add(CACHE_TTL_MINUTES, 'minute').toDate(),
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
async function fetchNewsSignals() {
    const cached = await getCachedSignals('NEWSAPI');
    if (cached) {
        logger_1.logger.debug('Using cached NewsAPI signals');
        return cached;
    }
    if (!config_1.config.NEWSAPI_KEY) {
        logger_1.logger.warn('NEWSAPI_KEY not set — skipping news ingestion');
        return [];
    }
    try {
        const { data } = await axios_1.default.get('https://newsapi.org/v2/everything', {
            params: {
                q: 'Federal Reserve OR ECB OR inflation OR interest rates OR election OR geopolitical',
                language: 'en',
                sortBy: 'publishedAt',
                pageSize: 20,
                apiKey: config_1.config.NEWSAPI_KEY,
            },
            timeout: 10000,
        });
        const signals = (data.articles ?? []).map((article) => ({
            source: 'NEWSAPI',
            title: article.title ?? '',
            content: article.description ?? article.content ?? '',
            publishedAt: article.publishedAt ?? new Date().toISOString(),
            relevanceScore: 0.7,
            category: classifyNewsCategory(article.title ?? ''),
        }));
        await cacheSignals('NEWSAPI', signals);
        logger_1.logger.info({ count: signals.length }, 'Fetched news signals');
        return signals;
    }
    catch (err) {
        logger_1.logger.error({ err }, 'Failed to fetch NewsAPI signals');
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
async function fetchFedData() {
    const cached = await getCachedSignals('FRED');
    if (cached)
        return cached;
    const series = ['FEDFUNDS', 'CPIAUCSL', 'UNRATE', 'T10Y2Y'];
    const signals = [];
    for (const seriesId of series) {
        try {
            const url = config_1.config.FRED_API_KEY
                ? `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${config_1.config.FRED_API_KEY}&file_type=json&sort_order=desc&limit=2`
                : `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&file_type=json&sort_order=desc&limit=2`;
            const { data } = await axios_1.default.get(url, { timeout: 10000 });
            const observations = data.observations ?? [];
            if (observations.length > 0) {
                const latest = observations[0];
                const previous = observations[1];
                const change = previous
                    ? parseFloat(latest.value) - parseFloat(previous.value)
                    : 0;
                signals.push({
                    source: 'FRED',
                    title: `${seriesId}: ${latest.value}`,
                    content: `Latest ${seriesId} = ${latest.value} (${change >= 0 ? '+' : ''}${change.toFixed(3)} from prior). Date: ${latest.date}`,
                    publishedAt: new Date(latest.date).toISOString(),
                    relevanceScore: 0.9,
                    category: 'FED',
                });
            }
        }
        catch (err) {
            logger_1.logger.warn({ err, seriesId }, 'Failed to fetch FRED series');
        }
    }
    if (signals.length > 0)
        await cacheSignals('FRED', signals);
    logger_1.logger.info({ count: signals.length }, 'Fetched FRED signals');
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
async function fetchMacroEvents() {
    const cached = await getCachedSignals('GDELT');
    if (cached)
        return cached;
    try {
        // GDELT v2 article search — filter for financial/political topics
        const { data } = await axios_1.default.get('https://api.gdeltproject.org/api/v2/doc/doc', {
            params: {
                query: 'election OR "central bank" OR "interest rate" OR "geopolitical" OR "inflation"',
                mode: 'artlist',
                format: 'json',
                maxrecords: 15,
                timespan: '1440', // Last 24 hours in minutes
            },
            timeout: 15000,
        });
        const articles = data.articles ?? [];
        const signals = articles.map((a) => ({
            source: 'GDELT',
            title: a.title ?? '',
            content: a.seendates?.[0] ?? '',
            publishedAt: new Date().toISOString(),
            relevanceScore: 0.6,
            category: 'GEOPOLITICAL',
        }));
        if (signals.length > 0)
            await cacheSignals('GDELT', signals);
        logger_1.logger.info({ count: signals.length }, 'Fetched GDELT signals');
        return signals;
    }
    catch (err) {
        logger_1.logger.warn({ err }, 'GDELT fetch failed — returning empty');
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
async function aggregateSignals() {
    const [newsRaw, fedRaw, macroRaw] = await Promise.allSettled([
        fetchNewsSignals(),
        fetchFedData(),
        fetchMacroEvents(),
    ]);
    const news = newsRaw.status === 'fulfilled' ? newsRaw.value : [];
    const fed = fedRaw.status === 'fulfilled' ? fedRaw.value : [];
    const macro = macroRaw.status === 'fulfilled' ? macroRaw.value : [];
    const total = news.length + fed.length + macro.length;
    logger_1.logger.info({ news: news.length, fed: fed.length, macro: macro.length }, 'Signals aggregated');
    return {
        news,
        fed,
        macro,
        aggregatedAt: new Date(),
        signalCount: total,
    };
}
// ─── Helper ───
function classifyNewsCategory(title) {
    const t = title.toLowerCase();
    if (t.includes('fed') || t.includes('federal reserve') || t.includes('fomc'))
        return 'FED';
    if (t.includes('ecb') || t.includes('european central bank'))
        return 'ECB';
    if (t.includes('election') || t.includes('vote'))
        return 'ELECTION';
    if (t.includes('btc') || t.includes('bitcoin') || t.includes('crypto'))
        return 'CRYPTO';
    return 'MACRO';
}
