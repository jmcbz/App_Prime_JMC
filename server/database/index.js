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
    let BetterSqlite3;
    try {
      BetterSqlite3 = (await import('better-sqlite3')).default;
    } catch (err) {
      throw new Error(
        'Aucune base de données configurée : définissez DATABASE_URL (PostgreSQL) en production. ' +
          'Le mode SQLite local nécessite le module optionnel better-sqlite3. Détail : ' + err.message
      );
    }
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
    CREATE TABLE IF NOT EXISTS primes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prime_id INTEGER REFERENCES primes(id) ON DELETE SET NULL,
      data TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS suivis (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
      prime_id INTEGER REFERENCES primes(id) ON DELETE SET NULL,
      data TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_clients_prime ON clients(prime_id);
    CREATE INDEX IF NOT EXISTS idx_suivis_client ON suivis(client_id);
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
    CREATE TABLE IF NOT EXISTS primes (
      id SERIAL PRIMARY KEY,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS clients (
      id SERIAL PRIMARY KEY,
      prime_id INTEGER REFERENCES primes(id) ON DELETE SET NULL,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS suivis (
      id SERIAL PRIMARY KEY,
      client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
      prime_id INTEGER REFERENCES primes(id) ON DELETE SET NULL,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_clients_prime ON clients(prime_id);
    CREATE INDEX IF NOT EXISTS idx_suivis_client ON suivis(client_id);
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

// ---------- Métier : stockage JSON (pattern PRIsME BZ — colonne `data`) ----------
// Les entités stockent leur contenu dans une colonne `data` (JSONB en PG, TEXT JSON en SQLite).
// Les clés relationnelles (prime_id, client_id) sont AUSSI en colonnes réelles pour les jointures/cascades.

function parseData(value) {
  if (value && typeof value === 'object') return value; // PG JSONB déjà objet
  if (!value) return {};
  try { return JSON.parse(value); } catch { return {}; }
}

/** Insère une ligne {data, <fk>} et relit (SQLite/PG). */
async function insertJsonRow(table, data, fks = {}) {
  const json = JSON.stringify(data || {});
  const fkCols = Object.keys(fks);
  if (driver.kind === 'pg') {
    const cols = [...fkCols, 'data'];
    const ph = cols.map((c, i) => (c === 'data' ? `$${i + 1}::jsonb` : `$${i + 1}`));
    const r = await driver.pool.query(
      `INSERT INTO ${table} (${cols.join(',')}) VALUES (${ph.join(',')}) RETURNING *`,
      [...fkCols.map((c) => fks[c]), json]
    );
    return r.rows[0];
  }
  const cols = [...fkCols, 'data'];
  const info = driver.sqlite.prepare(
    `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`
  ).run(...fkCols.map((c) => fks[c]), json);
  return driver.sqlite.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(info.lastInsertRowid);
}

/** Met à jour data + fks et relit. */
async function updateJsonRow(table, id, data, fks = {}) {
  const json = JSON.stringify(data || {});
  const fkCols = Object.keys(fks);
  if (driver.kind === 'pg') {
    const sets = ['data = $1::jsonb', 'updated_at = CURRENT_TIMESTAMP',
      ...fkCols.map((c, i) => `${c} = $${i + 2}`)];
    const r = await driver.pool.query(
      `UPDATE ${table} SET ${sets.join(', ')} WHERE id = $${fkCols.length + 2} RETURNING *`,
      [json, ...fkCols.map((c) => fks[c]), id]
    );
    return r.rows[0] || null;
  }
  const sets = ["data = ?", "updated_at = datetime('now')", ...fkCols.map((c) => `${c} = ?`)];
  driver.sqlite.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`)
    .run(json, ...fkCols.map((c) => fks[c]), id);
  return driver.sqlite.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) || null;
}

async function deleteRow(table, id) {
  if (driver.kind === 'pg') await driver.pool.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
  else driver.sqlite.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
}

async function selectAll(table, orderBy) {
  if (driver.kind === 'pg') return (await driver.pool.query(`SELECT * FROM ${table} ORDER BY ${orderBy}`)).rows;
  return driver.sqlite.prepare(`SELECT * FROM ${table} ORDER BY ${orderBy}`).all();
}

// ---------- Primes ----------

function normalizePrime(row) {
  if (!row) return null;
  const d = parseData(row.data);
  return {
    id: row.id,
    nom: d.nom || '',
    codeTitan: d.codeTitan || '',
    specialites: Array.isArray(d.specialites) ? d.specialites : [],
    disponibilite: d.disponibilite || 'disponible',
    avatarInitiales: d.avatarInitiales || '',
  };
}

function primeData({ nom, codeTitan, specialites, disponibilite, avatarInitiales }) {
  return {
    nom: nom || '',
    codeTitan: codeTitan || '',
    specialites: Array.isArray(specialites) ? specialites : [],
    disponibilite: disponibilite || 'disponible',
    avatarInitiales: avatarInitiales || '',
  };
}

export async function listPrimes() {
  return (await selectAll('primes', 'id ASC')).map(normalizePrime);
}

export async function createPrime(input) {
  return normalizePrime(await insertJsonRow('primes', primeData(input)));
}

export async function updatePrime(id, input) {
  return normalizePrime(await updateJsonRow('primes', id, primeData(input)));
}

export async function deletePrime(id) {
  await deleteRow('primes', id);
}

// ---------- Clients ----------

function normalizeClient(row) {
  if (!row) return null;
  const d = parseData(row.data);
  return {
    id: row.id,
    nom: d.nom || '',
    secteur: d.secteur || '',
    primeId: row.prime_id ?? null,
    statut: d.statut || 'actif',
  };
}

function clientData({ nom, secteur, statut }) {
  return { nom: nom || '', secteur: secteur || '', statut: statut || 'actif' };
}

export async function listClients() {
  return (await selectAll('clients', 'id ASC')).map(normalizeClient);
}

export async function createClient(input) {
  return normalizeClient(await insertJsonRow('clients', clientData(input), { prime_id: input.primeId ?? null }));
}

export async function updateClient(id, input) {
  return normalizeClient(await updateJsonRow('clients', id, clientData(input), { prime_id: input.primeId ?? null }));
}

export async function deleteClient(id) {
  await deleteRow('clients', id);
}

// ---------- Suivis ----------

function normalizeSuivi(row) {
  if (!row) return null;
  const d = parseData(row.data);
  return {
    id: row.id,
    titre: d.titre || '',
    clientId: row.client_id ?? null,
    primeId: row.prime_id ?? null,
    statut: d.statut || 'a_faire',
    echeance: d.echeance || null,
    note: d.note || null,
  };
}

function suiviData({ titre, statut, echeance, note }) {
  return {
    titre: titre || '',
    statut: statut || 'a_faire',
    echeance: echeance || null,
    note: note || null,
  };
}

export async function listSuivis() {
  return (await selectAll('suivis', 'id ASC')).map(normalizeSuivi);
}

export async function createSuivi(input) {
  return normalizeSuivi(await insertJsonRow('suivis', suiviData(input), { client_id: input.clientId ?? null, prime_id: input.primeId ?? null }));
}

export async function updateSuivi(id, input) {
  return normalizeSuivi(await updateJsonRow('suivis', id, suiviData(input), { client_id: input.clientId ?? null, prime_id: input.primeId ?? null }));
}

export async function deleteSuivi(id) {
  await deleteRow('suivis', id);
}

// ---------- Seed métier (une seule fois, si les tables sont vides) ----------

async function countRows(table) {
  if (driver.kind === 'pg') {
    const r = await driver.pool.query(`SELECT COUNT(*)::int AS n FROM ${table}`);
    return r.rows[0].n;
  }
  return driver.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
}

/** Insère les données initiales si primes/clients/suivis sont vides. Idempotent. */
export async function seedMetier() {
  if ((await countRows('primes')) > 0) return false;

  const primes = [
    { nom: 'Jean-Michel Caouette', codeTitan: 'Nightwing', specialites: ['M365', 'Power Automate', 'Gouvernance TI'], disponibilite: 'charge', avatarInitiales: 'JM' },
    { nom: 'Alexane Morin', codeTitan: 'Starfire', specialites: ['Réseau', 'Sécurité', 'FortiGate'], disponibilite: 'disponible', avatarInitiales: 'AM' },
    { nom: 'Carl Thibault', codeTitan: 'Cyborg', specialites: ['Infra serveur', 'SharePoint', 'Migration'], disponibilite: 'surcharge', avatarInitiales: 'CT' },
    { nom: 'Maude Girard', codeTitan: 'Raven', specialites: ['Sauvegardes', 'Continuité', 'Audit'], disponibilite: 'disponible', avatarInitiales: 'MG' },
  ];
  const primeIds = [];
  for (const p of primes) primeIds.push((await createPrime(p)).id);

  const clients = [
    { nom: 'Coopérative funéraire des Deux Rives', secteur: 'Services funéraires', prime: 0, statut: 'actif' },
    { nom: 'Ville de Saint-Lin-Laurentides', secteur: 'Municipal', prime: 0, statut: 'actif' },
    { nom: 'COEFICIA CPA', secteur: 'Comptabilité / CPA', prime: 1, statut: 'actif' },
    { nom: 'Chabot Carrosserie', secteur: 'Automobile', prime: 2, statut: 'risque' },
    { nom: 'Ambioner', secteur: 'Ingénierie-conseil', prime: 2, statut: 'onboarding' },
    { nom: 'APE – Services d’aide à l’emploi', secteur: 'OBNL / Emploi', prime: 3, statut: 'actif' },
  ];
  const clientIds = [];
  for (const c of clients) clientIds.push((await createClient({ nom: c.nom, secteur: c.secteur, primeId: primeIds[c.prime], statut: c.statut })).id);

  const suivis = [
    { titre: 'Migration SharePoint — phase pilote', client: 4, prime: 2, statut: 'en_cours', echeance: '2026-11-15', note: 'Compagnie pilote du groupe.' },
    { titre: 'Test de restauration sauvegardes', client: 0, prime: 0, statut: 'a_faire', echeance: '2026-10-31' },
    { titre: 'Activation MFA tous comptes', client: 3, prime: 2, statut: 'bloque', echeance: '2026-10-25', note: 'En attente d’accès admin client.' },
    { titre: 'Prise de besoin initiale', client: 2, prime: 1, statut: 'termine', echeance: '2026-10-10' },
    { titre: 'Rapport trimestriel Q4', client: 5, prime: 3, statut: 'a_faire', echeance: '2026-12-15' },
    { titre: 'Revue posture sécurité', client: 1, prime: 0, statut: 'en_cours', echeance: '2026-11-05' },
  ];
  for (const s of suivis) await createSuivi({ titre: s.titre, clientId: clientIds[s.client], primeId: primeIds[s.prime], statut: s.statut, echeance: s.echeance, note: s.note || null });

  console.log('🌱 Données métier initiales insérées (primes/clients/suivis).');
  return true;
}
