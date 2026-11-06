#!/usr/bin/env bash
set -euo pipefail
# Only a disposable local PostgreSQL database, with external networking disabled.
if [ "$(readlink /proc/self/ns/net)" = "$(readlink /proc/1/ns/net)" ]; then
  echo 'Refusing to run outside a network namespace' >&2
  exit 1
fi
unset DATABASE_URL database_url PGOPTIONS PGPASSWORD
export MODE="${1:-empty}"
if [ "$MODE" = race ]; then export APP_PRIME_ALLOW_NEW_DATABASE=1; fi
export PGHOST=/var/run/postgresql PGUSER=root PGDATABASE=postgres PGSSL=disable
name="appprime_legacy_$$_${RANDOM}"
createdb "$name"
trap 'dropdb --if-exists "$name"' EXIT
if [ "${1:-empty}" = empty ] || [ "${1:-empty}" = populated ] || [ "${1:-empty}" = rollback ] || [ "${1:-empty}" = rollback_data ] || [ "${1:-empty}" = partial_json ] || [ "${1:-empty}" = foreign_owner ] || [ "${1:-empty}" = foreign_constraints ] || [ "${1:-empty}" = foreign_delete ] || [ "${1:-empty}" = partial_data ] || [ "${1:-empty}" = server ]; then
psql -X -v ON_ERROR_STOP=1 -q -d "$name" <<'SQL'
CREATE TABLE users (
 id SERIAL PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
 prenom TEXT NOT NULL DEFAULT '', nom TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT 'prime',
 is_active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE user_mfa (
 user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 secret_encrypted TEXT NOT NULL, mfa_enabled BOOLEAN NOT NULL DEFAULT false,
 pending_setup BOOLEAN NOT NULL DEFAULT true, enabled_at TIMESTAMP,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE primes (
 id SERIAL PRIMARY KEY,
 nom TEXT NOT NULL,
 code_titan TEXT NOT NULL DEFAULT '',
 specialites JSONB NOT NULL DEFAULT '[]'::jsonb,
 disponibilite TEXT NOT NULL DEFAULT 'disponible',
 avatar_initiales TEXT NOT NULL DEFAULT '',
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE clients (
 id SERIAL PRIMARY KEY,
 nom TEXT NOT NULL,
 secteur TEXT NOT NULL DEFAULT '',
 prime_id INTEGER REFERENCES primes(id) ON DELETE SET NULL,
 statut TEXT NOT NULL DEFAULT 'actif',
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE suivis (
 id SERIAL PRIMARY KEY,
 titre TEXT NOT NULL,
 client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
 prime_id INTEGER REFERENCES primes(id) ON DELETE SET NULL,
 statut TEXT NOT NULL DEFAULT 'a_faire',
 echeance TEXT,
 note TEXT,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
SQL
fi
export DATABASE_URL="postgresql://root@/${name}?host=/var/run/postgresql"
if [ "${1:-empty}" = server ]; then
  ip link set lo up
  log="${TMPDIR:-/root/.hermes/cache/scratch}/appprime-server-$$_${RANDOM}.log"
  PORT=31898 NODE_ENV=development JWT_SECRET=fixture-only-secret MFA_ENCRYPTION_KEY=fixture-only-mfa-encryption-key SEED_ADMIN_EMAIL=fixture@example.test SEED_ADMIN_PASSWORD=fixture-password node server/index.js >"$log" 2>&1 & server=$!
  trap 'kill "$server" 2>/dev/null || true; wait "$server" 2>/dev/null || true; dropdb --if-exists "$name"; rm -f "$log"' EXIT
  ready=0
  for _ in $(seq 1 100); do
    if curl -fsS --max-time 1 http://127.0.0.1:31898/api/health >/dev/null 2>&1; then ready=1; break; fi
    if ! kill -0 "$server" 2>/dev/null; then break; fi
    sleep 0.1
  done
  if [ "$ready" -ne 1 ]; then python3 -c 'import sys; print(open(sys.argv[1]).read()[-3000:])' "$log"; exit 1; fi
  test "$(psql -X -qAt -d "$name" -c 'SELECT count(*) FROM primes')" = 4
  test "$(psql -X -qAt -d "$name" -c 'SELECT count(*) FROM clients')" = 6
  test "$(psql -X -qAt -d "$name" -c 'SELECT count(*) FROM suivis')" = 6
  JWT_SECRET=fixture-only-secret node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import * as auth from './server/auth.js';
import * as db from './server/database/index.js';
await db.initDb();
await db.upsertMfaPending(1,'fixture-encrypted-secret');
const mfaState=await db.enableMfa(1);
const token = auth.issueSessionToken({id:1,email:'fixture@example.test',role:'admin'},mfaState);
const base='http://127.0.0.1:31898/api/primes';
const headers={authorization:`Bearer ${token}`,'content-type':'application/json'};
const initial=await fetch(base,{headers});
assert.equal(initial.status,200);
assert.equal((await initial.json()).primes.length,4);
const created=await fetch(base,{method:'POST',headers,body:JSON.stringify({nom:'Prime HTTP',specialites:['Réseau']})});
assert.equal(created.status,201);
const id=(await created.json()).prime.id;
const edited=await fetch(`${base}/${id}`,{method:'PUT',headers,body:JSON.stringify({nom:'Prime HTTP modifié',specialites:['M365']})});
assert.equal(edited.status,200);
assert.equal((await edited.json()).prime.nom,'Prime HTTP modifié');
const removed=await fetch(`${base}/${id}`,{method:'DELETE',headers});
assert.equal(removed.status,200);
assert.equal((await (await fetch(base,{headers})).json()).primes.length,4);
console.log('REAL_SERVER_AUTHENTICATED_CRUD_PASS');
JS
  printf 'REAL_SERVER_LEGACY_BOOT_PASS\n'
elif [ "${1:-empty}" = auth_only ]; then
  psql -X -v ON_ERROR_STOP=1 -q -d "$name" <<'SQL'
CREATE TABLE users (id SERIAL PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
 prenom TEXT NOT NULL DEFAULT '', nom TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT 'prime',
 is_active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE user_mfa (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 secret_encrypted TEXT NOT NULL, mfa_enabled BOOLEAN NOT NULL DEFAULT false,
 pending_setup BOOLEAN NOT NULL DEFAULT true, enabled_at TIMESTAMP,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
INSERT INTO users (email,password_hash) VALUES ('fixture@example.test','dummy-hash');
SQL
  node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import * as db from './server/database/index.js';
const connection = await db.initDb();
assert.equal(await db.seedMetier(), true);
assert.equal((await db.listPrimes()).length, 4);
assert.equal((await connection.pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n, 1);
await connection.pool.end();
console.log('AUTH_ONLY_UPGRADE_PASS');
JS
elif [ "${1:-empty}" = rollback ]; then
  psql -X -v ON_ERROR_STOP=1 -q -d "$name" -c 'ALTER TABLE primes ALTER COLUMN specialites TYPE TEXT USING specialites::text' >/dev/null
  node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import pg from './server/node_modules/pg/lib/index.js';
import * as db from './server/database/index.js';
const pool = new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:false});
const schema = () => pool.query("SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position");
const before = (await schema()).rows;
await assert.rejects(() => db.initDb());
assert.deepEqual((await schema()).rows, before, 'rejected migration must leave no schema changes');
await pool.end();
console.log('SCHEMA_ROLLBACK_PASS');
JS
elif [ "${1:-empty}" = rollback_data ]; then
  psql -X -v ON_ERROR_STOP=1 -q -d "$name" <<'SQL'
ALTER TABLE primes ADD COLUMN data JSONB;
INSERT INTO primes (nom, data) VALUES ('Nom héritage conservé', '[]'::jsonb);
SQL
  node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import pg from './server/node_modules/pg/lib/index.js';
import * as db from './server/database/index.js';
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:false});
const schema=()=>pool.query("SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position");
const before=(await schema()).rows;
const rowsBefore=(await pool.query('SELECT id,nom,data FROM primes ORDER BY id')).rows;
await assert.rejects(()=>db.initDb(), /data doit être un objet JSON/);
assert.deepEqual((await schema()).rows,before);
assert.deepEqual((await pool.query('SELECT id,nom,data FROM primes ORDER BY id')).rows,rowsBefore);
await pool.end();
console.log('PG_INVALID_DATA_ROLLBACK_PASS');
JS
elif [ "${1:-empty}" = partial_json ]; then
  psql -X -v ON_ERROR_STOP=1 -q -d "$name" <<'SQL'
ALTER TABLE primes ADD COLUMN data JSONB;
ALTER TABLE clients ADD COLUMN data JSONB;
ALTER TABLE suivis ADD COLUMN data JSONB;
INSERT INTO primes (nom, code_titan, specialites, data)
  VALUES ('Prime original', 'A1', '["M365"]'::jsonb, '{"disponibilite":"charge"}'::jsonb);
INSERT INTO clients (nom, secteur, prime_id, data)
  VALUES ('Client original', 'Services', 1, '{"statut":"actif"}'::jsonb);
INSERT INTO suivis (titre, client_id, prime_id, data)
  VALUES ('Suivi original', 1, 1, '{"note":"JSON conservé"}'::jsonb);
SQL
  node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import * as db from './server/database/index.js';
const connection=await db.initDb();
assert.equal((await db.listPrimes())[0].nom,'Prime original');
assert.deepEqual((await db.listPrimes())[0].specialites,['M365']);
assert.equal((await db.listPrimes())[0].disponibilite,'charge');
assert.equal((await db.listClients())[0].nom,'Client original');
assert.equal((await db.listSuivis())[0].titre,'Suivi original');
assert.equal((await db.listSuivis())[0].note,'JSON conservé');
const rows=await connection.pool.query('SELECT p.data AS p,c.data AS c,s.data AS s FROM primes p,clients c,suivis s');
assert.equal(rows.rows[0].p.nom,'Prime original');
assert.equal(rows.rows[0].c.nom,'Client original');
assert.equal(rows.rows[0].s.titre,'Suivi original');
await connection.pool.end();
console.log('PG_PARTIAL_JSON_RECONCILED_PASS');
JS
elif [ "${1:-empty}" = foreign_owner ] || [ "${1:-empty}" = foreign_constraints ] || [ "${1:-empty}" = foreign_delete ]; then
if [ "${1:-empty}" = foreign_owner ]; then
  psql -X -v ON_ERROR_STOP=1 -q -d "$name" -c 'CREATE TABLE other_app_records (id SERIAL PRIMARY KEY)' >/dev/null
elif [ "${1:-empty}" = foreign_delete ]; then
  psql -X -v ON_ERROR_STOP=1 -q -d "$name" -c 'ALTER TABLE clients DROP CONSTRAINT clients_prime_id_fkey; ALTER TABLE clients ADD CONSTRAINT clients_prime_id_fkey FOREIGN KEY (prime_id) REFERENCES primes(id) ON DELETE CASCADE' >/dev/null
else
  psql -X -v ON_ERROR_STOP=1 -q -d "$name" -c 'ALTER TABLE clients DROP CONSTRAINT clients_prime_id_fkey' >/dev/null
fi
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import pg from './server/node_modules/pg/lib/index.js';
import * as db from './server/database/index.js';
const pool = new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:false});
const schema = () => pool.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position");
const before = (await schema()).rows;
await assert.rejects(() => db.initDb(), /Schéma étranger à App Prime/);
assert.deepEqual((await schema()).rows, before);
await pool.end();
console.log(process.env.MODE === 'foreign_delete' ? 'FOREIGN_DELETE_ACTION_UNTOUCHED_PASS' : process.env.MODE === 'foreign_constraints' ? 'FOREIGN_CONSTRAINTS_UNTOUCHED_PASS' : 'FOREIGN_OWNER_UNTOUCHED_PASS');
JS
elif [ "${1:-empty}" = race ]; then
node --input-type=module -e "const db=await import('./server/database/index.js'); const d=await db.initDb(); await d.pool.end();" & first=$!
node --input-type=module -e "const db=await import('./server/database/index.js'); const d=await db.initDb(); await d.pool.end();" & second=$!
wait "$first"
wait "$second"
tables=$(psql -X -qAt -d "$name" -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('users','user_mfa','primes','clients','suivis')")
test "$tables" = 5
psql -X -v ON_ERROR_STOP=1 -q -d "$name" <<'SQL'
CREATE FUNCTION slow_prime_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_sleep(0.15); RETURN NEW; END $$;
CREATE TRIGGER slow_prime_insert BEFORE INSERT ON primes FOR EACH ROW EXECUTE FUNCTION slow_prime_insert();
SQL
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import pg from './server/node_modules/pg/lib/index.js';
const worker = `
const db=await import('./server/database/index.js');
const connection=await db.initDb();
process.send('ready');
process.on('message',async message=>{
  if(message!=='go') return;
  try { await db.seedMetier(); await connection.pool.end(); process.exit(0); }
  catch(error) { console.error(error); process.exit(1); }
});
`;
const children = [0,1].map(() => spawn(process.execPath,['--input-type=module','-e',worker],{
env:process.env,stdio:['ignore','inherit','inherit','ipc'],
}));
await Promise.all(children.map(child => new Promise((resolve,reject) => {
child.on('message',message => {if(message==='ready') resolve();});
child.on('error',reject);
child.on('exit',code => {if(code!==0) reject(new Error('seed worker exited before ready'));});
})));
const exits=children.map(child => new Promise((resolve,reject) =>
child.on('exit',code => code===0 ? resolve() : reject(new Error(`seed worker exited ${code}`)))
));
children.forEach(child=>child.send('go'));
await Promise.all(exits);
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:false});
for(const [table,expected] of [['primes',4],['clients',6],['suivis',6]]){
const result=await pool.query(`SELECT COUNT(*)::int AS n FROM ${table}`);
assert.equal(result.rows[0].n,expected,`concurrent seed duplicated ${table}`);
}
await pool.end();
console.log('CONCURRENT_SEED_PASS');
JS
  psql -X -v ON_ERROR_STOP=1 -q -d "$name" <<'SQL'
CREATE FUNCTION slow_admin_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_sleep(0.4); RETURN NEW; END $$;
CREATE TRIGGER slow_admin_insert BEFORE INSERT ON users FOR EACH ROW EXECUTE FUNCTION slow_admin_insert();
SQL
  node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import pg from './server/node_modules/pg/lib/index.js';
const children = [0,1].map(() => spawn(process.execPath,['server/index.js'],{
  env:{...process.env,PORT:'0',SEED_ADMIN_EMAIL:'prime-smoke@example.invalid',SEED_ADMIN_PASSWORD:'SmokeOnly!123'},
  stdio:['ignore','pipe','pipe'],
}));
const ready = children.map(child => new Promise((resolve,reject) => {
  child.stdout.on('data',data => {if(String(data).includes('PRIsME Prime API')) resolve();});
  child.stderr.on('data',data => {if(String(data).includes('Échec du démarrage')) reject(new Error('full server boot failed: '+String(data)));});
  child.on('exit',code => reject(new Error(`full server exited before listening: ${code}`)));
}));
try {
  await Promise.race([
    Promise.all(ready),
    new Promise((_,reject)=>setTimeout(()=>reject(new Error('concurrent full server boot timeout')),15000)),
  ]);
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:false});
  const users=await pool.query("SELECT COUNT(*)::int AS n FROM users WHERE email='prime-smoke@example.invalid'");
  assert.equal(users.rows[0].n,1);
  await pool.end();
  console.log('CONCURRENT_FULL_SERVER_BOOT_PASS');
} finally {
  children.forEach(child=>child.kill('SIGTERM'));
}
JS
  printf 'CONCURRENT_BOOT_PASS\n'
elif [ "${1:-empty}" = unowned_empty ]; then
  node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import pg from './server/node_modules/pg/lib/index.js';
import * as db from './server/database/index.js';
await assert.rejects(() => db.initDb(), /Base App Prime non reconnue/);
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:false});
const result=await pool.query("SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema=current_schema() AND table_type='BASE TABLE'");
assert.equal(result.rows[0].n,0);
await pool.end();
console.log('UNOWNED_EMPTY_DATABASE_UNTOUCHED_PASS');
JS
elif [ "${1:-empty}" = foreign ]; then
  psql -X -v ON_ERROR_STOP=1 -q -d "$name" -c "CREATE TABLE clients (id SERIAL PRIMARY KEY, nom TEXT NOT NULL, id_client_erp TEXT)" >/dev/null
  node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import pg from './server/node_modules/pg/lib/index.js';
import * as db from './server/database/index.js';
await assert.rejects(() => db.initDb(), /Schéma (clients étranger|App Prime incomplet)/);
await assert.rejects(() => db.initDb(), /Schéma (clients étranger|App Prime incomplet)/,
  'a failed initialization must not cache an unusable driver');
const pool = new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:false});
const tables = await pool.query("SELECT to_regclass('public.primes') AS primes, to_regclass('public.users') AS users");
assert.equal(tables.rows[0].primes, null);
assert.equal(tables.rows[0].users, null);
await pool.end();
console.log('FOREIGN_SCHEMA_UNTOUCHED_PASS');
process.exit(0);
JS
elif [ "${1:-empty}" = partial_data ]; then
  psql -X -v ON_ERROR_STOP=1 -q -d "$name" -c "INSERT INTO clients (nom, secteur, prime_id) VALUES ('Client isolé', 'Réel', NULL)" >/dev/null
  node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import * as db from './server/database/index.js';
const connection=await db.initDb();
assert.equal(await db.seedMetier(),false,'any existing métier row must suppress demo seed');
assert.equal((await db.listPrimes()).length,0);
assert.equal((await db.listClients()).length,1);
assert.equal((await db.listSuivis()).length,0);
assert.equal((await db.listClients())[0].nom,'Client isolé');
await connection.pool.end();
console.log('PARTIAL_REAL_DATA_NO_DEMO_PASS');
JS
elif [ "${1:-empty}" = populated ]; then
  psql -X -v ON_ERROR_STOP=1 -q -d "$name" <<'SQL'
INSERT INTO primes (nom, code_titan, specialites, disponibilite, avatar_initiales)
VALUES ('Ancien Prime', 'A1', '["M365"]'::jsonb, 'charge', 'AP');
INSERT INTO clients (nom, secteur, prime_id, statut)
VALUES ('Ancien Client', 'Test', 1, 'actif');
INSERT INTO suivis (titre, client_id, prime_id, statut, echeance, note)
VALUES ('Ancien Suivi', 1, 1, 'en_cours', '2026-11-15', 'Conserver');
SQL
  node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import * as db from './server/database/index.js';
const connection = await db.initDb();
assert.equal(connection.kind, 'pg');
assert.equal(await db.seedMetier(), false, 'do not replace existing data with demo rows');
assert.deepEqual((await db.listPrimes())[0].specialites, ['M365']);
assert.equal((await db.listPrimes())[0].nom, 'Ancien Prime');
assert.equal((await db.listClients())[0].primeId, 1);
assert.equal((await db.listSuivis())[0].note, 'Conserver');
await db.updatePrime(1, { nom: 'Prime modifié', codeTitan: 'B2', specialites: ['M365', 'Réseau'], disponibilite: 'disponible', avatarInitiales: 'PM' });
await db.updateClient(1, { nom: 'Client modifié', secteur: 'Nouveau', primeId: 1, statut: 'actif' },
  { primeId: 1, servoClientId: null });
await db.updateSuivi(1, { titre: 'Suivi modifié', clientId: 1, primeId: 1, statut: 'termine', echeance: null, note: 'Conservé' });
const p = await connection.pool.query('SELECT nom, code_titan, specialites, data FROM primes WHERE id=1');
const c = await connection.pool.query('SELECT nom, prime_id, data FROM clients WHERE id=1');
const s = await connection.pool.query('SELECT titre, client_id, prime_id, data FROM suivis WHERE id=1');
assert.equal(p.rows[0].nom, 'Prime modifié');
assert.equal(p.rows[0].code_titan, 'B2');
assert.deepEqual(p.rows[0].specialites, ['M365', 'Réseau']);
assert.equal(p.rows[0].data.nom, 'Prime modifié');
assert.equal(c.rows[0].nom, 'Client modifié');
assert.equal(c.rows[0].prime_id, 1);
assert.equal(c.rows[0].data.nom, 'Client modifié');
assert.equal(s.rows[0].titre, 'Suivi modifié');
assert.equal(s.rows[0].client_id, 1);
assert.equal(s.rows[0].prime_id, 1);
assert.equal(s.rows[0].data.titre, 'Suivi modifié');
const newPrime = await db.createPrime({nom:'Nouveau Prime',specialites:['SecOps']});
const newClient = await db.createClient({nom:'Nouveau Client',primeId:newPrime.id});
const newSuivi = await db.createSuivi({titre:'Nouveau Suivi',primeId:newPrime.id,clientId:newClient.id});
assert.equal(newSuivi.clientId, newClient.id);
assert.equal((await db.listPrimes()).length, 2);
assert.equal((await db.listClients()).length, 2);
assert.equal((await db.listSuivis()).length, 2);
const retained = (await connection.pool.query('SELECT * FROM suivis WHERE id=1')).rows[0];
await assert.rejects(db.deletePrime(1), error => error.statusCode === 409);
await assert.rejects(db.deleteClient(1), error => error.statusCode === 409);
assert.deepEqual((await connection.pool.query('SELECT * FROM suivis WHERE id=1')).rows[0], retained);
assert.equal((await db.listPrimes()).length, 2);
assert.equal((await db.listClients()).length, 2);
assert.equal((await db.listSuivis()).length, 2);
await connection.pool.end();
console.log('LEGACY_POPULATED_SCHEMA_PASS');
JS
  node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import * as db from './server/database/index.js';
const connection = await db.initDb();
assert.equal(await db.seedMetier(), false);
assert.equal((await db.listPrimes()).length, 2);
assert.equal((await db.listClients()).length, 2);
assert.equal((await db.listSuivis()).length, 2);
await connection.pool.end();
console.log('LEGACY_SECOND_BOOT_PASS');
JS
else
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import * as db from './server/database/index.js';
const connection = await db.initDb();
assert.equal(connection.kind, 'pg');
assert.equal(await db.seedMetier(), true, 'legacy empty tables should seed normally');
assert.equal((await db.listPrimes()).length, 4);
assert.equal((await db.listClients()).length, 6);
assert.equal((await db.listSuivis()).length, 6);
assert.equal(await db.seedMetier(), false, 'second seed must be idempotent');
await connection.pool.end();
console.log('LEGACY_EMPTY_SCHEMA_PASS');
JS
fi
