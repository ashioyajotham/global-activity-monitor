/**
 * discovery.js — Autonomous Situation Discovery Engine
 *
 * v4: GDELT theme-based classification replaces keyword matching.
 *     No NOISE_TERMS, SEVERITY_TERMS, or CATEGORY_PATTERNS.
 *     GDELT's NLP pipeline does the classification — we just map the results.
 *
 * Architecture:
 *   GDELT theme query → events tagged with theme group → severity + category for free
 *   Sports, entertainment etc. never appear because GDELT themes are geopolitical by nature.
 */

const { extractCountries, findNearest } = require('./countries-data');

// ═══════════════════════════════════════════════════════
// GDELT THEME GROUPS
// ═══════════════════════════════════════════════════════
// Instead of keyword matching on headlines, we query GDELT by its
// pre-computed themes. Each event comes back already classified.
//
// Severity and category are properties of the THEME GROUP
// that found the event — not keyword-guessed from raw text.

const THEME_GROUPS = [
    {
        id: 'armed-violence',
        label: 'Armed Conflict',
        geoQuery: '(theme:KILL OR theme:ARMEDCONFLICT)',
        docQuery: '(theme:KILL OR theme:ARMEDCONFLICT)',
        severity: 'critical',     // GDELT decided it's about killing/armed conflict
        category: 'Armed Conflict',
        weight: 1.5,              // scoring multiplier
    },
    {
        id: 'military',
        label: 'Military Operations',
        geoQuery: 'theme:MILITARY',
        docQuery: 'theme:MILITARY',
        severity: 'critical',
        category: 'Military Operations',
        weight: 1.3,
    },
    {
        id: 'terrorism',
        label: 'Terrorism',
        geoQuery: 'theme:TERROR',
        docQuery: 'theme:TERROR',
        severity: 'critical',
        category: 'Terrorism',
        weight: 1.4,
    },
    {
        id: 'civil-unrest',
        label: 'Civil Unrest',
        geoQuery: '(theme:PROTEST OR theme:COUP)',
        docQuery: '(theme:PROTEST OR theme:COUP)',
        severity: 'elevated',
        category: 'Civil Unrest',
        weight: 1.1,
    },
    {
        id: 'humanitarian',
        label: 'Humanitarian Crisis',
        geoQuery: '(theme:REFUGEE OR theme:FAMINE OR theme:DISPLACEMENT)',
        docQuery: '(theme:REFUGEE OR theme:FAMINE OR theme:DISPLACEMENT)',
        severity: 'elevated',
        category: 'Humanitarian Crisis',
        weight: 1.2,
    },
    {
        id: 'wmd',
        label: 'WMD / Nuclear',
        geoQuery: 'theme:WMD',
        docQuery: 'theme:WMD',
        severity: 'critical',
        category: 'Nuclear Tension',
        weight: 1.5,
    },
    {
        id: 'crisis',
        label: 'General Crisis',
        geoQuery: 'theme:CRISISLEX_CRISISLEXREC',
        docQuery: 'theme:CRISISLEX_CRISISLEXREC',
        severity: 'elevated',
        category: 'Crisis',
        weight: 1.0,
    },
];

// Severity → numeric for scoring
const SEVERITY_SCORE = { critical: 3, elevated: 2, moderate: 1 };

// ═══════════════════════════════════════════════════════
// GDELT ENDPOINT BUILDERS
// ═══════════════════════════════════════════════════════

function buildGeoQuery(query) {
    return `https://api.gdeltproject.org/api/v2/geo/geo?query=${encodeURIComponent(query)}&format=GeoJSON&timespan=1d&maxpoints=75`;
}

function buildDocQuery(query, maxRecords = 75) {
    return `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&timespan=24h&maxrecords=${maxRecords}&format=json&sort=datedesc`;
}

// ═══════════════════════════════════════════════════════
// RESPONSE PARSERS (tag events with theme metadata)
// ═══════════════════════════════════════════════════════

function parseGeoResponse(geojson, themeGroup) {
    if (!geojson?.features) return [];
    return geojson.features
        .filter(f => f.geometry?.coordinates)
        .filter(f => { const [lng, lat] = f.geometry.coordinates; return !(lat === 0 && lng === 0); })
        .map(f => {
            const [lng, lat] = f.geometry.coordinates;
            const props = f.properties || {};
            let url = props.url || '', name = props.name || '';
            if (!url && props.html) { const m = props.html.match(/href="([^"]+)"/); if (m) url = m[1]; }
            if (!name && props.html) name = props.html.replace(/<[^>]+>/g, '').trim();
            return {
                lat, lng, name, url,
                source: 'gdelt-geo',
                tone: props.tone ?? 0,
                _isGdelt: true,
                // Theme metadata — this is the key difference from v3
                _themeId: themeGroup.id,
                _severity: themeGroup.severity,
                _category: themeGroup.category,
                _weight: themeGroup.weight,
            };
        });
}

function parseDocResponse(data, themeGroup) {
    if (!data?.articles) return [];
    return data.articles.map(art => {
        const countries = extractCountries(art.title || '');
        const primary = countries[0] || null;
        return {
            title: art.title || '', url: art.url || '', source: art.domain || 'unknown',
            sourceCountry: art.sourcecountry || '', language: art.language || '',
            lat: primary?.lat || null, lng: primary?.lng || null,
            countryName: primary?.name || null, allCountries: countries.map(c => c.name),
            tone: 0, _isGdelt: false, _isDoc: true,
            _themeId: themeGroup.id,
            _severity: themeGroup.severity,
            _category: themeGroup.category,
            _weight: themeGroup.weight,
        };
    }).filter(a => a.lat !== null);
}

// ═══════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════

function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371, dLat = (lat2-lat1)*Math.PI/180, dLng = (lng2-lng1)*Math.PI/180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
    return R*2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function isLocationString(s) {
    const c = (s.match(/,/g)||[]).length, w = s.split(/\s+/).length;
    return (c >= 2 && w <= 6) || (/^[A-Z][a-z]+,\s*[A-Z]/.test(s) && c >= 1 && w <= 5);
}

// ═══════════════════════════════════════════════════════
// CLUSTERING
// ═══════════════════════════════════════════════════════

const CLUSTER_RADIUS_KM = 500;

function clusterEvents(events) {
    const clusters = [];
    for (const ev of events) {
        let merged = false;
        for (const cl of clusters) {
            if (haversineKm(ev.lat, ev.lng, cl.centerLat, cl.centerLng) < CLUSTER_RADIUS_KM) {
                cl.events.push(ev);
                const n = cl.events.length;
                cl.centerLat = ((cl.centerLat*(n-1))+ev.lat)/n;
                cl.centerLng = ((cl.centerLng*(n-1))+ev.lng)/n;
                merged = true; break;
            }
        }
        if (!merged) clusters.push({ centerLat: ev.lat, centerLng: ev.lng, events: [ev] });
    }
    return clusters;
}

// ═══════════════════════════════════════════════════════
// CONFIDENCE + SOURCE DIVERSITY
// ═══════════════════════════════════════════════════════

function assessConfidence(cluster) {
    const rss = cluster.events.filter(e => !e._isGdelt && !e._isDoc);
    const doc = cluster.events.filter(e => e._isDoc);
    const gdelt = cluster.events.filter(e => e._isGdelt);

    // Source diversity: how many unique domains report on this?
    const domains = new Set(cluster.events.map(e => e.source).filter(Boolean));
    const diversity = domains.size;

    if ((rss.length >= 3 || doc.length >= 3) && diversity >= 2) return 'high';
    if (rss.length >= 1 || doc.length >= 1) return 'normal';
    if (gdelt.length >= 8) return 'low';
    return 'noise';
}

function sourceDiversity(cluster) {
    return new Set(cluster.events.map(e => e.source).filter(Boolean)).size;
}

// ═══════════════════════════════════════════════════════
// AUTO-NAMING (unchanged from v3)
// ═══════════════════════════════════════════════════════

function autoNameSituation(cluster) {
    const mentions = {};
    for (const ev of cluster.events) {
        for (const c of extractCountries(ev.title || ev.name || '')) mentions[c.name] = (mentions[c.name]||0)+1;
        if (ev.allCountries) for (const n of ev.allCountries) mentions[n] = (mentions[n]||0)+1;
    }
    if (Object.keys(mentions).length === 0) {
        const near = findNearest(cluster.centerLat, cluster.centerLng);
        return near ? near.name + ' Region' : `${cluster.centerLat.toFixed(1)}°, ${cluster.centerLng.toFixed(1)}°`;
    }
    const sorted = Object.entries(mentions).sort((a,b) => b[1]-a[1]);
    if (sorted.length === 1) return sorted[0][0];
    return [sorted[0][0], sorted[1][0]].sort().join(' – ');
}

// ═══════════════════════════════════════════════════════
// CATEGORY FROM THEME METADATA (replaces keyword matching)
// ═══════════════════════════════════════════════════════

/**
 * Determine category by counting which theme group is dominant
 * in the cluster. No keyword scanning — reads from event tags.
 */
function categorizeSituation(cluster) {
    const themeCounts = {};

    for (const ev of cluster.events) {
        if (ev._category) {
            themeCounts[ev._category] = (themeCounts[ev._category] || 0) + 1;
        }
    }

    if (Object.keys(themeCounts).length === 0) return 'Geopolitical Tension';

    // Return the most common theme-assigned category
    return Object.entries(themeCounts)
        .sort((a, b) => b[1] - a[1])[0][0];
}

// ═══════════════════════════════════════════════════════
// SCORING (theme-based severity replaces keyword matching)
// ═══════════════════════════════════════════════════════

function scoreSituation(cluster, confidence) {
    const total = cluster.events.length;
    const richCount = cluster.events.filter(e => !e._isGdelt || e._isDoc).length;

    // 1. Volume score — rich sources weighted higher
    const effectiveCount = richCount * 1.5 + (total - richCount) * 0.5;
    let volumeScore = Math.min(effectiveCount / 4, 8);

    // 2. Severity from GDELT theme tags (not keywords)
    //    Take the highest severity across events in the cluster
    let maxSeverity = 0;
    for (const ev of cluster.events) {
        if (ev._severity) {
            maxSeverity = Math.max(maxSeverity, SEVERITY_SCORE[ev._severity] || 0);
        }
    }

    // 3. Tone score — from GDELT tone or sentiment analysis
    const tones = cluster.events.filter(e => e.tone).map(e => e.tone);
    let toneScore = 0;
    if (tones.length > 0) {
        const avgTone = tones.reduce((a, b) => a + b, 0) / tones.length;
        toneScore = Math.max(0, Math.min(2, (-avgTone) / 5));
    }

    // 4. Source diversity bonus — more sources = more significant
    const diversity = sourceDiversity(cluster);
    const diversityBonus = Math.min(diversity * 0.3, 1.5);

    // 5. Theme weight — some themes carry more weight
    const weights = cluster.events.map(e => e._weight || 1.0);
    const avgWeight = weights.reduce((a, b) => a + b, 0) / weights.length;

    let raw = (volumeScore + maxSeverity + toneScore + diversityBonus) * avgWeight;

    // Confidence cap
    if (confidence === 'low') raw = Math.min(raw, 3.9);

    return Math.round(Math.min(10, Math.max(1, raw)) * 10) / 10;
}

function classifyStatus(score) {
    return score >= 6.5 ? 'critical' : score >= 4 ? 'elevated' : 'stable';
}

// ═══════════════════════════════════════════════════════
// DESCRIPTION (TF-IDF summarizer, cleaned up)
// ═══════════════════════════════════════════════════════

function autoDescribeSituation(cluster, confidence) {
    if (confidence === 'low') return generateThinDesc(cluster);

    // Prefer RSS/DOC snippets
    const snippets = cluster.events
        .filter(e => !e._isGdelt)
        .map(e => e.snippet || '')
        .filter(s => s.length > 30 && !isLocationString(s));

    if (snippets.length > 0) {
        const corpus = [...new Set(snippets)].join('. ');
        const sents = splitSentences(corpus);
        if (sents.length >= 2) {
            const ranked = scoreSentences(sents).slice(0, 3).map(r => r.sentence);
            if (ranked.length) return ranked.sort((a, b) => corpus.indexOf(a) - corpus.indexOf(b)).join(' ');
        }
        if (sents.length === 1) return sents[0];
    }

    // Headlines fallback
    const headlines = [...new Set(
        cluster.events.filter(e => !e._isGdelt).map(e => e.title || '').filter(t => t.length > 15 && !isLocationString(t))
    )];
    if (headlines.length > 0) return headlines.slice(0, 3).join(' · ');

    return generateThinDesc(cluster);
}

function generateThinDesc(cluster) {
    const name = autoNameSituation(cluster);
    const count = cluster.events.length;

    // Use theme metadata to describe what GDELT detected
    const themes = {};
    for (const ev of cluster.events) {
        if (ev._category) themes[ev._category] = (themes[ev._category] || 0) + 1;
    }

    const themeDescs = Object.entries(themes)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([cat, n]) => `${cat.toLowerCase()} (${n} events)`);

    if (themeDescs.length > 0) {
        return `${count} events near ${name}: ${themeDescs.join(', ')}. Classified by GDELT — awaiting headline confirmation.`;
    }
    return `${count} geo-events detected near ${name}. Monitoring via GDELT data.`;
}

// TF-IDF helpers
function splitSentences(t) { return t.replace(/\s+/g,' ').split(/(?<=[.!?])\s+/).map(s=>s.trim()).filter(s=>s.length>30&&/[a-zA-Z]/.test(s)&&!isLocationString(s)); }

function scoreSentences(sents) {
    const STOP = new Set('the a an is are was were be been being have has had do does did will would could should may might shall can to of in for on with at by from as into through during before after above below between out off over under again further then once here there when where why how all both each few more most other some such no nor not only own same so than too very and but if or because until while that this it its he she they them their his her we you i my your said says also new one two three just about up'.split(' '));
    const tok = sents.map(s => s.toLowerCase().replace(/[^a-z0-9\s]/g,'').split(/\s+/).filter(w=>w.length>2&&!STOP.has(w)));
    const df = {}; tok.forEach(t => { new Set(t).forEach(w => { df[w]=(df[w]||0)+1; }); });
    const N = sents.length;
    return sents.map((s,i) => {
        const t = tok[i]; if (!t.length) return {sentence:s,score:0};
        const tf={}; t.forEach(w=>{tf[w]=(tf[w]||0)+1});
        let sc=0; for(const[w,c]of Object.entries(tf)) sc+=(c/t.length)*Math.log(N/(df[w]||1));
        sc *= Math.min(1.2, s.length/80);
        return {sentence:s, score:sc};
    }).sort((a,b) => b.score-a.score);
}

// ═══════════════════════════════════════════════════════
// PARTY + ARTICLE EXTRACTION
// ═══════════════════════════════════════════════════════

function extractParties(cluster) {
    const m = {};
    for (const ev of cluster.events) {
        for (const c of extractCountries(ev.title||ev.name||'')) m[c.name] = (m[c.name]||0)+1;
        if (ev.allCountries) for (const n of ev.allCountries) m[n] = (m[n]||0)+1;
    }
    return Object.entries(m).sort((a,b)=>b[1]-a[1]).slice(0,4).map(([n])=>n);
}

function extractTopArticles(cluster) {
    const arts = cluster.events
        .filter(e => !e._isGdelt)
        .filter(e => (e.title||'').length > 20 && !isLocationString(e.title||''))
        .slice(0, 5)
        .map(e => ({ title: e.title, url: e.url||e.link||'#', source: e.source||'Unknown', tone: e.tone??null }));
    if (arts.length >= 2) return arts;
    return cluster.events.filter(e => (e.title||e.name||'').length > 20).slice(0,5)
        .map(e => ({ title: e.title||e.name, url: e.url||'#', source: e.source||'Unknown', tone: e.tone??null }));
}

// ═══════════════════════════════════════════════════════
// MAIN PIPELINE
// ═══════════════════════════════════════════════════════

function discoverSituations(events) {
    if (!events?.length) return [];

    // No noise filter needed — GDELT themes are inherently geopolitical.
    // Sports, entertainment etc. never get tagged with MILITARY, PROTEST, etc.
    console.log(`[discovery] ${events.length} theme-classified events to cluster`);

    const clusters = clusterEvents(events).filter(cl => cl.events.length >= 2);

    const situations = clusters.map((cl, idx) => {
        const confidence = assessConfidence(cl);
        if (confidence === 'noise') return null;

        const name = autoNameSituation(cl);
        const score = scoreSituation(cl, confidence);

        return {
            id: `auto-${idx}-${Math.round(cl.centerLat)}-${Math.round(cl.centerLng)}`,
            name, lat: cl.centerLat, lng: cl.centerLng,
            status: classifyStatus(score), score,
            type: categorizeSituation(cl),
            description: autoDescribeSituation(cl, confidence),
            parties: extractParties(cl),
            region: findNearest(cl.centerLat, cl.centerLng)?.name || 'Unknown',
            articleCount: cl.events.length,
            topArticles: extractTopArticles(cl),
            confidence,
            sourceDiversity: sourceDiversity(cl),
            lastChecked: new Date().toISOString(),
        };
    }).filter(Boolean);

    // Dedup by name (keep highest score)
    const dedup = new Map();
    for (const s of situations) if (!dedup.has(s.name) || dedup.get(s.name).score < s.score) dedup.set(s.name, s);
    const final = [...dedup.values()].sort((a, b) => b.score - a.score).slice(0, 30);

    const c = {high:0, normal:0, low:0};
    final.forEach(s => { c[s.confidence] = (c[s.confidence]||0)+1; });
    console.log(`[discovery] ${final.length} situations — ${c.high} high, ${c.normal} normal, ${c.low} low`);

    return final;
}

// ═══════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════

module.exports = {
    THEME_GROUPS,
    buildGeoQuery,
    buildDocQuery,
    parseGeoResponse,
    parseDocResponse,
    discoverSituations,
    clusterEvents,
    haversineKm,
    classifyStatus,
    assessConfidence,
    extractCountries,
    findNearest,
};
