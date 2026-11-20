import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
assert.equal(process.env.APP_PRIME_ISOLATED_TEST,'1');
assert.equal(process.env.NODE_ENV,'test');
assert(!fs.existsSync('/proc/1/root/root/.hermes'));
assert(fs.existsSync('/proc/1/root/work/server/index.js'));
for(const n of ['net','mnt']) assert.notEqual(fs.readlinkSync(`/proc/self/ns/${n}`),process.env[`HOST_${n.toUpperCase()}`]);
assert.equal(process.env.DATABASE_URL,undefined);
process.env.SQLITE_PATH=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'tower-')),'db.sqlite');
process.env.APP_PRIME_ALLOW_NEW_DATABASE='1';
const db=await import('./database/index.js');
const driver=await db.initDb();
try {
 await test('distinct departure date persists; omitted preserves, null clears; invalid rejects; archive immutable',async()=>{
  const p=await db.createPrime({nom:'P'});const c=await db.createClient({nom:'C',primeId:p.id});
  const b=(await db.listTableaux(1,true)).find(t=>t.clientId===c.id);
  const input={statut:'en_cours',date:'2026-01-01',note:'',prochaineAction:'Call',prochaineActionDebut:'2026-02-02',prochaineActionEcheance:'2026-03-03',version:null};
  const save=body=>db.updateTableauRubrique(b.id,'projets',body,1,true);
  const field=result=>result.rubriques.find(r=>r.key==='projets');
  assert.equal(field(await save(input)).prochaineActionDebut,'2026-02-02');
  const {prochaineActionDebut,...older}=input;
  assert.equal(field(await save(older)).prochaineActionDebut,'2026-02-02');
  await assert.rejects(save({...input,prochaineActionDebut:'2026-02-30'}),/invalid/i);
  const cleared=field(await save({...input,prochaineActionDebut:null}));
  assert.equal(cleared.prochaineActionDebut,null);assert.equal(cleared.date,'2026-01-01');assert.equal(cleared.prochaineActionEcheance,'2026-03-03');
  await db.createTableau(c.id,1,true,b.id);
  await assert.rejects(save(input),/archiv/i);
 });
} finally {driver.sqlite.close();}
