import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-prime-portfolio-test-'));
process.env.SQLITE_PATH = path.join(dir, 'prime.sqlite');
process.env.APP_PRIME_ALLOW_NEW_DATABASE = '1';
delete process.env.DATABASE_URL;
const db = await import('./database/index.js');
await db.initDb();
const primeInput = (nom) => ({ nom, codeTitan:'', specialites:[], disponibilite:'disponible', avatarInitiales:'' });

test('une sauvegarde du Prime ne retire pas une association créée après ouverture', async () => {
  await db.initDb();
  const p = await db.createPrime(primeInput('A'));
  const first = await db.createClient({nom:'Historique',primeId:p.id,secteur:'',statut:'actif'});
  await db.updatePrimePortfolio(p.id, primeInput('B'), { add:[{id:51,nom:'Nouveau',alias:''}], remove:[] });
  await db.updatePrimePortfolio(p.id, primeInput('C'), { add:[], remove:[] });
  const assigned = (await db.listClients()).filter(c=>c.primeId===p.id);
  assert.deepEqual(assigned.map(c=>c.id).sort((a,b)=>a-b), [first.id,first.id+1]);
  assert.equal((await db.listPrimes()).find(x=>x.id===p.id).nom,'C');
});

test('deux sauvegardes concurrentes ne créent jamais deux liens pour le même ID Servo', async () => {
  const p1 = await db.createPrime(primeInput('P1'));
  const p2 = await db.createPrime(primeInput('P2'));
  const results = await Promise.allSettled([
    db.updatePrimePortfolio(p1.id, primeInput('P1 modifié'), { add:[{id:77,nom:'Unique',alias:''}], remove:[] }),
    db.updatePrimePortfolio(p2.id, primeInput('P2 modifié'), { add:[{id:77,nom:'Unique',alias:''}], remove:[] }),
  ]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.filter(r=>r.status==='rejected').length,1);
  assert.equal((await db.listClients()).filter(c=>c.servoClientId===77).length,1);
  const failed = results[0].status==='rejected' ? p1 : p2;
  assert.equal((await db.listPrimes()).find(p=>p.id===failed.id).nom,failed.nom,'échec = rollback du Prime');
});

test('un nom identique ne lie jamais silencieusement un client local à un ID Servo', async () => {
  const p = await db.createPrime(primeInput('Nom ambigu'));
  const legacy = await db.createClient({ nom:'ACME', primeId:null, secteur:'Historique', statut:'actif' });
  await db.updatePrimePortfolio(p.id, primeInput('Nom ambigu'), {
    add:[{id:99,nom:'ACME',alias:''}], remove:[], catalog:[{id:99,nom:'ACME',alias:''}],
  });
  const clients = (await db.listClients()).filter(c=>c.nom==='ACME');
  assert.equal(clients.length,2);
  assert.equal(clients.find(c=>c.id===legacy.id).servoClientId,null);
  assert.equal(clients.find(c=>c.id===legacy.id).primeId,null);
  assert.equal(clients.find(c=>c.servoClientId===99).primeId,p.id);
});

test('édition client périmée ne rétablit pas une association retirée explicitement', async () => {
  const p = await db.createPrime(primeInput('Retrait concurrent'));
  const c = await db.createClient({nom:'Client concurrent',primeId:p.id,secteur:'',statut:'actif'});
  await db.updatePrimePortfolio(p.id, primeInput('Retrait concurrent'), {add:[],remove:[c.id]});
  await assert.rejects(db.updateClient(c.id, {nom:'Nouveau nom',primeId:p.id,secteur:'',statut:'actif'},
    {primeId:p.id,servoClientId:null}), e=>e.statusCode===409);
  const after = (await db.listClients()).find(x=>x.id===c.id);
  assert.equal(after.primeId,null);
});

test('édition client périmée ne défait pas une attribution Servo concurrente', async () => {
  const p = await db.createPrime(primeInput('Lien concurrent'));
  const c = await db.createClient({nom:'Client concurrent 2',primeId:null,servoClientId:42,secteur:'',statut:'actif'});
  await db.updatePrimePortfolio(p.id, primeInput('Lien concurrent'), {add:[{id:42,nom:'Client concurrent 2',alias:''}],remove:[]});
  await assert.rejects(db.updateClient(c.id, {nom:'Nouveau nom',primeId:null,secteur:'',statut:'actif'},
    {primeId:null,servoClientId:42}), e=>e.statusCode===409);
  const after = (await db.listClients()).find(x=>x.id===c.id);
  assert.equal(after.primeId,p.id);
  assert.equal(after.servoClientId,42);
});

test('le retrait explicite ne touche que son client; un retrait obsolète annule toute la transaction', async () => {
  const p1 = await db.createPrime(primeInput('Retrait'));
  const p2 = await db.createPrime(primeInput('Autre'));
  const c1 = await db.createClient({nom:'A',primeId:p1.id,secteur:'',statut:'actif'});
  const c2 = await db.createClient({nom:'B',primeId:p1.id,secteur:'',statut:'actif'});
  const other = await db.createClient({nom:'C',primeId:p2.id,secteur:'',statut:'actif'});
  await db.updatePrimePortfolio(p1.id, primeInput('Retrait OK'), { add:[], remove:[c1.id] });
  assert.equal((await db.listClients()).find(c=>c.id===c1.id).primeId,null);
  assert.equal((await db.listClients()).find(c=>c.id===c2.id).primeId,p1.id);
  await assert.rejects(db.updatePrimePortfolio(p1.id, primeInput('Ne doit pas persister'), { add:[],remove:[other.id] }),
    (error) => error.statusCode === 409 && /Association modifiée/.test(error.message));
  assert.equal((await db.listPrimes()).find(p=>p.id===p1.id).nom,'Retrait OK');
  assert.equal((await db.listClients()).find(c=>c.id===other.id).primeId,p2.id);
  fs.rmSync(dir,{recursive:true,force:true});
});
