/**
 * db.js — SQLite Persistence Layer
 * 
 * Stores situation snapshots, articles, and escalation history.
 * Enables trend analysis, session survival, and historical queries.
 * 
 * Uses better-sqlite3 for synchronous, zero-config SQLite.
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'monitor.db');

let db;

// ═══════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════

function init() {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');       // faster concurrent reads
    db.pragma('busy_timeout = 5000');      // wait up to 5s on locks
    db.pragma('synchronous = NORMAL');     // good balance of safety/speed

    db.exec(`
        -- Situation snapshots: one row per situation per discovery cycle
        CREATE TABLE IF NOT EXISTS situation_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            score REAL NOT NULL,
            status TEXT NOT NULL,
            type TEXT,
            lat REAL,
            lng REAL,
            article_count INTEGER DEFAULT 0,
            description TEXT,
            parties TEXT,       -- JSON array
            region TEXT,
            confidence TEXT DEFAULT 'normal',
            recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- Deduplicated article store
        CREATE TABLE IF NOT EXISTS articles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            url TEXT,
            source TEXT,
            tone REAL,
            situation_name TEXT,
            fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(title, source)
        );

        -- Escalation audit log
        CREATE TABLE IF NOT EXISTS escalations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            from_status TEXT NOT NULL,
            to_status TEXT NOT NULL,
            score REAL,
            type TEXT,
            lat REAL,
            lng REAL,
            detected_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- Indexes for common queries
        CREATE INDEX IF NOT EXISTS idx_snap_name ON situation_snapshots(name);
        CREATE INDEX IF NOT EXISTS idx_snap_time ON situation_snapshots(recorded_at);
        CREATE INDEX IF NOT EXISTS idx_snap_name_time ON situation_snapshots(name, recorded_at);
        CREATE INDEX IF NOT EXISTS idx_articles_situation ON articles(situation_name);
        CREATE INDEX IF NOT EXISTS idx_articles_time ON articles(fetched_at);
        CREATE INDEX IF NOT EXISTS idx_esc_time ON escalations(detected_at);
        CREATE INDEX IF NOT EXISTS idx_esc_name ON escalations(name);
    `);

    console.log(`[db] SQLite initialized at ${DB_PATH}`);
    console.log(`[db] Existing snapshots: ${getSnapshotCount()}`);
    return db;
}

// ═══════════════════════════════════════════════════════
// WRITE OPERATIONS
// ═══════════════════════════════════════════════════════

/**
 * Store a full discovery cycle's worth of situations.
 */
const _insertSnapshot = () => db.prepare(`
    INSERT INTO situation_snapshots 
        (name, score, status, type, lat, lng, article_count, description, parties, region, confidence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

function storeSituations(situations) {
    const insert = _insertSnapshot();
    const transaction = db.transaction((sits) => {
        for (const s of sits) {
            insert.run(
                s.name, s.score, s.status, s.type,
                s.lat, s.lng, s.articleCount || 0,
                s.description, JSON.stringify(s.parties || []),
                s.region, s.confidence || 'normal'
            );
        }
    });
    transaction(situations);
}

/**
 * Store articles linked to a situation.
 */
function storeArticles(articles, situationName) {
    const insert = db.prepare(`
        INSERT OR IGNORE INTO articles (title, url, source, tone, situation_name)
        VALUES (?, ?, ?, ?, ?)
    `);
    const transaction = db.transaction((arts) => {
        for (const a of arts) {
            insert.run(a.title || '', a.url || '', a.source || '', a.tone ?? null, situationName);
        }
    });
    transaction(articles);
}

/**
 * Store an escalation event.
 */
function storeEscalation(esc) {
    db.prepare(`
        INSERT INTO escalations (name, from_status, to_status, score, type, lat, lng)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(esc.name, esc.from, esc.to, esc.score, esc.type, esc.lat, esc.lng);
}

// ═══════════════════════════════════════════════════════
// TREND QUERIES
// ═══════════════════════════════════════════════════════

/**
 * Get score history for a single situation.
 * Returns data points for trend line rendering.
 */
function getScoreTrend(name, days = 7) {
    return db.prepare(`
        SELECT score, status, article_count, recorded_at
        FROM situation_snapshots
        WHERE name = ? AND recorded_at >= datetime('now', ?)
        ORDER BY recorded_at ASC
    `).all(name, `-${days} days`);
}

/**
 * Get summary trends for all situations over a time window.
 * Useful for dashboard "trending up/down" indicators.
 */
function getAllTrends(hours = 24) {
    return db.prepare(`
        SELECT 
            name,
            MIN(score) as min_score,
            MAX(score) as max_score,
            ROUND(AVG(score), 1) as avg_score,
            COUNT(*) as data_points,
            -- First and last scores for direction
            (SELECT s2.score FROM situation_snapshots s2 
             WHERE s2.name = s1.name AND s2.recorded_at >= datetime('now', ?)
             ORDER BY s2.recorded_at ASC LIMIT 1) as first_score,
            (SELECT s3.score FROM situation_snapshots s3 
             WHERE s3.name = s1.name AND s3.recorded_at >= datetime('now', ?)
             ORDER BY s3.recorded_at DESC LIMIT 1) as last_score
        FROM situation_snapshots s1
        WHERE recorded_at >= datetime('now', ?)
        GROUP BY name
        HAVING data_points >= 2
        ORDER BY max_score DESC
    `).all(`-${hours} hours`, `-${hours} hours`, `-${hours} hours`);
}

/**
 * Get the most recent snapshot for each situation (for restart recovery).
 */
function getLatestSituations() {
    return db.prepare(`
        SELECT s.*
        FROM situation_snapshots s
        INNER JOIN (
            SELECT name, MAX(recorded_at) as max_time
            FROM situation_snapshots
            WHERE recorded_at >= datetime('now', '-1 day')
            GROUP BY name
        ) latest ON s.name = latest.name AND s.recorded_at = latest.max_time
        ORDER BY s.score DESC
        LIMIT 30
    `).all();
}

/**
 * Recover previous states map (for escalation detection after restart).
 */
function recoverPreviousStates() {
    const rows = db.prepare(`
        SELECT name, status
        FROM situation_snapshots s
        INNER JOIN (
            SELECT name as n, MAX(recorded_at) as max_time
            FROM situation_snapshots
            GROUP BY name
        ) latest ON s.name = latest.n AND s.recorded_at = latest.max_time
    `).all();

    const states = new Map();
    for (const row of rows) {
        states.set(row.name, row.status);
    }
    return states;
}

// ═══════════════════════════════════════════════════════
// ESCALATION QUERIES
// ═══════════════════════════════════════════════════════

function getEscalationHistory(limit = 50) {
    return db.prepare(`
        SELECT * FROM escalations
        ORDER BY detected_at DESC
        LIMIT ?
    `).all(limit);
}

function getEscalationsForSituation(name, days = 30) {
    return db.prepare(`
        SELECT * FROM escalations
        WHERE name = ? AND detected_at >= datetime('now', ?)
        ORDER BY detected_at DESC
    `).all(name, `-${days} days`);
}

// ═══════════════════════════════════════════════════════
// STATS & MAINTENANCE
// ═══════════════════════════════════════════════════════

function getSnapshotCount() {
    return db.prepare('SELECT COUNT(*) as count FROM situation_snapshots').get().count;
}

function getArticleCount() {
    return db.prepare('SELECT COUNT(*) as count FROM articles').get().count;
}

function getStats() {
    return {
        snapshots: getSnapshotCount(),
        articles: getArticleCount(),
        escalations: db.prepare('SELECT COUNT(*) as count FROM escalations').get().count,
        oldestSnapshot: db.prepare('SELECT MIN(recorded_at) as oldest FROM situation_snapshots').get()?.oldest,
        dbSizeMB: (require('fs').statSync(DB_PATH).size / (1024 * 1024)).toFixed(2),
    };
}

/**
 * Cleanup old data. Default: keep 30 days.
 */
function cleanup(daysToKeep = 30) {
    const cutoff = `-${daysToKeep} days`;
    const snapDeleted = db.prepare(`DELETE FROM situation_snapshots WHERE recorded_at < datetime('now', ?)`).run(cutoff).changes;
    const artDeleted = db.prepare(`DELETE FROM articles WHERE fetched_at < datetime('now', ?)`).run(cutoff).changes;
    const escDeleted = db.prepare(`DELETE FROM escalations WHERE detected_at < datetime('now', ?)`).run(cutoff).changes;

    if (snapDeleted + artDeleted + escDeleted > 0) {
        console.log(`[db] Cleanup: removed ${snapDeleted} snapshots, ${artDeleted} articles, ${escDeleted} escalations`);
        db.exec('VACUUM');
    }
    return { snapDeleted, artDeleted, escDeleted };
}

function close() {
    if (db) {
        db.close();
        console.log('[db] Connection closed');
    }
}

module.exports = {
    init, close,
    storeSituations, storeArticles, storeEscalation,
    getScoreTrend, getAllTrends, getLatestSituations, recoverPreviousStates,
    getEscalationHistory, getEscalationsForSituation,
    getSnapshotCount, getArticleCount, getStats, cleanup,
};
