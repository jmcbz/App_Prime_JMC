import test from 'node:test';
import assert from 'node:assert/strict';
import Sqlite from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkSqliteMetierIdentity } from './database/metier-migration.js';
import { listTableaux, RUBRIQUES } from './database/tableaux-suivi.js';

test('existing board tables with incompatible ownership are rejected before migration', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-prime-board-schema-'));
  process.env.SQLITE_PATH = path.join(dir, 'schema.sqlite');
  process.env.APP_PRIME_ALLOW_NEW_DATABASE = '1';
  delete process.env.DATABASE_URL;
  const db = await import('./database/index.js');
  const { sqlite } = await db.initDb();
  try {
    const originals = Object.fromEntries(['tableaux_suivi','tableau_rubriques'].map(name =>
      [name, sqlite.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(name).sql]));
    sqlite.exec(`DROP TABLE tableau_rubriques;
      CREATE TABLE tableau_rubriques (tableau_id INTEGER NOT NULL, key TEXT NOT NULL,
        statut TEXT NOT NULL DEFAULT 'a_faire', date TEXT, note TEXT NOT NULL DEFAULT '',
        prochaine_action TEXT NOT NULL DEFAULT '', version TEXT, PRIMARY KEY (tableau_id, key));`);
    assert.throws(() => checkSqliteMetierIdentity(sqlite), /tableau_rubriques/);
    sqlite.exec(`DROP TABLE tableau_rubriques; ${originals.tableau_rubriques}`);
    sqlite.pragma('foreign_keys = OFF');
    sqlite.exec(`DROP TABLE tableaux_suivi;
      CREATE TABLE tableaux_suivi (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')), archived_at TEXT);`);
    sqlite.pragma('foreign_keys = ON');
    assert.throws(() => checkSqliteMetierIdentity(sqlite), /tableaux_suivi/);
  } finally { sqlite.close(); fs.rmSync(dir, { recursive:true, force:true }); }
});

test('scoped board listing never reads rubric data after ownership transfers', async () => {
  const sqlite = new Sqlite(':memory:');
  try {
    sqlite.exec(`
      CREATE TABLE clients (id INTEGER PRIMARY KEY, prime_id INTEGER);
      CREATE TABLE prime_user_links (user_id INTEGER, prime_id INTEGER);
      CREATE TABLE tableaux_suivi (id INTEGER PRIMARY KEY, client_id INTEGER, created_at TEXT, archived_at TEXT);
      CREATE TABLE tableau_rubriques (tableau_id INTEGER, key TEXT, statut TEXT, date TEXT, note TEXT, prochaine_action TEXT, version TEXT);
      INSERT INTO clients VALUES (1, 10);
      INSERT INTO prime_user_links VALUES (100, 10);
      INSERT INTO tableaux_suivi VALUES (5, 1, 'initial', NULL);
    `);
    const insert = sqlite.prepare("INSERT INTO tableau_rubriques VALUES (5, ?, 'a_faire', NULL, ?, '', NULL)");
    for (const key of RUBRIQUES) insert.run(key, key === 'routeur' ? 'before transfer' : '');
    let transferred = false;
    const driver = { kind: 'sqlite', sqlite: {
      prepare(sql) {
        const stmt = sqlite.prepare(sql);
        return { all(...args) {
          const rows = stmt.all(...args);
          if (sql.includes('prime_user_links') && !transferred) {
            sqlite.exec("UPDATE clients SET prime_id = 20 WHERE id = 1; UPDATE tableau_rubriques SET note = 'after transfer' WHERE tableau_id = 5 AND key = 'routeur'");
            transferred = true;
          }
          return rows;
        }, get(...args) { return stmt.get(...args); } };
      },
    } };
    const boards = await listTableaux(driver, 100, false);
    assert.equal(transferred, true);
    assert.equal(sqlite.prepare('SELECT prime_id FROM clients WHERE id = 1').get().prime_id, 20);
    assert.deepEqual(boards.map(board => board.id), [5]);
    assert.deepEqual(boards[0].rubriques.map(r => r.key), RUBRIQUES);
    assert.equal(boards[0].rubriques.find(r => r.key === 'routeur').note, 'before transfer');
    assert.deepEqual(await listTableaux({ kind: 'sqlite', sqlite }, 100, false), []);
  } finally { sqlite.close(); }
});
