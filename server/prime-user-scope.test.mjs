import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'app-prime-user-scope-'));
process.env.SQLITE_PATH=path.join(dir,'app.sqlite');
process.env.APP_PRIME_ALLOW_NEW_DATABASE='1';
delete process.env.DATABASE_URL;
const db=await import('./database/index.js');
const driver=await db.initDb();

test('créer un usager standard crée atomiquement son Prime personnel et sa liaison',async()=>{
  const created=await db.createUserWithPrime({email:'aline@example.invalid',passwordHash:'dummy',prenom:'Aline',nom:'Roy',role:'prime'});
  assert.equal(created.user.role,'prime');
  assert.equal(created.prime.nom,'Aline Roy');
  assert.equal((await db.getPrimeForUser(created.user.id))?.id,created.prime.id);
  assert.equal((await db.listPrimes()).length,1);
});

test('un échec de création ne laisse aucun Prime orphelin',async()=>{
  const before=(await db.listPrimes()).length;
  await assert.rejects(db.createUserWithPrime({email:'aline@example.invalid',passwordHash:'dummy',prenom:'Doublon',nom:'Roy',role:'prime'}));
  assert.equal((await db.listPrimes()).length,before);
});

test('un Prime standard ne lit que son profil, ses clients et leurs suivis',async()=>{
  const aline=await db.getUserByEmail('aline@example.invalid');
  const own=await db.getPrimeForUser(aline.id);
  const other=await db.createUserWithPrime({email:'bruno@example.invalid',passwordHash:'dummy',prenom:'Bruno',nom:'Test',role:'prime'});
  const ownClient=await db.createClient({nom:'Client A',primeId:own.id,statut:'actif'});
  const foreignClient=await db.createClient({nom:'Client B',primeId:other.prime.id,statut:'actif'});
  const ownSuivi=await db.createSuivi({titre:'Suivi A',primeId:own.id,clientId:ownClient.id});
  const foreignSuivi=await db.createSuivi({titre:'Suivi B',primeId:other.prime.id,clientId:foreignClient.id});
  const mismatched=await db.createSuivi({titre:'Suivi ancien mal aligné',primeId:own.id,clientId:foreignClient.id});
  assert.deepEqual((await db.listPrimesForUser(aline.id)).map(p=>p.id),[own.id]);
  assert.deepEqual((await db.listClientsForUser(aline.id)).map(c=>c.id),[ownClient.id]);
  assert.deepEqual((await db.listSuivisForUser(aline.id)).map(s=>s.id),[ownSuivi.id]);
  assert.deepEqual((await db.listSuivisForUser(other.user.id)).map(s=>[s.id,s.primeId]),[[foreignSuivi.id,other.prime.id],[mismatched.id,other.prime.id]]);
  const unlinked=await db.createUser({email:'legacy@example.invalid',passwordHash:'dummy',role:'prime'});
  assert.deepEqual(await db.listPrimesForUser(unlinked.id),[]);
  assert.deepEqual(await db.listClientsForUser(unlinked.id),[]);
  assert.deepEqual(await db.listSuivisForUser(unlinked.id),[]);
  assert.equal((await db.listPrimes()).length,2);
  assert.equal((await db.listClients()).length,2);
  assert.equal((await db.listSuivis()).length,3);
});

test('transférer un client conserve les anciennes tâches intactes sans les exposer à l’ancien Prime',async()=>{
  const a=await db.getPrimeForUser((await db.getUserByEmail('aline@example.invalid')).id);
  const b=await db.getPrimeForUser((await db.getUserByEmail('bruno@example.invalid')).id);
  const client=await db.createClient({nom:'Client transféré',primeId:a.id,statut:'actif'});
  const suivi=await db.createSuivi({titre:'Suivi transféré',primeId:a.id,clientId:client.id});
  const before=driver.sqlite.prepare('SELECT * FROM suivis WHERE id = ?').get(suivi.id);
  await db.updateClient(client.id,{nom:'Client transféré',primeId:b.id,statut:'actif'}, {primeId:a.id,servoClientId:null});
  assert.deepEqual(driver.sqlite.prepare('SELECT * FROM suivis WHERE id = ?').get(suivi.id),before);
  assert.equal((await db.listSuivisForUser((await db.getUserByEmail('aline@example.invalid')).id)).some(s=>s.id===suivi.id),false);
  assert.equal((await db.listSuivisForUser((await db.getUserByEmail('bruno@example.invalid')).id)).some(s=>s.id===suivi.id),true);
});

test('retirer puis réattribuer un client par portefeuille garde ses anciennes tâches identiques',async()=>{
  const a=await db.getPrimeForUser((await db.getUserByEmail('aline@example.invalid')).id);
  const b=await db.getPrimeForUser((await db.getUserByEmail('bruno@example.invalid')).id);
  const client=await db.createClient({nom:'Client Servo transféré',primeId:b.id,servoClientId:11001,statut:'actif'});
  const suivi=await db.createSuivi({titre:'Suivi portefeuille',primeId:b.id,clientId:client.id});
  const before=driver.sqlite.prepare('SELECT * FROM suivis WHERE id = ?').get(suivi.id);
  const profile=(nom)=>({nom,codeTitan:'',specialites:[],disponibilite:'disponible',avatarInitiales:''});
  await db.updatePrimePortfolio(b.id,profile(b.nom),{add:[],remove:[client.id]});
  assert.deepEqual(driver.sqlite.prepare('SELECT * FROM suivis WHERE id = ?').get(suivi.id),before);
  await db.updatePrimePortfolio(a.id,profile(a.nom),{add:[{id:11001,nom:client.nom,alias:''}],remove:[]});
  assert.deepEqual(driver.sqlite.prepare('SELECT * FROM suivis WHERE id = ?').get(suivi.id),before);
  assert.equal((await db.listSuivisForUser((await db.getUserByEmail('aline@example.invalid')).id)).some(s=>s.id===suivi.id),true);
});

test('un compte existant peut être explicitement lié à un Prime et retrouve son portefeuille',async()=>{
  const legacy=await db.getUserByEmail('legacy@example.invalid');
  const prime=await db.createPrime({nom:'Prime historique',codeTitan:'',specialites:[],disponibilite:'disponible'});
  const client=await db.createClient({nom:'Client historique',primeId:prime.id,statut:'actif'});
  const suivi=await db.createSuivi({titre:'Suivi historique',primeId:prime.id,clientId:client.id});
  assert.deepEqual(await db.listPrimesForUser(legacy.id),[]);
  assert.equal((await db.linkExistingUserToPrime(legacy.id,prime.id)).id,prime.id);
  assert.deepEqual((await db.listPrimesForUser(legacy.id)).map(x=>x.id),[prime.id]);
  assert.deepEqual((await db.listClientsForUser(legacy.id)).map(x=>x.id),[client.id]);
  assert.deepEqual((await db.listSuivisForUser(legacy.id)).map(x=>x.id),[suivi.id]);
  assert.equal((await db.listUsers()).find(x=>x.id===legacy.id).primeId,prime.id);
  const other=await db.createUser({email:'legacy2@example.invalid',passwordHash:'dummy',role:'prime'});
  await assert.rejects(db.linkExistingUserToPrime(other.id,prime.id),e=>e.statusCode===409);
  await assert.rejects(db.linkExistingUserToPrime(legacy.id,prime.id),e=>e.statusCode===409);
  assert.deepEqual(await db.listPrimesForUser(other.id),[]);
});

test('supprimer un Prime avec des anciens suivis sans client est refusé et conserve leur attribution',async()=>{
  const prime=await db.createPrime({nom:'Prime ancien',codeTitan:'',specialites:[],disponibilite:'disponible'});
  const suivi=await db.createSuivi({titre:'Tâche sans client',primeId:prime.id,clientId:null});
  const before=driver.sqlite.prepare('SELECT * FROM suivis WHERE id = ?').get(suivi.id);
  await assert.rejects(db.deletePrime(prime.id),error=>error.statusCode===409);
  assert.deepEqual(driver.sqlite.prepare('SELECT * FROM suivis WHERE id = ?').get(suivi.id),before);
  assert.ok((await db.listPrimes()).some(p=>p.id===prime.id));
});

test('créer un administrateur lui crée également son Prime sans limiter son rôle',async()=>{
  const created=await db.createUserWithPrime({email:'admin2@example.invalid',passwordHash:'dummy',prenom:'Admin',nom:'Test',role:'admin'});
  assert.equal(created.user.role,'admin');
  assert.equal((await db.getPrimeForUser(created.user.id))?.id,created.prime.id);
  fs.rmSync(dir,{recursive:true,force:true});
});
