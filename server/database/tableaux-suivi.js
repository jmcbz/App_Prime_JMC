// Follow-up boards are independent of legacy suivis. An active board is unique per client.
export const RUBRIQUES = Object.freeze([
  'plan_directeur', 'projets', 'rencontre', 'comite_ti', 'backups',
  'routeur', 'serveur_sur_place', 'vm_bz', 'ia_agentique',
]);
const VERSIONS = new Set(['routeur', 'serveur_sur_place', 'vm_bz']);
const STATUTS = new Set(['a_faire', 'en_cours', 'bloque', 'termine']);
const failure = (statusCode, message) => Object.assign(new Error(message), { statusCode });

function shaped(row, rubriques) {
  return { id: row.id, clientId: row.client_id, createdAt: row.created_at,
    archivedAt: row.archived_at ?? null, rubriques: rubriques.map(r => ({
      key: r.key, statut: r.statut, date: r.date, note: r.note,
      prochaineAction: r.prochaine_action, prochaineActionEcheance: r.prochaine_action_echeance, version: r.version,
    })) };
}
function readOne(driver, id, connection = null) {
  const q = connection || driver.pool;
  if (driver.kind === 'pg') {
    return (async () => {
      const row = (await q.query('SELECT * FROM tableaux_suivi WHERE id = $1', [id])).rows[0];
      if (!row) return null;
      const rubriques = (await q.query('SELECT * FROM tableau_rubriques WHERE tableau_id = $1', [id])).rows;
      return shaped(row, RUBRIQUES.map(key => rubriques.find(r => r.key === key)));
    })();
  }
  const row = driver.sqlite.prepare('SELECT * FROM tableaux_suivi WHERE id = ?').get(id);
  if (!row) return null;
  const rubriques = driver.sqlite.prepare('SELECT * FROM tableau_rubriques WHERE tableau_id = ?').all(id);
  return shaped(row, RUBRIQUES.map(key => rubriques.find(r => r.key === key)));
}
function insertSqlite(driver, clientId) {
  driver.sqlite.prepare("UPDATE tableaux_suivi SET archived_at = datetime('now') WHERE client_id = ? AND archived_at IS NULL").run(clientId);
  const id = driver.sqlite.prepare('INSERT INTO tableaux_suivi (client_id) VALUES (?)').run(clientId).lastInsertRowid;
  const insert = driver.sqlite.prepare('INSERT INTO tableau_rubriques (tableau_id, key) VALUES (?, ?)');
  for (const key of RUBRIQUES) insert.run(id, key);
  return Number(id);
}
export function createInitialTableauSqlite(driver, clientId) { insertSqlite(driver, clientId); }
async function insertPg(connection, clientId) {
  await connection.query('UPDATE tableaux_suivi SET archived_at = CURRENT_TIMESTAMP WHERE client_id = $1 AND archived_at IS NULL', [clientId]);
  const id = (await connection.query('INSERT INTO tableaux_suivi (client_id) VALUES ($1) RETURNING id', [clientId])).rows[0].id;
  for (const key of RUBRIQUES) await connection.query('INSERT INTO tableau_rubriques (tableau_id, key) VALUES ($1,$2)', [id, key]);
  return id;
}

export async function createTableauForClient(driver, clientId, connection = null, userId = null, admin = false, expectedActiveId = null) {
  if (driver.kind === 'pg') {
    const tx = connection || await driver.pool.connect();
    try {
      if (!connection) await tx.query('BEGIN');
      // Serializes replacements and transfers against this client's current ownership.
      const client = (await tx.query('SELECT prime_id FROM clients WHERE id = $1 FOR UPDATE', [clientId])).rows[0];
      if (!client) throw failure(404, 'Client introuvable');
      if (userId !== null && !admin) {
        const link = await tx.query('SELECT 1 FROM prime_user_links WHERE user_id = $1 AND prime_id = $2', [userId, client.prime_id]);
        if (!link.rowCount) throw failure(404, 'Client introuvable');
      }
      if (userId !== null) {
        const current = (await tx.query('SELECT id FROM tableaux_suivi WHERE client_id = $1 AND archived_at IS NULL', [clientId])).rows[0];
        if ((current?.id ?? null) !== expectedActiveId) throw failure(409, 'Tableau modifié depuis son ouverture; rechargez les tableaux avant de réessayer');
      }
      const id = await insertPg(tx, clientId);
      const board = await readOne(driver, id, tx);
      if (!connection) await tx.query('COMMIT');
      return board;
    } catch (error) { if (!connection) await tx.query('ROLLBACK'); throw error; }
    finally { if (!connection) tx.release(); }
  }
  const run = () => {
    const client = driver.sqlite.prepare('SELECT prime_id FROM clients WHERE id = ?').get(clientId);
    if (!client) throw failure(404, 'Client introuvable');
    if (userId !== null && !admin && !driver.sqlite.prepare(
      'SELECT 1 FROM prime_user_links WHERE user_id = ? AND prime_id = ?').get(userId, client.prime_id)) {
      throw failure(404, 'Client introuvable');
    }
    if (userId !== null) {
      const current = driver.sqlite.prepare('SELECT id FROM tableaux_suivi WHERE client_id = ? AND archived_at IS NULL').get(clientId);
      if ((current?.id ?? null) !== expectedActiveId) throw failure(409, 'Tableau modifié depuis son ouverture; rechargez les tableaux avant de réessayer');
    }
    return readOne(driver, insertSqlite(driver, clientId));
  };
  // Nested transactions are savepoints when called from the existing seed transaction.
  return driver.sqlite.transaction(run).immediate();
}

export async function backfillTableaux(driver) {
  if (driver.kind === 'pg') {
    const tx = await driver.pool.connect();
    try {
      await tx.query('BEGIN');
      await tx.query("SELECT pg_advisory_xact_lock(hashtext('app-prime-tableaux-backfill-v1'))");
      const rows = (await tx.query(`SELECT c.id FROM clients c WHERE NOT EXISTS
        (SELECT 1 FROM tableaux_suivi t WHERE t.client_id = c.id) ORDER BY c.id`)).rows;
      for (const row of rows) {
        const inserted = await tx.query(`INSERT INTO tableaux_suivi (client_id) VALUES ($1)
          ON CONFLICT (client_id) WHERE archived_at IS NULL DO NOTHING RETURNING id`, [row.id]);
        if (inserted.rowCount) for (const key of RUBRIQUES) {
          await tx.query('INSERT INTO tableau_rubriques (tableau_id, key) VALUES ($1,$2)', [inserted.rows[0].id, key]);
        }
      }
      await tx.query('COMMIT');
    } catch (error) { await tx.query('ROLLBACK'); throw error; }
    finally { tx.release(); }
  } else {
    driver.sqlite.transaction(() => {
      const rows = driver.sqlite.prepare(`SELECT c.id FROM clients c WHERE NOT EXISTS
        (SELECT 1 FROM tableaux_suivi t WHERE t.client_id = c.id) ORDER BY c.id`).all();
      for (const row of rows) insertSqlite(driver, row.id);
    }).immediate();
  }
}

export async function listTableaux(driver, userId, admin) {
  const scope = admin ? '' : `JOIN prime_user_links link ON link.prime_id = c.prime_id`;
  const where = admin ? '' : `WHERE link.user_id = ${driver.kind === 'pg' ? '$1' : '?'}`;
  // One statement snapshots ownership and all rubric data together, even during a transfer.
  const sql = `SELECT t.*, r.key AS rubrique_key, r.statut AS rubrique_statut,
    r.date AS rubrique_date, r.note AS rubrique_note, r.prochaine_action AS rubrique_prochaine_action,
    r.prochaine_action_echeance AS rubrique_prochaine_action_echeance,
    r.version AS rubrique_version
    FROM tableaux_suivi t JOIN clients c ON c.id = t.client_id ${scope}
    JOIN tableau_rubriques r ON r.tableau_id = t.id ${where} ORDER BY t.client_id, t.id`;
  const rows = driver.kind === 'pg'
    ? (await driver.pool.query(sql, admin ? [] : [userId])).rows
    : driver.sqlite.prepare(sql).all(...(admin ? [] : [userId]));
  const boards = new Map();
  for (const row of rows) {
    if (!boards.has(row.id)) boards.set(row.id, { row, rubriques: new Map() });
    boards.get(row.id).rubriques.set(row.rubrique_key, {
      key: row.rubrique_key, statut: row.rubrique_statut, date: row.rubrique_date,
      note: row.rubrique_note, prochaine_action: row.rubrique_prochaine_action,
      prochaine_action_echeance: row.rubrique_prochaine_action_echeance, version: row.rubrique_version,
    });
  }
  return [...boards.values()].map(({ row, rubriques }) => shaped(row, RUBRIQUES.map(key => rubriques.get(key))));
}

function validCalendarDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export function validateRubrique(key, input) {
  if (!RUBRIQUES.includes(key)) throw failure(400, 'Rubrique invalide');
  if (!input || !STATUTS.has(input.statut) ||
    (input.date !== null && !validCalendarDate(input.date)) ||
    (input.prochaineActionEcheance !== undefined && input.prochaineActionEcheance !== null &&
      !validCalendarDate(input.prochaineActionEcheance)) ||
    typeof input.note !== 'string' || typeof input.prochaineAction !== 'string' ||
    (VERSIONS.has(key) ? input.version !== null && typeof input.version !== 'string' : input.version !== null)) {
    throw failure(400, 'Valeurs de rubrique invalides');
  }
}

export async function updateRubrique(driver, id, key, input, userId, admin) {
  validateRubrique(key, input);
  const hasEcheance = input.prochaineActionEcheance !== undefined;
  const echeance = hasEcheance ? input.prochaineActionEcheance : null;
  if (driver.kind === 'pg') {
    const tx = await driver.pool.connect();
    try {
      await tx.query('BEGIN');
      const target = (await tx.query('SELECT client_id FROM tableaux_suivi WHERE id = $1', [id])).rows[0];
      if (!target) throw failure(404, 'Tableau introuvable');
      // Same lock order as board replacement and client transfer: client, then board.
      const client = (await tx.query('SELECT prime_id FROM clients WHERE id = $1 FOR UPDATE', [target.client_id])).rows[0];
      const current = (await tx.query('SELECT archived_at FROM tableaux_suivi WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!client || !current) throw failure(404, 'Tableau introuvable');
      const row = { prime_id: client.prime_id, archived_at: current.archived_at };
      if (!admin && !(await tx.query('SELECT 1 FROM prime_user_links WHERE user_id = $1 AND prime_id = $2', [userId, row.prime_id])).rowCount)
        throw failure(404, 'Tableau introuvable');
      if (row.archived_at !== null) throw failure(409, 'Tableau archivé');
      await tx.query(`UPDATE tableau_rubriques SET statut=$1, date=$2, note=$3, prochaine_action=$4,
        prochaine_action_echeance=CASE WHEN $5=1 THEN $6 ELSE prochaine_action_echeance END,
        version=$7 WHERE tableau_id=$8 AND key=$9`,
      [input.statut, input.date, input.note, input.prochaineAction, Number(hasEcheance), echeance, input.version, id, key]);
      const board = await readOne(driver, id, tx);
      await tx.query('COMMIT');
      return board;
    } catch (error) { await tx.query('ROLLBACK'); throw error; }
    finally { tx.release(); }
  }
  return driver.sqlite.transaction(() => {
    const row = driver.sqlite.prepare(`SELECT t.archived_at, c.prime_id FROM tableaux_suivi t
      JOIN clients c ON c.id = t.client_id WHERE t.id = ?`).get(id);
    if (!row || (!admin && !driver.sqlite.prepare('SELECT 1 FROM prime_user_links WHERE user_id = ? AND prime_id = ?').get(userId, row.prime_id)))
      throw failure(404, 'Tableau introuvable');
    if (row.archived_at !== null) throw failure(409, 'Tableau archivé');
    driver.sqlite.prepare(`UPDATE tableau_rubriques SET statut=?, date=?, note=?, prochaine_action=?,
      prochaine_action_echeance=CASE WHEN ?=1 THEN ? ELSE prochaine_action_echeance END,
      version=? WHERE tableau_id=? AND key=?`).run(
      input.statut, input.date, input.note, input.prochaineAction, Number(hasEcheance), echeance, input.version, id, key);
    return readOne(driver, id);
  }).immediate();
}
