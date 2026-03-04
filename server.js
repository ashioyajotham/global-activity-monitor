/**
 * server.js — Global Activity Monitor Backend
 * v4: Theme-based GDELT queries. Each event tagged with severity/category
 *     by the theme group that found it — no keyword classification.
 */

const express = require('express');
const { WebSocketServer } = require('ws');
const cron = require('node-cron');
const cors = require('cors');
const path = require('path');
const http = require('http');

const { fetchAllNews } = require('./feeds');
const {
    THEME_GROUPS, buildGeoQuery, buildDocQuery,
    parseGeoResponse, parseDocResponse,
    extractCountries, discoverSituations,
} = require('./discovery');
const db = require('./db');

const PORT = process.env.PORT || 4000;
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || null;
const AUTH_USER = process.env.AUTH_USER || 'monitor';

// ═══════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════

let cachedActivities = [];
let cachedNews = [];
let dataSource = 'bootstrap';
let lastGdeltFetch = null;
let lastNewsFetch = null;
let discoveryCount = 0;
let previousStates = new Map();
const STATUS_RANK = { stable: 0, elevated: 1, critical: 2 };

function detectEscalations(newSituations) {
    const escalations = [];
    for (const sit of newSituations) {
        const prev = previousStates.get(sit.name);
        const newR = STATUS_RANK[sit.status] ?? 0;
        const prevR = prev ? (STATUS_RANK[prev] ?? 0) : -1;
        if (prev && newR > prevR) {
            const esc = { name: sit.name, from: prev, to: sit.status, score: sit.score, type: sit.type, lat: sit.lat, lng: sit.lng, time: new Date().toISOString() };
            escalations.push(esc);
            try { db.storeEscalation(esc); } catch (e) { console.error('[db]', e.message); }
            console.log(`[ESCALATION] ${sit.name}: ${prev} → ${sit.status} (${sit.score})`);
        }
        previousStates.set(sit.name, sit.status);
    }
    return escalations;
}

// ═══════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════

function authMiddleware(req, res, next) {
    if (!AUTH_PASSWORD) return next();
    if (req.path === '/api/health') return next();
    const h = req.headers.authorization;
    if (!h || !h.startsWith('Basic ')) { res.set('WWW-Authenticate', 'Basic realm="Monitor"'); return res.status(401).send('Auth required'); }
    try { const [u, p] = Buffer.from(h.split(' ')[1], 'base64').toString().split(':'); if (u === AUTH_USER && p === AUTH_PASSWORD) return next(); } catch {}
    res.set('WWW-Authenticate', 'Basic realm="Monitor"'); res.status(401).send('Invalid credentials');
}

function authenticateWs(req) {
    if (!AUTH_PASSWORD) return true;
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.searchParams.get('token') === AUTH_PASSWORD) return true;
    const h = req.headers.authorization;
    if (h?.startsWith('Basic ')) { try { const [u, p] = Buffer.from(h.split(' ')[1], 'base64').toString().split(':'); return u === AUTH_USER && p === AUTH_PASSWORD; } catch {} }
    return false;
}

// ═══════════════════════════════════════════════════════
// EXPRESS
// ═══════════════════════════════════════════════════════

const app = express();
app.use(cors());
app.use(authMiddleware);
app.use(express.static(path.join(__dirname)));

app.get('/api/activities', (_, res) => res.json({ activities: cachedActivities, source: dataSource, lastFetch: lastGdeltFetch, count: cachedActivities.length, discoveryCount }));
app.get('/api/news', (_, res) => res.json({ news: cachedNews, lastFetch: lastNewsFetch, count: cachedNews.length }));

app.get('/api/health', (_, res) => {
    let s = {};
    try { s = db.getStats(); } catch (e) { s = { error: e.message }; }
    res.json({ status: 'ok', uptime: process.uptime(), activities: cachedActivities.length, db: s });
});

app.get('/api/trends', (req, res) => {
    try {
        const h = Math.min(parseInt(req.query.hours) || 24, 168);
        const t = db.getAllTrends(h);
        res.json({
            trends: t.map(r => ({
                ...r,
                direction: r.last_score > r.first_score ? 'up' : r.last_score < r.first_score ? 'down' : 'stable',
                delta: Math.round((r.last_score - r.first_score) * 10) / 10,
            })),
            hours: h,
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/trends/:name', (req, res) => {
    try {
        const d = Math.min(parseInt(req.query.days) || 7, 30);
        res.json({ name: req.params.name, trend: db.getScoreTrend(req.params.name, d), escalations: db.getEscalationsForSituation(req.params.name, d) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/escalations', (req, res) => {
    try {
        const l = Math.min(parseInt(req.query.limit) || 50, 200);
        res.json({ escalations: db.getEscalationHistory(l) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/stats', (_, res) => {
    try { res.json(db.getStats()); } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════
// GDELT FETCHERS (theme-based)
// ═══════════════════════════════════════════════════════

async function fetchWithTimeout(url, ms = 20000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
        const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'GlobalActivityMonitor/4.0' } });
        clearTimeout(timer);
        return res;
    } catch (e) { clearTimeout(timer); throw e; }
}

async function fetchGeoForTheme(themeGroup) {
    try {
        const res = await fetchWithTimeout(buildGeoQuery(themeGroup.geoQuery));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        if (!text.startsWith('{')) throw new Error('Non-JSON response');
        const events = parseGeoResponse(JSON.parse(text), themeGroup);
        console.log(`[gdelt-geo] ${themeGroup.id}: ${events.length} events`);
        return events;
    } catch (e) {
        console.error(`[gdelt-geo] ${themeGroup.id}: ${e.message}`);
        return [];
    }
}

async function fetchDocForTheme(themeGroup) {
    try {
        const res = await fetchWithTimeout(buildDocQuery(themeGroup.docQuery));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const articles = parseDocResponse(data, themeGroup);
        console.log(`[gdelt-doc] ${themeGroup.id}: ${articles.length} geolocated`);
        return articles;
    } catch (e) {
        console.error(`[gdelt-doc] ${themeGroup.id}: ${e.message}`);
        return [];
    }
}

/**
 * Fetch events across all theme groups.
 * Each event inherits severity + category from its theme group.
 *
 * Rate budget: ~14 calls per cycle
 *   7 GEO queries (one per theme group)
 *   + up to 5 DOC queries (top severity themes)
 *   Interleaved with 2s delays = ~30s total
 */
async function fetchAllGeoEvents() {
    console.log('[gdelt] Scanning via theme groups (GEO + DOC)...');
    const start = Date.now();
    const allEvents = [];

    // Sort theme groups by weight (fetch highest-severity themes first)
    const sorted = [...THEME_GROUPS].sort((a, b) => b.weight - a.weight);

    for (let i = 0; i < sorted.length; i++) {
        const tg = sorted[i];

        // GEO query for every theme group
        const geoEvents = await fetchGeoForTheme(tg);
        allEvents.push(...geoEvents);
        await delay(2000);

        // DOC query for top 5 (rate budget)
        if (i < 5) {
            const docEvents = await fetchDocForTheme(tg);
            allEvents.push(...docEvents);
            await delay(2000);
        }
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[gdelt] Total: ${allEvents.length} theme-tagged events in ${elapsed}s`);
    return allEvents;
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══════════════════════════════════════════════════════
// NEWS → EVENTS (RSS articles get theme metadata from content matching)
// ═══════════════════════════════════════════════════════

function newsToEvents(newsItems) {
    const events = [];
    for (const item of newsItems) {
        const countries = extractCountries(`${item.title} ${item.snippet || ''}`);
        for (const loc of countries) {
            events.push({
                lat: loc.lat, lng: loc.lng,
                title: item.title, url: item.link, source: item.source,
                snippet: item.snippet || '', tone: item.tone || 0,
                // RSS articles don't have theme tags — they get
                // 'normal' confidence and contribute to description quality
                _isGdelt: false,
                _severity: null,
                _category: null,
                _weight: 1.0,
            });
        }
    }
    return events;
}

// ═══════════════════════════════════════════════════════
// DISCOVERY PIPELINE
// ═══════════════════════════════════════════════════════

async function runDiscovery() {
    try {
        const geoEvents = await fetchAllGeoEvents();
        const newsEvents = newsToEvents(cachedNews);
        console.log(`[discovery] GDELT: ${geoEvents.length}, RSS: ${newsEvents.length}`);

        const all = [...geoEvents, ...newsEvents];
        console.log(`[discovery] Total to cluster: ${all.length}`);

        const situations = discoverSituations(all);
        console.log(`[discovery] Result: ${situations.length} situations`);

        if (situations.length > 0) {
            const escalations = detectEscalations(situations);
            cachedActivities = situations;
            dataSource = 'live';
            lastGdeltFetch = new Date().toISOString();
            discoveryCount++;

            try {
                db.storeSituations(situations);
                for (const s of situations) {
                    if (s.topArticles?.length) db.storeArticles(s.topArticles, s.name);
                }
                console.log(`[db] Cycle #${discoveryCount}: ${situations.length} stored`);
            } catch (e) { console.error('[db]', e.message); }

            broadcast({ type: 'activities_update', activities: cachedActivities });
            if (escalations.length > 0) broadcast({ type: 'escalation', escalations });
        }
        return situations;
    } catch (e) {
        console.error('[discovery] Error:', e.message);
        return cachedActivities;
    }
}

async function refreshNews() {
    try {
        const items = await fetchAllNews();
        if (items.length > 0) {
            const oldTitles = new Set(cachedNews.map(n => n.title));
            const newItems = items.filter(n => !oldTitles.has(n.title));
            cachedNews = items.slice(0, 100);
            lastNewsFetch = new Date().toISOString();
            if (newItems.length > 0) {
                console.log(`[news] ${newItems.length} new items`);
                broadcast({ type: 'news_update', items: newItems.slice(0, 15) });
            }
        }
    } catch (e) { console.error('[news]', e.message); }
}

// ═══════════════════════════════════════════════════════
// WEBSOCKET + STARTUP
// ═══════════════════════════════════════════════════════

let wss;
function broadcast(data) {
    if (!wss) return;
    const payload = JSON.stringify(data);
    wss.clients.forEach(c => { if (c.readyState === 1) c.send(payload); });
}

async function start() {
    db.init();
    try {
        previousStates = db.recoverPreviousStates();
        console.log(`[db] Recovered ${previousStates.size} previous states`);
    } catch {}

    const server = http.createServer(app);
    wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (req, socket, head) => {
        if (!authenticateWs(req)) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
        wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
    });

    wss.on('connection', ws => {
        console.log('[ws] Client connected');
        ws.send(JSON.stringify({ type: 'init', activities: cachedActivities, news: cachedNews.slice(0, 30) }));
        ws.on('close', () => console.log('[ws] Client disconnected'));
    });

    server.listen(PORT, () => {
        console.log('═══════════════════════════════════════════');
        console.log('  GLOBAL ACTIVITY MONITOR v4');
        console.log('═══════════════════════════════════════════');
        console.log(`  http://localhost:${PORT}`);
        console.log(`  Auth: ${AUTH_PASSWORD ? 'ON' : 'OFF'}`);
        console.log(`  Theme groups: ${THEME_GROUPS.length}`);
        console.log(`  DB snapshots: ${db.getSnapshotCount()}`);
        console.log('═══════════════════════════════════════════');
    });

    // Cron schedules
    cron.schedule('*/10 * * * *', runDiscovery);
    cron.schedule('*/5 * * * *', refreshNews);
    cron.schedule('0 3 * * *', () => db.cleanup(30));

    // Initial fetch
    await refreshNews();
    await runDiscovery();
}

process.on('SIGINT', () => { console.log('\n[shutdown] Closing...'); db.close(); process.exit(0); });
process.on('SIGTERM', () => { db.close(); process.exit(0); });
start().catch(e => { console.error('[fatal]', e); db.close(); process.exit(1); });
