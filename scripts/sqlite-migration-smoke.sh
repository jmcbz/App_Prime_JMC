#!/usr/bin/env bash
set -euo pipefail
if [ "$(readlink /proc/self/ns/net)" = "$(readlink /proc/1/ns/net)" ]; then
  echo 'Refusing to run outside a network namespace' >&2
  exit 1
fi
unset DATABASE_URL database_url PGOPTIONS PGPASSWORD
export SQLITE_PATH="${TMPDIR:-/root/.hermes/cache/scratch}/appprime-sqlite-$$_${RANDOM}.db"
export MODE="${1:-populated}"
if [ "$MODE" = fresh ]; then export APP_PRIME_ALLOW_NEW_DATABASE=1; fi
trap 'rm -f "$SQLITE_PATH" "$SQLITE_PATH-wal" "$SQLITE_PATH-shm"' EXIT
if [ "$MODE" = prod_no_db ]; then
  NODE_ENV=production node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as db from './server/database/index.js';
await assert.rejects(() => db.initDb(), /DATABASE_URL requis en production/);
assert.equal(fs.existsSync(process.env.SQLITE_PATH), false);
console.log('PRODUCTION_WITHOUT_POSTGRES_REFUSED_PASS');
JS
  exit 0
fi
if [ "$MODE" = populated ] || [ "$MODE" = foreign_owner ] || [ "$MODE" = rollback ] || [ "$MODE" = rollback_data ] || [ "$MODE" = partial_json ] || [ "$MODE" = foreign_constraints ] || [ "$MODE" = foreign_delete ] || [ "$MODE" = race ] || [ "$MODE" = partial_data ]; then
node --input-type=module <<'JS'
import { createRequire } from 'node:module';
const require = createRequire(new URL('./server/database/index.js', import.meta.url));
const SQLite = require('better-sqlite3');
const db = new SQLite(process.env.SQLITE_PATH);
db.exec(`
CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL, prenom TEXT NOT NULL DEFAULT '', nom TEXT NOT NULL DEFAULT '',
 role TEXT NOT NULL DEFAULT 'prime', is_active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE user_mfa (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 secret_encrypted TEXT NOT NULL, mfa_enabled INTEGER NOT NULL DEFAULT 0,
 pending_setup INTEGER NOT NULL DEFAULT 1, enabled_at TEXT,
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE primes (id INTEGER PRIMARY KEY AUTOINCREMENT, nom TEXT NOT NULL,
 code_titan TEXT NOT NULL DEFAULT '', specialites TEXT NOT NULL DEFAULT '[]',
 disponibilite TEXT NOT NULL DEFAULT 'disponible', avatar_initiales TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE clients (id INTEGER PRIMARY KEY AUTOINCREMENT, nom TEXT NOT NULL,
 secteur TEXT NOT NULL DEFAULT '', prime_id INTEGER REFERENCES primes(id) ON DELETE SET NULL,
 statut TEXT NOT NULL DEFAULT 'actif', created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE suivis (id INTEGER PRIMARY KEY AUTOINCREMENT, titre TEXT NOT NULL,
 client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
 prime_id INTEGER REFERENCES primes(id) ON DELETE SET NULL,
 statut TEXT NOT NULL DEFAULT 'a_faire', echeance TEXT, note TEXT,
 created_at TEXT NOT NULL DEFAULT (datetime('now')));
INSERT INTO primes (nom, code_titan, specialites) VALUES ('Ancien Prime', 'A1', '["M365"]');
INSERT INTO clients (nom, secteur, prime_id) VALUES ('Ancien Client', 'Test', 1);
INSERT INTO suivis (titre, client_id, prime_id, note) VALUES ('Ancien Suivi', 1, 1, 'Conserver');
`);
if (process.env.MODE === 'foreign_owner') db.exec('CREATE TABLE other_app_records (id INTEGER PRIMARY KEY)');
if (process.env.MODE === 'foreign_constraints') db.exec(`DROP TABLE clients;
  CREATE TABLE clients (id INTEGER PRIMARY KEY AUTOINCREMENT, nom TEXT NOT NULL, secteur TEXT,
    prime_id INTEGER, statut TEXT, contact_nom TEXT, contact_email TEXT, notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  INSERT INTO clients (id,nom,secteur,prime_id,statut) VALUES (1,'Client ancien','Services',1,'actif');`);
if (process.env.MODE === 'foreign_delete') db.exec(`DROP TABLE clients;
  CREATE TABLE clients (id INTEGER PRIMARY KEY AUTOINCREMENT, nom TEXT NOT NULL,
    secteur TEXT NOT NULL DEFAULT '', prime_id INTEGER REFERENCES primes(id) ON DELETE CASCADE,
    statut TEXT NOT NULL DEFAULT 'actif', created_at TEXT NOT NULL DEFAULT (datetime('now')));
  INSERT INTO clients (id,nom,secteur,prime_id,statut) VALUES (1,'Client ancien','Services',1,'actif');`);
if (process.env.MODE === 'rollback') db.exec("UPDATE primes SET specialites='not-json' WHERE id=1");
if (process.env.MODE === 'rollback_data') db.exec("ALTER TABLE primes ADD COLUMN data TEXT; UPDATE primes SET data='not-json' WHERE id=1");
if (process.env.MODE === 'partial_json') db.exec(`
  ALTER TABLE primes ADD COLUMN data TEXT;
  ALTER TABLE clients ADD COLUMN data TEXT;
  ALTER TABLE suivis ADD COLUMN data TEXT;
  UPDATE primes SET data='{"disponibilite":"charge"}' WHERE id=1;
  UPDATE clients SET data='{"statut":"actif"}' WHERE id=1;
  UPDATE suivis SET data='{"note":"JSON conservé"}' WHERE id=1;
`);
if (process.env.MODE === 'partial_data') db.exec('DELETE FROM suivis; DELETE FROM primes; UPDATE clients SET prime_id=NULL');
db.close();
JS
fi
if [ "$MODE" = race ]; then
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const require = createRequire(new URL('./server/database/index.js', import.meta.url));
const SQLite=require('better-sqlite3');
const blocker=new SQLite(process.env.SQLITE_PATH);
blocker.exec('BEGIN IMMEDIATE');
const worker="const db=await import('./server/database/index.js');const c=await db.initDb();await db.seedMetier();c.sqlite.close();";
const children=[0,1].map(()=>spawn(process.execPath,['--input-type=module','-e',worker],{
  env:process.env,stdio:['ignore','pipe','pipe'],
}));
const exits=children.map(child=>new Promise((resolve,reject)=>{
  let stderr='';
  child.stderr.on('data',data=>stderr+=String(data));
  child.on('exit',code=>code===0?resolve():reject(new Error(`SQLite parallel boot failed: ${stderr.slice(-450)}`)));
}));
await new Promise(resolve=>setTimeout(resolve,650));
blocker.exec('COMMIT');blocker.close();
await Promise.all(exits);
const db=new SQLite(process.env.SQLITE_PATH);
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM primes').get().n,1);
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM clients').get().n,1);
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM suivis').get().n,1);
db.close();
console.log('SQLITE_CONCURRENT_LEGACY_BOOT_PASS');
JS
exit 0
fi
if [ "$MODE" = partial_data ]; then
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import * as db from './server/database/index.js';
const connection=await db.initDb();
assert.equal(await db.seedMetier(),false,'any existing métier row must suppress demo seed');
assert.equal((await db.listPrimes()).length,0);
assert.equal((await db.listClients()).length,1);
assert.equal((await db.listSuivis()).length,0);
assert.equal((await db.listClients())[0].nom,'Ancien Client');
connection.sqlite.close();
console.log('SQLITE_PARTIAL_REAL_DATA_NO_DEMO_PASS');
JS
exit 0
fi
if [ "$MODE" = partial_json ]; then
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import * as db from './server/database/index.js';
const connection=await db.initDb();
assert.equal((await db.listPrimes())[0].nom,'Ancien Prime');
assert.deepEqual((await db.listPrimes())[0].specialites,['M365']);
assert.equal((await db.listPrimes())[0].disponibilite,'charge');
assert.equal((await db.listClients())[0].nom,'Ancien Client');
assert.equal((await db.listSuivis())[0].titre,'Ancien Suivi');
assert.equal((await db.listSuivis())[0].note,'JSON conservé');
for (const [table,field,expected] of [['primes','nom','Ancien Prime'],['clients','nom','Ancien Client'],['suivis','titre','Ancien Suivi']]) {
  const data=JSON.parse(connection.sqlite.prepare(`SELECT data FROM ${table} WHERE id=1`).get().data);
  assert.equal(data[field],expected);
}
connection.sqlite.close();
console.log('SQLITE_PARTIAL_JSON_RECONCILED_PASS');
JS
exit 0
fi
if [ "$MODE" = foreign_owner ] || [ "$MODE" = rollback ] || [ "$MODE" = rollback_data ] || [ "$MODE" = foreign_constraints ] || [ "$MODE" = foreign_delete ] || [ "$MODE" = unowned_empty ]; then
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(new URL('./server/database/index.js', import.meta.url));
const SQLite = require('better-sqlite3');
import * as db from './server/database/index.js';
const inspect = () => {
  const conn = new SQLite(process.env.SQLITE_PATH);
  const schema = conn.prepare("SELECT type, name, sql FROM sqlite_master WHERE type IN ('table','index') ORDER BY type,name").all();
  const rows = Object.fromEntries(schema.filter(item => item.type === 'table').map(item =>
    [item.name, conn.prepare(`SELECT * FROM ${item.name} ORDER BY rowid`).all()]));
  const journalMode = conn.pragma('journal_mode', { simple: true });
  conn.close();
  return { schema, rows, journalMode };
};
const before = inspect();
const expected = process.env.MODE === 'rollback' ? /specialites JSON invalide/ : process.env.MODE === 'rollback_data' ? /data JSON invalide/ : process.env.MODE === 'unowned_empty' ? /Base App Prime non reconnue/ : /Schéma étranger à App Prime/;
await assert.rejects(() => db.initDb(), expected);
assert.deepEqual(inspect(), before, 'rejected initialization must not change any schema objects');
console.log(process.env.MODE === 'rollback' ? 'SQLITE_SCHEMA_ROLLBACK_PASS' : process.env.MODE === 'rollback_data' ? 'SQLITE_INVALID_DATA_ROLLBACK_PASS' : process.env.MODE === 'foreign_delete' ? 'SQLITE_FOREIGN_DELETE_ACTION_UNTOUCHED_PASS' : process.env.MODE === 'foreign_constraints' ? 'SQLITE_FOREIGN_CONSTRAINTS_UNTOUCHED_PASS' : process.env.MODE === 'unowned_empty' ? 'SQLITE_UNOWNED_EMPTY_UNTOUCHED_PASS' : 'SQLITE_FOREIGN_OWNER_UNTOUCHED_PASS');
JS
exit 0
fi
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import * as db from './server/database/index.js';
const conn = await db.initDb();
assert.equal(conn.kind, 'sqlite');
if ((await db.listPrimes()).length === 0) {
  assert.equal(await db.seedMetier(), true);
  assert.equal((await db.listPrimes()).length, 4);
} else {
  assert.equal(await db.seedMetier(), false);
  assert.deepEqual((await db.listPrimes())[0].specialites, ['M365']);
  assert.equal((await db.listClients())[0].primeId, 1);
  assert.equal((await db.listSuivis())[0].note, 'Conserver');
  await db.updatePrime(1, {nom:'Prime modifié',codeTitan:'B2',specialites:['M365','Réseau']});
  await db.updateClient(1, {nom:'Client modifié',primeId:1},
    {primeId:1,servoClientId:null});
  await db.updateSuivi(1, {titre:'Suivi modifié',clientId:1,primeId:1});
  assert.equal(conn.sqlite.prepare('SELECT nom FROM primes WHERE id=1').get().nom, 'Prime modifié');
  assert.equal(conn.sqlite.prepare('SELECT nom FROM clients WHERE id=1').get().nom, 'Client modifié');
  assert.equal(conn.sqlite.prepare('SELECT titre FROM suivis WHERE id=1').get().titre, 'Suivi modifié');
  const p=await db.createPrime({nom:'Nouveau Prime',specialites:['SecOps']});
  const c=await db.createClient({nom:'Nouveau Client',primeId:p.id});
  const s=await db.createSuivi({titre:'Nouveau Suivi',clientId:c.id,primeId:p.id});
  assert.equal(s.clientId,c.id);
  assert.equal((await db.listPrimes()).length,2);
  assert.equal((await db.listClients()).length,2);
  assert.equal((await db.listSuivis()).length,2);
  assert.equal(conn.sqlite.pragma('foreign_keys', { simple:true }), 1);
  await db.deletePrime(1);
  assert.equal((await db.listClients())[0].primeId, null, 'prime deletion must null the client FK');
  assert.equal((await db.listSuivis())[0].primeId, null, 'prime deletion must null the suivi FK');
  await db.deleteClient(1);
  assert.equal((await db.listSuivis()).length,1, 'client deletion must cascade to its suivi');
  assert.equal((await db.listPrimes()).length,1);
  assert.equal((await db.listClients()).length,1);
}
conn.sqlite.close();
console.log('SQLITE_SCHEMA_PASS');
JS
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import * as db from './server/database/index.js';
const conn = await db.initDb();
assert.equal(await db.seedMetier(), false);
assert.equal((await db.listPrimes()).length, process.env.MODE === 'fresh' ? 4 : 1);
conn.sqlite.close();
console.log('SQLITE_SECOND_BOOT_PASS');
JS
