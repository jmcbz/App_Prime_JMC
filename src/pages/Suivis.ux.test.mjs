import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { unlink } from 'node:fs/promises';

const outfile = new URL('./.suivis-page-ux-test.mjs', import.meta.url).pathname;
let pages;
try {
  await build({ stdin: { contents: "export { default as Suivis } from './Suivis.tsx'; export { AuthProvider } from '../context/AuthContext.tsx';", resolveDir: new URL('.', import.meta.url).pathname, loader: 'ts' }, outfile,
    bundle: true, format: 'esm', platform: 'node', packages: 'external', jsx: 'automatic' });
  pages = await import(outfile);
} finally { await unlink(outfile).catch(() => {}); }

const clients = [
  { id: 2, nom: 'Client Alpha', primeId: 7, statut: 'actif' },
  { id: 3, nom: 'Client Bêta', primeId: 8, statut: 'actif' },
];
const primes = [
  { id: 7, nom: 'Prime Alpha', codeTitan: 'PA', clientsIds: [2] },
  { id: 8, nom: 'Prime Bêta', codeTitan: 'PB', clientsIds: [3] },
];
const tableaux = clients.map((client, index) => ({ id: 20 + index, clientId: client.id, createdAt: '2026-01-01', archivedAt: null,
  rubriques: [{ key: 'projets', statut: 'en_cours', date: null, note: '', prochaineAction: `Action ${client.nom}`, prochaineActionEcheance: '2020-01-01', version: null }] }));

test('le résumé suit le client et le filtre Prime sans exposer les actions des autres clients', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost' });
  const previous = { window: globalThis.window, document: globalThis.document, navigator: globalThis.navigator, fetch: globalThis.fetch, IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT };
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = async url => {
    if (url === '/api/auth/me') return Response.json({ user: { id: 1, email: 'admin@example.test', prenom: 'Admin', nom: 'Test', role: 'admin', is_active: true } });
    if (url === '/api/clients') return Response.json({ clients });
    if (url === '/api/primes') return Response.json({ primes });
    if (url === '/api/suivis') return Response.json({ suivis: [] });
    if (url === '/api/tableaux-suivi') return Response.json({ tableaux });
    throw new Error(`Unexpected ${url}`);
  };
  const root = createRoot(dom.window.document.getElementById('root'));
  try {
    await act(async () => root.render(React.createElement(pages.AuthProvider, null, React.createElement(pages.Suivis))));
    const summary = () => dom.window.document.querySelector('[aria-label="Résumé du tableau courant"]');
    assert.match(summary().textContent, /Action Client Alpha/);
    assert.doesNotMatch(summary().textContent, /Action Client Bêta/);
    const select = dom.window.document.querySelector('select[aria-label="Client"]');
    await act(async () => { select.value = '3'; Simulate.change(select, { target: { value: '3' } }); });
    assert.match(summary().textContent, /Action Client Bêta/);
    assert.doesNotMatch(summary().textContent, /Action Client Alpha/);
    const filter = dom.window.document.querySelector('select[aria-label="Filtrer par Prime"]');
    await act(async () => { filter.value = '7'; Simulate.change(filter, { target: { value: '7' } }); });
    assert.match(summary().textContent, /Action Client Alpha/);
    assert.doesNotMatch(summary().textContent, /Action Client Bêta/);
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    globalThis.window = previous.window; globalThis.document = previous.document;
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: previous.navigator });
    globalThis.fetch = previous.fetch; globalThis.IS_REACT_ACT_ENVIRONMENT = previous.IS_REACT_ACT_ENVIRONMENT;
  }
});
