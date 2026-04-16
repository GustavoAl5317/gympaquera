/**
 * SQLite local (rápido para dev). Arquivo: data/gym-paquera.sqlite ou SQLITE_PATH.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const root = path.join(__dirname, '..');

let db;

function getDbPath() {
    const fromEnv = process.env.SQLITE_PATH;
    if (fromEnv && String(fromEnv).trim()) {
        const s = String(fromEnv).trim();
        return path.isAbsolute(s) ? s : path.join(root, s);
    }
    return path.join(root, 'data', 'gym-paquera.sqlite');
}

function runMigrations(database) {
    database.pragma('foreign_keys = ON');
    database.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        public_uid TEXT UNIQUE,
        sou TEXT NOT NULL,
        procuro TEXT NOT NULL,
        gym TEXT NOT NULL,
        matricula TEXT,
        estado TEXT NOT NULL,
        cidade TEXT NOT NULL,
        nickname TEXT NOT NULL,
        nascimento TEXT NOT NULL,
        created_at TEXT NOT NULL,
        premium_until TEXT,
        last_seen TEXT
    );

    CREATE TABLE IF NOT EXISTS photos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS user_favorites (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        favorite_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (user_id, favorite_user_id)
    );

    CREATE TABLE IF NOT EXISTS user_blocks (
        blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (blocker_id, blocked_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        to_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reported_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pix_charges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        mp_payment_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        amount REAL NOT NULL,
        external_reference TEXT,
        created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_users_estado_cidade ON users (estado, cidade);
    CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages (from_user_id, to_user_id);
    CREATE INDEX IF NOT EXISTS idx_pix_charges_user ON pix_charges (user_id);

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens (user_id);
    `);

    var pixCols = database.prepare('PRAGMA table_info(pix_charges)').all();
    var hasPremiumDaysCol = pixCols.some(function (c) {
        return c && c.name === 'premium_days';
    });
    if (!hasPremiumDaysCol) {
        database.exec('ALTER TABLE pix_charges ADD COLUMN premium_days INTEGER');
    }

    const needUid = database.prepare("SELECT id FROM users WHERE public_uid IS NULL OR public_uid = ''").all();
    const setUid = database.prepare('UPDATE users SET public_uid = ? WHERE id = ?');
    for (var i = 0; i < needUid.length; i++) {
        setUid.run(crypto.randomUUID(), needUid[i].id);
    }
}

function getDb() {
    if (db) return db;
    const dbPath = getDbPath();
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    runMigrations(db);
    console.log('[db] SQLite:', dbPath);
    return db;
}

module.exports = {
    getDb,
    root,
    getDbPath
};
