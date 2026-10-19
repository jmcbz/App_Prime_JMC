/**
 * Couche base de données PRIsME Prime.
 * Même philosophie que la flotte PRIsME BZ : PostgreSQL en production (DATABASE_URL présent),
 * SQLite (better-sqlite3) en développement local. Interface asynchrone unique.
 */
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USE_PG = Boolean(process.env.DATABASE_URL);

let driver = null; // { kind, query? , sqlite? }

/** Initialise la connexion et crée les tables si absentes. */
export async function initDb() {
  if (driver) return driver;

  if (USE_PG) {
    const pgMod = await import('pg');
    const { Pool } = pgMod.default || pgMod;
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
    });
    driver = { kind: 'pg', pool };
    await createSchemaPg(pool);
    console.log('✅ Base de données PostgreSQL initialisée');
  } else {
    const BetterSqlite3 = (await import('better-sqlite3')).default;
    const dbPath = process.env.SQLITE_PATH || path.join(__dirname, '..', 'data', 'app-prime.db');
    const fs = await import('fs');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const sqlite = new BetterSqlite3(dbPath);
    sqlite.pragma('journal_mode = WAL');
    driver = { kind: 'sqlite', sqlite };
    createSchemaSqlite(sqlite);
    console.log(`✅ Base de données SQLite initialisée (${dbPath})`);
  }
  return driver;
}

function createSchemaSqlite(sqlite) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      prenom TEXT NOT NULL DEFAULT '',
      nom TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'prime',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS user_mfa (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      secret_encrypted TEXT NOT NULL,
      mfa_enabled INTEGER NOT NULL DEFAULT 0,
      pending_setup INTEGER NOT NULL DEFAULT 1,
      enabled_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

async function createSchemaPg(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      prenom TEXT NOT NULL DEFAULT '',
      nom TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'prime',
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS user_mfa (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      secret_encrypted TEXT NOT NULL,
      mfa_enabled BOOLEAN NOT NULL DEFAULT false,
      pending_setup BOOLEAN NOT NULL DEFAULT true,
      enabled_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

/** Normalise un enregistrement usager (booléens cohérents entre SQLite/PG). */
function normalizeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    password_hash: row.password_hash,
    prenom: row.prenom,
    nom: row.nom,
    role: row.role,
    is_active: row.is_active === true || row.is_active === 1,
    created_at: row.created_at,
  };
}

function normalizeMfa(row) {
  if (!row) return null;
  return {
    user_id: row.user_id,
    secret_encrypted: row.secret_encrypted,
    mfa_enabled: row.mfa_enabled === true || row.mfa_enabled === 1,
    pending_setup: row.pending_setup === true || row.pending_setup === 1,
    enabled_at: row.enabled_at || null,
    updated_at: row.updated_at || null,
  };
}

// ---------- Usagers ----------

export async function getUserByEmail(email) {
  const key = String(email || '').trim().toLowerCase();
  if (driver.kind === 'pg') {
    const r = await driver.pool.query('SELECT * FROM users WHERE LOWER(email) = $1', [key]);
    return normalizeUser(r.rows[0]);
  }
  return normalizeUser(driver.sqlite.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(key));
}

export async function getUserById(id) {
  if (driver.kind === 'pg') {
    const r = await driver.pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return normalizeUser(r.rows[0]);
  }
  return normalizeUser(driver.sqlite.prepare('SELECT * FROM users WHERE id = ?').get(id));
}

export async function listUsers() {
  if (driver.kind === 'pg') {
    const r = await driver.pool.query(`
      SELECT u.*, m.mfa_enabled, m.pending_setup
      FROM users u LEFT JOIN user_mfa m ON m.user_id = u.id
      ORDER BY u.nom ASC, u.prenom ASC`);
    return r.rows.map((row) => ({
      ...normalizeUser(row),
      mfa_enabled: row.mfa_enabled === true,
      mfa_pending: row.pending_setup === true,
    }));
  }
  const rows = driver.sqlite.prepare(`
    SELECT u.*, m.mfa_enabled, m.pending_setup
    FROM users u LEFT JOIN user_mfa m ON m.user_id = u.id
    ORDER BY u.nom ASC, u.prenom ASC`).all();
  return rows.map((row) => ({
    ...normalizeUser(row),
    mfa_enabled: row.mfa_enabled === 1,
    mfa_pending: row.pending_setup === 1,
  }));
}

export async function createUser({ email, passwordHash, prenom, nom, role }) {
  const key = String(email).trim().toLowerCase();
  if (driver.kind === 'pg') {
    const r = await driver.pool.query(
      `INSERT INTO users (email, password_hash, prenom, nom, role)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [key, passwordHash, prenom || '', nom || '', role || 'prime']
    );
    return normalizeUser(r.rows[0]);
  }
  const info = driver.sqlite.prepare(
    `INSERT INTO users (email, password_hash, prenom, nom, role) VALUES (?,?,?,?,?)`
  ).run(key, passwordHash, prenom || '', nom || '', role || 'prime');
  return getUserById(info.lastInsertRowid);
}

export async function setUserActive(id, active) {
  if (driver.kind === 'pg') {
    await driver.pool.query('UPDATE users SET is_active = $1 WHERE id = $2', [!!active, id]);
  } else {
    driver.sqlite.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(active ? 1 : 0, id);
  }
  return getUserById(id);
}

export async function updateUserRole(id, role) {
  if (driver.kind === 'pg') {
    await driver.pool.query('UPDATE users SET role = $1 WHERE id = $2', [role, id]);
  } else {
    driver.sqlite.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  }
  return getUserById(id);
}

export async function countAdmins() {
  if (driver.kind === 'pg') {
    const r = await driver.pool.query(`SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin' AND is_active = true`);
    return r.rows[0].n;
  }
  return driver.sqlite.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1`).get().n;
}

// ---------- MFA ----------

export async function getMfaByUserId(userId) {
  if (driver.kind === 'pg') {
    const r = await driver.pool.query('SELECT * FROM user_mfa WHERE user_id = $1', [userId]);
    return normalizeMfa(r.rows[0]);
  }
  return normalizeMfa(driver.sqlite.prepare('SELECT * FROM user_mfa WHERE user_id = ?').get(userId));
}

export async function upsertMfaPending(userId, secretEncrypted) {
  if (driver.kind === 'pg') {
    await driver.pool.query(
      `INSERT INTO user_mfa (user_id, secret_encrypted, mfa_enabled, pending_setup)
       VALUES ($1,$2,false,true)
       ON CONFLICT (user_id) DO UPDATE SET
         secret_encrypted = EXCLUDED.secret_encrypted,
         mfa_enabled = false, pending_setup = true, enabled_at = NULL,
         updated_at = CURRENT_TIMESTAMP`,
      [userId, secretEncrypted]
    );
  } else {
    driver.sqlite.prepare(
      `INSERT INTO user_mfa (user_id, secret_encrypted, mfa_enabled, pending_setup)
       VALUES (?,?,0,1)
       ON CONFLICT(user_id) DO UPDATE SET
         secret_encrypted = excluded.secret_encrypted,
         mfa_enabled = 0, pending_setup = 1, enabled_at = NULL,
         updated_at = datetime('now')`
    ).run(userId, secretEncrypted);
  }
  return getMfaByUserId(userId);
}

export async function enableMfa(userId) {
  if (driver.kind === 'pg') {
    await driver.pool.query(
      `UPDATE user_mfa SET mfa_enabled = true, pending_setup = false,
       enabled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE user_id = $1`,
      [userId]
    );
  } else {
    driver.sqlite.prepare(
      `UPDATE user_mfa SET mfa_enabled = 1, pending_setup = 0,
       enabled_at = datetime('now'), updated_at = datetime('now') WHERE user_id = ?`
    ).run(userId);
  }
  return getMfaByUserId(userId);
}

export async function resetMfa(userId) {
  if (driver.kind === 'pg') {
    await driver.pool.query('DELETE FROM user_mfa WHERE user_id = $1', [userId]);
  } else {
    driver.sqlite.prepare('DELETE FROM user_mfa WHERE user_id = ?').run(userId);
  }
}
