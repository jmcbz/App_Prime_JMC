import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { loadConfigFromFile } from 'vite';

test('Vite proxy retains browser Host for same-origin cookie writes', async () => {
  const loaded = await loadConfigFromFile({ command: 'serve', mode: 'development' }, 'vite.config.ts');
  assert.equal(loaded.config.server.proxy['/api'].changeOrigin, false);
});

async function freePort() {
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prime-csrf-http-'));
for (const configured of [false, true]) {
  test(`cookie writes reject sibling origin and allow trusted origins (FRONTEND_URL ${configured ? 'set' : 'unset'})`, async () => {
    const port = await freePort();
    const host = `api.example.test:${port}`;
    const sameOrigin = `http://${host}`;
    const sibling = `http://evil.example.test:${port}`;
    const frontend = 'http://frontend.example.test:5190';
    const env = { ...process.env, PORT: String(port), SQLITE_PATH: path.join(dir, 'fixture.sqlite'),
      APP_PRIME_ALLOW_NEW_DATABASE: '1', JWT_SECRET: 'fixture-only-csrf-secret',
      SEED_ADMIN_EMAIL: 'fixture@example.invalid', SEED_ADMIN_PASSWORD: 'fixture-password', NODE_ENV: 'development' };
    delete env.DATABASE_URL;
    if (configured) env.FRONTEND_URL = frontend;
    else delete env.FRONTEND_URL;
    const child = spawn(process.execPath, ['server/index.js'], { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    child.stdout.on('data', data => { log += data; });
    child.stderr.on('data', data => { log += data; });
    const base = `http://127.0.0.1:${port}`;
    const request = (method, route, origin, cookie, body, extra = {}) => new Promise((resolve, reject) => {
      const payload = body ? JSON.stringify(body) : undefined;
      const headers = { Host: host, ...(origin === undefined ? {} : { Origin: origin }),
        ...(cookie ? { Cookie: `app_prime_session=${cookie}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}), ...extra };
      const req = http.request({ hostname: '127.0.0.1', port, path: route, method, headers }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve(new Response(res.statusCode === 204 ? null : Buffer.concat(chunks), { status: res.statusCode, headers: res.headers })));
      });
      req.on('error', reject);
      req.end(payload);
    });
    try {
      let ready = false;
      for (let i = 0; i < 100; i++) {
        if (child.exitCode !== null) break;
        try { if ((await fetch(base + '/api/health')).ok) { ready = true; break; } } catch {}
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert(ready, log);
      // Issue a real MFA-backed session accepted by requireAuth, then present it as a browser cookie.
      const oldEnv = { SQLITE_PATH: process.env.SQLITE_PATH, APP_PRIME_ALLOW_NEW_DATABASE: process.env.APP_PRIME_ALLOW_NEW_DATABASE,
        JWT_SECRET: process.env.JWT_SECRET, DATABASE_URL: process.env.DATABASE_URL };
      Object.assign(process.env, { SQLITE_PATH: env.SQLITE_PATH, APP_PRIME_ALLOW_NEW_DATABASE: '1', JWT_SECRET: env.JWT_SECRET });
      delete process.env.DATABASE_URL;
      let token;
      try {
        const db = await import('./database/index.js');
        const auth = await import('./auth.js');
        await db.initDb();
        const user = await db.getUserByEmail(env.SEED_ADMIN_EMAIL);
        const mfa = await db.getMfaByUserId(user.id);
        if (!mfa?.mfa_enabled) {
          await db.upsertMfaPending(user.id, 'fixture-mfa');
          token = auth.issueSessionToken(user, await db.enableMfa(user.id));
        } else token = auth.issueSessionToken(user, mfa);
      } finally {
        for (const [key, value] of Object.entries(oldEnv)) {
          if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
      }
      const post = origin => request('POST', '/api/primes', origin, token, { nom: `origin-${origin}` });
      const rejectedPost = await post(sibling);
      assert.equal(rejectedPost.status, 403, 'sibling POST must not reach authenticated write');
      assert.equal(rejectedPost.headers.get('access-control-allow-origin'), null);
      for (const untrusted of ['null', `http://api.example.test:${port + 1}`, `https://${host}`]) {
        const response = await post(untrusted);
        assert.equal(response.status, 403, `must reject ${untrusted}`);
        assert.equal(response.headers.get('access-control-allow-origin'), null);
      }
      const allowedPost = await post(sameOrigin);
      assert.equal(allowedPost.status, 201);
      assert.equal(allowedPost.headers.get('access-control-allow-origin'), sameOrigin);
      const id = (await allowedPost.json()).prime.id;
      const rejectedPut = await request('PUT', `/api/primes/${id}`, sibling, token, { nom: 'attacker changed it' });
      assert.equal(rejectedPut.status, 403, 'sibling PUT must not reach authenticated write');
      const allowedPut = await request('PUT', `/api/primes/${id}`, sameOrigin, token, { nom: 'owner updated it' });
      assert.equal(allowedPut.status, 200);
      const actual = await request('GET', '/api/primes', undefined, token);
      assert.equal((await actual.json()).primes.find(prime => prime.id === id).nom, 'owner updated it');
      const clientResponse = await request('POST', '/api/clients', sameOrigin, token,
        { nom: 'CSRF fixture', clientType: 'ti' });
      assert.equal(clientResponse.status, 201);
      const clientId = (await clientResponse.json()).client.id;
      const onboarding = { client_id: clientId, technicien_id: null, titre: 'Initial', statut: 'À faire', priorite: 'Moyenne' };
      const createBody = { onboarding, items: [], requestKey: randomUUID() };
      assert.equal((await request('POST', '/api/client-onboardings', sibling, token, createBody)).status, 403);
      const created = await request('POST', '/api/client-onboardings', sameOrigin, token, createBody);
      assert.equal(created.status, 201);
      const onboardingId = (await created.json()).id;
      const updateBody = { onboarding: { ...onboarding, titre: 'Legitimate update' }, items: [], expectedVersion: 1 };
      assert.equal((await request('PUT', `/api/client-onboardings/${onboardingId}`, sibling, token, updateBody)).status, 403);
      assert.equal((await request('PUT', `/api/client-onboardings/${onboardingId}`, sameOrigin, token, updateBody)).status, 200);
      const detail = await request('GET', `/api/client-onboardings/${onboardingId}`, undefined, token);
      assert.equal((await detail.json()).titre, 'Legitimate update');
      const preflight = await request('OPTIONS', '/api/primes', sibling, null, null,
        { 'Access-Control-Request-Method': 'POST' });
      assert.equal(preflight.headers.get('access-control-allow-origin'), null);
      const read = await request('GET', '/api/health', sibling);
      assert.equal(read.headers.get('access-control-allow-origin'), null);
      const curl = await post(undefined);
      assert.equal(curl.status, 201, 'non-browser cookie HTTP harness without Origin stays usable');
      const tlsProxy = await request('POST', '/api/primes', `https://${host}`, token,
        { nom: 'trusted reverse proxy' }, { 'X-Forwarded-Proto': 'https' });
      assert.equal(tlsProxy.status, 201);
      const proxySibling = await request('PUT', `/api/primes/${id}`, `https://evil.example.test:${port}`, token,
        { nom: 'proxy attacker' }, { 'X-Forwarded-Proto': 'https' });
      assert.equal(proxySibling.status, 403);
      if (configured) {
        const cross = await post(frontend);
        assert.equal(cross.status, 201);
        assert.equal(cross.headers.get('access-control-allow-origin'), frontend);
        const crossPut = await request('PUT', `/api/primes/${id}`, frontend, token, { nom: 'trusted frontend update' });
        assert.equal(crossPut.status, 200);
        const trustedPreflight = await request('OPTIONS', '/api/primes', frontend, null, null,
          { 'Access-Control-Request-Method': 'POST' });
        assert.equal(trustedPreflight.headers.get('access-control-allow-origin'), frontend);
      }
    } finally {
      child.kill();
      if (child.exitCode === null) await new Promise(resolve => child.once('exit', resolve));
      if (configured) fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
