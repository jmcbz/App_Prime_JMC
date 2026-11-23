import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
// Fail before app imports: this suite must never see host secrets or databases.
assert.equal(process.env.SKILLS_FIXTURE,'1');
assert.equal(fs.existsSync('/proc/1/root/root/.hermes'),false);
assert.equal(fs.existsSync('/proc/1/root/repo/server/index.js'),true);
const pg=process.env.SKILLS_PG==='1';
if(pg) assert.equal(process.env.DATABASE_URL,'postgresql://postgres@localhost/skills?host=/tmp/pg&sslmode=disable');
else {delete process.env.DATABASE_URL;process.env.SQLITE_PATH='/tmp/skills.sqlite';}
Object.assign(process.env,{APP_PRIME_ALLOW_NEW_DATABASE:'1',JWT_SECRET:'isolated-skills-fixture',MFA_ENCRYPTION_KEY:'isolated-skills-mfa',SEED_ADMIN_EMAIL:'fixture@example.invalid',SEED_ADMIN_PASSWORD:'fixture-password',PORT:'4100',NODE_ENV:pg?'production':'development',PGSSL:'disable'});
const base='http://127.0.0.1:4100';
let child;
async function start(){
 child=spawn(process.execPath,['server/index.js'],{env:process.env,stdio:['ignore','pipe','pipe']});
 let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}
 throw new Error(log);
}
async function stop(){if(child?.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r));}}
async function call(method,url,token,body){const r=await fetch(base+'/api/skills'+url,{method,headers:{...(token?{Authorization:`Bearer ${token}`} :{}),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});let data;try{data=await r.json();}catch{data=null;}return {status:r.status,data};}
async function issue(db,auth,u){await db.upsertMfaPending(u.id,'fixture-'+u.id);return auth.issueSessionToken(u,await db.enableMfa(u.id));}
test('shared initial matrix is unevaluated, scoped and survives restart',async()=>{
 let driver;
 try{
  await start();const db=await import('./database/index.js');const auth=await import('./auth.js');driver=await db.initDb();
  const admin=await db.getUserByEmail('fixture@example.invalid'),at=await issue(db,auth,admin);
  const a=await db.createUserWithPrime({email:'a@example.invalid',passwordHash:'fixture',prenom:'Alice',nom:'Fixture',role:'prime'});
  const b=await db.createUserWithPrime({email:'b@example.invalid',passwordHash:'fixture',prenom:'Bruno',nom:'Fixture',role:'prime'});
  const atA=await issue(db,auth,a.user);
  const tags=['M365','Power Automate','Gouvernance TI'];
  const primeCall=async(method,path,body)=>{const r=await fetch(base+path,{method,headers:{Authorization:`Bearer ${at}`,'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
  assert.equal((await primeCall('PUT',`/api/primes/${a.prime.id}`,{...a.prime,specialites:tags})).status,200);
  const partial={nom:a.prime.nom,disponibilite:'disponible'};
  assert.deepEqual((await primeCall('PUT',`/api/primes/${a.prime.id}`,partial)).data.prime.specialites,tags,'omitted specialties preserved');
  assert.deepEqual((await primeCall('PUT',`/api/primes/${a.prime.id}/portfolio`,{prime:partial,addServoIds:[],removeClientIds:[]})).data.prime.specialites,tags,'portfolio omission preserves specialties');
  const linked=(await call('GET','',atA)).data;
  assert.ok(linked.competences.some(s=>s.name==='Power Automate'),'specialty becomes a distinct competence');
  assert.ok(linked.competences.some(s=>s.name==='Gouvernance TI'));
  assert.deepEqual(linked.specialties.map(s=>s.label),tags);
  assert.deepEqual(linked.evaluations,[]);
  const result=await call('GET','',at);
  assert.equal(result.status,200,'matrix endpoint exists');
  const initialCount=result.data.competences.length;
  assert.ok(initialCount>=13);
  assert.deepEqual(result.data.evaluations,[]);
  assert.ok(result.data.primes.some(p=>p.id===a.prime.id));
  assert.ok(result.data.primes.some(p=>p.id===b.prime.id));
  assert.equal((await call('GET','')).status,401);
  assert.deepEqual((await call('GET','',atA)).data.primes.map(p=>p.id),[a.prime.id]);
  const url='/competences/custom-network',body={name:'Réseau avancé',archived:false,expectedVersion:0};
  assert.equal((await call('PUT',url,at,body)).status,200,'admin creates a competence');
  assert.equal((await call('PUT',url,atA,body)).status,403);
  assert.equal((await call('PUT',url,at,body)).status,409);
  assert.equal((await call('PUT','/competences/bad',at,{...body,name:' '})).status,400);
  const eu=`/evaluations/${a.prime.id}/custom-network`;
  assert.equal((await call('PUT',eu,atA,{level:3,expectedVersion:0})).status,403);
  for(const level of [0,5,'3',false])assert.equal((await call('PUT',eu,at,{level,expectedVersion:0})).status,400);
  assert.equal((await call('PUT',eu,at,{level:3,expectedVersion:0})).status,200);
  const saved=(await call('GET','',atA)).data.evaluations;
  assert.equal(saved.length,1);assert.equal(saved[0].level,3);
  assert.equal((await call('GET','',await issue(db,auth,b.user))).data.evaluations.length,0);
  const race=await Promise.all([1,4].map(level=>call('PUT',eu,at,{level,expectedVersion:1})));
  assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
  assert.equal((await call('PUT',url,at,{...body,archived:true,expectedVersion:1})).status,200);
  assert.equal((await call('PUT',eu,at,{level:3,expectedVersion:2})).status,409);
  assert.equal((await call('DELETE',url,at)).status,405);
  assert.equal((await call('GET','',at)).data.evaluations[0].version,2);
  await stop();await start();
  const reloaded=(await call('GET','',at)).data;
  assert.equal(reloaded.competences.length,initialCount+1);
  assert.equal(reloaded.competences.find(s=>s.id==='custom-network').archived,true);
  const unlinked=await db.createUser({email:'unlinked@example.invalid',passwordHash:'fixture',prenom:'Sans',nom:'Lien',role:'prime'});
  const ut=await issue(db,auth,unlinked);
  assert.deepEqual((await call('GET','',ut)).data.primes,[]);
  assert.deepEqual((await call('GET',`?primeId=${b.prime.id}`,atA)).data.primes.map(p=>p.id),[a.prime.id]);
  assert.equal((await call('PUT','/evaluations/1e2/ti-1',at,{level:3,expectedVersion:0})).status,400);
  assert.equal((await call('PUT','/evaluations/999999/ti-1',at,{level:3,expectedVersion:0})).status,404);
  assert.equal((await call('PUT',`/evaluations/${a.prime.id}/missing`,at,{level:3,expectedVersion:0})).status,404);
  assert.equal((await call('PUT',url,at,{...body,name:'Renommée',archived:false,expectedVersion:2})).status,200);
  assert.equal((await call('PUT',eu,at,{level:null,expectedVersion:2})).status,200);
  assert.equal((await call('GET','',atA)).data.evaluations[0].level,null);
  assert.equal((await call('PUT',eu,at,{level:2,expectedVersion:null})).status,400);
  assert.equal((await call('PUT',eu,at,{level:2,expectedVersion:3,role:'admin'})).status,400);
  const q=driver.kind==='pg'?async(sql,args=[])=>{let i=0;return (await driver.pool.query(sql.replace(/\?/g,()=>`$${++i}`),args)).rows;}:async(sql,args=[])=>{const s=driver.sqlite.prepare(sql);return s.reader?s.all(...args):(s.run(...args),[]);};
  const power=linked.competences.find(s=>s.name==='Power Automate');
  const governance=linked.competences.find(s=>s.name==='Gouvernance TI');
  assert.equal((await call('PUT',`/evaluations/${a.prime.id}/${power.id}`,at,{level:2,expectedVersion:0})).status,200);
  assert.equal((await call('PUT','/competences/duplicate-power',at,{name:'pówer AUTOMATE',archived:false,expectedVersion:0})).status,409);
  assert.equal((await call('PUT',`/competences/${power.id}`,at,{name:'Power Automate avancé',archived:false,expectedVersion:1})).status,200);
  assert.equal((await call('PUT',`/competences/${power.id}`,at,{name:'Power Automate avancé',archived:true,expectedVersion:2})).status,409);
  const variants=['m365','POWER automate','Góuvernance ti'];
  assert.equal((await primeCall('PUT',`/api/primes/${a.prime.id}/portfolio`,{prime:{...a.prime,specialites:variants},addServoIds:[],removeClientIds:[]})).status,200);
  let links=(await call('GET','',atA)).data.specialties;
  assert.deepEqual(links.map(l=>l.label),variants);
  assert.deepEqual(links.map(l=>l.competenceId),['ti-1',power.id,governance.id]);
  assert.equal((await primeCall('PUT',`/api/primes/${a.prime.id}`,{...a.prime,specialites:['M365']})).status,200);
  for(const profile of await db.listPrimes())if(profile.id!==a.prime.id&&profile.specialites.includes('Power Automate'))assert.equal((await primeCall('PUT',`/api/primes/${profile.id}`,{...profile,specialites:profile.specialites.filter(s=>s!=='Power Automate')})).status,200);
  assert.equal((await call('PUT',`/competences/${power.id}`,at,{name:'Power Automate avancé',archived:true,expectedVersion:2})).status,200);
  assert.ok((await call('GET','',atA)).data.evaluations.some(e=>e.competenceId===power.id&&e.level===2));
  assert.equal((await primeCall('PUT',`/api/primes/${a.prime.id}`,{...a.prime,specialites:tags})).status,200);
  const restored=(await call('GET','',atA)).data;
  assert.equal(restored.competences.find(s=>s.id===power.id).archived,false);
  assert.ok(restored.evaluations.some(e=>e.competenceId===power.id&&e.level===2));
  assert.deepEqual(restored.specialties.map(s=>s.label),tags);
  // Current role, not JWT role; disabled and factor-reset sessions fail closed.
  await db.updateUserRole(admin.id,'prime');
  assert.equal((await call('PUT',eu,at,{level:1,expectedVersion:3})).status,403);
  assert.deepEqual((await call('GET','',at)).data.evaluations,[]);
  await db.updateUserRole(admin.id,'admin');
  await db.setUserActive(a.user.id,false);
  assert.equal((await call('GET','',atA)).status,401);
  await db.setUserActive(a.user.id,true);await db.resetMfa(a.user.id);
  assert.equal((await call('GET','',atA)).status,401);
  // At capacity, writes fail without changing the catalogue; no silent read truncation.
  for(let i=initialCount+1;i<100;i++)await q('INSERT INTO prime_competences(id,name,archived,version) VALUES (?,?,0,1)',[`capacity-${i}`,`Capacité ${i}`]);
  assert.equal((await call('GET','',at)).data.competences.length,100);
  const beforeCapacity=(await q('SELECT data FROM primes WHERE id=?',[a.prime.id]))[0].data;
  assert.equal((await primeCall('PUT',`/api/primes/${a.prime.id}/portfolio`,{prime:{...a.prime,specialites:['Nouvelle spécialité à capacité']},addServoIds:[],removeClientIds:[]})).status,409);
  assert.deepEqual((await q('SELECT data FROM primes WHERE id=?',[a.prime.id]))[0].data,beforeCapacity);
  assert.equal((await call('PUT','/competences/overflow',at,body)).status,409);
  await q("INSERT INTO prime_competences(id,name,archived,version) VALUES ('over-capacity','Trop',0,1)");
  assert.equal((await call('GET','',at)).status,413);
  assert.equal(Number((await q('SELECT COUNT(*) AS n FROM prime_competences'))[0].n),101);
  // Two attempts to create the same intent cannot duplicate records.
  await q("DELETE FROM prime_competences WHERE id LIKE 'capacity-%' OR id='over-capacity'");
  const creates=await Promise.all([1,2].map(()=>call('PUT','/competences/shared-intent',at,{...body,name:'Intention partagée'})));
  assert.deepEqual(creates.map(x=>x.status).sort(),[200,409]);
  const aliasCount=Number((await q('SELECT count(*) AS n FROM prime_competence_aliases'))[0].n);
  for(let i=aliasCount;i<1000;i++)await q('INSERT INTO prime_competence_aliases(id,competence_id) VALUES (?,?)',[`fixture-alias-${i}`,'ti-1']);
  const beforeAliasCapacity=(await q('SELECT data FROM primes WHERE id=?',[a.prime.id]))[0].data;
  assert.equal((await primeCall('PUT',`/api/primes/${a.prime.id}`,{...a.prime,specialites:['Nouvelle au plafond alias']})).status,409,'specialty alias capacity atomic');
  assert.deepEqual((await q('SELECT data FROM primes WHERE id=?',[a.prime.id]))[0].data,beforeAliasCapacity);
  await q("DELETE FROM prime_competence_aliases WHERE id LIKE 'fixture-alias-%'");
  if(pg){
   const blocker=await driver.pool.connect();let pending;
   try{
    await blocker.query('BEGIN');await blocker.query('SELECT pg_advisory_xact_lock(176930415,20261120)');
    pending=Promise.all([1,4].map(level=>call('PUT',eu,at,{level,expectedVersion:3})));
    let waiting=0;
    for(let i=0;i<100;i++){waiting=Number((await q("SELECT count(*) AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock%'")).at(0).n);if(waiting>=2)break;await new Promise(r=>setTimeout(r,20));}
    assert.ok(waiting>=2,'both HTTP writers observed waiting on actual PG lock');
    await blocker.query('COMMIT');
    assert.deepEqual((await pending).map(r=>r.status).sort(),[200,409]);
   }finally{await blocker.query('ROLLBACK');blocker.release();if(pending)await pending;}
  }
  console.log('PASS roles, null distinct, invalid payloads, archive/restart, CAS races, capacity');
  assert.equal(reloaded.evaluations[0].version,2);
 }finally{await stop();if(driver?.pool)await driver.pool.end();}
});
