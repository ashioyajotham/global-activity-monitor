/**
 * server.js — Global Activity Monitor Backend
 * 
 * Autonomous discovery: no hardcoded regions.
 * Uses GDELT GEO 2.0 for broad event scanning and RSS
 * feeds for headline-based location extraction.
 */

const express = require('express');
const { WebSocketServer } = require('ws');
const cron = require('node-cron');
const cors = require('cors');
const path = require('path');
const http = require('http');

const { fetchAllNews } = require('./feeds');
const {
    GEO_THEMES,
    buildGeoQuery,
    parseGeoResponse,
    extractLocations,
    discoverSituations,
} = require('./discovery');

// ═══════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════
const PORT = process.env.PORT || 4000;
const GDELT_FETCH_INTERVAL = '*/10 * * * *'; // every 10 minutes
const NEWS_FETCH_INTERVAL = '*/5 * * * *';   // every 5 minutes

// ═══════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════
let cachedActivities = [];
let cachedNews = [];
let dataSource = 'bootstrap';
let lastGdeltFetch = null;
let lastNewsFetch = null;

// Escalation tracking: map situation name → previous status
const previousStates = new Map();
const STATUS_RANK = { stable: 0, elevated: 1, critical: 2 };

/**
 * Compare new situations against previous states.
 * Returns array of escalation events.
 */
function detectEscalations(newSituations) {
    const escalations = [];

    for (const sit of newSituations) {
        const prevStatus = previousStates.get(sit.name);
        const newRank = STATUS_RANK[sit.status] ?? 0;
        const prevRank = prevStatus ? (STATUS_RANK[prevStatus] ?? 0) : -1;

        if (prevStatus && newRank > prevRank) {
            escalations.push({
                name: sit.name,
                from: prevStatus,
                to: sit.status,
                score: sit.score,
                type: sit.type,
                lat: sit.lat,
                lng: sit.lng,
                time: new Date().toISOString(),
            });
            console.log(`[ESCALATION] ${sit.name}: ${prevStatus} → ${sit.status} (score: ${sit.score})`);
        }

        previousStates.set(sit.name, sit.status);
    }

    return escalations;
}

// ═══════════════════════════════════════════════════════
// EXPRESS APP
// ═══════════════════════════════════════════════════════
const app = express();
app.use(cors());

// Serve frontend
app.use(express.static(path.join(__dirname)));

// ── REST API ──

app.get('/api/activities', (req, res) => {
    res.json({
        activities: cachedActivities,
        source: dataSource,
        lastFetch: lastGdeltFetch,
        count: cachedActivities.length,
    });
});

app.get('/api/news', (req, res) => {
    res.json({
        news: cachedNews,
        lastFetch: lastNewsFetch,
        count: cachedNews.length,
    });
});

app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        activities: cachedActivities.length,
        news: cachedNews.length,
        dataSource,
    });
});

// ═══════════════════════════════════════════════════════
// GDELT GEO FETCHER
// ═══════════════════════════════════════════════════════

/**
 * Fetch geolocated events from GDELT GEO 2.0 for one theme.
 */
async function fetchGeoTheme(theme) {
    const url = buildGeoQuery(theme.query);

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);

        const response = await fetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': 'GlobalActivityMonitor/2.0' },
        });
        clearTimeout(timeout);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const contentType = response.headers.get('content-type') || '';
        const text = await response.text();

        // GDELT sometimes returns HTML errors
        if (!contentType.includes('json') && !text.startsWith('{')) {
            throw new Error('Non-JSON response from GDELT');
        }

        const data = JSON.parse(text);
        const events = parseGeoResponse(data);
        console.log(`[gdelt-geo] ${theme.label}: ${events.length} events`);
        return events;
    } catch (err) {
        console.error(`[gdelt-geo] Error for ${theme.label}:`, err.message);
        return [];
    }
}

/**
 * Fetch all GDELT GEO themes and merge events.
 */
async function fetchAllGeoEvents() {
    console.log('[gdelt-geo] Scanning global events across all themes...');
    const startTime = Date.now();
    const allEvents = [];

    // Fetch themes sequentially with delays (GDELT rate limits)
    for (let i = 0; i < GEO_THEMES.length; i++) {
        const events = await fetchGeoTheme(GEO_THEMES[i]);
        allEvents.push(...events);

        // 2s delay between theme queries
        if (i < GEO_THEMES.length - 1) {
            await new Promise(r => setTimeout(r, 2000));
        }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[gdelt-geo] Total: ${allEvents.length} raw events in ${elapsed}s`);
    return allEvents;
}

// ═══════════════════════════════════════════════════════
// NEWS → EVENTS CONVERTER
// ═══════════════════════════════════════════════════════

/**
 * Convert news items to geolocated events using the gazetteer.
 * Each headline is scanned for country mentions and assigned coordinates.
 */
function newsToEvents(newsItems) {
    const events = [];

    for (const item of newsItems) {
        const text = `${item.title} ${item.snippet || ''}`;
        const locations = extractLocations(text);

        for (const loc of locations) {
            events.push({
                lat: loc.lat,
                lng: loc.lng,
                title: item.title,
                url: item.link,
                source: item.source,
                snippet: item.snippet || '',
                tone: item.tone || 0,
            });
        }
    }

    return events;
}

// ═══════════════════════════════════════════════════════
// MAIN DISCOVERY PIPELINE
// ═══════════════════════════════════════════════════════

/**
 * Run the full discovery pipeline:
 * 1. Fetch GDELT GEO events (broad thematic scan)
 * 2. Convert RSS news to geolocated events
 * 3. Merge all events
 * 4. Cluster → score → classify
 */
async function runDiscovery() {
    try {
        // 1. GDELT GEO events
        const geoEvents = await fetchAllGeoEvents();

        // 2. RSS → events
        const newsEvents = newsToEvents(cachedNews);
        console.log(`[discovery] News-derived events: ${newsEvents.length}`);

        // 3. Merge
        const allEvents = [...geoEvents, ...newsEvents];
        console.log(`[discovery] Total events to cluster: ${allEvents.length}`);

        // 4. Discover situations
        const situations = discoverSituations(allEvents);
        console.log(`[discovery] Discovered ${situations.length} active situations`);

        if (situations.length > 0) {
            // Detect escalations before overwriting cache
            const escalations = detectEscalations(situations);

            cachedActivities = situations;
            dataSource = 'live';
            lastGdeltFetch = new Date().toISOString();

            // Push to WebSocket clients
            broadcast({
                type: 'activities_update',
                activities: cachedActivities,
            });

            // Push escalation alerts
            if (escalations.length > 0) {
                broadcast({
                    type: 'escalation',
                    escalations,
                });
            }
        }

        return situations;
    } catch (err) {
        console.error('[discovery] Pipeline error:', err.message);
        return cachedActivities;
    }
}

// ═══════════════════════════════════════════════════════
// NEWS FETCHER
// ═══════════════════════════════════════════════════════

async function refreshNews() {
    try {
        const items = await fetchAllNews();
        const newCount = items.length - cachedNews.length;

        if (items.length > 0) {
            // Find truly new items
            const oldTitles = new Set(cachedNews.map(n => n.title));
            const newItems = items.filter(n => !oldTitles.has(n.title));

            cachedNews = items.slice(0, 100); // cap at 100
            lastNewsFetch = new Date().toISOString();

            if (newItems.length > 0) {
                console.log(`[news] ${newItems.length} new items`);
                broadcast({
                    type: 'news_update',
                    items: newItems.slice(0, 15),
                });
            }
        }

        console.log(`[update] News cache: ${cachedNews.length} items`);
    } catch (err) {
        console.error('[news] Refresh error:', err.message);
    }
}

// ═══════════════════════════════════════════════════════
// WEBSOCKET
// ═══════════════════════════════════════════════════════
let wss;

function broadcast(data) {
    if (!wss) return;
    const payload = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === 1) { // OPEN
            client.send(payload);
        }
    });
}

// ═══════════════════════════════════════════════════════
// SERVER STARTUP
// ═══════════════════════════════════════════════════════

async function start() {
    const server = http.createServer(app);

    // WebSocket
    wss = new WebSocketServer({ server, path: '/ws' });

    wss.on('connection', (socket) => {
        console.log('[ws] Client connected');

        // Send current state
        socket.send(JSON.stringify({
            type: 'init',
            activities: cachedActivities,
            news: cachedNews.slice(0, 30),
        }));

        socket.on('close', () => console.log('[ws] Client disconnected'));
    });

    // Start listening
    server.listen(PORT, () => {
        console.log('═══════════════════════════════════════════');
        console.log('  GLOBAL ACTIVITY MONITOR — DISCOVERY MODE');
        console.log('═══════════════════════════════════════════');
        console.log(`[server] Running on http://localhost:${PORT}`);
        console.log(`[server] WebSocket on ws://localhost:${PORT}/ws`);
        console.log('[server] No hardcoded regions. Discovering situations from live data.');
    });

    // ── Scheduled tasks ──
    cron.schedule(GDELT_FETCH_INTERVAL, runDiscovery);
    cron.schedule(NEWS_FETCH_INTERVAL, refreshNews);

    console.log('[cron] Discovery scan: every 10 minutes');
    console.log('[cron] News refresh: every 5 minutes');

    // ── Initial data load ──
    // 1. First fetch news (fast)
    await refreshNews();

    // 2. Then run discovery (slower — GDELT + clustering)
    await runDiscovery();
}

start().catch(err => {
    console.error('[fatal]', err);
    process.exit(1);
});
