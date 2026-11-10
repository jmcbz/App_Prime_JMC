import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { unlink } from 'node:fs/promises';

const outfile = new URL('./.suivi-complements-test.mjs', import.meta.url).pathname;
let service;
try {
  await build({ entryPoints: [new URL('./suiviComplementsService.ts', import.meta.url).pathname], outfile,
    bundle: true, platform: 'node', format: 'esm', packages: 'external' });
  service = await import(outfile);
} finally { await unlink(outfile).catch(() => {}); }

test('lit la première page puis une page antérieure des compléments', async () => {
  const previous = globalThis.fetch;
  const paths = [];
  globalThis.fetch = async (path, options) => {
    paths.push([path, options]);
    return Response.json({ complements: [], hasMore: false, nextBefore: null });
  };
  try {
    assert.deepEqual(await service.fetchSuiviComplements(12), { complements: [], hasMore: false, nextBefore: null });
    await service.fetchSuiviComplements(12, 48);
    assert.deepEqual(paths.map(([path]) => path), ['/api/suivis/12/complements', '/api/suivis/12/complements?before=48']);
    assert.ok(paths.every(([, opts]) => opts.credentials === 'include'));
  } finally { globalThis.fetch = previous; }
});

test('poste exactement le complément avec garde optimiste et signale le conflit', async () => {
  const previous = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (path, options) => {
    calls.push([path, options]);
    return Response.json({ error: 'Conflit de version' }, { status: 409 });
  };
  try {
    await assert.rejects(service.appendSuiviComplement(12, { statut: 'termine', echeance: null, note: 'Clos', expectedLastId: 48 }), /Conflit de version/);
    assert.equal(calls[0][0], '/api/suivis/12/complements');
    assert.equal(calls[0][1].method, 'POST');
    assert.equal(calls[0][1].credentials, 'include');
    assert.deepEqual(JSON.parse(calls[0][1].body), { statut: 'termine', echeance: null, note: 'Clos', expectedLastId: 48 });
  } finally { globalThis.fetch = previous; }
});
