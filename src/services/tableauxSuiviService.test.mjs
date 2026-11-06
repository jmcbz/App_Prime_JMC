import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchTableauxSuivi, createTableauSuivi, updateRubriqueSuivi } from './tableauxSuiviService.ts';

test('charge les tableaux par API authentifiée', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, opts) => {
      assert.equal(url, '/api/tableaux-suivi');
      assert.equal(opts.credentials, 'include');
      return Response.json({ tableaux: [{ id: 8, clientId: 2, archivedAt: null, rubriques: [] }] });
    };
    assert.equal((await fetchTableauxSuivi())[0].id, 8);
  } finally { globalThis.fetch = original; }
});

test('crée un tableau pour le client choisi et retourne le tableau du serveur', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, opts) => {
      assert.equal(url, '/api/tableaux-suivi');
      assert.equal(opts.method, 'POST');
      assert.equal(opts.credentials, 'include');
      assert.deepEqual(JSON.parse(opts.body), { clientId: 2, expectedActiveId: 8 });
      return Response.json({ tableau: { id: 10, clientId: 2, rubriques: [] } });
    };
    assert.equal((await createTableauSuivi(2, 8)).id, 10);
  } finally { globalThis.fetch = original; }
});

test('sauvegarde une rubrique avec ses champs explicites sans perdre les valeurs vides', async () => {
  const original = globalThis.fetch;
  const rubrique = { statut: 'bloque', date: null, note: '', prochaineAction: '', version: '1.2' };
  try {
    globalThis.fetch = async (url, opts) => {
      assert.equal(url, '/api/tableaux-suivi/10/rubriques/routeur');
      assert.equal(opts.method, 'PUT');
      assert.equal(opts.credentials, 'include');
      assert.deepEqual(JSON.parse(opts.body), rubrique);
      return Response.json({ tableau: { id: 10, clientId: 2, rubriques: [{ key: 'routeur', ...rubrique }] } });
    };
    assert.equal((await updateRubriqueSuivi(10, 'routeur', rubrique)).rubriques[0].version, '1.2');
  } finally { globalThis.fetch = original; }
});

test('une erreur HTTP reste visible à l’utilisateur', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ error: 'Accès refusé' }, { status: 403 });
    await assert.rejects(createTableauSuivi(2), /Accès refusé/);
  } finally { globalThis.fetch = original; }
});
