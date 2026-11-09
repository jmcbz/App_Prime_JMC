import crypto from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import {spawn} from 'node:child_process';
const socketDir='/var/lib/postgresql/prime-onboardings';
assert.equal(process.env.APP_PRIME_ISOLATED_TEST,'1');assert.equal(process.env.NODE_ENV,'test');
for(const ns of ['net','mnt'])assert.notEqual(fs.readlinkSync(`/proc/self/ns/${ns}`),fs.readlinkSync(`/proc/1/ns/${ns}`));
assert.equal(process.env.APP_PRIME_TEST_SOCKET,socketDir);
assert.equal(fs.realpathSync(socketDir),socketDir);
assert.notEqual(fs.statSync('/var/lib/postgresql').dev,fs.statSync('/var/lib').dev);
assert.equal(fs.statfsSync('/var/lib/postgresql').type,0x01021994);
assert.equal(fs.statfsSync(socketDir).type,0x01021994);
assert(fs.statSync(`${socketDir}/.s.PGSQL.5489`).isSocket());
assert.equal(process.env.DATABASE_URL,`postgresql://prime_test@/prime_test?host=${socketDir}&port=5489&sslmode=disable`);
const db=await import('./database/index.js');
const auth=await import('./auth.js');
const {migratePgMetier}=await import('./database/metier-migration.js');
const driver=await db.initDb(),pool=driver.pool;
const admin=await db.createUser({email:'admin@test.invalid',passwordHash:'dummy',role:'admin'});
const a=await db.createUserWithPrime({email:'a@test.invalid',passwordHash:'dummy'});
const b=await db.createUserWithPrime({email:'b@test.invalid',passwordHash:'dummy'});
const own=await db.createClient({nom:'TI client',clientType:'ti',primeId:a.prime.id});
const foreign=await db.createClient({nom:'Foreign TI',clientType:'ti',primeId:b.prime.id});
const telecom=await db.createClient({nom:'Telecom',clientType:'telecom',primeId:a.prime.id});
async function token(user){await db.upsertMfaPending(user.id,'fixture-secret');return auth.issueSessionToken(user,await db.enableMfa(user.id));}
const tokens={admin:await token(admin),a:await token(a.user),b:await token(b.user)};
const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
const base=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,['server/index.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
async function req(method,route,who,body){const response=await fetch(base+route,{method,headers:{...(who?{Cookie:`app_prime_session=${tokens[who]}`}:{}) ,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:response.status,body:await response.json()};}
const sections=[{title:'Préparation',steps:[{id:'check',title:'Audit',note:'Note'}]}];
try{
 let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,50));}assert(ready,logs);
 await test('PG real HTTP persists template and dossier; scope, versions and archival',async()=>{
  const seeded=await req('GET','/api/workstation-procedures/templates','a');assert.equal(seeded.status,200,JSON.stringify(seeded)+' '+logs);assert.equal(seeded.body.templates.filter(x=>x.name==='Montage de poste — standard BZ').length,1);
  assert.equal((await req('POST','/api/workstation-procedures/templates','a',{requestKey:crypto.randomUUID(),clientId:foreign.id,name:'X',sections})).status,404);
  assert.equal((await req('POST','/api/workstation-procedures/templates','a',{requestKey:crypto.randomUUID(),clientId:telecom.id,name:'X',sections})).status,404);
  const result=await req('POST','/api/workstation-procedures/templates','a',{requestKey:crypto.randomUUID(),clientId:own.id,name:'PG model',sections});assert.equal(result.status,201,JSON.stringify(result));const template=result.body.template;
  const created=await req('POST','/api/workstation-procedures/dossiers','a',{requestKey:crypto.randomUUID(),clientId:own.id,templateId:template.id,employee:'Employé',computer:'PC',ticket:'BZ',date:'2026-11-09'});assert.equal(created.status,201,JSON.stringify(created));const dossier=created.body.dossier;
  await assert.rejects(db.updateClient(own.id,{nom:'TI client',primeId:a.prime.id,clientType:'telecom'},{primeId:a.prime.id,servoClientId:null}),e=>e.statusCode===409);
  assert.equal((await req('GET',`/api/workstation-procedures/dossiers/${dossier.id}`,'b')).status,404);
  assert.equal((await req('POST','/api/workstation-procedures/dossiers','b',{requestKey:crypto.randomUUID(),clientId:foreign.id,templateId:template.id,employee:'X',computer:'',ticket:'',date:'2026-11-09'})).status,404);
  const newTemplate=await req('PUT',`/api/workstation-procedures/templates/${template.id}`,'a',{name:'Updated',sections:[{title:'New',steps:[{id:'new',title:'New',note:''}]}],expectedVersion:1});assert.equal(newTemplate.status,200,JSON.stringify(newTemplate));
  assert.equal((await req('GET',`/api/workstation-procedures/dossiers/${dossier.id}`,'a')).body.dossier.sections[0].steps[0].title,'Audit');
  const patched=structuredClone(dossier.sections);patched[0].steps[0].etat='fait';patched[0].steps[0].commentaire='OK';
  const update=await req('PUT',`/api/workstation-procedures/dossiers/${dossier.id}`,'a',{expectedVersion:1,employee:'Employé',computer:'PC',ticket:'BZ',date:'2026-11-09',sections:patched});assert.equal(update.status,200,JSON.stringify(update));
  assert.equal((await req('PUT',`/api/workstation-procedures/dossiers/${dossier.id}`,'a',{expectedVersion:1,employee:'X',computer:'PC',ticket:'BZ',date:'2026-11-09',sections:patched})).status,409);
  assert.equal((await req('POST',`/api/workstation-procedures/dossiers/${dossier.id}/archive`,'a',{expectedVersion:2})).status,200);
  assert.equal((await req('GET','/api/workstation-procedures/dossiers','admin')).body.dossiers.some(x=>x.id===dossier.id),true);
  const before=(await pool.query('SELECT sections,version FROM workstation_dossiers WHERE id=$1',[dossier.id])).rows[0];
  await migratePgMetier(pool,async()=>{});await migratePgMetier(pool,async()=>{});
  assert.deepEqual((await pool.query('SELECT sections,version FROM workstation_dossiers WHERE id=$1',[dossier.id])).rows[0],before);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM workstation_templates WHERE client_id IS NULL AND name='Montage de poste — standard BZ'")).rows[0].n,1);
 });
 await test('PG HTTP idempotency, transfer and bounded pages',async()=>{
  const key=crypto.randomUUID(), payload={requestKey:key,clientId:foreign.id,name:'Retry PG',sections};
  const [one,two]=await Promise.all([req('POST','/api/workstation-procedures/templates','b',payload),req('POST','/api/workstation-procedures/templates','b',payload)]);
  assert.equal(one.status,201,JSON.stringify(one));assert.equal(two.status,201,JSON.stringify(two));assert.equal(one.body.template.id,two.body.template.id);
  assert.equal((await req('POST','/api/workstation-procedures/templates','admin',payload)).status,409);
  assert.equal((await req('POST','/api/workstation-procedures/templates','b',{...payload,name:'Different'})).status,409);
  assert.equal((await req('GET',`/api/workstation-procedures/templates/by-request/${key}`,'b')).body.template.id,one.body.template.id);
  const dkey=crypto.randomUUID(), data={requestKey:dkey,clientId:foreign.id,templateId:one.body.template.id,employee:'A',computer:'PC',ticket:'BZ',date:'2026-11-09'};
  const [d1,d2]=await Promise.all([req('POST','/api/workstation-procedures/dossiers','b',data),req('POST','/api/workstation-procedures/dossiers','b',data)]);
  assert.equal(d1.status,201,JSON.stringify(d1));assert.equal(d2.status,201,JSON.stringify(d2));assert.equal(d1.body.dossier.id,d2.body.dossier.id);
  assert.equal((await req('POST','/api/workstation-procedures/dossiers','b',{...data,ticket:'Other'})).status,409);
  assert.equal((await req('GET',`/api/workstation-procedures/dossiers/by-request/${dkey}`,'b')).body.dossier.id,d1.body.dossier.id);
  assert.equal((await req('GET',`/api/workstation-procedures/dossiers/by-request/${dkey}`,'admin')).status,404);
  for(let i=0;i<53;i++)await db.createWorkstationTemplate({role:'admin',sub:admin.id},{requestKey:crypto.randomUUID(),clientId:null,name:`PG bulk ${i}`,sections});
  const page=await req('GET','/api/workstation-procedures/templates?limit=50','b');assert.equal(page.body.templates.length,50);assert.equal(page.body.hasMore,true);
  assert.equal((await req('GET',`/api/workstation-procedures/templates?limit=50&before=${page.body.nextBefore}`,'b')).body.hasMore,false);
  assert.equal((await req('GET','/api/workstation-procedures/templates/standard','b')).body.template.sections.length,5);
  for(let i=0;i<52;i++)await pool.query('INSERT INTO workstation_dossiers(client_id,template_id,employee,computer,ticket,date,sections) VALUES ($1,$2,$3,$4,$5,$6,$7)',[foreign.id,one.body.template.id,'Bulk','PC','BZ','2026-11-09',JSON.stringify(d1.body.dossier.sections)]);
  const dPage=await req('GET','/api/workstation-procedures/dossiers?limit=50','b');assert.equal(dPage.body.dossiers.length,50);assert.equal(dPage.body.hasMore,true);
  const dNext=await req('GET',`/api/workstation-procedures/dossiers?limit=50&before=${dPage.body.nextBefore}`,'b');assert.equal(dNext.body.dossiers.length,3);assert.equal(dNext.body.hasMore,false);
  await db.updateClient(foreign.id,{nom:'Foreign TI',primeId:a.prime.id},{primeId:b.prime.id,servoClientId:null});
  assert.equal((await req('POST','/api/workstation-procedures/templates','b',payload)).status,404);
  assert.equal((await req('GET',`/api/workstation-procedures/templates/by-request/${key}`,'b')).status,404);
  assert.equal((await req('POST','/api/workstation-procedures/dossiers','b',data)).status,404);
  assert.equal((await req('GET',`/api/workstation-procedures/dossiers/by-request/${dkey}`,'b')).status,404);
 });
 await test('PG transfer locks client before concurrent workstation writes',async()=>{
   const client=await db.createClient({nom:'Race TI',clientType:'ti',primeId:a.prime.id});
   const key=crypto.randomUUID(), payload={requestKey:key,clientId:client.id,name:'Race',sections};
   const blocker=await pool.connect();await blocker.query('BEGIN');await blocker.query('SELECT id FROM clients WHERE id=$1 FOR UPDATE',[client.id]);
   let transferDone=false;
   const transfer=db.updateClient(client.id,{nom:'Race TI',primeId:b.prime.id},{primeId:a.prime.id,servoClientId:null}).then(v=>{transferDone=true;return v;});
   try{
     let waiting=false;for(let i=0;i<100;i++){const r=await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT * FROM clients WHERE id = $1 FOR UPDATE%'");if(r.rows[0].n){waiting=true;break;}await new Promise(r=>setTimeout(r,20));}assert(waiting,'admin transfer must be waiting for client lock');
     const post=req('POST','/api/workstation-procedures/templates','a',payload);
     let writeWaiting=false;for(let i=0;i<100;i++){const r=await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT c.id,c.data,c.prime_id FROM clients%'");if(r.rows[0].n){writeWaiting=true;break;}await new Promise(r=>setTimeout(r,20));}
     assert(writeWaiting,'workstation write must wait for client lock');
     await blocker.query('COMMIT');await transfer;assert(transferDone);
     assert.equal((await post).status,404,'old owner cannot write after transfer');
     assert.equal((await pool.query('SELECT count(*)::int AS n FROM workstation_templates WHERE request_key=$1',[key])).rows[0].n,0);
   }finally{try{await blocker.query('ROLLBACK');}catch{}blocker.release();}
 });
}finally{child.kill();await pool.end();}
