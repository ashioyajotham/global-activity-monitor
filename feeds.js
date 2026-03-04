/**
 * feeds.js — RSS News Feed Parser
 *
 * v4: Simplified sentiment. Custom geopolitical lexicon removed —
 *     GDELT's theme-based classification handles severity/category.
 *     RSS sentiment is now supplementary signal only (tone shading).
 */

const RSSParser = require('rss-parser');
const Sentiment = require('sentiment');

const parser = new RSSParser({ timeout: 10000 });
const sentiment = new Sentiment();

// ═══════════════════════════════════════════════════════
// FEED SOURCES
// ═══════════════════════════════════════════════════════

const FEEDS = [
    { name: 'BBC', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
    { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
    { name: 'Reuters', url: 'https://feeds.reuters.com/reuters/worldNews' },
    { name: 'AP News', url: 'https://rsshub.app/apnews/topics/world-news' },
    { name: 'Counterpunch', url: 'https://www.counterpunch.org/feed/' },
    { name: 'Declassified UK', url: 'https://declassifieduk.org/feed/' },
    { name: 'RT News', url: 'https://www.rt.com/rss/news/' },
    { name: 'Mint Press News', url: 'https://www.mintpressnews.com/feed/' },
    { name: 'The Grayzone', url: 'https://thegrayzone.com/feed/' },
];

// ═══════════════════════════════════════════════════════
// SENTIMENT (base AFINN only — no custom overrides)
// ═══════════════════════════════════════════════════════

/**
 * Simple tone analysis for RSS headlines.
 * Maps AFINN score to GDELT-compatible -10 to +10 scale.
 *
 * This is a supplementary signal — GDELT theme metadata
 * handles the heavy lifting for classification and severity.
 */
function analyzeTone(text) {
    const result = sentiment.analyze(text);
    // Scale AFINN score (-inf to +inf) into -10 to +10 range
    const tone = Math.max(-10, Math.min(10, result.score * 2));
    return Math.round(tone * 10) / 10;
}

// ═══════════════════════════════════════════════════════
// FETCH ALL FEEDS
// ═══════════════════════════════════════════════════════

async function fetchAllNews() {
    const allItems = [];

    for (const feed of FEEDS) {
        try {
            const parsed = await parser.parseURL(feed.url);
            const items = (parsed.items || []).map(item => {
                const title = cleanTitle(item.title || '');
                return {
                    title,
                    link: item.link || '',
                    source: feed.name,
                    pubDate: item.pubDate ? new Date(item.pubDate) : new Date(),
                    snippet: cleanTitle(item.contentSnippet || item.content || ''),
                    tone: analyzeTone(title),
                };
            });
            allItems.push(...items);
        } catch (err) {
            console.error(`[feeds] Error fetching ${feed.name}:`, err.message);
        }
    }

    const deduped = deduplicateByTitle(allItems);
    deduped.sort((a, b) => b.pubDate - a.pubDate);
    deduped.forEach(item => { item.timeAgo = timeAgo(item.pubDate); });

    return deduped;
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

module.exports = { fetchAllNews, FEEDS, analyzeTone };
