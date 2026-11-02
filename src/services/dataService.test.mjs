import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchServoClients } from './dataService.ts';
import { updatePrimePortfolio, updateClient } from './metierAdminService.ts';

test('une seule requête sauvegarde le Prime et ses changements explicites de clients', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, opts) => {
      assert.equal(url, '/api/primes/7/portfolio');
      assert.equal(opts.method, 'PUT');
      assert.deepEqual(JSON.parse(opts.body), { prime: { nom: 'Prime A' }, addServoIds: [10, 20], removeClientIds: [3] });
      return new Response(JSON.stringify({ prime: { id: 7, nom: 'Prime A' }, clients: [] }), { status: 200 });
    };
    await updatePrimePortfolio(7, { nom: 'Prime A' }, [10, 20], [3]);
  } finally { globalThis.fetch = original; }
});

test('une édition client transmet l’association observée à l’ouverture', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, opts) => {
      assert.equal(url, '/api/clients/4');
      assert.deepEqual(JSON.parse(opts.body), {
        client: { nom:'Client A', primeId:null }, expected: {primeId:1,servoClientId:42},
      });
      return new Response(JSON.stringify({client:{id:4,nom:'Client A',primeId:null}}), {status:200});
    };
    await updateClient(4,{nom:'Client A',primeId:null},{primeId:1,servoClientId:42});
  } finally { globalThis.fetch = original; }
});

test('le navigateur lit la liste via l’API App Prime sans recevoir le jeton OAuth', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, opts) => {
      assert.equal(url, '/api/servo/clients');
      assert.equal(opts.credentials, 'include');
      return new Response(JSON.stringify({ clients: [{ id: 2, nom: 'Test', alias: '' }] }), { status: 200 });
    };
    assert.deepEqual(await fetchServoClients(), [{ id: 2, nom: 'Test', alias: '' }]);
  } finally { globalThis.fetch = original; }
});
