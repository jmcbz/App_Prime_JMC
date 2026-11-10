import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { unlink } from 'node:fs/promises';

const outfile = new URL('./.suivis-complements-ux.mjs', import.meta.url).pathname;
let pages;
try {
  await build({ stdin: { contents: "export { default as Suivis } from './Suivis.tsx'; export { AuthProvider, useAuth } from '../context/AuthContext.tsx';", resolveDir: new URL('.', import.meta.url).pathname, loader: 'ts' }, outfile,
    bundle: true, format: 'esm', platform: 'node', packages: 'external', jsx: 'automatic' });
  pages = await import(outfile);
} finally { await unlink(outfile).catch(() => {}); }

const initial = { id: 91, clientId: 2, primeId: 7, titre: 'Poste en trouble a remplacer (Lenovo)', statut: 'en_cours', initialStatut: 'en_cours', echeance: '2026-11-20', initialEcheance: '2026-11-20', note: 'Diagnostic initial', dernierComplementId: null };
const clients = [{ id: 2, nom: 'Hôtel Château Laurier Québec', primeId: 7, statut: 'actif' }, { id: 3, nom: 'Autre client', primeId: 7, statut: 'actif' }];
const complement = { id: 5, statut: 'en_cours', echeance: '2026-11-22', note: 'Pièce commandée', createdAt: '2026-11-10T15:30:00Z' };
async function mount(fetcher) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost' });
  const previous = { window: globalThis.window, document: globalThis.document, navigator: globalThis.navigator, fetch: globalThis.fetch, IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT };
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (url, options = {}) => {
    if (url === '/api/auth/me') return Response.json({ user: { id: 1, email: 'admin@example.test', prenom: 'Admin', nom: 'Test', role: 'admin', is_active: true } });
    if (url === '/api/primes') return Response.json({ primes: [{ id: 7, nom: 'Prime Alpha', codeTitan: 'PA' }] });
    if (url === '/api/clients') return Response.json({ clients });
    if (url === '/api/tableaux-suivi') return Response.json({ tableaux: [] });
    return fetcher(url, options);
  };
  let setUser;
  const Probe = () => { setUser = pages.useAuth().setUser; return React.createElement(pages.Suivis); };
  const root = createRoot(dom.window.document.getElementById('root'));
  await act(async () => root.render(React.createElement(pages.AuthProvider, null, React.createElement(Probe))));
  const button = label => [...dom.window.document.querySelectorAll('button')].find(b => b.textContent.includes(label));
  const click = async b => { assert.ok(b); await act(async () => b.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))); };
  const change = async (selector, value) => { const el = dom.window.document.querySelector(selector); assert.ok(el, selector); await act(async () => { el.value = value; Simulate.change(el, { target: { value } }); }); };
  const cleanup = async () => { await act(async () => root.unmount()); dom.window.close(); globalThis.window = previous.window; globalThis.document = previous.document; Object.defineProperty(globalThis, 'navigator', { configurable: true, value: previous.navigator }); globalThis.fetch = previous.fetch; globalThis.IS_REACT_ACT_ENVIRONMENT = previous.IS_REACT_ACT_ENVIRONMENT; };
  return { dom, button, click, change, cleanup, switchUser: async id => act(async () => setUser({ id, email: `user${id}@example.test`, prenom: 'User', nom: 'Test', role: 'admin', is_active: true })) };
}

test('ajoute une note datée, conserve l’original, pagine et confirme la clôture irréversible', async () => {
  let current = initial; const posts = []; const pagesRequested = [];
  const ui = await mount((url, options) => {
    if (url === '/api/suivis') return Response.json({ suivis: [current] });
    if (url.startsWith('/api/suivis/91/complements') && options.method === 'POST') {
      posts.push(JSON.parse(options.body));
      const updated = posts.length === 1 ? complement : { ...complement, id: 6, statut: 'termine', echeance: null, note: 'Remplacé' };
      current = { ...current, statut: updated.statut, echeance: updated.echeance, dernierComplementId: updated.id };
      return Response.json({ suivi: current, complement: updated }, { status: 201 });
    }
    if (url.startsWith('/api/suivis/91/complements')) { pagesRequested.push(url); return Response.json(url.includes('before=') ? { complements: [{ ...complement, id: 1, note: 'Ancienne étape' }], hasMore: false, nextBefore: null } : { complements: [complement], hasMore: true, nextBefore: 5 }); }
    throw Error(`Unexpected ${url}`);
  });
  try {
    await ui.click(ui.button('Compléter le suivi'));
    assert.match(ui.dom.window.document.body.textContent, /Diagnostic initial/);
    assert.match(ui.dom.window.document.body.textContent, /Statut initial/);
    assert.match(ui.dom.window.document.body.textContent, /Pièce commandée/);
    await ui.click(ui.button('Afficher les compléments précédents'));
    assert.deepEqual(pagesRequested, ['/api/suivis/91/complements', '/api/suivis/91/complements?before=5']);
    assert.match(ui.dom.window.document.body.textContent, /Ancienne étape/);
    await ui.change('textarea[aria-label="Nouvelle note"]', 'Pièce commandée');
    await ui.change('input[aria-label="Nouvelle échéance"]', '2026-11-22');
    await ui.click(ui.button('Enregistrer le complément'));
    assert.deepEqual(posts[0], { statut: 'en_cours', echeance: '2026-11-22', note: 'Pièce commandée', expectedLastId: null });
    assert.match(ui.dom.window.document.body.textContent, /Échéance initiale : 2026-11-20/);
    await ui.change('select[aria-label="Nouveau statut"]', 'termine');
    await ui.change('textarea[aria-label="Nouvelle note"]', 'Remplacé');
    await ui.change('input[aria-label="Nouvelle échéance"]', '');
    await ui.click(ui.button('Enregistrer le complément'));
    assert.equal(posts.length, 1, 'aucun POST avant confirmation');
    assert.ok(ui.dom.window.document.querySelector('[role="dialog"]'));
    await ui.click(ui.button('Confirmer la clôture'));
    assert.deepEqual(posts[1], { statut: 'termine', echeance: null, note: 'Remplacé', expectedLastId: 5 });
    assert.equal(ui.button('Compléter le suivi'), undefined);
    assert.equal(ui.dom.window.document.querySelector('textarea[aria-label="Nouvelle note"]'), null);
    assert.match(ui.dom.window.document.body.textContent, /Diagnostic initial/);
  } finally { await ui.cleanup(); }
});

test('conflit conserve le brouillon et empêche un nouveau POST tant que les données ne sont pas rechargées', async () => {
  let posts = 0; let gets = 0;
  const ui = await mount((url, options) => {
    if (url === '/api/suivis') { gets++; return Response.json({ suivis: [initial] }); }
    if (url === '/api/suivis/91/complements' && options.method === 'POST') { posts++; return Response.json({ error: 'Conflit de version' }, { status: 409 }); }
    if (url === '/api/suivis/91/complements') return Response.json({ complements: [], hasMore: false, nextBefore: null });
    throw Error(`Unexpected ${url}`);
  });
  try {
    await ui.click(ui.button('Compléter le suivi'));
    await ui.change('textarea[aria-label="Nouvelle note"]', 'Brouillon à conserver');
    await ui.click(ui.button('Enregistrer le complément'));
    assert.equal(posts, 1);
    assert.match(ui.dom.window.document.querySelector('[role="alert"]').textContent, /Conflit de version/);
    assert.equal(ui.dom.window.document.querySelector('textarea[aria-label="Nouvelle note"]').value, 'Brouillon à conserver');
    assert.ok(ui.button('Enregistrer le complément').disabled);
    await ui.click(ui.button('Actualiser le suivi'));
    assert.ok(gets > 1);
    assert.equal(ui.dom.window.document.querySelector('textarea[aria-label="Nouvelle note"]').value, 'Brouillon à conserver');
  } finally { await ui.cleanup(); }
});

test('une réponse tardive de l’autre client ne se montre pas dans la fiche courante', async () => {
  let resolveHistory;
  const ui = await mount((url) => {
    if (url === '/api/suivis') return Response.json({ suivis: [initial, { ...initial, id: 92, clientId: 3, titre: 'Dossier B' }] });
    if (url === '/api/suivis/91/complements') return new Promise(resolve => { resolveHistory = resolve; });
    throw Error(`Unexpected ${url}`);
  });
  try {
    await act(async () => ui.button('Compléter le suivi').dispatchEvent(new ui.dom.window.MouseEvent('click', { bubbles: true })));
    await ui.change('select[aria-label="Client"]', '3');
    await act(async () => resolveHistory(Response.json({ complements: [{ ...complement, note: 'SECRET ALPHA' }], hasMore: false, nextBefore: null })));
    assert.doesNotMatch(ui.dom.window.document.body.textContent, /SECRET ALPHA/);
    assert.match(ui.dom.window.document.body.textContent, /Dossier B/);
  } finally { await ui.cleanup(); }
});

test('deux clics pendant un POST en vol n’envoient qu’un complément', async () => {
  let resolvePost; let posts = 0;
  const ui = await mount((url, options) => {
    if (url === '/api/suivis') return Response.json({ suivis: [initial] });
    if (url === '/api/suivis/91/complements' && options.method === 'POST') { posts++; return new Promise(resolve => { resolvePost = resolve; }); }
    if (url === '/api/suivis/91/complements') return Response.json({ complements: [], hasMore: false, nextBefore: null });
    throw Error(`Unexpected ${url}`);
  });
  try {
    await ui.click(ui.button('Compléter le suivi'));
    await ui.change('textarea[aria-label="Nouvelle note"]', 'Une seule requête');
    const button = ui.button('Enregistrer le complément');
    await act(async () => { button.dispatchEvent(new ui.dom.window.MouseEvent('click', { bubbles: true })); button.dispatchEvent(new ui.dom.window.MouseEvent('click', { bubbles: true })); });
    assert.equal(posts, 1);
    assert.ok(ui.button('Enregistrement…').disabled);
    await act(async () => resolvePost(Response.json({ suivi: { ...initial, dernierComplementId: 5 }, complement }, { status: 201 })));
  } finally { await ui.cleanup(); }
});

test('un changement de statut sans note reste enregistrable comme complément daté', async () => {
  let posted;
  const ui = await mount((url, options) => {
    if (url === '/api/suivis') return Response.json({ suivis: [initial] });
    if (url === '/api/suivis/91/complements' && options.method === 'POST') {
      posted = JSON.parse(options.body);
      return Response.json({ suivi: { ...initial, statut: 'bloque', dernierComplementId: 8 }, complement: { ...complement, id: 8, statut: 'bloque', note: '' } }, { status: 201 });
    }
    if (url === '/api/suivis/91/complements') return Response.json({ complements: [], hasMore: false, nextBefore: null });
    throw Error(`Unexpected ${url}`);
  });
  try {
    await ui.click(ui.button('Compléter le suivi'));
    await ui.change('select[aria-label="Nouveau statut"]', 'bloque');
    const save = ui.button('Enregistrer le complément');
    assert.equal(save.disabled, false);
    await ui.click(save);
    assert.deepEqual(posted, { statut: 'bloque', echeance: '2026-11-20', note: '', expectedLastId: null });
  } finally { await ui.cleanup(); }
});

test('après un append confirmé, une note seule conserve le statut et l’échéance confirmés', async () => {
  const posts = [];
  const updated = { ...initial, statut: 'bloque', echeance: '2026-12-03', dernierComplementId: 8 };
  const ui = await mount((url, options) => {
    if (url === '/api/suivis') return Response.json({ suivis: [initial] });
    if (url === '/api/suivis/91/complements' && options.method === 'POST') {
      posts.push(JSON.parse(options.body));
      return Response.json({ suivi: posts.length === 1 ? updated : { ...updated, dernierComplementId: 9 }, complement: { ...complement, id: posts.length === 1 ? 8 : 9 } }, { status: 201 });
    }
    if (url === '/api/suivis/91/complements') return Response.json({ complements: [], hasMore: false, nextBefore: null });
    throw Error(`Unexpected ${url}`);
  });
  try {
    await ui.click(ui.button('Compléter le suivi'));
    await ui.change('textarea[aria-label="Nouvelle note"]', 'Première étape');
    await ui.click(ui.button('Enregistrer le complément'));
    assert.deepEqual(posts[0], { statut: 'en_cours', echeance: '2026-11-20', note: 'Première étape', expectedLastId: null });
    assert.equal(ui.dom.window.document.querySelector('select[aria-label="Nouveau statut"]').value, 'bloque');
    assert.equal(ui.dom.window.document.querySelector('input[aria-label="Nouvelle échéance"]').value, '2026-12-03');
    await ui.change('textarea[aria-label="Nouvelle note"]', 'Deuxième étape');
    await ui.click(ui.button('Enregistrer le complément'));
    assert.deepEqual(posts[1], { statut: 'bloque', echeance: '2026-12-03', note: 'Deuxième étape', expectedLastId: 8 });
  } finally { await ui.cleanup(); }
});

test('l’actualisation se termine avant une sauvegarde et le complément suivant garde la version confirmée', async () => {
  let resolveRefresh; let gets = 0; let historyGets = 0; const posts = [];
  const updated = { ...initial, statut: 'bloque', echeance: '2026-12-03', dernierComplementId: 8 };
  const ui = await mount((url, options) => {
    if (url === '/api/suivis') {
      gets++;
      return gets === 1 ? Response.json({ suivis: [initial] }) : new Promise(resolve => { resolveRefresh = resolve; });
    }
    if (url === '/api/suivis/91/complements' && options.method === 'POST') {
      posts.push(JSON.parse(options.body));
      return Response.json({ suivi: updated, complement: { ...complement, id: 8, statut: 'bloque', echeance: '2026-12-03' } }, { status: 201 });
    }
    if (url === '/api/suivis/91/complements') {
      historyGets++;
      if (historyGets === 1) return Response.json({ error: 'Historique indisponible' }, { status: 503 });
      return Response.json({ complements: [], hasMore: false, nextBefore: null });
    }
    throw Error(`Unexpected ${url}`);
  });
  try {
    await ui.click(ui.button('Compléter le suivi'));
    assert.ok(ui.button('Actualiser le suivi'));
    await ui.change('select[aria-label="Nouveau statut"]', 'bloque');
    await ui.change('input[aria-label="Nouvelle échéance"]', '2026-12-03');
    await ui.click(ui.button('Actualiser le suivi'));
    assert.equal(gets, 2);
    assert.ok(ui.button('Enregistrer le complément').disabled);
    await act(async () => resolveRefresh(Response.json({ suivis: [initial] })));
    await ui.click(ui.button('Enregistrer le complément'));
    assert.match(ui.dom.window.document.body.textContent, /Échéance actuelle : 2026-12-03/);
    assert.equal(ui.dom.window.document.querySelector('select[aria-label="Nouveau statut"]').value, 'bloque');
    await ui.change('textarea[aria-label="Nouvelle note"]', 'Étape suivante');
    await ui.click(ui.button('Enregistrer le complément'));
    assert.equal(posts[1].expectedLastId, 8);
  } finally { await ui.cleanup(); }
});

test('la confirmation de clôture capture Tab dans le dialogue et Escape rend le focus au bouton', async () => {
  const ui = await mount((url, options) => {
    if (url === '/api/suivis') return Response.json({ suivis: [initial] });
    if (url === '/api/suivis/91/complements' && options.method === 'POST') throw Error('Aucun POST attendu');
    if (url === '/api/suivis/91/complements') return Response.json({ complements: [], hasMore: false, nextBefore: null });
    throw Error(`Unexpected ${url}`);
  });
  try {
    await ui.click(ui.button('Compléter le suivi'));
    await ui.change('select[aria-label="Nouveau statut"]', 'termine');
    const opener = ui.button('Enregistrer le complément');
    opener.focus();
    await ui.click(opener);
    const dialog = ui.dom.window.document.querySelector('[role="dialog"]');
    assert.ok(dialog);
    const cancel = ui.button('Annuler');
    const confirm = ui.button('Confirmer la clôture');
    assert.ok(ui.dom.window.document.activeElement === cancel, 'le focus entre dans la modale');
    const key = async (target, name, shiftKey = false) => act(async () => target.dispatchEvent(new ui.dom.window.KeyboardEvent('keydown', { key: name, shiftKey, bubbles: true, cancelable: true })));
    await key(cancel, 'Tab', true);
    assert.ok(ui.dom.window.document.activeElement === confirm, 'Shift+Tab boucle vers le dernier contrôle');
    await key(confirm, 'Tab');
    assert.ok(ui.dom.window.document.activeElement === cancel, 'Tab boucle vers le premier contrôle');
    await key(cancel, 'Escape');
    assert.ok(!ui.dom.window.document.querySelector('[role="dialog"]'));
    assert.ok(ui.dom.window.document.activeElement === opener, 'le focus revient au déclencheur');
  } finally { await ui.cleanup(); }
});

test('une sauvegarde pendant le chargement garde la pagination des anciens compléments', async () => {
  let resolveHistory; let gets = 0;
  const ui = await mount((url, options) => {
    if (url === '/api/suivis') return Response.json({ suivis: [initial] });
    if (url === '/api/suivis/91/complements' && options.method === 'POST') return Response.json({ suivi: { ...initial, dernierComplementId: 6 }, complement: { ...complement, id: 6 } }, { status: 201 });
    if (url === '/api/suivis/91/complements') {
      gets++;
      if (gets === 1) return new Promise(resolve => { resolveHistory = resolve; });
      return Response.json({ complements: [{ ...complement, id: 6 }, complement], hasMore: true, nextBefore: 5 });
    }
    throw Error(`Unexpected ${url}`);
  });
  try {
    await ui.click(ui.button('Compléter le suivi'));
    await ui.change('textarea[aria-label="Nouvelle note"]', 'Nouvelle étape');
    await ui.click(ui.button('Enregistrer le complément'));
    await act(async () => resolveHistory(Response.json({ complements: [complement], hasMore: true, nextBefore: 5 })));
    assert.ok(ui.button('Afficher les compléments précédents'));
    assert.equal(gets, 2);
  } finally { await ui.cleanup(); }
});

test('un POST échoué après actualisation bloque le retry et garde le brouillon', async () => {
  let resolveRefresh; let rejectPost; let gets = 0; let posts = 0; let historyGets = 0;
  const ui = await mount((url, options) => {
    if (url === '/api/suivis') return ++gets === 1 ? Response.json({ suivis: [initial] }) : new Promise(resolve => { resolveRefresh = resolve; });
    if (url === '/api/suivis/91/complements' && options.method === 'POST') { posts++; return new Promise((resolve, reject) => { rejectPost = reject; }); }
    if (url === '/api/suivis/91/complements') return ++historyGets === 1 ? Response.json({ error: 'Historique indisponible' }, { status: 503 }) : Response.json({ complements: [], hasMore: false, nextBefore: null });
    throw Error(`Unexpected ${url}`);
  });
  try {
    await ui.click(ui.button('Compléter le suivi'));
    await ui.change('textarea[aria-label="Nouvelle note"]', 'Brouillon incertain');
    await ui.click(ui.button('Actualiser le suivi'));
    assert.ok(ui.button('Enregistrer le complément').disabled);
    await act(async () => resolveRefresh(Response.json({ suivis: [initial] })));
    await ui.click(ui.button('Enregistrer le complément'));
    assert.ok(!ui.button('Actualiser le suivi') || ui.button('Actualiser le suivi').disabled, 'aucune actualisation pendant le POST');
    await act(async () => rejectPost(Error('Réponse perdue')));
    assert.match(ui.dom.window.document.querySelector('[role="alert"]').textContent, /Réponse perdue/);
    assert.ok(ui.button('Enregistrer le complément').disabled, 'un POST incertain bloque la sauvegarde');
    await ui.click(ui.button('Enregistrer le complément'));
    assert.equal(posts, 1);
    assert.equal(ui.dom.window.document.querySelector('textarea[aria-label="Nouvelle note"]').value, 'Brouillon incertain');
  } finally { await ui.cleanup(); }
});

test('les champs de brouillon sont verrouillés pendant le POST puis rendus', async () => {
  let resolvePost;
  const ui = await mount((url, options) => {
    if (url === '/api/suivis') return Response.json({ suivis: [initial] });
    if (url === '/api/suivis/91/complements' && options.method === 'POST') return new Promise(resolve => { resolvePost = resolve; });
    if (url === '/api/suivis/91/complements') return Response.json({ complements: [], hasMore: false, nextBefore: null });
    throw Error(`Unexpected ${url}`);
  });
  try {
    await ui.click(ui.button('Compléter le suivi'));
    await ui.change('textarea[aria-label="Nouvelle note"]', 'Brouillon envoyé');
    await ui.click(ui.button('Enregistrer le complément'));
    for (const label of ['Nouveau statut', 'Nouvelle échéance', 'Nouvelle note']) {
      assert.ok(ui.dom.window.document.querySelector(`[aria-label="${label}"]`).disabled, `${label} non éditable en attente`);
    }
    await act(async () => resolvePost(Response.json({ suivi: { ...initial, dernierComplementId: 5 }, complement }, { status: 201 })));
    assert.ok(!ui.dom.window.document.querySelector('textarea[aria-label="Nouvelle note"]').disabled);
  } finally { await ui.cleanup(); }
});

test('après conflit, les champs non modifiés adoptent les valeurs serveur avant retry', async () => {
  let current = initial; let posts = 0;
  const ui = await mount((url, options) => {
    if (url === '/api/suivis') return Response.json({ suivis: [current] });
    if (url === '/api/suivis/91/complements' && options.method === 'POST') {
      posts++;
      if (posts === 1) { current = { ...initial, statut: 'bloque', echeance: '2026-12-04', dernierComplementId: 8 }; return Response.json({ error: 'Conflit de version' }, { status: 409 }); }
      assert.deepEqual(JSON.parse(options.body), { statut: 'bloque', echeance: '2026-12-04', note: 'Brouillon', expectedLastId: 8 });
      return Response.json({ suivi: { ...current, dernierComplementId: 9 }, complement: { ...complement, id: 9 } }, { status: 201 });
    }
    if (url === '/api/suivis/91/complements') return Response.json({ complements: [], hasMore: false, nextBefore: null });
    throw Error(`Unexpected ${url}`);
  });
  try {
    await ui.click(ui.button('Compléter le suivi'));
    await ui.change('textarea[aria-label="Nouvelle note"]', 'Brouillon');
    await ui.click(ui.button('Enregistrer le complément'));
    await ui.click(ui.button('Actualiser le suivi'));
    assert.equal(ui.dom.window.document.querySelector('select[aria-label="Nouveau statut"]').value, 'bloque');
    assert.equal(ui.dom.window.document.querySelector('input[aria-label="Nouvelle échéance"]').value, '2026-12-04');
    assert.equal(ui.dom.window.document.querySelector('textarea[aria-label="Nouvelle note"]').value, 'Brouillon');
    await ui.click(ui.button('Enregistrer le complément'));
    assert.equal(posts, 2);
  } finally { await ui.cleanup(); }
});

test('un choix local divergent exige confirmation explicite après changement serveur', async () => {
  let current = initial; let posts = 0; let histories = 0;
  const ui = await mount((url, options) => {
    if (url === '/api/suivis') return Response.json({ suivis: [current] });
    if (url === '/api/suivis/91/complements' && options.method === 'POST') {
      posts++;
      if (posts === 1) { current = { ...initial, statut: 'a_faire', echeance: '2026-12-04', dernierComplementId: 8 }; return Response.json({ error: 'Conflit de version' }, { status: 409 }); }
      assert.deepEqual(JSON.parse(options.body), { statut: 'bloque', echeance: '2026-12-04', note: 'Mon choix', expectedLastId: 8 });
      return Response.json({ suivi: { ...current, dernierComplementId: 9 }, complement: { ...complement, id: 9 } }, { status: 201 });
    }
    if (url === '/api/suivis/91/complements') return ++histories === 1 ? Response.json({ complements: [], hasMore: false, nextBefore: null }) : Response.json({ error: 'Historique indisponible' }, { status: 503 });
    throw Error(`Unexpected ${url}`);
  });
  try {
    await ui.click(ui.button('Compléter le suivi'));
    await ui.change('select[aria-label="Nouveau statut"]', 'bloque');
    await ui.change('textarea[aria-label="Nouvelle note"]', 'Mon choix');
    await ui.click(ui.button('Enregistrer le complément'));
    await ui.click(ui.button('Actualiser le suivi'));
    assert.equal(ui.dom.window.document.querySelector('select[aria-label="Nouveau statut"]').value, 'bloque');
    assert.equal(ui.dom.window.document.querySelector('input[aria-label="Nouvelle échéance"]').value, '2026-12-04');
    assert.match(ui.dom.window.document.querySelector('[role="alert"]').textContent, /modifié.*serveur/i);
    assert.ok(ui.button('Enregistrer le complément').disabled);
    await ui.click(ui.button('Enregistrer le complément'));
    assert.equal(posts, 1);
    await ui.click(ui.button('Confirmer mes choix'));
    await ui.click(ui.button('Enregistrer le complément'));
    assert.equal(posts, 2);
  } finally { await ui.cleanup(); }
});

test('une clôture confirmée reste fermée après changement de client sans contaminer un autre compte', async () => {
  let posts = 0;
  const ui = await mount((url, options) => {
    if (url === '/api/suivis') return Response.json({ suivis: [initial, { ...initial, id: 92, clientId: 3, titre: 'Dossier B' }] });
    if (url === '/api/suivis/91/complements' && options.method === 'POST') {
      posts++;
      return Response.json({ suivi: { ...initial, statut: 'termine', dernierComplementId: 5 }, complement: { ...complement, statut: 'termine' } }, { status: 201 });
    }
    if (url.startsWith('/api/suivis/') && url.endsWith('/complements')) return Response.json({ complements: [], hasMore: false, nextBefore: null });
    throw Error(`Unexpected ${url}`);
  });
  try {
    await ui.click(ui.button('Compléter le suivi'));
    await ui.change('select[aria-label="Nouveau statut"]', 'termine');
    await ui.click(ui.button('Enregistrer le complément'));
    await ui.click(ui.button('Confirmer la clôture'));
    assert.equal(posts, 1);
    assert.ok(ui.button('Voir les compléments'));
    await ui.change('select[aria-label="Client"]', '3');
    await ui.change('select[aria-label="Client"]', '2');
    assert.ok(ui.button('Voir les compléments'), 'le retour au client doit voir le suivi confirmé');
    assert.ok(!ui.button('Compléter le suivi'));
    await ui.switchUser(2);
    assert.ok(ui.button('Compléter le suivi'), 'le complément confirmé du compte 1 ne doit pas apparaître pour le compte 2');
  } finally { await ui.cleanup(); }
});

test('les champs sont verrouillés pendant un GET de réconciliation, puis les choix divergents sont protégés', async () => {
  let resolveRefresh; let gets = 0; let histories = 0;
  const ui = await mount((url, options) => {
    if (url === '/api/suivis') return ++gets === 1 ? Response.json({ suivis: [initial] }) : new Promise(resolve => { resolveRefresh = resolve; });
    if (url === '/api/suivis/91/complements') return ++histories === 1
      ? Response.json({ error: 'Historique indisponible' }, { status: 503 })
      : Response.json({ complements: [], hasMore: false, nextBefore: null });
    throw Error(`Unexpected ${url} ${options.method ?? 'GET'}`);
  });
  try {
    await ui.click(ui.button('Compléter le suivi'));
    await ui.change('select[aria-label="Nouveau statut"]', 'bloque');
    await ui.change('input[aria-label="Nouvelle échéance"]', '2026-12-04');
    await ui.change('textarea[aria-label="Nouvelle note"]', 'Mon brouillon');
    await ui.click(ui.button('Actualiser le suivi'));
    for (const label of ['Nouveau statut', 'Nouvelle échéance', 'Nouvelle note']) {
      assert.ok(ui.dom.window.document.querySelector(`[aria-label="${label}"]`).disabled, `${label} doit rester verrouillé pendant le GET`);
    }
    await act(async () => resolveRefresh(Response.json({ suivis: [{ ...initial, statut: 'a_faire', echeance: '2026-12-08', dernierComplementId: 8 }] })));
    assert.equal(ui.dom.window.document.querySelector('select[aria-label="Nouveau statut"]').value, 'bloque');
    assert.equal(ui.dom.window.document.querySelector('input[aria-label="Nouvelle échéance"]').value, '2026-12-04');
    assert.equal(ui.dom.window.document.querySelector('textarea[aria-label="Nouvelle note"]').value, 'Mon brouillon');
    assert.ok(ui.button('Enregistrer le complément').disabled, 'un choix divergent nécessite confirmation');
    assert.ok(ui.button('Confirmer mes choix'));
  } finally { await ui.cleanup(); }
});

test('une clôture ne peut pas ouvrir sa confirmation pendant une actualisation incertaine', async () => {
  let resolveRefresh; let gets = 0; let histories = 0;
  const ui = await mount((url, options) => {
    if (url === '/api/suivis') return ++gets === 1 ? Response.json({ suivis: [initial] }) : new Promise(resolve => { resolveRefresh = resolve; });
    if (url === '/api/suivis/91/complements') return ++histories === 1
      ? Response.json({ error: 'Historique indisponible' }, { status: 503 })
      : Response.json({ complements: [], hasMore: false, nextBefore: null });
    throw Error(`Unexpected ${url} ${options.method ?? 'GET'}`);
  });
  try {
    await ui.click(ui.button('Compléter le suivi'));
    await ui.change('select[aria-label="Nouveau statut"]', 'termine');
    await ui.click(ui.button('Actualiser le suivi'));
    assert.ok(ui.button('Enregistrer le complément').disabled, 'pas de confirmation fondée sur un état périmé');
    assert.ok(!ui.dom.window.document.querySelector('[role="dialog"]'));
    await act(async () => resolveRefresh(Response.json({ suivis: [{ ...initial, statut: 'termine', dernierComplementId: 8 }] })));
    assert.ok(!ui.button('Enregistrer le complément'));
    assert.ok(!ui.dom.window.document.querySelector('[role="dialog"]'));
  } finally { await ui.cleanup(); }
});

test('une clôture échouée rend le focus à Actualiser, sans focus sur Enregistrer désactivé', async () => {
  const ui = await mount((url, options) => {
    if (url === '/api/suivis') return Response.json({ suivis: [initial] });
    if (url === '/api/suivis/91/complements' && options.method === 'POST') return Response.json({ error: 'Réponse incertaine' }, { status: 503 });
    if (url === '/api/suivis/91/complements') return Response.json({ complements: [], hasMore: false, nextBefore: null });
    throw Error(`Unexpected ${url}`);
  });
  try {
    await ui.click(ui.button('Compléter le suivi'));
    await ui.change('select[aria-label="Nouveau statut"]', 'termine');
    const opener = ui.button('Enregistrer le complément');
    opener.focus();
    await ui.click(opener);
    await ui.click(ui.button('Confirmer la clôture'));
    assert.ok(!ui.dom.window.document.querySelector('[role="dialog"]'));
    assert.ok(opener.disabled);
    assert.ok(ui.dom.window.document.activeElement === ui.button('Actualiser le suivi'), 'focus vers une action utilisable après échec');
  } finally { await ui.cleanup(); }
});
