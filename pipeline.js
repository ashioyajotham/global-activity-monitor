'use strict';
const { createHash } = require('node:crypto');
const { extractCountries } = require('./countries-data');
const VERSION = 'evidence-v1';
const WINDOW_MS = 24 * 60 * 60 * 1000;
const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 24);
const clean = value => String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const tokens = text => clean(text).toLowerCase().match(/[a-z0-9]+/g) || [];
function canonicalUrl(value) {
    try {
        const url = new URL(value);
        if (!['https:', 'http:'].includes(url.protocol)) return '';
        url.hash = '';
        for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
        url.searchParams.sort();
        return url.href;
    } catch { return ''; }
}
function validDate(value) {
    if (!value) return null;
    // GDELT seendate is discovery time, not necessarily publication time.
    const time = Date.parse(value);
    return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
function similarity(a, b) {
    const stop = new Set(['the','a','an','in','on','of','to','and','for','with','at','as','by','is','after','says']);
    const x = new Set(tokens(a).filter(w => !stop.has(w))), y = new Set(tokens(b).filter(w => !stop.has(w)));
    const overlap = [...x].filter(w => y.has(w)).length;
    return x.size && y.size ? overlap / Math.sqrt(x.size * y.size) : 0;
}
function publisherGroup(host) {
    const aliases = { 'bbc.co.uk':'bbc', 'bbc.com':'bbc', 'apnews.com':'associatedpress', 'ap.org':'associatedpress' };
    for (const [domain, group] of Object.entries(aliases)) if (host === domain || host.endsWith('.'+domain)) return group;
    const parts=host.split('.');
    const suffix=parts.slice(-2).join('.');
    const compound=new Set(['co.uk','com.au','co.za','co.ke','co.in','com.br','com.cn','co.jp','co.nz']);
    return parts.slice(compound.has(suffix)?-3:-2).join('.');
}
function extractEventFrame(title, snippet, countries) {
    const text = `${title}. ${snippet}`;
    const action = text.match(/\b(attacks?|attacked|strikes?|struck|invades?|invaded|bomb(?:ed|ing)?|shell(?:ed|ing)?|airstrikes?|clashes?|fights?|killed|kill|deaths?|casualties|evacuat\w*|flood(?:s|ing)?|earthquake|wildfire|famine|protests?|riots?|sanctions?)\b/i);
    const impact = text.match(/\b(\d{1,6}|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:people\s+)?(?:killed|dead|deaths?|injured|wounded|missing|displaced|evacuated)\b/i)
        || text.match(/\b(?:kill|kills|killed)\s+(\d{1,6}|one|two|three|four|five|six|seven|eight|nine|ten)\b/i)
        || text.match(/\b(mass casualties|mass displacement|widespread devastation|mass evacuation|state of emergency|humanitarian catastrophe)\b/i);
    const explicit = text.match(/\b(?:in|near|around|from|across)\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,2})/);
    let locationCode = null;
    const target = text.match(/\b(?:attacks?|strikes?|invades?|invaded|bombs?|shells?)\s+(?:on\s+)?([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,2})/i);
    if (target) {
        const match = extractCountries(target[1])[0];
        if (match) locationCode = match.code;
    }
    if (explicit) {
        const match = extractCountries(explicit[1])[0];
        if (match) locationCode = match.code;
    }
    if (!locationCode && countries.length === 1) locationCode = countries[0].code;
    // For a two-country action headline, the second country is the reported target
    // unless an explicit location phrase gives a better answer.
    if (!locationCode && countries.length >= 2 && /\b(attacks?|strikes?|invades?|bomb|shell|clashes?|killed|casualties)\b/i.test(text)) {
        locationCode = countries.at(-1).code;
    }
    return {
        action: action?.[0]?.toLowerCase() || null,
        impact: impact?.[0] || null,
        locationCode,
        evidence: [action?.[0], impact?.[0]].filter(Boolean),
    };
}
function normalizeArticle(raw, now = new Date().toISOString()) {
    const title = clean(raw.title || raw.name), snippet = clean(raw.snippet);
    const url = canonicalUrl(raw.url || raw.link);
    let publisher = 'unknown';
    if (url) publisher = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    const countries = extractCountries(`${title} ${snippet}`);
    const frame = extractEventFrame(title, snippet, countries);
    const candidate = countries.find(c => c.code === frame.locationCode) || null;
    // A mention is a location candidate, not a verified incident location.
    const specific = candidate && candidate.specificity > 1;
    const validCoords = Number.isFinite(raw.lat) && Number.isFinite(raw.lng) && Math.abs(raw.lat) <= 90 && Math.abs(raw.lng) <= 180;
    return {
        id: hash(url || `${publisher}:${title.toLowerCase()}`), url, title, snippet, publisher,
        source: raw.source || publisher, language: raw.language || (raw._isDoc ? 'unknown' : 'English'),
        publishedAt: validDate(raw.publishedAt || raw.pubDate), observedAt: validDate(raw.observedAt) || now,
        ingestedAt: now, provenance: [raw._isGdelt ? 'gdelt-geo' : raw._isDoc ? 'gdelt-doc' : 'rss'],
        retrievalThemes: raw._themeId ? [raw._themeId] : [],
        geoOnly: !!raw._isGdelt, countries: countries.map(c => c.code).sort(),
        eventFrame: frame,
        location: candidate ? {
            country: candidate.code, name: specific ? candidate.matchedTerm : candidate.name,
            lat: specific && raw._geocoded && validCoords ? raw.lat : candidate.lat,
            lng: specific && raw._geocoded && validCoords ? raw.lng : candidate.lng,
            precision: specific && raw._geocoded && validCoords ? 'place-candidate' : 'country-approximate',
        } : null,
    };
}
const patterns = {
    sports: /\b(football|soccer|world cup|champions league|premier league|cricket|rugby|tennis|basketball|olympic|olympics|tournament|goalkeeper|hat.trick|playoffs)\b/i,
    entertainment: /\b(box office|celebrity|album|movie review|film review|horoscope|video game|esports|grammy|oscars?)\b/i,
    historical: /\b(anniversary|commemorat\w*|on this day|in (?:19\d\d|20[01]\d)|history of|historical|decades ago)\b/i,
    opinion: /\b(opinion|editorial|could|might|hypothetical|simulation|exercise|film|novel)\b/i,
};
const RULES = [
    ['Armed Conflict', 8, /\b(attacks?|strikes?|invades?|invaded|bombed|shell(?:ed|ing)?)\b[^.!?]{0,70}\b(?:\d{1,6}|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:people\s+)?(?:killed|dead|deaths?|injured|wounded)\b/i],
    ['Armed Conflict', 8, /\b(attacks?|strikes?|invades?|invaded|bombed|shell(?:ed|ing)?)\b[^.!?]{0,70}\b(?:kill|kills|killed)\s+(?:\d{1,6}|one|two|three|four|five|six|seven|eight|nine|ten)\b/i],
    ['Armed Conflict', 8, /\b(\d{1,6})\s+(?:people\s+)?(?:killed|dead|deaths?|injured|wounded)\b[^.!?]{0,70}\b(attacks?|strikes?|invades?|invaded|bombed|shell(?:ed|ing)?)\b/i],
    ['Humanitarian Crisis', 8, /\b(famine (?:declared|confirmed)|widespread starvation|mass displacement|humanitarian catastrophe)\b/i],
    ['Armed Conflict', 8, /\b(full.scale invasion|sustained (?:airstrikes|shelling|bombardment)|massacre|mass casualties)\b/i],
    ['Disaster', 8, /\b(catastrophic (?:flooding|earthquake|wildfire)|widespread devastation)\b/i],
    ['Armed Conflict', 5, /\b(attack(?:s|ed)?|airstrikes?|shelling|bombing|armed clashes|gunfire|missile (?:attack|strike)|troops (?:invade|invaded)|bomb (?:attack|explodes|exploded))\b/i],
    ['Disaster', 5, /\b(earthquake|tsunami|wildfire|flooding|floods?|mass evacuation|state of emergency)\b/i],
    ['Humanitarian Crisis', 5, /\b(refugees?|displaced|displacement|famine|humanitarian (?:crisis|emergency))\b/i],
    ['Civil Unrest', 5, /\b(violent (?:protests|clashes)|riots?|military coup|coup attempt)\b/i],
    ['Military Operations', 2, /\b(troops deployed|military deployment|military operation|missile test|nuclear weapon|uranium enrichment)\b/i],
    ['Civil Unrest', 2, /\b(protests?|protesters|demonstrations?|general strike)\b/i],
    ['Diplomacy', 2, /\b(sanctions|embargo|ceasefire|peace talks|diplomatic|treaty|ambassador)\b/i],
];
function classify(article) {
    const text = `${article.title}. ${article.snippet}`;
    const result = { relevance: 'uncertain', category: null, score: null, evidence: [], reasons: [], version: VERSION };
    if (article.geoOnly) return { ...result, reasons: ['location-mention-only'] };
    if (!/^(english|en)$/i.test(article.language)) return { ...result, reasons: ['unsupported-language'] };
    if (patterns.historical.test(text) || patterns.opinion.test(text)) return { ...result, reasons: ['historical-hypothetical-or-opinion'] };
    const negated = /\b(no|not|without|denied|denies|averted|false)\b[^.!?]{0,55}\b(casualties|killed|attack|airstrike|bombing|shelling|invasion|massacre|famine|earthquake|emergency)\b/i.test(text);
    const matches = RULES.map(([category, score, re]) => ({ category, score, match: text.match(re) })).filter(r => r.match);
    const literalEmergency = /\b(killed|injured|evacuat\w*|bomb (?:exploded|explodes)|gunfire|police fired|state of emergency)\b/i.test(text);
    const civicContext = /\b(protest(?:s|ers)? (?:against|over)|boycott (?:over|against)|sanctions|diplomatic)\b/i.test(text);
    if ((patterns.sports.test(text) || patterns.entertainment.test(text)) && !literalEmergency && !civicContext) {
        return { ...result, relevance: 'irrelevant', reasons: ['routine-sports-or-entertainment'] };
    }
    if (!matches.length || negated) return { ...result, reasons: [negated ? 'negated-or-disputed-impact' : 'insufficient-event-context'] };
    const best = matches[0];
    if (best.category === 'Armed Conflict' && /\b(gunfire|bomb (?:exploded|explodes))\b/i.test(best.match[0]) &&
        !/\b(military|troops|army|insurgent|terrorist|stadium|mass casualties|mass evacuation)\b/i.test(text)) {
        return { ...result, reasons: ['violence-without-geopolitical-or-major-crisis-context'] };
    }
    if (best.category === 'Disaster' && best.score === 5 &&
        !/\b(evacuat\w*|state of emergency|killed|deaths?|injured|destroyed|displaced|emergency shelters|thousands|millions)\b/i.test(text)) {
        return { ...result, category:'Disaster', reasons:['impact-not-established'] };
    }
    const at = best.match.index;
    return { ...result, relevance: 'relevant', category: best.category, score: best.score,
        evidence: [{ text: text.slice(Math.max(0, at - 65), at + best.match[0].length + 100), matched: best.match[0] }],
        reasons: ['explicit-reported-event', 'provisional-rubric'],
    };
}
function deduplicate(raw, now) {
    const map = new Map();
    for (const item of raw) {
        const article = normalizeArticle(item, now);
        if (!article.title) continue;
        const old = map.get(article.id);
        if (!old) { map.set(article.id, article); continue; }
        const preferred = old.geoOnly && !article.geoOnly ? article : old;
        map.set(article.id, { ...preferred, publishedAt: old.publishedAt || article.publishedAt,
            provenance: [...new Set([...old.provenance, ...article.provenance])],
            retrievalThemes: [...new Set([...old.retrievalThemes, ...article.retrievalThemes])] });
    }
    const articles = [...map.values()].sort((a,b) => a.id.localeCompare(b.id));
    for (let i = 0; i < articles.length; i++) {
        const a = articles[i];
        const duplicate = articles.slice(0, i).find(b => similarity(a.title, b.title) >= 0.88);
        a.storyId = duplicate ? duplicate.storyId : a.id;
        const wire = `${a.title} ${a.snippet}`.match(/\b(Reuters|Associated Press|Agence France.Presse)\b/i);
        a.origin = wire ? wire[1].toLowerCase().replace(/\W/g, '') : publisherGroup(a.publisher);
    }
    return articles;
}
function fresh(article, now) {
    const age = Date.parse(now) - Date.parse(article.publishedAt);
    return Number.isFinite(age) && age >= -5 * 60000 && age <= WINDOW_MS;
}
function compatible(a, b) {
    return a.classification.category === b.classification.category &&
        a.location?.country === b.location?.country && !!a.location &&
        // Distinct named locations must not collapse to a capital's coordinates.
        (a.location.name === b.location.name) &&
        (similarity(a.title, b.title) >= 0.55 ||
            (a.eventFrame?.impact && b.eventFrame?.impact && a.classification.category === 'Armed Conflict'));
}
function buildSituations(articles, previous, now) {
    const groups = [];
    for (const a of articles.filter(a => a.classification.relevance !== 'irrelevant')) {
        if (a.publishedAt && !fresh(a, now)) continue;
        if (a.geoOnly) continue; // available in review; cannot independently establish a situation
        const group = groups.find(g => g.every(b => compatible(a, b)));
        if (group) group.push(a); else groups.push([a]);
    }
    const used = new Set();
    const situations = groups.map(group => {
        const ids = group.map(a => a.id);
        const representative = group[0];
        const candidates = previous.map(p => ({ p, overlap: (p.articleIds || []).filter(id => ids.includes(id)).length }))
            .filter(x => x.overlap || (x.p.type === representative.classification.category && x.p.locationKey === locationKey(representative) && similarity(x.p.headline || '', representative.title) >= 0.65))
            .sort((a,b) => b.overlap - a.overlap || a.p.id.localeCompare(b.p.id));
        const match = candidates.find(x => !used.has(x.p.id));
        const id = match ? match.p.id : `sit-${hash(ids.join('|'))}`;
        used.add(id);
        const eligible = group.filter(a => fresh(a, now) && a.classification.relevance === 'relevant');
        // Syndication and common wire attribution count once, even across domains.
        const independent = [];
        for (const a of eligible) if (a.origin !== 'unknown' && !independent.some(b => a.origin === b.origin || a.storyId === b.storyId)) independent.push(a);
        const proposed = Math.max(0, ...eligible.map(a => a.classification.score || 0));
        const supporting = independent.filter(a => a.classification.score >= proposed);
        const confirmed = proposed > 0 && supporting.length >= 2 && !!representative.location;
        const score = proposed || null;
        const evidenceState = confirmed ? 'confirmed' : 'developing';
        return { id, name: `${representative.location?.name || 'Location uncertain'} · ${representative.classification.category || 'Unclassified report'}`,
            headline: representative.title, lat: representative.location?.lat ?? null, lng: representative.location?.lng ?? null,
            locationKey: locationKey(representative), locationPrecision: representative.location?.precision || 'unknown',
            score, status: !confirmed ? 'developing' : score >= 8 ? 'critical' : score >= 5 ? 'elevated' : 'stable',
            type: representative.classification.category || 'Unclassified', evidenceState, confidence: confirmed ? 'corroborated' : 'unconfirmed',
            sourceDiversity: independent.length, articleCount: new Set(group.map(a => a.storyId)).size,
            articleIds: ids, evidenceIds: supporting.map(a => a.id).sort(),
            description: representative.title, parties: [], region: representative.location?.name || 'Unknown',
            topArticles: group.map(a => ({ id: a.id, title: a.title, url: a.url, source: a.publisher, publishedAt: a.publishedAt,
                classification: a.classification, provenance: a.provenance })),
            explanation: { rubric: VERSION, provisional: true, reasons: confirmed ? ['two-distinct-reporting-origins'] : ['insufficient-independent-current-evidence'],
                evidence: group.flatMap(a => a.classification.evidence.map(e => ({ ...e, articleId: a.id, url: a.url }))) },
            newestEvidenceAt: eligible.map(a => a.publishedAt).sort().at(-1) || null,
            lastChecked: now, pipelineVersion: VERSION,
            lineage: candidates.filter(x => x.p.id !== id).map(x => ({ id: x.p.id, relation: used.has(x.p.id) ? 'related-or-split' : 'merged-from' })),
        };
    });
    return situations.sort((a,b) => (b.evidenceState === 'confirmed') - (a.evidenceState === 'confirmed') || (b.score || 0) - (a.score || 0) || a.id.localeCompare(b.id));
}
function locationKey(a) { return a.location ? `${a.location.country}:${a.location.name}` : null; }
function runPipeline(raw, { previous = [], now = new Date().toISOString(), model = null } = {}) {
    const articles = deduplicate(raw, now);
    articles.forEach(a => {
        a.classification = classify(a);
        if (model && !a.geoOnly && /^(en|english)$/i.test(a.language)) {
            const prediction = require('./model').predict(model, `${a.title}. ${a.snippet}`);
            a.modelPrediction = prediction;
            // A relevance model cannot invent event context, location, or severity.
            if (a.classification.relevance === 'relevant' && prediction.relevance !== 'relevant') {
                a.classification = { ...a.classification, relevance: prediction.relevance, score: null,
                    reasons: [...a.classification.reasons, 'model-relevance-gate'], modelHash: model.hash };
            }
        }
    });
    return { articles, situations: buildSituations(articles, previous, now), pipelineVersion: VERSION };
}
function advanceAlerts(situations, state = {}, { successful = true, now = new Date().toISOString() } = {}) {
    const next = structuredClone(state), alerts = [];
    if (!successful) { for (const s of Object.values(next)) { s.pending = null; s.streak = 0; } return { state: next, alerts }; }
    const active = new Set(situations.map(s => s.id));
    for (const [id, s] of Object.entries(next)) if (!active.has(id)) { s.pending = null; s.streak = 0; }
    for (const s of situations) {
        const old = next[s.id];
        if (!old || old.version !== VERSION) {
            next[s.id] = { version: VERSION, baseline: s.evidenceState === 'confirmed' ? s.score : 0, pending: null, streak: 0, seen: s.evidenceIds, alerted: [] };
            continue; // startup/bootstrap establishes a baseline, not an escalation
        }
        if (s.evidenceState !== 'confirmed') { old.pending = null; old.streak = 0; continue; }
        if (s.score <= old.baseline) { old.pending = null; old.streak = 0; continue; }
        if (old.pending !== s.score) { old.pending = s.score; old.streak = 0; old.novel = s.evidenceIds.some(id => !old.seen.includes(id)); }
        old.novel ||= s.evidenceIds.some(id => !old.seen.includes(id));
        old.streak++;
        if (old.streak >= 2 && old.novel && !old.alerted.includes(s.score)) {
            alerts.push({ id: `alert-${hash(`${s.id}:${VERSION}:${s.score}`)}`, situationId: s.id, name: s.name,
                from: old.baseline >= 8 ? 'critical' : old.baseline >= 5 ? 'elevated' : old.baseline ? 'stable' : 'developing',
                to: s.status, score: s.score, type: s.type, time: now, evidenceIds: s.evidenceIds, pipelineVersion: VERSION });
            old.alerted.push(s.score); old.baseline = s.score; old.seen = [...new Set([...old.seen, ...s.evidenceIds])]; old.pending = null; old.streak = 0;
        }
    }
    return { state: next, alerts };
}
module.exports = { VERSION, WINDOW_MS, canonicalUrl, validDate, normalizeArticle, classify, similarity, deduplicate, fresh, runPipeline, advanceAlerts };
