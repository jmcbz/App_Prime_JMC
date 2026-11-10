import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import jwt from 'jsonwebtoken';

const root = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'suivi-complements-'));
const env = { ...process.env, SQLITE_PATH:path.join(root,'legacy.sqlite'), APP_PRIME_ALLOW_NEW_DATABASE:'1',
  JWT_SECRET:'fixture-suivi-only', MFA_ENCRYPTION_KEY:'fixture-mfa-only', SEED_ADMIN_EMAIL:'fixture@example.invalid',
  SEED_ADMIN_PASSWORD:'fixture-password', NODE_ENV:'test' };
delete env.DATABASE_URL;
Object.assign(process.env, { SQLITE_PATH:env.SQLITE_PATH, APP_PRIME_ALLOW_NEW_DATABASE:'1', JWT_SECRET:env.JWT_SECRET });
delete process.env.DATABASE_URL;
const db = await import('./database/index.js');
const auth = await import('./auth.js');
const driver = await db.initDb();
const portProbe = net.createServer();
await new Promise(resolve=>portProbe.listen(0,'127.0.0.1',resolve));
const port = portProbe.address().port;
await new Promise(resolve=>portProbe.close(resolve));
let child;
async function start() {
  child = spawn(process.execPath,['server/index.js'],{cwd:process.cwd(),env:{...env,PORT:String(port)},stdio:'pipe'});
  let error='';child.stderr.on('data',chunk=>error+=chunk);
  for(let i=0;i<100;i++) {
    try { if((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return; } catch {}
    if(child.exitCode!==null) throw new Error(`server exited ${child.exitCode}: ${error}`);
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error(`server unavailable: ${error}`);
}
async function stop() {if(child?.exitCode===null) {const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;}}
async function call(method,route,token,body) {
  const r=await fetch(`http://127.0.0.1:${port}${route}`,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const text=await r.text();let data;try{data=JSON.parse(text);}catch{data={raw:text.slice(0,100)};}
  return {status:r.status,data};
}
async function token(user) {await db.upsertMfaPending(user.id,`fixture-${user.id}`);return auth.issueSessionToken(user,await db.enableMfa(user.id));}

test('append-only complements preserve legacy bytes, scope by current client and close permanently',async()=>{
  try {
    const admin=await db.createUser({email:'admin@example.invalid',passwordHash:'dummy',prenom:'Admin',nom:'One',role:'admin'});
    const a=await db.createUserWithPrime({email:'a@example.invalid',passwordHash:'dummy',prenom:'A',nom:'One'});
    const b=await db.createUserWithPrime({email:'b@example.invalid',passwordHash:'dummy',prenom:'B',nom:'Two'});
    const client=await db.createClient({nom:'Hôtel Château Laurier Québec',primeId:a.prime.id});
    const legacy=await db.createSuivi({titre:'Poste en trouble a remplacer (Lenovo)',clientId:client.id,primeId:a.prime.id,statut:'en_cours',echeance:'2026-11-20',note:'original'});
    const original=driver.sqlite.prepare('SELECT * FROM suivis WHERE id=?').get(legacy.id);
    const [at,bt,rootToken]=await Promise.all([token(a.user),token(b.user),token(admin)]);
    driver.sqlite.exec('DROP TABLE suivi_complements'); // populated pre-feature database, preserved legacy rows
    await start();
    assert.equal(driver.sqlite.prepare("SELECT COUNT(*) AS n FROM suivi_complements").get().n,0);
    const route=`/api/suivis/${legacy.id}/complements`;
    assert.equal((await call('POST',route,null,{statut:'bloque',echeance:null,note:'Attente',expectedLastId:null})).status,401);
    assert.equal((await call('GET',route,bt)).status,404);
    assert.equal((await call('POST',route,bt,{statut:'bloque',echeance:null,note:'Attente',expectedLastId:null})).status,404);
    const before=(await call('GET','/api/suivis',at)).data.suivis.find(s=>s.id===legacy.id);
    assert.equal(before.initialStatut,'en_cours');
    assert.equal(before.initialEcheance,'2026-11-20');
    assert.equal(before.dernierComplementId,null);
    for(const bad of ['2026-02-29','2026-04-31','2026-1-01','']) assert.equal((await call('POST',route,at,{statut:'bloque',echeance:bad,note:'',expectedLastId:null})).status,400);
    for(const body of [null,[],{statut:'other',echeance:null,note:'',expectedLastId:null},
      {statut:'bloque',echeance:null,note:'',expectedLastId:0},
      {statut:'bloque',echeance:null,note:'x'.repeat(10001),expectedLastId:null},
      {statut:'bloque',echeance:null,note:'missing expected'}])
      assert.equal((await call('POST',route,at,body)).status,400);
    assert.equal((await call('POST',route,at,{statut:'en_cours',echeance:'2026-11-20',note:'',expectedLastId:null})).status,400);
    const first=await call('POST',route,at,{statut:'bloque',echeance:null,note:'Pièce à commander',expectedLastId:null});
    assert.equal(first.status,201,JSON.stringify(first.data));
    assert.match(first.data.complement.createdAt,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/);
    assert.equal(first.data.suivi.statut,'bloque');
    assert.equal(first.data.suivi.echeance,null);
    assert.equal(first.data.suivi.note,'original');
    assert.equal(first.data.suivi.dernierComplementId,first.data.complement.id);
    assert.equal((await call('POST',route,at,{statut:'termine',echeance:null,note:'doublon',expectedLastId:null})).status,409);
    assert.deepEqual(driver.sqlite.prepare('SELECT * FROM suivis WHERE id=?').get(legacy.id),original);
    const history=await call('GET',route,at);
    assert.equal(history.status,200);assert.equal(history.data.complements.length,1);
    assert.equal(history.data.complements[0].note,'Pièce à commander');
    assert.equal(history.data.hasMore,false);assert.equal(history.data.nextBefore,null);
    assert.equal((await call('GET',`${route}?before=0`,at)).status,400);
    const transfer=await call('PUT',`/api/clients/${client.id}`,rootToken,{client:{nom:'Hôtel Château Laurier Québec',primeId:b.prime.id,statut:'actif'},expected:{primeId:a.prime.id,servoClientId:null}});
    assert.equal(transfer.status,200,JSON.stringify(transfer.data));
    assert.equal((await call('POST',route,at,{statut:'termine',echeance:null,note:'',expectedLastId:first.data.complement.id})).status,404);
    const closed=await call('POST',route,bt,{statut:'termine',echeance:null,note:'Remplacé',expectedLastId:first.data.complement.id});
    assert.equal(closed.status,201,JSON.stringify(closed.data));
    assert.equal((await call('POST',route,bt,{statut:'termine',echeance:null,note:'Encore',expectedLastId:closed.data.complement.id})).status,409);
    assert.deepEqual(driver.sqlite.prepare('SELECT * FROM suivis WHERE id=?').get(legacy.id),original);
    assert.equal((await call('POST',`/api/suivis`,rootToken,{titre:'new'})).status,410);
    assert.equal((await call('PUT',`/api/suivis/${legacy.id}`,rootToken,{titre:'new'})).status,410);
    assert.equal((await call('DELETE',`/api/suivis/${legacy.id}`,rootToken)).status,410);
    await stop();await start();
    assert.equal((await call('GET','/api/suivis',bt)).data.suivis.find(s=>s.id===legacy.id).statut,'termine');
    assert.equal((await call('GET',route,rootToken)).data.complements.length,2);
    const clientless=await db.createSuivi({titre:'Sans client',primeId:a.prime.id,statut:'a_faire'});
    const ownRoute=`/api/suivis/${clientless.id}/complements`;
    assert.equal((await call('GET',ownRoute,at)).status,200);
    assert.equal((await call('GET',ownRoute,bt)).status,404);
    const races=await Promise.all([call('POST',ownRoute,at,{statut:'en_cours',echeance:null,note:'A',expectedLastId:null}),
      call('POST',ownRoute,at,{statut:'bloque',echeance:null,note:'B',expectedLastId:null})]);
    assert.deepEqual(races.map(r=>r.status).sort(),[201,409]);
    let cursor=races.find(r=>r.status===201).data.complement.id;
    for(let i=0;i<51;i++) {
      const event=await call('POST',ownRoute,at,{statut:'en_cours',echeance:null,note:`note ${i}`,expectedLastId:cursor});
      assert.equal(event.status,201,JSON.stringify(event.data));cursor=event.data.complement.id;
    }
    const page1=(await call('GET',ownRoute,at)).data;
    assert.equal(page1.complements.length,50);assert.equal(page1.hasMore,true);
    assert.equal(page1.nextBefore,page1.complements[49].id);
    const page2=(await call('GET',`${ownRoute}?before=${page1.nextBefore}`,at)).data;
    assert.equal(page2.complements.length,2);assert.equal(page2.hasMore,false);assert.equal(page2.nextBefore,null);
    assert(page2.complements[0].id<page1.complements[49].id);
    const done=await db.createSuivi({titre:'Déjà fermé',primeId:a.prime.id,statut:'termine'});
    assert.equal((await call('POST',`/api/suivis/${done.id}/complements`,at,{statut:'en_cours',echeance:null,note:'Réouvrir',expectedLastId:null})).status,409);
    for(const invalid of ['01','1x','-1','9007199254740992']) assert.equal((await call('GET',`/api/suivis/${invalid}/complements`,at)).status,400);
    assert.equal((await call('GET',`${ownRoute}?before=1&before=2`,at)).status,400);
  } finally {await stop();}
});

test('complement endpoints reject disabled, MFA-reset, and non-session tokens without appending',async()=>{
  const admin=await db.createUser({email:'session-admin@example.invalid',passwordHash:'dummy',prenom:'Session',nom:'Admin',role:'admin'});
  const owner=await db.createUserWithPrime({email:'session-owner@example.invalid',passwordHash:'dummy',prenom:'Session',nom:'Owner'});
  const suivi=await db.createSuivi({titre:'Session guard',primeId:owner.prime.id,statut:'a_faire'});
  const route=`/api/suivis/${suivi.id}/complements`;
  const body={statut:'bloque',echeance:null,note:'must not persist',expectedLastId:null};
  const ownerToken=await token(owner.user);
  const adminToken=await token(admin);
  try {
    await start();
    for(const badToken of [
      jwt.sign({sub:owner.user.id,role:'prime',purpose:'mfa_login'},env.JWT_SECRET),
      jwt.sign({sub:owner.user.id,role:'prime',purpose:'mfa_setup'},env.JWT_SECRET),
      jwt.sign({sub:owner.user.id,role:'prime'},env.JWT_SECRET),
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
    assert.equal(driver.sqlite.prepare('SELECT COUNT(*) AS n FROM suivi_complements WHERE suivi_id=?').get(suivi.id).n,0);
  } finally {await stop();}
});

test('simultaneous SQLite transfer and append serialize without a stale-owner write',async()=>{
  const admin=await db.createUser({email:'race-admin@example.invalid',passwordHash:'dummy',prenom:'Race',nom:'Admin',role:'admin'});
  const a=await db.createUserWithPrime({email:'race-a@example.invalid',passwordHash:'dummy',prenom:'Race',nom:'A'});
  const b=await db.createUserWithPrime({email:'race-b@example.invalid',passwordHash:'dummy',prenom:'Race',nom:'B'});
  const client=await db.createClient({nom:'Race client',primeId:a.prime.id});
  const suivi=await db.createSuivi({titre:'Race suivi',clientId:client.id,primeId:a.prime.id,statut:'a_faire'});
  const [adminToken,ownerToken,nextToken]=await Promise.all([token(admin),token(a.user),token(b.user)]);
  const route=`/api/suivis/${suivi.id}/complements`;
  try {
    await start();
    const [transfer,append]=await Promise.all([
      call('PUT',`/api/clients/${client.id}`,adminToken,{client:{nom:'Race client',primeId:b.prime.id,statut:'actif'},expected:{primeId:a.prime.id,servoClientId:null}}),
      call('POST',route,ownerToken,{statut:'bloque',echeance:null,note:'overlap',expectedLastId:null}),
    ]);
    assert.equal(transfer.status,200,JSON.stringify(transfer.data));
    assert([201,404].includes(append.status),JSON.stringify(append));
    const rows=driver.sqlite.prepare('SELECT author_id FROM suivi_complements WHERE suivi_id=?').all(suivi.id);
    assert.equal(rows.length,append.status===201?1:0);
    if(rows.length) assert.equal(rows[0].author_id,a.user.id);
    assert.equal((await call('GET',route,ownerToken)).status,404);
    assert.equal((await call('GET',route,nextToken)).status,200);
  } finally {await stop();}
});

test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
