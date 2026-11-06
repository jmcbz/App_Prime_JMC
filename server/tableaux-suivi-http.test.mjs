import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';

const keys = ['plan_directeur','projets','rencontre','comite_ti','backups','routeur','serveur_sur_place','vm_bz','ia_agentique'];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-prime-boards-'));
const dbPath = path.join(dir, 'boards.sqlite');
const socket = net.createServer();
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const env = { ...process.env, PORT: String(port), SQLITE_PATH: dbPath, APP_PRIME_ALLOW_NEW_DATABASE: '1',
  JWT_SECRET: 'fixture-boards-secret', MFA_ENCRYPTION_KEY: 'fixture-boards-mfa',
  SEED_ADMIN_EMAIL: 'boards-admin@example.invalid', SEED_ADMIN_PASSWORD: 'fixture-only-password', NODE_ENV: 'development' };
delete env.DATABASE_URL;
process.env.SQLITE_PATH = dbPath;
process.env.APP_PRIME_ALLOW_NEW_DATABASE = '1';
process.env.JWT_SECRET = env.JWT_SECRET;
delete process.env.DATABASE_URL;
let child;
const base = `http://127.0.0.1:${port}`;
async function start() {
  child = spawn(process.execPath, ['server/index.js'], { cwd: process.cwd(), env, stdio: 'inherit' });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) return; } catch {}
    if (child.exitCode !== null) throw new Error(`Server exited ${child.exitCode}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Server not ready');
}
async function stop() { if (child && child.exitCode === null) { child.kill(); await new Promise(resolve => child.once('exit', resolve)); } }
async function call(method, route, token, body) {
  const r = await fetch(base + route, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, data: await r.json() };
}
async function issue(db, auth, user) {
  await db.upsertMfaPending(user.id, `fixture-${user.id}`);
  return auth.issueSessionToken(user, await db.enableMfa(user.id));
}
function blank(board, clientId) {
  assert.equal(board.clientId, clientId);
  assert.equal(board.archivedAt, null);
  assert.ok(board.id > 0);
  assert.ok(board.createdAt);
  assert.deepEqual(board.rubriques.map(r => r.key), keys);
  for (const rubrique of board.rubriques) assert.deepEqual(rubrique, {
    key: rubrique.key, statut: 'a_faire', date: null, note: '', prochaineAction: '', version: null,
  });
}

test('boards: bootstrap, authorization, replacement, immutable history, transfer and restart', async () => {
  try {
    await start();
    const db = await import('./database/index.js');
    const auth = await import('./auth.js');
    await db.initDb();
    const { default: Sqlite } = await import('better-sqlite3');
    const raw = new Sqlite(dbPath);
    raw.exec("CREATE TRIGGER reject_board BEFORE INSERT ON tableaux_suivi WHEN NEW.client_id > 0 BEGIN SELECT RAISE(ABORT, 'board insert rejected'); END");
    const before = (await db.listClients()).length;
    await assert.rejects(db.createClient({nom:'Rollback required'}));
    assert.equal((await db.listClients()).length, before);
    raw.exec('DROP TRIGGER reject_board');
    raw.close();
    const adminToken = await issue(db, auth, await db.getUserByEmail(env.SEED_ADMIN_EMAIL));
    const initialClients = (await call('GET', '/api/clients', adminToken)).data.clients;
    const legacySuivis = (await call('GET', '/api/suivis', adminToken)).data.suivis;
    const legacyId = legacySuivis[0].id;
    assert.equal((await call('POST','/api/suivis',adminToken,{titre:'Ne doit pas être créé'})).status,410);
    assert.equal((await call('PUT',`/api/suivis/${legacyId}`,adminToken,{titre:'Ne doit pas changer'})).status,410);
    assert.equal((await call('DELETE',`/api/suivis/${legacyId}`,adminToken)).status,410);
    assert.deepEqual((await call('GET','/api/suivis',adminToken)).data.suivis,legacySuivis);
    assert.ok(initialClients.length > 0);
    const initial = await call('GET', '/api/tableaux-suivi', adminToken);
    assert.equal(initial.status, 200);
    assert.deepEqual(initial.data.tableaux.map(t => t.clientId).sort((a,b) => a-b), initialClients.map(c => c.id).sort((a,b) => a-b));
    for (const board of initial.data.tableaux) blank(board, board.clientId);
    assert.equal((await call('GET', '/api/tableaux-suivi')).status, 401);

    const a = await db.createUserWithPrime({ email:'board-a@example.invalid', passwordHash:'dummy', prenom:'Board', nom:'A', role:'prime' });
    const b = await db.createUserWithPrime({ email:'board-b@example.invalid', passwordHash:'dummy', prenom:'Board', nom:'B', role:'prime' });
    const aToken = await issue(db, auth, a.user);
    const bToken = await issue(db, auth, b.user);
    const c = await call('POST', '/api/clients', adminToken, { nom:'Board client', primeId:a.prime.id });
    assert.equal(c.status, 201);
    const clientId = c.data.client.id;
    const createdBoard = (await call('GET','/api/tableaux-suivi',aToken)).data.tableaux.find(t => t.clientId === clientId);
    blank(createdBoard, clientId);
    await db.updatePrimePortfolio(a.prime.id, { nom: a.prime.nom }, {
      add: [{ id: 987654, nom: 'Servo board', alias: '' }], remove: [],
    });
    const servoClient = (await call('GET','/api/clients',aToken)).data.clients.find(x=>x.servoClientId===987654);
    assert.ok(servoClient);
    const servoBoard = (await call('GET','/api/tableaux-suivi',aToken)).data.tableaux.find(t=>t.clientId===servoClient.id);
    blank(servoBoard, servoClient.id);
    assert.equal((await call('GET','/api/tableaux-suivi',bToken)).data.tableaux.some(t => t.clientId === clientId), false);
    assert.equal((await call('POST','/api/tableaux-suivi',bToken,{clientId,expectedActiveId:createdBoard.id,primeId:b.prime.id})).status,404);
    assert.equal((await call('PUT',`/api/tableaux-suivi/${createdBoard.id}/rubriques/routeur`,bToken,
      {statut:'termine',date:null,note:'intrusion',prochaineAction:'',version:null})).status,404);
    assert.equal((await call('POST','/api/tableaux-suivi',aToken,{clientId:999999,expectedActiveId:null})).status,404);
    assert.equal((await call('POST','/api/tableaux-suivi',aToken,{clientId:'1'})).status,400);
    assert.equal((await call('PUT',`/api/tableaux-suivi/${createdBoard.id}/rubriques/absente`,aToken,
      {statut:'termine',date:null,note:'',prochaineAction:'',version:null})).status,400);
    assert.equal((await call('PUT',`/api/tableaux-suivi/${createdBoard.id}/rubriques/routeur`,aToken,
      {statut:'invalid',date:null,note:'',prochaineAction:'',version:null})).status,400);
    const payload = { statut:'en_cours', date:'2026-11-06', note:'Routeur vérifié', prochaineAction:'Suivi prévu', version:'7.4' };
    const changed = await call('PUT',`/api/tableaux-suivi/${createdBoard.id}/rubriques/routeur`,aToken,payload);
    assert.equal(changed.status,200);
    assert.deepEqual(changed.data.tableau.rubriques.find(r=>r.key==='routeur'),{key:'routeur',...payload});
    assert.deepEqual((await call('GET','/api/suivis',adminToken)).data.suivis, legacySuivis);
    assert.equal((await call('POST','/api/tableaux-suivi',aToken,{clientId,expectedActiveId:999999})).status,409);
    assert.equal((await call('GET','/api/tableaux-suivi',aToken)).data.tableaux.filter(t=>t.clientId===clientId).length,1);
    const replacements = await Promise.all([1,2].map(()=>call('POST','/api/tableaux-suivi',aToken,{clientId,expectedActiveId:createdBoard.id})));
    assert.deepEqual(replacements.map(r=>r.status).sort(),[201,409]);
    blank(replacements.find(r=>r.status===201).data.tableau,clientId);
    const second = await call('POST','/api/tableaux-suivi',aToken,{clientId,expectedActiveId:replacements.find(r=>r.status===201).data.tableau.id});
    assert.equal(second.status,201);
    blank(second.data.tableau,clientId);
    const history = (await call('GET','/api/tableaux-suivi',aToken)).data.tableaux.filter(t=>t.clientId===clientId);
    assert.equal((await call('DELETE',`/api/clients/${clientId}`,adminToken)).status,409);
    assert.equal((await call('GET','/api/tableaux-suivi',adminToken)).data.tableaux.filter(t=>t.clientId===clientId).length,3);
    assert.equal((await call('GET','/api/clients',adminToken)).data.clients.some(c=>c.id===clientId),true);
    assert.deepEqual((await call('GET','/api/suivis',adminToken)).data.suivis,legacySuivis);
    assert.equal(history.length,3);
    assert.equal(history.filter(t=>t.archivedAt===null).length,1);
    assert.equal(history.find(t=>t.id===createdBoard.id).rubriques.find(r=>r.key==='routeur').note,payload.note);
    assert.ok(history.find(t=>t.id===createdBoard.id).archivedAt);
    assert.equal((await call('PUT',`/api/tableaux-suivi/${createdBoard.id}/rubriques/routeur`,aToken,payload)).status,409);
    const current=history.find(t=>t.archivedAt===null);
    assert.equal((await call('PUT',`/api/tableaux-suivi/${current.id}/rubriques/projets`,aToken,{...payload,version:'invalid'})).status,400);
    const transfer=await call('PUT',`/api/clients/${clientId}`,adminToken,{
      client:{nom:'Board client',primeId:b.prime.id},expected:{primeId:a.prime.id,servoClientId:null} });
    assert.equal(transfer.status,200);
    assert.equal((await call('GET','/api/tableaux-suivi',aToken)).data.tableaux.some(t=>t.clientId===clientId),false);
    assert.equal((await call('GET','/api/tableaux-suivi',bToken)).data.tableaux.filter(t=>t.clientId===clientId).length,3);
    assert.equal((await call('PUT',`/api/tableaux-suivi/${current.id}/rubriques/routeur`,aToken,payload)).status,404);
    assert.equal((await call('PUT',`/api/tableaux-suivi/${current.id}/rubriques/routeur`,bToken,payload)).status,200);
    await stop();
    await start();
    const after=(await call('GET','/api/tableaux-suivi',adminToken)).data.tableaux.filter(t=>t.clientId===clientId);
    assert.equal(after.length,3);
    assert.equal(after.filter(t=>t.archivedAt===null).length,1);
    assert.equal(after.find(t=>t.id===current.id).rubriques.find(r=>r.key==='routeur').version,'7.4');
  } finally { await stop(); fs.rmSync(dir,{recursive:true,force:true}); }
});
