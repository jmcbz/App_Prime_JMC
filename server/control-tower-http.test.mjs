import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import net from 'node:net';import {spawn} from 'node:child_process';import {once} from 'node:events';import {randomUUID} from 'node:crypto';
assert.equal(process.env.APP_PRIME_ISOLATED_TEST,'1');assert.equal(process.env.NODE_ENV,'test');assert(!fs.existsSync('/proc/1/root/root/.hermes'));assert(fs.existsSync('/proc/1/root/work/server/index.js'));
for(const n of ['net','mnt'])assert.notEqual(fs.readlinkSync(`/proc/self/ns/${n}`),process.env[`HOST_${n.toUpperCase()}`]);
const pg=!!process.env.DATABASE_URL;
if(pg){assert.equal(process.env.DATABASE_URL,'postgresql://prime_test@/prime_test?host=/var/lib/postgresql/prime-tower&port=5493&sslmode=disable');assert.equal(fs.statfsSync('/var/lib/postgresql').type,0x01021994);assert(fs.statSync('/var/lib/postgresql/prime-tower/.s.PGSQL.5493').isSocket());}
else{process.env.SQLITE_PATH=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'tower-http-')),'db.sqlite');process.env.APP_PRIME_ALLOW_NEW_DATABASE='1';}
process.env.JWT_SECRET='isolated-tower-dummy';process.env.SEED_ADMIN_EMAIL='isolated@example.invalid';process.env.SEED_ADMIN_PASSWORD='fixture-only';
const db=await import('./database/index.js');const auth=await import('./auth.js');const load=await import('./database/monthly-load.js');const migration=await import('./database/metier-migration.js');const driver=await db.initDb();
const q=async(sql,args=[])=>{if(pg){let n=0;return (await driver.pool.query(sql.replace(/\?/g,()=>`$${++n}`),args)).rows;}const s=driver.sqlite.prepare(sql);return s.reader?s.all(...args):(s.run(...args),[]);};
const a=await db.createUserWithPrime({email:'owner@fixture.invalid',passwordHash:'fixture',prenom:'Owner',nom:'Prime'});const b=await db.createUserWithPrime({email:'other@fixture.invalid',passwordHash:'fixture',prenom:'Other',nom:'Prime'});
const admin=await db.createUser({email:'admin@fixture.invalid',passwordHash:'fixture',prenom:'Admin',nom:'Fixture',role:'admin'});
const token=async user=>{await db.upsertMfaPending(user.id,`fixture-${user.id}`);return auth.issueSessionToken(user,await db.enableMfa(user.id));};const at=await token(a.user),bt=await token(b.user),ad=await token(admin);
const c=await db.createClient({nom:'Alpha fixture',primeId:a.prime.id,clientType:'ti'});const board=(await db.listTableaux(a.user.id,false))[0];
const legacy=await db.createSuivi({titre:'Original history',clientId:c.id,primeId:b.prime.id,statut:'a_faire',echeance:load.periodAt().start});
const sentinel=(await q('SELECT * FROM suivis WHERE id=?',[legacy.id]))[0];
let child,logs='';const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));const base=`http://127.0.0.1:${port}`;
const start=async()=>{child=spawn(process.execPath,['server/index.js'],{env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error(logs);try{if((await fetch(base+'/api/health')).ok)return;}catch{}await new Promise(r=>setTimeout(r,50));}throw Error(logs);};
const stop=async()=>{if(child&&child.exitCode===null&&!child.killed){child.kill();await once(child,'exit');}child=null;};
const call=async(method,url,bearer,body)=>{const response=await fetch(base+url,{method,headers:{'Content-Type':'application/json',...(bearer?{Authorization:`Bearer ${bearer}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
const read=async bearer=>{const x=await call('GET','/api/control-tower',bearer);assert.equal(x.status,200,JSON.stringify(x));return x.data;};
try{
 await test(`${pg?'PG':'SQLite'} populated pre-departure schema migration is additive and idempotent`,async()=>{
  await q("UPDATE tableau_rubriques SET date='2026-01-10',note='KEEP',prochaine_action='Existing' WHERE tableau_id=? AND key='projets'",[board.id]);
  await q('DROP TABLE tool_open_activity');await q('DROP TABLE prime_monthly_load_state');await q('ALTER TABLE tableau_rubriques DROP COLUMN prochaine_action_debut');
  if(pg){await migration.migratePgMetier(driver.pool,async()=>{});await migration.migratePgMetier(driver.pool,async()=>{});}else{driver.sqlite.transaction(()=>{migration.checkSqliteMetierIdentity(driver.sqlite);migration.migrateSqliteRubriqueEcheance(driver.sqlite);}).immediate();driver.sqlite.transaction(()=>{migration.checkSqliteMetierIdentity(driver.sqlite);migration.migrateSqliteRubriqueEcheance(driver.sqlite);}).immediate();}
  const r=(await q("SELECT date,note,prochaine_action_debut FROM tableau_rubriques WHERE tableau_id=? AND key='projets'",[board.id]))[0];assert.deepEqual(r,{date:'2026-01-10',note:'KEEP',prochaine_action_debut:null});assert.deepEqual((await q('SELECT * FROM suivis WHERE id=?',[legacy.id]))[0],sentinel);
 });
 await start();
 await test('real HTTP monthly selection, departure, hysteresis, restart, manual states and ownership transfer',async()=>{
  assert.equal((await call('GET','/api/control-tower')).status,401);assert.equal((await read(bt)).tasks.length,0);
  const period=load.periodAt(),input={statut:'en_cours',date:'2026-01-10',note:'KEEP',prochaineAction:'Action',prochaineActionDebut:period.start,prochaineActionEcheance:period.last,version:null};
  const save=(key,body=input,bearer=at)=>call('PUT',`/api/tableaux-suivi/${board.id}/rubriques/${key}`,bearer,body);
  for(const key of ['plan_directeur','projets','rencontre','comite_ti'])assert.equal((await save(key)).status,200);
  assert.equal((await read(at)).tasks.length,5);assert.equal((await read(at)).primes[0].autoCharge,false);
  assert.equal((await save('backups')).status,200);assert.equal((await save('backups',{...input,statut:'termine'})).status,200);
  // No GET between 6 and 5: the write hooks, not dashboard polling, retain the threshold crossing.
  assert.equal((await read(at)).primes[0].autoCharge,true);const profile=(await call('GET','/api/primes',at)).data.primes[0];assert.equal(profile.effectiveAvailability,'charge');assert.equal(profile.disponibilite,'disponible','manual form never receives automatic status as its value');await stop();await start();assert.equal((await read(at)).primes[0].autoCharge,true);
  assert.equal((await save('projets',{...input,prochaineActionDebut:undefined})).data.tableau.rubriques.find(r=>r.key==='projets').prochaineActionDebut,period.start);
  assert.equal((await save('projets',{...input,prochaineActionDebut:'2026-02-30'})).status,400);
  assert.equal((await save('projets',{...input,prochaineActionDebut:null})).data.tableau.rubriques.find(r=>r.key==='projets').prochaineActionDebut,null);
  assert.equal((await save('projets',input,bt)).status,404);
  await save('routeur',{...input,version:'v1',prochaineActionEcheance:period.end});await save('serveur_sur_place',{...input,version:'v1',prochaineAction:'   '});await save('vm_bz',{...input,version:'v1',prochaineActionEcheance:null});
  assert.equal((await read(at)).tasks.length,5);
  const close=await call('POST',`/api/suivis/${legacy.id}/complements`,at,{statut:'termine',echeance:period.start,note:'Done',expectedLastId:null});assert.equal(close.status,201,JSON.stringify(close));assert.equal((await read(at)).primes[0].autoCharge,false);
  assert.deepEqual((await q('SELECT * FROM suivis WHERE id=?',[legacy.id]))[0],sentinel);
  for(const manual of ['charge','surcharge']){assert.equal((await call('PUT',`/api/primes/${a.prime.id}`,ad,{...a.prime,disponibilite:manual})).status,200);assert.equal((await read(at)).primes[0].effectiveAvailability,manual);}
  assert.equal((await call('PUT',`/api/clients/${c.id}`,ad,{client:{...c,primeId:b.prime.id},expected:{primeId:a.prime.id,servoClientId:null}})).status,200);
  assert.equal((await read(at)).tasks.length,0);assert.equal((await read(bt)).tasks.length,4);
  assert.deepEqual((await q('SELECT * FROM suivis WHERE id=?',[legacy.id]))[0],sentinel);
 });
 await test('real HTTP activity recording is account-bound, authorized, truthful, and keeps expanded onboarding rights',async()=>{
  const standard=(await db.standardWorkstationTemplate()).template;
  const item=(await db.createWorkstationDossier({sub:b.user.id,role:'prime'},{requestKey:randomUUID(),clientId:c.id,templateId:standard.id,employee:'User',computer:'PC-fixture',ticket:'42',date:load.periodAt().today})).dossier;
  assert.equal((await call('GET',`/api/workstation-procedures/dossiers/${item.id}`,bt)).status,200);
  const event={module:'workstation',id:item.id,userId:b.user.id};
  assert.equal((await call('POST','/api/tool-activity',bt,event)).status,200);
  assert.equal((await call('POST','/api/tool-activity',at,event)).status,409);
  assert.equal((await call('POST','/api/tool-activity',at,{...event,userId:a.user.id})).status,404);
  assert.equal((await call('POST','/api/tool-activity',bt,{...event,id:999999})).status,404);
  const feed=await call('GET','/api/tool-activity',bt);assert.equal(feed.status,200);assert.equal(feed.data.recent[0].id,item.id);assert(feed.data.recent[0].openedAt);assert.equal((await call('GET','/api/tool-activity',at)).data.recent.length,0);
  const on=await db.createClientOnboarding({client_id:c.id,technicien_id:null,titre:'Expanded module',statut:'En cours',priorite:'Moyenne'},[],{sub:a.user.id,role:'prime',email:a.user.email},randomUUID());
  assert.equal((await call('GET',`/api/client-onboardings/${on.id}`,at)).status,200);
  assert.equal((await call('POST','/api/tool-activity',at,{module:'onboarding',id:on.id,userId:a.user.id})).status,200);
  assert.equal((await call('GET','/api/tool-activity',at)).data.recent.length,0,'home remains personally scoped');
 });
 await test('derived-state failure rolls back the underlying task write',async()=>{
  const before=await q("SELECT * FROM tableau_rubriques WHERE tableau_id=? AND key='projets'",[board.id]);const state=await q('SELECT * FROM prime_monthly_load_state ORDER BY prime_id');
  if(pg){await q("CREATE FUNCTION tower_reject() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'fixture reject load'; END$$");await q('CREATE TRIGGER tower_reject BEFORE UPDATE ON prime_monthly_load_state FOR EACH ROW EXECUTE FUNCTION tower_reject()');}
  else driver.sqlite.exec("CREATE TRIGGER tower_reject BEFORE UPDATE ON prime_monthly_load_state BEGIN SELECT RAISE(ABORT,'fixture reject load'); END");
  try{const result=await call('PUT',`/api/tableaux-suivi/${board.id}/rubriques/projets`,bt,{statut:'termine',date:null,note:'must rollback',prochaineAction:'Changed',prochaineActionEcheance:null,version:null});assert.equal(result.status,500);assert.deepEqual(await q("SELECT * FROM tableau_rubriques WHERE tableau_id=? AND key='projets'",[board.id]),before);assert.deepEqual(await q('SELECT * FROM prime_monthly_load_state ORDER BY prime_id'),state);}
  finally{await q(pg?'DROP TRIGGER tower_reject ON prime_monthly_load_state':'DROP TRIGGER tower_reject');if(pg)await q('DROP FUNCTION tower_reject()');}
 });
 if(pg)await test('PG load gate serializes a live rubric write against transfer without deadlock',async()=>{
  const blocker=await driver.pool.connect();await blocker.query('BEGIN');await load.loadLock(blocker);
  const save=call('PUT',`/api/tableaux-suivi/${board.id}/rubriques/projets`,bt,{statut:'en_cours',date:null,note:'Concurrent',prochaineAction:'Concurrent',prochaineActionEcheance:load.periodAt().last,version:null});
  const transfer=call('PUT',`/api/clients/${c.id}`,ad,{client:{...c,primeId:a.prime.id},expected:{primeId:b.prime.id,servoClientId:null}});
  let waited=false;try{for(let i=0;i<100;i++){const rows=(await driver.pool.query("SELECT COUNT(*)::int n FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%176930415, 20261120%' AND pid<>pg_backend_pid()")).rows;if(rows[0].n>=2){waited=true;break;}await new Promise(r=>setTimeout(r,10));}assert(waited,'both real HTTP writers must be observed waiting');}finally{await blocker.query('COMMIT');blocker.release();}
  const [saved,moved]=await Promise.all([save,transfer]);assert([200,404].includes(saved.status));assert.equal(moved.status,200);assert.equal((await read(bt)).tasks.length,0);assert.equal((await read(at)).tasks.length,4);
  assert.equal((await call('PUT',`/api/clients/${c.id}`,ad,{client:{...c,primeId:b.prime.id},expected:{primeId:a.prime.id,servoClientId:null}})).status,200);
 });
 await stop();
 await test('rollover preserves state at five and releases below five, no historical timestamps invented',async()=>{
  const now=new Date('2027-02-15T12:00:00Z');
  await q("UPDATE tableau_rubriques SET statut='termine'");
  for(const key of ['plan_directeur','projets','rencontre','comite_ti','backups'])await q("UPDATE tableau_rubriques SET statut='en_cours',prochaine_action='Next month',prochaine_action_echeance='2027-02-20' WHERE tableau_id=? AND key=?",[board.id,key]);
  await q("UPDATE prime_monthly_load_state SET auto_charge=1,period_key='2027-01' WHERE prime_id=?",[b.prime.id]);
  assert.equal((await db.controlTower({sub:b.user.id,role:'prime'},now)).primes[0].autoCharge,true);
  await q("UPDATE tableau_rubriques SET statut='termine' WHERE tableau_id=? AND key='backups'",[board.id]);
  assert.equal((await db.controlTower({sub:b.user.id,role:'prime'},now)).primes[0].autoCharge,false);
 });
}finally{await stop();if(pg)await driver.pool.end();else driver.sqlite.close();}
