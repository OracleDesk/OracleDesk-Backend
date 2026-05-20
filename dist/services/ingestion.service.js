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
 *
 * The broad query covers all nine market categories:
 *   FED/ECB/MACRO → rate/inflation/GDP keywords
 *   ELECTION/POLITICS → vote/parliament/president keywords
 *   GEOPOLITICAL → war/sanction/treaty keywords
 *   CRYPTO → BTC/ethereum/defi keywords
 *   SPORTS → championship/league/cup keywords
 *   ENTERTAINMENT → Oscar/Grammy/box office keywords
 *
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
                    // Macro
                    'Federal Reserve OR ECB OR inflation OR "interest rates" OR GDP',
                    // Political / Electoral
                    'election OR parliament OR "political vote" OR president OR senate',
                    // Geopolitical
                    'geopolitical OR sanctions OR treaty OR conflict',
                    // Crypto
                    'bitcoin OR ethereum OR crypto OR "DeFi"',
                    // Sports
                    '"championship" OR "World Cup" OR "NBA Finals" OR "Super Bowl" OR "Premier League"',
                    // Entertainment
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
 *
 * Series:
 *   FEDFUNDS — Effective Federal Funds Rate
 *   CPIAUCSL — Consumer Price Index (inflation)
 *   UNRATE   — Unemployment Rate
 *   T10Y2Y   — 10Y-2Y Treasury Yield Spread (recession indicator)
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
 * Also captures sports and political events in the news graph.
 * No API key required.
 */
async function fetchMacroEvents() {
    const url = "https://api.gdeltproject.org/api/v2/doc/doc";
    // Streamlined query to drastically reduce remote server execution latency
    const cleanQuery = '"central bank" OR "interest rate" OR inflation OR election OR geopolitical';
    const config = {
        method: 'get',
        url,
        params: {
            query: cleanQuery,
            mode: 'artlist',
            format: 'json',
            maxrecords: 15, // Reduced from 20 to speed up API assembly
            timespan: '1440'
        },
        timeout: 25000 // Bumped from 15000ms to 25000ms to allow a safer buffer
    };
    let attempts = 2;
    while (attempts > 0) {
        try {
            const response = await (0, axios_1.default)(config);
            // Ensure the structural response exists and return its internal array
            return response.data?.articles || [];
        }
        catch (err) {
            attempts--;
            if (attempts === 0) {
                logger_1.logger.warn({ err: err.message || err }, 'GDELT fetch permanently failed after retry — returning empty');
                return [];
            }
            logger_1.logger.info(`GDELT timed out. Retrying link pipeline instantly... (${attempts} attempt left)`);
            // Brief sleep pause before hitting the pipeline again
            await new Promise(res => setTimeout(res, 2000));
        }
    }
    return [];
}
// ─── Aggregator ───────────────────────────────────────────────────────────────
/**
 * Aggregates all signal sources into a unified object.
 *
 * Market Maker and Trader agents call this. Fetches run in parallel;
 * individual source failures don't block the rest.
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
/**
 * Classifies a news headline into one of the nine MarketCategory values.
 *
 * Checks are ordered from most specific to most general.
 * Falls back to 'MACRO' if no pattern matches.
 */
function classifyNewsCategory(title) {
    const t = title.toLowerCase();
    // Financial / Central bank
    if (t.includes('federal reserve') || t.includes('fed ') || t.includes('fomc') || t.includes('fed rate'))
        return 'FED';
    if (t.includes('ecb') || t.includes('european central bank') || t.includes('lagarde'))
        return 'ECB';
    // Electoral
    if (t.includes('election') || t.includes('ballot') || t.includes('polling') || t.includes('vote result'))
        return 'ELECTION';
    // Crypto
    if (t.includes('bitcoin') || t.includes('btc') || t.includes('ethereum') || t.includes('crypto') || t.includes('defi') || t.includes('nft'))
        return 'CRYPTO';
    // Sports
    if (t.includes('nba') || t.includes('nfl') || t.includes('fifa') || t.includes('premier league') ||
        t.includes('world cup') || t.includes('championship') || t.includes('super bowl') ||
        t.includes('wimbledon') || t.includes('formula 1') || t.includes('f1 ') ||
        t.includes('olympics') || t.includes('tournament') || t.includes(' cup '))
        return 'SPORTS';
    // Entertainment
    if (t.includes('oscar') || t.includes('grammy') || t.includes('emmy') || t.includes('bafta') ||
        t.includes('box office') || t.includes('billboard') || t.includes('movie release') ||
        t.includes('album') || t.includes('celebrity') || t.includes('hollywood'))
        return 'ENTERTAINMENT';
    // Politics
    if (t.includes('president') || t.includes('congress') || t.includes('parliament') ||
        t.includes('senate') || t.includes('minister') || t.includes('legislation') ||
        t.includes('political party') || t.includes('policy bill') || t.includes('cabinet'))
        return 'POLITICS';
    // Geopolitical
    if (t.includes('war') || t.includes('sanction') || t.includes('treaty') ||
        t.includes('geopolit') || t.includes('conflict') || t.includes('nato') ||
        t.includes('un security') || t.includes('diplomatic'))
        return 'GEOPOLITICAL';
    return 'MACRO';
}
