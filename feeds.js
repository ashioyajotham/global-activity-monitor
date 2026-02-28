/**
 * feeds.js — RSS News Feed Parser
 * 
 * Fetches ALL headlines from global news feeds.
 * No keyword filtering — everything is ingested and locations
 * are extracted later by the discovery engine.
 * 
 * v2: Custom geopolitical sentiment lexicon for better tone scoring.
 */

const RSSParser = require('rss-parser');
const Sentiment = require('sentiment');

const parser = new RSSParser({ timeout: 10000 });
const sentiment = new Sentiment();

// ═══════════════════════════════════════════════════════
// GEOPOLITICAL SENTIMENT LEXICON
// ═══════════════════════════════════════════════════════
// The default AFINN lexicon underweights geopolitical terms.
// "strike" scores -1, "collapse" scores -2 — both should be
// much stronger in a conflict monitoring context.

const GEO_LEXICON = {
    // Military / conflict — should be strongly negative
    'airstrike': -5, 'airstrikes': -5,
    'strike': -4, 'strikes': -4,
    'bombing': -5, 'bombed': -5, 'bombings': -5,
    'shelling': -5, 'shelled': -5,
    'missile': -4, 'missiles': -4,
    'offensive': -3,
    'invasion': -5,
    'incursion': -4,
    'troops': -2,
    'deployed': -2, 'deployment': -2,
    'retaliation': -4, 'retaliatory': -4, 'retaliate': -4,
    'casualties': -5,
    'killed': -5,
    'deaths': -4,
    'wounded': -4,
    'injured': -3,
    'massacre': -5,
    'genocide': -5,
    'atrocity': -5, 'atrocities': -5,
    'siege': -4,
    'blockade': -3,
    'occupation': -3,

    // Escalation language
    'escalation': -4, 'escalates': -4, 'escalating': -4,
    'collapse': -4, 'collapses': -4, 'collapsed': -4,
    'crisis': -3,
    'emergency': -3,
    'catastrophe': -5, 'catastrophic': -5,
    'devastation': -5, 'devastating': -5,
    'destruction': -5,
    'destabilize': -4, 'destabilizing': -4,
    'tensions': -3,
    'confrontation': -3,
    'standoff': -3,
    'ultimatum': -4,
    'brink': -4,

    // Humanitarian
    'refugees': -3, 'refugee': -3,
    'displaced': -3, 'displacement': -3,
    'famine': -5,
    'starvation': -5,
    'humanitarian': -2,
    'exodus': -4,

    // Political instability
    'coup': -4,
    'overthrow': -4, 'overthrown': -4,
    'authoritarian': -3,
    'crackdown': -4,
    'repression': -4,
    'suppression': -3,
    'detained': -3, 'detention': -3,
    'imprisonment': -3,
    'assassination': -5, 'assassinated': -5,

    // Sanctions / economic
    'sanctions': -3, 'sanctioned': -3,
    'embargo': -3,
    'tariffs': -2,
    'blacklisted': -3,

    // De-escalation (positive in this context)
    'ceasefire': 2,
    'truce': 2,
    'peace talks': 3,
    'negotiations': 1,
    'agreement': 2,
    'de-escalation': 3,
    'withdrawal': 1,
    'diplomacy': 1, 'diplomatic': 1,
    'mediation': 2,
    'reconciliation': 3,

    // Warnings & threats
    'warns': -2, 'warned': -2, 'warning': -2,
    'threatens': -3, 'threatened': -3, 'threat': -3,
    'condemns': -3, 'condemned': -3, 'condemnation': -3,
    'denounce': -3, 'denounced': -3,
    'vows': -2,

    // Neutral-ish terms that AFINN over/under-weights
    'forces': -1,
    'military': -1,
    'nuclear': -2,
    'weapons': -2,
    'arms': -1,
};

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
// ENHANCED SENTIMENT ANALYSIS
// ═══════════════════════════════════════════════════════

/**
 * Analyze sentiment with geopolitical domain awareness.
 * Uses the base AFINN lexicon + custom overrides.
 */
function analyzeGeopoliticalTone(text) {
    // Run base sentiment analysis
    const baseResult = sentiment.analyze(text);

    // Apply geopolitical lexicon overrides
    const words = text.toLowerCase().replace(/[^a-z\s-]/g, '').split(/\s+/);
    let geoAdjustment = 0;
    let geoMatches = 0;

    for (const word of words) {
        if (GEO_LEXICON[word] !== undefined) {
            // Override: subtract any base score for this word and add our score
            const baseWordScore = baseResult.calculation.find(c => c[word] !== undefined);
            const baseScore = baseWordScore ? baseWordScore[word] : 0;
            geoAdjustment += GEO_LEXICON[word] - baseScore;
            geoMatches++;
        }
    }

    // Also check multi-word terms
    const lower = text.toLowerCase();
    const multiWordTerms = ['peace talks', 'death toll', 'war crimes'];
    for (const term of multiWordTerms) {
        if (lower.includes(term) && GEO_LEXICON[term] !== undefined) {
            geoAdjustment += GEO_LEXICON[term];
            geoMatches++;
        }
    }

    const adjustedScore = baseResult.score + geoAdjustment;

    // Map to GDELT's -10 to +10 scale
    // The adjustment factor accounts for headline brevity
    const scaleFactor = geoMatches > 0 ? 2.5 : 2;
    const tone = Math.max(-10, Math.min(10, adjustedScore * scaleFactor));

    return {
        score: adjustedScore,
        tone: Math.round(tone * 10) / 10,
        geoMatches,
    };
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

                // Use enhanced geopolitical sentiment
                const { tone, geoMatches } = analyzeGeopoliticalTone(title);

                return {
                    title,
                    link: item.link || '',
                    source: feed.name,
                    pubDate: item.pubDate ? new Date(item.pubDate) : new Date(),
                    snippet: cleanTitle(item.contentSnippet || item.content || ''),
                    tone,
                    geoMatches, // useful for debugging
                };
            });
            allItems.push(...items);
        } catch (err) {
            console.error(`[feeds] Error fetching ${feed.name}:`, err.message);
        }
    }

    const deduped = deduplicateByTitle(allItems);
    deduped.sort((a, b) => b.pubDate - a.pubDate);
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
        .replace(/<[^>]*>/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 300);
}

function deduplicateByTitle(items) {
    const seen = new Set();
    return items.filter(item => {
        const key = item.title.toLowerCase()
            .replace(/[^a-z0-9\s]/g, '')
            .trim()
            .slice(0, 50);
        if (key.length < 10) return false;
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

module.exports = { fetchAllNews, FEEDS, analyzeGeopoliticalTone, GEO_LEXICON };
