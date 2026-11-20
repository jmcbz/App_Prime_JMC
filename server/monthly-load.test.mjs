import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
assert.equal(process.env.APP_PRIME_ISOLATED_TEST,'1');assert.equal(process.env.NODE_ENV,'test');assert(!fs.existsSync('/proc/1/root/root/.hermes'));assert(fs.existsSync('/proc/1/root/work/server/index.js'));
for(const n of ['net','mnt']) assert.notEqual(fs.readlinkSync(`/proc/self/ns/${n}`),process.env[`HOST_${n.toUpperCase()}`]);
assert.equal(process.env.DATABASE_URL,undefined);process.env.APP_PRIME_ALLOW_NEW_DATABASE='1';process.env.SQLITE_PATH=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'load-')),'fixture.sqlite');
const db=await import('./database/index.js');const {periodAt}=await import('./database/monthly-load.js');const d=await db.initDb();
try {
 await test('every saved mutation reconciles complete monthly load and preserves manual status and transfer history',async()=>{
  const a=await db.createUserWithPrime({email:'a@example.invalid',passwordHash:'fixture',prenom:'A',nom:'Prime'});
  const b=await db.createUserWithPrime({email:'b@example.invalid',passwordHash:'fixture',prenom:'B',nom:'Prime'});
  const actor={sub:a.user.id,role:'prime'};const admin={sub:a.user.id,role:'admin'};
  const c=await db.createClient({nom:'Client',primeId:a.prime.id});const board=(await db.listTableaux(a.user.id,false))[0];
  const due=periodAt().start;
  const input={statut:'en_cours',date:null,note:'',prochaineAction:'Real work',prochaineActionEcheance:due,version:null};
  for(const key of ['plan_directeur','projets','rencontre','comite_ti']) await db.updateTableauRubrique(board.id,key,input,a.user.id,false);
  const old=await db.createSuivi({titre:'Legacy',clientId:c.id,primeId:b.prime.id,statut:'bloque',echeance:due});
  const view=()=>db.controlTower(actor);
  assert.equal((await view()).primes[0].monthlyCount,5);assert.equal((await view()).primes[0].autoCharge,false);
  await db.updateTableauRubrique(board.id,'backups',input,a.user.id,false);
  assert.equal((await view()).primes[0].autoCharge,true);
  await db.updateTableauRubrique(board.id,'backups',{...input,statut:'termine'},a.user.id,false);
  assert.equal((await view()).primes[0].autoCharge,true,'6→5 persists without browser observation');
  await db.addSuiviComplement(old.id,actor,{statut:'termine',echeance:due,note:'Done',expectedLastId:null});
  assert.equal((await view()).primes[0].monthlyCount,4);assert.equal((await view()).primes[0].autoCharge,false);
  await db.updatePrime(a.prime.id,{...a.prime,disponibilite:'charge'});
  assert.equal((await view()).primes[0].effectiveAvailability,'charge');
  await db.updatePrime(a.prime.id,{...a.prime,disponibilite:'surcharge'});
  assert.equal((await view()).primes[0].effectiveAvailability,'surcharge');
  await db.updateClient(c.id,{...c,primeId:b.prime.id},{primeId:a.prime.id,servoClientId:null});
  assert.equal((await view()).tasks.length,0);
  const moved=await db.controlTower({sub:b.user.id,role:'prime'});assert.equal(moved.tasks.length,4);
  assert.equal(d.sqlite.prepare('SELECT prime_id FROM suivis WHERE id=?').get(old.id).prime_id,b.prime.id);
  const all=await db.controlTower(admin);assert.equal(all.tasks.length,4);
  assert.equal(d.sqlite.prepare('SELECT auto_charge FROM prime_monthly_load_state WHERE prime_id=?').get(a.prime.id).auto_charge,0);
 });
} finally {d.sqlite.close();}
