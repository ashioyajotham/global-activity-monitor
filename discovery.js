/**
 * discovery.js — Autonomous Situation Discovery Engine
 *
 * v3: ISO standard geodata replaces hand-maintained GAZETTEER.
 *     GDELT DOC API as supplementary article source.
 *     Noise filtering + severity scoring remain (Wave 2 → CAMEO codes).
 */

const { extractCountries, findNearest } = require('./countries-data');

// ═══════════════════════════════════════════════════════
// NOISE + SEVERITY (Wave 2 replaces with CAMEO codes)
// ═══════════════════════════════════════════════════════

const NOISE_TERMS = {
    sports: ['championship','tournament','semifinal','quarterfinal','final score','cricket','football match','soccer','tennis','olympics','world cup','premier league','goal scored','wicket','innings','batting','bowling','midfielder','goalkeeper','fifa','uefa','icc trophy','defending champion','qualifier','playoff','super bowl','grand slam','medal tally','athlete','coach fired','transfer window','hat-trick','run chase','test match','odi','t20','world series','knockout stage','group stage','seeded','ranking points','match day','scoreboard','fixture'],
    entertainment: ['box office','grammy','oscar','emmy','netflix','streaming','trailer release','premiere','bollywood','hollywood','celebrity','album release','concert tour','red carpet','award show','reality show','tv series','movie review','film festival'],
};

const SEVERITY_TERMS = {
    critical: ['war','killed','airstrike','bombing','massacre','genocide','invasion','missile','casualt','death toll','dead','execution','shelling'],
    elevated: ['conflict','fighting','attack','troops','military','clash','violence','crisis','urgent','hostage','artillery','drone','refugee','displacement','humanitarian'],
    moderate: ['tension','sanctions','protest','unrest','dispute','threat','warning','escalat','opposition','riot','detain','arrest'],
};

const CATEGORY_PATTERNS = [
    { label: 'War', terms: ['war ','warfare','invasion','frontline','offensive ','battlefield'], exclude: ['trade war','star wars','war of words','culture war','turf war'] },
    { label: 'Armed Conflict', terms: ['armed conflict','fighting','rebel','insurgent','militia','guerrilla'], exclude: [] },
    { label: 'Military Operations', terms: ['airstrike','bombing','missile','drone strike','military operation','troops deployed'], exclude: [] },
    { label: 'Humanitarian Crisis', terms: ['humanitarian','refugee','famine','displacement','aid convoy','starvation'], exclude: ['humanitarian award'] },
    { label: 'Civil Unrest', terms: ['protest','riot','demonstration','unrest','uprising','revolution'], exclude: [] },
    { label: 'Political Crisis', terms: ['coup','political crisis','opposition leader','authoritarian','election fraud'], exclude: [] },
    { label: 'Terrorism', terms: ['terror','extremist','jihad','suicide bomb'], exclude: [] },
    { label: 'Maritime Dispute', terms: ['maritime','naval','territorial waters','south china sea','strait'], exclude: [] },
    { label: 'Nuclear Tension', terms: ['nuclear','uranium','enrichment','nonproliferation','warhead'], exclude: ['nuclear energy','nuclear power plant'] },
    { label: 'Sanctions & Diplomacy', terms: ['sanction','embargo','diplomatic','negotiation','treaty'], exclude: [] },
    { label: 'Security Crisis', terms: ['security','crime','gang','cartel','kidnap','extortion'], exclude: ['cyber security','food security'] },
    { label: 'Geopolitical Tension', terms: ['tension','standoff','disputed','escalation'], exclude: [] },
];

// ═══════════════════════════════════════════════════════
// GDELT ENDPOINTS
// ═══════════════════════════════════════════════════════

const GEO_THEMES = [
    { label: 'conflict', query: '(conflict OR war OR fighting OR battle)' },
    { label: 'crisis', query: '(crisis OR humanitarian OR refugee OR famine)' },
    { label: 'military', query: '(military OR airstrike OR troops OR bombing)' },
    { label: 'unrest', query: '(protest OR riot OR unrest OR uprising)' },
    { label: 'tension', query: '(sanctions OR nuclear OR tension OR standoff)' },
];

function buildGeoQuery(themeQuery) {
    return `https://api.gdeltproject.org/api/v2/geo/geo?query=${encodeURIComponent(themeQuery)}&format=GeoJSON&timespan=1d&maxpoints=75`;
}

function buildDocQuery(themeQuery, maxRecords = 75) {
    return `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(themeQuery)}&mode=artlist&timespan=24h&maxrecords=${maxRecords}&format=json&sort=datedesc`;
}

function parseGeoResponse(geojson) {
    if (!geojson?.features) return [];
    return geojson.features
        .filter(f => f.geometry?.coordinates)
        .filter(f => { const [lng, lat] = f.geometry.coordinates; return !(lat === 0 && lng === 0); })
        .map(f => {
            const [lng, lat] = f.geometry.coordinates;
            const props = f.properties || {};
            let url = props.url || '';
            let name = props.name || '';
            if (!url && props.html) { const m = props.html.match(/href="([^"]+)"/); if (m) url = m[1]; }
            if (!name && props.html) name = props.html.replace(/<[^>]+>/g, '').trim();
            return { lat, lng, name, url, source: 'gdelt-geo', tone: props.tone ?? 0, _isGdelt: true };
        });
}

function parseDocResponse(data) {
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
        };
    }).filter(a => a.lat !== null);
}

// ═══════════════════════════════════════════════════════
// NOISE + HELPERS
// ═══════════════════════════════════════════════════════

function classifyNoise(text) {
    if (!text) return { isNoise: false, category: null };
    const lower = text.toLowerCase();
    for (const [category, terms] of Object.entries(NOISE_TERMS)) {
        const strong = terms.filter(t => t.length > 7 && lower.includes(t));
        const weak = terms.filter(t => t.length <= 7 && lower.includes(t));
        if (strong.length >= 1) {
            const geoTerms = [...SEVERITY_TERMS.critical, ...SEVERITY_TERMS.elevated];
            if (geoTerms.filter(t => lower.includes(t)).length >= 2) return { isNoise: false, category: null };
            return { isNoise: true, category };
        }
        if (weak.length >= 3) return { isNoise: true, category };
    }
    return { isNoise: false, category: null };
}

function filterNoiseEvents(events) {
    let n = 0;
    const clean = events.filter(ev => {
        const { isNoise } = classifyNoise(`${ev.title || ''} ${ev.name || ''} ${ev.snippet || ''}`);
        if (isNoise) { n++; return false; } return true;
    });
    if (n > 0) console.log(`[filter] Removed ${n} noise events`);
    return clean;
}

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
// CLUSTERING + CONFIDENCE
// ═══════════════════════════════════════════════════════

const CLUSTER_RADIUS_KM = 500;

function clusterEvents(events) {
    const clusters = [];
    for (const ev of events) {
        let merged = false;
        for (const cl of clusters) {
            if (haversineKm(ev.lat, ev.lng, cl.centerLat, cl.centerLng) < CLUSTER_RADIUS_KM) {
                cl.events.push(ev); const n = cl.events.length;
                cl.centerLat = ((cl.centerLat*(n-1))+ev.lat)/n;
                cl.centerLng = ((cl.centerLng*(n-1))+ev.lng)/n;
                merged = true; break;
            }
        }
        if (!merged) clusters.push({ centerLat: ev.lat, centerLng: ev.lng, events: [ev] });
    }
    return clusters;
}

function assessConfidence(cluster) {
    const rss = cluster.events.filter(e => !e._isGdelt && !e._isDoc);
    const doc = cluster.events.filter(e => e._isDoc);
    const gdelt = cluster.events.filter(e => e._isGdelt);
    if (rss.length >= 3 || doc.length >= 3) return 'high';
    if (rss.length >= 1 || doc.length >= 1) return 'normal';
    if (gdelt.length >= 8) return 'low';
    return 'noise';
}

// ═══════════════════════════════════════════════════════
// NAMING, DESCRIPTION, CATEGORY, SCORE
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

function autoDescribeSituation(cluster, confidence) {
    if (confidence === 'low') return generateGdeltDesc(cluster);
    const snippets = cluster.events.filter(e => !e._isGdelt).map(e => e.snippet||'').filter(s => s.length > 30 && !isLocationString(s));
    const headlines = [...new Set(cluster.events.filter(e => !e._isGdelt).map(e => e.title||'').filter(t => t.length > 15 && !isLocationString(t)))];
    if (snippets.length > 0) {
        const corpus = [...new Set(snippets)].join('. ');
        const sents = splitSentences(corpus);
        if (sents.length >= 2) { const ranked = scoreSentences(sents).filter(r => r.score > 0.05).slice(0,3).map(r=>r.sentence); if (ranked.length) return ranked.sort((a,b)=>corpus.indexOf(a)-corpus.indexOf(b)).join(' '); }
        if (sents.length === 1) return sents[0];
    }
    if (headlines.length > 0) { const clean = headlines.filter(h => !classifyNoise(h).isNoise); return (clean.length ? clean : headlines).slice(0,3).join(' · '); }
    return generateGdeltDesc(cluster);
}

function generateGdeltDesc(cluster) {
    const name = autoNameSituation(cluster), count = cluster.events.length;
    const all = cluster.events.map(e => (e.name||'').toLowerCase()).join(' ');
    const clues = [];
    if (/military|troops|army|deploy/.test(all)) clues.push('military activity');
    if (/border|crossing|checkpoint/.test(all)) clues.push('border activity');
    if (/protest|rally|march|demonstr/.test(all)) clues.push('civil unrest');
    if (/port|naval|ship|strait/.test(all)) clues.push('maritime activity');
    if (/capital|parliament|government|embassy/.test(all)) clues.push('political activity');
    if (/attack|explos|strike|bomb/.test(all)) clues.push('reported attacks');
    return clues.length > 0
        ? `${count} events near ${name}: ${clues.join(', ')}. Monitoring — awaiting headline confirmation.`
        : `${count} geo-events detected near ${name}. Monitoring via GDELT data.`;
}

function categorizeSituation(cluster) {
    const rss = cluster.events.filter(e => !e._isGdelt).map(e => (e.title||'').toLowerCase()).join(' ');
    const all = cluster.events.map(e => (e.title||e.name||'').toLowerCase()).join(' ');
    const text = rss.length > 20 ? rss : all;
    for (const cat of CATEGORY_PATTERNS) {
        if (cat.exclude?.some(ex => text.includes(ex))) continue;
        for (const term of cat.terms) if (text.includes(term)) return cat.label;
    }
    return 'Geopolitical Tension';
}

function scoreSituation(cluster, confidence) {
    const count = cluster.events.length;
    const richCount = cluster.events.filter(e => !e._isGdelt || e._isDoc).length;
    const rss = cluster.events.filter(e => !e._isGdelt).map(e => (e.title||'').toLowerCase()).join(' ');
    const all = cluster.events.map(e => (e.title||e.name||'').toLowerCase()).join(' ');
    const text = rss.length > 20 ? rss : all;
    let vol = Math.min(richCount * 1.5 + (count - richCount) * 0.5, 8) / 1;
    let sev = 0;
    for (const t of SEVERITY_TERMS.critical) if (text.includes(t)) { sev = 3; break; }
    if (sev < 3) for (const t of SEVERITY_TERMS.elevated) if (text.includes(t)) { sev = 2; break; }
    if (sev < 2) for (const t of SEVERITY_TERMS.moderate) if (text.includes(t)) { sev = 1; break; }
    const tones = cluster.events.filter(e => e.tone).map(e => e.tone);
    let tone = 0;
    if (tones.length) { const avg = tones.reduce((a,b)=>a+b,0)/tones.length; tone = Math.max(0, Math.min(2, (-avg)/5)); }
    let raw = vol + sev + tone;
    if (confidence === 'low') raw = Math.min(raw, 3.9);
    return Math.round(Math.min(10, Math.max(1, raw)) * 10) / 10;
}

function classifyStatus(score) { return score >= 6.5 ? 'critical' : score >= 4 ? 'elevated' : 'stable'; }

function extractParties(cluster) {
    const m = {};
    for (const ev of cluster.events) {
        for (const c of extractCountries(ev.title||ev.name||'')) m[c.name] = (m[c.name]||0)+1;
        if (ev.allCountries) for (const n of ev.allCountries) m[n] = (m[n]||0)+1;
    }
    return Object.entries(m).sort((a,b)=>b[1]-a[1]).slice(0,4).map(([n])=>n);
}

function extractTopArticles(cluster) {
    const arts = cluster.events.filter(e => !e._isGdelt).filter(e => (e.title||'').length > 20 && !isLocationString(e.title||'') && !classifyNoise(e.title||'').isNoise).slice(0,5).map(e => ({ title: e.title, url: e.url||e.link||'#', source: e.source||'Unknown', tone: e.tone??null }));
    if (arts.length >= 2) return arts;
    return cluster.events.filter(e => (e.title||e.name||'').length > 20).slice(0,5).map(e => ({ title: e.title||e.name, url: e.url||'#', source: e.source||'Unknown', tone: e.tone??null }));
}

// TF-IDF helpers
function splitSentences(t) { return t.replace(/\s+/g,' ').split(/(?<=[.!?])\s+/).map(s=>s.trim()).filter(s=>s.length>30&&/[a-zA-Z]/.test(s)&&!isLocationString(s)); }
function scoreSentences(sents) {
    const STOP = new Set('the a an is are was were be been being have has had do does did will would could should may might shall can to of in for on with at by from as into through during before after above below between out off over under again further then once here there when where why how all both each few more most other some such no nor not only own same so than too very and but if or because until while that this it its he she they them their his her we you i my your said says also new one two three just about up'.split(' '));
    const tok = sents.map(s => s.toLowerCase().replace(/[^a-z0-9\s]/g,'').split(/\s+/).filter(w=>w.length>2&&!STOP.has(w)));
    const df = {}; tok.forEach(t => { new Set(t).forEach(w => { df[w]=(df[w]||0)+1; }); }); const N = sents.length;
    return sents.map((s,i) => { const t = tok[i]; if (!t.length) return {sentence:s,score:0}; const tf={}; t.forEach(w=>{tf[w]=(tf[w]||0)+1}); let sc=0; for(const[w,c]of Object.entries(tf)) sc+=(c/t.length)*Math.log(N/(df[w]||1)); sc*=Math.min(1.2,s.length/80); if(classifyNoise(s).isNoise)sc*=0.1; return {sentence:s,score:sc}; }).sort((a,b)=>b.score-a.score);
}

// ═══════════════════════════════════════════════════════
// MAIN PIPELINE
// ═══════════════════════════════════════════════════════

function discoverSituations(events) {
    if (!events?.length) return [];
    const clean = filterNoiseEvents(events);
    console.log(`[discovery] ${clean.length} events after filter (removed ${events.length - clean.length})`);
    const clusters = clusterEvents(clean).filter(cl => cl.events.length >= 2);
    const situations = clusters.map((cl, idx) => {
        const confidence = assessConfidence(cl);
        if (confidence === 'noise') return null;
        const name = autoNameSituation(cl), score = scoreSituation(cl, confidence);
        return {
            id: `auto-${idx}-${Math.round(cl.centerLat)}-${Math.round(cl.centerLng)}`,
            name, lat: cl.centerLat, lng: cl.centerLng,
            status: classifyStatus(score), score, type: categorizeSituation(cl),
            description: autoDescribeSituation(cl, confidence), parties: extractParties(cl),
            region: findNearest(cl.centerLat, cl.centerLng)?.name || 'Unknown',
            articleCount: cl.events.length, topArticles: extractTopArticles(cl),
            confidence, lastChecked: new Date().toISOString(),
        };
    }).filter(Boolean);
    const dedup = new Map();
    for (const s of situations) if (!dedup.has(s.name) || dedup.get(s.name).score < s.score) dedup.set(s.name, s);
    const final = [...dedup.values()].sort((a,b) => b.score-a.score).slice(0, 30);
    const c = {high:0,normal:0,low:0}; final.forEach(s => { c[s.confidence]=(c[s.confidence]||0)+1; });
    console.log(`[discovery] ${final.length} situations — ${c.high} high, ${c.normal} normal, ${c.low} low`);
    return final;
}

module.exports = {
    GEO_THEMES, buildGeoQuery, parseGeoResponse, buildDocQuery, parseDocResponse,
    discoverSituations, clusterEvents, haversineKm, classifyStatus, classifyNoise,
    filterNoiseEvents, assessConfidence, extractCountries, findNearest,
};
