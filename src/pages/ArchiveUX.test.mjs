import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { unlink } from 'node:fs/promises';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

const outfile = new URL('./.archive-ux-test-bundle.mjs', import.meta.url).pathname;
let pages;
try {
  await build({ stdin: { contents: `export { default as Suivis } from './Suivis.tsx'; export { default as Clients } from './Clients.tsx'; export { default as Dashboard } from './Dashboard.tsx'; export { AuthProvider } from '../context/AuthContext.tsx';`, resolveDir: new URL('.', import.meta.url).pathname, loader: 'ts' }, outfile,
    bundle: true, format: 'esm', platform: 'node', packages: 'external', jsx: 'automatic' });
  pages = await import(outfile);
} finally { await unlink(outfile).catch(() => {}); }

const client = { id: 2, nom: 'Client Alpha', secteur: 'Public', primeId: 7, statut: 'actif' };
const prime = { id: 7, nom: 'Prime Alpha', codeTitan: 'PA', disponibilite: 'disponible', clientsIds: [2] };
const old = { id: 3, clientId: 2, createdAt: '2026-01-01T00:00:00Z', archivedAt: null,
  rubriques: [{ key: 'projets', statut: 'bloque', date: null, note: 'Ancienne note', prochaineAction: null, version: null }] };
const created = { id: 4, clientId: 2, createdAt: '2026-04-08T10:00:00Z', archivedAt: null, rubriques: [] };

async function mount(PageComponent, fetcher) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost' });
  const previous = { window: globalThis.window, document: globalThis.document, navigator: globalThis.navigator, fetch: globalThis.fetch, IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT };
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true; globalThis.fetch = fetcher;
  const root = createRoot(dom.window.document.getElementById('root'));
  await act(async () => { root.render(React.createElement(pages.AuthProvider, null, React.createElement(PageComponent))); });
  const click = async (button) => { assert.ok(button, 'bouton attendu'); await act(async () => { button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); }); };
  const button = (label) => [...dom.window.document.querySelectorAll('button')].find(b => b.textContent.includes(label));
  const cleanup = async () => { await act(async () => root.unmount()); dom.window.close(); globalThis.window = previous.window; globalThis.document = previous.document; Object.defineProperty(globalThis, 'navigator', { configurable: true, value: previous.navigator }); globalThis.fetch = previous.fetch; globalThis.IS_REACT_ACT_ENVIRONMENT = previous.IS_REACT_ACT_ENVIRONMENT; };
  return { dom, click, button, cleanup };
}
const common = (url) => {
  if (url === '/api/auth/me') return Response.json({ user: { id: 1, email: 'admin@example.test', role: 'admin' } });
  if (url === '/api/primes') return Response.json({ primes: [prime] });
  if (url === '/api/clients') return Response.json({ clients: [client] });
  if (url === '/api/suivis') return Response.json({ suivis: [{ id: 99, clientId: 2, primeId: 7, titre: 'Vieille tâche', statut: 'bloque', echeance: null }] });
  throw new Error(`Route inattendue ${url}`);
};

test('POST réussi puis rafraîchissement échoué garde le nouveau tableau actif, archive l’ancien et permet de réessayer la synchronisation', async () => {
  let gets = 0; let posts = 0;
  const ui = await mount(pages.Suivis, (url, options = {}) => {
    if (url === '/api/tableaux-suivi' && options.method === 'POST') { posts++; return Response.json({ tableau: created }); }
    if (url === '/api/tableaux-suivi') { gets++; return gets === 1 ? Response.json({ tableaux: [old] }) : gets === 2 ? Promise.reject(new Error('Réseau indisponible')) : Response.json({ tableaux: [{ ...old, archivedAt: created.createdAt }, created] }); }
    return common(url);
  });
  try {
    await ui.click(ui.button('Nouveau tableau'));
    await ui.click(ui.button('Créer et archiver'));
    assert.equal(posts, 1);
    assert.ok(!ui.dom.window.document.querySelector('[role="dialog"]'), 'la confirmation doit se fermer');
    assert.match(ui.dom.window.document.body.textContent, /Créé le 2026-04-08/);
    assert.match(ui.dom.window.document.body.textContent, /Historique des tableaux \(1\)/);
    assert.ok(!ui.button('Nouveau tableau').disabled);
    assert.ok(ui.button('Réessayer la synchronisation'));
    assert.match(ui.dom.window.document.querySelector('[role="alert"]').textContent, /Nouveau tableau créé/);
    await ui.click(ui.button('Historique des tableaux'));
    const history = ui.dom.window.document.querySelector('section.mt-6');
    assert.match(history.textContent, /Ancienne note/);
    assert.equal(history.querySelectorAll('input, textarea, select, button[type="submit"]').length, 0);
    await ui.click(ui.button('Réessayer la synchronisation'));
    assert.equal(gets, 3);
    assert.equal(ui.button('Réessayer la synchronisation'), undefined);
    assert.equal(posts, 1);
  } finally { await ui.cleanup(); }
});

test('réponse POST perdue : aucune seconde création avant réconciliation avec le serveur', async () => {
  let gets = 0; let posts = 0;
  const ui = await mount(pages.Suivis, (url, options = {}) => {
    if (url === '/api/tableaux-suivi' && options.method === 'POST') {
      posts++;
      assert.deepEqual(JSON.parse(options.body), { clientId: 2, expectedActiveId: old.id });
      return Promise.reject(new Error('Connexion perdue'));
    }
    if (url === '/api/tableaux-suivi') {
      gets++;
      return Response.json({ tableaux: gets === 1 ? [old] : [{ ...old, archivedAt: created.createdAt }, created] });
    }
    return common(url);
  });
  try {
    await ui.click(ui.button('Nouveau tableau'));
    await ui.click(ui.button('Créer et archiver'));
    assert.equal(posts, 1);
    assert.ok(!ui.dom.window.document.querySelector('[role="dialog"]'));
    assert.ok(ui.button('Nouveau tableau').disabled);
    assert.match(ui.dom.window.document.querySelector('[role="alert"]').textContent, /incertain/);
    await ui.click(ui.button('Réessayer la synchronisation'));
    assert.equal(gets, 2);
    assert.equal(posts, 1);
    assert.match(ui.dom.window.document.body.textContent, /Créé le 2026-04-08/);
    assert.ok(!ui.button('Nouveau tableau').disabled);
  } finally { await ui.cleanup(); }
});

test('un échec du chargement initial empêche une création qui archiverait un tableau invisible', async () => {
  let gets = 0;
  const ui = await mount(pages.Suivis, (url, options = {}) => {
    if (url === '/api/tableaux-suivi' && options.method !== 'POST') {
      gets++;
      return gets === 1 ? Promise.reject(new Error('Réseau indisponible')) : Response.json({ tableaux: [old] });
    }
    return common(url);
  });
  try {
    assert.ok(ui.button('Nouveau tableau').disabled);
    await ui.click(ui.button('Réessayer la synchronisation'));
    assert.equal(gets, 2);
    assert.ok(!ui.button('Nouveau tableau').disabled);
  } finally { await ui.cleanup(); }
});

test('la liste des clients conserve la modification sans proposer une suppression destructrice', async () => {
  const ui = await mount(pages.Clients, (url) => common(url));
  try {
    assert.ok(ui.dom.window.document.querySelector('button[title="Modifier"]'));
    assert.ok(!ui.dom.window.document.querySelector('button[title="Supprimer"]'));
  } finally { await ui.cleanup(); }
});
