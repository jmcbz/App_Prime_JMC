import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import {spawn} from 'node:child_process';
import jwt from 'jsonwebtoken';
const socketDir='/var/lib/postgresql/prime-suivi-complements';
assert.equal(process.env.APP_PRIME_ISOLATED_TEST,'1');
assert.equal(process.env.NODE_ENV,'test');
for(const ns of ['mnt','net']) assert.notEqual(fs.readlinkSync(`/proc/self/ns/${ns}`),fs.readlinkSync(`/proc/1/ns/${ns}`));
assert.equal(process.env.APP_PRIME_TEST_SOCKET,socketDir);
assert.equal(fs.realpathSync(socketDir),socketDir);
assert.notEqual(fs.statSync('/var/lib/postgresql').dev,fs.statSync('/var/lib').dev);
assert.equal(fs.statfsSync('/var/lib/postgresql').type,0x01021994);
assert(fs.statSync(`${socketDir}/.s.PGSQL.5491`).isSocket());
assert.equal(process.env.DATABASE_URL,`postgresql://prime_test@/prime_test?host=${socketDir}&port=5491&sslmode=disable`);
const db=await import('./database/index.js');
const auth=await import('./auth.js');
const driver=await db.initDb();
const pool=driver.pool;
const serverSocket=net.createServer();await new Promise(resolve=>serverSocket.listen(0,'127.0.0.1',resolve));
const port=serverSocket.address().port;await new Promise(resolve=>serverSocket.close(resolve));
const base=`http://127.0.0.1:${port}`;
let child;
let stderr='';
async function ready(){
  child=spawn(process.execPath,['server/index.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port)},stdio:'pipe'});
  child.stderr.on('data',d=>stderr+=d);
  for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)return;}catch{}if(child.exitCode!==null)throw Error(stderr);await new Promise(r=>setTimeout(r,100));}throw Error(stderr||'server timeout');
}
async function call(method,route,token,body){const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();let data;try{data=JSON.parse(text);}catch{data=text;}return {status:r.status,data};}
async function token(user){await db.upsertMfaPending(user.id,`fixture-${user.id}`);return auth.issueSessionToken(user,await db.enableMfa(user.id));}
try {
  await test('disposable PG HTTP preserves legacy bytes and serializes closure against transfer and competing writers',async()=>{
    const admin=await db.createUser({email:'admin@example.test',passwordHash:'dummy',prenom:'Admin',nom:'One',role:'admin'});
    const a=await db.createUserWithPrime({email:'a@example.test',passwordHash:'dummy',prenom:'A',nom:'One'});
    const b=await db.createUserWithPrime({email:'b@example.test',passwordHash:'dummy',prenom:'B',nom:'Two'});
    const client=await db.createClient({nom:'Hôtel',primeId:a.prime.id});
    const legacy=await db.createSuivi({titre:'Lenovo',clientId:client.id,primeId:a.prime.id,statut:'en_cours',echeance:'2026-11-20',note:'original'});
    const original=(await pool.query('SELECT * FROM suivis WHERE id=$1',[legacy.id])).rows[0];
    const [at,bt,adminToken]=await Promise.all([token(a.user),token(b.user),token(admin)]);
    await pool.query('DROP TABLE suivi_complements'); // populated pre-feature database
    await ready();assert.equal((await pool.query('SELECT count(*)::int AS n FROM suivi_complements')).rows[0].n,0);const route=`/api/suivis/${legacy.id}/complements`;
    assert.equal((await call('GET',route,bt)).status,404);
    const first=await call('POST',route,at,{statut:'bloque',echeance:null,note:'Pièce',expectedLastId:null});
    assert.equal(first.status,201,JSON.stringify(first.data));
    assert.equal(first.data.suivi.note,'original');
    assert.equal((await call('POST',route,at,{statut:'termine',echeance:null,note:'stale',expectedLastId:null})).status,409);
    assert.deepEqual((await pool.query('SELECT * FROM suivis WHERE id=$1',[legacy.id])).rows[0],original);
    const transfer=await call('PUT',`/api/clients/${client.id}`,adminToken,{client:{nom:'Hôtel',primeId:b.prime.id,statut:'actif'},expected:{primeId:a.prime.id,servoClientId:null}});
    assert.equal(transfer.status,200,JSON.stringify(transfer.data));
    assert.equal((await call('POST',route,at,{statut:'termine',echeance:null,note:'denied',expectedLastId:first.data.complement.id})).status,404);
    const contenders=await Promise.all([call('POST',route,bt,{statut:'termine',echeance:null,note:'Fermé',expectedLastId:first.data.complement.id}),
      call('POST',route,bt,{statut:'bloque',echeance:null,note:'Race',expectedLastId:first.data.complement.id})]);
    assert.deepEqual(contenders.map(r=>r.status).sort(),[201,409],JSON.stringify(contenders));
    const current=(await call('GET','/api/suivis',adminToken)).data.suivis.find(s=>s.id===legacy.id);
    assert.equal(current.initialStatut,'en_cours');assert.equal(current.initialEcheance,'2026-11-20');
    assert.equal(current.dernierComplementId,contenders.find(r=>r.status===201).data.complement.id);
    const history=await call('GET',route,adminToken);
    assert.equal(history.status,200);assert.equal(history.data.complements.length,2);
    let closed=current;
    if (current.statut!=='termine') {
      const finish=await call('POST',route,bt,{statut:'termine',echeance:null,note:'Fin',expectedLastId:current.dernierComplementId});
      assert.equal(finish.status,201,JSON.stringify(finish.data));closed=finish.data.suivi;
    }
    assert.equal((await call('POST',route,bt,{statut:'bloque',echeance:null,note:'Réouverture',expectedLastId:closed.dernierComplementId})).status,409);
    assert.equal((await call('GET','/api/suivis',bt)).data.suivis.find(s=>s.id===legacy.id).statut,'termine');
    assert.deepEqual((await pool.query('SELECT * FROM suivis WHERE id=$1',[legacy.id])).rows[0],original);
    const done=await db.createSuivi({titre:'Terminé ancien',primeId:a.prime.id,statut:'termine'});
    assert.equal((await call('POST',`/api/suivis/${done.id}/complements`,at,{statut:'bloque',echeance:null,note:'no',expectedLastId:null})).status,409);
  });
  await test('PG complements reject disabled, MFA-reset and non-session JWTs without writes',async()=>{
    const admin=await db.createUser({email:'session-admin@example.test',passwordHash:'dummy',prenom:'Session',nom:'Admin',role:'admin'});
    const owner=await db.createUserWithPrime({email:'session-owner@example.test',passwordHash:'dummy',prenom:'Session',nom:'Owner'});
    const suivi=await db.createSuivi({titre:'Session guard',primeId:owner.prime.id,statut:'a_faire'});
    const route=`/api/suivis/${suivi.id}/complements`;
    const body={statut:'bloque',echeance:null,note:'denied',expectedLastId:null};
    const ownerToken=await token(owner.user), adminToken=await token(admin);
    for(const badToken of [
      jwt.sign({sub:owner.user.id,role:'prime',purpose:'mfa_login'},process.env.JWT_SECRET),
      jwt.sign({sub:owner.user.id,role:'prime',purpose:'mfa_setup'},process.env.JWT_SECRET),
      jwt.sign({sub:owner.user.id,role:'prime'},process.env.JWT_SECRET),
    ]) {
      assert.equal((await call('GET',route,badToken)).status,401);
      assert.equal((await call('POST',route,badToken,body)).status,401);
    }
    assert.equal((await call('GET',route,ownerToken)).status,200);
    await db.setUserActive(owner.user.id,false);
    assert.equal((await call('GET',route,ownerToken)).status,401);
    assert.equal((await call('POST',route,ownerToken,body)).status,401);
    await db.setUserActive(owner.user.id,true);
    assert.equal((await call('GET',route,ownerToken)).status,200);
    assert.equal((await call('POST',`/api/admin/users/${owner.user.id}/reset-mfa`,adminToken,{})).status,200);
    assert.equal((await call('GET',route,ownerToken)).status,401);
    assert.equal((await call('POST',route,ownerToken,body)).status,401);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM suivi_complements WHERE suivi_id=$1',[suivi.id])).rows[0].n,0);
  });
  await test('PG transfer waits on client row while append overlaps and rejects former owner',async()=>{
    const admin=await db.createUser({email:'overlap-admin@example.test',passwordHash:'dummy',prenom:'Overlap',nom:'Admin',role:'admin'});
    const oldOwner=await db.createUserWithPrime({email:'overlap-a@example.test',passwordHash:'dummy',prenom:'Overlap',nom:'A'});
    const newOwner=await db.createUserWithPrime({email:'overlap-b@example.test',passwordHash:'dummy',prenom:'Overlap',nom:'B'});
    const client=await db.createClient({nom:'Overlap client',primeId:oldOwner.prime.id});
    const suivi=await db.createSuivi({titre:'Overlap suivi',clientId:client.id,primeId:oldOwner.prime.id,statut:'a_faire'});
    const [adminToken,ownerToken,newToken]=await Promise.all([token(admin),token(oldOwner.user),token(newOwner.user)]);
    const route=`/api/suivis/${suivi.id}/complements`;
    const blocker=await pool.connect();
    let held=false;
    const waitForLock=async queryText=>{
      for(let i=0;i<150;i++){
        const {rows}=await pool.query("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query=$1 AND pid<>pg_backend_pid()",[queryText]);
        if(rows.length)return;
        await new Promise(resolve=>setTimeout(resolve,30));
      }
      throw Error(`Did not observe competing client lock: ${queryText}`);
    };
    try {
      await blocker.query('BEGIN');held=true;
      await blocker.query('SELECT id FROM clients WHERE id=$1 FOR UPDATE',[client.id]);
      const transfer=call('PUT',`/api/clients/${client.id}`,adminToken,{client:{nom:'Overlap client',primeId:newOwner.prime.id,statut:'actif'},expected:{primeId:oldOwner.prime.id,servoClientId:null}});
      await waitForLock('SELECT * FROM clients WHERE id = $1 FOR UPDATE');
      const append=call('POST',route,ownerToken,{statut:'bloque',echeance:null,note:'stale owner',expectedLastId:null});
      await waitForLock('SELECT id FROM clients WHERE id=$1 FOR UPDATE');
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM suivi_complements WHERE suivi_id=$1',[suivi.id])).rows[0].n,0);
      await blocker.query('ROLLBACK');held=false;
      const [transferred,appended]=await Promise.all([transfer,append]);
      assert.equal(transferred.status,200,JSON.stringify(transferred.data));
      assert.equal(appended.status,404,JSON.stringify(appended.data));
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM suivi_complements WHERE suivi_id=$1',[suivi.id])).rows[0].n,0);
      assert.equal((await call('GET',route,ownerToken)).status,404);
      assert.equal((await call('GET',route,newToken)).status,200);
    } finally {if(held)await blocker.query('ROLLBACK');blocker.release();}
  });
  await test('PG history holds current client authorization through the complements read',async()=>{
    const admin=await db.createUser({email:'history-admin@example.test',passwordHash:'dummy',prenom:'History',nom:'Admin',role:'admin'});
    const oldOwner=await db.createUserWithPrime({email:'history-a@example.test',passwordHash:'dummy',prenom:'History',nom:'A'});
    const newOwner=await db.createUserWithPrime({email:'history-b@example.test',passwordHash:'dummy',prenom:'History',nom:'B'});
    const client=await db.createClient({nom:'History client',primeId:oldOwner.prime.id});
    const suivi=await db.createSuivi({titre:'History suivi',clientId:client.id,primeId:oldOwner.prime.id,statut:'a_faire'});
    const [adminToken,oldToken,newToken]=await Promise.all([token(admin),token(oldOwner.user),token(newOwner.user)]);
    const route=`/api/suivis/${suivi.id}/complements`;
    const first=await call('POST',route,oldToken,{statut:'bloque',echeance:null,note:'Private history',expectedLastId:null});
    assert.equal(first.status,201,JSON.stringify(first.data));
    const blocker=await pool.connect();
    let held=false,history,transfer;
    const waitForPausedHistory=async()=>{
      for(let i=0;i<150;i++){
        const {rows}=await pool.query("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT id,statut,echeance,note,created_at FROM suivi_complements WHERE suivi_id=%' AND pid<>pg_backend_pid()");
        if(rows.length)return;
        await new Promise(resolve=>setTimeout(resolve,30));
      }
      throw Error('History never reached the complements read');
    };
    const waitForTransferLock=async()=>{
      for(let i=0;i<150;i++){
        const {rows}=await pool.query("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query='SELECT * FROM clients WHERE id = $1 FOR UPDATE' AND pid<>pg_backend_pid()");
        if(rows.length)return 'blocked';
        await new Promise(resolve=>setTimeout(resolve,30));
      }
      throw Error('Transfer did not complete or block on client row');
    };
    try {
      await blocker.query('BEGIN');held=true;
      await blocker.query('LOCK TABLE suivi_complements IN ACCESS EXCLUSIVE MODE');
      history=call('GET',route,oldToken);
      await waitForPausedHistory(); // the authorization SELECT already ran
      transfer=call('PUT',`/api/clients/${client.id}`,adminToken,{client:{nom:'History client',primeId:newOwner.prime.id,statut:'actif'},expected:{primeId:oldOwner.prime.id,servoClientId:null}});
      const outcome=await Promise.race([transfer.then(()=> 'committed'),waitForTransferLock()]);
      assert.equal(outcome,'blocked','transfer committed while the authorized history read was paused');
      await blocker.query('ROLLBACK');held=false;
      const [read,changed]=await Promise.all([history,transfer]);
      assert.equal(read.status,200,JSON.stringify(read.data));
      assert.equal(read.data.complements[0].note,'Private history');
      assert.equal(changed.status,200,JSON.stringify(changed.data));
      assert.equal((await call('GET',route,oldToken)).status,404);
      assert.equal((await call('GET',route,newToken)).status,200);
    } finally {
      if(held)await blocker.query('ROLLBACK');
      blocker.release();
      if(history || transfer) await Promise.allSettled([history,transfer].filter(Boolean));
    }
  });
} finally {
  if(child && child.exitCode===null){const exit=new Promise(resolve=>child.once('exit',resolve));child.kill();await exit;}
  await pool.end();
}
