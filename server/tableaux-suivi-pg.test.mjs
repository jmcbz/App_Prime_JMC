import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import {spawn} from 'node:child_process';

// Fail closed before loading any database module.
const socketDir='/var/lib/postgresql/prime-onboardings';
assert.equal(process.env.APP_PRIME_ISOLATED_TEST,'1');
assert.equal(process.env.NODE_ENV,'test');
for (const ns of ['mnt','net']) assert.notEqual(fs.readlinkSync(`/proc/self/ns/${ns}`),fs.readlinkSync(`/proc/1/ns/${ns}`));
assert.equal(process.env.APP_PRIME_TEST_SOCKET,socketDir);
assert.equal(fs.realpathSync(socketDir),socketDir);
assert.notEqual(fs.statSync('/var/lib/postgresql').dev,fs.statSync('/var/lib').dev);
assert.equal(fs.statfsSync('/var/lib/postgresql').type,0x01021994);
assert(fs.statSync(`${socketDir}/.s.PGSQL.5489`).isSocket());
assert.equal(process.env.DATABASE_URL,`postgresql://prime_test@/prime_test?host=${socketDir}&port=5489&sslmode=disable`);

const db=await import('./database/index.js');
const {migratePgMetier}=await import('./database/metier-migration.js');
const driver=await db.initDb();
const pool=driver.pool;
const col=async()=>Number((await pool.query("SELECT count(*) AS n FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='tableau_rubriques' AND column_name='prochaine_action_echeance'")).rows[0].n);
const routeur=async(id)=> (await pool.query("SELECT date,note,prochaine_action,prochaine_action_echeance FROM tableau_rubriques WHERE tableau_id=$1 AND key='routeur'",[id])).rows[0];
try {
  await test('PG filled pre-field board survives idempotent additive migration, archive and scoped writes', async()=>{
    const a=await db.createUserWithPrime({email:'board-a@example.test',passwordHash:'dummy',prenom:'A',nom:'One'});
    const b=await db.createUserWithPrime({email:'board-b@example.test',passwordHash:'dummy',prenom:'B',nom:'Two'});
    const client=await db.createClient({nom:'Legacy board',primeId:a.prime.id});
    const old=(await db.listTableaux(a.user.id,false)).find(t=>t.clientId===client.id);
    await pool.query("UPDATE tableau_rubriques SET date='2026-10-01',note='Legacy',prochaine_action='Call' WHERE tableau_id=$1 AND key='routeur'",[old.id]);
    await pool.query('ALTER TABLE tableau_rubriques DROP COLUMN prochaine_action_echeance');
    assert.equal(await col(),0);
    await migratePgMetier(pool,async()=>{});
    await migratePgMetier(pool,async()=>{});
    assert.equal(await col(),1);
    assert.deepEqual(await routeur(old.id),{date:'2026-10-01',note:'Legacy',prochaine_action:'Call',prochaine_action_echeance:null});
    const input={statut:'en_cours',date:'2026-10-01',note:'Updated',prochaineAction:'Call',prochaineActionEcheance:'2026-12-15',version:null};
    const initiallyOmitted=await db.updateTableauRubrique(old.id,'routeur',{...input,prochaineActionEcheance:undefined},a.user.id,false);
    assert.equal(initiallyOmitted.rubriques.find(r=>r.key==='routeur').prochaineActionEcheance,null);
    await assert.rejects(db.updateTableauRubrique(old.id,'routeur',input,b.user.id,false),e=>e.statusCode===404);
    for(const bad of ['2026-02-29','2026-04-31','2026-13-01','2026-1-01',''])
      await assert.rejects(db.updateTableauRubrique(old.id,'routeur',{...input,prochaineActionEcheance:bad},a.user.id,false),e=>e.statusCode===400);
    const updated=await db.updateTableauRubrique(old.id,'routeur',input,a.user.id,false);
    assert.equal(updated.rubriques.find(r=>r.key==='routeur').prochaineActionEcheance,input.prochaineActionEcheance);
    assert.equal((await routeur(old.id)).date,input.date);
    const auth=await import('./auth.js');
    async function token(user) {
      await db.upsertMfaPending(user.id,`fixture-${user.id}`);
      return auth.issueSessionToken(user,await db.enableMfa(user.id));
    }
    const aToken=await token(a.user), bToken=await token(b.user);
    const socket=net.createServer();
    await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
    const port=socket.address().port;
    await new Promise(resolve=>socket.close(resolve));
    const base=`http://127.0.0.1:${port}`;
    const child=spawn(process.execPath,['server/index.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port)},stdio:'ignore'});
    const call=async(method,route,bearer,body)=>{
      const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(bearer?{Authorization:`Bearer ${bearer}`}:{})},
        body:body===undefined?undefined:JSON.stringify(body)});
      return {status:response.status,data:await response.json()};
    };
    let next;
    try {
      let ready=false;
      for(let i=0;i<100;i++) {
        try { if((await fetch(`${base}/api/health`)).ok) { ready=true; break; } } catch {}
        if(child.exitCode!==null) throw new Error(`PostgreSQL HTTP server exited ${child.exitCode}`);
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      assert(ready,'PostgreSQL HTTP server not ready');
      const endpoint=`/api/tableaux-suivi/${old.id}/rubriques/routeur`;
      assert.equal((await call('PUT',endpoint,null,input)).status,401);
      assert.equal((await call('PUT',endpoint,bToken,input)).status,404);
      const legacy=await call('PUT',endpoint,aToken,{...input,note:'Cached client',prochaineActionEcheance:undefined});
      assert.equal(legacy.status,200);
      assert.equal(legacy.data.tableau.rubriques.find(r=>r.key==='routeur').prochaineActionEcheance,input.prochaineActionEcheance);
      assert.equal((await routeur(old.id)).prochaine_action_echeance,input.prochaineActionEcheance);
      assert.equal((await routeur(old.id)).note,'Cached client');
      for(const bad of ['2026-02-29','2026-04-31','2026-13-01','2026-1-01',''])
        assert.equal((await call('PUT',endpoint,aToken,{...input,prochaineActionEcheance:bad})).status,400);
      assert.equal((await routeur(old.id)).prochaine_action_echeance,input.prochaineActionEcheance);
      const cleared=await call('PUT',endpoint,aToken,{...input,prochaineActionEcheance:null});
      assert.equal(cleared.status,200);
      assert.equal(cleared.data.tableau.rubriques.find(r=>r.key==='routeur').prochaineActionEcheance,null);
      assert.equal((await routeur(old.id)).prochaine_action_echeance,null);
      const restored=await call('PUT',endpoint,aToken,input);
      assert.equal(restored.status,200);
      const replacement=await call('POST','/api/tableaux-suivi',aToken,{clientId:client.id,expectedActiveId:old.id});
      assert.equal(replacement.status,201);
      next=replacement.data.tableau;
      assert.equal((await call('PUT',endpoint,aToken,input)).status,409);
    } finally {
      if(child.exitCode===null) {
        child.kill();
        await new Promise(resolve=>child.once('exit',resolve));
      }
    }
    assert.equal(next.rubriques.find(r=>r.key==='routeur').prochaineActionEcheance,null);
    assert.equal((await db.listTableaux(a.user.id,false)).find(t=>t.id===old.id).rubriques.find(r=>r.key==='routeur').prochaineActionEcheance,input.prochaineActionEcheance);
    await assert.rejects(db.updateTableauRubrique(old.id,'routeur',input,a.user.id,false),e=>e.statusCode===409);
    assert.equal((await routeur(old.id)).prochaine_action_echeance,input.prochaineActionEcheance);
  });
  await test('PG rejects foreign identity before schema writes',async()=>{
    await pool.query('ALTER TABLE tableau_rubriques DROP COLUMN prochaine_action_echeance');
    await pool.query('CREATE TABLE foreign_marker (id INTEGER PRIMARY KEY)');
    let called=false;
    await assert.rejects(migratePgMetier(pool,async()=>{called=true;}),/Schéma étranger à App Prime/);
    assert.equal(called,false);
    assert.equal(await col(),0);
    await pool.query('DROP TABLE foreign_marker');
  });
  await test('PG migration rolls back added column if later validation fails',async()=>{
    await pool.query("UPDATE primes SET data='[]'::jsonb WHERE id=(SELECT min(id) FROM primes)");
    await assert.rejects(migratePgMetier(pool,async()=>{}),/data doit être un objet JSON/);
    assert.equal(await col(),0);
    await pool.query("UPDATE primes SET data='{\"nom\":\"Repaired\",\"specialites\":[]}'::jsonb WHERE id=(SELECT min(id) FROM primes)");
    await migratePgMetier(pool,async()=>{});
    assert.equal(await col(),1);
  });
} finally { await pool.end(); }
