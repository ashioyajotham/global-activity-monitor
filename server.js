'use strict';
const fs = require('node:fs');
const path = require('node:path');
try {
    for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
        const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
        if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('node:http');
const { timingSafeEqual } = require('node:crypto');
const { fetchAllNews } = require('./feeds');
const { THEME_GROUPS, buildGeoQuery, buildDocQuery, parseGeoResponse, parseDocResponse } = require('./discovery');
const { runPipeline, advanceAlerts, VERSION, WINDOW_MS, classify, normalizeArticle } = require('./pipeline');
const db = require('./db');
const { geocodePlace, isEnabled: geocodingEnabled } = require('./geocoding');
const { loadModel, predict, promotionAllowed } = require('./model');
const PASSWORD = process.env.AUTH_PASSWORD || '';
const USER = process.env.AUTH_USER || 'monitor';
const PORT = Number(process.env.PORT || 4000);
const HOST = process.env.HOST || '127.0.0.1';
const STALE_MS = 20 * 60000;
function same(a, b) { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
function authenticated(req) {
    if (!PASSWORD) return true;
    try { const raw = Buffer.from((req.headers.authorization || '').replace(/^Basic /, ''), 'base64').toString();
        const colon = raw.indexOf(':'); return same(raw.slice(0,colon), USER) && same(raw.slice(colon + 1), PASSWORD); } catch { return false; }
}
function localRequest(req) { return ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress); }
function positive(value, fallback, max) { const n = Number(value); return Number.isInteger(n) && n > 0 ? Math.min(n,max) : fallback; }
async function fetchJson(url, timeout = 25000) {
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), timeout);
    try {
        const response = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'GlobalActivityMonitor/5.0' } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json(); // deadline covers the response body too
    } finally { clearTimeout(timer); }
}
async function fetchGdelt() {
    const events = [], sources = [];
    const requests = THEME_GROUPS.flatMap(theme => [{ theme, kind: 'geo' }, { theme, kind: 'doc' }]);
    for (let i = 0; i < requests.length; i++) {
        const { theme, kind } = requests[i];
        try {
            const data = await fetchJson(kind === 'geo' ? buildGeoQuery(theme.geoQuery) : buildDocQuery(theme.docQuery));
            if (kind === 'geo' ? !Array.isArray(data.features) : !Array.isArray(data.articles)) throw new Error('Unexpected response schema');
            const parsed = kind === 'geo' ? parseGeoResponse(data,theme) : parseDocResponse(data,theme);
            events.push(...parsed); sources.push({ id: `${kind}:${theme.id}`, status:'ok', count:parsed.length });
        } catch (error) { sources.push({ id:`${kind}:${theme.id}`, status:'failed', error: error.name === 'AbortError' ? 'timeout' : error.message }); }
        if (i < requests.length - 1) await new Promise(resolve => setTimeout(resolve,5500));
    }
    return { events, sources };
}
function createApp({ fetchGdeltImpl = fetchGdelt, fetchNewsImpl = fetchAllNews, now = () => new Date().toISOString() } = {}) {
    const app = express();
    app.disable('x-powered-by');
    app.use((req,res,next) => {
        if (req.path === '/api/health' || authenticated(req)) return next();
        res.set('WWW-Authenticate','Basic realm="Monitor"').status(401).send('Authentication required');
    });
    app.use(express.json({ limit:'32kb' }));
    // Explicit public allowlist: no .env, database, source files, or model artifacts.
    app.get('/', (_,res) => res.sendFile(path.join(__dirname,'index.html')));
    app.use('/assets',express.static(path.join(__dirname,'public'), { dotfiles:'deny', index:false }));
    const reviewAccess = (req,res,next) => {
        if (!localRequest(req) && !PASSWORD) return res.status(403).json({ error:'Review access requires localhost or authentication' });
        if (req.method !== 'GET') {
            const origin = req.headers.origin;
            if (origin && origin !== `${req.protocol}://${req.get('host')}`) return res.status(403).json({ error:'Cross-origin review writes are disabled' });
            if (!req.is('application/json') || req.get('X-Review-Request') !== '1') return res.status(403).json({ error:'Review request header required' });
        }
        next();
    };
    app.get('/review',reviewAccess,(_,res) => res.sendFile(path.join(__dirname,'public/review.html')));
    let latest = db.getState('latest', { situations:[], health:{ status:'bootstrap', sources:[] }, recordedAt:null });
    let news = [], newsHealth = { status:'bootstrap' }, newsFetchedAt = null, fetchingNews = null, discovering = null;
    let wss = null, model = null;
    if (process.env.MODEL_PATH) {
        try { model = loadModel(process.env.MODEL_PATH); db.recordModel({ hash:model.hash, version:model.version, path:process.env.MODEL_PATH }); }
        catch (error) { console.error('[model] Disabled:',error.message); }
    }
    const mode = process.env.CLASSIFIER_MODE === 'model' ? 'model' : 'rules';
    const promoted = model && mode === 'model' && promotionAllowed(model,process.env.MODEL_PROMOTION_PATH,db.shadowReport(model.hash));
    if (mode === 'model' && !promoted) console.error('[model] Promotion gates unmet; using rules');
    function envelope() {
        const timestamp = now();
        const stale = !latest.recordedAt || Date.parse(timestamp) - Date.parse(latest.recordedAt) > STALE_MS || latest.health.status === 'failed';
        const activities = latest.situations.map(s => ({ ...s,
            evidenceState: stale || !s.newestEvidenceAt || Date.parse(timestamp) - Date.parse(s.newestEvidenceAt) > WINDOW_MS ? 'developing' : s.evidenceState,
            stale,
        })).map(s => ({ ...s, status: s.evidenceState === 'confirmed' ? s.status : 'developing' }));
        return { activities, count:activities.length, pipelineVersion:VERSION, classifier:promoted ? model.hash : 'rules',
            source:!latest.recordedAt ? 'bootstrap' : stale ? 'stale' : latest.health.status === 'ok' ? 'live' : latest.health.status,
            lastFetch:latest.recordedAt, health:{ ...latest.health, stale, news:newsHealth }, model: model ? { hash:model.hash, mode:promoted ? 'model' : 'shadow' } : null };
    }
    function broadcast(data) { if (wss) for (const c of wss.clients) if (c.readyState === 1) c.send(JSON.stringify(data)); }
    async function refreshNews() {
        if (fetchingNews) return fetchingNews;
        fetchingNews = (async () => {
            try {
                const result = await fetchNewsImpl();
                const status = result.health.failed === 0 ? 'ok' : result.health.success ? 'partial' : 'failed';
                newsHealth = { status,...result.health };
                if (status !== 'failed') { news = result.items; newsFetchedAt = now(); }
                broadcast({ type:'news_update', items:news.slice(0,100), replace:true, health:newsHealth, lastFetch:newsFetchedAt });
            } catch (error) { newsHealth = { status:'failed', error:error.message }; }
        })().finally(() => { fetchingNews = null; });
        return fetchingNews;
    }
    async function runDiscovery() {
        if (discovering) return discovering;
        discovering = (async () => {
            try {
                if (!newsFetchedAt || Date.parse(now()) - Date.parse(newsFetchedAt) >= 5 * 60000) await refreshNews();
                const gdelt = await fetchGdeltImpl();
                const timestamp = now();
                const sources = [...gdelt.sources,{ id:'rss',...newsHealth }];
                const failed = sources.filter(s => s.status !== 'ok').length;
                const status = sources.every(s => s.status === 'failed') ? 'failed' : failed ? 'partial' : 'ok';
                if (status === 'failed') {
                    const alerts = advanceAlerts([],db.getState('alertState',{}),{ successful:false, now:timestamp });
                    db.setState('alertState',alerts.state);
                    latest = { ...latest, health:{ status,sources } }; db.setState('latest',latest);
                    broadcast({ type:'activities_update',...envelope() }); return envelope();
                }
                const raw = [...gdelt.events,...news];
                // Optional precise geocoding is only attempted after relevance, on every article provider.
                if (geocodingEnabled()) for (const item of raw) {
                    const article = normalizeArticle(item,timestamp);
                    if (classify(article).relevance !== 'relevant') continue;
                    const locations = require('./countries-data').extractCountries(`${article.title} ${article.snippet}`);
                    if (locations.length !== 1 || locations[0].specificity <= 1) continue;
                    const loc = locations[0], coords = await geocodePlace(loc.matchedTerm,loc.name,loc.code);
                    if (coords) Object.assign(item,{lat:coords.lat,lng:coords.lng,_geocoded:true});
                }
                const result = runPipeline(raw,{ previous:db.getState('identities',latest.situations), now:timestamp, model:promoted ? model : null });
                if (model) for (const a of result.articles) {
                    if (a.geoOnly || !/^(en|english)$/i.test(a.language)) continue;
                    db.recordShadow(a,model.hash,predict(model,`${a.title}. ${a.snippet}`),timestamp);
                }
                const alerts = advanceAlerts(result.situations,db.getState('alertState',{}),{ successful:status === 'ok', now:timestamp });
                const health = { status,sources };
                db.storeCycle(result,health,alerts.state,alerts.alerts,timestamp);
                latest = { situations:result.situations, health, recordedAt:timestamp };
                broadcast({ type:'activities_update',...envelope() });
                if (alerts.alerts.length) broadcast({ type:'escalation',escalations:alerts.alerts });
                return envelope();
            } catch (error) {
                latest = { ...latest, health:{ ...latest.health,status:'failed',error:error.message } };
                db.setState('latest',latest);
                db.setState('alertState',advanceAlerts([],db.getState('alertState',{}),{successful:false}).state);
                broadcast({type:'activities_update',...envelope()});
                console.error('[discovery]',error.message); return envelope();
            }
        })().finally(() => { discovering = null; });
        return discovering;
    }
    app.get('/api/activities',(_,res) => res.json(envelope()));
    app.get('/api/news',(_,res) => res.json({news:news.slice(0,100),health:newsHealth,lastFetch:newsFetchedAt}));
    app.get('/api/health',(_,res) => res.json({status:envelope().source,pipelineVersion:VERSION,uptime:process.uptime(),lastFetch:latest.recordedAt}));
    app.get('/api/stats',(_,res) => res.json(db.getStats()));
    app.get('/api/trends',(_,res) => res.json({pipelineVersion:VERSION,trends:latest.situations.map(s => ({id:s.id,name:s.name,points:db.getTrend(s.id,1)}))}));
    app.get('/api/trends/:id',(req,res) => res.json({id:req.params.id,pipelineVersion:VERSION,trend:db.getTrend(req.params.id,positive(req.query.days,7,30))}));
    app.get('/api/escalations',(req,res) => res.json({escalations:db.getAlerts(positive(req.query.limit,50,200))}));
    app.get('/api/review',reviewAccess,(req,res) => res.json({items:db.reviewQueue(positive(req.query.limit,25,100),Math.max(0,Number(req.query.offset)||0),req.query.reviewed === 'true')}));
    app.get('/api/review/export',reviewAccess,(_,res) => res.json({pipelineVersion:VERSION,items:db.exportLabels()}));
    app.post('/api/review/:id',reviewAccess,(req,res,next) => { try { res.json(db.saveLabel(req.params.id,req.body.label,req.body.revision)); } catch(error) { next(error); } });
    app.get('/api/model/shadow',reviewAccess,(_,res) => res.json({model:model?.hash || null,rows:model ? db.shadowReport(model.hash) : []}));
    app.use((error,req,res,next) => { res.status(error.status || 500).json({error:error.status ? error.message : 'Internal error'}); });
    return { app, runDiscovery, refreshNews, envelope, attachWebSocket(server) {
        wss = new WebSocketServer({noServer:true});
        server.on('upgrade',(req,socket,head) => {
            const origin = req.headers.origin;
            if (req.url !== '/ws' || !authenticated(req) || (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`)) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
            wss.handleUpgrade(req,socket,head,ws => wss.emit('connection',ws,req));
        });
        wss.on('connection',ws => ws.send(JSON.stringify({type:'init',...envelope(),news:news.slice(0,100)})));
    }, close() { if (wss) { for (const c of wss.clients) c.terminate(); wss.close(); } } };
}
async function start() {
    db.init();
    const controller = createApp(), server = http.createServer(controller.app);
    controller.attachWebSocket(server);
    server.listen(PORT,HOST,() => console.log(`Monitor ${VERSION}: http://${HOST}:${PORT}`));
    const timers = [setInterval(controller.runDiscovery,10*60000),setInterval(controller.refreshNews,5*60000),setInterval(() => db.cleanup(30),24*60*60000)];
    await controller.refreshNews();
    controller.runDiscovery();
    const stop = () => { timers.forEach(clearInterval); controller.close(); server.close(() => { db.close(); process.exit(0); }); setTimeout(() => process.exit(0),5000).unref(); };
    process.once('SIGINT',stop); process.once('SIGTERM',stop);
}
if (require.main === module) start().catch(error => { console.error(error); db.close(); process.exitCode = 1; });
module.exports = {createApp,fetchJson,fetchGdelt};
