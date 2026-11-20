import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
assert.equal(process.env.APP_PRIME_ISOLATED_TEST,'1');
assert.equal(process.env.NODE_ENV,'test');
assert(!fs.existsSync('/proc/1/root/root/.hermes'));
assert(fs.existsSync('/proc/1/root/work/server/index.js'));
for(const n of ['net','mnt'])assert.notEqual(fs.readlinkSync(`/proc/self/ns/${n}`),process.env[`HOST_${n.toUpperCase()}`]);
const pg=!!process.env.DATABASE_URL;
if(pg){assert.equal(process.env.DATABASE_URL,'postgresql://prime_test@/prime_test?host=/var/lib/postgresql/prime-tower&port=5493&sslmode=disable');assert.equal(fs.statfsSync('/var/lib/postgresql').type,0x01021994);assert(fs.statSync('/var/lib/postgresql/prime-tower/.s.PGSQL.5493').isSocket());}
else {process.env.SQLITE_PATH='/tmp/monthly-rollover.sqlite';process.env.APP_PRIME_ALLOW_NEW_DATABASE='1';}
const RealDate=Date;let instant='2026-11-30T23:59:50-05:00';
globalThis.Date=class extends RealDate {constructor(...args){super(...(args.length?args:[instant]));}static now(){return new RealDate(instant).getTime();}};
const db=await import('./database/index.js');
const load=await import('./database/monthly-load.js');
const driver=await db.initDb();let serial=0;
const q=async(sql,args=[])=>{if(pg){let i=0;return (await driver.pool.query(sql.replace(/\?/g,()=>`$${++i}`),args)).rows;}const s=driver.sqlite.prepare(sql);return s.reader?s.all(...args):(s.run(...args),[]);};
const input={statut:'en_cours',date:null,note:'',prochaineAction:'December',prochaineActionEcheance:'2026-12-15',version:null};
async function fixture(count,kind){
 instant='2026-11-30T23:59:50-05:00';
 const n=++serial,owner=await db.createUserWithPrime({email:`rollover${n}@fixture.invalid`,passwordHash:'fixture',prenom:'Rollover',nom:String(n)});
 const actor={sub:owner.user.id,role:'prime'};
 const c=await db.createClient({nom:`Main ${n}`,primeId:owner.prime.id});
 const board=(await db.listTableaux(owner.user.id,false)).find(x=>x.clientId===c.id);
 const upward=count===4;
 // Establish the opposite previous-month flag using real November work.
 if(upward)for(let i=0;i<6;i++)await db.createSuivi({titre:'November',clientId:c.id,primeId:owner.prime.id,statut:'en_cours',echeance:'2026-11-20'});
 const baseline=upward?4:5;
 for(const key of ['plan_directeur','projets','rencontre','comite_ti','backups'].slice(0,baseline))await db.updateTableauRubrique(board.id,key,input,owner.user.id,false);
 let mutate,closeExtra;
 if(kind==='rubrique'){
  await db.updateTableauRubrique(board.id,'routeur',{...input,prochaineActionEcheance:upward?'2027-01-15':'2026-12-15'},owner.user.id,false);
  mutate=()=>db.updateTableauRubrique(board.id,'routeur',{...input,statut:upward?'en_cours':'termine'},owner.user.id,false);
 } else if(['complement','updateSuivi','deleteSuivi','createSuivi'].includes(kind)){
  const data={titre:'Legacy target',clientId:c.id,primeId:owner.prime.id,statut:'en_cours',echeance:upward?'2027-01-15':'2026-12-15'};
  const legacy=kind==='createSuivi'?null:await db.createSuivi(data);
  if(kind==='complement')mutate=()=>db.addSuiviComplement(legacy.id,actor,{statut:upward?'en_cours':'termine',echeance:'2026-12-15',note:'Transition',expectedLastId:null});
  if(kind==='updateSuivi')mutate=()=>db.updateSuivi(legacy.id,{...data,statut:upward?'en_cours':'termine',echeance:'2026-12-15'});
  if(kind==='deleteSuivi')mutate=()=>db.deleteSuivi(legacy.id);
  if(kind==='createSuivi')mutate=()=>db.createSuivi({...data,echeance:'2026-12-15'});
 } else {
  const extra=await db.createClient({nom:`Extra ${n}`,primeId:upward?null:owner.prime.id,servoClientId:10000+n});
  const extraBoard=(await db.listTableaux(null,true)).find(x=>x.clientId===extra.id);
  await db.updateTableauRubrique(extraBoard.id,'projets',input,owner.user.id,true);
  closeExtra=()=>db.updateTableauRubrique(extraBoard.id,'projets',{...input,statut:'termine'},owner.user.id,false);
  if(kind==='transfer')mutate=()=>db.updateClient(extra.id,{...extra,primeId:upward?owner.prime.id:null},{primeId:extra.primeId,servoClientId:extra.servoClientId});
  if(kind==='portfolio')mutate=()=>db.updatePrimePortfolio(owner.prime.id,owner.prime,upward?{add:[{id:extra.servoClientId,nom:extra.nom}],remove:[]}:{add:[],remove:[extra.id]});
  if(kind==='replace')mutate=()=>db.createTableau(extra.id,owner.user.id,false,extraBoard.id);
 }
 const before=(await db.controlTower(actor)).primes[0];assert.equal(before.autoCharge,upward);
 instant='2026-12-01T00:00:01-05:00';
 return {owner,actor,board,mutate,closeExtra};
}
try{
 for(const count of [6,4])for(const kind of ['rubrique','complement','transfer','portfolio','updateSuivi',...(count===6?['replace','deleteSuivi']:['createSuivi'])]){
  await test(`${pg?'PG':'SQLite'} rollover ${count}→5 ${kind}, same with or without tick`,async()=>{
   const results=[];
   for(const tick of [false,true]){
    const f=await fixture(count,kind);
    if(tick){const state=(await db.controlTower(f.actor)).primes[0];assert.equal(state.monthlyCount,count);assert.equal(state.autoCharge,count===6);}
    await f.mutate();
    // Read persistence before any GET can repair it.
    const stored=(await q('SELECT period_key,auto_charge FROM prime_monthly_load_state WHERE prime_id=?',[f.owner.prime.id]))[0];
    assert.equal(stored.period_key,'2026-12');
    assert.equal(stored.auto_charge,count===6?1:0,`${kind}, tick=${tick}`);
    const after=(await db.controlTower(f.actor)).primes[0];assert.equal(after.monthlyCount,5);results.push(after.autoCharge);
   }
   assert.deepEqual(results,[count===6,count===6]);
  });
 }
 await test('concurrent transfer and closing the same task retain the rollover crossing',async()=>{
  const f=await fixture(6,'transfer');
  const results=await Promise.allSettled([f.closeExtra(),f.mutate()]);
  assert.equal(results[1].status,'fulfilled');
  if(results[0].status==='rejected')assert.equal(results[0].reason.statusCode,404);
  const state=(await q('SELECT auto_charge FROM prime_monthly_load_state WHERE prime_id=?',[f.owner.prime.id]))[0];assert.equal(state.auto_charge,1);
  const result=(await db.controlTower(f.actor)).primes[0];assert.equal(result.monthlyCount,5);assert.equal(result.autoCharge,true);
 });
 await test('rollover pre-state and business write both roll back on post-state failure',async()=>{
  const f=await fixture(6,'rubrique');
  const before=await q('SELECT * FROM prime_monthly_load_state WHERE prime_id=?',[f.owner.prime.id]);
  const rubric=await q("SELECT * FROM tableau_rubriques WHERE tableau_id=? AND key='routeur'",[f.board.id]);
  const condition=`NEW.prime_id=${f.owner.prime.id} AND EXISTS(SELECT 1 FROM tableau_rubriques WHERE tableau_id=${f.board.id} AND key='routeur' AND statut='termine')`;
  if(pg){await q(`CREATE FUNCTION rollover_reject() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF ${condition} THEN RAISE EXCEPTION 'reject post load'; END IF; RETURN NEW; END$$`);await q('CREATE TRIGGER rollover_reject BEFORE UPDATE ON prime_monthly_load_state FOR EACH ROW EXECUTE FUNCTION rollover_reject()');}
  else await q(`CREATE TRIGGER rollover_reject BEFORE UPDATE ON prime_monthly_load_state WHEN ${condition} BEGIN SELECT RAISE(ABORT,'reject post load'); END`);
  try{await assert.rejects(f.mutate(),/reject post load/);assert.deepEqual(await q('SELECT * FROM prime_monthly_load_state WHERE prime_id=?',[f.owner.prime.id]),before);assert.deepEqual(await q("SELECT * FROM tableau_rubriques WHERE tableau_id=? AND key='routeur'",[f.board.id]),rubric);}
  finally{await q(pg?'DROP TRIGGER rollover_reject ON prime_monthly_load_state':'DROP TRIGGER rollover_reject');if(pg)await q('DROP FUNCTION rollover_reject()');}
  await f.mutate();assert.equal((await db.controlTower(f.actor)).primes[0].autoCharge,true);
 });
 if(pg)await test('waiting reader samples new month only after load lock acquisition',async()=>{
  const f=await fixture(6,'rubrique');instant='2026-11-30T23:59:59-05:00';
  const blocker=await driver.pool.connect();await blocker.query('BEGIN');await load.loadLock(blocker);
  const read=db.controlTower(f.actor);let waiting=false;
  try{for(let i=0;i<100;i++){const rows=await q("SELECT COUNT(*)::int n FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%176930415, 20261120%' AND pid<>pg_backend_pid()");if(rows[0].n){waiting=true;break;}await new Promise(r=>setTimeout(r,10));}assert(waiting);instant='2026-12-01T00:00:01-05:00';}
  finally{await blocker.query('COMMIT');blocker.release();}
  const result=await read;assert.equal(result.period.key,'2026-12');assert.equal(result.primes[0].monthlyCount,6);assert.equal(result.primes[0].autoCharge,true);
 });
 if(pg)await test('waiting writer samples new month only after load lock acquisition',async()=>{
  const f=await fixture(6,'rubrique');instant='2026-11-30T23:59:59-05:00';
  const blocker=await driver.pool.connect();await blocker.query('BEGIN');await load.loadLock(blocker);
  const write=f.mutate();let waiting=false;
  try{for(let i=0;i<100;i++){const rows=await q("SELECT COUNT(*)::int n FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%176930415, 20261120%' AND pid<>pg_backend_pid()");if(rows[0].n){waiting=true;break;}await new Promise(r=>setTimeout(r,10));}assert(waiting);instant='2026-12-01T00:00:01-05:00';}
  finally{await blocker.query('COMMIT');blocker.release();}
  await write;const p=(await db.controlTower(f.actor)).primes[0];assert.equal(p.monthlyCount,5);assert.equal(p.autoCharge,true);
 });
}finally{if(pg)await driver.pool.end();else driver.sqlite.close();globalThis.Date=RealDate;}
