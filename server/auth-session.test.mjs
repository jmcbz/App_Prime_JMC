import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'app-prime-session-test-'));
process.env.SQLITE_PATH=path.join(dir,'auth.sqlite');
process.env.APP_PRIME_ALLOW_NEW_DATABASE='1';
process.env.JWT_SECRET='disposable-auth-test-secret';
delete process.env.DATABASE_URL;
const db=await import('./database/index.js');
const auth=await import('./auth.js');
const mfa=await import('./mfa-service.js');
await db.initDb();
async function enroll(user, secret='disposable-ciphertext-1') {
  await db.upsertMfaPending(user.id,secret);
  return db.enableMfa(user.id);
}
async function check(token) {
  const req={headers:{authorization:`Bearer ${token}`},cookies:{}};
  let status=200, body=null, reached=false;
  const res={status(code){status=code;return this;},json(data){body=data;return this;}};
  await auth.requireAuth(req,res,()=>{reached=true;});
  if (reached) auth.requireAdmin(req,res,()=>{});
  return {status,body};
}
test('les jetons de défi MFA ne sont jamais des sessions administrateur', async () => {
  const admin=await db.createUser({email:'mfa@example.invalid',passwordHash:'x',role:'admin'});
  assert.equal((await check(mfa.issueMfaToken(admin,'mfa_setup'))).status,401);
  assert.equal((await check(mfa.issueMfaToken(admin,'mfa_login'))).status,401);
});

test('un ancien JWT non typé ne peut pas contourner la distinction session/MFA', async () => {
  const admin=await db.createUser({email:'legacy@example.invalid',passwordHash:'x',role:'admin'});
  const token=jwt.sign({sub:admin.id,email:admin.email,role:'admin'},process.env.JWT_SECRET,{expiresIn:'12h'});
  assert.equal((await check(token)).status,401);
});

test('réinitialiser le MFA révoque la session et une nouvelle inscription ne la restaure pas', async () => {
  const admin=await db.createUser({email:'reset@example.invalid',passwordHash:'x',role:'admin'});
  const firstMfa=await enroll(admin);
  const token=auth.issueSessionToken(admin,firstMfa);
  assert.equal((await check(token)).status,200);
  await db.resetMfa(admin.id);
  assert.equal((await check(token)).status,401);
  await enroll(admin,'disposable-ciphertext-2');
  assert.equal((await check(token)).status,401);
});

test('la rétrogradation admin révoque immédiatement un ancien jeton administrateur', async () => {
  const admin=await db.createUser({email:'admin@example.invalid',passwordHash:'x',role:'admin'});
  const token=auth.issueSessionToken(admin,await enroll(admin));
  assert.equal((await check(token)).status,200);
  await db.updateUserRole(admin.id,'prime');
  assert.equal((await check(token)).status,403);
  await db.setUserActive(admin.id,false);
  assert.equal((await check(token)).status,401);
  fs.rmSync(dir,{recursive:true,force:true});
});
