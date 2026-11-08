import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {CLIENT_ONBOARDING_TEMPLATE,createTemplateItems} from '../src/services/clientOnboardingService.ts';

// Explicit allowlist only. Never run without an isolated network namespace.
assert.equal(process.env.APP_PRIME_ISOLATED_TEST,'1','Explicit isolated fixture required');
assert.match(fs.readlinkSync('/proc/self/ns/net'),/^net:\[\d+\]$/);
assert.equal(process.env.DATABASE_URL,undefined,'SQLite fixture only');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prime-onboardings-'));
process.env.SQLITE_PATH=path.join(dir,'fixture.sqlite');
process.env.APP_PRIME_ALLOW_NEW_DATABASE='1';
process.env.NODE_ENV='test';
const db=await import('./database/index.js');
const driver=await db.initDb();
const admin=await db.createUser({email:'admin@example.test',passwordHash:'test',prenom:'A',nom:'Admin',role:'admin'});
const a=await db.createUserWithPrime({email:'a@example.test',passwordHash:'test',prenom:'A',nom:'Prime'});
const b=await db.createUserWithPrime({email:'b@example.test',passwordHash:'test',prenom:'B',nom:'Prime'});
const client=await db.createClient({nom:'Test',secteur:'Télécommunications',clientType:'ti',primeId:a.prime.id});
const telecom=await db.createClient({nom:'Tel',secteur:'Services',clientType:'telecom',primeId:a.prime.id});
const actor=(u,role='prime')=>({sub:u.id,email:u.email,role});
const A=actor(a.user), B=actor(b.user), ADMIN=actor(admin,'admin');
const data={client_id:client.id,technicien_id:a.user.id,titre:'Prise en charge',statut:'À faire',priorite:'Moyenne',compte_rendu:{resume_executif:'Bilan'}};
const items=[{section_key:'general',section_title:'Général',item_order:1000,checked:false,element:'Audit',echeance:'2026-12-12',priorite:'Haute',statut:'En cours',notes:'Note',action:'Action',responsable:'A'}];
const createOnboarding=(onboarding, checklist, user)=>db.createClientOnboarding(onboarding,checklist,user,randomUUID());
try {
  await test('SQLite public list and export detail use relational truth, never arbitrary data',async()=>{
    const saved=await createOnboarding({...data,urgence_ti:'Critique héritée'},items,A);
    const poison=JSON.stringify({client_id:999,statut:'Fait',items:[{notes:'private'}],tech_email:'private@example.test',created_by_email:'private@example.test',urgence_ti:'Poison'});
    driver.sqlite.prepare('UPDATE client_onboardings SET data=? WHERE id=?').run(poison,saved.id);
    const expected=['id','client_id','technicien_id','titre','statut','priorite','urgence_ti','site_principal','contact_principal','periode_couverte','prepare_pour','avancement_global','risques_critiques','actions_ouvertes','decisions_requises','prochaine_rencontre','compte_rendu','version','archived','archived_at','created_at','updated_at','client_nom','technicien_nom','technicien_email','total_items','completed_items','high_priority_open_items'];
    const summary=(await db.listClientOnboardings(A,{clientId:String(client.id)})).find(r=>r.id===saved.id);
    const detail=await db.getClientOnboarding(saved.id,A); // same response consumed by PDF/Excel export
    for(const result of [summary,detail]) {
      assert.deepEqual(Object.keys(result).sort(),[...expected,...(result===detail?['items']:[])].sort());
      assert.equal(result.client_id,client.id);
      assert.equal(result.statut,'À faire');
      assert.equal(result.urgence_ti,'Critique héritée');
      assert.equal(result.technicien_email,A.email);
    }
    assert.equal(detail.items[0].notes,'Note');
    assert.equal(driver.sqlite.prepare('SELECT data FROM client_onboardings WHERE id=?').get(saved.id).data,poison);
    driver.sqlite.prepare('DELETE FROM client_onboardings WHERE id=?').run(saved.id);
  });
  await test('SQLite nested projection drops valid-client secrets and preserves audit',async()=>{
    const created=await createOnboarding(data,items,A);
    const secret='sqlite-private-nested-marker';
    const report={resume_executif:'Bilan',points_valides:'Conservé',vault_token:secret};
    driver.sqlite.prepare('UPDATE client_onboardings SET compte_rendu=? WHERE id=?').run(JSON.stringify(report),created.id);
    driver.sqlite.exec('ALTER TABLE client_onboarding_items ADD COLUMN private_key TEXT');
    driver.sqlite.prepare('UPDATE client_onboarding_items SET private_key=? WHERE onboarding_id=?').run(secret,created.id);
    const historyRow=driver.sqlite.prepare('SELECT id,snapshot FROM client_onboarding_history WHERE onboarding_id=?').get(created.id);
    const historical=JSON.parse(historyRow.snapshot);
    historical.root_secret=secret;
    historical.different_client={client_id:telecom.id,notes:secret};
    historical.onboarding.compte_rendu=report;
    historical.onboarding.created_by_email=secret;
    historical.onboarding.unlisted=secret;
    historical.items[0].private_key=secret;
    historical.items[0].notes='Historical approved';
    driver.sqlite.prepare('UPDATE client_onboarding_history SET snapshot=? WHERE id=?').run(JSON.stringify(historical),historyRow.id);
    const check=result=>{assert.equal(result.compte_rendu.resume_executif,'Bilan');assert.equal(result.compte_rendu.points_valides,'Conservé');assert.deepEqual(Object.keys(result.compte_rendu).sort(),['points_valides','resume_executif']);assert(!JSON.stringify(result).includes(secret));};
    for(const result of [await db.getClientOnboarding(created.id,A),(await db.listClientOnboardings(A,{clientId:String(client.id)})).find(r=>r.id===created.id)]) check(result);
    const event=(await db.getClientOnboardingHistory(created.id,A)).events[0];
    assert.equal(event.snapshot.items[0].notes,'Historical approved');
    assert.equal(event.snapshot.items_count,1);
    assert.deepEqual(Object.keys(event.snapshot).sort(),['items','items_count','onboarding']);
    assert(!JSON.stringify(event.snapshot).includes(secret));
    assert.equal(driver.sqlite.prepare('SELECT snapshot FROM client_onboarding_history WHERE id=?').get(historyRow.id).snapshot,JSON.stringify(historical));
    assert.equal(driver.sqlite.prepare('SELECT compte_rendu FROM client_onboardings WHERE id=?').get(created.id).compte_rendu,JSON.stringify(report));
    const updated=await db.updateClientOnboarding(created.id,data,undefined,A,1);
    assert(!JSON.stringify(updated).includes(secret));
    assert(!JSON.stringify((await db.getClientOnboardingHistory(created.id,A)).events).includes(secret));
    driver.sqlite.prepare('DELETE FROM client_onboardings WHERE id=?').run(created.id);
    driver.sqlite.exec('ALTER TABLE client_onboarding_items DROP COLUMN private_key');
  });
  await test('SQLite malformed stored report and historical checklist fail visibly',async()=>{
    const saved=await createOnboarding(data,items,A);
    const original=driver.sqlite.prepare('SELECT id,snapshot FROM client_onboarding_history WHERE onboarding_id=?').get(saved.id);
    driver.sqlite.prepare('UPDATE client_onboardings SET compte_rendu=? WHERE id=?').run('null',saved.id);
    await assert.rejects(db.getClientOnboarding(saved.id,A),e=>e.statusCode===500);
    await assert.rejects(db.listClientOnboardings(A,{clientId:String(client.id)}),e=>e.statusCode===500);
    driver.sqlite.prepare('UPDATE client_onboardings SET compte_rendu=? WHERE id=?').run('{}',saved.id);
    const broken=JSON.parse(original.snapshot);delete broken.items;
    driver.sqlite.prepare('UPDATE client_onboarding_history SET snapshot=? WHERE id=?').run(JSON.stringify(broken),original.id);
    await assert.rejects(db.getClientOnboardingHistory(saved.id,A),e=>e.statusCode===404);
    assert.equal(driver.sqlite.prepare('SELECT snapshot FROM client_onboarding_history WHERE id=?').get(original.id).snapshot,JSON.stringify(broken));
    driver.sqlite.prepare('DELETE FROM client_onboardings WHERE id=?').run(saved.id);
  });
  await test('canonical 123-item checklist keeps 11-section order through save, reopen and history',async()=>{
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
    const created=await createOnboarding(data,template,A);
    check(created);
    check(await db.getClientOnboarding(created.id,A));
    const changed=template.map((item,i)=>i===0?{...item,checked:true,notes:'Persisted'}:item);
    const updated=await db.updateClientOnboarding(created.id,{...data,titre:'Saved again'},changed,A,1);
    check(updated);
    check(await db.getClientOnboarding(created.id,A));
    const history=(await db.getClientOnboardingHistory(created.id,A)).events;
    assert.equal(history.length,2);
    for(const event of history) check(event.snapshot);
    assert.equal(history[0].snapshot.items[0].notes,'Persisted');
    assert.equal(history[1].snapshot.items[0].checked,false);
    driver.sqlite.prepare('DELETE FROM client_onboardings WHERE id=?').run(created.id);
  });
  await test('saved Fait is permanently immutable, including stale PUTs and archive/restore',async()=>{
    const saved=await createOnboarding(data,items,A);
    // A completed checklist alone does not close a dossier.
    const checked=await db.updateClientOnboarding(saved.id,data,[{...items[0],checked:true}],A,1);
    assert.equal(checked.version,2);
    const completed=await db.updateClientOnboarding(saved.id,{...data,statut:'Fait'},checked.items,A,2);
    assert.equal(completed.version,3);
    const before=await db.getClientOnboarding(completed.id,A);
    for(const [change,checklist,user,version] of [
      [{...data,statut:'À faire'},items,A,3],
      [{...data,titre:'Changed'},items,ADMIN,3],
      [{...data,client_id:telecom.id},items,ADMIN,3],
      [{...data,compte_rendu:{resume_executif:'Changed'}},items,A,3],
      [{...data},[{...items[0],notes:'Changed'}],A,3],
      [{...data},items,A,2]
    ]) await assert.rejects(db.updateClientOnboarding(saved.id,change,checklist,user,version),e=>e.statusCode===409);
    const archived=await db.archiveClientOnboarding(saved.id,A,3);
    const restored=await db.restoreClientOnboarding(saved.id,A,archived.version);
    assert.equal(restored.statut,'Fait');
    await assert.rejects(db.updateClientOnboarding(saved.id,data,items,ADMIN,restored.version),e=>e.statusCode===409);
    assert.deepEqual((await db.getClientOnboarding(saved.id,A)).items,before.items);
    assert.equal((await db.getClientOnboarding(saved.id,A)).compte_rendu.resume_executif,'Bilan');
    assert.equal((await db.getClientOnboardingHistory(saved.id,A)).events.length,5);
    const direct=await createOnboarding({...data,statut:'Fait'},items,A);
    await assert.rejects(db.updateClientOnboarding(direct.id,data,items,ADMIN,1),e=>e.statusCode===409);
    assert.equal((await db.getClientOnboarding(direct.id,A)).statut,'Fait');
    driver.sqlite.prepare('DELETE FROM client_onboardings WHERE id IN (?,?)').run(saved.id,direct.id);
  });
  await test('persisted dossier cannot change client even unfinished; same client can change Prime owner',async()=>{
    const first=await db.createClient({nom:'Original privé',clientType:'ti',primeId:a.prime.id});
    const second=await db.createClient({nom:'Autre client',clientType:'ti',primeId:a.prime.id});
    const dossier=await createOnboarding({...data,client_id:first.id},[{...items[0],notes:'Secret du premier'}],A);
    const target={...data,client_id:second.id,titre:'Nouvel intitulé',compte_rendu:{resume_executif:'Secret transféré'}};
    await assert.rejects(db.updateClientOnboarding(dossier.id,target,[{...items[0],notes:'Secret du second'}],ADMIN,1),e=>e.statusCode===409);
    const unchanged=await db.getClientOnboarding(dossier.id,A);
    assert.equal(unchanged.client_id,first.id);assert.equal(unchanged.version,1);
    assert.equal(unchanged.items[0].notes,'Secret du premier');
    assert.equal((await db.getClientOnboardingHistory(dossier.id,A)).events.length,1);
    assert.equal((await db.listClientOnboardings(A,{clientId:String(second.id)})).length,0);
    const newDossier=await createOnboarding({...data,client_id:second.id},items,A);
    assert.equal(newDossier.client_id,second.id);
    driver.sqlite.prepare('UPDATE clients SET prime_id=? WHERE id=?').run(b.prime.id,first.id);
    await assert.rejects(db.getClientOnboarding(dossier.id,A),e=>e.statusCode===404);
    const edited=await db.updateClientOnboarding(dossier.id,{...data,client_id:first.id,technicien_id:b.user.id,titre:'Même client'},items,B,1);
    assert.equal(edited.client_id,first.id);assert.equal(edited.version,2);
    assert.equal((await db.getClientOnboardingHistory(dossier.id,B)).events.length,2);
    driver.sqlite.prepare('DELETE FROM client_onboardings WHERE id IN (?,?)').run(dossier.id,newDossier.id);
    driver.sqlite.prepare('DELETE FROM clients WHERE id IN (?,?)').run(first.id,second.id);
  });
  await test('request key is mandatory, unique and reconciles only current TI scope',async()=>{
    const key=randomUUID();
    await assert.rejects(db.createClientOnboarding(data,items,A),e=>e.statusCode===400);
    await assert.rejects(db.createClientOnboarding(data,items,A,'not-a-uuid'),e=>e.statusCode===400);
    assert.deepEqual(await db.reconcileClientOnboarding(randomUUID(),A),{found:false});
    const attempts=await Promise.allSettled([db.createClientOnboarding(data,items,A,key),db.createClientOnboarding(data,items,A,key)]);
    assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(attempts.filter(r=>r.status==='rejected' && r.reason.statusCode===409).length,1);
    const first=attempts.find(r=>r.status==='fulfilled').value;
    assert.equal(driver.sqlite.prepare('SELECT COUNT(*) n FROM client_onboardings WHERE request_key=?').get(key).n,1);
    assert.deepEqual(await db.reconcileClientOnboarding(key,A),{found:true,id:first.id,archived:false});
    await db.updateClientOnboarding(first.id,{...data,titre:'Renamed'},items,A,1);
    await db.archiveClientOnboarding(first.id,A,2);
    assert.deepEqual(await db.reconcileClientOnboarding(key,A),{found:true,id:first.id,archived:true});
    await assert.rejects(db.createClientOnboarding(data,items,A,key),e=>e.statusCode===409);
    await assert.rejects(db.createClientOnboarding({...data,titre:'Different'},items,A,key),e=>e.statusCode===409);
    await assert.rejects(db.createClientOnboarding(data,items,B,key),e=>e.statusCode===404);
    const foreign=await db.createClient({nom:'Foreign key fixture',clientType:'ti',primeId:b.prime.id});
    await assert.rejects(db.createClientOnboarding({...data,client_id:foreign.id,technicien_id:b.user.id},items,B,key),e=>e.statusCode===409);
    await assert.rejects(db.reconcileClientOnboarding(key,B),e=>e.statusCode===404);
    const other=await db.createClient({nom:'Telecom key',clientType:'telecom',primeId:a.prime.id});
    await assert.rejects(db.createClientOnboarding({...data,client_id:other.id},items,A,randomUUID()),e=>e.statusCode===404);
    assert.equal(driver.sqlite.prepare('PRAGMA table_info(client_onboardings)').all().find(c=>c.name==='request_key').notnull,1);
  });
  await test('item order rejects null, false and nonintegers',async()=>{
    for(const item_order of [null,false,1.5,'1']) {
      await assert.rejects(createOnboarding(data,[{...items[0],item_order}],A),e=>e.statusCode===400);
    }
  });
  await test('equal global orders use section key as deterministic tie-breaker',async()=>{
    const tied=[{...items[0],section_key:'z',item_order:8},{...items[0],section_key:'a',item_order:8},{...items[0],section_key:'m',item_order:3}];
    const saved=await createOnboarding(data,tied,A);
    const order=['m','a','z'];
    assert.deepEqual(saved.items.map(i=>i.section_key),order);
    assert.deepEqual((await db.getClientOnboarding(saved.id,A)).items.map(i=>i.section_key),order);
    assert.deepEqual((await db.getClientOnboardingHistory(saved.id,A)).events[0].snapshot.items.map(i=>i.section_key),order);
    driver.sqlite.prepare('DELETE FROM client_onboardings WHERE id=?').run(saved.id);
  });
  await test('legacy cross-client content is inaccessible to B and admin without changing audit',async()=>{
    const old=await db.createClient({nom:'Private A',clientType:'ti',primeId:a.prime.id});
    const next=await db.createClient({nom:'Private B',clientType:'ti',primeId:b.prime.id});
    const secret='A-only secret note';
    const saved=await createOnboarding({...data,client_id:old.id,titre:'A-only title'},[{...items[0],notes:secret}],A);
    // Legacy cross-client records may exist from before the immutability rule;
    // emulate one on the disposable fixture without using the public PUT path.
    driver.sqlite.prepare('UPDATE client_onboardings SET client_id=?,titre=?,compte_rendu=?,version=version+1 WHERE id=?').run(next.id,'A retained title',JSON.stringify({resume_executif:'A retained report'}),saved.id);
    // Retain the original A item and technician in the current B row.
    const beforeAudit=driver.sqlite.prepare('SELECT id,snapshot,actor_id,actor_email FROM client_onboarding_history WHERE onboarding_id=? ORDER BY id').all(saved.id);
    driver.sqlite.prepare('INSERT INTO client_onboarding_history (onboarding_id,event_type,actor_id,actor_email,snapshot) VALUES (?,?,?,?,?)')
      .run(saved.id,'legacy-transfer',admin.id,ADMIN.email,JSON.stringify({onboarding:{client_id:next.id,titre:'B title'},items:[{notes:'B note'}]}));
    const legacy=driver.sqlite.prepare('INSERT INTO client_onboarding_history (onboarding_id,event_type,actor_id,actor_email,snapshot) VALUES (?,?,?,?,?)').run(saved.id,'legacy',a.user.id,A.email,JSON.stringify({onboarding:{titre:'legacy secret'},items:[{notes:secret}]}));
    const persisted=driver.sqlite.prepare('SELECT * FROM client_onboardings WHERE id=?').get(saved.id);
    const audit=driver.sqlite.prepare('SELECT id,snapshot,actor_id,actor_email FROM client_onboarding_history WHERE onboarding_id=? ORDER BY id').all(saved.id);
    assert.deepEqual(audit.slice(0,1),beforeAudit);
    for(const viewer of [B,ADMIN]) {
      assert.deepEqual(await db.listClientOnboardings(viewer,{clientId:String(next.id)}),[]);
      for(const call of [
        ()=>db.getClientOnboarding(saved.id,viewer),
        ()=>db.getClientOnboardingHistory(saved.id,viewer),
        ()=>db.reconcileClientOnboarding(driver.sqlite.prepare('SELECT request_key FROM client_onboardings WHERE id=?').get(saved.id).request_key,viewer),
        ()=>db.updateClientOnboarding(saved.id,{...data,client_id:next.id,technicien_id:null},items,viewer,2),
        ()=>db.archiveClientOnboarding(saved.id,viewer,2),
        ()=>db.restoreClientOnboarding(saved.id,viewer,2)
      ]) await assert.rejects(call(),e=>e.statusCode===404);
    }
    assert.deepEqual(driver.sqlite.prepare('SELECT * FROM client_onboardings WHERE id=?').get(saved.id),persisted);
    assert.deepEqual(driver.sqlite.prepare('SELECT id,snapshot,actor_id,actor_email FROM client_onboarding_history WHERE onboarding_id=? ORDER BY id').all(saved.id),audit);
    assert.equal(JSON.parse(audit[0].snapshot).items[0].notes,secret);
    assert.equal(persisted.technicien_id,a.user.id);
    assert.equal(persisted.titre,'A retained title');
    assert.equal(JSON.parse(persisted.compte_rendu).resume_executif,'A retained report');
    assert.equal(Number(legacy.lastInsertRowid),audit.at(-1).id);
    driver.sqlite.prepare('DELETE FROM client_onboardings WHERE id=?').run(saved.id);
    driver.sqlite.prepare('DELETE FROM tableaux_suivi WHERE client_id IN (?,?)').run(old.id,next.id);
    driver.sqlite.prepare('DELETE FROM clients WHERE id IN (?,?)').run(old.id,next.id);
  });
  await test('unproven creation and malformed or foreign history fail closed before pagination',async()=>{
    const owned=await db.createClient({nom:'Provenance page',clientType:'ti',primeId:b.prime.id});
    const valid=[];
    for(let i=0;i<51;i++) valid.push(await createOnboarding({...data,client_id:owned.id,technicien_id:b.user.id,titre:`Safe ${i}`},items,B));
    const bad=[];
    for(const snapshot of ['not-json',JSON.stringify({onboarding:{client_id:client.id}}),JSON.stringify({onboarding:{client_id:'unknown'}})]) {
      const dossier=await createOnboarding({...data,client_id:owned.id,technicien_id:b.user.id,titre:'Private A report'},items,B);
      driver.sqlite.prepare('INSERT INTO client_onboarding_history(onboarding_id,event_type,snapshot) VALUES (?,?,?)').run(dossier.id,'legacy',snapshot);
      bad.push(dossier);
    }
    const withoutCreation=await createOnboarding({...data,client_id:owned.id,technicien_id:b.user.id},items,B);
    driver.sqlite.prepare('DELETE FROM client_onboarding_history WHERE onboarding_id=?').run(withoutCreation.id);
    bad.push(withoutCreation);
    const page=await db.listClientOnboardings(ADMIN,{clientId:String(owned.id)});
    assert.equal(page.length,50);
    assert.deepEqual(page.map(r=>r.id),valid.slice(-50).reverse().map(r=>r.id));
    assert.deepEqual((await db.listClientOnboardings(B,{clientId:String(owned.id),before:String(page.at(-1).id)})).map(r=>r.id),[valid[0].id]);
    for(const dossier of bad) {
      assert(!page.some(r=>r.id===dossier.id));
      for(const viewer of [B,ADMIN]) {
        await assert.rejects(db.getClientOnboarding(dossier.id,viewer),e=>e.statusCode===404);
        await assert.rejects(db.getClientOnboardingHistory(dossier.id,viewer),e=>e.statusCode===404);
        await assert.rejects(db.archiveClientOnboarding(dossier.id,viewer,1),e=>e.statusCode===404);
      }
    }
    driver.sqlite.prepare('DELETE FROM client_onboardings WHERE client_id=?').run(owned.id);
    driver.sqlite.prepare('DELETE FROM clients WHERE id=?').run(owned.id);
  });
  await test('SQLite copied Prime history with spoofed client quarantines every path without writes',async()=>{
    const own=await db.createClient({nom:'Dossier cible',clientType:'ti',primeId:b.prime.id});
    const foreign=await db.createClient({nom:'Dossier étranger',clientType:'ti',primeId:a.prime.id});
    const source=await createOnboarding({...data,client_id:foreign.id,titre:'Foreign title',compte_rendu:{resume_executif:'Foreign report'}},[{...items[0],notes:'Foreign item'}],A);
    const safe=await createOnboarding({...data,client_id:own.id,technicien_id:b.user.id},items,B);
    const bad=[];
    for(const fault of ['created-id','later-id','item-owner','item-id','missing-id','nonarray']) {
      const target=await createOnboarding({...data,client_id:own.id,technicien_id:b.user.id},items,B);
      const copied=JSON.parse(driver.sqlite.prepare('SELECT snapshot FROM client_onboarding_history WHERE onboarding_id=?').get(source.id).snapshot);
      copied.onboarding.client_id=own.id;
      if(fault==='created-id') {
        driver.sqlite.prepare('UPDATE client_onboarding_history SET snapshot=? WHERE onboarding_id=?').run(JSON.stringify(copied),target.id);
      } else {
        const original=JSON.parse(driver.sqlite.prepare('SELECT snapshot FROM client_onboarding_history WHERE onboarding_id=?').get(target.id).snapshot);
        if(fault==='later-id') copied.items=original.items.map(i=>({...i,notes:'Foreign item'}));
        if(fault==='item-owner') {copied.onboarding.id=target.id;copied.items[0].onboarding_id=source.id;}
        if(fault==='item-id') {copied.onboarding.id=target.id;copied.items[0].onboarding_id=target.id;}
        if(fault==='missing-id') {copied.onboarding.id=target.id;delete copied.items[0].onboarding_id;}
        if(fault==='nonarray') {copied.onboarding.id=target.id;copied.items={0:copied.items[0]};}
        driver.sqlite.prepare('INSERT INTO client_onboarding_history(onboarding_id,event_type,snapshot) VALUES (?,?,?)').run(target.id,'legacy',JSON.stringify(copied));
      }
      bad.push(target);
    }
    const rows=()=>bad.map(r=>({record:driver.sqlite.prepare('SELECT * FROM client_onboardings WHERE id=?').get(r.id),items:driver.sqlite.prepare('SELECT * FROM client_onboarding_items WHERE onboarding_id=?').all(r.id),history:driver.sqlite.prepare('SELECT * FROM client_onboarding_history WHERE onboarding_id=? ORDER BY id').all(r.id)}));
    const persisted=rows();
    for(const viewer of [B,ADMIN]) {
      assert.deepEqual((await db.listClientOnboardings(viewer,{clientId:String(own.id),limit:'1'})).map(r=>r.id),[safe.id]);
      for(const target of bad) for(const call of [
        ()=>db.getClientOnboarding(target.id,viewer),()=>db.getClientOnboardingHistory(target.id,viewer),
        ()=>db.reconcileClientOnboarding(driver.sqlite.prepare('SELECT request_key FROM client_onboardings WHERE id=?').get(target.id).request_key,viewer),
        ()=>db.updateClientOnboarding(target.id,{...data,client_id:own.id,technicien_id:b.user.id},items,viewer,1),
        ()=>db.archiveClientOnboarding(target.id,viewer,1),()=>db.restoreClientOnboarding(target.id,viewer,1)
      ]) await assert.rejects(call(),e=>e.statusCode===404);
    }
    assert.deepEqual(rows(),persisted);
    assert.equal((await db.getClientOnboardingHistory(safe.id,B)).events[0].snapshot.items[0].onboarding_id,safe.id);
    driver.sqlite.prepare('DELETE FROM client_onboardings WHERE id IN (?,?,?,?,?,?,?,?)').run(source.id,safe.id,...bad.map(r=>r.id));
    driver.sqlite.prepare('DELETE FROM clients WHERE id IN (?,?)').run(own.id,foreign.id);
  });
  await test('SQLite existing schema migration preserves clients and adds indexes',async()=>{
    driver.sqlite.exec('DROP TABLE client_onboarding_history; DROP TABLE client_onboarding_items; DROP TABLE client_onboardings');
    const {checkSqliteMetierIdentity}=await import('./database/metier-migration.js');
    const {createOnboardingSchemaSqlite}=await import('./database/client-onboardings.js');
    driver.sqlite.transaction(()=>{ checkSqliteMetierIdentity(driver.sqlite);createOnboardingSchemaSqlite(driver.sqlite); }).immediate();
    checkSqliteMetierIdentity(driver.sqlite);
    assert.equal(driver.sqlite.prepare('SELECT COUNT(*) n FROM clients').get().n,4);
    assert.equal(driver.sqlite.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='index' AND name LIKE 'idx_prime_onboarding_%'").get().n,5);
  });
  await test('create, options, permissions, versions, archive, restore, transfer, history',async()=>{
    const unknown=await db.createClient({nom:'Imported telecom',secteur:'TI',servoClientId:321234,primeId:a.prime.id});
    assert.equal(unknown.clientType,null);
    assert.deepEqual((await db.clientOnboardingOptions(A)).clients.map(c=>c.id),[client.id]);
    await assert.rejects(createOnboarding({...data,client_id:unknown.id},items,A),e=>e.statusCode===404);
    const classified=await db.updateClient(unknown.id,{nom:unknown.nom,secteur:unknown.secteur,primeId:a.prime.id,clientType:'ti'},{primeId:a.prime.id,servoClientId:321234});
    assert.equal(classified.clientType,'ti');
    assert.deepEqual((await db.clientOnboardingOptions(A)).clients.map(c=>c.id),[client.id,unknown.id]);
    await assert.rejects(db.updateClient(unknown.id,{nom:'Bad',clientType:'invalid',primeId:a.prime.id},{primeId:a.prime.id,servoClientId:321234}),e=>e.statusCode===400);
    assert.equal((await db.updateClient(unknown.id,{nom:'Retained',primeId:a.prime.id},{primeId:a.prime.id,servoClientId:321234})).clientType,'ti');
    const first=await createOnboarding({...data,client_id:unknown.id},items,A);
    await assert.rejects(db.updateClient(unknown.id,{nom:'Retained',clientType:null,primeId:a.prime.id},{primeId:a.prime.id,servoClientId:321234}),e=>e.statusCode===409);
    await assert.rejects(db.updateClient(unknown.id,{nom:'Retained',clientType:'invalid',primeId:a.prime.id},{primeId:a.prime.id,servoClientId:321234}),e=>e.statusCode===400);
    assert.equal((await db.getClientOnboarding(first.id,A)).items.length,1);
    assert.deepEqual((await db.clientOnboardingOptions(A)).clients.map(c=>c.id),[client.id,unknown.id]);
    assert.deepEqual((await db.clientOnboardingOptions(A)).techniciens.map(t=>t.id),[a.user.id]);
    await assert.rejects(createOnboarding({...data,client_id:telecom.id},items,A),e=>e.statusCode===404);
    await assert.rejects(createOnboarding({...data,technicien_id:b.user.id},items,A),e=>e.statusCode===400);
    await assert.rejects(createOnboarding({...data,client_id:999999},items,A),e=>e.statusCode===404);
    await assert.rejects(createOnboarding(data,[{...items[0],echeance:'2026-02-30'}],A),e=>e.statusCode===400);
    const created=await createOnboarding({...data,created_by_email:'forged@example.test',actor_email:'forged@example.test'},items,A);
    assert.equal(driver.sqlite.prepare('SELECT created_by_email FROM client_onboardings WHERE id=?').get(created.id).created_by_email,A.email);
    assert.equal(created.version,1);assert.equal(created.items.length,1);assert.equal(created.items[0].notes,'Note');
    assert.equal(Object.hasOwn(created,'history'),false);
    assert.equal((await db.getClientOnboardingHistory(created.id,A)).events[0].actor_email,A.email);
    assert.equal((await db.listClientOnboardings(A,{})).length,2);
    assert.equal((await db.listClientOnboardings(A,{client_id:String(client.id),technicien_id:String(a.user.id),statut:'À faire'})).length,1);
    assert.equal((await db.listClientOnboardings(A,{client_id:String(telecom.id)})).length,0);
    assert.equal((await db.listClientOnboardings(B,{})).length,0);
    await assert.rejects(db.getClientOnboarding(created.id,B),e=>e.statusCode===404);
    await assert.rejects(db.updateClientOnboarding(created.id,data,items,A,2),e=>e.statusCode===409);
    const edited=await db.updateClientOnboarding(created.id,{...data,titre:'Modifié'},items,A,1);
    assert.equal(edited.version,2);assert.equal(edited.titre,'Modifié');
    const archived=await db.archiveClientOnboarding(created.id,A,2);assert.equal(archived.archived,true);
    await assert.rejects(db.updateClientOnboarding(created.id,data,items,A,3),e=>e.statusCode===409);
    await assert.rejects(db.archiveClientOnboarding(created.id,A,3),e=>e.statusCode===409);
    const restored=await db.restoreClientOnboarding(created.id,A,3);assert.equal(restored.archived,false);
    assert.equal((await db.getClientOnboardingHistory(created.id,A)).events.length,4);
    assert.equal((await db.listClientOnboardings(A,{})).length,2);
    assert.equal((await db.listClientOnboardings(A,{archived:'true'})).length,0);
    driver.sqlite.prepare('UPDATE clients SET prime_id=? WHERE id=?').run(b.prime.id,client.id);
    await assert.rejects(db.getClientOnboarding(created.id,A),e=>e.statusCode===404);
    assert.equal((await db.getClientOnboardingHistory(created.id,B)).events[0].actor_email,A.email);
    await assert.rejects(db.updateClientOnboarding(created.id,data,items,A,4),e=>e.statusCode===404);
    const transferred=await db.updateClientOnboarding(created.id,{...data,technicien_id:null},items,B,4);
    assert.equal(transferred.technicien_id,null);assert.equal(transferred.version,5);
    assert.equal((await db.getClientOnboarding(created.id,ADMIN)).version,5);
    driver.sqlite.prepare('DELETE FROM tableaux_suivi WHERE client_id=?').run(client.id);
    await assert.rejects(db.deleteClient(client.id),e=>e.statusCode===409);
  });
  await test('restart retains schema/data and rejects malformed owned schema',async()=>{
    const columns=driver.sqlite.prepare('PRAGMA table_info(client_onboardings)').all().map(c=>c.name);
    assert(columns.includes('version'));
    assert.equal(driver.sqlite.prepare('SELECT COUNT(*) n FROM client_onboarding_history').get().n,6);
    assert.equal((await db.initDb()).kind,'sqlite');
    assert.equal(driver.sqlite.prepare('SELECT COUNT(*) n FROM client_onboardings').get().n,2);
    const {checkSqliteMetierIdentity}=await import('./database/metier-migration.js');
    driver.sqlite.exec('DROP INDEX idx_prime_onboarding_items; CREATE INDEX idx_prime_onboarding_items ON client_onboarding_items(item_order)');
    assert.throws(()=>checkSqliteMetierIdentity(driver.sqlite),/index idx_prime_onboarding_items incompatible/);
    assert.equal(driver.sqlite.prepare('SELECT COUNT(*) n FROM client_onboardings').get().n,2);
    driver.sqlite.exec('DROP INDEX idx_prime_onboarding_items');
    const {createOnboardingSchemaSqlite}=await import('./database/client-onboardings.js');
    createOnboardingSchemaSqlite(driver.sqlite);
    checkSqliteMetierIdentity(driver.sqlite);
  });
  await test('bounded list cursor and summary counts without full content',async()=>{
    const owned=await db.createClient({nom:'Paged',secteur:'TI',clientType:'ti',primeId:a.prime.id});
    const ids=[];
    for(let i=0;i<52;i++) {
      const record=await createOnboarding({...data,client_id:owned.id,titre:`Paged ${i}`},items,A);
      ids.push(record.id);
    }
    const first=await db.listClientOnboardings(A,{clientId:String(owned.id)});
    assert.equal(first.length,50);
    assert.deepEqual(first.map(r=>r.id),ids.slice(-50).reverse());
    assert.equal(first[0].total_items,1);assert.equal(first[0].completed_items,0);
    assert.equal(first[0].high_priority_open_items,1);
    assert.equal((await db.listClientOnboardings(A,{clientId:String(owned.id),search:'Paged 51'})).length,1);
    assert.equal((await db.listClientOnboardings(A,{clientId:String(owned.id),search:'Paged %'})).length,0);
    await createOnboarding({...data,client_id:owned.id,titre:'Literal X marker'},items,A);
    for (const literal of ['%','_','\\']) {
      const record=await createOnboarding({...data,client_id:owned.id,titre:`Literal ${literal} marker`},items,A);
      assert.deepEqual((await db.listClientOnboardings(A,{clientId:String(owned.id),search:`Literal ${literal} marker`})).map(r=>r.id),[record.id]);
    }
    assert.equal(Object.hasOwn(first[0],'items'),false);
    assert.equal(Object.hasOwn(first[0],'history'),false);
    const second=await db.listClientOnboardings(A,{clientId:String(owned.id),before:String(first.at(-1).id),limit:'50'});
    assert.deepEqual(second.map(r=>r.id),ids.slice(0,2).reverse());
    await assert.rejects(db.listClientOnboardings(A,{limit:'51'}),e=>e.statusCode===400);
    await assert.rejects(db.listClientOnboardings(A,{before:'wat'}),e=>e.statusCode===400);
  });
  await test('history bytes and cursor remain bounded with large snapshots',async()=>{
    const owned=await db.createClient({nom:'History fixture',clientType:'ti',primeId:a.prime.id});
    const id=(await createOnboarding({...data,client_id:owned.id},items,A)).id;
    const insert=driver.sqlite.prepare('INSERT INTO client_onboarding_history (onboarding_id,event_type,snapshot) VALUES (?,?,?)');
    const twoMB=JSON.stringify({onboarding:{id,client_id:owned.id,compte_rendu:{resume_executif:'x'.repeat(2*1024*1024)}},items:[],items_count:0});
    for(let i=0;i<3;i++) insert.run(id,'large',twoMB);
    const first=await db.getClientOnboardingHistory(id,A,{limit:'100'});
    assert.equal(first.events.length,1);
    assert.equal(first.events[0].snapshot.onboarding.compte_rendu.resume_executif.length,2*1024*1024);
    assert(first.nextBefore);
    const second=await db.getClientOnboardingHistory(id,A,{before:String(first.nextBefore),limit:'100'});
    assert.equal(second.events.length,1);
    assert.equal(second.events[0].id,first.nextBefore-1);
    assert(Buffer.byteLength(JSON.stringify(first))<=4*1024*1024);
    assert(Buffer.byteLength(JSON.stringify(second))<=4*1024*1024);
    insert.run(id,'oversized',JSON.stringify({onboarding:{id,client_id:owned.id,compte_rendu:{resume_executif:'z'.repeat(4*1024*1024)}},items:[],items_count:0}));
    await assert.rejects(db.getClientOnboardingHistory(id,A),e=>e.statusCode===413);
    const redacted=insert.run(id,'redacted',JSON.stringify({onboarding:{id,client_id:owned.id},items:[],items_count:0,private_blob:'s'.repeat(4*1024*1024)}));
    const page=await db.getClientOnboardingHistory(id,A,{limit:'1'});
    assert.equal(page.events[0].id,Number(redacted.lastInsertRowid));
    assert.deepEqual(Object.keys(page.events[0].snapshot).sort(),['items','items_count','onboarding']);
    assert(page.nextBefore);
  });
  await test('real SQLite HTTP: classification, snapshots, paged history and transfer',async()=>{
    process.env.JWT_SECRET='isolated-onboarding-key';
    const auth=await import('./auth.js');
    for(const user of [admin,a.user,b.user]) await db.upsertMfaPending(user.id,`fixture-${user.id}`);
    const tokenA=await auth.issueSessionToken(a.user,await db.enableMfa(a.user.id));
    const tokenB=await auth.issueSessionToken(b.user,await db.enableMfa(b.user.id));
    const tokenAdmin=await auth.issueSessionToken(admin,await db.enableMfa(admin.id));
    const child=spawn(process.execPath,['server/index.js'],{cwd:process.cwd(),env:{...process.env,PORT:'41772',JWT_SECRET:'isolated-onboarding-key',SEED_ADMIN_EMAIL:'admin@example.test',SEED_ADMIN_PASSWORD:'isolated-only'},stdio:['ignore','pipe','pipe']});
    let log='';child.stdout.on('data',d=>{log+=d;});child.stderr.on('data',d=>{log+=d;});
    const request=async(route,token,method='GET',body)=>{const payload=route==='/api/client-onboardings'&&method==='POST'&&body?{requestKey:randomUUID(),...body}:body;const r=await fetch(`http://127.0.0.1:41772${route}`,{method,headers:{...(token?{Authorization:'Bearer '+token} : {}),...(payload?{'Content-Type':'application/json'}:{})},...(payload?{body:JSON.stringify(payload)}:{})});return {status:r.status,data:await r.json()};};
    try {
      let ready=false;for(let i=0;i<100;i++){if(child.exitCode!==null) break;try{if((await request('/api/health')).status===200){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,50));}
      assert(ready,log);
      assert.equal((await request('/api/client-onboardings/reconcile?requestKey='+randomUUID())).status,401);
      assert.equal((await request('/api/client-onboardings/reconcile?requestKey=invalid',tokenA)).status,400);
      assert.deepEqual((await request('/api/client-onboardings/reconcile?requestKey='+randomUUID(),tokenA)).data,{found:false});
      const keyedClient=await db.createClient({nom:'HTTP key fixture',clientType:'ti',primeId:a.prime.id});
      const keyedData={...data,client_id:keyedClient.id};
      const idempotentKey=randomUUID();
      const firstPost=await request('/api/client-onboardings',tokenA,'POST',{onboarding:keyedData,items,requestKey:idempotentKey});
      assert.equal(firstPost.status,201);
      const duplicate=await request('/api/client-onboardings',tokenA,'POST',{onboarding:keyedData,items,requestKey:idempotentKey});
      assert.equal(duplicate.status,409);
      assert.equal(typeof duplicate.data.error,'string');
      assert.deepEqual((await request('/api/client-onboardings/reconcile?requestKey='+idempotentKey,tokenA)).data,{found:true,id:firstPost.data.id,archived:false});
      assert.equal((await request('/api/client-onboardings/reconcile?requestKey='+idempotentKey,tokenB)).status,404);
      const missingKey=await fetch('http://127.0.0.1:41772/api/client-onboardings',{method:'POST',headers:{Authorization:'Bearer '+tokenA,'Content-Type':'application/json'},body:JSON.stringify({onboarding:data,items})});
      assert.equal(missingKey.status,400);
      await db.archiveClientOnboarding(firstPost.data.id,A,1);
      assert.deepEqual((await request('/api/client-onboardings/reconcile?requestKey='+idempotentKey,tokenA)).data,{found:true,id:firstPost.data.id,archived:true});
      driver.sqlite.prepare('UPDATE clients SET prime_id=? WHERE id=?').run(b.prime.id,keyedClient.id);
      assert.equal((await request('/api/client-onboardings/reconcile?requestKey='+idempotentKey,tokenA)).status,404);
      assert.equal((await request('/api/client-onboardings/reconcile?requestKey='+idempotentKey,tokenB)).status,404);
      driver.sqlite.prepare("UPDATE clients SET data=json_set(data,'$.clientType','telecom') WHERE id=?").run(keyedClient.id);
      assert.equal((await request('/api/client-onboardings/reconcile?requestKey='+idempotentKey,tokenB)).status,404);
      driver.sqlite.prepare("UPDATE clients SET data=json_set(data,'$.clientType','ti') WHERE id=?").run(keyedClient.id);
      const imported=await db.createClient({nom:'Servo telecom',secteur:'TI',servoClientId:765432,primeId:a.prime.id});
      assert.equal(imported.clientType,null);
      assert.equal((await request('/api/client-onboardings/options',tokenA)).data.clients.some(c=>c.id===imported.id),false);
      assert.equal((await request('/api/client-onboardings',tokenA,'POST',{onboarding:{...data,client_id:imported.id},items})).status,404);
      assert.equal((await request(`/api/clients/${imported.id}`,tokenAdmin,'PUT',{client:{nom:imported.nom,primeId:a.prime.id,clientType:'ti'},expected:{primeId:a.prime.id,servoClientId:765432}})).status,200);
      assert.equal((await request('/api/client-onboardings/options',tokenA)).data.clients.some(c=>c.id===imported.id),true);
      const created=await request('/api/client-onboardings',tokenA,'POST',{onboarding:{...data,client_id:imported.id},items});
      assert.equal(created.status,201);
      const id=created.data.id;
      const completedHttp=await request('/api/client-onboardings',tokenA,'POST',{onboarding:{...data,client_id:imported.id,statut:'Fait'},items});
      assert.equal(completedHttp.status,201);
      const completeId=completedHttp.data.id;
      for(const [change,checklist,session] of [
        [{...data,client_id:imported.id,statut:'À faire'},items,tokenA],
        [{...data,client_id:imported.id,titre:'Changed'},items,tokenAdmin],
        [{...data,client_id:client.id},items,tokenAdmin],
        [{...data,client_id:imported.id,compte_rendu:{resume_executif:'Changed'}},items,tokenAdmin],
        [{...data,client_id:imported.id},[{...items[0],notes:'Changed'}],tokenA]
      ]) assert.equal((await request(`/api/client-onboardings/${completeId}`,session,'PUT',{onboarding:change,items:checklist,expectedVersion:1})).status,409);
      assert.equal((await request(`/api/client-onboardings/${completeId}`,tokenA)).data.statut,'Fait');
      assert.equal((await request(`/api/client-onboardings/${completeId}/history`,tokenA)).status,200);
      assert.equal((await request(`/api/client-onboardings/${completeId}`,tokenAdmin,'DELETE',{expectedVersion:1})).status,200);
      assert.equal((await request(`/api/client-onboardings/${completeId}/restore`,tokenAdmin,'POST',{expectedVersion:2})).status,200);
      assert.equal((await request(`/api/client-onboardings/${completeId}`,tokenAdmin,'PUT',{onboarding:data,items,expectedVersion:3})).status,409);
      for(const item_order of [null,false,1.5,'1']) {
        const invalidItems=[{...items[0],item_order}];
        assert.equal((await request('/api/client-onboardings',tokenA,'POST',{onboarding:{...data,client_id:imported.id},items:invalidItems})).status,400);
        assert.equal((await request(`/api/client-onboardings/${id}`,tokenA,'PUT',{onboarding:{...data,client_id:imported.id},items:invalidItems,expectedVersion:1})).status,400);
      }
      assert.equal((await request(`/api/clients/${imported.id}`,tokenAdmin,'PUT',{client:{nom:imported.nom,primeId:a.prime.id,clientType:null},expected:{primeId:a.prime.id,servoClientId:765432}})).status,409);
      const replaced=[{...items[0],element:'Replacement',notes:'new'}];
      assert.equal((await request(`/api/client-onboardings/${id}`,tokenA,'PUT',{onboarding:{...data,client_id:imported.id},items:replaced,expectedVersion:1})).status,200);
      for(let version=2;version<=103;version++) assert.equal((await request(`/api/client-onboardings/${id}`,tokenA,'PUT',{onboarding:{...data,client_id:imported.id,titre:`Version ${version}`},expectedVersion:version})).status,200);
      const detail=await request(`/api/client-onboardings/${id}`,tokenA);
      assert.equal(Object.hasOwn(detail.data,'history'),false);
      assert.equal(detail.data.items[0].notes,'new');
      const all=[];let before;
      do {const page=await request(`/api/client-onboardings/${id}/history?limit=17${before?`&before=${before}`:''}`,tokenA);assert.equal(page.status,200);all.push(...page.data.events);before=page.data.nextBefore;} while(before);
      assert.equal(all.length,104);
      assert.equal(new Set(all.map(e=>e.id)).size,104);
      assert.equal(all.at(-1).snapshot.items[0].notes,'Note');
      assert.equal(all.at(-2).snapshot.items[0].notes,'new');
      assert.equal((await request(`/api/client-onboardings/${id}/history?before=bad`,tokenA)).status,400);
      assert.equal((await request(`/api/client-onboardings/${id}/history?limit=501`,tokenA)).status,400);
      assert.equal((await request(`/api/client-onboardings/${id}/history`,tokenB)).status,404);
      assert.equal((await request(`/api/clients/${imported.id}`,tokenAdmin,'PUT',{client:{nom:imported.nom,primeId:b.prime.id},expected:{primeId:a.prime.id,servoClientId:765432}})).status,200);
      assert.equal((await request(`/api/client-onboardings/${id}/history`,tokenA)).status,404);
      assert.equal((await request(`/api/client-onboardings/${id}/history`,tokenB)).status,200);
      const prior=await db.createClient({nom:'HTTP private A',clientType:'ti',primeId:a.prime.id});
      const privateRecord=await request('/api/client-onboardings',tokenA,'POST',{onboarding:{...data,client_id:prior.id,titre:'HTTP A private title'},items:[{...items[0],notes:'HTTP A private note'}]});
      assert.equal(privateRecord.status,201);
      const privateId=privateRecord.data.id;
      const movedPrivate=await request(`/api/client-onboardings/${privateId}`,tokenAdmin,'PUT',{onboarding:{...data,client_id:imported.id,technicien_id:null,titre:'HTTP B title'},items:[{...items[0],notes:'HTTP B note'}],expectedVersion:1});
      assert.equal(movedPrivate.status,409);
      assert.equal((await request(`/api/client-onboardings/${privateId}`,tokenA)).data.client_id,prior.id);
      assert.equal((await request(`/api/client-onboardings/${privateId}/history`,tokenB)).status,404);
      const adminHistory=await request(`/api/client-onboardings/${privateId}/history`,tokenAdmin);
      assert.equal(adminHistory.status,200);
      assert.equal(adminHistory.data.events.length,1);
      assert.equal(adminHistory.data.events[0].snapshot.items[0].notes,'HTTP A private note');
      assert.equal(adminHistory.data.events[0].snapshot.onboarding.client_id,prior.id);
      const oversizedEvent=driver.sqlite.prepare('INSERT INTO client_onboarding_history (onboarding_id,event_type,snapshot) VALUES (?,?,?)').run(id,'oversized',JSON.stringify({body:'z'.repeat(4*1024*1024)}));
      const oversizedResponse=await request(`/api/client-onboardings/${id}/history`,tokenB);
      assert.equal(oversizedResponse.status,404);
      driver.sqlite.prepare('DELETE FROM client_onboarding_history WHERE id=?').run(Number(oversizedEvent.lastInsertRowid));
      const largeClient=await db.createClient({nom:'Large HTTP',secteur:'TI',clientType:'ti',primeId:a.prime.id});
      const populated=Array.from({length:110},(_,i)=>({...items[0],section_key:`section-${Math.floor(i/10)}`,section_title:`Section ${Math.floor(i/10)}`,item_order:i%10,notes:'n'.repeat(4000),action:'a'.repeat(4000)}));
      const big=await request('/api/client-onboardings',tokenA,'POST',{onboarding:{...data,client_id:largeClient.id},items:populated});
      assert.equal(big.status,201,JSON.stringify(big.data));
      assert.equal(big.data.items.length,110);
      assert.equal(big.data.items[109].notes.length,4000);
      const tooBig=await request('/api/client-onboardings',tokenA,'POST',{onboarding:data,items:[{...items[0],notes:'x'.repeat(2*1024*1024)}]});
      assert.equal(tooBig.status,413);
      assert.equal(typeof tooBig.data.error,'string');
    } finally {child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}
  });
  await test('SQLite portfolio imports stay unknown and preserve explicit classification',async()=>{
    const unknown=await db.updatePrimePortfolio(a.prime.id,{nom:a.prime.nom},{add:[{id:98981,nom:'TI imported',alias:''}],remove:[]});
    assert.equal(unknown.clients.find(c=>c.servoClientId===98981).clientType,null);
    const existing=await db.createClient({nom:'Classified Servo',clientType:'ti',servoClientId:98982,primeId:null});
    const assigned=await db.updatePrimePortfolio(a.prime.id,{nom:a.prime.nom},{add:[{id:98982,nom:'Classified Servo',alias:''}],remove:[]});
    assert.equal(assigned.clients.find(c=>c.id===existing.id).clientType,'ti');
    const retained=await db.updatePrimePortfolio(a.prime.id,{nom:a.prime.nom},{add:[],remove:[existing.id]});
    assert.equal((await db.listClients()).find(c=>c.id===existing.id).clientType,'ti');
  });
  await test('SQLite legacy migration preserves items/history and validates identity before writes',async()=>{
    const {checkSqliteMetierIdentity}=await import('./database/metier-migration.js');
    const {createOnboardingSchemaSqlite}=await import('./database/client-onboardings.js');
    const owned=await db.createClient({nom:'Legacy fixture',clientType:'ti',primeId:a.prime.id});
    const saved=await createOnboarding({...data,client_id:owned.id},items,A);
    const sqlite=driver.sqlite;
    const original=sqlite.prepare('SELECT sql FROM sqlite_master WHERE type=? AND name=?').get('table','client_onboardings').sql;
    const oldColumns=sqlite.prepare('PRAGMA table_info(client_onboardings)').all().map(c=>c.name).filter(c=>c!=='request_key');
    sqlite.pragma('foreign_keys = OFF');
    sqlite.transaction(()=>{
      sqlite.exec(original.replace('CREATE TABLE client_onboardings (','CREATE TABLE client_onboardings_legacy (').replace('request_key TEXT NOT NULL UNIQUE,',''));
      sqlite.exec(`INSERT INTO client_onboardings_legacy (${oldColumns.join(',')}) SELECT ${oldColumns.join(',')} FROM client_onboardings`);
      sqlite.exec('DROP TABLE client_onboardings; ALTER TABLE client_onboardings_legacy RENAME TO client_onboardings');
      checkSqliteMetierIdentity(sqlite);
      createOnboardingSchemaSqlite(sqlite);
      assert.deepEqual(sqlite.pragma('foreign_key_check'),[]);
    }).immediate();
    sqlite.pragma('foreign_keys = ON');
    assert.equal((await db.getClientOnboarding(saved.id,A)).items.length,1);
    assert.equal((await db.getClientOnboardingHistory(saved.id,A)).events.length,1);
    const migrated=sqlite.prepare('SELECT request_key FROM client_onboardings WHERE id=?').get(saved.id).request_key;
    assert.match(migrated,/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
    checkSqliteMetierIdentity(sqlite);
    createOnboardingSchemaSqlite(sqlite);
    assert.equal(sqlite.prepare('SELECT request_key FROM client_onboardings WHERE id=?').get(saved.id).request_key,migrated);
    for(const malformed of ['bad','a'.repeat(36),'a'+'Z'.repeat(35)]) {
      sqlite.prepare('UPDATE client_onboardings SET request_key=? WHERE id=?').run(malformed,saved.id);
      assert.throws(()=>checkSqliteMetierIdentity(sqlite),/request_key non unique, nullable ou invalide/);
    }
    sqlite.prepare('UPDATE client_onboardings SET request_key=? WHERE id=?').run(migrated,saved.id);
    checkSqliteMetierIdentity(sqlite);
  });
  await test('SQLite identity rejects a partial request_key UNIQUE index',async()=>{
    const {checkSqliteMetierIdentity}=await import('./database/metier-migration.js');
    const {createOnboardingSchemaSqlite}=await import('./database/client-onboardings.js');
    const sqlite=driver.sqlite;
    const ddl=sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='client_onboardings'").get().sql;
    assert(ddl.includes('request_key TEXT NOT NULL UNIQUE'));
    sqlite.pragma('foreign_keys = OFF');
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      const partialDdl=ddl.replace('client_onboardings','client_onboardings_partial').replace('request_key TEXT NOT NULL UNIQUE','request_key TEXT NOT NULL');
      assert.notEqual(partialDdl,ddl);
      sqlite.exec(partialDdl);
      sqlite.exec('INSERT INTO client_onboardings_partial SELECT * FROM client_onboardings');
      sqlite.exec('DROP TABLE client_onboardings; ALTER TABLE client_onboardings_partial RENAME TO client_onboardings');
      createOnboardingSchemaSqlite(sqlite);
      sqlite.exec('CREATE UNIQUE INDEX test_partial_request_key ON client_onboardings(request_key) WHERE archived = 0');
      assert.throws(()=>checkSqliteMetierIdentity(sqlite),/request_key non unique, nullable ou invalide/);
    } finally {
      sqlite.exec('ROLLBACK');
      sqlite.pragma('foreign_keys = ON');
    }
  });
} finally {driver.sqlite.close();fs.rmSync(dir,{recursive:true,force:true});}