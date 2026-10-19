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
      nom TEXT NOT NULL,
      code_titan TEXT NOT NULL DEFAULT '',
      specialites TEXT NOT NULL DEFAULT '[]',
      disponibilite TEXT NOT NULL DEFAULT 'disponible',
      avatar_initiales TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nom TEXT NOT NULL,
      secteur TEXT NOT NULL DEFAULT '',
      prime_id INTEGER REFERENCES primes(id) ON DELETE SET NULL,
      statut TEXT NOT NULL DEFAULT 'actif',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS suivis (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      titre TEXT NOT NULL,
      client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
      prime_id INTEGER REFERENCES primes(id) ON DELETE SET NULL,
      statut TEXT NOT NULL DEFAULT 'a_faire',
      echeance TEXT,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
      nom TEXT NOT NULL,
      code_titan TEXT NOT NULL DEFAULT '',
      specialites JSONB NOT NULL DEFAULT '[]',
      disponibilite TEXT NOT NULL DEFAULT 'disponible',
      avatar_initiales TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS clients (
      id SERIAL PRIMARY KEY,
      nom TEXT NOT NULL,
      secteur TEXT NOT NULL DEFAULT '',
      prime_id INTEGER REFERENCES primes(id) ON DELETE SET NULL,
      statut TEXT NOT NULL DEFAULT 'actif',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS suivis (
      id SERIAL PRIMARY KEY,
      titre TEXT NOT NULL,
      client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
      prime_id INTEGER REFERENCES primes(id) ON DELETE SET NULL,
      statut TEXT NOT NULL DEFAULT 'a_faire',
      echeance TEXT,
      note TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
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

// ---------- Métier : Primes ----------

function parseSpecialites(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try { return JSON.parse(value); } catch { return []; }
}

function normalizePrime(row) {
  if (!row) return null;
  return {
    id: row.id,
    nom: row.nom,
    codeTitan: row.code_titan || '',
    specialites: parseSpecialites(row.specialites),
    disponibilite: row.disponibilite || 'disponible',
    avatarInitiales: row.avatar_initiales || '',
  };
}

export async function listPrimes() {
  if (driver.kind === 'pg') {
    const r = await driver.pool.query('SELECT * FROM primes ORDER BY nom ASC');
    return r.rows.map(normalizePrime);
  }
  return driver.sqlite.prepare('SELECT * FROM primes ORDER BY nom ASC').all().map(normalizePrime);
}

export async function createPrime({ nom, codeTitan, specialites, disponibilite, avatarInitiales }) {
  const spec = JSON.stringify(Array.isArray(specialites) ? specialites : []);
  if (driver.kind === 'pg') {
    const r = await driver.pool.query(
      `INSERT INTO primes (nom, code_titan, specialites, disponibilite, avatar_initiales)
       VALUES ($1,$2,$3::jsonb,$4,$5) RETURNING *`,
      [nom, codeTitan || '', spec, disponibilite || 'disponible', avatarInitiales || '']
    );
    return normalizePrime(r.rows[0]);
  }
  const info = driver.sqlite.prepare(
    `INSERT INTO primes (nom, code_titan, specialites, disponibilite, avatar_initiales) VALUES (?,?,?,?,?)`
  ).run(nom, codeTitan || '', spec, disponibilite || 'disponible', avatarInitiales || '');
  return normalizePrime(driver.sqlite.prepare('SELECT * FROM primes WHERE id = ?').get(info.lastInsertRowid));
}

export async function updatePrime(id, { nom, codeTitan, specialites, disponibilite, avatarInitiales }) {
  const spec = JSON.stringify(Array.isArray(specialites) ? specialites : []);
  if (driver.kind === 'pg') {
    const r = await driver.pool.query(
      `UPDATE primes SET nom=$1, code_titan=$2, specialites=$3::jsonb, disponibilite=$4, avatar_initiales=$5
       WHERE id=$6 RETURNING *`,
      [nom, codeTitan || '', spec, disponibilite || 'disponible', avatarInitiales || '', id]
    );
    return normalizePrime(r.rows[0]);
  }
  driver.sqlite.prepare(
    `UPDATE primes SET nom=?, code_titan=?, specialites=?, disponibilite=?, avatar_initiales=? WHERE id=?`
  ).run(nom, codeTitan || '', spec, disponibilite || 'disponible', avatarInitiales || '', id);
  return normalizePrime(driver.sqlite.prepare('SELECT * FROM primes WHERE id = ?').get(id));
}

export async function deletePrime(id) {
  if (driver.kind === 'pg') {
    await driver.pool.query('DELETE FROM primes WHERE id = $1', [id]);
  } else {
    driver.sqlite.prepare('DELETE FROM primes WHERE id = ?').run(id);
  }
}

// ---------- Métier : Clients ----------

function normalizeClient(row) {
  if (!row) return null;
  return {
    id: row.id,
    nom: row.nom,
    secteur: row.secteur || '',
    primeId: row.prime_id ?? null,
    statut: row.statut || 'actif',
  };
}

export async function listClients() {
  if (driver.kind === 'pg') {
    const r = await driver.pool.query('SELECT * FROM clients ORDER BY nom ASC');
    return r.rows.map(normalizeClient);
  }
  return driver.sqlite.prepare('SELECT * FROM clients ORDER BY nom ASC').all().map(normalizeClient);
}

export async function createClient({ nom, secteur, primeId, statut }) {
  if (driver.kind === 'pg') {
    const r = await driver.pool.query(
      `INSERT INTO clients (nom, secteur, prime_id, statut) VALUES ($1,$2,$3,$4) RETURNING *`,
      [nom, secteur || '', primeId ?? null, statut || 'actif']
    );
    return normalizeClient(r.rows[0]);
  }
  const info = driver.sqlite.prepare(
    `INSERT INTO clients (nom, secteur, prime_id, statut) VALUES (?,?,?,?)`
  ).run(nom, secteur || '', primeId ?? null, statut || 'actif');
  return normalizeClient(driver.sqlite.prepare('SELECT * FROM clients WHERE id = ?').get(info.lastInsertRowid));
}

export async function updateClient(id, { nom, secteur, primeId, statut }) {
  if (driver.kind === 'pg') {
    const r = await driver.pool.query(
      `UPDATE clients SET nom=$1, secteur=$2, prime_id=$3, statut=$4 WHERE id=$5 RETURNING *`,
      [nom, secteur || '', primeId ?? null, statut || 'actif', id]
    );
    return normalizeClient(r.rows[0]);
  }
  driver.sqlite.prepare(
    `UPDATE clients SET nom=?, secteur=?, prime_id=?, statut=? WHERE id=?`
  ).run(nom, secteur || '', primeId ?? null, statut || 'actif', id);
  return normalizeClient(driver.sqlite.prepare('SELECT * FROM clients WHERE id = ?').get(id));
}

export async function deleteClient(id) {
  if (driver.kind === 'pg') {
    await driver.pool.query('DELETE FROM clients WHERE id = $1', [id]);
  } else {
    driver.sqlite.prepare('DELETE FROM clients WHERE id = ?').run(id);
  }
}

// ---------- Métier : Suivis ----------

function normalizeSuivi(row) {
  if (!row) return null;
  return {
    id: row.id,
    titre: row.titre,
    clientId: row.client_id ?? null,
    primeId: row.prime_id ?? null,
    statut: row.statut || 'a_faire',
    echeance: row.echeance || null,
    note: row.note || null,
  };
}

export async function listSuivis() {
  if (driver.kind === 'pg') {
    const r = await driver.pool.query('SELECT * FROM suivis ORDER BY echeance ASC NULLS LAST, id ASC');
    return r.rows.map(normalizeSuivi);
  }
  return driver.sqlite.prepare('SELECT * FROM suivis ORDER BY echeance ASC, id ASC').all().map(normalizeSuivi);
}

export async function createSuivi({ titre, clientId, primeId, statut, echeance, note }) {
  if (driver.kind === 'pg') {
    const r = await driver.pool.query(
      `INSERT INTO suivis (titre, client_id, prime_id, statut, echeance, note)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [titre, clientId ?? null, primeId ?? null, statut || 'a_faire', echeance || null, note || null]
    );
    return normalizeSuivi(r.rows[0]);
  }
  const info = driver.sqlite.prepare(
    `INSERT INTO suivis (titre, client_id, prime_id, statut, echeance, note) VALUES (?,?,?,?,?,?)`
  ).run(titre, clientId ?? null, primeId ?? null, statut || 'a_faire', echeance || null, note || null);
  return normalizeSuivi(driver.sqlite.prepare('SELECT * FROM suivis WHERE id = ?').get(info.lastInsertRowid));
}

export async function updateSuivi(id, { titre, clientId, primeId, statut, echeance, note }) {
  if (driver.kind === 'pg') {
    const r = await driver.pool.query(
      `UPDATE suivis SET titre=$1, client_id=$2, prime_id=$3, statut=$4, echeance=$5, note=$6 WHERE id=$7 RETURNING *`,
      [titre, clientId ?? null, primeId ?? null, statut || 'a_faire', echeance || null, note || null, id]
    );
    return normalizeSuivi(r.rows[0]);
  }
  driver.sqlite.prepare(
    `UPDATE suivis SET titre=?, client_id=?, prime_id=?, statut=?, echeance=?, note=? WHERE id=?`
  ).run(titre, clientId ?? null, primeId ?? null, statut || 'a_faire', echeance || null, note || null, id);
  return normalizeSuivi(driver.sqlite.prepare('SELECT * FROM suivis WHERE id = ?').get(id));
}

export async function deleteSuivi(id) {
  if (driver.kind === 'pg') {
    await driver.pool.query('DELETE FROM suivis WHERE id = $1', [id]);
  } else {
    driver.sqlite.prepare('DELETE FROM suivis WHERE id = ?').run(id);
  }
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
