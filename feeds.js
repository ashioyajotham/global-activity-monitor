/**
 * feeds.js — RSS News Feed Parser
 *
 * v4.1: Replaced dead feeds (Reuters DNS dead, RSSHub 403).
 *       Added resilient feed handling with per-feed timeout.
 */

const RSSParser = require('rss-parser');


const parser = new RSSParser({
    timeout: 15000,
    headers: {
        'User-Agent': 'GlobalActivityMonitor/4.1 (RSS Reader)',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
    },
});


// ═══════════════════════════════════════════════════════
// FEED SOURCES — verified working as of 2025
// ═══════════════════════════════════════════════════════

const FEEDS = [
    // Major wire services / broadcasters
    { name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
    { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
    { name: 'France 24', url: 'https://www.france24.com/en/rss' },
    { name: 'DW News', url: 'https://rss.dw.com/rdf/rss-en-all' },

    // Independent / investigative
    { name: 'The Intercept', url: 'https://theintercept.com/feed/?rss' },
    { name: 'Counterpunch', url: 'https://www.counterpunch.org/feed/' },
    { name: 'Declassified UK', url: 'https://declassifieduk.org/feed/' },
    { name: 'The Grayzone', url: 'https://thegrayzone.com/feed/' },
    { name: 'Mint Press', url: 'https://www.mintpressnews.com/feed/' },

    // Regional / non-Western
    { name: 'CGTN', url: 'https://www.cgtn.com/subscribe/rss/section/world.xml' },
    { name: 'Middle East Eye', url: 'https://www.middleeasteye.net/rss' },
    { name: 'RT World', url: 'https://www.rt.com/rss/news/' },
];

// ═══════════════════════════════════════════════════════
// SENTIMENT
// ═══════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════
// FETCH ALL FEEDS
// ═══════════════════════════════════════════════════════

async function fetchAllNews() {
    const allItems = [];
    const results = { success: 0, failed: 0, errors: [] };

    // Fetch all feeds concurrently with individual timeouts
    const feedPromises = FEEDS.map(async (feed) => {
        try {
            const parsed = await parser.parseURL(feed.url);
            const items = (parsed.items || []).map(item => {
                const title = cleanTitle(item.title || '');
                return {
                    title,
                    link: item.link || '',
                    source: feed.name,
                    pubDate: require('./pipeline').validDate(item.isoDate || item.pubDate),
                    language: 'English',
                    snippet: cleanTitle(item.contentSnippet || item.content || ''),

                };
            });
            results.success++;
            return items;
        } catch (err) {
            results.failed++;
            const reason = err.code === 'ENOTFOUND' ? 'DNS failed'
                : err.message?.includes('Status code') ? err.message
                : err.code === 'ECONNABORTED' || err.message?.includes('timeout') ? 'timeout'
                : err.message?.slice(0, 60) || 'unknown error';
            results.errors.push(`${feed.name}: ${reason}`);
            return [];
        }
    });

    const feedResults = await Promise.allSettled(feedPromises);
    for (const result of feedResults) {
        if (result.status === 'fulfilled') allItems.push(...result.value);
    }

    // Log feed health
    if (results.errors.length > 0) {
        console.log(`[feeds] ${results.success}/${FEEDS.length} feeds OK, ${results.failed} failed:`);
        results.errors.forEach(e => console.log(`  ⚠ ${e}`));
    } else {
        console.log(`[feeds] All ${FEEDS.length} feeds fetched OK`);
    }

    const deduped = allItems; // canonical cross-provider deduplication happens in pipeline.js
    deduped.sort((a, b) => Date.parse(b.pubDate || 0) - Date.parse(a.pubDate || 0));
    deduped.forEach(item => { item.timeAgo = item.pubDate ? timeAgo(new Date(item.pubDate)) : 'date unknown'; });

    return { items: deduped, health: results };
}

// ═══════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════

function cleanTitle(text) {
    return text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 300);
}

function deduplicateByTitle(items) {
    const seen = new Set();
    return items.filter(item => {
        const key = item.title.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().slice(0, 50);
        if (key.length < 10 || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function timeAgo(date) {
    const s = Math.floor((Date.now() - date.getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
}

module.exports = { fetchAllNews, FEEDS };
