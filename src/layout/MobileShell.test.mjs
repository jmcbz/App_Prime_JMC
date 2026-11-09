import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { unlink } from 'node:fs/promises';

const outfile = new URL('./.mobile-shell-test-bundle.mjs', import.meta.url).pathname;
globalThis.__mobileShellAuth = { user: { id: 1, prenom: 'Test', nom: 'Prime', email: 'test@example.test', role: 'admin' }, loading: false, verified: true, logout: async () => {} };
let App;
try {
  await build({ entryPoints: [new URL('../App.tsx', import.meta.url).pathname], outfile,
    bundle: true, format: 'esm', platform: 'node', packages: 'external', jsx: 'automatic',
    plugins: [{ name: 'shell-test-dependencies', setup(plugin) {
      plugin.onResolve({ filter: /context\/AuthContext$/ }, () => ({ path: 'auth', namespace: 'shell-test' }));
      plugin.onLoad({ filter: /^auth$/, namespace: 'shell-test' }, () => ({ contents: 'export const useAuth = () => globalThis.__mobileShellAuth;', loader: 'js' }));
      plugin.onResolve({ filter: /pages\// }, args => ({ path: args.path, namespace: 'shell-test' }));
      plugin.onLoad({ filter: /pages\//, namespace: 'shell-test' }, args => {
        const name = args.path.split('/').pop();
        const contents = name === 'Procedures'
          ? `import React from 'react'; import {Link} from 'react-router-dom'; export default function Page() { return React.createElement('div', null, 'Procédures', React.createElement(Link, {to: '/procedures/prise-en-charge'}, 'Ouvrir l’outil')); }`
          : `import React from 'react'; export default function Page() { return React.createElement('div', null, '${name}', React.createElement('input', {'aria-label': 'Champ de formulaire'})); }`;
        return { contents, loader: 'js', resolveDir: new URL('../', import.meta.url).pathname };
      });
    }}] });
  App = (await import(outfile)).default;
} finally { await unlink(outfile).catch(() => {}); }

async function mount(path = '/') {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/' });
  const previous = { window: globalThis.window, document: globalThis.document, navigator: globalThis.navigator, IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT };
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const router = createMemoryRouter([{ path: '*', element: React.createElement(App) }], { initialEntries: [path] });
  const root = createRoot(dom.window.document.getElementById('root'));
  await act(async () => root.render(React.createElement(RouterProvider, { router })));
  const click = async element => { assert.ok(element); await act(async () => element.click()); };
  const close = async () => {
    await act(async () => root.unmount()); dom.window.close();
    globalThis.window = previous.window; globalThis.document = previous.document;
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: previous.navigator });
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous.IS_REACT_ACT_ENVIRONMENT;
  };
  return { dom, router, click, close, get document() { return dom.window.document; },
    get menu() { return dom.window.document.querySelector('button[aria-controls="primary-navigation"]'); },
    get sidebar() { return dom.window.document.querySelector('#primary-navigation'); },
    get backdrop() { return dom.window.document.querySelector('[data-testid="navigation-backdrop"]'); } };
}

test('mobile shell exposes full-width main and a closed, accessible navigation toggle', async () => {
  const ui = await mount('/suivis');
  try {
    assert.match(ui.document.querySelector('main').className, /md:ml-64/);
    assert.doesNotMatch(ui.document.querySelector('main').className, /(?:^|\s)ml-64(?:\s|$)/);
    assert.match(ui.menu.closest('header').className, /md:hidden/);
    assert.equal(ui.menu.getAttribute('aria-expanded'), 'false');
    assert.match(ui.menu.getAttribute('aria-label'), /menu/i);
    assert.match(ui.sidebar.className, /md:flex/);
    assert.match(ui.sidebar.className, /(?:^|\s)hidden(?:\s|$)/);
    assert.ok(!ui.backdrop);
    assert.match(ui.document.querySelector('main').textContent, /Suivis/);
  } finally { await ui.close(); }
});

test('mobile drawer closes on Escape and backdrop, releasing form clicks', async () => {
  const ui = await mount('/procedures/prise-en-charge');
  try {
    await ui.click(ui.menu);
    assert.equal(ui.menu.getAttribute('aria-expanded'), 'true');
    assert.ok(ui.document.activeElement === ui.sidebar.querySelector('nav a'), 'keyboard focus enters the drawer');
    assert.ok(ui.backdrop);
    assert.doesNotMatch(ui.sidebar.className, /(?:^|\s)hidden(?:\s|$)/);
    await act(async () => ui.dom.window.document.dispatchEvent(new ui.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert.equal(ui.menu.getAttribute('aria-expanded'), 'false');
    assert.ok(!ui.backdrop);
    assert.ok(ui.document.activeElement === ui.menu, 'keyboard focus returns to menu');
    await ui.click(ui.menu);
    await ui.click(ui.backdrop);
    assert.equal(ui.menu.getAttribute('aria-expanded'), 'false');
    assert.ok(!ui.backdrop);
    const input = ui.document.querySelector('main input');
    await ui.click(input);
    assert.ok(!ui.backdrop);
  } finally { await ui.close(); }
});

test('drawer navigation reaches Suivis and onboarding through procedures, closing each time', async () => {
  const ui = await mount('/');
  try {
    await ui.click(ui.menu);
    await ui.click([...ui.sidebar.querySelectorAll('a')].find(a => a.textContent.includes('Suivis')));
    assert.equal(ui.router.state.location.pathname, '/suivis');
    assert.equal(ui.menu.getAttribute('aria-expanded'), 'false');
    assert.ok(!ui.backdrop);
    await ui.click(ui.menu);
    await ui.click([...ui.sidebar.querySelectorAll('a')].find(a => a.textContent.includes('Trousse d’outils')));
    assert.equal(ui.router.state.location.pathname, '/procedures');
    assert.ok(!ui.backdrop);
    await ui.click(ui.document.querySelector('main a'));
    assert.equal(ui.router.state.location.pathname, '/procedures/prise-en-charge');
    assert.match(ui.document.querySelector('main').textContent, /ClientOnboarding/);
  } finally { await ui.close(); }
});

test('desktop sidebar remains fixed and available; mobile logout still obeys before-logout veto', async () => {
  const ui = await mount();
  const originalLogout = globalThis.__mobileShellAuth.logout;
  let logouts = 0;
  globalThis.__mobileShellAuth.logout = async () => { logouts++; };
  try {
    assert.match(ui.sidebar.className, /fixed/);
    assert.match(ui.sidebar.className, /md:flex/);
    assert.match(ui.sidebar.className, /w-64/);
    assert.match(ui.document.querySelector('main').className, /md:ml-64/);
    assert.match(ui.menu.closest('header').className, /md:hidden/);
    await ui.click(ui.menu);
    const veto = event => event.preventDefault();
    ui.dom.window.addEventListener('client-onboarding:before-logout', veto);
    await ui.click([...ui.sidebar.querySelectorAll('button')].find(b => b.textContent.includes('Se déconnecter')));
    assert.equal(logouts, 0);
    ui.dom.window.removeEventListener('client-onboarding:before-logout', veto);
    await ui.click([...ui.sidebar.querySelectorAll('button')].find(b => b.textContent.includes('Se déconnecter')));
    assert.equal(logouts, 1);
  } finally { globalThis.__mobileShellAuth.logout = originalLogout; await ui.close(); }
});
