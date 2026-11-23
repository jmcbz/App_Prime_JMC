import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { unlink } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

// Only explicit API fixtures; no backend, credentials or external network.
test('Prime form hides Code Titan without losing its value and prevents Enter in Servo search from submitting', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost' });
  const names = ['window', 'document', 'navigator', 'fetch', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  const prime = { id: 1, nom: 'Prime Fixture', codeTitan: 'Test', avatarInitiales: 'PF', specialites: [], disponibilite: 'disponible' };
  const fixtures = {
    '/api/auth/me': { user: { id: 1, email: 'fixture@example.test', prenom: 'Fixture', nom: 'Admin', role: 'admin', is_active: true } },
    '/api/primes': { primes: [prime] },
    '/api/clients': { clients: [{ id: 1, nom: 'Déjà associé', primeId: 1, servoClientId: 11, statut: 'actif', secteur: '' }] },
    '/api/suivis': { suivis: [] },
    '/api/servo/clients': { clients: [{ id: 11, nom: 'Déjà associé', alias: '' }, { id: 12, nom: 'Électricité Montréal', alias: 'Éclair' }] },
  };
  const writes = [];
  globalThis.fetch = async (url, init = {}) => {
    if (url === '/api/primes' && init.method === 'POST') {
      writes.push(JSON.parse(init.body)); return Response.json({ prime: { id: 3, ...JSON.parse(init.body) } });
    }
    if (url === '/api/primes/1/portfolio' && init.method === 'PUT') {
      writes.push(JSON.parse(init.body)); return Response.json({ ok: true });
    }
    assert.ok(fixtures[url] && (!init.method || init.method === 'GET'), `Unexpected request ${url}`);
    return Response.json(fixtures[url]);
  };
  const outfile = new URL('./.primes-servo-search-test-bundle.mjs', import.meta.url).pathname;
  let root; let act;
  try {
    await build({ stdin: { contents: `export { default as Primes } from './Primes.tsx'; export { AuthProvider } from '../context/AuthContext.tsx';`, resolveDir: new URL('.', import.meta.url).pathname, loader: 'ts' }, outfile, bundle: true, format: 'esm', platform: 'node', packages: 'external', jsx: 'automatic' });
    const { Primes, AuthProvider } = await import(outfile);
    const React = await import('react'); ({ act } = React);
    const { createRoot } = await import('react-dom/client');
    root = createRoot(document.getElementById('root'));
    await act(async () => root.render(React.createElement(AuthProvider, null, React.createElement(Primes))));
    await act(async () => document.querySelector('button[title="Modifier"]').click());
    assert.ok(!document.querySelector('form input[placeholder="Ex. Nightwing"]'), 'Code Titan must not be editable');
    assert.ok(![...document.querySelectorAll('form label')].some(label => label.textContent === 'Code Titan'));
    const field = document.querySelector('#servo-client-search');
    const results = () => [...document.querySelectorAll('#servo-client-results button')];
    const type = async value => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(field, value);
        field.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      });
    };
    await type('eclair');
    assert.equal(results().length, 1, 'Typing must show a directly clickable result, without opening a select');
    assert.match(results()[0].textContent, /Électricité Montréal.*Éclair/);
    assert.equal(results()[0].type, 'button');
    await act(async () => results()[0].click());
    await type('aucun');
    assert.equal(results().length, 0);
    assert.match(document.querySelector('#servo-client-status').textContent, /Aucun client/);
    field.focus();
    const enter = new dom.window.KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true });
    await act(async () => field.dispatchEvent(enter));
    // jsdom has no native implicit-submit algorithm: the Chromium fixture also
    // exercises this event with the real browser's default form submission.
    assert.equal(enter.defaultPrevented, true, 'Search Enter must prevent implicit form submission');
    assert.equal(writes.length, 0);
    assert.ok(document.querySelector('#servo-client-search'));
    assert.equal(field.value, 'aucun');
    assert.ok(document.querySelector('button[title="Retirer Déjà associé"]'));
    assert.ok(document.querySelector('button[title="Retirer Électricité Montréal"]'));
    const letter = new dom.window.KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
    await act(async () => field.dispatchEvent(letter));
    assert.equal(letter.defaultPrevented, false);
    await act(async () => document.querySelector('button[type="submit"]').click());
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0], { prime: { nom: prime.nom, codeTitan: prime.codeTitan, avatarInitiales: prime.avatarInitiales, specialites: [], disponibilite: 'disponible' }, addServoIds: [12], removeClientIds: [] });
    await act(async () => [...document.querySelectorAll('button')].find(b => b.textContent.includes('Ajouter un Prime')).click());
    assert.ok(!document.querySelector('form input[placeholder="Ex. Nightwing"]'), 'Code Titan must not be required for creation');
    const name = document.querySelector('form input');
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(name, 'Nouveau Prime');
      name.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    await act(async () => document.querySelector('button[type="submit"]').click());
    assert.equal(writes.length, 2);
    assert.equal(writes[1].nom, 'Nouveau Prime');
    assert.equal(writes[1].codeTitan, '');
  } finally {
    if (root) await act(async () => root.unmount());
    await unlink(outfile).catch(() => {});
    dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});
