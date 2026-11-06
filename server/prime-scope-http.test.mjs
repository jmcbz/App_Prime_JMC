import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'app-prime-role-http-'));
const socket=net.createServer();
await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
const port=socket.address().port;
await new Promise(resolve=>socket.close(resolve));
const env={...process.env,PORT:String(port),SQLITE_PATH:path.join(dir,'role.sqlite'),APP_PRIME_ALLOW_NEW_DATABASE:'1',
  JWT_SECRET:'fixture-only-role-http',MFA_ENCRYPTION_KEY:'fixture-only-mfa',SEED_ADMIN_EMAIL:'fixture@example.invalid',
  SEED_ADMIN_PASSWORD:'dummy-fixture-password',NODE_ENV:'development'};
delete env.DATABASE_URL;
process.env.SQLITE_PATH=env.SQLITE_PATH;
process.env.APP_PRIME_ALLOW_NEW_DATABASE='1';
process.env.JWT_SECRET=env.JWT_SECRET;
delete process.env.DATABASE_URL;
const child=spawn(process.execPath,['server/index.js'],{cwd:process.cwd(),env,stdio:'ignore'});
const base=`http://127.0.0.1:${port}`;
async function ready(){for(let i=0;i<150;i++){try{const r=await fetch(`${base}/api/health`);if(r.ok)return;}catch{} await new Promise(r=>setTimeout(r,100));}throw new Error('Serveur fixture non disponible');}
async function call(method,route,token,body){
  const r=await fetch(`${base}${route}`,{method,headers:{Authorization:`Bearer ${token}`, 'Content-Type':'application/json'},
    body:body===undefined?undefined:JSON.stringify(body)});
  const text=await r.text();
  let data;try{data=JSON.parse(text)}catch{data={error:'Réponse non JSON'}}
  return {status:r.status,data};
}
async function issue(db,auth,user){await db.upsertMfaPending(user.id,'fixture-mfa-'+user.id);
  return auth.issueSessionToken(user,await db.enableMfa(user.id));}

test('les routes authentifiées isolent les usagers standards sans limiter les administrateurs',async()=>{
  try {
    await ready();
    const db=await import('./database/index.js');const auth=await import('./auth.js');await db.initDb();
    const admin=await db.getUserByEmail('fixture@example.invalid');const adminToken=await issue(db,auth,admin);
    const original=await call('GET','/api/primes',adminToken);assert.equal(original.status,200);
    const create=async(email,prenom)=>{
      const r=await call('POST','/api/admin/users',adminToken,{email,prenom,nom:'Test',password:'dummy-pass-123',role:'prime'});
      assert.equal(r.status,201);assert.equal(r.data.prime.nom,`${prenom} Test`);return r.data;
    };
    const a=await create('aline@example.invalid','Aline');const b=await create('bruno@example.invalid','Bruno');
    const users=await call('GET','/api/admin/users',adminToken);
    assert.equal(users.status,200);
    assert.equal(users.data.users.find(u=>u.id===a.user.id).primeNom,'Aline Test');
    const linkedDelete=await call('DELETE',`/api/primes/${a.prime.id}`,adminToken);
    assert.equal(linkedDelete.status,409);
    const ac=await call('POST','/api/clients',adminToken,{nom:'A privé',primeId:a.prime.id,statut:'actif'});
    const bc=await call('POST','/api/clients',adminToken,{nom:'B privé',primeId:b.prime.id,statut:'actif'});
    assert.equal(ac.status,201);assert.equal(bc.status,201);
    const as=await db.createSuivi({titre:'Suivi A',primeId:a.prime.id,clientId:ac.data.client.id});
    const bs=await db.createSuivi({titre:'Suivi B',primeId:b.prime.id,clientId:bc.data.client.id});
    const aToken=await issue(db,auth,await db.getUserById(a.user.id));
    const bToken=await issue(db,auth,await db.getUserById(b.user.id));
    for(const [token,primeId,clientId,suiviId] of [[aToken,a.prime.id,ac.data.client.id,as.id],[bToken,b.prime.id,bc.data.client.id,bs.id]]){
      const pp=await call('GET','/api/primes',token),cc=await call('GET','/api/clients',token),ss=await call('GET','/api/suivis',token);
      assert.equal(pp.status,200);assert.equal(cc.status,200);assert.equal(ss.status,200);
      assert.deepEqual(pp.data.primes.map(x=>x.id),[primeId]);
      assert.deepEqual(cc.data.clients.map(x=>x.id),[clientId]);
      assert.deepEqual(ss.data.suivis.map(x=>x.id),[suiviId]);
      assert.equal((await call('POST','/api/clients',token,{nom:'Intrus'})).status,403);
      assert.equal((await call('GET','/api/admin/users',token)).status,403);
    }
    assert.equal((await call('GET','/api/primes',adminToken)).data.primes.length,original.data.primes.length+2);
    assert.equal((await call('GET','/api/clients',adminToken)).data.clients.length>=2,true);
    const legacy=await db.createUser({email:'old@example.invalid',passwordHash:'dummy',prenom:'Ancien',nom:'Compte',role:'prime'});
    const existingPrime=await db.createPrime({nom:'Prime déjà existant',codeTitan:'',specialites:[],disponibilite:'disponible'});
    const existingClient=await db.createClient({nom:'Portefeuille ancien',primeId:existingPrime.id,statut:'actif'});
    const existingSuivi=await db.createSuivi({titre:'Dossier ancien',primeId:existingPrime.id,clientId:existingClient.id});
    const legacyToken=await issue(db,auth,legacy);
    assert.deepEqual((await call('GET','/api/primes',legacyToken)).data.primes,[]);
    assert.equal((await call('POST',`/api/admin/users/${legacy.id}/prime`,legacyToken,{primeId:existingPrime.id})).status,403);
    const linked=await call('POST',`/api/admin/users/${legacy.id}/prime`,adminToken,{primeId:existingPrime.id});
    assert.equal(linked.status,200);
    assert.equal(linked.data.prime.nom,'Prime déjà existant');
    assert.deepEqual((await call('GET','/api/primes',legacyToken)).data.primes.map(x=>x.id),[existingPrime.id]);
    assert.deepEqual((await call('GET','/api/clients',legacyToken)).data.clients.map(x=>x.id),[existingClient.id]);
    assert.deepEqual((await call('GET','/api/suivis',legacyToken)).data.suivis.map(x=>x.id),[existingSuivi.id]);
    assert.equal((await call('POST',`/api/admin/users/${legacy.id}/prime`,adminToken,{primeId:existingPrime.id})).status,409);
    const transfer=await call('PUT',`/api/clients/${ac.data.client.id}`,adminToken,{
      client:{nom:'A privé',primeId:b.prime.id,statut:'actif'},
      expected:{primeId:a.prime.id,servoClientId:null},
    });
    assert.equal(transfer.status,200);
    assert.equal((await call('GET','/api/clients',aToken)).data.clients.some(x=>x.id===ac.data.client.id),false);
    assert.equal((await call('GET','/api/suivis',aToken)).data.suivis.some(x=>x.id===as.id),false);
    assert.equal((await call('GET','/api/clients',bToken)).data.clients.some(x=>x.id===ac.data.client.id),true);
    assert.equal((await call('GET','/api/suivis',bToken)).data.suivis.some(x=>x.id===as.id),true);
  } finally {child.kill();await new Promise(resolve=>child.once('exit',resolve));fs.rmSync(dir,{recursive:true,force:true});}
});
