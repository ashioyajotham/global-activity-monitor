'use strict';
const Database = require('better-sqlite3');
const path = require('node:path');
let db;
function init(filename = process.env.DB_PATH || path.join(__dirname, 'monitor.db')) {
    db = new Database(filename);
    db.pragma('journal_mode = WAL'); db.pragma('busy_timeout = 5000'); db.pragma('foreign_keys = ON');
    // Additive migration: legacy tables remain intact and never seed evidence-v1 alerts.
    db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS evidence_runs(id INTEGER PRIMARY KEY, recorded_at TEXT NOT NULL, version TEXT NOT NULL, health TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS provider_responses(run_id INTEGER NOT NULL REFERENCES evidence_runs(id), provider_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(run_id,provider_id));
        CREATE TABLE IF NOT EXISTS evidence_articles(id TEXT PRIMARY KEY, data TEXT NOT NULL, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS evidence_snapshots(run_id INTEGER NOT NULL REFERENCES evidence_runs(id), situation_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(run_id,situation_id));
        CREATE TABLE IF NOT EXISTS evidence_links(run_id INTEGER NOT NULL, situation_id TEXT NOT NULL, article_id TEXT NOT NULL, PRIMARY KEY(run_id,situation_id,article_id));
        CREATE TABLE IF NOT EXISTS evidence_alerts(id TEXT PRIMARY KEY, data TEXT NOT NULL, recorded_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS evidence_state(key TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS review_labels(article_id TEXT PRIMARY KEY REFERENCES evidence_articles(id), revision INTEGER NOT NULL, label TEXT NOT NULL, reviewed_at TEXT NOT NULL, article_data TEXT);
        CREATE TABLE IF NOT EXISTS review_history(article_id TEXT NOT NULL, revision INTEGER NOT NULL, label TEXT NOT NULL, reviewed_at TEXT NOT NULL, article_data TEXT, PRIMARY KEY(article_id,revision));
        CREATE TABLE IF NOT EXISTS model_versions(hash TEXT PRIMARY KEY, manifest TEXT NOT NULL, recorded_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS shadow_predictions(article_id TEXT NOT NULL, model_hash TEXT NOT NULL, prediction TEXT NOT NULL, baseline TEXT NOT NULL, recorded_at TEXT NOT NULL, PRIMARY KEY(article_id,model_hash));
        CREATE TABLE IF NOT EXISTS geocode_cache(query TEXT PRIMARY KEY, lat REAL, lng REAL, formatted_address TEXT, found INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')));
        CREATE INDEX IF NOT EXISTS evidence_run_time ON evidence_runs(recorded_at);
        CREATE INDEX IF NOT EXISTS evidence_snapshot_id ON evidence_snapshots(situation_id);
        INSERT OR IGNORE INTO schema_migrations VALUES(1, datetime('now'));
    `);
    for (const table of ['review_labels','review_history']) {
        if (!db.prepare(`PRAGMA table_info(${table})`).all().some(column=>column.name==='article_data')) db.exec(`ALTER TABLE ${table} ADD COLUMN article_data TEXT`);
    }
    db.prepare("INSERT OR IGNORE INTO schema_migrations VALUES(3,datetime('now'))").run();
    return db;
}
function getState(key, fallback = null) {
    const row = db.prepare('SELECT data FROM evidence_state WHERE key=?').get(key);
    return row ? JSON.parse(row.data) : fallback;
}
function setState(key, value) { db.prepare('INSERT INTO evidence_state VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data').run(key, JSON.stringify(value)); }
function storeCycle({ articles, situations, pipelineVersion }, health, alertState, alerts, now, providerResponses = []) {
    return db.transaction(() => {
        const run = db.prepare('INSERT INTO evidence_runs(recorded_at,version,health) VALUES(?,?,?)').run(now, pipelineVersion, JSON.stringify(health));
        const runId = Number(run.lastInsertRowid);
        const providerInsert = db.prepare('INSERT INTO provider_responses(run_id,provider_id,data) VALUES(?,?,?)');
        for (const response of providerResponses) providerInsert.run(runId, response.id, JSON.stringify(response));
        const articleInsert = db.prepare('INSERT INTO evidence_articles VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,last_seen=excluded.last_seen');
        for (const a of articles) articleInsert.run(a.id, JSON.stringify(a), now, now);
        const snap = db.prepare('INSERT INTO evidence_snapshots VALUES(?,?,?)');
        const link = db.prepare('INSERT INTO evidence_links VALUES(?,?,?)');
        for (const s of situations) {
            snap.run(runId, s.id, JSON.stringify(s));
            for (const id of s.articleIds) link.run(runId, s.id, id);
        }
        for (const a of alerts) db.prepare('INSERT OR IGNORE INTO evidence_alerts VALUES(?,?,?)').run(a.id, JSON.stringify(a), now);
        const identities = getState('identities', []).filter(s => Date.parse(now)-Date.parse(s.lastChecked)<30*86400000 && !situations.some(n=>n.id===s.id));
        setState('identities', [...identities,...situations]);
        setState('alertState', alertState); setState('latest', { situations, health, recordedAt: now, pipelineVersion, runId });
        return runId;
    })();
}
function getTrend(id, days = 7) {
    return db.prepare(`SELECT s.data,r.recorded_at FROM evidence_snapshots s JOIN evidence_runs r ON r.id=s.run_id
        WHERE s.situation_id=? AND julianday(r.recorded_at)>=julianday('now',?) ORDER BY r.id`).all(id, `-${days} days`).map(r => {
        const s = JSON.parse(r.data); return { score: s.score, evidenceState: s.evidenceState, status: s.status, recorded_at: r.recorded_at, pipelineVersion: s.pipelineVersion };
    });
}
function getAlerts(limit = 50) { return db.prepare('SELECT data FROM evidence_alerts ORDER BY recorded_at DESC LIMIT ?').all(limit).map(r => JSON.parse(r.data)); }
function reviewQueue(limit = 25, offset = 0, reviewed = false) {
    return db.prepare(`SELECT a.data,l.label,l.revision FROM evidence_articles a LEFT JOIN review_labels l ON a.id=l.article_id
        WHERE ${reviewed ? 'l.article_id IS NOT NULL' : 'l.article_id IS NULL'} ORDER BY a.first_seen,a.id LIMIT ? OFFSET ?`).all(limit, offset)
        .map(r => ({ article: JSON.parse(r.data), label: r.label ? JSON.parse(r.label) : null, revision: r.revision || 0 }));
}
function reviewStats() {
    const total = db.prepare('SELECT count(*) n FROM evidence_articles').get().n;
    const reviewed = db.prepare('SELECT count(*) n FROM review_labels').get().n;
    const rows = db.prepare('SELECT label FROM review_labels').all().map(row => JSON.parse(row.label));
    const counts = { relevance:{relevant:0,irrelevant:0,uncertain:0}, slices:{}, categories:{}, severity:{unknown:0,2:0,5:0,8:0,10:0} };
    for (const label of rows) {
        counts.relevance[label.relevance] = (counts.relevance[label.relevance] || 0) + 1;
        counts.slices[label.slice] = (counts.slices[label.slice] || 0) + 1;
        counts.categories[label.category] = (counts.categories[label.category] || 0) + 1;
        counts.severity[label.score == null ? 'unknown' : String(label.score)] = (counts.severity[label.score == null ? 'unknown' : String(label.score)] || 0) + 1;
    }
    const targets = { totalReviewed:1000, relevant:300, irrelevant:300, uncertain:100, event:100, 'routine-sports':300 };
    const progress = Object.fromEntries(Object.entries(targets).map(([key,target]) => {
        const value = key === 'totalReviewed' ? reviewed : key === 'relevant' || key === 'irrelevant' || key === 'uncertain' ? counts.relevance[key] : counts.slices[key] || 0;
        return [key,{value,target,remaining:Math.max(0,target-value),complete:value >= target}];
    }));
    return { total, reviewed, unreviewed:Math.max(0,total-reviewed), counts, progress };
}
const CATEGORIES = ['Armed Conflict','Military Operations','Civil Unrest','Humanitarian Crisis','Disaster','Diplomacy','Unclassified'];
function saveLabel(id, label, expectedRevision) {
    if (!label || !['relevant','irrelevant','uncertain'].includes(label.relevance) || !CATEGORIES.includes(label.category) ||
        ![null,2,5,8,10].includes(label.score) || typeof label.storyId !== 'string' || !label.storyId.trim() ||
        typeof label.location !== 'string' || typeof label.notes !== 'string' || typeof label.evidence !== 'string' ||
        !['routine-sports','entertainment','routine-news','mixed-context','event','ambiguous'].includes(label.slice) ||
        (label.score !== null && (label.relevance !== 'relevant' || !label.evidence.trim())) || !Number.isInteger(expectedRevision)) {
        throw Object.assign(new Error('Invalid label; severity requires a supporting excerpt and relevant classification'), { status: 400 });
    }
    if (JSON.stringify(label).length > 12000) throw Object.assign(new Error('Label too large'), { status: 400 });
    return db.transaction(() => {
        const article = db.prepare('SELECT data FROM evidence_articles WHERE id=?').get(id);
        if (!article) throw Object.assign(new Error('Article not found'), { status: 404 });
        const old = db.prepare('SELECT revision FROM review_labels WHERE article_id=?').get(id);
        if ((old?.revision || 0) !== expectedRevision) throw Object.assign(new Error('Review changed; reload before saving'), { status: 409 });
        const revision = expectedRevision + 1, now = new Date().toISOString(), data = JSON.stringify(label);
        db.prepare('INSERT INTO review_labels(article_id,revision,label,reviewed_at,article_data) VALUES(?,?,?,?,?) ON CONFLICT(article_id) DO UPDATE SET revision=excluded.revision,label=excluded.label,reviewed_at=excluded.reviewed_at,article_data=excluded.article_data').run(id, revision, data, now, article.data);
        db.prepare('INSERT INTO review_history(article_id,revision,label,reviewed_at,article_data) VALUES(?,?,?,?,?)').run(id, revision, data, now, article.data);
        return { revision };
    })();
}
function exportLabels() {
    return db.prepare('SELECT l.article_data AS data,l.label,l.revision,l.reviewed_at FROM evidence_articles a JOIN review_labels l ON a.id=l.article_id WHERE l.article_data IS NOT NULL ORDER BY a.first_seen,a.id').all()
        .map(r => ({ article: JSON.parse(r.data), label: JSON.parse(r.label), revision: r.revision, reviewedAt: r.reviewed_at }));
}
function recordModel(manifest) { db.prepare('INSERT OR IGNORE INTO model_versions VALUES(?,?,?)').run(manifest.hash, JSON.stringify(manifest), new Date().toISOString()); }
function recordShadow(article, modelHash, prediction, now) { db.prepare('INSERT OR IGNORE INTO shadow_predictions VALUES(?,?,?,?,?)').run(article.id, modelHash, JSON.stringify(prediction), JSON.stringify(article.classification), now); }
function shadowReport(modelHash) {
    return db.prepare(`SELECT p.*,l.label FROM shadow_predictions p LEFT JOIN review_labels l ON l.article_id=p.article_id WHERE p.model_hash=? ORDER BY p.recorded_at`).all(modelHash)
        .map(r => ({ ...r, prediction: JSON.parse(r.prediction), baseline: JSON.parse(r.baseline), label: r.label ? JSON.parse(r.label) : null }));
}
function getCachedGeocode(query) { const r = db.prepare('SELECT * FROM geocode_cache WHERE query=?').get(query); return r ? { lat:r.lat, lng:r.lng, formattedAddress:r.formatted_address, found:!!r.found } : undefined; }
function setCachedGeocode(query, result) { db.prepare('INSERT INTO geocode_cache(query,lat,lng,formatted_address,found) VALUES(?,?,?,?,?) ON CONFLICT(query) DO UPDATE SET lat=excluded.lat,lng=excluded.lng,formatted_address=excluded.formatted_address,found=excluded.found').run(query,result?.lat??null,result?.lng??null,result?.formattedAddress??null,result?1:0); }
function getStats() { return { snapshots: db.prepare('SELECT count(*) n FROM evidence_snapshots').get().n, articles: db.prepare('SELECT count(*) n FROM evidence_articles').get().n, providerResponses: db.prepare('SELECT count(*) n FROM provider_responses').get().n, reviewed: db.prepare('SELECT count(*) n FROM review_labels').get().n, escalations: db.prepare('SELECT count(*) n FROM evidence_alerts').get().n, schemaVersion: 3 }; }
function cleanup(days = 30) {
    db.transaction(() => {
        db.prepare(`DELETE FROM evidence_links WHERE run_id IN (SELECT id FROM evidence_runs WHERE julianday(recorded_at)<julianday('now',?))`).run(`-${days} days`);
        db.prepare(`DELETE FROM evidence_snapshots WHERE run_id IN (SELECT id FROM evidence_runs WHERE julianday(recorded_at)<julianday('now',?))`).run(`-${days} days`);
        db.prepare(`DELETE FROM evidence_runs WHERE julianday(recorded_at)<julianday('now',?)`).run(`-${days} days`);
        // Reviewed/training and shadow evidence is retained for reproducibility.
        db.prepare(`DELETE FROM evidence_articles WHERE julianday(last_seen)<julianday('now',?) AND id NOT IN (SELECT article_id FROM review_labels) AND id NOT IN (SELECT article_id FROM shadow_predictions) AND id NOT IN (SELECT article_id FROM evidence_links)`).run(`-${days} days`);
    })();
}
function close() { if (db) { db.close(); db = null; } }
module.exports = { init, close, getState, setState, storeCycle, getTrend, getAlerts, reviewQueue, saveLabel, exportLabels,
    reviewStats, recordModel, recordShadow, shadowReport, getCachedGeocode, setCachedGeocode, getStats, cleanup, CATEGORIES };
