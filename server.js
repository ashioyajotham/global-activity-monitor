/**
 * server.js — Global Activity Monitor Backend
 * v4.1: Better error logging, fixed GDELT queries, concurrent RSS fetching.
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
    try { res.json({ escalations: db.getEscalationHistory(Math.min(parseInt(req.query.limit) || 50, 200)) }); }
    catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/stats', (_, res) => {
    try { res.json(db.getStats()); } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════
// GDELT FETCHERS — with diagnostic error logging
// ═══════════════════════════════════════════════════════

/**
 * Extract the real error message from Node.js fetch failures.
 * On Windows, errors nest: TypeError("fetch failed") → cause → cause → actual error
 */
function unwrapFetchError(e) {
    // Walk the cause chain to find the real error
    let current = e;
    const parts = [];
    let depth = 0;
    while (current && depth < 5) {
        if (current.code) parts.push(`code=${current.code}`);
        if (current.message && current.message !== 'fetch failed') parts.push(current.message);
        if (current.syscall) parts.push(`syscall=${current.syscall}`);
        if (current.hostname) parts.push(`host=${current.hostname}`);
        current = current.cause;
        depth++;
    }
    return parts.length > 0 ? parts.join(' | ') : (e.message || 'unknown error');
}

async function fetchWithTimeout(url, ms = 20000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
        const res = await fetch(url, {
            signal: ctrl.signal,
            headers: { 'User-Agent': 'GlobalActivityMonitor/4.1' },
        });
        clearTimeout(timer);
        return res;
    } catch (e) {
        clearTimeout(timer);
        if (e.name === 'AbortError') throw new Error(`timeout after ${ms}ms`);
        throw new Error(unwrapFetchError(e));
    }
}

async function fetchGeoForTheme(themeGroup, logUrl = false) {
    const url = buildGeoQuery(themeGroup.geoQuery);
    if (logUrl) console.log(`[gdelt-geo] Testing URL: ${url}`);
    try {
        const res = await fetchWithTimeout(url);
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
        }
        const text = await res.text();
        if (!text.trim().startsWith('{') && !text.trim().startsWith('[')) {
            throw new Error(`Non-JSON: "${text.slice(0, 120)}..."`);
        }
        const events = parseGeoResponse(JSON.parse(text), themeGroup);
        console.log(`[gdelt-geo] ${themeGroup.id}: ${events.length} events`);
        return events;
    } catch (e) {
        console.error(`[gdelt-geo] ${themeGroup.id}: ${e.message}`);
        return [];
    }
}

async function fetchDocForTheme(themeGroup, logUrl = false) {
    const url = buildDocQuery(themeGroup.docQuery);
    if (logUrl) console.log(`[gdelt-doc] Testing URL: ${url}`);
    try {
        const res = await fetchWithTimeout(url);
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
        }
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
 * Sequential with delays to respect GDELT rate limits.
 *
 * Rate budget: ~12 calls per cycle
 *   7 GEO queries + up to 5 DOC queries
 *   2s delay between each = ~24s total when all succeed
 */
async function fetchAllGeoEvents() {
    console.log(`[gdelt] Scanning ${THEME_GROUPS.length} theme groups (GEO + DOC)...`);
    const start = Date.now();
    const allEvents = [];
    let geoOk = 0, geoFail = 0, docOk = 0, docFail = 0;

    // Sort by weight (highest severity first)
    const sorted = [...THEME_GROUPS].sort((a, b) => b.weight - a.weight);

    for (let i = 0; i < sorted.length; i++) {
        const tg = sorted[i];
        const isFirst = (i === 0);

        // GEO query for every theme group
        const geoEvents = await fetchGeoForTheme(tg, isFirst);
        if (geoEvents.length > 0) geoOk++; else geoFail++;
        allEvents.push(...geoEvents);

        // Small delay between calls
        await delay(2000);

        // DOC query for top 5 themes (rate budget)
        if (i < 5) {
            const docEvents = await fetchDocForTheme(tg, isFirst);
            if (docEvents.length > 0) docOk++; else docFail++;
            allEvents.push(...docEvents);
            await delay(2000);
        }
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[gdelt] Done in ${elapsed}s: ${allEvents.length} events (GEO: ${geoOk}ok/${geoFail}fail, DOC: ${docOk}ok/${docFail}fail)`);

    if (allEvents.length === 0 && geoFail === sorted.length) {
        console.error('[gdelt] ⚠ ALL queries failed — check network or GDELT API status');
    }

    return allEvents;
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══════════════════════════════════════════════════════
// NEWS → EVENTS
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
                _isGdelt: false, _severity: null, _category: null, _weight: 1.0,
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
        if (all.length === 0) {
            console.log('[discovery] No events available — skipping cycle');
            return cachedActivities;
        }

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
                for (const s of situations) if (s.topArticles?.length) db.storeArticles(s.topArticles, s.name);
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
        console.log('  GLOBAL ACTIVITY MONITOR v4.2');
        console.log('═══════════════════════════════════════════');
        console.log(`  http://localhost:${PORT}`);
        console.log(`  Auth: ${AUTH_PASSWORD ? 'ON' : 'OFF'}`);
        console.log(`  Theme groups: ${THEME_GROUPS.length}`);
        console.log(`  RSS feeds: ${require('./feeds').FEEDS.length}`);
        console.log(`  DB snapshots: ${db.getSnapshotCount()}`);
        console.log('═══════════════════════════════════════════');
    });

    // Cron schedules
    cron.schedule('*/10 * * * *', runDiscovery);
    cron.schedule('*/5 * * * *', refreshNews);
    cron.schedule('0 3 * * *', () => db.cleanup(30));

    // Initial fetch
    console.log('[startup] Fetching RSS feeds...');
    await refreshNews();
    // Diagnostic: test GDELT connectivity before first discovery cycle
    console.log('[startup] Testing GDELT API connectivity...');
    await testGdeltConnectivity();

    console.log('[startup] Running GDELT discovery...');
    await runDiscovery();
    console.log('[startup] Ready');
}

/**
 * Startup diagnostic: test a simple known-working GDELT query.
 * This helps isolate network vs. query format issues.
 */
async function testGdeltConnectivity() {
    const testUrls = [
        {
            name: 'GEO simple',
            url: 'https://api.gdeltproject.org/api/v2/geo/geo?query=conflict&mode=PointData&format=GeoJSON',
        },
        {
            name: 'DOC simple',
            url: 'https://api.gdeltproject.org/api/v2/doc/doc?query=conflict&mode=artlist&maxrecords=5&format=json&sort=datedesc',
        },
    ];

    for (const test of testUrls) {
        try {
            console.log(`[diag] ${test.name}: ${test.url}`);
            const res = await fetchWithTimeout(test.url, 25000);
            const body = await res.text();
            console.log(`[diag] ${test.name}: HTTP ${res.status}, ${body.length} bytes, starts with: "${body.slice(0, 80)}"`);
        } catch (e) {
            console.error(`[diag] ${test.name} FAILED: ${e.message}`);
            // Extra: try with http instead of https to test if it's a TLS issue
            try {
                const httpUrl = test.url.replace('https://', 'http://');
                console.log(`[diag] Retrying with HTTP: ${httpUrl}`);
                const res2 = await fetchWithTimeout(httpUrl, 15000);
                console.log(`[diag] HTTP fallback: status ${res2.status}`);
            } catch (e2) {
                console.error(`[diag] HTTP fallback also failed: ${e2.message}`);
            }
        }
    }
}

process.on('SIGINT', () => { console.log('\n[shutdown] Closing...'); db.close(); process.exit(0); });
process.on('SIGTERM', () => { db.close(); process.exit(0); });
start().catch(e => { console.error('[fatal]', e); db.close(); process.exit(1); });
