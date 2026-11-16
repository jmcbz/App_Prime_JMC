import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

assert.equal(process.env.APP_PRIME_ISOLATED_TEST,'1');
assert.equal(process.env.NODE_ENV,'test');
for(const namespace of ['net','mnt']) {
  const host=process.env[`HOST_${namespace.toUpperCase()}`];
  assert(host,'host namespace reference required');
  assert.notEqual(fs.readlinkSync(`/proc/self/ns/${namespace}`),host);
}
assert(fs.existsSync('/proc/1/root/src/server/index.js'));
assert(!fs.existsSync('/proc/1/root/root/.hermes'));
const pg=!!process.env.DATABASE_URL;
if(pg) {
  const socket='/var/lib/postgresql/prime-onboardings';
  assert.equal(process.env.DATABASE_URL,`postgresql://prime_test@/prime_test?host=${socket}&port=5489&sslmode=disable`);
  assert.equal(fs.realpathSync(socket),socket);
  assert.equal(fs.statfsSync(socket).type,0x01021994);
  assert(fs.statSync(`${socket}/.s.PGSQL.5489`).isSocket());
}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'onboarding-access-'));
process.env.SQLITE_PATH=path.join(dir,'fixture.sqlite');
process.env.APP_PRIME_ALLOW_NEW_DATABASE='1';
const db=await import('./database/index.js');
const driver=await db.initDb();
const sql=async(text,values=[])=>{
  if(pg) {let n=0;return (await driver.pool.query(text.replaceAll('?',()=>`$${++n}`),values)).rows;}
  const statement=driver.sqlite.prepare(text);
  if(statement.reader)return statement.all(...values);
  statement.run(...values);return [];
};
const a=await db.createUserWithPrime({email:'a@example.test',passwordHash:'fixture',prenom:'Alice',nom:'Prime'});
const b=await db.createUserWithPrime({email:'b@example.test',passwordHash:'fixture',prenom:'Bob',nom:'Prime'});
const promoted=await db.createUserWithPrime({email:'admin-prime@example.test',passwordHash:'fixture',prenom:'Camille',nom:'Prime'});
await sql("UPDATE users SET role='admin' WHERE id=?",[promoted.user.id]);
const inactive=await db.createUserWithPrime({email:'inactive@example.test',passwordHash:'fixture',prenom:'Inactive',nom:'Prime'});
await sql('UPDATE users SET is_active=? WHERE id=?',[pg?false:0,inactive.user.id]);
const admin=await db.createUser({email:'admin@example.test',passwordHash:'fixture',prenom:'Unlinked',nom:'Admin',role:'admin'});
const A={sub:a.user.id,email:a.user.email,role:'prime'};
const ADMIN={sub:admin.id,email:admin.email,role:'admin'};
const expected=[a.user.id,b.user.id,promoted.user.id].sort((a,b)=>a-b);
try {
  await test('client options include every Prime portfolio and classification, excluding unlinked clients',async()=>{
    const owned=await db.createClient({nom:'Owned TI',clientType:'ti',primeId:a.prime.id});
    const foreign=await db.createClient({nom:'Foreign TI',clientType:'ti',primeId:b.prime.id});
    const telecom=await db.createClient({nom:'Foreign telecom',clientType:'telecom',primeId:b.prime.id});
    const unknown=await db.createClient({nom:'Foreign unknown',primeId:b.prime.id});
    const unlinked=await db.createClient({nom:'Unlinked TI',clientType:'ti'});
    for(const actor of [A,ADMIN]) assert.deepEqual((await db.clientOnboardingOptions(actor)).clients.map(c=>c.id),[owned.id,foreign.id,telecom.id,unknown.id]);
    assert.equal((await sql('SELECT prime_id FROM clients WHERE id=?',[unlinked.id]))[0].prime_id,null);
  });
  await test('options expose all active linked Prime technicians including administrators, without role escalation',async()=>{
    for(const actor of [A,ADMIN]) {
      const options=await db.clientOnboardingOptions(actor);
      assert.deepEqual(options.techniciens.map(t=>t.id).sort((a,b)=>a-b),expected);
      assert.equal(new Set(options.techniciens.map(t=>t.id)).size,expected.length);
      for(const t of options.techniciens) assert.deepEqual(Object.keys(t).sort(),['email','id','nom','prenom']);
    }
    assert.equal((await sql('SELECT role FROM users WHERE id=?',[A.sub]))[0].role,'prime');
  });
  await test('create and update accept every selectable technician for both actor roles',async()=>{
    const client=await db.createClient({nom:'Owned client',clientType:'ti',primeId:a.prime.id});
    const data={client_id:client.id,technicien_id:null,titre:'Access test',statut:'À faire',priorite:'Moyenne'};
    for(const actor of [A,ADMIN]) {
      for(const id of expected) {
        const saved=await db.createClientOnboarding({...data,technicien_id:id},[],actor,randomUUID());
        assert.equal((await db.getClientOnboarding(saved.id,actor)).technicien_id,id);
        const updated=await db.updateClientOnboarding(saved.id,{...data,technicien_id:promoted.user.id},undefined,actor,1);
        assert.equal(updated.technicien_id,promoted.user.id);
        assert.equal((await db.getClientOnboarding(saved.id,actor)).version,2);
      }
      for(const id of [inactive.user.id,admin.id,999999]) {
        await assert.rejects(db.createClientOnboarding({...data,technicien_id:id},[],actor,randomUUID()),e=>e.statusCode===400);
      }
    }
    const outsider={sub:b.user.id,email:b.user.email,role:'prime'};
    const record=await db.createClientOnboarding(data,[],A,randomUUID());
    assert.equal((await db.getClientOnboarding(record.id,outsider)).id,record.id);
    assert.equal((await db.updateClientOnboarding(record.id,data,undefined,outsider,1)).version,2);
    assert.equal((await db.getClientOnboardingHistory(record.id,outsider)).events.length,2);
    await assert.rejects(db.archiveClientOnboarding(record.id,outsider,2),e=>e.statusCode===404);
    assert((await db.listClientOnboardings(outsider)).some(r=>r.id===record.id));
    assert.equal((await sql('SELECT role FROM users WHERE id=?',[A.sub]))[0].role,'prime');
  });
  await test('real HTTP options, create, update, readback and preserved authorization boundaries',async()=>{
    process.env.JWT_SECRET='isolated-onboarding-access-key';
    const auth=await import('./auth.js');
    const tokens=[];
    for(const user of [a.user,admin]) {
      await db.upsertMfaPending(user.id,`fixture-${user.id}`);
      tokens.push(await auth.issueSessionToken(user,await db.enableMfa(user.id)));
    }
    const child=spawn(process.execPath,['server/index.js'],{env:{...process.env,PORT:'41773',SEED_ADMIN_EMAIL:admin.email,SEED_ADMIN_PASSWORD:'isolated-only'},stdio:['ignore','pipe','pipe']});
    let log='';child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d);
    const request=async(route,token,method='GET',body)=>{
      const r=await fetch(`http://127.0.0.1:41773${route}`,{method,headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
      return {status:r.status,data:await r.json()};
    };
    try {
      let ready=false;for(let n=0;n<100;n++){try{if((await request('/api/health')).status===200){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,50));}assert(ready,log);
      assert.equal((await request('/api/client-onboardings/options')).status,401);
      const client=await db.createClient({nom:'HTTP owned client',clientType:'ti',primeId:a.prime.id});
      const foreign=await db.createClient({nom:'HTTP foreign client',clientType:'ti',primeId:b.prime.id});
      const telecom=await db.createClient({nom:'HTTP linked telecom',clientType:'telecom',primeId:a.prime.id});
      const data={client_id:client.id,technicien_id:promoted.user.id,titre:'HTTP roundtrip',statut:'À faire',priorite:'Moyenne'};
      for(const token of tokens) {
        const opts=await request('/api/client-onboardings/options',token);assert.equal(opts.status,200);
        assert.deepEqual(opts.data.techniciens.map(t=>t.id).sort((a,b)=>a-b),expected);
        const saved=await request('/api/client-onboardings',token,'POST',{onboarding:data,items:[],requestKey:randomUUID()});assert.equal(saved.status,201);
        assert.equal((await request(`/api/client-onboardings/${saved.data.id}`,token)).data.technicien_id,promoted.user.id);
        assert.equal((await request(`/api/client-onboardings/${saved.data.id}`,token,'PUT',{onboarding:{...data,technicien_id:b.user.id},expectedVersion:1})).status,200);
        const read=await request(`/api/client-onboardings/${saved.data.id}`,token);assert.equal(read.data.technicien_id,b.user.id);assert.equal(read.data.version,2);
        for(const id of [inactive.user.id,admin.id,999999]) assert.equal((await request('/api/client-onboardings',token,'POST',{onboarding:{...data,technicien_id:id},items:[],requestKey:randomUUID()})).status,400);
      }
      assert.equal((await request('/api/admin/users',tokens[0])).status,403);
      const unknown=await db.createClient({nom:'HTTP foreign unknown',primeId:b.prime.id});
      const unlinked=await db.createClient({nom:'HTTP unlinked TI',clientType:'ti'});
      const opts=await request('/api/client-onboardings/options',tokens[0]);
      for(const c of [foreign,telecom,unknown]) {
        assert.equal(opts.data.clients.some(x=>x.id===c.id),true);
        const key=randomUUID();
        const saved=await request('/api/client-onboardings',tokens[0],'POST',{onboarding:{...data,client_id:c.id},items:[],requestKey:key});assert.equal(saved.status,201);
        assert.deepEqual((await request('/api/client-onboardings/reconcile?requestKey='+key,tokens[0])).data,{found:true,id:saved.data.id,archived:false});
        assert((await request('/api/client-onboardings',tokens[0])).data.some(r=>r.id===saved.data.id));
        assert.equal((await request(`/api/client-onboardings/${saved.data.id}`,tokens[0])).data.client_id,c.id);
        assert.equal((await request(`/api/client-onboardings/${saved.data.id}`,tokens[0],'PUT',{onboarding:{...data,client_id:c.id,titre:'Cross portfolio edited'},expectedVersion:1})).status,200);
        const reloaded=await request(`/api/client-onboardings/${saved.data.id}`,tokens[0]);assert.equal(reloaded.data.titre,'Cross portfolio edited');assert.equal(reloaded.data.version,2);
        assert.equal((await request(`/api/client-onboardings/${saved.data.id}/history`,tokens[0])).data.events.length,2);
        for(const token of tokens) for(const [suffix,method] of [['','DELETE'],['/restore','POST']]) {
          // Old scope: admin may archive foreign TI, but nobody could archive telecom/unknown.
          if(token===tokens[1] && c===foreign) continue;
          assert.equal((await request(`/api/client-onboardings/${saved.data.id}${suffix}`,token,method,{expectedVersion:2})).status,404);
        }
      }
      for(const token of tokens) {
        assert.equal((await request('/api/client-onboardings/options',token)).data.clients.some(c=>c.id===unlinked.id),false);
        assert.equal((await request('/api/client-onboardings',token,'POST',{onboarding:{...data,client_id:unlinked.id},items:[],requestKey:randomUUID()})).status,404);
      }
      // A dossier originally authored in the other Prime's portfolio is editable too.
      const foreignSaved=await request('/api/client-onboardings',tokens[1],'POST',{onboarding:{...data,client_id:foreign.id},items:[],requestKey:randomUUID()});assert.equal(foreignSaved.status,201);
      const route=`/api/client-onboardings/${foreignSaved.data.id}`;
      const before=(await request(route+'/history',tokens[1])).data.events;
      assert.equal((await request(route,tokens[0],'PUT',{onboarding:{...data,client_id:foreign.id,titre:'Edited by another Prime'},expectedVersion:1})).status,200);
      assert.equal((await request(route,tokens[0])).data.titre,'Edited by another Prime');
      const events=(await request(route+'/history',tokens[0])).data.events;assert.deepEqual(events.at(-1),before[0]);assert.equal(events[0].actor_email,A.email);
      assert.equal((await request(route,tokens[0],'DELETE',{expectedVersion:2})).status,404);
      assert.equal((await request(route,tokens[1],'DELETE',{expectedVersion:2})).status,200);
      assert.equal((await request(route+'/restore',tokens[0],'POST',{expectedVersion:3})).status,404);
      assert.equal((await request(route,tokens[0],'PUT',{onboarding:{...data,client_id:foreign.id},expectedVersion:3})).status,409);
      assert.equal((await request(route+'/restore',tokens[1],'POST',{expectedVersion:3})).status,200);
      for(const [suffix,method,body] of [['','GET'],['/history','GET'],['','PUT',{onboarding:data,expectedVersion:4}],['','DELETE',{expectedVersion:4}],['/restore','POST',{expectedVersion:4}]]) assert.equal((await request(route+suffix,undefined,method,body)).status,401);
      assert.equal((await request('/api/client-onboardings',undefined,'POST',{onboarding:data,items:[],requestKey:randomUUID()})).status,401);
      assert.equal((await request('/api/clients',tokens[0])).data.clients.some(c=>c.id===foreign.id),false);
      assert.equal((await request('/api/clients/'+foreign.id,tokens[0],'PUT',{nom:'Not authorized'})).status,403);
      assert.equal((await request('/api/clients/'+foreign.id,tokens[0],'DELETE')).status,403);
      assert.equal((await request('/api/tableaux-suivi',tokens[0])).data.tableaux.some(t=>t.client_id===foreign.id),false);
      assert.equal((await request('/api/tableaux-suivi',tokens[0],'POST',{clientId:foreign.id,expectedActiveId:null})).status,404);
      const {default:jwt}=await import('jsonwebtoken');
      for(const purpose of ['mfa_setup','mfa_login']) {
        const challenge=jwt.sign({sub:A.sub,purpose},process.env.JWT_SECRET,{expiresIn:'5m'});
        assert.equal((await request('/api/client-onboardings/options',challenge)).status,401);
      }
      await sql('UPDATE users SET is_active=? WHERE id=?',[pg?false:0,A.sub]);
      assert.equal((await request('/api/client-onboardings/options',tokens[0])).status,401);
      await sql('UPDATE users SET is_active=? WHERE id=?',[pg?true:1,A.sub]);
      assert.equal((await request('/api/client-onboardings/options',tokens[0])).status,200);
      // Detachment revokes non-destructive access without mutating any dossier/history.
      const persisted=await db.getClientOnboarding(foreignSaved.data.id,A);
      await sql('UPDATE clients SET prime_id=NULL WHERE id=?',[foreign.id]);
      for(const token of tokens) {
        assert.equal((await request(route,token)).status,404);
        assert.equal((await request(route+'/history',token)).status,404);
        assert.equal((await request(route,token,'PUT',{onboarding:{...data,client_id:foreign.id},expectedVersion:4})).status,404);
        assert.equal((await request('/api/client-onboardings',token)).data.some(r=>r.id===persisted.id),false);
      }
    } finally {const exited=once(child,'exit');child.kill();await exited;}
  });
} finally {
  if(pg)await driver.pool.end();else driver.sqlite.close();
  fs.rmSync(dir,{recursive:true,force:true});
}
