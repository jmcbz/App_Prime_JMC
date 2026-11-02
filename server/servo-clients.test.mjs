import test from 'node:test';
import assert from 'node:assert/strict';
import { loadActiveServoClients } from './servo-clients.js';

const env = { PRISME_MASTER_API_BASE: 'https://example.invalid', OAUTH_CLIENT_ID: 'id', OAUTH_CLIENT_SECRET: 'secret' };

test('Servo: lit uniquement les clients actifs par OAuth, sans exposer le jeton', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    if (url.endsWith('/auth/token')) return { ok: true, json: async () => ({ access_token: 'test-token' }) };
    return { ok: true, json: async () => ({ data: [
      { id: 23, name: ' Bêta ', alias: '', active: 1 },
      { id: 10, name: 'Alpha', alias: 'A', active: 1 },
      { id: 55, name: 'Inactif', active: 0 },
      { id: 23, name: 'Bêta', active: 1 },
    ] }) };
  };
  const clients = await loadActiveServoClients({ env, fetchImpl });
  assert.deepEqual(clients, [{ id: 10, nom: 'Alpha', alias: 'A' }, { id: 23, nom: 'Bêta', alias: '' }]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[1].opts.headers.Authorization, 'Bearer test-token');
});

test('Servo: refuse une configuration absente ou une réponse incomplète sans liste trompeuse', async () => {
  await assert.rejects(loadActiveServoClients({ env: {}, fetchImpl: async () => {} }), /configuration/i);
  await assert.rejects(loadActiveServoClients({ env, fetchImpl: async (url) => url.endsWith('/auth/token')
    ? { ok: true, json: async () => ({ access_token: 'x' }) }
    : { ok: true, json: async () => ({ data: null }) } }), /réponse/i);
});
