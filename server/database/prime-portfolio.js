// Atomic App Prime portfolio update. No writes are sent to Servo.
import { createInitialTableauSqlite, createTableauForClient } from './tableaux-suivi.js';
const conflict = (message) => Object.assign(new Error(message), { statusCode: 409 });
const validId = (value) => Number.isSafeInteger(value) && value > 0;

function plan(rows, primeId, changes, normalizeClient, parseData) {
  const clients = rows.map(normalizeClient);
  const remove = changes.remove || [];
  const add = changes.add || [];
  if (!Array.isArray(remove) || !Array.isArray(add) || remove.length > 1000 || add.length > 1000 ||
    remove.some((id) => !validId(id)) || new Set(remove).size !== remove.length ||
    add.some((c) => !c || !validId(c.id) || typeof c.nom !== 'string' || !c.nom.trim()) ||
    new Set(add.map((c) => c.id)).size !== add.length) {
    throw Object.assign(new Error('Sélection de clients invalide'), { statusCode: 400 });
  }
  for (const id of remove) {
    if (!clients.some((c) => c.id === id && c.primeId === primeId)) throw conflict('Association modifiée depuis l’ouverture : rechargez le Prime');
  }
  const assign = [], create = [];
  for (const remote of add) {
    const matchesId = clients.filter((c) => c.servoClientId === remote.id);
    if (matchesId.length > 1) throw conflict('Identifiant Servo déjà présent plusieurs fois dans App Prime');
    const existing = matchesId[0];
    if (existing && existing.primeId !== null && existing.primeId !== primeId) throw conflict(`${remote.nom} est associé à un autre Prime`);
    if (existing && remove.includes(existing.id)) throw conflict('Un client ne peut pas être ajouté et retiré simultanément');
    if (!existing) create.push(remote);
    else if (existing.primeId !== primeId || !existing.servoClientId) {
      const row = rows.find((r) => r.id === existing.id);
      assign.push({ id: existing.id, data: { ...parseData(row.data), servoClientId: remote.id } });
    }
  }
  return { remove, assign, create };
}

function sqlFields(table, data, legacyValues) {
  return { data: JSON.stringify(data), ...legacyValues(table, data) };
}

export async function applyPrimePortfolio(driver, helpers, id, prime, changes) {
  if (!validId(id) || !prime || typeof prime.nom !== 'string' || !prime.nom.trim()) {
    throw Object.assign(new Error('Prime invalide'), { statusCode: 400 });
  }
  const { primeData, clientData, legacyValues, normalizeClient, normalizePrime, parseData } = helpers;
  const data = primeData(prime);
  if (driver.kind === 'sqlite') {
    return driver.sqlite.transaction(() => {
      const sqlite = driver.sqlite;
      const existingPrime = sqlite.prepare('SELECT * FROM primes WHERE id = ?').get(id);
      if (!existingPrime) return null;
      const rows = sqlite.prepare('SELECT * FROM clients ORDER BY id').all();
      const actions = plan(rows, id, changes, normalizeClient, parseData);
      const fields = sqlFields('primes', data, legacyValues);
      sqlite.prepare(`UPDATE primes SET ${Object.keys(fields).map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
        .run(...Object.values(fields), id);
      for (const clientId of actions.remove) {
        const result = sqlite.prepare("UPDATE clients SET prime_id = NULL, updated_at = datetime('now') WHERE id = ? AND prime_id = ?").run(clientId, id);
        if (result.changes !== 1) throw conflict('Association modifiée pendant la sauvegarde');
      }
      for (const client of actions.assign) {
        const result = sqlite.prepare("UPDATE clients SET prime_id = ?, data = ?, updated_at = datetime('now') WHERE id = ? AND (prime_id IS NULL OR prime_id = ?)")
          .run(id, JSON.stringify(client.data), client.id, id);
        if (result.changes !== 1) throw conflict('Association modifiée pendant la sauvegarde');
      }
      for (const remote of actions.create) {
        const fields = { prime_id: id, ...sqlFields('clients', clientData({ nom: remote.nom, secteur: '', statut: 'actif', servoClientId: remote.id }), legacyValues) };
        const created = sqlite.prepare(`INSERT INTO clients (${Object.keys(fields).join(', ')}) VALUES (${Object.keys(fields).map(() => '?').join(', ')})`)
          .run(...Object.values(fields));
        createInitialTableauSqlite(driver, created.lastInsertRowid);
      }
      return { prime: normalizePrime(sqlite.prepare('SELECT * FROM primes WHERE id = ?').get(id)),
        clients: sqlite.prepare('SELECT * FROM clients WHERE prime_id = ? ORDER BY id').all(id).map(normalizeClient) };
    }).immediate();
  }

  const connection = await driver.pool.connect();
  try {
    await connection.query('BEGIN');
    await connection.query("SELECT pg_advisory_xact_lock(hashtext('app-prime-servo-portfolio-v1'))");
    const existingPrime = (await connection.query('SELECT * FROM primes WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!existingPrime) { await connection.query('ROLLBACK'); return null; }
    const rows = (await connection.query('SELECT * FROM clients ORDER BY id FOR UPDATE')).rows;
    const actions = plan(rows, id, changes, normalizeClient, parseData);
    const fields = sqlFields('primes', data, legacyValues);
    const columns = Object.keys(fields), values = Object.values(fields);
    const updated = (await connection.query(`UPDATE primes SET ${columns.map((k, i) => `${k} = $${i + 1}${k === 'data' || k === 'specialites' ? '::jsonb' : ''}`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${columns.length + 1} RETURNING *`, [...values, id])).rows[0];
    for (const clientId of actions.remove) {
      const result = await connection.query('UPDATE clients SET prime_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND prime_id = $2 RETURNING id', [clientId, id]);
      if (result.rowCount !== 1) throw conflict('Association modifiée pendant la sauvegarde');
    }
    for (const client of actions.assign) {
      const result = await connection.query('UPDATE clients SET prime_id = $1, data = $2::jsonb, updated_at = CURRENT_TIMESTAMP WHERE id = $3 AND (prime_id IS NULL OR prime_id = $1) RETURNING id', [id, JSON.stringify(client.data), client.id]);
      if (result.rowCount !== 1) throw conflict('Association modifiée pendant la sauvegarde');
    }
    for (const remote of actions.create) {
      const fields = { prime_id: id, ...sqlFields('clients', clientData({ nom: remote.nom, secteur: '', statut: 'actif', servoClientId: remote.id }), legacyValues) };
      const cols = Object.keys(fields);
      const created = await connection.query(`INSERT INTO clients (${cols.join(', ')}) VALUES (${cols.map((k, i) => `$${i + 1}${k === 'data' ? '::jsonb' : ''}`).join(', ')}) RETURNING id`, Object.values(fields));
      await createTableauForClient(driver, created.rows[0].id, connection);
    }
    const clients = (await connection.query('SELECT * FROM clients WHERE prime_id = $1 ORDER BY id', [id])).rows.map(normalizeClient);
    await connection.query('COMMIT');
    return { prime: normalizePrime(updated), clients };
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  } finally { connection.release(); }
}
