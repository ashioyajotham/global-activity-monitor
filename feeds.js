/**
 * feeds.js — RSS News Feed Parser
 * 
 * Fetches ALL headlines from global news feeds.
 * No keyword filtering — everything is ingested and locations
 * are extracted later by the discovery engine.
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
    // Alternative & Independent News
    { name: 'Counterpunch', url: 'https://www.counterpunch.org/feed/' },
    { name: 'Declassified UK', url: 'https://declassifieduk.org/feed/' },
    { name: 'RT News', url: 'https://www.rt.com/rss/news/' },
    { name: 'Mint Press News', url: 'https://www.mintpressnews.com/feed/' },
    { name: 'The Grayzone', url: 'https://thegrayzone.com/feed/' },
];

// ═══════════════════════════════════════════════════════
// FETCH ALL FEEDS (no filtering)
// ═══════════════════════════════════════════════════════

/**
 * Fetch all RSS feeds and return normalized items.
 * No keyword filtering — all headlines are returned.
 */
async function fetchAllNews() {
    const allItems = [];

    for (const feed of FEEDS) {
        try {
            const parsed = await parser.parseURL(feed.url);
            const items = (parsed.items || []).map(item => {
                const title = cleanTitle(item.title || '');
                const result = sentiment.analyze(title);
                // Sentiment score: usually between -5 and +5 for short text.
                // Map it roughly to GDELT's -10 to +10 scale (multiply by 2)
                const tone = Math.max(-10, Math.min(10, result.score * 2));

                return {
                    title,
                    link: item.link || '',
                    source: feed.name,
                    pubDate: item.pubDate ? new Date(item.pubDate) : new Date(),
                    snippet: cleanTitle(item.contentSnippet || item.content || ''),
                    tone: tone, // Provide tone for discovery engine scoring
                };
            });
            allItems.push(...items);
        } catch (err) {
            console.error(`[feeds] Error fetching ${feed.name}:`, err.message);
        }
    }

    // Deduplicate by title similarity
    const deduped = deduplicateByTitle(allItems);

    // Sort by pub date (newest first)
    deduped.sort((a, b) => b.pubDate - a.pubDate);

    // Add time ago
    deduped.forEach(item => {
        item.timeAgo = timeAgo(item.pubDate);
    });

    return deduped;
}

// ═══════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════

function cleanTitle(text) {
    return text
        .replace(/<[^>]*>/g, '')        // strip HTML
        .replace(/\s+/g, ' ')          // collapse whitespace
        .trim()
        .slice(0, 300);                // cap length
}

function deduplicateByTitle(items) {
    const seen = new Set();
    return items.filter(item => {
        // Normalize: lowercase, strip punctuation, take first 50 chars
        const key = item.title.toLowerCase()
            .replace(/[^a-z0-9\s]/g, '')
            .trim()
            .slice(0, 50);
        if (key.length < 10) return false; // skip very short
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function timeAgo(date) {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
}

module.exports = { fetchAllNews, FEEDS };
