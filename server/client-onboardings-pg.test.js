import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {CLIENT_ONBOARDING_TEMPLATE,createTemplateItems} from '../src/services/clientOnboardingService.ts';

// All guards must run before importing database/index.js (which may initialize a DB).
const socketDir='/var/lib/postgresql/prime-onboardings';
assert.equal(process.env.APP_PRIME_ISOLATED_TEST,'1','explicit disposable test marker required');
assert.equal(process.env.NODE_ENV,'test');
for (const namespace of ['net','mnt']) {
  assert.notEqual(fs.readlinkSync(`/proc/self/ns/${namespace}`),fs.readlinkSync(`/proc/1/ns/${namespace}`),`${namespace} namespace must differ from PID 1`);
}
assert.equal(process.env.APP_PRIME_TEST_SOCKET,socketDir,'explicit disposable socket required');
assert.equal(fs.realpathSync(socketDir),socketDir,'socket path must not be a symlink');
assert.notEqual(fs.statSync('/var/lib/postgresql').dev,fs.statSync('/var/lib').dev,'PostgreSQL directory must be a separate mount');
assert.equal(fs.statfsSync('/var/lib/postgresql').type,0x01021994,'PostgreSQL directory must be mounted as tmpfs');
assert.equal(fs.statfsSync(socketDir).type,0x01021994,'socket must live on disposable tmpfs');
assert(fs.statSync(`${socketDir}/.s.PGSQL.5489`).isSocket(),'disposable PG socket missing');
// Exact allowlist: no authority hostname/port, alternate host parameter,
// duplicate parameter, or environment-supplied remote DSN can pass.
assert.equal(process.env.DATABASE_URL,`postgresql://prime_test@/prime_test?host=${socketDir}&port=5489&sslmode=disable`);
const db=await import('./database/index.js');
const {checkPgMetierIdentity,migratePgMetier}=await import('./database/metier-migration.js');
const {createOnboardingSchemaPg}=await import('./database/client-onboardings.js');
const auth=await import('./auth.js');
const driver=await db.initDb();
const pool=driver.pool;
const admin=await db.createUser({email:'admin@example.test',passwordHash:'dummy',prenom:'Admin',nom:'One',role:'admin'});
const a=await db.createUserWithPrime({email:'a@example.test',passwordHash:'dummy',prenom:'A',nom:'Prime'});
const b=await db.createUserWithPrime({email:'b@example.test',passwordHash:'dummy',prenom:'B',nom:'Prime'});
const client=await db.createClient({nom:'Fixture',secteur:'Télécom',clientType:'ti',primeId:a.prime.id});
const tele=await db.createClient({nom:'Tele',secteur:'Services',clientType:'telecom',primeId:a.prime.id});
const actor=(u,role='prime')=>({sub:u.id,email:u.email,role});
const data={client_id:client.id,technicien_id:a.user.id,titre:'Audit',statut:'À faire',priorite:'Haute',compte_rendu:{resume_executif:'Résumé'}};
const items=[{section_key:'general',section_title:'General',item_order:1000,checked:true,element:'Audit',notes:'preuve',action:'agir',responsable:'Prime',echeance:'2026-12-12',statut:'Fait',priorite:'Haute'}];
const createOnboarding=(onboarding,checklist,user)=>db.createClientOnboarding(onboarding,checklist,user,randomUUID());
// Direct bulk rows in concurrency fixtures must have verifiable creation.
const proveSeeded=async ids=>pool.query(`INSERT INTO client_onboarding_history(onboarding_id,event_type,snapshot)
  SELECT id,'created',jsonb_build_object('onboarding',jsonb_build_object('id',id,'client_id',client_id),'items',jsonb_build_array(),'items_count',0)
  FROM client_onboardings WHERE id=ANY($1::int[])`,[ids]);
try {
  await test('PG public list and export detail use relational truth, never arbitrary data',async()=>{
    const saved=await createOnboarding({...data,urgence_ti:'Critique héritée'},items,actor(a.user));
    const poison={client_id:999,statut:'Fait',items:[{notes:'private'}],tech_email:'private@example.test',created_by_email:'private@example.test',urgence_ti:'Poison'};
    await pool.query('UPDATE client_onboardings SET data=$1 WHERE id=$2',[poison,saved.id]);
    const expected=['id','client_id','technicien_id','titre','statut','priorite','urgence_ti','site_principal','contact_principal','periode_couverte','prepare_pour','avancement_global','risques_critiques','actions_ouvertes','decisions_requises','prochaine_rencontre','compte_rendu','version','archived','archived_at','created_at','updated_at','client_nom','technicien_nom','technicien_email','total_items','completed_items','high_priority_open_items'];
    const summary=(await db.listClientOnboardings(actor(a.user),{clientId:String(client.id)})).find(r=>r.id===saved.id);
    const detail=await db.getClientOnboarding(saved.id,actor(a.user)); // export source
    for(const result of [summary,detail]) {
      assert.deepEqual(Object.keys(result).sort(),[...expected,...(result===detail?['items']:[])].sort());
      assert.equal(result.client_id,client.id);
      assert.equal(result.statut,'À faire');
      assert.equal(result.urgence_ti,'Critique héritée');
      assert.equal(result.technicien_email,a.user.email);
    }
    assert.equal(detail.items[0].notes,'preuve');
    assert.deepEqual((await pool.query('SELECT data FROM client_onboardings WHERE id=$1',[saved.id])).rows[0].data,poison);
    await pool.query('DELETE FROM client_onboardings WHERE id=$1',[saved.id]);
  });
  await test('PG nested projection drops valid-client secrets and preserves audit',async()=>{
    const A=actor(a.user),created=await createOnboarding(data,items,A);
    const secret='pg-private-nested-marker';
    const report={resume_executif:'Résumé',points_valides:'Conservé',vault_token:secret};
    await pool.query('UPDATE client_onboardings SET compte_rendu=$1 WHERE id=$2',[report,created.id]);
    await pool.query('ALTER TABLE client_onboarding_items ADD COLUMN private_key TEXT');
    await pool.query('UPDATE client_onboarding_items SET private_key=$1 WHERE onboarding_id=$2',[secret,created.id]);
    const original=(await pool.query('SELECT id,snapshot FROM client_onboarding_history WHERE onboarding_id=$1',[created.id])).rows[0];
    const historical=structuredClone(original.snapshot);
    historical.root_secret=secret;
    historical.different_client={client_id:tele.id,notes:secret};
    historical.onboarding.compte_rendu=report;
    historical.onboarding.created_by_email=secret;
    historical.onboarding.unlisted=secret;
    historical.items[0].private_key=secret;
    historical.items[0].notes='Historical approved';
    await pool.query('UPDATE client_onboarding_history SET snapshot=$1 WHERE id=$2',[historical,original.id]);
    const check=result=>{assert.equal(result.compte_rendu.resume_executif,'Résumé');assert.equal(result.compte_rendu.points_valides,'Conservé');assert.deepEqual(Object.keys(result.compte_rendu).sort(),['points_valides','resume_executif']);assert(!JSON.stringify(result).includes(secret));};
    for(const result of [await db.getClientOnboarding(created.id,A),(await db.listClientOnboardings(A,{clientId:String(client.id)})).find(r=>r.id===created.id)]) check(result);
    const event=(await db.getClientOnboardingHistory(created.id,A)).events[0];
    assert.equal(event.snapshot.items[0].notes,'Historical approved');
    assert.equal(event.snapshot.items_count,1);
    assert.deepEqual(Object.keys(event.snapshot).sort(),['items','items_count','onboarding']);
    assert(!JSON.stringify(event.snapshot).includes(secret));
    assert.deepEqual((await pool.query('SELECT snapshot FROM client_onboarding_history WHERE id=$1',[original.id])).rows[0].snapshot,historical);
    assert.deepEqual((await pool.query('SELECT compte_rendu FROM client_onboardings WHERE id=$1',[created.id])).rows[0].compte_rendu,report);
    const updated=await db.updateClientOnboarding(created.id,data,undefined,A,1);
    assert(!JSON.stringify(updated).includes(secret));
    assert(!JSON.stringify((await db.getClientOnboardingHistory(created.id,A)).events).includes(secret));
    await pool.query('DELETE FROM client_onboardings WHERE id=$1',[created.id]);
    await pool.query('ALTER TABLE client_onboarding_items DROP COLUMN private_key');
  });
  await test('PG malformed stored report and historical checklist fail visibly',async()=>{
    const A=actor(a.user),saved=await createOnboarding(data,items,A);
    const original=(await pool.query('SELECT id,snapshot FROM client_onboarding_history WHERE onboarding_id=$1',[saved.id])).rows[0];
    await pool.query('UPDATE client_onboardings SET compte_rendu=$1 WHERE id=$2',['null',saved.id]);
    await assert.rejects(db.getClientOnboarding(saved.id,A),e=>e.statusCode===500);
    await assert.rejects(db.listClientOnboardings(A,{clientId:String(client.id)}),e=>e.statusCode===500);
    await pool.query('UPDATE client_onboardings SET compte_rendu=$1 WHERE id=$2',['{}',saved.id]);
    const broken=structuredClone(original.snapshot);delete broken.items;
    await pool.query('UPDATE client_onboarding_history SET snapshot=$1 WHERE id=$2',[broken,original.id]);
    await assert.rejects(db.getClientOnboardingHistory(saved.id,A),e=>e.statusCode===404);
    assert.deepEqual((await pool.query('SELECT snapshot FROM client_onboarding_history WHERE id=$1',[original.id])).rows[0].snapshot,broken);
    await pool.query('DELETE FROM client_onboardings WHERE id=$1',[saved.id]);
  });
  await test('PG canonical 123-item checklist keeps 11-section order through save, reopen and history',async()=>{
    const template=createTemplateItems();
    assert.equal(CLIENT_ONBOARDING_TEMPLATE.length,11);
    assert.equal(template.length,123);
    const expected=template.map(({section_key,item_order,element})=>[section_key,item_order,element]);
    assert.equal(expected[0][0],'informations-generales');
    const check=record=>{
      assert.equal(record.items.length,123);
      assert.deepEqual(record.items.map(({section_key,item_order,element})=>[section_key,item_order,element]),expected);
      assert.deepEqual([...new Set(record.items.map(i=>i.section_key))],CLIENT_ONBOARDING_TEMPLATE.map(s=>s.key));
    };
    const created=await createOnboarding(data,template,actor(a.user));
    check(created);
    check(await db.getClientOnboarding(created.id,actor(a.user)));
    const changed=template.map((item,i)=>i===0?{...item,checked:true,notes:'Persisted'}:item);
    const updated=await db.updateClientOnboarding(created.id,{...data,titre:'Saved again'},changed,actor(a.user),1);
    check(updated);
    check(await db.getClientOnboarding(created.id,actor(a.user)));
    const history=(await db.getClientOnboardingHistory(created.id,actor(a.user))).events;
    assert.equal(history.length,2);
    for(const event of history) check(event.snapshot);
    assert.equal(history[0].snapshot.items[0].notes,'Persisted');
    assert.equal(history[1].snapshot.items[0].checked,false);
    await pool.query('DELETE FROM client_onboardings WHERE id=$1',[created.id]);
  });
  await test('PG completion wins concurrent version race and remains locked after restore',async()=>{
    const A=actor(a.user), ADMIN=actor(admin,'admin');
    const source=await createOnboarding(data,items,A);
    const [first,second]=await Promise.allSettled([
      db.updateClientOnboarding(source.id,{...data,statut:'Fait'},items,A,1),
      db.updateClientOnboarding(source.id,{...data,titre:'Concurrent edit'},items,ADMIN,1)
    ]);
    assert.equal([first,second].filter(result=>result.status==='fulfilled').length,1);
    assert.equal([first,second].filter(result=>result.status==='rejected' && result.reason.statusCode===409).length,1);
    let completed=first.status==='fulfilled' ? first.value : null;
    if (!completed) completed=await db.updateClientOnboarding(source.id,{...data,statut:'Fait'},items,A,2);
    const before=await db.getClientOnboarding(source.id,A);
    for(const [change,checklist,version] of [
      [{...data,statut:'À faire'},items,completed.version],
      [{...data,client_id:tele.id},items,completed.version],
      [{...data,compte_rendu:{resume_executif:'Changed'}},items,completed.version],
      [{...data},[{...items[0],notes:'Changed'}],completed.version],
      [{...data},items,1]
    ]) await assert.rejects(db.updateClientOnboarding(source.id,change,checklist,ADMIN,version),e=>e.statusCode===409);
    const archived=await db.archiveClientOnboarding(source.id,A,completed.version);
    const restored=await db.restoreClientOnboarding(source.id,A,archived.version);
    await assert.rejects(db.updateClientOnboarding(source.id,data,items,ADMIN,restored.version),e=>e.statusCode===409);
    assert.equal((await db.getClientOnboarding(source.id,A)).statut,'Fait');
    assert.deepEqual((await db.getClientOnboarding(source.id,A)).items,before.items);
    assert.equal((await db.getClientOnboardingHistory(source.id,A)).events.length,first.status==='fulfilled'?4:5);
    const direct=await createOnboarding({...data,statut:'Fait'},items,A);
    await assert.rejects(db.updateClientOnboarding(direct.id,data,items,ADMIN,1),e=>e.statusCode===409);
    await pool.query('DELETE FROM client_onboardings WHERE id=ANY($1::int[])',[[source.id,direct.id]]);
  });
  await test('PG persisted client is immutable; Prime reassignment of that client retains edit rights',async()=>{
    const A=actor(a.user), B=actor(b.user), ADMIN=actor(admin,'admin');
    const original=await db.createClient({nom:'Original privé PG',clientType:'ti',primeId:a.prime.id});
    const other=await db.createClient({nom:'Autre privé PG',clientType:'ti',primeId:a.prime.id});
    const dossier=await createOnboarding({...data,client_id:original.id},[{...items[0],notes:'Secret PG'}],A);
    await assert.rejects(db.updateClientOnboarding(dossier.id,{...data,client_id:other.id,compte_rendu:{resume_executif:'Secret transféré'}},items,ADMIN,1),e=>e.statusCode===409);
    const prior=await db.getClientOnboarding(dossier.id,A);
    assert.equal(prior.client_id,original.id);assert.equal(prior.version,1);assert.equal(prior.items[0].notes,'Secret PG');
    assert.equal((await db.getClientOnboardingHistory(dossier.id,A)).events.length,1);
    assert.equal((await db.listClientOnboardings(A,{clientId:String(other.id)})).length,0);
    const replacement=await createOnboarding({...data,client_id:other.id},items,A);
    assert.equal(replacement.client_id,other.id);
    await pool.query('UPDATE clients SET prime_id=$1 WHERE id=$2',[b.prime.id,original.id]);
    await assert.rejects(db.getClientOnboarding(dossier.id,A),e=>e.statusCode===404);
    const edited=await db.updateClientOnboarding(dossier.id,{...data,client_id:original.id,technicien_id:b.user.id,titre:'Même client PG'},items,B,1);
    assert.equal(edited.client_id,original.id);assert.equal(edited.version,2);
    assert.equal((await db.getClientOnboardingHistory(dossier.id,B)).events.length,2);
    await pool.query('DELETE FROM client_onboardings WHERE id=ANY($1::int[])',[[dossier.id,replacement.id]]);
    await pool.query('DELETE FROM clients WHERE id=ANY($1::int[])',[[original.id,other.id]]);
  });
  await test('PG portfolio waits on the list gate before locking any Prime or client',async()=>{
    const prime=await db.createPrime({nom:'Gate portfolio'});
    const owned=await db.createClient({nom:'Gate client',clientType:'ti',primeId:prime.id});
    const seeded=await pool.query("INSERT INTO client_onboardings(request_key,client_id,titre,statut,priorite) VALUES($1,$2,'Gate','À faire','Haute') RETURNING id",[randomUUID(),owned.id]);
    await proveSeeded(seeded.rows.map(r=>r.id));
    let release,signal;
    const held=new Promise(resolve=>{release=resolve;});
    const locked=new Promise(resolve=>{signal=resolve;});
    let listPid,listing,portfolio;
    const probe={kind:'pg',pool:{connect:async()=>{
      const conn=await pool.connect();
      listPid=(await conn.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      return {query:async(sql,vals)=>{
        const result=await conn.query(sql,vals);
        if(String(sql)==='SELECT id FROM clients WHERE id=$1 FOR SHARE' && vals[0]===owned.id) {signal();await held;}
        return result;
      },release:()=>conn.release()};
    }}};
    try {
      const {list}=await import('./database/client-onboardings.js');
      listing=list(probe,actor(admin,'admin'));
      await locked;
      portfolio=db.updatePrimePortfolio(prime.id,{nom:'Gate updated'},{add:[],remove:[]});
      let blocked;
      for(let attempt=0;attempt<150;attempt++) {
        const result=await pool.query(`SELECT query FROM pg_stat_activity WHERE pid<>$1 AND wait_event_type='Lock'
          AND (query LIKE 'SELECT pg_advisory_xact_lock%' OR query LIKE 'SELECT * FROM clients ORDER BY id FOR UPDATE%')`,[listPid]);
        if(result.rows.length) {blocked=result.rows[0].query;break;}
        await new Promise(resolve=>setTimeout(resolve,20));
      }
      assert(blocked,'portfolio must wait while list holds a client lock');
      assert.equal(blocked,'SELECT pg_advisory_xact_lock(176930415, 20261106)',
        'portfolio must acquire the exclusive list gate before its Prime/client locks');
      release();
      const results=await Promise.allSettled([listing,portfolio]);
      assert.deepEqual(results.map(r=>r.status==='fulfilled'?'ok':r.reason.code),['ok','ok']);
      assert.equal((await pool.query('SELECT data->>\'nom\' AS nom FROM primes WHERE id=$1',[prime.id])).rows[0].nom,'Gate updated');
    } finally {
      release();
      await Promise.allSettled([listing,portfolio].filter(Boolean));
      await pool.query('DELETE FROM client_onboardings WHERE client_id=$1',[owned.id]);
      await pool.query('DELETE FROM tableaux_suivi WHERE client_id=$1',[owned.id]);
      await pool.query('DELETE FROM clients WHERE id=$1',[owned.id]);
      await pool.query('DELETE FROM primes WHERE id=$1',[prime.id]);
    }
  });
  await test('PG portfolio and list backfill finish without inverted client locks',async()=>{
    const prime=await db.createPrime({nom:'Backfill portfolio'});
    const early=await db.createClient({nom:'Early',clientType:'ti',primeId:prime.id});
    const late=await db.createClient({nom:'Late',clientType:'ti',primeId:prime.id});
    const earlyRow=await pool.query("INSERT INTO client_onboardings(request_key,client_id,titre,statut,priorite) VALUES($1,$2,'Early','À faire','Haute') RETURNING id",[randomUUID(),early.id]);
    await proveSeeded(earlyRow.rows.map(r=>r.id));
    const keys=Array.from({length:50},()=>randomUUID());
    const lateRows=await pool.query(`INSERT INTO client_onboardings(request_key,client_id,titre,statut,priorite)
      SELECT key,$1,'Late','À faire','Haute' FROM unnest($2::text[]) AS key RETURNING id`,[late.id,keys]);
    await proveSeeded(lateRows.rows.map(r=>r.id));
    let release,signal,changed=false,listing,portfolio;
    const held=new Promise(resolve=>{release=resolve;});
    const locked=new Promise(resolve=>{signal=resolve;});
    const probe={kind:'pg',pool:{connect:async()=>{
      const conn=await pool.connect();
      return {query:async(sql,vals)=>{
        const result=await conn.query(sql,vals);
        if(!changed && String(sql).startsWith('SELECT o.id,o.client_id ')) {
          changed=true;
          await pool.query("UPDATE clients SET data=jsonb_set(data,'{clientType}', '\"telecom\"'::jsonb) WHERE id=$1",[late.id]);
        }
        if(String(sql)==='SELECT id FROM clients WHERE id=$1 FOR SHARE' && vals[0]===late.id) {signal();await held;}
        return result;
      },release:()=>conn.release()};
    }}};
    try {
      const {list}=await import('./database/client-onboardings.js');
      listing=list(probe,actor(admin,'admin'));
      await locked;
      portfolio=db.updatePrimePortfolio(prime.id,{nom:'Backfill saved'},{add:[],remove:[]});
      // Let the portfolio transaction reach the lock contention before the
      // list proceeds to its second page (which discovers the lower client).
      let blocked=false;
      for(let attempt=0;attempt<150;attempt++) {
        const result=await pool.query(`SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock'
          AND (query LIKE 'SELECT pg_advisory_xact_lock%' OR query LIKE 'SELECT * FROM clients ORDER BY id FOR UPDATE%') LIMIT 1`);
        if(result.rowCount) {blocked=true;break;}
        await new Promise(resolve=>setTimeout(resolve,20));
      }
      assert(blocked,'portfolio must contend with list before backfill');
      release();
      const results=await Promise.allSettled([listing,portfolio]);
      assert.deepEqual(results.map(r=>r.status==='fulfilled'?'ok':r.reason.code),['ok','ok'],
        'backfill and real portfolio update must not raise PostgreSQL 40P01');
      assert(changed);
      assert.deepEqual(results[0].value.map(r=>r.id),[earlyRow.rows[0].id]);
      assert.equal(results[1].value.prime.nom,'Backfill saved');
    } finally {
      release();
      await Promise.allSettled([listing,portfolio].filter(Boolean));
      await pool.query('DELETE FROM client_onboardings WHERE client_id=ANY($1::int[])',[[early.id,late.id]]);
      await pool.query('DELETE FROM tableaux_suivi WHERE client_id=ANY($1::int[])',[[early.id,late.id]]);
      await pool.query('DELETE FROM clients WHERE id=ANY($1::int[])',[[early.id,late.id]]);
      await pool.query('DELETE FROM primes WHERE id=$1',[prime.id]);
    }
  });
  await test('PG list and rejected cross-client PUT use one client lock order',async()=>{
    const sourceClient=await db.createClient({nom:'Ordered A',clientType:'ti',primeId:a.prime.id});
    const destination=await db.createClient({nom:'Ordered B',clientType:'ti',primeId:a.prime.id});
    const source=await createOnboarding({...data,client_id:sourceClient.id},items,actor(a.user));
    const keys=Array.from({length:51},()=>randomUUID());
    const bulk=await pool.query(`INSERT INTO client_onboardings (request_key,client_id,titre,statut,priorite)
      SELECT key,$1,'Ordered '||ordinality,$3,$4 FROM unnest($2::text[]) WITH ORDINALITY AS t(key,ordinality) RETURNING id`,
      [sourceClient.id,keys,data.statut,data.priorite]);
    await proveSeeded(bulk.rows.map(r=>r.id));
    const newest=await createOnboarding({...data,client_id:destination.id},items,actor(a.user));
    let releaseA;
    const gate=new Promise(resolve=>{releaseA=resolve;});
    let acquiredA;
    const acquired=new Promise(resolve=>{acquiredA=resolve;});
    const {mutate,list}=await import('./database/client-onboardings.js');
    const mutationDriver={kind:'pg',pool:{connect:async()=>{
      const conn=await pool.connect();
      return {query:async(sql,vals)=>{
        const result=await conn.query(sql,vals);
        if (String(sql)==='SELECT id FROM clients WHERE id=$1 FOR UPDATE' && vals[0]===sourceClient.id) {
          acquiredA(); await gate;
        }
        return result;
      },release:()=>conn.release()};
    }}};
    let listPid;
    const listDriver={kind:'pg',pool:{connect:async()=>{
      const conn=await pool.connect();
      listPid=(await conn.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      return conn;
    }}};
    let mutation,listing;
    try {
      mutation=mutate(mutationDriver,source.id,{...data,client_id:destination.id},items,actor(a.user),'updated',1);
      await acquired;
      listing=list(listDriver,actor(a.user));
      let blocked=false;
      for(let attempt=0;attempt<150;attempt++) {
        if(listPid && (await pool.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[listPid])).rows[0]?.wait_event_type==='Lock') {blocked=true;break;}
        await new Promise(resolve=>setTimeout(resolve,20));
      }
      assert(blocked,'list must reach a client lock while transfer holds A');
      releaseA();
      const results=await Promise.allSettled([mutation,listing]);
      assert.deepEqual(results.map(r=>r.status==='fulfilled'?'ok':r.reason.statusCode),[409,'ok'],
        'list and rejected transfer must not raise PostgreSQL 40P01');
      assert.equal((await db.getClientOnboarding(source.id,actor(a.user))).client_id,sourceClient.id);
      const rows=results[1].value;
      assert.equal(rows.length,50);
      assert(rows.some(r=>r.id===newest.id));
      assert(rows.every(r=>r.client_id===sourceClient.id || r.client_id===destination.id));
    } finally {
      releaseA();
      await Promise.allSettled([mutation,listing].filter(Boolean));
      await pool.query('DELETE FROM client_onboardings WHERE client_id=ANY($1::int[])',[[sourceClient.id,destination.id]]);
      await pool.query('DELETE FROM tableaux_suivi WHERE client_id=ANY($1::int[])',[[sourceClient.id,destination.id]]);
      await pool.query('DELETE FROM clients WHERE id=ANY($1::int[])',[[sourceClient.id,destination.id]]);
    }
  });
  await test('PG backfill cannot invert locks when its second batch discovers A',async()=>{
    const sourceClient=await db.createClient({nom:'Backfill A',clientType:'ti',primeId:a.prime.id});
    const destination=await db.createClient({nom:'Backfill B',clientType:'ti',primeId:a.prime.id});
    const foreign=await db.createClient({nom:'Backfill foreign',clientType:'ti',primeId:b.prime.id});
    const source=await createOnboarding({...data,client_id:sourceClient.id},items,actor(a.user));
    const keys=Array.from({length:50},()=>randomUUID());
    const seeded=await pool.query(`INSERT INTO client_onboardings (request_key,client_id,titre,statut,priorite)
      SELECT key,$1,'Backfill '||ordinality,$3,$4 FROM unnest($2::text[]) WITH ORDINALITY AS t(key,ordinality) RETURNING id`,
      [destination.id,keys,data.statut,data.priorite]);
    await proveSeeded(seeded.rows.map(r=>r.id));
    const diverted=seeded.rows.at(-1).id;
    let releaseA;
    const gate=new Promise(resolve=>{releaseA=resolve;});
    let acquiredA;
    const acquired=new Promise(resolve=>{acquiredA=resolve;});
    const {mutate,list}=await import('./database/client-onboardings.js');
    const mutationDriver={kind:'pg',pool:{connect:async()=>{
      const conn=await pool.connect();
      return {query:async(sql,vals)=>{
        const result=await conn.query(sql,vals);
        if(String(sql)==='SELECT id FROM clients WHERE id=$1 FOR UPDATE' && vals[0]===sourceClient.id) {
          acquiredA();await gate;
        }
        return result;
      },release:()=>conn.release()};
    }}};
    let listPid,divertedDuringScan=false;
    const listDriver={kind:'pg',pool:{connect:async()=>{
      const conn=await pool.connect();
      listPid=(await conn.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      return {query:async(sql,vals)=>{
        const result=await conn.query(sql,vals);
        if(!divertedDuringScan && String(sql).startsWith('SELECT o.id,o.client_id ')) {
          divertedDuringScan=true;
          await pool.query('UPDATE client_onboardings SET client_id=$1 WHERE id=$2',[foreign.id,diverted]);
        }
        return result;
      },release:()=>conn.release()};
    }}};
    let mutation,listing;
    try {
      mutation=mutate(mutationDriver,source.id,{...data,client_id:destination.id},items,actor(a.user),'updated',1);
      await acquired;
      listing=list(listDriver,actor(a.user));
      let blocked=false;
      for(let attempt=0;attempt<150;attempt++) {
        if(listPid && (await pool.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[listPid])).rows[0]?.wait_event_type==='Lock') {blocked=true;break;}
        await new Promise(resolve=>setTimeout(resolve,20));
      }
      assert(blocked,'list must reach the transfer lock while A is held');
      releaseA();
      const results=await Promise.allSettled([mutation,listing]);
      assert.deepEqual(results.map(r=>r.status==='fulfilled'?'ok':r.reason.statusCode),[409,'ok']);
      assert(divertedDuringScan);
      assert(!results[1].value.some(r=>r.id===diverted),'foreign row must not escape');
      assert(results[1].value.length>=49,'backfill must preserve a full page when available');
    } finally {
      releaseA();
      await Promise.allSettled([mutation,listing].filter(Boolean));
      await pool.query('DELETE FROM client_onboardings WHERE client_id=ANY($1::int[])',[[sourceClient.id,destination.id,foreign.id]]);
      await pool.query('DELETE FROM tableaux_suivi WHERE client_id=ANY($1::int[])',[[sourceClient.id,destination.id,foreign.id]]);
      await pool.query('DELETE FROM clients WHERE id=ANY($1::int[])',[[sourceClient.id,destination.id,foreign.id]]);
    }
  });
  await test('PG simultaneous opposite client changes are both rejected without deadlock',async()=>{
    const left=await db.createClient({nom:'Cross left',clientType:'ti',primeId:a.prime.id});
    const right=await db.createClient({nom:'Cross right',clientType:'ti',primeId:b.prime.id});
    const leftRow=await createOnboarding({...data,client_id:left.id},items,actor(admin,'admin'));
    const rightRow=await createOnboarding({...data,client_id:right.id},items,actor(admin,'admin'));
    const {mutate}=await import('./database/client-onboardings.js');
    // Give both transactions time to lock their source before the onboarding row.
    // The old source -> onboarding -> target ordering deadlocks on opposite transfers.
    const probe={kind:'pg',pool:{connect:async()=>{
      const conn=await pool.connect();
      return {query:async(sql,vals)=>{
        if (String(sql).startsWith('SELECT * FROM client_onboardings WHERE id=') && String(sql).includes('FOR UPDATE'))
          await new Promise(resolve=>setTimeout(resolve,100));
        return conn.query(sql,vals);
      },release:()=>conn.release()};
    }}};
    try {
      const attempts=await Promise.allSettled([
        mutate(probe,leftRow.id,{...data,client_id:right.id,technicien_id:null},items,actor(admin,'admin'),'updated',1),
        mutate(probe,rightRow.id,{...data,client_id:left.id,technicien_id:null},items,actor(admin,'admin'),'updated',1)
      ]);
      assert.deepEqual(attempts.map(r=>r.status==='fulfilled'?r.value.version:{code:r.reason.code,statusCode:r.reason.statusCode}),
        [{code:undefined,statusCode:409},{code:undefined,statusCode:409}],
        'both cross-client writes must be rejected, never raise 40P01 (HTTP 500)');
      assert.deepEqual((await pool.query('SELECT id,client_id,version FROM client_onboardings WHERE id=ANY($1::int[]) ORDER BY id',[[leftRow.id,rightRow.id]])).rows.map(r=>[r.id,r.client_id,r.version]),
        [[leftRow.id,left.id,1],[rightRow.id,right.id,1]]);
      const sameClient=await mutate(probe,leftRow.id,{...data,client_id:left.id,technicien_id:null},items,actor(admin,'admin'),'updated',1);
      assert.equal(sameClient.version,2);
      await assert.rejects(mutate(probe,leftRow.id,{...data,client_id:right.id,technicien_id:null},items,actor(admin,'admin'),'updated',1),e=>e.statusCode===409);
      await assert.rejects(mutate(probe,leftRow.id,{...data,client_id:left.id,technicien_id:null},items,actor(b.user),'updated',2),e=>e.statusCode===404);
    } finally {
      await pool.query('DELETE FROM client_onboardings WHERE id=ANY($1::int[])',[[leftRow.id,rightRow.id]]);
      await pool.query('DELETE FROM tableaux_suivi WHERE client_id=ANY($1::int[])',[[left.id,right.id]]);
      await pool.query('DELETE FROM clients WHERE id=ANY($1::int[])',[[left.id,right.id]]);
    }
  });
  await test('PG list never returns a row reassigned while its old client lock is pending',async()=>{
    const keys=Array.from({length:52},()=>randomUUID());
    const seeded=await pool.query(`INSERT INTO client_onboardings
      (request_key,client_id,titre,statut,priorite,created_by_id,created_by_email,updated_by_id,updated_by_email)
      SELECT key,$1,'Paged '||ordinality,$3,$4,$5,$6,$5,$6
      FROM unnest($2::text[]) WITH ORDINALITY AS rows(key,ordinality) RETURNING id`,
      [client.id,keys,data.statut,data.priorite,a.user.id,a.user.email]);
    await proveSeeded(seeded.rows.map(r=>r.id));
    const source=await createOnboarding(data,items,actor(a.user));
    const recipient=await db.createClient({nom:'List recipient',clientType:'ti',primeId:b.prime.id});
    const locker=await pool.connect();
    let pending;
    try {
      await locker.query('BEGIN');
      await locker.query('SELECT id FROM clients WHERE id=$1 FOR UPDATE',[client.id]);
      let backendPid;
      const probe={kind:'pg',pool:{connect:async()=>{
        const conn=await pool.connect();
        backendPid=(await conn.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        return conn;
      }}};
      const {list}=await import('./database/client-onboardings.js');
      pending=list(probe,actor(a.user),{clientId:String(client.id)});
      let blocked=false;
      for(let attempt=0;attempt<100;attempt++) {
        if(backendPid) {
          const state=(await pool.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[backendPid])).rows[0];
          if(state?.wait_event_type==='Lock'){blocked=true;break;}
        }
        await new Promise(resolve=>setTimeout(resolve,20));
      }
      assert(blocked,'list must be waiting on the client row lock');
      // The row moves while the SELECT still holds its pre-transfer snapshot.
      await pool.query('UPDATE client_onboardings SET client_id=$1 WHERE id=$2',[recipient.id,source.id]);
      await locker.query('COMMIT');
      const result=await pending;
      pending=null;
      assert(!result.some(row=>row.id===source.id),'former Prime must not receive transferred onboarding');
      assert.equal(result.length,50,'transferred row must be backfilled to a full page');
      const next=await db.listClientOnboardings(actor(a.user),{clientId:String(client.id),before:String(result.at(-1).id)});
      assert(next.length<=50);
      assert.deepEqual([...result,...next].map(row=>row.id),seeded.rows.map(row=>row.id).reverse(),
        'cursor pages must include every authorized row exactly once in descending order');
    } finally {
      await locker.query('ROLLBACK').catch(()=>{});
      locker.release();
      if(pending) await pending.catch(()=>{});
      await pool.query('DELETE FROM client_onboardings WHERE id=$1',[source.id]);
      await pool.query('DELETE FROM client_onboardings WHERE request_key = ANY($1::text[])',[keys]);
      await pool.query('DELETE FROM tableaux_suivi WHERE client_id=$1',[recipient.id]);
      await pool.query('DELETE FROM clients WHERE id=$1',[recipient.id]);
    }
  });
  await test('PG list revalidates client ownership and TI type after candidate selection',async()=>{
    for(const change of ['ownership','type']) {
      const owned=await db.createClient({nom:`Recheck ${change}`,clientType:'ti',primeId:a.prime.id});
      const dossier=await createOnboarding({...data,client_id:owned.id},items,actor(a.user));
      let changed=false;
      const probe={kind:'pg',pool:{connect:async()=>{
        const conn=await pool.connect();
        return {query:async(sql,vals)=>{
          const result=await conn.query(sql,vals);
          if(!changed && String(sql).startsWith('SELECT o.id,o.client_id ')) {
            changed=true;
            if(change==='ownership') await pool.query('UPDATE clients SET prime_id=$1 WHERE id=$2',[b.prime.id,owned.id]);
            else await pool.query("UPDATE clients SET data=jsonb_set(data,'{clientType}', '\"telecom\"'::jsonb) WHERE id=$1",[owned.id]);
          }
          return result;
        },release:()=>conn.release()};
      }}};
      try {
        const {list}=await import('./database/client-onboardings.js');
        const rows=await list(probe,actor(a.user),{clientId:String(owned.id)});
        assert(changed,'candidate query must be intercepted');
        assert(!rows.some(r=>r.id===dossier.id),`${change} must be checked after client locks`);
      } finally {
        await pool.query('DELETE FROM client_onboardings WHERE id=$1',[dossier.id]);
        await pool.query('DELETE FROM tableaux_suivi WHERE client_id=$1',[owned.id]);
        await pool.query('DELETE FROM clients WHERE id=$1',[owned.id]);
      }
    }
  });
  await test('PG item order rejects null, false and nonintegers',async()=>{
    for(const item_order of [null,false,1.5,'1']) {
      await assert.rejects(createOnboarding(data,[{...items[0],item_order}],actor(a.user)),e=>e.statusCode===400);
    }
  });
  await test('PG equal global orders use section key as deterministic tie-breaker',async()=>{
    const tied=[{...items[0],section_key:'z',item_order:8},{...items[0],section_key:'a',item_order:8},{...items[0],section_key:'m',item_order:3}];
    const saved=await createOnboarding(data,tied,actor(a.user));
    const order=['m','a','z'];
    assert.deepEqual(saved.items.map(i=>i.section_key),order);
    assert.deepEqual((await db.getClientOnboarding(saved.id,actor(a.user))).items.map(i=>i.section_key),order);
    assert.deepEqual((await db.getClientOnboardingHistory(saved.id,actor(a.user))).events[0].snapshot.items.map(i=>i.section_key),order);
    await pool.query('DELETE FROM client_onboardings WHERE id=$1',[saved.id]);
  });
  await test('PG concurrent key and scoped reconciliation',async()=>{
    const key=randomUUID();
    await assert.rejects(db.createClientOnboarding(data,items,actor(a.user)),e=>e.statusCode===400);
    const attempts=await Promise.allSettled(Array.from({length:2},()=>db.createClientOnboarding(data,items,actor(a.user),key)));
    assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(attempts.filter(r=>r.status==='rejected' && r.reason.statusCode===409).length,1);
    const first=attempts.find(r=>r.status==='fulfilled').value;
    await assert.rejects(db.createClientOnboarding({...data,titre:'Different'},items,actor(a.user),key),e=>e.statusCode===409);
    assert.equal((await pool.query('SELECT COUNT(*)::int n FROM client_onboardings WHERE request_key=$1',[key])).rows[0].n,1);
    assert.deepEqual(await db.reconcileClientOnboarding(key,actor(a.user)),{found:true,id:first.id,archived:false});
    await assert.rejects(db.reconcileClientOnboarding(key,actor(b.user)),e=>e.statusCode===404);
    await db.updateClientOnboarding(first.id,{...data,titre:'Renamed'},items,actor(a.user),1);
    await db.archiveClientOnboarding(first.id,actor(a.user),2);
    assert.deepEqual(await db.reconcileClientOnboarding(key,actor(a.user)),{found:true,id:first.id,archived:true});
    await pool.query('DELETE FROM client_onboardings WHERE id=$1',[first.id]);
  });
  await test('PG existing schema migration preserves clients, then CRUD',async()=>{
    await pool.query('DROP TABLE client_onboarding_history, client_onboarding_items, client_onboardings');
    await checkPgMetierIdentity(pool);
    await migratePgMetier(pool,createOnboardingSchemaPg);
    assert.equal((await pool.query('SELECT COUNT(*)::int n FROM clients')).rows[0].n,2);
    assert.equal((await pool.query("SELECT COUNT(*)::int n FROM pg_indexes WHERE tablename LIKE 'client_onboarding%' AND indexname LIKE 'idx_prime_onboarding%'")).rows[0].n,5);
    await checkPgMetierIdentity(pool);
    await migratePgMetier(pool, async()=>{});
    assert.equal((await db.clientOnboardingOptions(actor(a.user))).clients.length,1);
    const unknown=await db.createClient({nom:'Unknown',secteur:'TI',primeId:a.prime.id});
    assert.equal(unknown.clientType,null);
    await assert.rejects(createOnboarding({...data,client_id:unknown.id},items,actor(a.user)),e=>e.statusCode===404);
    assert.equal((await db.updateClient(unknown.id,{nom:'Unknown',primeId:a.prime.id,clientType:'ti'},{primeId:a.prime.id,servoClientId:null})).clientType,'ti');
    assert.equal((await db.updateClient(unknown.id,{nom:'Unknown',primeId:a.prime.id},{primeId:a.prime.id,servoClientId:null})).clientType,'ti');
    await assert.rejects(createOnboarding({...data,client_id:tele.id},items,actor(admin,'admin')),e=>e.statusCode===404);
    const created=await createOnboarding(data,items,actor(a.user));
    assert.equal(created.version,1);assert.equal(created.items[0].echeance,'2026-12-12');
    assert.equal(created.completed_items,1);
    const summary=(await db.listClientOnboardings(actor(a.user),{search:'Audit',limit:'1'}))[0];
    assert.equal(summary.total_items,1);assert.equal(summary.completed_items,1);
    assert.equal(summary.high_priority_open_items,0);
    assert.equal(Object.hasOwn(summary,'history'),false);
    assert.equal((await db.listClientOnboardings(actor(a.user),{search:'Audit %'})).length,0);
    const decoy=await createOnboarding({...data,titre:'Literal X marker'},items,actor(a.user));
    for(const literal of ['%','_','\\']) {
      const result=await createOnboarding({...data,titre:`Literal ${literal} marker`},items,actor(a.user));
      assert.deepEqual((await db.listClientOnboardings(actor(a.user),{search:`Literal ${literal} marker`})).map(r=>r.id),[result.id]);
      await pool.query('DELETE FROM client_onboardings WHERE id=$1',[result.id]);
    }
    await pool.query('DELETE FROM client_onboardings WHERE id=$1',[decoy.id]);
    await assert.rejects(db.getClientOnboarding(created.id,actor(b.user)),e=>e.statusCode===404);
    await assert.rejects(db.updateClientOnboarding(created.id,data,items,actor(a.user),999),e=>e.statusCode===409);
    const updated=await db.updateClientOnboarding(created.id,{...data,statut:'En cours'},[{...items[0],notes:'second'}],actor(a.user),1);
    assert.equal(updated.version,2);
    assert.equal(Object.hasOwn(updated,'history'),false);
    const recent=(await db.getClientOnboardingHistory(created.id,actor(a.user))).events;
    assert.equal(recent[1].snapshot.items[0].notes,'preuve');
    assert.equal(recent[0].snapshot.items[0].notes,'second');
    await assert.rejects(db.updateClient(client.id,{nom:'Fixture',primeId:a.prime.id,clientType:'telecom'},{primeId:a.prime.id,servoClientId:null}),e=>e.statusCode===409);
    await assert.rejects(db.updateClient(client.id,{nom:'Fixture',primeId:a.prime.id,clientType:'invalid'},{primeId:a.prime.id,servoClientId:null}),e=>e.statusCode===400);
    const archived=await db.archiveClientOnboarding(created.id,actor(a.user),2);
    assert.equal(archived.archived,true);
    await assert.rejects(db.updateClientOnboarding(created.id,data,items,actor(a.user),3),e=>e.statusCode===409);
    assert.equal((await db.restoreClientOnboarding(created.id,actor(a.user),3)).version,4);
    await pool.query('UPDATE clients SET prime_id=$1 WHERE id=$2',[b.prime.id,client.id]);
    await assert.rejects(db.getClientOnboarding(created.id,actor(a.user)),e=>e.statusCode===404);
    assert.equal((await db.getClientOnboardingHistory(created.id,actor(b.user))).events[0].actor_email,a.user.email);
    const moved=await db.updateClientOnboarding(created.id,{...data,technicien_id:null},items,actor(b.user),4);
    assert.equal(moved.version,5);
    await pool.query('DELETE FROM tableaux_suivi WHERE client_id=$1',[client.id]);
    await assert.rejects(db.deleteClient(client.id),e=>e.statusCode===409);
    const tx=await pool.connect();
    try {
      await tx.query('BEGIN');
      await tx.query('DROP INDEX idx_prime_onboarding_items');
      await tx.query('CREATE INDEX idx_prime_onboarding_items ON client_onboarding_items(item_order)');
      await assert.rejects(checkPgMetierIdentity(tx),/index idx_prime_onboarding_items incompatible/);
      await tx.query('ROLLBACK');
    }finally{tx.release();}
    assert.equal((await db.getClientOnboarding(created.id,actor(admin,'admin'))).version,5);
    // Interleave a retarget between the initial onboarding lookup and old-client lock.
    const other=await db.createClient({nom:'Retarget',secteur:'TI',clientType:'ti',primeId:b.prime.id});
    for (const operation of ['detail','history']) {
      const source=await createOnboarding({...data,client_id:unknown.id},items,actor(a.user));
      let intercepted=false;
      const probe={kind:'pg',pool:{connect:async()=>{
        const conn=await pool.connect();
        return {query:async(sql,vals)=>{
          if (!intercepted && String(sql).startsWith('SELECT c.id,c.prime_id,c.data FROM clients c')) {
            intercepted=true;
            await pool.query('UPDATE client_onboardings SET client_id=$1 WHERE id=$2',[other.id,source.id]);
          }
          if (intercepted && /FROM client_onboarding_(items|history)/.test(String(sql))) throw new Error('private content queried after transfer');
          return conn.query(sql,vals);
        },release:()=>conn.release()};
      }}};
      const {detail,historyPage}=await import('./database/client-onboardings.js');
      await assert.rejects(operation==='detail'?detail(probe,source.id,actor(a.user)):historyPage(probe,source.id,actor(a.user)),e=>e.statusCode===404);
      assert(intercepted);
      await pool.query('DELETE FROM client_onboardings WHERE id=$1',[source.id]);
    }
    const pages=[];let before;
    do {const page=await db.getClientOnboardingHistory(created.id,actor(b.user),{limit:'2',...(before?{before:String(before)}:{})});pages.push(...page.events);before=page.nextBefore;} while(before);
    assert.equal(pages.length,5);
    assert.equal(new Set(pages.map(h=>h.id)).size,5);
    assert.equal(pages.at(-1).snapshot.items[0].notes,'preuve');
    assert.equal(pages.at(-2).snapshot.items[0].notes,'second');
    assert.equal(pages[0].snapshot.items[0].notes,'preuve');
    const largeId=(await createOnboarding({...data,client_id:unknown.id},items,actor(a.user))).id;
    const twoMB={onboarding:{id:largeId,client_id:unknown.id,compte_rendu:{resume_executif:'x'.repeat(2*1024*1024)}},items:[],items_count:0};
    for(let i=0;i<3;i++) await pool.query('INSERT INTO client_onboarding_history (onboarding_id,event_type,snapshot) VALUES ($1,$2,$3)',[largeId,'large',twoMB]);
    const firstLarge=await db.getClientOnboardingHistory(largeId,actor(a.user),{limit:'100'});
    assert.equal(firstLarge.events.length,1);
    assert.equal(firstLarge.events[0].snapshot.onboarding.compte_rendu.resume_executif.length,2*1024*1024);
    assert(firstLarge.nextBefore);
    const secondLarge=await db.getClientOnboardingHistory(largeId,actor(a.user),{before:String(firstLarge.nextBefore),limit:'100'});
    assert.equal(secondLarge.events[0].id,firstLarge.nextBefore-1);
    assert(Buffer.byteLength(JSON.stringify(firstLarge))<=4*1024*1024);
    await pool.query('INSERT INTO client_onboarding_history (onboarding_id,event_type,snapshot) VALUES ($1,$2,$3)',[largeId,'oversized',{onboarding:{id:largeId,client_id:unknown.id,compte_rendu:{resume_executif:'z'.repeat(4*1024*1024)}},items:[],items_count:0}]);
    await assert.rejects(db.getClientOnboardingHistory(largeId,actor(a.user)),e=>e.statusCode===413);
    const redacted=await pool.query('INSERT INTO client_onboarding_history (onboarding_id,event_type,snapshot) VALUES ($1,$2,$3) RETURNING id',[largeId,'redacted',{onboarding:{id:largeId,client_id:unknown.id},items:[],items_count:0,private_blob:'s'.repeat(4*1024*1024)}]);
    const redactedPage=await db.getClientOnboardingHistory(largeId,actor(a.user),{limit:'1'});
    assert.equal(redactedPage.events[0].id,redacted.rows[0].id);
    assert.deepEqual(Object.keys(redactedPage.events[0].snapshot).sort(),['items','items_count','onboarding']);
    assert(redactedPage.nextBefore);
    await pool.query('DELETE FROM client_onboardings WHERE id=$1',[largeId]);
    const beforeNull=(await pool.query('SELECT data,compte_rendu FROM client_onboardings WHERE id=$1',[created.id])).rows[0];
    await pool.query('ALTER TABLE client_onboardings ALTER COLUMN compte_rendu DROP NOT NULL');
    await pool.query('UPDATE client_onboardings SET compte_rendu=NULL WHERE id=$1',[created.id]);
    try {
      await assert.rejects(migratePgMetier(pool,async()=>{}),/client_onboardings.compte_rendu doit être un objet JSON/);
      assert.equal((await pool.query('SELECT compte_rendu FROM client_onboardings WHERE id=$1',[created.id])).rows[0].compte_rendu,null);
      assert.deepEqual((await pool.query('SELECT data FROM client_onboardings WHERE id=$1',[created.id])).rows[0].data,beforeNull.data);
    } finally {
      await pool.query('UPDATE client_onboardings SET compte_rendu=$1 WHERE id=$2',[beforeNull.compte_rendu,created.id]);
      await pool.query('ALTER TABLE client_onboardings ALTER COLUMN compte_rendu SET NOT NULL');
    }
    await assert.rejects(db.getClientOnboardingHistory(created.id,actor(a.user)),e=>e.statusCode===404);
    const imported=await db.updatePrimePortfolio(a.prime.id,{nom:a.prime.nom},{add:[{id:98981,nom:'TI imported',alias:''}],remove:[]});
    assert.equal(imported.clients.find(c=>c.servoClientId===98981).clientType,null);
    const detached=await db.createClient({nom:'Classified Servo',clientType:'ti',servoClientId:98982});
    const assigned=await db.updatePrimePortfolio(a.prime.id,{nom:a.prime.nom},{add:[{id:98982,nom:'Classified Servo',alias:''}],remove:[]});
    assert.equal(assigned.clients.find(c=>c.id===detached.id).clientType,'ti');
  });
  await test('PG missing or foreign provenance is excluded in SQL before the 50-row page',async()=>{
    const owned=await db.createClient({nom:'PG provenance',clientType:'ti',primeId:b.prime.id});
    const valid=[];
    for(let i=0;i<51;i++) valid.push(await createOnboarding({...data,client_id:owned.id,technicien_id:b.user.id,titre:`Safe ${i}`},items,actor(b.user)));
    const bad=[];
    for(const snapshot of [{onboarding:{client_id:client.id}},{onboarding:{client_id:'unknown'}},{onboarding:{client_id:null}}]) {
      const dossier=await createOnboarding({...data,client_id:owned.id,technicien_id:b.user.id,titre:'A retained'},items,actor(b.user));
      await pool.query('INSERT INTO client_onboarding_history(onboarding_id,event_type,snapshot) VALUES ($1,$2,$3)',[dossier.id,'legacy',snapshot]);
      bad.push(dossier);
    }
    const missing=await createOnboarding({...data,client_id:owned.id,technicien_id:b.user.id},items,actor(b.user));
    await pool.query('DELETE FROM client_onboarding_history WHERE onboarding_id=$1',[missing.id]);
    bad.push(missing);
    const page=await db.listClientOnboardings(actor(admin,'admin'),{clientId:String(owned.id)});
    assert.deepEqual(page.map(r=>r.id),valid.slice(-50).reverse().map(r=>r.id));
    assert.deepEqual((await db.listClientOnboardings(actor(b.user),{clientId:String(owned.id),before:String(page.at(-1).id)})).map(r=>r.id),[valid[0].id]);
    for(const dossier of bad) {
      for(const viewer of [actor(b.user),actor(admin,'admin')]) {
        await assert.rejects(db.getClientOnboarding(dossier.id,viewer),e=>e.statusCode===404);
        await assert.rejects(db.getClientOnboardingHistory(dossier.id,viewer),e=>e.statusCode===404);
        await assert.rejects(db.archiveClientOnboarding(dossier.id,viewer,1),e=>e.statusCode===404);
      }
    }
    await pool.query('DELETE FROM client_onboardings WHERE client_id=$1',[owned.id]);
    await pool.query('DELETE FROM clients WHERE id=$1',[owned.id]);
  });
  await test('PG copied Prime history with spoofed client quarantines every path without writes',async()=>{
    const own=await db.createClient({nom:'PG target',clientType:'ti',primeId:b.prime.id});
    const foreign=await db.createClient({nom:'PG foreign',clientType:'ti',primeId:a.prime.id});
    const B=actor(b.user), ADMIN=actor(admin,'admin');
    const source=await createOnboarding({...data,client_id:foreign.id,titre:'Foreign title',compte_rendu:{resume_executif:'Foreign report'}},[{...items[0],notes:'Foreign item'}],actor(a.user));
    const safe=await createOnboarding({...data,client_id:own.id,technicien_id:b.user.id},items,B);
    const bad=[];
    for(const fault of ['created-id','later-id','item-owner','item-id','missing-id','nonarray']) {
      const target=await createOnboarding({...data,client_id:own.id,technicien_id:b.user.id},items,B);
      const copied=structuredClone((await pool.query('SELECT snapshot FROM client_onboarding_history WHERE onboarding_id=$1',[source.id])).rows[0].snapshot);
      copied.onboarding.client_id=own.id;
      if(fault==='created-id') await pool.query('UPDATE client_onboarding_history SET snapshot=$1 WHERE onboarding_id=$2',[copied,target.id]);
      else {
        const original=(await pool.query('SELECT snapshot FROM client_onboarding_history WHERE onboarding_id=$1',[target.id])).rows[0].snapshot;
        if(fault==='later-id') copied.items=original.items.map(i=>({...i,notes:'Foreign item'}));
        if(fault==='item-owner') {copied.onboarding.id=target.id;copied.items[0].onboarding_id=source.id;}
        if(fault==='item-id') {copied.onboarding.id=target.id;copied.items[0].onboarding_id=target.id;}
        if(fault==='missing-id') {copied.onboarding.id=target.id;delete copied.items[0].onboarding_id;}
        if(fault==='nonarray') {copied.onboarding.id=target.id;copied.items={0:copied.items[0]};}
        await pool.query('INSERT INTO client_onboarding_history(onboarding_id,event_type,snapshot) VALUES ($1,$2,$3)',[target.id,'legacy',copied]);
      }
      bad.push(target);
    }
    const rows=async()=>({records:(await pool.query('SELECT * FROM client_onboardings WHERE id=ANY($1::int[]) ORDER BY id',[bad.map(r=>r.id)])).rows,
      items:(await pool.query('SELECT * FROM client_onboarding_items WHERE onboarding_id=ANY($1::int[]) ORDER BY id',[bad.map(r=>r.id)])).rows,
      history:(await pool.query('SELECT * FROM client_onboarding_history WHERE onboarding_id=ANY($1::int[]) ORDER BY id',[bad.map(r=>r.id)])).rows});
    const persisted=await rows();
    for(const viewer of [B,ADMIN]) {
      assert.deepEqual((await db.listClientOnboardings(viewer,{clientId:String(own.id),limit:'1'})).map(r=>r.id),[safe.id]);
      for(const target of bad) for(const call of [
        ()=>db.getClientOnboarding(target.id,viewer),()=>db.getClientOnboardingHistory(target.id,viewer),
        ()=>db.reconcileClientOnboarding(persisted.records.find(r=>r.id===target.id).request_key,viewer),
        ()=>db.updateClientOnboarding(target.id,{...data,client_id:own.id,technicien_id:b.user.id},items,viewer,1),
        ()=>db.archiveClientOnboarding(target.id,viewer,1),()=>db.restoreClientOnboarding(target.id,viewer,1)
      ]) await assert.rejects(call(),e=>e.statusCode===404);
    }
    assert.deepEqual(await rows(),persisted);
    assert.equal((await db.getClientOnboardingHistory(safe.id,B)).events[0].snapshot.items[0].onboarding_id,safe.id);
    await pool.query('DELETE FROM client_onboardings WHERE id=ANY($1::int[])',[[source.id,safe.id,...bad.map(r=>r.id)]]);
    await pool.query('DELETE FROM clients WHERE id=ANY($1::int[])',[[own.id,foreign.id]]);
  });
  await test('PG legacy cross-client dossier is inaccessible without altering persisted audit',async()=>{
    const old=await db.createClient({nom:'Private A',clientType:'ti',primeId:a.prime.id});
    const next=await db.createClient({nom:'Private B',clientType:'ti',primeId:b.prime.id});
    const secret='PG A-only note';
    const saved=await createOnboarding({...data,client_id:old.id,titre:'PG A-only title'},[{...items[0],notes:secret}],actor(a.user));
    // Preserve A's title, report, checklist and technician in the current B row.
    await pool.query('UPDATE client_onboardings SET client_id=$1,titre=$2,compte_rendu=$3,version=version+1 WHERE id=$4',[next.id,'PG A retained title',{resume_executif:'PG A retained report'},saved.id]);
    await pool.query('INSERT INTO client_onboarding_history(onboarding_id,event_type,actor_id,actor_email,snapshot) VALUES ($1,$2,$3,$4,$5)',
      [saved.id,'legacy-transfer',admin.id,admin.email,{onboarding:{client_id:next.id,titre:'PG B title'},items:[{notes:'PG B note'}]}]);
    await pool.query('INSERT INTO client_onboarding_history(onboarding_id,event_type,actor_id,actor_email,snapshot) VALUES ($1,$2,$3,$4,$5)',[saved.id,'legacy',a.user.id,a.user.email,{onboarding:{titre:'legacy private'},items:[{notes:secret}]}]);
    const stored=(await pool.query('SELECT id,snapshot,actor_id,actor_email FROM client_onboarding_history WHERE onboarding_id=$1 ORDER BY id',[saved.id])).rows;
    const current=(await pool.query('SELECT * FROM client_onboardings WHERE id=$1',[saved.id])).rows[0];
    for(const viewer of [actor(b.user),actor(admin,'admin')]) {
      assert.deepEqual(await db.listClientOnboardings(viewer,{clientId:String(next.id)}),[]);
      for(const call of [
        ()=>db.getClientOnboarding(saved.id,viewer),
        ()=>db.getClientOnboardingHistory(saved.id,viewer),
        ()=>db.reconcileClientOnboarding(current.request_key,viewer),
        ()=>db.updateClientOnboarding(saved.id,{...data,client_id:next.id,technicien_id:null},items,viewer,2),
        ()=>db.archiveClientOnboarding(saved.id,viewer,2),
        ()=>db.restoreClientOnboarding(saved.id,viewer,2)
      ]) await assert.rejects(call(),e=>e.statusCode===404);
    }
    assert.deepEqual((await pool.query('SELECT * FROM client_onboardings WHERE id=$1',[saved.id])).rows[0],current);
    assert.deepEqual((await pool.query('SELECT id,snapshot,actor_id,actor_email FROM client_onboarding_history WHERE onboarding_id=$1 ORDER BY id',[saved.id])).rows,stored);
    assert.equal(stored[0].snapshot.items[0].notes,secret);
    assert.equal(current.technicien_id,a.user.id);
    assert.equal(current.titre,'PG A retained title');
    assert.equal(current.compte_rendu.resume_executif,'PG A retained report');
    await pool.query('DELETE FROM client_onboardings WHERE id=$1',[saved.id]);
    await pool.query('DELETE FROM tableaux_suivi WHERE client_id=ANY($1::int[])',[[old.id,next.id]]);
    await pool.query('DELETE FROM clients WHERE id=ANY($1::int[])',[[old.id,next.id]]);
  });
  await test('real HTTP auth and scoped routes',async()=>{
    const users=[admin,a.user,b.user];
    for(const u of users) await pool.query("INSERT INTO user_mfa (user_id,secret_encrypted,mfa_enabled,pending_setup) VALUES ($1,'isolated-enrollment',true,false)",[u.id]);
    const token=await auth.issueSessionToken(a.user,await db.getMfaByUserId(a.user.id));
    const tokenB=await auth.issueSessionToken(b.user,await db.getMfaByUserId(b.user.id));
    const tokenAdmin=await auth.issueSessionToken(admin,await db.getMfaByUserId(admin.id));
    const child=spawn(process.execPath,['server/index.js'],{cwd:process.cwd(),env:{...process.env,PORT:'41771'},stdio:['ignore','pipe','pipe']});
    let log='';child.stdout.on('data',d=>{log+=d.toString();});child.stderr.on('data',d=>{log+=d.toString();});
    const base='http://127.0.0.1:41771';
    const request=(path,authToken,method='GET',body)=>fetch(base+path,{method,headers:{...(authToken?{Authorization:`Bearer ${authToken}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(path==='/api/client-onboardings'&&method==='POST'?{requestKey:randomUUID(),...body}:body)}:{})});
    try {
      let up=false;
      for(let i=0;i<100;i++) {if(child.exitCode!==null) break;try {const r=await request('/api/health');if(r.ok){up=true;break;}}catch{} await new Promise(resolve=>setTimeout(resolve,50));}
      assert(up,`server failed: ${log}`);
      assert.equal((await request('/api/client-onboardings')).status,401);
      const importedResponse=await request('/api/clients',tokenAdmin,'POST',{nom:'Imported TI',secteur:'TI',primeId:a.prime.id});
      assert.equal(importedResponse.status,201);const imported=(await importedResponse.json()).client;
      assert.equal(imported.clientType,null);
      assert.equal((await request('/api/client-onboardings',token,'POST',{onboarding:{...data,client_id:imported.id},items})).status,404);
      const classifiedResponse=await request(`/api/clients/${imported.id}`,tokenAdmin,'PUT',{client:{nom:imported.nom,clientType:'ti',primeId:a.prime.id},expected:{primeId:a.prime.id,servoClientId:null}});
      assert.equal(classifiedResponse.status,200);assert.equal((await classifiedResponse.json()).client.clientType,'ti');
      const key=randomUUID();
      const payload={onboarding:{...data,client_id:imported.id},items,requestKey:key};
      const raced=await Promise.all(Array.from({length:3},()=>request('/api/client-onboardings',token,'POST',payload)));
      assert.equal(raced.filter(r=>r.status===201).length,1);
      assert.equal(raced.filter(r=>r.status===409).length,2);
      const ids=await Promise.all(raced.filter(r=>r.status===201).map(r=>r.json()));
      assert.equal((await pool.query('SELECT COUNT(*)::int n FROM client_onboardings WHERE request_key=$1',[key])).rows[0].n,1);
      assert.deepEqual(await (await request('/api/client-onboardings/reconcile?requestKey='+key,token)).json(),{found:true,id:ids[0].id,archived:false});
      assert.equal((await request('/api/client-onboardings/reconcile?requestKey='+key,tokenB)).status,404);
      assert.equal((await request('/api/client-onboardings/reconcile?requestKey=bad',token)).status,400);
      assert.equal((await request('/api/client-onboardings/reconcile?requestKey='+key)).status,401);
      assert.equal((await request('/api/client-onboardings',token,'POST',{onboarding:data,items,requestKey:null})).status,400);
      for(const item_order of [null,false,1.5,'1']) {
        assert.equal((await request('/api/client-onboardings',token,'POST',{onboarding:data,items:[{...items[0],item_order}]})).status,400);
      }
      await db.archiveClientOnboarding(ids[0].id,actor(a.user),1);
      assert.deepEqual(await (await request('/api/client-onboardings/reconcile?requestKey='+key,token)).json(),{found:true,id:ids[0].id,archived:true});
      assert.equal((await request('/api/clients',tokenAdmin,'POST',{nom:'Invalid',clientType:'bad'})).status,400);
      const opts=await request('/api/client-onboardings/options',token);
      assert.equal(opts.status,200);const optsData=await opts.json();assert.deepEqual(Object.keys(optsData),['clients','techniciens']);assert(optsData.clients.some(c=>c.id===imported.id));
      const importedCreated=await request('/api/client-onboardings',token,'POST',{onboarding:{...data,client_id:imported.id},items});
      assert.equal(importedCreated.status,201);const importedId=(await importedCreated.json()).id;
      const rejectedTransfer=await request(`/api/client-onboardings/${importedId}`,tokenAdmin,'PUT',
        {onboarding:{...data,client_id:client.id,titre:'Wrong client'},items:[{...items[0],notes:'Foreign note'}],expectedVersion:1});
      assert.equal(rejectedTransfer.status,409);
      const original=await (await request(`/api/client-onboardings/${importedId}`,token)).json();
      assert.equal(original.client_id,imported.id);assert.equal(original.version,1);
      assert.equal(original.items[0].notes,'preuve');
      assert.equal((await (await request(`/api/client-onboardings/${importedId}/history`,token)).json()).events.length,1);
      const doneResponse=await request('/api/client-onboardings',token,'POST',{onboarding:{...data,client_id:imported.id,statut:'Fait'},items});
      assert.equal(doneResponse.status,201);
      const doneId=(await doneResponse.json()).id;
      for(const changed of [
        {...data,client_id:imported.id,statut:'À faire'},
        {...data,client_id:imported.id,titre:'Changed'},
        {...data,client_id:client.id},
        {...data,client_id:imported.id,compte_rendu:{resume_executif:'Changed'}}
      ]) assert.equal((await request(`/api/client-onboardings/${doneId}`,tokenAdmin,'PUT',{onboarding:changed,items,expectedVersion:1})).status,409);
      assert.equal((await request(`/api/client-onboardings/${doneId}`,token,'PUT',{onboarding:data,items:[{...items[0],notes:'Changed'}],expectedVersion:1})).status,409);
      assert.equal((await request(`/api/client-onboardings/${doneId}` ,token)).status,200);
      assert.equal((await request(`/api/client-onboardings/${doneId}/history`,token)).status,200);
      assert.equal((await request(`/api/client-onboardings/${doneId}`,tokenAdmin,'DELETE',{expectedVersion:1})).status,200);
      assert.equal((await request(`/api/client-onboardings/${doneId}/restore`,tokenAdmin,'POST',{expectedVersion:2})).status,200);
      assert.equal((await request(`/api/client-onboardings/${doneId}`,tokenAdmin,'PUT',{onboarding:data,items,expectedVersion:3})).status,409);
      await pool.query('DELETE FROM client_onboardings WHERE id=$1',[doneId]);
      assert.equal((await request(`/api/clients/${imported.id}`,tokenAdmin,'PUT',{client:{nom:imported.nom,clientType:'telecom',primeId:a.prime.id},expected:{primeId:a.prime.id,servoClientId:null}})).status,409);
      const history=await request(`/api/client-onboardings/${importedId}/history?limit=1`,token);
      assert.equal(history.status,200);assert.equal((await history.json()).events[0].snapshot.items[0].notes,'preuve');
      assert.equal((await request(`/api/client-onboardings/${importedId}/history`,tokenB)).status,404);
      const list=await request('/api/client-onboardings',token);
      assert.equal(list.status,200);assert.equal((await list.json()).length,1);
      const own=await request('/api/client-onboardings',tokenB);
      assert.equal((await own.json()).length,1);
      const invalid=await request('/api/client-onboardings',token,'POST',{onboarding:{...data,client_id:tele.id},items});
      assert.equal(invalid.status,404);
      const created=await request('/api/client-onboardings',tokenB,'POST',{onboarding:{...data,technicien_id:b.user.id},items});
      assert.equal(created.status,201);const posted=await created.json();
      assert.equal((await request(`/api/client-onboardings/${posted.id}`,token)).status,404);
      assert.equal((await request(`/api/client-onboardings/${posted.id}`,tokenB)).status,200);
      assert.equal((await request(`/api/client-onboardings/${posted.id}`,tokenB,'PUT',{onboarding:{...data,technicien_id:b.user.id},items})).status,400);
      assert.equal((await request(`/api/client-onboardings/${posted.id}`,tokenB,'DELETE',{expectedVersion:1})).status,200);
      assert.equal((await request(`/api/client-onboardings/${posted.id}/restore`,tokenB,'POST',{expectedVersion:2})).status,200);
      await pool.query('UPDATE clients SET prime_id=$1 WHERE id=$2',[b.prime.id,imported.id]);
      assert.equal((await request('/api/client-onboardings/reconcile?requestKey='+key,token)).status,404);
      assert.equal((await request('/api/client-onboardings/reconcile?requestKey='+key,tokenB)).status,404);
    }finally {child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}
  });
  await test('PG legacy onboarding migration preserves rows and history; rejects malformed key schema',async()=>{
    const owned=await db.createClient({nom:'Migration PG',clientType:'ti',primeId:a.prime.id});
    const saved=await createOnboarding({...data,client_id:owned.id},items,actor(a.user));
    await pool.query('ALTER TABLE client_onboardings DROP CONSTRAINT client_onboardings_request_key_key, DROP COLUMN request_key');
    await checkPgMetierIdentity(pool);
    await migratePgMetier(pool,async()=>{});
    const restored=await pool.query('SELECT request_key FROM client_onboardings WHERE id=$1',[saved.id]);
    assert.match(restored.rows[0].request_key,/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
    assert.equal((await db.getClientOnboardingHistory(saved.id,actor(a.user))).events.length,1);
    await migratePgMetier(pool,async()=>{});
    assert.equal((await pool.query('SELECT request_key FROM client_onboardings WHERE id=$1',[saved.id])).rows[0].request_key,restored.rows[0].request_key);
    const tx=await pool.connect();
    try {
      await tx.query('BEGIN');
      await tx.query('ALTER TABLE client_onboardings ALTER COLUMN request_key DROP NOT NULL');
      await assert.rejects(checkPgMetierIdentity(tx),/request_key non unique ou nullable/);
      await tx.query('ROLLBACK');
      await tx.query('BEGIN');
      await tx.query('ALTER TABLE client_onboardings DROP CONSTRAINT client_onboardings_request_key_key');
      await tx.query('ALTER TABLE client_onboardings ADD CONSTRAINT client_onboardings_request_key_client_key UNIQUE(request_key,client_id)');
      await assert.rejects(checkPgMetierIdentity(tx),/request_key non unique ou nullable/);
      await tx.query('ROLLBACK');
    } finally {tx.release();}
  });
}finally{await pool.end();}
