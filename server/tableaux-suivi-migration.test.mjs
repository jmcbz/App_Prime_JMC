import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import Sqlite from 'better-sqlite3';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prime-rubrique-migration-'));
const dbPath = path.join(dir, 'fixture.sqlite');
const env = { ...process.env, SQLITE_PATH: dbPath, APP_PRIME_ALLOW_NEW_DATABASE: '1', NODE_ENV: 'test' };
delete env.DATABASE_URL;
const boot = `import {initDb,listTableaux,createPrime,createClient} from './server/database/index.js';
  const driver=await initDb();
  if (!driver.sqlite.prepare('SELECT 1 FROM clients WHERE id=1').get()) {
    const prime=await createPrime({nom:'Fixture'});
    await createClient({nom:'Fixture client',primeId:prime.id});
  }
  console.log(JSON.stringify((await listTableaux(1,true)).find(t=>t.clientId===1).rubriques.find(r=>r.key==='routeur')));
  driver.sqlite.close();`;
function reboot() {
  return spawnSync(process.execPath, ['--input-type=module','-e',boot], { env, cwd: process.cwd(), encoding: 'utf8' });
}
test('SQLite legacy board migration', async t => {
try {
  const initial = reboot();
  assert.equal(initial.status, 0, initial.stderr);
  await t.test('SQLite populated old rubric rows migrate additively and idempotently on boot', () => {
    const sqlite = new Sqlite(dbPath);
    try {
      sqlite.prepare("UPDATE tableau_rubriques SET date='2026-10-01', note='historique', prochaine_action='Rappeler' WHERE tableau_id=1 AND key='routeur'").run();
      sqlite.exec('ALTER TABLE tableau_rubriques DROP COLUMN prochaine_action_echeance');
    } finally { sqlite.close(); }
    for (let i=0; i<2; i++) {
      const result = reboot();
      assert.equal(result.status, 0, result.stderr);
      const row = JSON.parse(result.stdout.trim().split('\n').at(-1));
      assert.equal(row.date,'2026-10-01');
      assert.equal(row.note,'historique');
      assert.equal(row.prochaineAction,'Rappeler');
      assert.equal(row.prochaineActionEcheance,null);
    }
    const migrated = new Sqlite(dbPath);
    try {
      assert.equal(migrated.prepare("SELECT prochaine_action_echeance FROM tableau_rubriques WHERE tableau_id=1 AND key='routeur'").get().prochaine_action_echeance,null);
      assert.equal(migrated.prepare("SELECT count(*) AS n FROM tableau_rubriques WHERE tableau_id=1").get().n,9);
    } finally { migrated.close(); }
  });
  await t.test('SQLite refuses foreign identity before additive schema writes', () => {
    const sqlite = new Sqlite(dbPath);
    try {
      sqlite.exec('ALTER TABLE tableau_rubriques DROP COLUMN prochaine_action_echeance');
      sqlite.exec('CREATE TABLE foreign_marker (id INTEGER PRIMARY KEY)');
    } finally { sqlite.close(); }
    const result = reboot();
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/Schéma étranger à App Prime/);
    const untouched = new Sqlite(dbPath);
    try {
      assert.equal(untouched.pragma('table_info(tableau_rubriques)').some(r=>r.name==='prochaine_action_echeance'),false);
      assert.equal(untouched.prepare("SELECT note FROM tableau_rubriques WHERE tableau_id=1 AND key='routeur'").get().note,'historique');
    } finally { untouched.close(); }
  });
  await t.test('SQLite rolls back added column if a later data check fails', () => {
    const sqlite = new Sqlite(dbPath);
    try {
      sqlite.exec('DROP TABLE foreign_marker');
      sqlite.prepare("UPDATE primes SET data='[]' WHERE id=1").run();
    } finally { sqlite.close(); }
    const result = reboot();
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/data doit être un objet JSON/);
    const untouched = new Sqlite(dbPath);
    try {
      assert.equal(untouched.pragma('table_info(tableau_rubriques)').some(r=>r.name==='prochaine_action_echeance'),false);
      untouched.prepare('UPDATE primes SET data=? WHERE id=1').run(JSON.stringify({nom:'Fixture',specialites:[]}));
    } finally { untouched.close(); }
    assert.equal(reboot().status,0);
  });
} finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
