import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import jwt from 'jsonwebtoken';
assert.equal(process.env.SKILLS_FIXTURE,'1');
assert.equal(fs.existsSync('/proc/1/root/root/.hermes'),false);
assert.equal(fs.existsSync('/proc/1/root/repo/server/index.js'),true);
assert.equal(process.env.DATABASE_URL,'postgresql://postgres@localhost/skills?host=/tmp/pg&sslmode=disable');
Object.assign(process.env,{APP_PRIME_ALLOW_NEW_DATABASE:'1',JWT_SECRET:'review-isolated-fixture',MFA_ENCRYPTION_KEY:'review-isolated-mfa',SEED_ADMIN_EMAIL:'review@example.invalid',SEED_ADMIN_PASSWORD:'fixture-password',PORT:'4100',NODE_ENV:'production',PGSSL:'disable'});
const child=spawn(process.execPath,['server/index.js'],{env:process.env,stdio:'ignore'});
let driver;
test('queued skills requests revalidate complete session and scope after PG lock',async()=>{
 try {
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:4100/api/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready);
  const db=await import('./database/index.js'),auth=await import('./auth.js');driver=await db.initDb();
  const admin=await db.getUserByEmail('review@example.invalid');
  const foreign=await db.createUserWithPrime({email:'foreign@example.invalid',passwordHash:'fixture',prenom:'Foreign',nom:'Profile',role:'prime'});
  let epoch=0;
  const issue=async()=>{await db.updateUserRole(admin.id,'admin');await db.setUserActive(admin.id,true);await db.upsertMfaPending(admin.id,`fixture-only-mfa-${++epoch}`);return auth.issueSessionToken(await db.getUserById(admin.id),await db.enableMfa(admin.id));};
  const request=(token,path='',body)=>fetch('http://127.0.0.1:4100/api/skills'+path,{method:body?'PUT':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}).then(async r=>({status:r.status,data:await r.json()}));
  async function queued(token,path,body,change){
   const blocker=await driver.pool.connect();let pending;
   try{
    await blocker.query('BEGIN');await blocker.query('SELECT pg_advisory_xact_lock(176930415,20261120)');
    pending=request(token,path,body);
    let waiting=false;
    for(let i=0;i<100;i++){const r=await driver.pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock%'");if(r.rows[0].n>=1){waiting=true;break;}await new Promise(r=>setTimeout(r,20));}
    assert.ok(waiting,'real HTTP request waiting after entry middleware');
    await change();await blocker.query('COMMIT');return await pending;
   }finally{await blocker.query('ROLLBACK');blocker.release();if(pending)await pending;}
  }
  const snapshot=async()=>(await driver.pool.query('SELECT * FROM prime_evaluations ORDER BY id')).rows;
  const mutations=[
   ['downgrade',()=>db.updateUserRole(admin.id,'prime')],
   ['deactivate',()=>db.setUserActive(admin.id,false)],
   ['MFA reset',()=>db.resetMfa(admin.id)],
   ['MFA re-enrolment',async()=>{await db.resetMfa(admin.id);await db.upsertMfaPending(admin.id,'different-ciphertext');await db.enableMfa(admin.id);}],
  ];
  for(const [label,change] of mutations){
   for(const write of [false,true]){
    const token=await issue(),before=await snapshot();
    const result=await queued(token,write?`/evaluations/${foreign.prime.id}/ti-1`:'',write?{level:4,expectedVersion:0}:undefined,change);
    if(label==='downgrade'&&!write){assert.equal(result.status,200);assert.equal(result.data.canEdit,false);assert.deepEqual(result.data.primes,[]);assert.deepEqual(result.data.evaluations,[]);assert.deepEqual(result.data.specialties,[]);}
    else assert.equal(result.status,label==='downgrade'?403:401,`${label} ${write?'PUT':'GET'}`);
    assert.deepEqual(await snapshot(),before,'revoked write does not persist');
    console.log(`PASS queued ${write?'PUT':'GET'} ${label}`);
   }
  }
  // Existing logout is cookie removal, not server-side token revocation.
  // In-flight requests already authenticated remain valid under that contract.
  for(const write of [false,true]){
   const token=await issue();
   const afterLogout=await queued(token,write?`/evaluations/${foreign.prime.id}/ti-1`:'',write?{level:4,expectedVersion:0}:undefined,async()=>{
    const r=await fetch('http://127.0.0.1:4100/api/auth/logout',{method:'POST'});
    assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/app_prime_session=;/);
   });
   assert.equal(afterLogout.status,200);
   if(write)assert.equal((await snapshot())[0].level,4);else assert.equal(afterLogout.data.canEdit,true);
  }
  assert.equal((await request(null)).status,401);
  console.log('PASS logout clears cookie; existing signed token contract unchanged');
  for(const write of [false,true]){
   const valid=jwt.decode(await issue()),before=await snapshot();delete valid.iat;delete valid.exp;
   const token=jwt.sign(valid,process.env.JWT_SECRET,{expiresIn:2});
   const result=await queued(token,write?`/evaluations/${foreign.prime.id}/ti-1`:'',write?{level:1,expectedVersion:1}:undefined,()=>new Promise(r=>setTimeout(r,2100)));
   assert.equal(result.status,401);assert.deepEqual(await snapshot(),before);
   console.log(`PASS queued ${write?'PUT':'GET'} expiration`);
  }
  for(const write of [false,true]){
   const token=await issue(),blocker=await driver.pool.connect();let pending,revocations;
   try{
    await blocker.query('BEGIN');await blocker.query('LOCK TABLE prime_competences IN ACCESS EXCLUSIVE MODE');
    const before=await snapshot();
    pending=request(token,write?`/evaluations/${foreign.prime.id}/ti-1`:'',write?{level:2,expectedVersion:before[0].version}:undefined);
    let waiting=false;
    for(let i=0;i<100;i++){const r=await driver.pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT%prime_competences%'");if(r.rows[0].n){waiting=true;break;}await new Promise(r=>setTimeout(r,20));}
    assert.ok(waiting,'skills request passed identity locks and waits before data access');
    revocations=Promise.all([db.updateUserRole(admin.id,'prime'),db.resetMfa(admin.id)]);
    let held=false;
    for(let i=0;i<100;i++){const r=await driver.pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND (query LIKE 'UPDATE users SET role%' OR query LIKE 'DELETE FROM user_mfa%')");if(r.rows[0].n===2){held=true;break;}await new Promise(r=>setTimeout(r,20));}
    assert.ok(held,'both identity and MFA revocations wait until authorized access finishes');
    await blocker.query('COMMIT');assert.equal((await pending).status,200);await revocations;
    assert.equal((await request(token)).status,401);
    console.log(`PASS ${write?'PUT':'GET'} holds identity and MFA through access`);
   }finally{await blocker.query('ROLLBACK');blocker.release();if(pending)await pending;if(revocations)await revocations;}
  }
 }finally{child.kill();await new Promise(r=>child.once('exit',r));if(driver)await driver.pool.end();}
});
