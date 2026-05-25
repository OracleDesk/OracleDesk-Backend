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
const CACHE_TTL_MINUTES = 20; // Slightly longer than the 15-min cron interval to prevent expiry-at-fire races
// ─── Cache helpers ────────────────────────────────────────────────────────────
async function getCachedSignals(source) {
    const cached = await prisma_1.prisma.signalCache.findFirst({
        where: { source, expiresAt: { gt: new Date() } },
        orderBy: { fetchedAt: 'desc' },
    });
    if (!cached)
        return null;
    return cached.payload;
}
async function cacheSignals(source, signals) {
    // Delete all expired rows for this source before inserting the fresh one
    // to prevent unbounded DB growth over time.
    await prisma_1.prisma.signalCache.deleteMany({
        where: { source, expiresAt: { lte: new Date() } },
    }).catch(() => { }); // non-fatal — just a cleanup step
    await prisma_1.prisma.signalCache.create({
        data: {
            source,
            payload: signals,
            expiresAt: (0, dayjs_1.default)().add(CACHE_TTL_MINUTES, 'minute').toDate(),
        },
    });
}
// ─── NewsAPI ──────────────────────────────────────────────────────────────────
/**
 * Fetches financial, political, sports, and entertainment signals from NewsAPI.
 * Results are cached for 15 minutes (matches cron interval).
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
                q: [
                    'Federal Reserve OR ECB OR inflation OR "interest rates" OR GDP',
                    'election OR parliament OR "political vote" OR president OR senate',
                    'geopolitical OR sanctions OR treaty OR conflict',
                    'bitcoin OR ethereum OR crypto OR "DeFi"',
                    '"championship" OR "World Cup" OR "NBA Finals" OR "Super Bowl" OR "Premier League"',
                    'Oscar OR Grammy OR Emmy OR "box office" OR "Billboard chart"',
                ].join(' OR '),
                language: 'en',
                sortBy: 'publishedAt',
                pageSize: 30,
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
// ─── FRED API ─────────────────────────────────────────────────────────────────
/**
 * Fetches Federal Reserve economic data from FRED.
 * Series: FEDFUNDS, CPIAUCSL, UNRATE, T10Y2Y
 */
async function fetchFedData() {
    const cached = await getCachedSignals('FRED');
    if (cached)
        return cached;
    const series = ['FEDFUNDS', 'CPIAUCSL', 'UNRATE', 'T10Y2Y'];
    const signals = [];
    for (const seriesId of series) {
        try {
            const apiKeyParam = config_1.config.FRED_API_KEY ? `&api_key=${config_1.config.FRED_API_KEY}` : '';
            const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&file_type=json&sort_order=desc&limit=2${apiKeyParam}`;
            const { data } = await axios_1.default.get(url, { timeout: 10000 });
            const observations = data.observations ?? [];
            if (observations.length > 0) {
                const latest = observations[0];
                const previous = observations[1];
                const change = previous ? parseFloat(latest.value) - parseFloat(previous.value) : 0;
                signals.push({
                    source: 'FRED',
                    title: `${seriesId}: ${latest.value}`,
                    content: `${seriesId} = ${latest.value} (${change >= 0 ? '+' : ''}${change.toFixed(3)} vs prior). Date: ${latest.date}`,
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
// ─── GDELT API ────────────────────────────────────────────────────────────────
/**
 * Fetches geopolitical + macro events from GDELT.
 *
 * GDELT's public API is notoriously slow and unreliable — timeouts are the
 * norm, not the exception. Key changes from the previous implementation:
 *
 *  1. Hard timeout: 8 seconds (down from 25s). If GDELT hasn't responded
 *     in 8s it never will for this cycle.
 *  2. Single attempt only: retrying a slow/overloaded endpoint just doubles
 *     the delay. We treat a timeout as "no macro signals this cycle" and move on.
 *  3. Promise.race with an internal deadline: guarantees we never block
 *     aggregateSignals() for longer than GDELT_TIMEOUT_MS.
 *  4. Logged as DEBUG on timeout (not WARN) to reduce log noise — GDELT
 *     timeouts are expected and non-actionable.
 */
const GDELT_TIMEOUT_MS = 8000;
async function fetchMacroEvents() {
    const cached = await getCachedSignals('GDELT');
    if (cached) {
        logger_1.logger.debug('Using cached GDELT signals');
        return cached;
    }
    const deadline = new Promise((_, reject) => setTimeout(() => reject(new Error('GDELT deadline exceeded')), GDELT_TIMEOUT_MS));
    const fetch = async () => {
        const { data } = await axios_1.default.get('https://api.gdeltproject.org/api/v2/doc/doc', {
            params: {
                query: '"central bank" OR "interest rate" OR inflation OR election OR geopolitical',
                mode: 'artlist',
                format: 'json',
                maxrecords: 10,
                timespan: '1440',
            },
            timeout: GDELT_TIMEOUT_MS,
        });
        const articles = data?.articles ?? [];
        const signals = articles.map((a) => ({
            source: 'GDELT',
            title: a.title ?? '',
            content: a.url ?? '',
            publishedAt: a.seendate ?? new Date().toISOString(),
            relevanceScore: 0.6,
            category: classifyNewsCategory(a.title ?? ''),
        }));
        if (signals.length > 0) {
            await cacheSignals('GDELT', signals);
            logger_1.logger.info({ count: signals.length }, 'Fetched GDELT signals');
        }
        return signals;
    };
    try {
        return await Promise.race([fetch(), deadline]);
    }
    catch (err) {
        const isTimeout = err?.message?.includes('deadline') || err?.code === 'ECONNABORTED';
        if (isTimeout) {
            logger_1.logger.debug('GDELT timed out — continuing without macro signals this cycle');
        }
        else {
            logger_1.logger.warn({ err: err?.message }, 'GDELT fetch failed — continuing without macro signals');
        }
        return [];
    }
}
// ─── Aggregator ───────────────────────────────────────────────────────────────
/**
 * Aggregates all signal sources into a unified object.
 *
 * All three fetches run in parallel via Promise.allSettled so one slow
 * source never blocks the others. GDELT is the most likely to fail; the
 * market maker cycle proceeds normally with news + FRED alone.
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
    return { news, fed, macro, aggregatedAt: new Date(), signalCount: total };
}
// ─── Category classifier ──────────────────────────────────────────────────────
function classifyNewsCategory(title) {
    const t = title.toLowerCase();
    if (t.includes('federal reserve') || t.includes('fed ') || t.includes('fomc') || t.includes('fed rate'))
        return 'FED';
    if (t.includes('ecb') || t.includes('european central bank') || t.includes('lagarde'))
        return 'ECB';
    if (t.includes('election') || t.includes('ballot') || t.includes('polling') || t.includes('vote result'))
        return 'ELECTION';
    if (t.includes('bitcoin') || t.includes('btc') || t.includes('ethereum') || t.includes('crypto') || t.includes('defi') || t.includes('nft'))
        return 'CRYPTO';
    if (t.includes('nba') || t.includes('nfl') || t.includes('fifa') || t.includes('premier league') ||
        t.includes('world cup') || t.includes('championship') || t.includes('super bowl') ||
        t.includes('wimbledon') || t.includes('formula 1') || t.includes('f1 ') ||
        t.includes('olympics') || t.includes('tournament') || t.includes(' cup '))
        return 'SPORTS';
    if (t.includes('oscar') || t.includes('grammy') || t.includes('emmy') || t.includes('bafta') ||
        t.includes('box office') || t.includes('billboard') || t.includes('movie release') ||
        t.includes('album') || t.includes('celebrity') || t.includes('hollywood'))
        return 'ENTERTAINMENT';
    if (t.includes('president') || t.includes('congress') || t.includes('parliament') ||
        t.includes('senate') || t.includes('minister') || t.includes('legislation') ||
        t.includes('political party') || t.includes('policy bill') || t.includes('cabinet'))
        return 'POLITICS';
    if (t.includes('war') || t.includes('sanction') || t.includes('treaty') ||
        t.includes('geopolit') || t.includes('conflict') || t.includes('nato') ||
        t.includes('un security') || t.includes('diplomatic'))
        return 'GEOPOLITICAL';
    return 'MACRO';
}
