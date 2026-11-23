import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { unlink } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

// Historical identity stays in the API fixture, never in presentation.
for (const page of ['Clients', 'Suivis', 'Administration']) {
  test(`${page}: names and selectors never render historical Titan identity`, async () => {
    const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost' });
    const previous = new Map(['window', 'document', 'navigator', 'fetch', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
    for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    const primes = [
      { id: 7, nom: 'Prime Alpha', codeTitan: 'Nightwing', avatarInitiales: 'PA', specialites: [], disponibilite: 'disponible' },
      { id: 8, nom: '', codeTitan: 'SECRET_FALLBACK', avatarInitiales: '', specialites: [], disponibilite: 'disponible' },
    ];
    const fixtures = {
      '/api/auth/me': { user: { id: 1, email: 'admin@example.test', prenom: 'Fixture', nom: 'Admin', role: 'admin', is_active: true } },
      '/api/primes': { primes },
      '/api/clients': { clients: [{ id: 2, nom: 'Client Alpha', primeId: 7, statut: 'actif', secteur: '', clientType: 'ti' }] },
      '/api/suivis': { suivis: [] },
      '/api/tableaux-suivi': { tableaux: [] },
      '/api/admin/users': { users: [{ id: 9, prenom: 'Compte', nom: 'Historique', email: 'legacy@example.test', role: 'prime', is_active: true, primeId: null }] },
    };
    globalThis.fetch = async (url, init = {}) => {
      assert.ok(fixtures[url] && (!init.method || init.method === 'GET'), `Unexpected ${url}`);
      return Response.json(fixtures[url]);
    };
    const outfile = new URL(`./.identity-${page}-test.mjs`, import.meta.url).pathname;
    let root, act;
    try {
      await build({ stdin: { contents: `export { default as Page } from './${page}.tsx'; export { AuthProvider } from '../context/AuthContext.tsx';`, resolveDir: new URL('.', import.meta.url).pathname, loader: 'ts' }, outfile, bundle: true, format: 'esm', platform: 'node', packages: 'external', jsx: 'automatic' });
      const pages = await import(outfile); const React = await import('react'); ({ act } = React);
      const { createRoot } = await import('react-dom/client'); root = createRoot(document.getElementById('root'));
      await act(async () => root.render(React.createElement(pages.AuthProvider, null, React.createElement(pages.Page))));
      const clean = () => assert.doesNotMatch(document.body.textContent, /code titan|Nightwing|SECRET_FALLBACK/i);
      clean();
      assert.ok(document.body.textContent.includes('Prime Alpha'));
      if (page === 'Clients') {
        await act(async () => document.querySelector('button[title="Modifier"]').click());
        clean();
        assert.equal(document.querySelector('option[value="7"]').textContent, 'Prime Alpha');
      } else if (page === 'Suivis') {
        assert.equal(document.querySelector('select[aria-label="Filtrer par Prime"] option[value="7"]').textContent, 'Prime Alpha');
      } else {
        assert.equal(document.querySelector('select[aria-label^="Prime à associer"] option[value="7"]').textContent, 'Prime Alpha · Client Alpha');
      }
    } finally {
      if (root) await act(async () => root.unmount());
      await unlink(outfile).catch(() => {}); dom.window.close();
      for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
    }
  });
}
