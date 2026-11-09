import test from 'node:test';
import assert from 'node:assert/strict';
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {Simulate} from 'react-dom/test-utils';
import {createMemoryRouter, RouterProvider} from 'react-router-dom';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
import {unlink} from 'node:fs/promises';

const outfile = new URL('./.onboarding-ui-test.mjs', import.meta.url).pathname;
const sidebarOutfile = new URL('./.onboarding-sidebar-test.mjs', import.meta.url).pathname;
const authOutfile = new URL('./.onboarding-auth-test.mjs', import.meta.url).pathname;
const pendingKey = (id = 1) => `client-onboarding:pending-create:${id}`;
globalThis.__onboardingAuth = {user: {id: 1, prenom: 'Test', nom: 'User', role: 'admin'}, logout: async () => {}};
let Page, Sidebar, RealAuth;
try {
  await build({entryPoints: [new URL('./ClientOnboarding.tsx', import.meta.url).pathname], outfile,
    bundle: true, format: 'esm', platform: 'node', packages: 'external', jsx: 'automatic',
    define: {'import.meta.env.BASE_URL': '"/"'},
    plugins: [{name: 'capture-exports', setup(plugin) {
      plugin.onResolve({filter: /context\/AuthContext$/}, () => ({path: 'auth', namespace: 'test-auth'}));
      plugin.onLoad({filter: /.*/, namespace: 'test-auth'}, () => ({contents: 'export const useAuth = () => globalThis.__onboardingAuth;', loader: 'js'}));
      plugin.onResolve({filter: /clientOnboardingExport$/}, () => ({path: 'onboarding-export', namespace: 'test-export'}));
      plugin.onLoad({filter: /.*/, namespace: 'test-export'}, () => ({contents: `export async function exportOnboardingPdf(...args) { await globalThis.__onboardingExportGate?.promise; if (args[3]?.aborted) return; await args[4]?.(); if (args[3]?.aborted) return; globalThis.__onboardingExports.push(['pdf', ...args]); }
        export async function exportOnboardingXlsx(...args) { await globalThis.__onboardingExportGate?.promise; if (args[3]?.aborted) return; await args[4]?.(); if (args[3]?.aborted) return; globalThis.__onboardingExports.push(['xlsx', ...args]); }`, loader: 'js'}));
    }}]});
  Page = (await import(outfile)).default;
  await build({entryPoints: [new URL('../layout/Sidebar.tsx', import.meta.url).pathname], outfile: sidebarOutfile,
    bundle: true, format: 'esm', platform: 'node', packages: 'external', jsx: 'automatic',
    plugins: [{name: 'test-auth', setup(plugin) {
      plugin.onResolve({filter: /context\/AuthContext$/}, () => ({path: 'auth', namespace: 'test-auth'}));
      plugin.onLoad({filter: /.*/, namespace: 'test-auth'}, () => ({contents: 'export const useAuth = () => globalThis.__onboardingAuth;', loader: 'js'}));
    }}]});
  Sidebar = (await import(sidebarOutfile)).default;
  await build({entryPoints: ['onboarding-auth-entry'], outfile: authOutfile,
    bundle: true, format: 'esm', platform: 'node', packages: 'external', jsx: 'automatic',
    define: {'import.meta.env.BASE_URL': '"/"'},
    plugins: [{name: 'real-auth-entry', setup(plugin) {
      plugin.onResolve({filter: /^onboarding-auth-entry$/}, () => ({path: 'entry', namespace: 'auth-entry'}));
      plugin.onLoad({filter: /.*/, namespace: 'auth-entry'}, () => ({contents: `export {AuthProvider, useAuth} from '${new URL('../context/AuthContext.tsx', import.meta.url).pathname}';
        export {default as Page} from '${new URL('./ClientOnboarding.tsx', import.meta.url).pathname}';
        export {default as Sidebar} from '${new URL('../layout/Sidebar.tsx', import.meta.url).pathname}';
        export {default as App} from '${new URL('../App.tsx', import.meta.url).pathname}';
        export {getOnboardingOptions} from '${new URL('../services/clientOnboardingService.ts', import.meta.url).pathname}';`, loader: 'js', resolveDir: new URL('.', import.meta.url).pathname}));
      // Exercise both rejected /me and the real service's 5xx handling.
      plugin.onResolve({filter: /services\/authService$/}, () => ({path: 'auth-service', namespace: 'test-auth-service'}));
      plugin.onLoad({filter: /.*/, namespace: 'test-auth-service'}, () => ({contents: `import {checkAuth as actualCheckAuth, logout} from '${new URL('../services/authService.ts', import.meta.url).pathname}';
        export {logout, login, confirmMfaSetup, verifyMfaLogin} from '${new URL('../services/authService.ts', import.meta.url).pathname}';
        export async function checkAuth() {
          if (globalThis.__onboardingMeThrows) throw Error('ME unavailable');
          return actualCheckAuth();
        }`, loader: 'js', resolveDir: new URL('.', import.meta.url).pathname}));
      plugin.onResolve({filter: /clientOnboardingExport$/}, () => ({path: 'onboarding-export', namespace: 'test-export'}));
      plugin.onLoad({filter: /.*/, namespace: 'test-export'}, () => ({contents: `export async function exportOnboardingPdf(...args) { globalThis.__onboardingExportStarted = args[3]; await globalThis.__onboardingExportGate?.promise; if (args[3]?.aborted) return; await args[4]?.(); if (args[3]?.aborted) return; globalThis.__onboardingExports.push(['pdf', ...args]); }
        export async function exportOnboardingXlsx(...args) { globalThis.__onboardingExportStarted = args[3]; await globalThis.__onboardingExportGate?.promise; if (args[3]?.aborted) return; await args[4]?.(); if (args[3]?.aborted) return; globalThis.__onboardingExports.push(['xlsx', ...args]); }`, loader: 'js'}));
    }}]});
  RealAuth = await import(authOutfile);
} finally { await Promise.all([outfile, sidebarOutfile, authOutfile].map(file => unlink(file).catch(() => {}))); }
const record = (id, titre = `Dossier ${id}`) => ({id, version: 1, client_id: 1, technicien_id: 2, titre, statut: 'À faire', priorite: 'Moyenne', compte_rendu: {}, items: [], history: []});
const deferred = () => {let resolve; const promise = new Promise(r => {resolve = r;}); return {promise, resolve};};
const tick = async (ms = 0) => {await act(async () => {await new Promise(r => setTimeout(r, ms));});};

test('corrupted recovered draft shapes fail closed before render or another POST', async () => {
  const valid = {requestKey: '5dd87d23-e7ad-4a9e-b993-726f7d40b4a9',
    onboarding: {client_id: 1, technicien_id: '', titre: 'Brouillon récupéré', statut: 'À faire', priorite: 'Moyenne', compte_rendu: {resume_executif: 'Conservé'}},
    items: [{section_key: 'informations-generales', section_title: 'Informations générales', item_order: 1, checked: false, element: 'Vérifier', notes: 'Preuve'}]};
  const corruptions = [
    ['null item', draft => {draft.items = [null];}],
    ['late malformed item', draft => {draft.items = [...Array.from({length: 122}, (_, i) => ({...draft.items[0], item_order: i + 1})), null];}],
    ['missing item field', draft => {delete draft.items[0].section_key;}],
    ['wrong checked type', draft => {draft.items[0].checked = 'false';}],
    ['wrong item notes type', draft => {draft.items[0].notes = {bad: true};}],
    ['array onboarding', draft => {draft.onboarding = [draft.onboarding];}],
    ['missing onboarding status', draft => {delete draft.onboarding.statut;}],
    ['malformed report', draft => {draft.onboarding.compte_rendu = {resume_executif: {bad: true}};}],
    ['invalid technician', draft => {draft.onboarding.technicien_id = {bad: true};}],
  ];
  for (const [label, mutate] of corruptions) {
    const dom = new JSDOM('<!doctype html><div id="app"></div>', {url: 'http://localhost/'});
    const previous = {window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch};
    Object.assign(globalThis, {window: dom.window, document: dom.window.document});
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const draft = structuredClone(valid); mutate(draft);
    const stored = JSON.stringify(draft);
    dom.window.sessionStorage.setItem(pendingKey(), stored);
    let posts = 0;
    globalThis.fetch = async (url, options = {}) => {
      if (url.endsWith('/options')) return Response.json({clients: [{id: 1, nom: 'Québec'}], techniciens: []});
      if (url === '/api/client-onboardings?archived=false') return Response.json([]);
      if (options.method === 'POST') posts++;
      throw Error(`Unexpected ${url}`);
    };
    const root = createRoot(dom.window.document.getElementById('app'));
    try {
      await act(async () => root.render(React.createElement(RouterProvider, {router: createMemoryRouter([{path: '/', element: React.createElement(Page)}])})));
      await tick(300);
      assert.match(dom.window.document.querySelector('[role="alert"]')?.textContent ?? '', /Stockage de session indisponible.*Création bloquée/, label);
      const save = [...dom.window.document.querySelectorAll('button')].find(e => e.textContent === 'Sauvegarder');
      assert.equal(save.disabled, true, label);
      await act(async () => save.click());
      assert.equal(posts, 0, label);
      assert.equal(dom.window.sessionStorage.getItem(pendingKey()), stored, `${label}: original draft preserved`);
    } finally {await act(async () => root.unmount()); Object.assign(globalThis, previous); dom.window.close();}
  }
});

test('empty-array recovery stays empty and retains the reconciliation lock', async () => {
  const dom = new JSDOM('<!doctype html><div id="app"></div>', {url: 'http://localhost/'});
  const previous = {window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch};
  Object.assign(globalThis, {window: dom.window, document: dom.window.document});
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const draft = {requestKey: '5dd87d23-e7ad-4a9e-b993-726f7d40b4a9', onboarding: {client_id: 1, titre: 'Vide', statut: 'À faire', priorite: 'Moyenne'}, items: []};
  dom.window.sessionStorage.setItem(pendingKey(), JSON.stringify(draft));
  let posts = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (url.endsWith('/options')) return Response.json({clients: [{id: 1, nom: 'Québec'}], techniciens: []});
    if (url === '/api/client-onboardings?archived=false') return Response.json([]);
    if (options.method === 'POST') posts++;
    throw Error(`Unexpected ${url}`);
  };
  const root = createRoot(dom.window.document.getElementById('app'));
  try {
    await act(async () => root.render(React.createElement(RouterProvider, {router: createMemoryRouter([{path: '/', element: React.createElement(Page)}])})));
    assert.match(dom.window.document.body.textContent, /Sections · 0\/0 faits/);
    assert.match(dom.window.document.body.textContent, /Création à vérifier/);
    assert.equal([...dom.window.document.querySelectorAll('button')].find(e => e.textContent === 'Sauvegarder').disabled, true);
    assert.equal(posts, 0);
  } finally {await act(async () => root.unmount()); Object.assign(globalThis, previous); dom.window.close();}
});

test('real App aborts pending PDF/Excel downloads synchronously on focus, visibility and manual verification, then allows same-account exports', async () => {
  for (const format of ['PDF', 'Excel']) for (const event of ['focus', 'visibilitychange', 'manual']) {
    const dom = new JSDOM('<!doctype html><div id="app"></div>', {url: 'http://localhost/'});
    const previous = {window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, exports: globalThis.__onboardingExports, gate: globalThis.__onboardingExportGate, started: globalThis.__onboardingExportStarted};
    Object.assign(globalThis, {window: dom.window, document: dom.window.document, __onboardingExports: []});
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const a = {id: 101, prenom: 'A', nom: 'User', email: 'a@example.com', role: 'admin', is_active: true};
    let me = null, refresh;
    globalThis.fetch = async url => {
      if (url === '/api/auth/me') return me ? me.promise : Response.json({user: a});
      if (url.endsWith('/options')) return Response.json({clients: [{id: 1, nom: 'Client A'}], techniciens: []});
      if (url === '/api/client-onboardings?archived=false') return Response.json([]);
      throw Error(`Unexpected ${url}`);
    };
    function RefreshProbe() { refresh = RealAuth.useAuth().refresh; return null; }
    const root = createRoot(dom.window.document.getElementById('app'));
    const router = createMemoryRouter([{path: '*', element: React.createElement(RealAuth.App)}], {initialEntries: ['/procedures/prise-en-charge']});
    const button = text => [...dom.window.document.querySelectorAll('button')].find(e => e.textContent === text);
    const title = () => [...dom.window.document.querySelectorAll('label')].find(e => e.textContent === 'Titre')?.querySelector('input');
    try {
      await act(async () => root.render(React.createElement(RealAuth.AuthProvider, null, React.createElement(RefreshProbe), React.createElement(RouterProvider, {router}))));
      await tick(300);
      await act(async () => Simulate.change(title(), {target: {value: 'Brouillon secret A'}}));
      const gate = deferred(); globalThis.__onboardingExportGate = gate;
      await act(async () => button(format).click());
      assert.equal(button(format).disabled, true, 'export reached its asynchronous build');
      const inFlightSignal = globalThis.__onboardingExportStarted;
      assert.ok(inFlightSignal && !inFlightSignal.aborted);
      me = deferred();
      if (event === 'visibilitychange') Object.defineProperty(dom.window.document, 'visibilityState', {configurable: true, value: 'visible'});
      let pendingRefresh;
      await act(async () => {
        if (event === 'manual') pendingRefresh = refresh();
        else (event === 'focus' ? dom.window : dom.window.document).dispatchEvent(new dom.window.Event(event));
        assert.equal(inFlightSignal.aborted, true, 'export invalidated in the verification-start call stack');
      });
      assert.ok(title()?.closest('[hidden]'), 'editor remains mounted and concealed while /me is pending');
      // Resolve the document build BEFORE /me. A stale export must never save in this interval.
      await act(async () => gate.resolve());
      assert.equal(globalThis.__onboardingExports.length, 0, `${format} cannot download while ${event} verification is pending`);
      assert.equal(title().value, 'Brouillon secret A', 'unsaved editor state survives verification');
      await act(async () => me.resolve(Response.json({user: a})));
      if (pendingRefresh) await pendingRefresh;
      me = null; globalThis.__onboardingExportGate = null;
      assert.ok(!title().closest('[hidden]'));
      assert.equal(title().value, 'Brouillon secret A');
      await act(async () => button(format).click());
      assert.equal(globalThis.__onboardingExports.length, 1, `${format} exports again after A is verified`);
      assert.equal(globalThis.__onboardingExports[0][1].titre, 'Brouillon secret A');
      // Even a /me that resolves in the same React batch must re-arm exports.
      await act(async () => refresh());
      await act(async () => button(format).click());
      assert.equal(globalThis.__onboardingExports.length, 2, `${format} re-arms after immediate same-account verification`);
    } finally {
      await act(async () => root.unmount());
      Object.assign(globalThis, {...previous, __onboardingExports: previous.exports, __onboardingExportGate: previous.gate, __onboardingExportStarted: previous.started});
      dom.window.close();
    }
  }
});

test('real AuthProvider direct logout and setUser(B), including failed draft cleanup, cancel deferred PDF and Excel', async () => {
  for (const format of ['PDF', 'Excel']) for (const transition of ['logout', 'setUser', 'setUser-storage-error']) {
    const dom = new JSDOM('<!doctype html><div id="app"></div>', {url: 'http://localhost/'});
    dom.window.HTMLElement.prototype.attachEvent = () => {};
    dom.window.HTMLElement.prototype.detachEvent = () => {};
    const previous = {window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, exports: globalThis.__onboardingExports, gate: globalThis.__onboardingExportGate, started: globalThis.__onboardingExportStarted};
    Object.assign(globalThis, {window: dom.window, document: dom.window.document, __onboardingExports: []});
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const a = {id: 101, prenom: 'A', nom: 'User', email: 'a@example.com', role: 'admin', is_active: true};
    const b = {...a, id: 202, email: 'b@example.com'};
    globalThis.fetch = url => {
      if (url === '/api/auth/me') return Response.json({user: a});
      if (url === '/api/auth/logout') return Response.json({success: true});
      if (url.endsWith('/options')) return Response.json({clients: [{id: 1, nom: 'Client A'}], techniciens: []});
      if (url === '/api/client-onboardings?archived=false') return Response.json([]);
      throw Error(`Unexpected ${url}`);
    };
    let auth;
    function Probe() {auth = RealAuth.useAuth(); return null;}
    const root = createRoot(dom.window.document.getElementById('app'));
    const router = createMemoryRouter([{path: '*', element: React.createElement(RealAuth.App)}], {initialEntries: ['/procedures/prise-en-charge']});
    const originalRemove = dom.window.Storage.prototype.removeItem;
    try {
      await act(async () => root.render(React.createElement(RealAuth.AuthProvider, null, React.createElement(Probe), React.createElement(RouterProvider, {router}))));
      await tick(300);
      const button = [...dom.window.document.querySelectorAll('button')].find(e => e.textContent === format);
      assert.ok(button);
      const gate = deferred(); globalThis.__onboardingExportGate = gate;
      await act(async () => button.click());
      const signal = globalThis.__onboardingExportStarted;
      assert.ok(signal && !signal.aborted);
      if (transition === 'setUser-storage-error') {
        dom.window.sessionStorage.setItem('client-onboarding:pending-create:101', 'draft A');
        dom.window.Storage.prototype.removeItem = () => {
          assert.equal(signal.aborted, true, 'abort must precede draft cleanup');
          throw Error('storage failed');
        };
      }
      await act(async () => {
        const pending = transition === 'logout' ? auth.logout() : transition === 'setUser-storage-error' ?
          (assert.throws(() => auth.setUser(b), /storage failed/), null) : (auth.setUser(b), null);
        assert.equal(signal.aborted, true, `${transition} aborts in its own call stack`);
        if (pending) await pending;
      });
      if (transition === 'setUser-storage-error') assert.match(dom.window.document.body.textContent, /Nettoyage des brouillons impossible/);
      await act(async () => gate.resolve());
      assert.equal(globalThis.__onboardingExports.length, 0, `${format} cannot save the previous account's document`);
    } finally {
      dom.window.Storage.prototype.removeItem = originalRemove;
      await act(async () => root.unmount());
      Object.assign(globalThis, {...previous, __onboardingExports: previous.exports, __onboardingExportGate: previous.gate, __onboardingExportStarted: previous.started});
      dom.window.close();
    }
  }
});

test('A onboarding 401 during focus /me keeps the real editor and draft if /me confirms A', async () => {
  const dom = new JSDOM('<!doctype html><div id="app"></div>', {url: 'http://localhost/'});
  dom.window.HTMLElement.prototype.attachEvent = () => {};
  dom.window.HTMLElement.prototype.detachEvent = () => {};
  const previous = {window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch};
  Object.assign(globalThis, {window: dom.window, document: dom.window.document});
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const a = {id: 101, prenom: 'A', nom: 'User', email: 'a@example.com', role: 'admin', is_active: true};
  let me = null, expire = false;
  globalThis.fetch = url => {
    if (url === '/api/auth/me') return me ? me.promise : Response.json({user: a});
    if (url === '/api/client-onboardings/options') return expire ? new Response(null, {status: 401}) : Response.json({clients: [{id: 1, nom: 'Client A'}], techniciens: []});
    if (url === '/api/client-onboardings?archived=false') return Response.json([]);
    throw Error(`Unexpected ${url}`);
  };
  const root = createRoot(dom.window.document.getElementById('app'));
  const router = createMemoryRouter([{path: '*', element: React.createElement(RealAuth.App)}], {initialEntries: ['/procedures/prise-en-charge']});
  const title = () => [...dom.window.document.querySelectorAll('label')].find(e => e.textContent === 'Titre')?.querySelector('input');
  try {
    await act(async () => root.render(React.createElement(RealAuth.AuthProvider, null, React.createElement(RouterProvider, {router}))));
    await tick(300);
    await act(async () => Simulate.change(title(), {target: {value: 'A unsaved title'}}));
    dom.window.sessionStorage.setItem(pendingKey(101), 'A recovery');
    me = deferred();
    await act(async () => dom.window.dispatchEvent(new dom.window.Event('focus')));
    assert.ok(title()?.closest('[hidden]'));
    expire = true;
    await act(async () => assert.rejects(RealAuth.getOnboardingOptions(), /Session expirée/));
    assert.equal(title().value, 'A unsaved title');
    assert.ok(title().closest('[hidden]'));
    assert.equal(dom.window.sessionStorage.getItem(pendingKey(101)), 'A recovery');
    await act(async () => me.resolve(Response.json({user: a})));
    assert.equal(title().value, 'A unsaved title');
    assert.ok(!title().closest('[hidden]'));
    assert.equal(dom.window.sessionStorage.getItem(pendingKey(101)), 'A recovery');
  } finally {await act(async () => root.unmount()); Object.assign(globalThis, previous); dom.window.close();}
});

test('a delayed A onboarding 401 cannot expire confirmed B or destroy B recovery', async () => {
  const dom = new JSDOM('<!doctype html><div id="app"></div>', {url: 'http://localhost/'});
  const previous = {window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch};
  Object.assign(globalThis, {window: dom.window, document: dom.window.document});
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const a = {id: 101, prenom: 'A', nom: 'User', email: 'a@example.com', role: 'admin', is_active: true};
  const b = {...a, id: 202, email: 'b@example.com'};
  const oldRequest = deferred();
  let identity = a, pending;
  globalThis.fetch = url => {
    if (url === '/api/auth/me') return Response.json({user: identity});
    if (url === '/api/client-onboardings/options') return pending ? oldRequest.promise : Response.json({clients: [], techniciens: []});
    throw Error(`Unexpected ${url}`);
  };
  let auth;
  function Probe() {auth = RealAuth.useAuth(); return React.createElement('div', null, auth.user && auth.verified ? `private:${auth.user.id}` : 'hidden');}
  const root = createRoot(dom.window.document.getElementById('app'));
  try {
    await act(async () => root.render(React.createElement(RealAuth.AuthProvider, null, React.createElement(Probe))));
    assert.equal(dom.window.document.body.textContent, 'private:101');
    pending = true;
    const issuedByA = RealAuth.getOnboardingOptions();
    identity = b;
    await act(async () => auth.refresh());
    assert.equal(dom.window.document.body.textContent, 'private:202');
    dom.window.sessionStorage.setItem(pendingKey(202), 'B recovery');
    await act(async () => {oldRequest.resolve(new Response(null, {status: 401})); await assert.rejects(issuedByA, /Session expirée/);});
    assert.equal(dom.window.document.body.textContent, 'private:202');
    assert.equal(dom.window.sessionStorage.getItem(pendingKey(202)), 'B recovery');
  } finally {await act(async () => root.unmount()); Object.assign(globalThis, previous); dom.window.close();}
});

test('current onboarding 401 aborts in-flight unsaved PDF and Excel before React cleanup or download', async () => {
  for (const format of ['PDF', 'Excel']) {
    const dom = new JSDOM('<!doctype html><div id="app"></div>', {url: 'http://localhost/'});
    // React's legacy input polyfill expects these IE hooks when jsdom is installed after react-dom.
    dom.window.HTMLElement.prototype.attachEvent = () => {};
    dom.window.HTMLElement.prototype.detachEvent = () => {};
    const previous = {window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, exports: globalThis.__onboardingExports, gate: globalThis.__onboardingExportGate, started: globalThis.__onboardingExportStarted};
    Object.assign(globalThis, {window: dom.window, document: dom.window.document, __onboardingExports: []});
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const a = {id: 101, prenom: 'A', nom: 'User', email: 'a@example.com', role: 'admin', is_active: true};
    let expire = false;
    globalThis.fetch = url => {
      if (url === '/api/auth/me') return Response.json({user: a});
      if (url === '/api/client-onboardings/options') return expire ? new Response(null, {status: 401}) : Response.json({clients: [{id: 1, nom: 'Client A'}], techniciens: []});
      if (url === '/api/client-onboardings?archived=false') return Response.json([]);
      throw Error(`Unexpected ${url}`);
    };
    const root = createRoot(dom.window.document.getElementById('app'));
    const router = createMemoryRouter([{path: '*', element: React.createElement(RealAuth.App)}], {initialEntries: ['/procedures/prise-en-charge']});
    const button = () => [...dom.window.document.querySelectorAll('button')].find(e => e.textContent === format);
    const title = () => [...dom.window.document.querySelectorAll('label')].find(e => e.textContent === 'Titre')?.querySelector('input');
    try {
      await act(async () => root.render(React.createElement(RealAuth.AuthProvider, null, React.createElement(RouterProvider, {router}))));
      await tick(300);
      await act(async () => Simulate.change(title(), {target: {value: `Brouillon secret ${format}`}}));
      const gate = deferred(); globalThis.__onboardingExportGate = gate;
      await act(async () => button().click());
      const signal = globalThis.__onboardingExportStarted;
      assert.ok(signal && !signal.aborted);
      expire = true;
      await act(async () => {
        await assert.rejects(RealAuth.getOnboardingOptions(), /Session expirée/);
        assert.equal(signal.aborted, true, '401 must abort in its event call stack, not after React commits');
      });
      assert.equal(dom.window.sessionStorage.getItem(pendingKey(101)), null);
      await act(async () => gate.resolve());
      assert.equal(globalThis.__onboardingExports.length, 0, `${format} cannot download after 401`);
      assert.ok(!title(), 'expired editor unmounted after React commits');
    } finally {
      await act(async () => root.unmount());
      Object.assign(globalThis, {...previous, __onboardingExports: previous.exports, __onboardingExportGate: previous.gate, __onboardingExportStarted: previous.started});
      dom.window.close();
    }
  }
});

test('real App retains unsaved title and notes across unverified focus/visibility and discards them on B', async () => {
  const dom = new JSDOM('<!doctype html><div id="app"></div>', {url: 'http://localhost/'});
  const previous = {window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch};
  Object.assign(globalThis, {window: dom.window, document: dom.window.document});
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const a = {id: 101, prenom: 'A', nom: 'User', email: 'a@example.com', role: 'admin', is_active: true};
  const b = {...a, id: 202, email: 'b@example.com'};
  let identity = a, pending = null, outage = null;
  globalThis.fetch = async url => {
    if (url === '/api/auth/me') return pending ? pending.promise : outage || Response.json({user: identity});
    if (url.endsWith('/options')) return Response.json({clients: [{id: 1, nom: 'Québec'}], techniciens: []});
    if (url === '/api/client-onboardings?archived=false') return Response.json([]);
    throw Error(`Unexpected ${url}`);
  };
  const root = createRoot(dom.window.document.getElementById('app'));
  const router = createMemoryRouter([{path: '*', element: React.createElement(RealAuth.App)}], {initialEntries: ['/procedures/prise-en-charge']});
  const title = () => [...dom.window.document.querySelectorAll('label')].find(e => e.textContent === 'Titre')?.querySelector('input');
  const notes = () => [...dom.window.document.querySelectorAll('label')].find(e => e.textContent.startsWith('Réponse / notes / preuves'))?.querySelector('textarea');
  const edit = async (element, value) => {
    await act(async () => {
      Simulate.change(element, {target: {value}});
    });
  };
  try {
    await act(async () => root.render(React.createElement(RealAuth.AuthProvider, null, React.createElement(RouterProvider, {router}))));
    await tick(300);
    assert.ok(title() && notes(), 'real editor is mounted');
    await edit(title(), 'Titre non sauvegardé A');
    await edit(notes(), 'Notes non sauvegardées A');
    assert.equal(title().value, 'Titre non sauvegardé A');
    assert.equal(notes().value, 'Notes non sauvegardées A');
    for (const event of ['focus', 'visibilitychange']) {
      pending = deferred();
      if (event === 'visibilitychange') Object.defineProperty(dom.window.document, 'visibilityState', {configurable: true, value: 'visible'});
      await act(async () => (event === 'focus' ? dom.window : dom.window.document).dispatchEvent(new dom.window.Event(event)));
      assert.ok(title(), 'editor remains mounted while identity is unknown');
      assert.ok(title().closest('[hidden]'), 'editor is visually hidden');
      assert.ok(title().closest('[inert]'), 'editor is not interactive');
      assert.ok(title().closest('[aria-hidden="true"]'), 'editor is absent from accessibility tree');
      await act(async () => pending.resolve(Response.json({user: a})));
      pending = null;
      assert.equal(title().value, 'Titre non sauvegardé A');
      assert.equal(notes().value, 'Notes non sauvegardées A');
      assert.ok(!title().closest('[hidden]'));
    }
    for (const failure of [Response.json({error: 'down'}, {status: 503}), Error('offline')]) {
      outage = failure;
      await act(async () => dom.window.dispatchEvent(new dom.window.Event('focus')));
      assert.ok(title()?.closest('[hidden]'), 'unknown identity never shows A');
      assert.equal(title().value, 'Titre non sauvegardé A');
      outage = null;
      await act(async () => dom.window.dispatchEvent(new dom.window.Event('focus')));
      assert.equal(title().value, 'Titre non sauvegardé A');
      assert.equal(notes().value, 'Notes non sauvegardées A');
    }
    identity = b;
    await act(async () => dom.window.dispatchEvent(new dom.window.Event('focus')));
    await tick(300);
    assert.ok(title(), 'B has a fresh editor');
    assert.notEqual(title().value, 'Titre non sauvegardé A');
    assert.notEqual(notes().value, 'Notes non sauvegardées A');
    assert.doesNotMatch(dom.window.document.body.textContent, /Titre non sauvegardé A|Notes non sauvegardées A/);
    dom.window.sessionStorage.setItem(pendingKey(202), 'B private draft');
    outage = new Response(null, {status: 401});
    await act(async () => dom.window.dispatchEvent(new dom.window.Event('focus')));
    assert.equal(title(), undefined, 'confirmed expiry unmounts the authenticated editor');
    assert.equal(dom.window.sessionStorage.getItem(pendingKey(202)), null);
  } finally {await act(async () => root.unmount()); Object.assign(globalThis, previous); dom.window.close();}
});

test('persisted client selector is locked while a new draft may choose another client', async () => {
  const dom=new JSDOM('<!doctype html><div id="app"></div>',{url:'http://localhost/'});
  const previous={window:globalThis.window,document:globalThis.document,fetch:globalThis.fetch};
  Object.assign(globalThis,{window:dom.window,document:dom.window.document});
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  dom.window.confirm=()=>true;
  const saved={...record(9),client_nom:'Client A'};
  let puts=0;
  globalThis.fetch=async(url,options={})=>{
    if(url.endsWith('/options')) return Response.json({clients:[{id:1,nom:'Client A'},{id:2,nom:'Client B'}],techniciens:[{id:2,prenom:'Test',nom:'Tech',email:'t@example.com'}]});
    if(url==='/api/client-onboardings?archived=false') return Response.json([saved]);
    if(url==='/api/client-onboardings/9'&&options.method==='PUT'){puts++;return Response.json(saved);}
    if(url==='/api/client-onboardings/9') return Response.json(saved);
    if(url.includes('/9/history?')) return Response.json({events:[],nextBefore:null});
    throw Error(`Unexpected ${url}`);
  };
  const root=createRoot(dom.window.document.getElementById('app'));
  const client=()=>[...dom.window.document.querySelectorAll('label')].find(e=>e.textContent.startsWith('Client'))?.querySelector('select');
  const button=text=>[...dom.window.document.querySelectorAll('button')].find(e=>e.textContent===text);
  try {
    await act(async()=>root.render(React.createElement(RouterProvider,{router:createMemoryRouter([{path:'/',element:React.createElement(Page)}])})));
    await tick(300);
    assert.equal(client().matches(':disabled'),false,'draft client is selectable');
    await act(async()=>{client().value='2';Simulate.change(client());});
    assert.equal(client().value,'2');
    await act(async()=>[...dom.window.document.querySelectorAll('button')].find(e=>e.textContent.includes('Client A')).click());
    assert.equal(client().value,'1');
    assert.equal(client().matches(':disabled'),true,'saved dossier client cannot be changed');
    assert.equal(button('Sauvegarder').disabled,false,'unfinished dossier remains editable');
    assert.match(dom.window.document.body.textContent,/Créer un nouveau dossier pour un autre client/);
    await act(async()=>{client().value='2';Simulate.change(client());});
    assert.equal(client().value,'1','forged change event must not change saved client');
    assert.equal(puts,0);
    await act(async()=>button('Nouvelle').click());
    assert.equal(client().matches(':disabled'),false);
  } finally {await act(async()=>root.unmount());Object.assign(globalThis,previous);dom.window.close();}
});

test('saved Fait is read-only but retains history and exports after archive/restore', async () => {
  const dom = new JSDOM('<!doctype html><div id="app"></div>', {url: 'http://localhost/'});
  const previous = {window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch};
  Object.assign(globalThis, {window: dom.window, document: dom.window.document});
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.__onboardingExports = [];
  let row = {...record(9), items: [{section_key:'general',section_title:'Général',item_order:1,checked:true,element:'Vérification',notes:'Preuve'}, {section_key:'general',section_title:'Général',item_order:2,checked:false,element:'Deuxième vérification',notes:'Autre preuve'}]};
  dom.window.confirm = () => true;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push([url,options.method]);
    if (url.endsWith('/options')) return Response.json({clients:[{id:1,nom:'Québec'}],techniciens:[{id:2,prenom:'Test',nom:'Tech',email:'t@example.com'}]});
    if (url.startsWith('/api/client-onboardings?')) return Response.json(url.includes('archived=true') === !!row.archived ? [row] : []);
    if (url === '/api/client-onboardings/9' && options.method === 'PUT') {
      row = {...row,...JSON.parse(options.body).onboarding,version:row.version+1};
      return Response.json(row);
    }
    if (url === '/api/client-onboardings/9' && options.method === 'DELETE') {row = {...row,archived:true,version:row.version+1};return Response.json({success:true});}
    if (url === '/api/client-onboardings/9/restore' && options.method === 'POST') {row = {...row,archived:false,version:row.version+1};return Response.json(row);}
    if (url === '/api/client-onboardings/9') return Response.json(row);
    if (url.includes('/9/history?')) return Response.json({events:[{id:1,event_type:'updated',created_at:'2026-01-01',actor_email:'t@example.com',snapshot:{onboarding:{client_id:1},items:[]}}],nextBefore:null});
    throw Error(`Unexpected ${url}`);
  };
  const root=createRoot(dom.window.document.getElementById('app'));
  const button=text=>[...dom.window.document.querySelectorAll('button')].find(e=>e.textContent===text);
  try {
    await act(async()=>root.render(React.createElement(RouterProvider,{router:createMemoryRouter([{path:'/',element:React.createElement(Page)}])})));
    await tick(300);
    await act(async()=>[...dom.window.document.querySelectorAll('button')].find(e=>e.textContent.includes('Dossier 9')).click());
    assert.equal(button('Sauvegarder').disabled,false,'checked item alone must not lock edit');
    const status=[...dom.window.document.querySelectorAll('label')].find(e=>e.textContent.startsWith('Statut')).querySelector('select');
    await act(async()=>{status.value='Fait';Simulate.change(status);});
    assert.equal(button('Sauvegarder').disabled,false,'Fait draft needs its confirmation save');
    await act(async()=>button('Sauvegarder').click());
    assert.equal(row.statut,'Fait');
    assert.equal(button('Sauvegarder').disabled,true);
    const lockedQuestions = [...dom.window.document.querySelectorAll('fieldset[data-question-order]')];
    assert.equal(lockedQuestions.length, 2);
    assert.ok(lockedQuestions.every(fieldset => [...fieldset.querySelectorAll('input,textarea,select')].every(control => control.matches(':disabled'))), 'all visible questions are locked');
    for(const label of ['Client','Technicien Prime','Statut','Priorité','Titre','Réponse / notes / preuves','Résumé exécutif']) {
      const control=[...dom.window.document.querySelectorAll('label')].find(e=>e.textContent.startsWith(label))?.querySelector('input,select,textarea');
      assert.ok(control?.matches(':disabled'),`${label} is read-only`);
    }
    assert.match(dom.window.document.body.textContent,/Dossier terminé en lecture seule/);
    assert.equal(button('PDF').disabled,false);
    assert.equal(button('Excel').disabled,false);
    assert.match(dom.window.document.body.textContent,/Historique/);
    await act(async()=>button('Archiver').click());
    await tick(300);
    await act(async()=>[...dom.window.document.querySelectorAll('button')].find(e=>e.textContent.includes('Dossier 9')).click());
    await act(async()=>button('Restaurer').click());
    assert.equal(button('Sauvegarder').disabled,true,'restore must not unlock saved completion');
    assert.equal(requests.filter(([url,method])=>url==='/api/client-onboardings/9'&&method==='PUT').length,1);
  } finally {await act(async()=>root.unmount());Object.assign(globalThis,previous);dom.window.close();}
});

test('opening and saving a persisted empty checklist keeps its items empty', async () => {
  const dom = new JSDOM('<!doctype html><div id="app"></div>', {url: 'http://localhost/'});
  const previous = {window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch};
  Object.assign(globalThis, {window: dom.window, document: dom.window.document});
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const saved = [];
  globalThis.fetch = async (url, options = {}) => {
    if (url.endsWith('/options')) return Response.json({clients: [{id: 1, nom: 'Québec'}], techniciens: [{id: 2, prenom: 'Test', nom: 'Tech', email: 't@example.com'}]});
    if (url === '/api/client-onboardings?archived=false') return Response.json([record(9)]);
    if (url === '/api/client-onboardings/9' && options.method === 'PUT') {
      saved.push(JSON.parse(options.body));
      return Response.json({...record(9), ...saved.at(-1).onboarding, version: 2, items: []});
    }
    if (url === '/api/client-onboardings/9') return Response.json(record(9));
    if (url.includes('/9/history?')) return Response.json({history: [], hasMore: false, nextBefore: null});
    throw Error(`Unexpected ${url}`);
  };
  const root = createRoot(dom.window.document.getElementById('app'));
  try {
    await act(async () => root.render(React.createElement(RouterProvider, {router: createMemoryRouter([{path: '/', element: React.createElement(Page)}])})));
    await tick(300);
    await act(async () => [...dom.window.document.querySelectorAll('button')].find(e => e.textContent.includes('Dossier 9')).click());
    assert.match(dom.window.document.body.textContent, /Sections · 0\/0 faits/);
    await act(async () => [...dom.window.document.querySelectorAll('button')].find(e => e.textContent === 'Sauvegarder').click());
    assert.equal(saved.length, 1, 'existing dossier is updated');
    assert.deepEqual(saved[0].items, [], 'saving does not inject the 123 template items');
    assert.match(dom.window.document.body.textContent, /Sections · 0\/0 faits/);
  } finally {await act(async () => root.unmount()); Object.assign(globalThis, previous); dom.window.close();}
});

test('new dossiers retain the template while a populated dossier retains its saved items', async () => {
  const dom = new JSDOM('<!doctype html><div id="app"></div>', {url: 'http://localhost/'});
  const previous = {window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch};
  Object.assign(globalThis, {window: dom.window, document: dom.window.document});
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const item = {section_key: 'custom', section_title: 'Section sauvegardée', item_order: 1, checked: true, element: 'Vérification conservée', notes: 'Preuve conservée'};
  let savedItems;
  globalThis.fetch = async (url, options = {}) => {
    if (url.endsWith('/options')) return Response.json({clients: [{id: 1, nom: 'Québec'}], techniciens: [{id: 2, prenom: 'Test', nom: 'Tech', email: 't@example.com'}]});
    if (url === '/api/client-onboardings?archived=false') return Response.json([record(9)]);
    if (url === '/api/client-onboardings/9' && options.method === 'PUT') {
      savedItems = JSON.parse(options.body).items;
      return Response.json({...record(9), items: savedItems, version: 2});
    }
    if (url === '/api/client-onboardings/9') return Response.json({...record(9), items: [item]});
    if (url.includes('/9/history?')) return Response.json({history: [], hasMore: false, nextBefore: null});
    throw Error(`Unexpected ${url}`);
  };
  const root = createRoot(dom.window.document.getElementById('app'));
  const button = text => [...dom.window.document.querySelectorAll('button')].find(e => e.textContent === text);
  try {
    await act(async () => root.render(React.createElement(RouterProvider, {router: createMemoryRouter([{path: '/', element: React.createElement(Page)}])})));
    await tick(300);
    assert.match(dom.window.document.body.textContent, /Sections · 0\/123 faits/, 'initial new dossier has the template');
    assert.equal(dom.window.document.querySelectorAll('nav button').length, 11, 'all eleven template sections are selectable');
    assert.ok(dom.window.document.querySelectorAll('fieldset[data-question-order]').length > 1, 'template section displays multiple questions');
    await act(async () => [...dom.window.document.querySelectorAll('button')].find(e => e.textContent.includes('Dossier 9')).click());
    assert.match(dom.window.document.body.textContent, /Sections · 1\/1 faits/);
    assert.match(dom.window.document.body.textContent, /Vérification conservée/);
    await act(async () => button('Sauvegarder').click());
    assert.deepEqual(savedItems, [item], 'normal dossier saves its persisted checklist, not the template');
    await act(async () => button('Nouvelle').click());
    assert.match(dom.window.document.body.textContent, /Sections · 0\/123 faits/, 'new blank dossier gets the template again');
  } finally {await act(async () => root.unmount()); Object.assign(globalThis, previous); dom.window.close();}
});

test('section editor keeps simultaneous edits, item order, and save state across sections', async () => {
  const dom = new JSDOM('<!doctype html><div id="app"></div>', {url: 'http://localhost/'});
  const previous = {window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch};
  Object.assign(globalThis, {window: dom.window, document: dom.window.document});
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const original = [
    {section_key: 'alpha', section_title: 'Section A', item_order: 3, checked: false, element: 'Question A1', notes: 'Ancienne preuve'},
    {section_key: 'alpha', section_title: 'Section A', item_order: 7, checked: false, element: 'Question A2', notes: 'À garder', action: 'Action existante'},
    {section_key: 'beta', section_title: 'Section B', item_order: 12, checked: true, element: 'Question B1', notes: 'Preuve B', statut: 'Fait'},
  ];
  let row = {...record(9), items: original};
  let payload;
  globalThis.fetch = async (url, options = {}) => {
    if (url.endsWith('/options')) return Response.json({clients: [{id: 1, nom: 'Client A'}], techniciens: [{id: 2, prenom: 'Test', nom: 'Tech', email: 'test@example.com'}]});
    if (url === '/api/client-onboardings?archived=false') return Response.json([row]);
    if (url === '/api/client-onboardings/9' && options.method === 'PUT') {
      payload = JSON.parse(options.body);
      row = {...row, ...payload.onboarding, items: payload.items, version: 2};
      return Response.json(row);
    }
    if (url === '/api/client-onboardings/9') return Response.json(row);
    if (url.includes('/9/history?')) return Response.json({history: [], nextBefore: null});
    throw Error(`Unexpected ${url}`);
  };
  const root = createRoot(dom.window.document.getElementById('app'));
  const controls = () => [...dom.window.document.querySelectorAll('fieldset[data-question-order]')];
  const section = title => [...dom.window.document.querySelectorAll('nav button')].find(e => e.textContent.includes(title));
  try {
    await act(async () => root.render(React.createElement(RouterProvider, {router: createMemoryRouter([{path: '/', element: React.createElement(Page)}])})));
    await tick(300);
    await act(async () => [...dom.window.document.querySelectorAll('button')].find(e => e.textContent.includes('Dossier 9')).click());
    assert.deepEqual(controls().map(e => e.dataset.questionOrder), ['3', '7'], 'both questions visible at once in original order');
    await act(async () => {
      Simulate.change(controls()[0].querySelector('textarea'), {target: {value: 'Preuve A1 modifiée'}});
      Simulate.change(controls()[0].querySelector('input[type="text"]'), {target: {value: 'Action A1 même cycle'}});
    });
    await act(async () => Simulate.change(controls()[1].querySelector('input[type="checkbox"]'), {target: {checked: true}}));
    await act(async () => Simulate.change(controls()[1].querySelector('input[type="text"]'), {target: {value: 'Action A2 modifiée'}}));
    assert.match(dom.window.document.body.textContent, /Modifications non sauvegardées/);
    assert.match(dom.window.document.body.textContent, /Sections · 2\/3 faits/);
    await act(async () => section('Section B').click());
    assert.deepEqual(controls().map(e => e.dataset.questionOrder), ['12']);
    await act(async () => section('Section A').click());
    assert.equal(controls()[0].querySelector('textarea').value, 'Preuve A1 modifiée');
    assert.equal(controls()[1].querySelector('input[type="checkbox"]').checked, true);
    await act(async () => [...dom.window.document.querySelectorAll('button')].find(e => e.textContent === 'Sauvegarder').click());
    assert.ok(payload, `PUT must occur: ${dom.window.document.body.textContent.slice(0, 500)}`);
    assert.deepEqual(payload.items.map(i => i.item_order), [3, 7, 12]);
    assert.equal(payload.items[0].notes, 'Preuve A1 modifiée');
    assert.equal(payload.items[0].action, 'Action A1 même cycle');
    assert.equal(payload.items[1].notes, 'À garder');
    assert.equal(payload.items[1].checked, true);
    assert.equal(payload.items[1].action, 'Action A2 modifiée');
    assert.deepEqual(payload.items[2], original[2]);
    assert.doesNotMatch(dom.window.document.body.textContent, /Modifications non sauvegardées/);
  } finally {await act(async () => root.unmount()); Object.assign(globalThis, previous); dom.window.close();}
});

test('focus and visibility revalidate cross-tab identity and expiry before showing onboarding', async () => {
  const dom = new JSDOM('<!doctype html><div id="app"></div>', {url: 'http://localhost/'});
  const previous = {window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch};
  Object.assign(globalThis, {window: dom.window, document: dom.window.document});
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const a = {id: 101, prenom: 'A', nom: 'User', email: 'a@example.com', role: 'admin', is_active: true};
  const b = {...a, id: 202, email: 'b@example.com'};
  let meUser = a, check = null;
  globalThis.fetch = async url => {
    if (url === '/api/auth/me') return check ? check.promise : Response.json({user: meUser});
    if (url.endsWith('/options')) return Response.json({clients: [{id: 1, nom: 'Québec'}], techniciens: []});
    if (url === '/api/client-onboardings?archived=false') return Response.json([]);
    throw Error(`Unexpected ${url}`);
  };
  function Shell() { const auth = RealAuth.useAuth(); return auth.user && auth.verified && !auth.loading && React.createElement(RealAuth.Page); }
  const root = createRoot(dom.window.document.getElementById('app'));
  try {
    await act(async () => root.render(React.createElement(RealAuth.AuthProvider, null, React.createElement(RouterProvider, {router: createMemoryRouter([{path: '/', element: React.createElement(Shell)}])}))));
    await tick(300);
    dom.window.sessionStorage.setItem(pendingKey(101), JSON.stringify({requestKey: '5dd87d23-e7ad-4a9e-b993-726f7d40b4a9', onboarding: {client_id: 1, titre: 'Privé 101'}, items: []}));
    check = deferred(); meUser = b;
    await act(async () => dom.window.dispatchEvent(new dom.window.Event('focus')));
    assert.ok(!dom.window.document.body.textContent.includes('Prise en charge client TI'), 'unverified account UI is hidden during focus check');
    await act(async () => check.resolve(Response.json({user: meUser})));
    assert.equal(dom.window.sessionStorage.getItem(pendingKey(101)), null);
    assert.ok(!dom.window.document.body.textContent.includes('Privé 101'));
    await tick(300);
    dom.window.sessionStorage.setItem(pendingKey(202), 'private draft');
    check = deferred(); meUser = null;
    Object.defineProperty(dom.window.document, 'visibilityState', {configurable: true, value: 'visible'});
    await act(async () => dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange')));
    assert.ok(!dom.window.document.body.textContent.includes('Prise en charge client TI'));
    await act(async () => check.resolve(Response.json({error: 'expired'}, {status: 401})));
    assert.equal(dom.window.sessionStorage.getItem(pendingKey(202)), null);
    assert.ok(!dom.window.document.body.textContent.includes('private draft'));
  } finally {await act(async () => root.unmount()); Object.assign(globalThis, previous); dom.window.close();}
});

test('rejected /me on focus hides old data and preserves draft until a different account is confirmed', async () => {
  const dom = new JSDOM('<!doctype html><div id="app"></div>', {url: 'http://localhost/'});
  const previous = {window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch};
  Object.assign(globalThis, {window: dom.window, document: dom.window.document});
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.__onboardingMeThrows = false;
  const a = {id: 101, prenom: 'A', nom: 'User', email: 'a@example.com', role: 'admin', is_active: true};
  const b = {...a, id: 202, email: 'b@example.com'};
  let meUser = a;
  globalThis.fetch = async url => {
    if (url === '/api/auth/me') return Response.json({user: meUser});
    if (url.endsWith('/options')) return Response.json({clients: [{id: 1, nom: 'Québec'}], techniciens: []});
    if (url === '/api/client-onboardings?archived=false') return Response.json([record(9, 'Données privées 101')]);
    throw Error(`Unexpected ${url}`);
  };
  function Shell() {
    const auth = RealAuth.useAuth();
    return auth.user && auth.verified && !auth.loading && React.createElement(React.Fragment, null, React.createElement(RealAuth.Sidebar), React.createElement(RealAuth.Page));
  }
  const root = createRoot(dom.window.document.getElementById('app'));
  try {
    await act(async () => root.render(React.createElement(RealAuth.AuthProvider, null,
      React.createElement(RouterProvider, {router: createMemoryRouter([{path: '/', element: React.createElement(Shell)}])}))));
    await tick(300);
    assert.ok(dom.window.document.body.textContent.includes('Données privées 101'), 'old account data loaded');
    const draft = JSON.stringify({requestKey: '5dd87d23-e7ad-4a9e-b993-726f7d40b4a9', onboarding: {client_id: 1, titre: 'Brouillon privé 101', statut: 'À faire', priorite: 'Moyenne'}, items: [{section_key: 'secret', section_title: 'Section privée', item_order: 1, checked: false, element: 'Secret'}]});
    dom.window.sessionStorage.setItem(pendingKey(101), draft);
    globalThis.__onboardingMeThrows = true;
    await act(async () => dom.window.dispatchEvent(new dom.window.Event('focus')));
    assert.ok(!dom.window.document.body.textContent.includes('Données privées 101'), 'failed revalidation cannot restore old data');
    assert.ok(!dom.window.document.body.textContent.includes('Prise en charge client TI'), 'old account controls remain hidden');
    assert.equal(dom.window.sessionStorage.getItem(pendingKey(101)), draft, 'unknown identity preserves recovery without exposing data');
    globalThis.__onboardingMeThrows = false;
    await act(async () => dom.window.dispatchEvent(new dom.window.Event('focus')));
    await tick(300);
    assert.ok(dom.window.document.body.textContent.includes('Création à vérifier'), 'same account can reopen the uncertain draft');
    assert.equal(dom.window.sessionStorage.getItem(pendingKey(101)), draft);
    globalThis.__onboardingMeThrows = true;
    await act(async () => dom.window.dispatchEvent(new dom.window.Event('focus')));
    assert.ok(!dom.window.document.body.textContent.includes('Brouillon privé 101'));
    globalThis.__onboardingMeThrows = false;
    meUser = b;
    await act(async () => dom.window.dispatchEvent(new dom.window.Event('focus')));
    await tick(300);
    assert.ok(!dom.window.document.body.textContent.includes('Brouillon privé 101'));
    assert.equal(dom.window.sessionStorage.getItem(pendingKey(101)), null);
  } finally {
    await act(async () => root.unmount());
    globalThis.__onboardingMeThrows = false;
    Object.assign(globalThis, previous);
    dom.window.close();
  }
});

test('initial /me network error hides authenticated UI and retains draft until identity is confirmed', async () => {
  const dom = new JSDOM('<!doctype html><div id="app"></div>', {url: 'http://localhost/'});
  const previous = {window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch};
  Object.assign(globalThis, {window: dom.window, document: dom.window.document});
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.__onboardingMeThrows = false;
  dom.window.sessionStorage.setItem(pendingKey(101), JSON.stringify({requestKey: '5dd87d23-e7ad-4a9e-b993-726f7d40b4a9', onboarding: {titre: 'Ancien secret'}, items: []}));
  globalThis.fetch = async url => {
    if (url === '/api/auth/me') throw Error('Network unavailable');
    throw Error(`Unexpected ${url}`);
  };
  function Shell() { const auth = RealAuth.useAuth(); return auth.user && React.createElement(RealAuth.Page); }
  const root = createRoot(dom.window.document.getElementById('app'));
  try {
    await act(async () => root.render(React.createElement(RealAuth.AuthProvider, null,
      React.createElement(RouterProvider, {router: createMemoryRouter([{path: '/', element: React.createElement(Shell)}])}))));
    assert.ok(!dom.window.document.body.textContent.includes('Prise en charge client TI'));
    assert.ok(!dom.window.document.body.textContent.includes('Ancien secret'));
    assert.ok(dom.window.sessionStorage.getItem(pendingKey(101))?.includes('Ancien secret'));
  } finally {
    await act(async () => root.unmount());
    Object.assign(globalThis, previous);
    dom.window.close();
  }
});

test('onboarding API 401 invalidates real auth and removes the previous account draft', async () => {
  const dom = new JSDOM('<!doctype html><div id="app"></div>', {url: 'http://localhost/'});
  const previous = {window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch};
  Object.assign(globalThis, {window: dom.window, document: dom.window.document});
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const a = {id: 101, prenom: 'A', nom: 'User', email: 'a@example.com', role: 'admin', is_active: true};
  let expired = false;
  globalThis.fetch = async url => {
    if (url === '/api/auth/me') return Response.json({user: a});
    if (url.endsWith('/options')) return Response.json({clients: [{id: 1, nom: 'Québec'}], techniciens: []});
    if (url.startsWith('/api/client-onboardings?') && url.includes('archived=false')) return expired ? Response.json({error: 'Expired'}, {status: 401}) : Response.json([]);
    throw Error(`Unexpected ${url}`);
  };
  function Shell() { const auth = RealAuth.useAuth(); return auth.user && React.createElement(RealAuth.Page); }
  const root = createRoot(dom.window.document.getElementById('app'));
  try {
    await act(async () => root.render(React.createElement(RealAuth.AuthProvider, null, React.createElement(RouterProvider, {router: createMemoryRouter([{path: '/', element: React.createElement(Shell)}])}))));
    await tick(300);
    dom.window.sessionStorage.setItem(pendingKey(101), 'private draft');
    expired = true;
    await act(async () => dom.window.document.querySelector('input[aria-label="Rechercher"]').dispatchEvent(new dom.window.Event('input', {bubbles: true})));
    const filter = dom.window.document.querySelector('select[aria-label="Filtrer par statut"]');
    await act(async () => {filter.value = 'Fait'; filter.dispatchEvent(new dom.window.Event('change', {bubbles: true}));});
    await tick(300);
    assert.equal(dom.window.sessionStorage.getItem(pendingKey(101)), null);
    assert.ok(!dom.window.document.body.textContent.includes('Prise en charge client TI'));
    assert.ok(!dom.window.document.body.textContent.includes('private draft'));
  } finally {await act(async () => root.unmount()); Object.assign(globalThis, previous); dom.window.close();}
});

test('real auth switch and logout destroy the prior full pending draft, including after page navigation', async () => {
  const dom = new JSDOM('<!doctype html><div id="app"></div>', {url: 'http://localhost/'});
  const previous = {window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch};
  Object.assign(globalThis, {window: dom.window, document: dom.window.document});
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const prompts = [];
  let allowLogout = false;
  dom.window.confirm = text => {prompts.push(text); return allowLogout;};
  let logouts = 0, setUser;
  const a = {id: 101, prenom: 'A', nom: 'User', email: 'a@example.com', role: 'admin', is_active: true};
  const b = {...a, id: 202, email: 'b@example.com'};
  globalThis.fetch = async (url, options = {}) => {
    if (url === '/api/auth/me') return Response.json({user: a});
    if (url === '/api/auth/logout') {logouts++; return Response.json({success: true});}
    if (url.endsWith('/options')) return Response.json({clients: [{id: 1, nom: 'Québec'}], techniciens: []});
    if (url === '/api/client-onboardings?archived=false') return Response.json([]);
    if (url === '/api/client-onboardings' && options.method === 'POST') return Response.json({error: 'Timeout'}, {status: 503});
    throw Error(`Unexpected ${url}`);
  };
  function Shell() {
    const auth = RealAuth.useAuth(); setUser = auth.setUser;
    return auth.user && React.createElement(React.Fragment, null, React.createElement(RealAuth.Sidebar),
      React.createElement('div', null, React.createElement(RealAuth.Page)));
  }
  const root = createRoot(dom.window.document.getElementById('app'));
  const button = text => [...dom.window.document.querySelectorAll('button')].find(e => e.textContent.includes(text));
  try {
    const router = createMemoryRouter([{path: '/', element: React.createElement(Shell)}, {path: '/else', element: React.createElement(Shell)}]);
    await act(async () => root.render(React.createElement(RealAuth.AuthProvider, null, React.createElement(RouterProvider, {router}))));
    await tick(300);
    const client = [...dom.window.document.querySelectorAll('select')].find(e => e.parentElement.textContent.startsWith('Client'));
    await act(async () => {client.value = '1'; client.dispatchEvent(new dom.window.Event('change', {bubbles: true}));});
    await act(async () => button('Sauvegarder').click());
    assert.ok(dom.window.sessionStorage.getItem(pendingKey(101))?.includes('requestKey'));
    await act(async () => setUser(b));
    assert.equal(dom.window.sessionStorage.getItem(pendingKey(101)), null, 'switch removes prior full draft before another account uses the tab');
    assert.ok(!dom.window.document.body.textContent.includes('Création à vérifier'));
    await act(async () => setUser(a));
    assert.ok(!dom.window.document.body.textContent.includes('Création à vérifier'), 'old account cannot recover discarded draft');
    const nextClient = [...dom.window.document.querySelectorAll('select')].find(e => e.parentElement.textContent.startsWith('Client'));
    await act(async () => {nextClient.value = '1'; nextClient.dispatchEvent(new dom.window.Event('change', {bubbles: true}));});
    await act(async () => button('Sauvegarder').click());
    await act(async () => button('Se déconnecter').click());
    assert.equal(logouts, 0, 'declined warning keeps session and recovery');
    assert.ok(dom.window.sessionStorage.getItem(pendingKey(101)));
    allowLogout = true;
    await act(async () => button('Se déconnecter').click());
    assert.equal(logouts, 1);
    assert.equal(dom.window.sessionStorage.getItem(pendingKey(101)), null, 'logout destroys full draft');
    assert.ok(prompts.some(p => p.includes('création') && p.includes('récupération')), 'uncertain POST loss is explicit');
  } finally {await act(async () => root.unmount()); Object.assign(globalThis, previous); dom.window.close();}
});

test('real auth expiry purges the draft after navigation; removal failure blocks logout before the API', async () => {
  const dom = new JSDOM('<!doctype html><div id="app"></div>', {url: 'http://localhost/'});
  const previous = {window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch};
  Object.assign(globalThis, {window: dom.window, document: dom.window.document});
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.confirm = () => true;
  const storage = dom.window.sessionStorage;
  const draft = JSON.stringify({requestKey: '5dd87d23-e7ad-4a9e-b993-726f7d40b4a9', onboarding: {client_id: 1, titre: 'Privé'}, items: []});
  let setUser, refresh, logouts = 0, failRemoval = false;
  const a = {id: 101, prenom: 'A', nom: 'User', email: 'a@example.com', role: 'admin', is_active: true};
  let meUser = a;
  globalThis.fetch = async url => {
    if (url === '/api/auth/me') return meUser === null ? Response.json({error: 'expired'}, {status: 401}) : Response.json({user: meUser});
    if (url === '/api/auth/logout') {logouts++; return Response.json({success: true});}
    if (url.endsWith('/options')) return Response.json({clients: [{id: 1, nom: 'Québec'}], techniciens: []});
    if (url === '/api/client-onboardings?archived=false') return Response.json([]);
    throw Error(`Unexpected ${url}`);
  };
  function Shell({page = false}) {
    const auth = RealAuth.useAuth(); setUser = auth.setUser; refresh = auth.refresh;
    return auth.user && React.createElement(React.Fragment, null, React.createElement(RealAuth.Sidebar), page && React.createElement(RealAuth.Page));
  }
  const root = createRoot(dom.window.document.getElementById('app'));
  try {
    const router = createMemoryRouter([{path: '/', element: React.createElement(Shell, {page: true})}, {path: '/else', element: React.createElement(Shell)}]);
    await act(async () => root.render(React.createElement(RealAuth.AuthProvider, null, React.createElement(RouterProvider, {router}))));
    await tick(300);
    storage.setItem(pendingKey(101), draft);
    await act(async () => router.navigate('/else'));
    assert.equal(storage.getItem(pendingKey(101)), draft, 'navigation preserves recovery');
    meUser = null;
    await act(async () => refresh());
    assert.equal(storage.getItem(pendingKey(101)), null, 'session expiry removes draft even with page unmounted');
    await act(async () => setUser(a));
    storage.setItem(pendingKey(101), draft);
    await act(async () => [...dom.window.document.querySelectorAll('button')].find(e => e.textContent.includes('Se déconnecter')).click());
    assert.equal(logouts, 1, 'logout works when onboarding page is unmounted');
    assert.equal(storage.getItem(pendingKey(101)), null, 'off-page logout destroys the full draft');
    await act(async () => setUser(a));
    storage.setItem(pendingKey(101), draft);
    Object.defineProperty(dom.window, 'sessionStorage', {configurable: true, value: {
      get length() {return storage.length;}, key: index => storage.key(index), getItem: key => storage.getItem(key),
      removeItem: key => {if (failRemoval) throw Error('Removal denied'); storage.removeItem(key);},
    }});
    failRemoval = true;
    await act(async () => [...dom.window.document.querySelectorAll('button')].find(e => e.textContent.includes('Se déconnecter')).click());
    assert.equal(logouts, 1, 'failed purge prevents another server logout');
    assert.equal(storage.getItem(pendingKey(101)), draft);
    assert.ok(dom.window.document.body.textContent.includes('Removal denied'), 'failure is visible');
  } finally {await act(async () => root.unmount()); Object.assign(globalThis, previous); dom.window.close();}
});

test('uncertain POST survives navigation/remount and retries the original draft with the same UUID only after absence confirmation', async () => {
  const dom = new JSDOM('<!doctype html><div id="app"></div>', {url: 'http://localhost/'});
  const previous = {window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch};
  const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.assign(globalThis, {window: dom.window, document: dom.window.document});
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const key = '5dd87d23-e7ad-4a9e-b993-726f7d40b4a9';
  Object.defineProperty(globalThis, 'crypto', {configurable: true, value: {randomUUID: () => key}});
  dom.window.confirm = () => true;
  const bodies = [];
  const reconciled = [];
  globalThis.fetch = async (url, options = {}) => {
    if (url.endsWith('/options')) return Response.json({clients: [{id: 1, nom: 'Québec'}], techniciens: []});
    if (url === '/api/client-onboardings?archived=false') return Response.json([]);
    if (url === `/api/client-onboardings/reconcile?requestKey=${key}`) {reconciled.push(url); return Response.json({found: false});}
    if (url === '/api/client-onboardings' && options.method === 'POST') {
      const pending = JSON.parse(dom.window.sessionStorage.getItem(pendingKey()));
      assert.equal(pending.requestKey, key, 'draft is durable before request leaves browser');
      bodies.push(JSON.parse(options.body));
      return bodies.length === 1 ? Response.json({error: 'Timeout'}, {status: 503}) : Response.json(record(10));
    }
    if (url.includes('/10/history?')) return Response.json({history: [], hasMore: false, nextBefore: null});
    throw Error(`Unexpected ${url}`);
  };
  const root = createRoot(dom.window.document.getElementById('app'));
  const button = text => [...dom.window.document.querySelectorAll('button')].find(e => e.textContent === text);
  try {
    const router = createMemoryRouter([{path: '/', element: React.createElement(Page)}, {path: '/else', element: React.createElement('p', null, 'Else')}]);
    await act(async () => root.render(React.createElement(RouterProvider, {router})));
    await tick(300);
    const client = [...dom.window.document.querySelectorAll('select')].find(e => e.parentElement.textContent.startsWith('Client'));
    await act(async () => {client.value = '1'; client.dispatchEvent(new dom.window.Event('change', {bubbles: true}));});
    await act(async () => button('Sauvegarder').click());
    assert.equal(bodies.length, 1);
    await act(async () => router.navigate('/else'));
    assert.ok(dom.window.sessionStorage.getItem(pendingKey()));
    await act(async () => router.navigate('/'));
    await tick(300);
    assert.equal(button('Sauvegarder').disabled, true);
    assert.equal(button('Nouvelle').disabled, true);
    assert.equal([...dom.window.document.querySelectorAll('input')].find(e => e.parentElement.textContent === 'Titre').value, 'Prise en charge client TI');
    await act(async () => button('Vérifier la création').click());
    assert.equal(reconciled.length, 1);
    await act(async () => button('Confirmer l’absence et réessayer').click());
    assert.equal(bodies.length, 2);
    assert.deepEqual(bodies[0], bodies[1]);
    assert.equal(dom.window.sessionStorage.getItem(pendingKey()), null);
  } finally {await act(async () => root.unmount()); Object.assign(globalThis, previous); Object.defineProperty(globalThis, 'crypto', cryptoDescriptor); dom.window.close();}
});

test('failed sessionStorage write blocks create without an untracked POST', async () => {
  const dom = new JSDOM('<!doctype html><div id="app"></div>', {url: 'http://localhost/'});
  const previous = {window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch};
  Object.assign(globalThis, {window: dom.window, document: dom.window.document});
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(dom.window, 'sessionStorage', {configurable: true, value: {
    getItem: () => null, setItem: () => {throw Error('Quota exceeded');}, removeItem: () => {},
  }});
  let posts = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (url.endsWith('/options')) return Response.json({clients: [{id: 1, nom: 'Québec'}], techniciens: []});
    if (url === '/api/client-onboardings?archived=false') return Response.json([]);
    if (options.method === 'POST') posts++;
    throw Error(`Unexpected ${url}`);
  };
  const root = createRoot(dom.window.document.getElementById('app'));
  try {
    await act(async () => root.render(React.createElement(RouterProvider, {router: createMemoryRouter([{path: '/', element: React.createElement(Page)}])})));
    await tick(300);
    const client = [...dom.window.document.querySelectorAll('select')].find(e => e.parentElement.textContent.startsWith('Client'));
    await act(async () => {client.value = '1'; client.dispatchEvent(new dom.window.Event('change', {bubbles: true}));});
    const save = [...dom.window.document.querySelectorAll('button')].find(e => e.textContent === 'Sauvegarder');
    await act(async () => save.click());
    assert.equal(posts, 0);
    assert.equal(save.disabled, true);
    assert.ok(dom.window.document.body.textContent.includes('Quota exceeded'));
  } finally {await act(async () => root.unmount()); Object.assign(globalThis, previous); dom.window.close();}
});

test('silent or altered sessionStorage writes block POST before the request leaves the browser', async () => {
  for (const persist of [false, true]) {
    const dom = new JSDOM('<!doctype html><div id="app"></div>', {url: 'http://localhost/'});
    const previous = {window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch};
    Object.assign(globalThis, {window: dom.window, document: dom.window.document});
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const storage = dom.window.sessionStorage;
    Object.defineProperty(dom.window, 'sessionStorage', {configurable: true, value: {
      getItem: key => storage.getItem(key), setItem: (key, value) => {if (persist) storage.setItem(key, value + ' ');},
      removeItem: key => storage.removeItem(key),
    }});
    let posts = 0;
    globalThis.fetch = async (url, options = {}) => {
      if (url.endsWith('/options')) return Response.json({clients: [{id: 1, nom: 'Québec'}], techniciens: []});
      if (url === '/api/client-onboardings?archived=false') return Response.json([]);
      if (options.method === 'POST') posts++;
      throw Error(`Unexpected ${url}`);
    };
    const root = createRoot(dom.window.document.getElementById('app'));
    try {
      await act(async () => root.render(React.createElement(RouterProvider, {router: createMemoryRouter([{path: '/', element: React.createElement(Page)}])})));
      await tick(300);
      const client = [...dom.window.document.querySelectorAll('select')].find(e => e.parentElement.textContent.startsWith('Client'));
      await act(async () => {client.value = '1'; client.dispatchEvent(new dom.window.Event('change', {bubbles: true}));});
      await act(async () => [...dom.window.document.querySelectorAll('button')].find(e => e.textContent === 'Sauvegarder').click());
      assert.equal(posts, 0);
      assert.ok(dom.window.document.body.textContent.includes('Création bloquée'));
    } finally {await act(async () => root.unmount()); Object.assign(globalThis, previous); dom.window.close();}
  }
});

test('malformed 201 leaves the original pending key for reconciliation and does not retry automatically', async () => {
  const dom = new JSDOM('<!doctype html><div id="app"></div>', {url: 'http://localhost/'});
  const previous = {window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch};
  Object.assign(globalThis, {window: dom.window, document: dom.window.document});
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let posts = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (url.endsWith('/options')) return Response.json({clients: [{id: 1, nom: 'Québec'}], techniciens: []});
    if (url === '/api/client-onboardings?archived=false') return Response.json([]);
    if (url === '/api/client-onboardings' && options.method === 'POST') {posts++; return Response.json({}, {status: 201});}
    throw Error(`Unexpected ${url}`);
  };
  const root = createRoot(dom.window.document.getElementById('app'));
  try {
    await act(async () => root.render(React.createElement(RouterProvider, {router: createMemoryRouter([{path: '/', element: React.createElement(Page)}])})));
    await tick(300);
    const client = [...dom.window.document.querySelectorAll('select')].find(e => e.parentElement.textContent.startsWith('Client'));
    await act(async () => {client.value = '1'; client.dispatchEvent(new dom.window.Event('change', {bubbles: true}));});
    await act(async () => [...dom.window.document.querySelectorAll('button')].find(e => e.textContent === 'Sauvegarder').click());
    assert.equal(posts, 1);
    assert.ok(dom.window.sessionStorage.getItem(pendingKey()));
    assert.ok(dom.window.document.body.textContent.includes('Création non confirmée'));
    assert.equal([...dom.window.document.querySelectorAll('button')].find(e => e.textContent === 'Sauvegarder').disabled, true);
  } finally {await act(async () => root.unmount()); Object.assign(globalThis, previous); dom.window.close();}
});

test('malformed 201 checklist retains original UUID and draft for recoverable reconciliation without crashing React', async () => {
  const dom = new JSDOM('<!doctype html><div id="app"></div>', {url: 'http://localhost/'});
  const previous = {window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch};
  const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const key = '5dd87d23-e7ad-4a9e-b993-726f7d40b4a9';
  Object.assign(globalThis, {window: dom.window, document: dom.window.document});
  Object.defineProperty(globalThis, 'crypto', {configurable: true, value: {randomUUID: () => key}});
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let posts = 0, draft;
  globalThis.fetch = async (url, options = {}) => {
    if (url.endsWith('/options')) return Response.json({clients: [{id: 1, nom: 'Québec'}], techniciens: []});
    if (url === '/api/client-onboardings?archived=false') return Response.json([]);
    if (url === '/api/client-onboardings' && options.method === 'POST') {
      posts++;
      draft = dom.window.sessionStorage.getItem(pendingKey());
      assert.deepEqual(JSON.parse(draft), JSON.parse(options.body));
      return Response.json({...record(10), items: [null]}, {status: 201});
    }
    throw Error(`Unexpected ${url}`);
  };
  const root = createRoot(dom.window.document.getElementById('app'));
  try {
    await act(async () => root.render(React.createElement(RouterProvider, {router: createMemoryRouter([{path: '/', element: React.createElement(Page)}])})));
    await tick(300);
    const client = [...dom.window.document.querySelectorAll('select')].find(e => e.parentElement.textContent.startsWith('Client'));
    await act(async () => {client.value = '1'; client.dispatchEvent(new dom.window.Event('change', {bubbles: true}));});
    await act(async () => [...dom.window.document.querySelectorAll('button')].find(e => e.textContent === 'Sauvegarder').click());
    assert.equal(posts, 1);
    assert.equal(JSON.parse(draft).requestKey, key);
    assert.equal(JSON.parse(draft).items.length, 123);
    assert.equal(dom.window.sessionStorage.getItem(pendingKey()), draft, 'the complete original draft survives the malformed response');
    assert.match(dom.window.document.body.textContent, /Création non confirmée : Réponse de création invalide/);
    assert.ok(dom.window.document.body.textContent.includes(key));
    assert.equal([...dom.window.document.querySelectorAll('button')].find(e => e.textContent === 'Sauvegarder').disabled, true);
    assert.equal([...dom.window.document.querySelectorAll('input')].find(e => e.parentElement.textContent === 'Titre').value, 'Prise en charge client TI');
    assert.match(dom.window.document.body.textContent, /Sections · 0\/123 faits/);
    assert.ok([...dom.window.document.querySelectorAll('button')].some(e => e.textContent === 'Vérifier la création'));
  } finally {
    await act(async () => root.unmount());
    Object.assign(globalThis, previous);
    Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
    dom.window.close();
  }
});

test('unreadable sessionStorage on mount fails closed before any create', async () => {
  const dom = new JSDOM('<!doctype html><div id="app"></div>', {url: 'http://localhost/'});
  const previous = {window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch};
  Object.assign(globalThis, {window: dom.window, document: dom.window.document});
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(dom.window, 'sessionStorage', {configurable: true, get: () => {throw Error('Access denied');}});
  let posts = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (url.endsWith('/options')) return Response.json({clients: [{id: 1, nom: 'Québec'}], techniciens: []});
    if (url === '/api/client-onboardings?archived=false') return Response.json([]);
    if (options.method === 'POST') posts++;
    throw Error(`Unexpected ${url}`);
  };
  const root = createRoot(dom.window.document.getElementById('app'));
  try {
    await act(async () => root.render(React.createElement(RouterProvider, {router: createMemoryRouter([{path: '/', element: React.createElement(Page)}])})));
    await tick(300);
    assert.ok(dom.window.document.body.textContent.includes('Access denied'));
    const save = [...dom.window.document.querySelectorAll('button')].find(e => e.textContent === 'Sauvegarder');
    assert.equal(save.disabled, true);
    await act(async () => save.click());
    assert.equal(posts, 0);
  } finally {await act(async () => root.unmount()); Object.assign(globalThis, previous); dom.window.close();}
});

test('initial list failure displays an error, not an empty-register claim', async () => {
  const dom = new JSDOM('<!doctype html><div id="app"></div>', {url: 'http://localhost/'});
  const previous = {window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch};
  Object.assign(globalThis, {window: dom.window, document: dom.window.document});
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = async url => {
    if (url.endsWith('/options')) return Response.json({clients: [], techniciens: []});
    if (url === '/api/client-onboardings?archived=false') return Response.json({error: 'Liste indisponible'}, {status: 503});
    throw Error(`Unexpected ${url}`);
  };
  const root = createRoot(dom.window.document.getElementById('app'));
  try {
    await act(async () => root.render(React.createElement(RouterProvider, {router: createMemoryRouter([{path: '/', element: React.createElement(Page)}])})));
    await tick(300);
    assert.ok(dom.window.document.body.textContent.includes('Liste indisponible'));
    assert.ok(!dom.window.document.body.textContent.includes('Aucune prise en charge trouvée'));
  } finally {await act(async () => root.unmount()); Object.assign(globalThis, previous); dom.window.close();}
});

// Real React event/render cycles, with only the network mocked.
test('detail pending locks record, new and save controls', async () => {
  const dom = new JSDOM('<!doctype html><div id="app"></div>', {url: 'http://localhost/'});
  const previous = {window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch};
  Object.assign(globalThis, {window: dom.window, document: dom.window.document});
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.confirm = () => true;
  const detail = deferred();
  let listCalls = 0;
  let posts = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (url.endsWith('/options')) return Response.json({clients: [{id: 1, nom: 'Québec'}], techniciens: [{id: 2, prenom: 'Élodie', nom: 'Noël', email: 'e@example.com'}]});
    if (url === '/api/client-onboardings?archived=false') {
      listCalls++;
      return listCalls > 1 ? Response.json({error: 'Liste inaccessible'}, {status: 503}) : Response.json([record(9)]);
    }
    if (url.endsWith('/9/history')) return Response.json({history: [], hasMore: false, nextBefore: null});
    if (url === '/api/client-onboardings/9') return detail.promise;
    if (url === '/api/client-onboardings' && options.method === 'POST') {posts++; return Response.json(record(10, 'Création confirmée'));}
    throw Error(`Unexpected ${url}`);
  };
  const root = createRoot(dom.window.document.getElementById('app'));
  try {
    const router = createMemoryRouter([{path: '/', element: React.createElement(Page)}, {path: '/procedures', element: React.createElement('p', null, 'Procédures')}]);
    await act(async () => root.render(React.createElement(RouterProvider, {router})));
    await tick(300);
    const button = [...dom.window.document.querySelectorAll('button')].find(e => e.textContent.includes('Dossier 9'));
    assert.ok(button, 'record loaded');
    await act(async () => {button.click();});
    assert.equal(button.disabled, true);
    assert.equal([...dom.window.document.querySelectorAll('button')].find(e => e.textContent === 'Nouvelle').disabled, true);
    assert.equal([...dom.window.document.querySelectorAll('button')].find(e => e.textContent === 'Sauvegarder').disabled, true);
    await act(async () => detail.resolve(Response.json(record(9))));
    await tick();
    assert.equal(button.disabled, false);
    assert.ok(dom.window.document.body.textContent.includes('Dossier 9'));
  } finally {
    await act(async () => root.unmount());
    Object.assign(globalThis, previous);
    dom.window.close();
  }
});
test('successful POST survives a failed list refresh and is never retried', async () => {
  const dom = new JSDOM('<!doctype html><div id="app"></div>', {url: 'http://localhost/'});
  const previous = {window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch};
  Object.assign(globalThis, {window: dom.window, document: dom.window.document});
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let posts = 0;
  let listCalls = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (url.endsWith('/options')) return Response.json({clients: [{id: 1, nom: 'Québec'}], techniciens: []});
    if (url === '/api/client-onboardings?archived=false') return ++listCalls === 1 ? Response.json([]) : Response.json({error: 'Liste indisponible'}, {status: 503});
    if (url === '/api/client-onboardings' && options.method === 'POST') {posts++; return Response.json(record(10, 'Création confirmée'));}
    if (url.endsWith('/10/history?limit=50')) return Response.json({history: [], hasMore: false, nextBefore: null});
    throw Error(`Unexpected ${url}`);
  };
  const root = createRoot(dom.window.document.getElementById('app'));
  try {
    const router = createMemoryRouter([{path: '/', element: React.createElement(Page)}, {path: '/procedures', element: React.createElement('p')}], {future: {v7_startTransition: true}});
    await act(async () => root.render(React.createElement(RouterProvider, {router})));
    await tick(300);
    const client = [...dom.window.document.querySelectorAll('select')].find(e => e.parentElement.textContent.startsWith('Client'));
    assert.ok(client);
    await act(async () => {client.value = '1'; client.dispatchEvent(new dom.window.Event('change', {bubbles: true}));});
    assert.equal(client.value, '1');
    const save = [...dom.window.document.querySelectorAll('button')].find(e => e.textContent === 'Sauvegarder');
    await act(async () => save.click());
    await tick();
    assert.equal(posts, 1);
    assert.equal([...dom.window.document.querySelectorAll('input')].find(e => e.parentElement.textContent === 'Titre').value, 'Création confirmée');
    assert.ok(dom.window.document.body.textContent.includes('Liste indisponible'));
    await act(async () => save.click());
    assert.equal(posts, 1, 'second click updates the saved record, not another POST');
  } finally {
    await act(async () => root.unmount());
    Object.assign(globalThis, previous);
    dom.window.close();
  }
});

test('mocked auth isolates page UI by id (real auth lifecycle destroys switched drafts)', async () => {
  const dom = new JSDOM('<!doctype html><div id="app"></div>', {url: 'http://localhost/'});
  const previous = {window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, auth: globalThis.__onboardingAuth, exports: globalThis.__onboardingExports};
  Object.assign(globalThis, {window: dom.window, document: dom.window.document, __onboardingExports: []});
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.confirm = () => true;
  globalThis.__onboardingAuth = {...previous.auth, user: {id: 101}};
  let posts = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (url.endsWith('/options')) return Response.json({clients: [{id: 1, nom: 'Québec'}], techniciens: []});
    if (url === '/api/client-onboardings?archived=false') return Response.json([]);
    if (url === '/api/client-onboardings' && options.method === 'POST') {posts++; return Response.json({error: 'Timeout'}, {status: 503});}
    throw Error(`Unexpected ${url}`);
  };
  const root = createRoot(dom.window.document.getElementById('app'));
  let switchUser;
  function AuthHarness() {
    const [id, setId] = React.useState(101);
    switchUser = setId;
    globalThis.__onboardingAuth = {...previous.auth, user: {id}};
    return React.createElement(Page);
  }
  const router = createMemoryRouter([{path: '/', element: React.createElement(AuthHarness)}]);
  const render = async () => act(async () => root.render(React.createElement(RouterProvider, {router})));
  const button = text => [...dom.window.document.querySelectorAll('button')].find(e => e.textContent === text);
  const title = () => [...dom.window.document.querySelectorAll('input')].find(e => e.parentElement.textContent === 'Titre');
  try {
    await render(); await tick(300);
    const client = [...dom.window.document.querySelectorAll('select')].find(e => e.parentElement.textContent.startsWith('Client'));
    await act(async () => {client.value = '1'; client.dispatchEvent(new dom.window.Event('change', {bubbles: true}));});
    await act(async () => button('Sauvegarder').click());
    assert.equal(posts, 1);
    const draft = JSON.parse(dom.window.sessionStorage.getItem(pendingKey(101)));
    assert.ok(draft);
    draft.onboarding.titre = 'Privé 101';
    dom.window.sessionStorage.setItem(pendingKey(101), JSON.stringify(draft));
    await act(async () => switchUser(202)); await tick(300);
    assert.ok(!dom.window.document.body.textContent.includes('Privé 101'));
    assert.equal(title().value, 'Prise en charge client TI');
    assert.equal(button('Sauvegarder').disabled, false);
    await act(async () => button('Excel').click());
    assert.ok(!JSON.stringify(globalThis.__onboardingExports).includes('Privé 101'));
    assert.ok(dom.window.sessionStorage.getItem(pendingKey(101)));
    const otherClient = [...dom.window.document.querySelectorAll('select')].find(e => e.parentElement.textContent.startsWith('Client'));
    await act(async () => {otherClient.value = '1'; otherClient.dispatchEvent(new dom.window.Event('change', {bubbles: true}));});
    await act(async () => button('Sauvegarder').click());
    assert.equal(posts, 2, 'other account can create independently');
    assert.ok(dom.window.sessionStorage.getItem(pendingKey(202)));
    await act(async () => switchUser(101)); await tick(300);
    assert.equal(title().value, 'Privé 101');
    assert.equal(button('Sauvegarder').disabled, true);
    assert.equal(posts, 2);
  } finally {await act(async () => root.unmount()); Object.assign(globalThis, {...previous, __onboardingAuth: previous.auth, __onboardingExports: previous.exports}); dom.window.close();}
});

test('confirmed POST with failed storage removal applies saved record and blocks fresh POST until cleanup', async () => {
  const dom = new JSDOM('<!doctype html><div id="app"></div>', {url: 'http://localhost/'});
  const previous = {window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch};
  Object.assign(globalThis, {window: dom.window, document: dom.window.document});
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.confirm = () => true;
  const storage = dom.window.sessionStorage;
  let failRemoval = false, silentRemoval = true, posts = 0;
  Object.defineProperty(dom.window, 'sessionStorage', {configurable: true, value: {
    getItem: key => storage.getItem(key), setItem: (key, value) => storage.setItem(key, value),
    removeItem: key => {if (failRemoval) throw Error('Removal denied'); if (!silentRemoval) storage.removeItem(key);},
  }});
  globalThis.fetch = async (url, options = {}) => {
    if (url.endsWith('/options')) return Response.json({clients: [{id: 1, nom: 'Québec'}], techniciens: []});
    if (url === '/api/client-onboardings?archived=false') return Response.json([]);
    if (url === '/api/client-onboardings' && options.method === 'POST') {posts++; return Response.json(record(10, 'Confirmé serveur'));}
    if (url.startsWith('/api/client-onboardings/reconcile?requestKey=')) return Response.json({found: true, id: 10, archived: false});
    if (url === '/api/client-onboardings/10') return Response.json(record(10, 'Confirmé serveur'));
    if (url.includes('/10/history?')) return Response.json({history: [], hasMore: false, nextBefore: null});
    throw Error(`Unexpected ${url}`);
  };
  const root = createRoot(dom.window.document.getElementById('app'));
  const button = text => [...dom.window.document.querySelectorAll('button')].find(e => e.textContent === text);
  try {
    const router = createMemoryRouter([{path: '/', element: React.createElement(Page)}, {path: '/else', element: React.createElement('p', null, 'Else')}]);
    await act(async () => root.render(React.createElement(RouterProvider, {router})));
    await tick(300);
    const client = [...dom.window.document.querySelectorAll('select')].find(e => e.parentElement.textContent.startsWith('Client'));
    await act(async () => {client.value = '1'; client.dispatchEvent(new dom.window.Event('change', {bubbles: true}));});
    await act(async () => button('Sauvegarder').click());
    assert.equal(posts, 1);
    assert.equal([...dom.window.document.querySelectorAll('input')].find(e => e.parentElement.textContent === 'Titre').value, 'Confirmé serveur');
    assert.ok(!dom.window.document.body.textContent.includes('Création non confirmée'));
    assert.ok(dom.window.sessionStorage.getItem(pendingKey()));
    assert.equal(button('Nouvelle').disabled, true, 'silent remove must retain confirmed-create lock');
    assert.ok(dom.window.document.body.textContent.includes('nettoyage du brouillon impossible'));
    await act(async () => button('Nouvelle').click());
    assert.equal(posts, 1);
    silentRemoval = false;
    await act(async () => button('Nettoyer le brouillon confirmé').click());
    assert.equal(dom.window.sessionStorage.getItem(pendingKey()), null);
    assert.equal(button('Nouvelle').disabled, false);
    await act(async () => button('Nouvelle').click());
    assert.equal(button('Sauvegarder').disabled, false);
    const secondClient = [...dom.window.document.querySelectorAll('select')].find(e => e.parentElement.textContent.startsWith('Client'));
    await act(async () => {secondClient.value = '1'; secondClient.dispatchEvent(new dom.window.Event('change', {bubbles: true}));});
    failRemoval = true;
    await act(async () => button('Sauvegarder').click());
    assert.equal(posts, 2);
    await act(async () => router.navigate('/else'));
    await act(async () => router.navigate('/'));
    await tick(300);
    assert.equal(button('Sauvegarder').disabled, true, 'remount keeps durable pending lock');
    assert.equal(button('Nettoyer le brouillon confirmé'), undefined, 'after remount, confirmation must be reconciled');
    await act(async () => button('Vérifier la création').click());
    failRemoval = false;
    await act(async () => [...dom.window.document.querySelectorAll('button')].find(e => e.textContent.startsWith('Ouvrir le dossier trouvé')).click());
    assert.equal(dom.window.sessionStorage.getItem(pendingKey()), null);
    assert.equal(posts, 2);
  } finally {await act(async () => root.unmount()); Object.assign(globalThis, previous); dom.window.close();}
});

test('uncertain creation cannot be cleared by Nouvelle; absence confirmation retries the same key', async () => {
  const dom = new JSDOM('<!doctype html><div id="app"></div>', {url: 'http://localhost/'});
  const previous = {window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch};
  Object.assign(globalThis, {window: dom.window, document: dom.window.document});
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let posts = 0;
  let confirmed = false;
  dom.window.confirm = () => confirmed;
  globalThis.fetch = async (url, options = {}) => {
    if (url.endsWith('/options')) return Response.json({clients: [{id: 1, nom: 'Québec'}], techniciens: []});
    if (url === '/api/client-onboardings?archived=false' || url === '/api/client-onboardings?archived=true') return Response.json([]);
    if (url.startsWith('/api/client-onboardings/reconcile?requestKey=')) return Response.json({found: false});
    if (url === '/api/client-onboardings' && options.method === 'POST') {
      posts++;
      return posts === 1 ? Response.json({error: 'Réseau perdu'}, {status: 503}) : Response.json(record(10));
    }
    if (url.endsWith('/10/history?limit=50')) return Response.json({events: [], nextBefore: null});
    throw Error(`Unexpected ${url}`);
  };
  const root = createRoot(dom.window.document.getElementById('app'));
  const button = text => [...dom.window.document.querySelectorAll('button')].find(e => e.textContent === text);
  try {
    await act(async () => root.render(React.createElement(RouterProvider, {router: createMemoryRouter([{path: '/', element: React.createElement(Page)}])})));
    await tick(300);
    const client = [...dom.window.document.querySelectorAll('select')].find(e => e.parentElement.textContent.startsWith('Client'));
    await act(async () => {client.value = '1'; client.dispatchEvent(new dom.window.Event('change', {bubbles: true}));});
    await act(async () => button('Sauvegarder').click());
    assert.equal(posts, 1);
    confirmed = true; // Allow discarding the draft; this must not waive duplicate verification.
    assert.equal(button('Nouvelle').disabled, true, 'uncertain draft must remain available for reconciliation');
    await act(async () => button('Nouvelle').click());
    assert.equal(button('Sauvegarder').disabled, true, 'Nouvelle must not silently unlock duplicate POST');
    assert.equal(button('Confirmer l’absence et réessayer'), undefined, 'must reconcile by key before retry');
    await act(async () => button('Vérifier la création').click());
    assert.equal(button('Confirmer l’absence et réessayer').disabled, false);
    assert.equal(button('Archives').disabled, true, 'mode switch cannot discard uncertain draft');
    await act(async () => button('Archives').click());
    assert.equal(button('Confirmer l’absence et réessayer').disabled, false, 'blocked mode switch keeps reconciliation');
    const filter = dom.window.document.querySelector('select[aria-label="Filtrer par statut"]');
    await act(async () => {filter.value = 'Fait'; filter.dispatchEvent(new dom.window.Event('change', {bubbles: true})); filter.value = ''; filter.dispatchEvent(new dom.window.Event('change', {bubbles: true}));});
    assert.equal(button('Sauvegarder').disabled, true, 'confirmation cannot use stale render before filter-change state commits');
    assert.equal(button('Confirmer l’absence et réessayer'), undefined, 'filter changes invalidate reconciliation');
    await act(async () => {filter.value = ''; filter.dispatchEvent(new dom.window.Event('change', {bubbles: true}));});
    assert.equal(button('Confirmer l’absence et réessayer'), undefined, 'filter-change-back cannot reuse old result');
    await tick(300);
    assert.equal(button('Confirmer l’absence et réessayer'), undefined, 'automatic reload does not count as explicit reconciliation');
    await act(async () => button('Vérifier la création').click());
    assert.equal(button('Confirmer l’absence et réessayer').disabled, false);
    confirmed = true;
    await act(async () => button('Confirmer l’absence et réessayer').click());
    assert.equal(button('Sauvegarder').disabled, false);
    assert.equal(posts, 2);
  } finally {
    await act(async () => root.unmount());
    Object.assign(globalThis, previous);
    dom.window.close();
  }
});

test('reconciliation ignores an in-flight key response after filter changes and back', async () => {
  const dom = new JSDOM('<!doctype html><div id="app"></div>', {url: 'http://localhost/'});
  const previous = {window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch};
  Object.assign(globalThis, {window: dom.window, document: dom.window.document});
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const pending = deferred();
  globalThis.fetch = async (url, options = {}) => {
    if (url.endsWith('/options')) return Response.json({clients: [{id: 1, nom: 'Québec'}], techniciens: []});
    if (url === '/api/client-onboardings?archived=false' || url.includes('statut=Fait')) return Response.json([]);
    if (url.startsWith('/api/client-onboardings/reconcile?requestKey=')) return pending.promise;
    if (url === '/api/client-onboardings' && options.method === 'POST') return Response.json({error: 'Timeout'}, {status: 503});
    throw Error(`Unexpected ${url}`);
  };
  const root = createRoot(dom.window.document.getElementById('app'));
  const button = text => [...dom.window.document.querySelectorAll('button')].find(e => e.textContent === text);
  try {
    await act(async () => root.render(React.createElement(RouterProvider, {router: createMemoryRouter([{path: '/', element: React.createElement(Page)}])})));
    await tick(300);
    const client = [...dom.window.document.querySelectorAll('select')].find(e => e.parentElement.textContent.startsWith('Client'));
    await act(async () => {client.value = '1'; client.dispatchEvent(new dom.window.Event('change', {bubbles: true}));});
    await act(async () => button('Sauvegarder').click());
    await act(async () => button('Vérifier la création').click());
    const filter = dom.window.document.querySelector('select[aria-label="Filtrer par statut"]');
    await act(async () => {
      filter.value = 'Fait'; filter.dispatchEvent(new dom.window.Event('change', {bubbles: true}));
      filter.value = ''; filter.dispatchEvent(new dom.window.Event('change', {bubbles: true}));
      pending.resolve(Response.json({found: false}));
      await Promise.resolve();
    });
    assert.equal(button('Confirmer l’absence et réessayer'), undefined, 'old response must not validate changed state');
  } finally {
    await act(async () => root.unmount());
    Object.assign(globalThis, previous);
    dom.window.close();
  }
});

test('uncertain POST retains draft and blocks arbitrary row opening', async () => {
  const dom = new JSDOM('<!doctype html><div id="app"></div>', {url: 'http://localhost/'});
  const previous = {window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch};
  Object.assign(globalThis, {window: dom.window, document: dom.window.document});
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.confirm = () => true;
  let posts = 0, gets = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (url.endsWith('/options')) return Response.json({clients: [{id: 1, nom: 'Québec'}], techniciens: []});
    if (url === '/api/client-onboardings?archived=false') return Response.json([record(9, 'Autre dossier')]);
    if (url === '/api/client-onboardings' && options.method === 'POST') {posts++; return Response.json({error: 'Timeout'}, {status: 503});}
    if (url === '/api/client-onboardings/9') {gets++; return Response.json(record(9));}
    throw Error(`Unexpected ${url}`);
  };
  const root = createRoot(dom.window.document.getElementById('app'));
  const button = text => [...dom.window.document.querySelectorAll('button')].find(e => e.textContent.includes(text));
  try {
    await act(async () => root.render(React.createElement(RouterProvider, {router: createMemoryRouter([{path: '/', element: React.createElement(Page)}])})));
    await tick(300);
    const client = [...dom.window.document.querySelectorAll('select')].find(e => e.parentElement.textContent.startsWith('Client'));
    await act(async () => {client.value = '1'; client.dispatchEvent(new dom.window.Event('change', {bubbles: true}));});
    await act(async () => button('Sauvegarder').click());
    await act(async () => button('Autre dossier').click());
    assert.equal(gets, 0);
    assert.equal(client.value, '1');
    const title = [...dom.window.document.querySelectorAll('input')].find(e => e.parentElement.textContent === 'Titre');
    assert.equal(title.closest('fieldset').disabled, true, 'the persisted original draft cannot be edited while uncertain');
    assert.equal(button('Sauvegarder').disabled, true);
    assert.equal(posts, 1);
  } finally {await act(async () => root.unmount()); Object.assign(globalThis, previous); dom.window.close();}
});

test('reconciliation finds renamed archived dossier and opens only after explicit confirmation', async () => {
  const dom = new JSDOM('<!doctype html><div id="app"></div>', {url: 'http://localhost/'});
  const previous = {window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch};
  Object.assign(globalThis, {window: dom.window, document: dom.window.document});
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const storage = dom.window.sessionStorage;
  let silentRemoval = true;
  Object.defineProperty(dom.window, 'sessionStorage', {configurable: true, value: {
    getItem: key => storage.getItem(key), setItem: (key, value) => storage.setItem(key, value),
    removeItem: key => {if (!silentRemoval) storage.removeItem(key);},
  }});
  let allow = false, posts = 0, gets = 0;
  dom.window.confirm = () => allow;
  globalThis.fetch = async (url, options = {}) => {
    if (url.endsWith('/options')) return Response.json({clients: [{id: 1, nom: 'Québec'}], techniciens: []});
    if (url === '/api/client-onboardings?archived=false') return Response.json([]);
    if (url.startsWith('/api/client-onboardings/reconcile?requestKey=')) return Response.json({found: true, id: 9, archived: true});
    if (url === '/api/client-onboardings' && options.method === 'POST') {posts++; return Response.json({error: 'Timeout'}, {status: 503});}
    if (url === '/api/client-onboardings/9') {gets++; return gets === 1 ? Response.json({error: 'Détail indisponible'}, {status: 503}) : Response.json({...record(9, 'Titre renommé'), archived: true});}
    if (url.includes('/9/history?')) return Response.json({history: [], hasMore: false, nextBefore: null});
    throw Error(`Unexpected ${url}`);
  };
  const root = createRoot(dom.window.document.getElementById('app'));
  const button = text => [...dom.window.document.querySelectorAll('button')].find(e => e.textContent.includes(text));
  try {
    await act(async () => root.render(React.createElement(RouterProvider, {router: createMemoryRouter([{path: '/', element: React.createElement(Page)}])})));
    await tick(300);
    const client = [...dom.window.document.querySelectorAll('select')].find(e => e.parentElement.textContent.startsWith('Client'));
    await act(async () => {client.value = '1'; client.dispatchEvent(new dom.window.Event('change', {bubbles: true}));});
    await act(async () => button('Sauvegarder').click());
    await act(async () => button('Vérifier la création').click());
    assert.equal(button('Confirmer l’absence et réessayer'), undefined);
    assert.ok(button('Ouvrir le dossier trouvé'));
    assert.ok(button('Ouvrir le dossier trouvé').textContent.includes('archivé'));
    assert.equal(gets, 0);
    await act(async () => button('Ouvrir le dossier trouvé').click());
    assert.equal(gets, 0);
    assert.equal(client.value, '1');
    assert.equal(button('Sauvegarder').disabled, true);
    allow = true;
    await act(async () => button('Ouvrir le dossier trouvé').click());
    assert.equal(gets, 1);
    assert.equal(client.value, '1', 'failed detail request retains draft');
    assert.equal(button('Sauvegarder').disabled, true, 'failed detail request retains uncertain lock');
    await act(async () => button('Ouvrir le dossier trouvé').click());
    assert.equal(gets, 2);
    assert.ok(dom.window.sessionStorage.getItem(pendingKey()), 'silent remove retains original draft');
    assert.equal(button('Sauvegarder').disabled, true, 'silent remove retains recovery lock');
    assert.ok(!dom.window.document.body.textContent.includes('Titre renommé'), 'recovered detail not exposed before draft cleanup');
    silentRemoval = false;
    await act(async () => button('Ouvrir le dossier trouvé').click());
    assert.equal(gets, 3);
    assert.equal(button('Sauvegarder').disabled, true, 'archived detail is read-only');
    assert.equal(dom.window.sessionStorage.getItem(pendingKey()), null);
    assert.equal([...dom.window.document.querySelectorAll('input')].find(e => e.parentElement.textContent === 'Titre').value, 'Titre renommé');
    assert.equal(posts, 1);
  } finally {await act(async () => root.unmount()); Object.assign(globalThis, previous); dom.window.close();}
});

test('failed initial history request shows error without empty-history claim', async () => {
  const dom = new JSDOM('<!doctype html><div id="app"></div>', {url: 'http://localhost/'});
  const previous = {window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch};
  Object.assign(globalThis, {window: dom.window, document: dom.window.document});
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = async url => {
    if (url.endsWith('/options')) return Response.json({clients: [], techniciens: []});
    if (url === '/api/client-onboardings?archived=false') return Response.json([record(9)]);
    if (url === '/api/client-onboardings/9') return Response.json(record(9));
    if (url.includes('/9/history?')) return Response.json({error: 'Historique perdu'}, {status: 503});
    throw Error(`Unexpected ${url}`);
  };
  const root = createRoot(dom.window.document.getElementById('app'));
  try {
    await act(async () => root.render(React.createElement(RouterProvider, {router: createMemoryRouter([{path: '/', element: React.createElement(Page)}])})));
    await tick(300);
    await act(async () => [...dom.window.document.querySelectorAll('button')].find(e => e.textContent.includes('Dossier 9')).click());
    assert.ok(dom.window.document.body.textContent.includes('Historique indisponible : Historique perdu'));
    assert.ok(!dom.window.document.body.textContent.includes('Aucun événement.'));
  } finally {await act(async () => root.unmount()); Object.assign(globalThis, previous); dom.window.close();}
});

test('mocked sidebar logout honors dirty confirmation and busy guard; navigation preserves recovery', async () => {
  const dom = new JSDOM('<!doctype html><div id="app"></div>', {url: 'http://localhost/'});
  const previous = {window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, auth: globalThis.__onboardingAuth};
  Object.assign(globalThis, {window: dom.window, document: dom.window.document});
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let logouts = 0, prompts = 0, allow = false;
  globalThis.__onboardingAuth = {user: {id: 1, prenom: 'Test', nom: 'User', email: 'test@example.com', role: 'admin'}, logout: () => {logouts++;}};
  dom.window.confirm = () => {prompts++; return allow;};
  const pending = deferred();
  globalThis.fetch = async (url, options = {}) => {
    if (url.endsWith('/options')) return Response.json({clients: [{id: 1, nom: 'Québec'}], techniciens: []});
    if (url === '/api/client-onboardings?archived=false') return Response.json([]);
    if (url === '/api/client-onboardings' && options.method === 'POST') return pending.promise;
    throw Error(`Unexpected ${url}`);
  };
  const root = createRoot(dom.window.document.getElementById('app'));
  const button = text => [...dom.window.document.querySelectorAll('button')].find(e => e.textContent.includes(text));
  try {
    const router = createMemoryRouter([{path: '/', element: React.createElement(React.Fragment, null, React.createElement(Sidebar), React.createElement(Page))}, {path: '/else', element: React.createElement(Sidebar)}]);
    await act(async () => root.render(React.createElement(RouterProvider, {router})));
    await tick(300);
    await act(async () => button('Se déconnecter').click());
    assert.equal(logouts, 1, 'clean onboarding preserves normal logout');
    const client = [...dom.window.document.querySelectorAll('select')].find(e => e.parentElement.textContent.startsWith('Client'));
    await act(async () => {client.value = '1'; client.dispatchEvent(new dom.window.Event('change', {bubbles: true}));});
    await act(async () => button('Se déconnecter').click());
    assert.equal(logouts, 1, 'declined confirmation blocks logout');
    assert.equal(prompts, 1);
    allow = true;
    await act(async () => button('Se déconnecter').click());
    assert.equal(logouts, 2, 'explicit confirmation permits logout');
    await act(async () => button('Sauvegarder').click());
    await act(async () => button('Se déconnecter').click());
    assert.equal(logouts, 2, 'pending POST blocks logout even when confirmation is accepted');
    assert.equal(prompts, 2, 'busy state does not ask to discard');
    await act(async () => pending.resolve(Response.json({error: 'Timeout'}, {status: 503})));
    await act(async () => router.navigate('/else'));
    assert.ok(dom.window.sessionStorage.getItem(pendingKey()), 'navigation leaves uncertain draft in session storage');
    await act(async () => button('Se déconnecter').click());
    assert.equal(logouts, 3, 'unmounted page no longer guards logout');
    assert.ok(dom.window.sessionStorage.getItem(pendingKey()), 'mocked logout has no real auth storage cleanup');
  } finally {
    await act(async () => root.unmount());
    Object.assign(globalThis, {...previous, __onboardingAuth: previous.auth});
    dom.window.close();
  }
});

test('account switch cancels export during history and during final document build', async () => {
  for (const format of ['Excel', 'PDF']) for (const phase of ['history', 'build']) {
    const dom = new JSDOM('<!doctype html><div id="app"></div>', {url: 'http://localhost/'});
    const previous = {window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, auth: globalThis.__onboardingAuth, exports: globalThis.__onboardingExports, gate: globalThis.__onboardingExportGate};
    Object.assign(globalThis, {window: dom.window, document: dom.window.document, __onboardingExports: []});
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.__onboardingAuth = {...previous.auth, user: {id: 101}};
    const history = deferred(), buildGate = deferred();
    globalThis.__onboardingExportGate = phase === 'build' ? buildGate : null;
    let historyCalls = 0;
    globalThis.fetch = async url => {
      if (url.endsWith('/options')) return Response.json({clients: [{id: 1, nom: 'Secret A'}], techniciens: []});
      if (url === '/api/client-onboardings?archived=false') return Response.json([record(9)]);
      if (url === '/api/client-onboardings/9') return Response.json(record(9));
      if (url.includes('/9/history?')) return url.includes('limit=100') ? (++historyCalls, phase === 'history' ? history.promise : Response.json({events: [], nextBefore: null})) : Response.json({history: [], nextBefore: null});
      throw Error(`Unexpected ${url}`);
    };
    let switchUser;
    function Harness() {const [id, setId] = React.useState(101); switchUser = setId; globalThis.__onboardingAuth = {...previous.auth, user: {id}}; return React.createElement(Page);}
    const root = createRoot(dom.window.document.getElementById('app'));
    try {
      await act(async () => root.render(React.createElement(RouterProvider, {router: createMemoryRouter([{path: '/', element: React.createElement(Harness)}])})));
      await tick(300);
      await act(async () => [...dom.window.document.querySelectorAll('button')].find(e => e.textContent.includes('Dossier 9')).click());
      await act(async () => [...dom.window.document.querySelectorAll('button')].find(e => e.textContent === format).click());
      await act(async () => switchUser(202));
      await act(async () => {history.resolve(Response.json({events: [], nextBefore: null})); buildGate.resolve();});
      assert.equal(globalThis.__onboardingExports.length, 0, `${format} ${phase} cannot export A under B`);
    } finally {await act(async () => root.unmount()); Object.assign(globalThis, {...previous, __onboardingAuth: previous.auth, __onboardingExports: previous.exports, __onboardingExportGate: previous.gate}); dom.window.close();}
  }
});

test('unsaved same-client edit blocks both exports until saved, then exports A history', async () => {
  const dom = new JSDOM('<!doctype html><div id="app"></div>', {url: 'http://localhost/'});
  const previous = {window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, exports: globalThis.__onboardingExports};
  Object.assign(globalThis, {window: dom.window, document: dom.window.document, __onboardingExports: []});
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let historyCalls = 0, puts = 0;
  let persisted = {...record(9), client_nom: 'Client A'};
  globalThis.fetch = async (url, options = {}) => {
    if (url.endsWith('/options')) return Response.json({clients: [{id: 1, nom: 'Client A'}, {id: 2, nom: 'Client B'}], techniciens: [{id: 2, prenom: 'Test', nom: 'Tech', email: 't@example.com'}]});
    if (url === '/api/client-onboardings?archived=false') return Response.json([record(9)]);
    if (url === '/api/client-onboardings/9' && !options.method) return Response.json(persisted);
    if (url === '/api/client-onboardings/9' && options.method === 'PUT') {
      puts++;
      const {onboarding} = JSON.parse(options.body);
      assert.equal(onboarding.client_id, 1);
      persisted = {...record(9), ...onboarding, version: 2, client_nom: 'Client A', items: []};
      return Response.json(persisted);
    }
    if (url.includes('/9/history?')) {
      historyCalls++;
      return Response.json({events: [{id: 31, event_type: 'updated'}], nextBefore: null});
    }
    throw Error(`Unexpected ${url}`);
  };
  const root = createRoot(dom.window.document.getElementById('app'));
  const button = text => [...dom.window.document.querySelectorAll('button')].find(e => e.textContent === text);
  try {
    await act(async () => root.render(React.createElement(RouterProvider, {router: createMemoryRouter([{path: '/', element: React.createElement(Page)}])})));
    await tick(300);
    await act(async () => [...dom.window.document.querySelectorAll('button')].find(e => e.textContent.includes('Dossier 9')).click());
    const title = [...dom.window.document.querySelectorAll('input')].find(e => e.parentElement.textContent.startsWith('Titre'));
    await act(async () => {title.value = 'Titre modifié'; Simulate.change(title);});
    const historyBeforeExport = historyCalls;
    for (const format of ['Excel', 'PDF']) {
      const exportButton = button(format);
      assert.equal(exportButton.disabled, true, `${format} disabled until saved`);
      await act(async () => exportButton.click());
      // Invoke the React handler directly as well: a disabled DOM button alone is not a safety guard.
      const reactProps = exportButton[Object.keys(exportButton).find(key => key.startsWith('__reactProps$'))];
      await act(async () => reactProps.onClick());
      assert.equal(globalThis.__onboardingExports.length, 0, `${format} must not download unsaved history`);
      assert.equal(historyCalls, historyBeforeExport, `${format} must not fetch A history`);
    }
    assert.match(dom.window.document.body.textContent, /Sauvegardez.*avant.*export/i);
    await act(async () => button('Sauvegarder').click());
    assert.equal(puts, 1);
    assert.equal(button('Excel').disabled, false);
    assert.equal(button('PDF').disabled, false);
    for (const format of ['Excel', 'PDF']) await act(async () => button(format).click());
    assert.deepEqual(globalThis.__onboardingExports.map(([format, row, , name]) => [format, row.client_id, name, row.history[0].event_type]), [
      ['xlsx', 1, 'Client A', 'updated'], ['pdf', 1, 'Client A', 'updated'],
    ]);
  } finally {
    await act(async () => root.unmount());
    Object.assign(globalThis, {window: previous.window, document: previous.document, fetch: previous.fetch, __onboardingExports: previous.exports});
    dom.window.close();
  }
});

test('exports fetch complete history, preserve unavailable technician name, switch to live name, and reject partial failure', async () => {
  const dom = new JSDOM('<!doctype html><div id="app"></div>', {url: 'http://localhost/'});
  const previous = {window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, exports: globalThis.__onboardingExports};
  Object.assign(globalThis, {window: dom.window, document: dom.window.document, __onboardingExports: []});
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const urls = [];
  let historyFails = false;
  let persisted = {...record(9), technicien_nom: 'Ancien Technicien'};
  globalThis.fetch = async (url, options = {}) => {
    urls.push(url);
    if (url.endsWith('/options')) return Response.json({clients: [{id: 1, nom: 'Québec'}], techniciens: [{id: 3, prenom: 'Marie', nom: 'Actuelle', email: 'm@example.com'}]});
    if (url === '/api/client-onboardings?archived=false') return Response.json([record(9)]);
    if (url === '/api/client-onboardings/9' && options.method === 'PUT') {
      const {onboarding} = JSON.parse(options.body);
      persisted = {...record(9), ...onboarding, version: 2, technicien_nom: 'Marie Actuelle', items: []};
      return Response.json(persisted);
    }
    if (url === '/api/client-onboardings/9') return Response.json(persisted);
    if (url.includes('/9/history?')) {
      if (url.includes('before=')) return historyFails ? Response.json({error: 'Page perdue'}, {status: 503}) : Response.json({events: [{id: 1, event_type: 'created'}], nextBefore: null});
      return Response.json({events: Array.from({length: url.includes('limit=100') ? 100 : 50}, (_, i) => ({id: 101 - i, event_type: 'updated'})), nextBefore: url.includes('limit=100') ? 2 : 52});
    }
    throw Error(`Unexpected ${url}`);
  };
  const root = createRoot(dom.window.document.getElementById('app'));
  const button = text => [...dom.window.document.querySelectorAll('button')].find(e => e.textContent === text);
  try {
    await act(async () => root.render(React.createElement(RouterProvider, {router: createMemoryRouter([{path: '/', element: React.createElement(Page)}])})));
    await tick(300);
    await act(async () => [...dom.window.document.querySelectorAll('button')].find(e => e.textContent.includes('Dossier 9')).click());
    await act(async () => button('Excel').click());
    assert.equal(globalThis.__onboardingExports.length, 1);
    assert.equal(globalThis.__onboardingExports[0][1].history.length, 101);
    assert.equal(globalThis.__onboardingExports[0][1].technicien_nom, 'Ancien Technicien');
    const technician = [...dom.window.document.querySelectorAll('select')].find(e => e.parentElement.textContent.startsWith('Technicien Prime'));
    await act(async () => {technician.value = '3'; technician.dispatchEvent(new dom.window.Event('change', {bubbles: true}));});
    assert.equal(button('PDF').disabled, true, 'technician edits also require saving before export');
    await act(async () => button('Sauvegarder').click());
    await act(async () => button('PDF').click());
    assert.equal(globalThis.__onboardingExports[1][1].technicien_nom, 'Marie Actuelle');
    historyFails = true;
    await act(async () => button('Excel').click());
    assert.equal(globalThis.__onboardingExports.length, 2, 'no partial export when second history page fails');
    assert.ok(dom.window.document.body.textContent.includes('Page perdue'));
    assert.ok(urls.some(url => url.includes('limit=100&before=2')));
  } finally {
    await act(async () => root.unmount());
    Object.assign(globalThis, {window: previous.window, document: previous.document, fetch: previous.fetch, __onboardingExports: previous.exports});
    dom.window.close();
  }
});

test('concurrent server edit while full history is pending aborts PDF and Excel instead of mixing versions', async () => {
  for (const format of ['Excel', 'PDF']) {
    const dom = new JSDOM('<!doctype html><div id="app"></div>', {url: 'http://localhost/'});
    const previous = {window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, exports: globalThis.__onboardingExports};
    Object.assign(globalThis, {window: dom.window, document: dom.window.document, __onboardingExports: []});
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const pending = deferred();
    let current = {...record(9, 'Original'), client_nom: 'Client A', items: [{section_key: 's', section_title: 'S', item_order: 1, checked: false, element: 'Original item'}]};
    let details = 0;
    globalThis.fetch = async url => {
      if (url.endsWith('/options')) return Response.json({clients: [{id: 1, nom: 'Client A'}], techniciens: []});
      if (url === '/api/client-onboardings?archived=false') return Response.json([record(9)]);
      if (url === '/api/client-onboardings/9') {details++; return Response.json(current);}
      if (url.includes('/9/history?')) return url.includes('limit=100') ? pending.promise : Response.json({events: [], nextBefore: null});
      throw Error(`Unexpected ${url}`);
    };
    const root = createRoot(dom.window.document.getElementById('app'));
    const button = text => [...dom.window.document.querySelectorAll('button')].find(e => e.textContent === text);
    try {
      await act(async () => root.render(React.createElement(RouterProvider, {router: createMemoryRouter([{path: '/', element: React.createElement(Page)}])})));
      await tick(300);
      await act(async () => [...dom.window.document.querySelectorAll('button')].find(e => e.textContent.includes('Dossier 9')).click());
      await act(async () => button(format).click());
      current = {...current, version: 2, titre: 'Concurrent', items: [{...current.items[0], element: 'Concurrent item'}]};
      await act(async () => pending.resolve(Response.json({events: [{id: 2, event_type: 'updated', created_at: '2026-01-01'}], nextBefore: null})));
      assert.equal(globalThis.__onboardingExports.length, 0, `${format} must not download a mixed record`);
      assert.ok(details >= 3, 'server detail is re-fetched after full history');
      assert.match(dom.window.document.body.textContent, /rafraîchiss.*réessay/i);
    } finally {await act(async () => root.unmount()); Object.assign(globalThis, {...previous, __onboardingExports: previous.exports}); dom.window.close();}
  }
});

test('export rechecks version after asynchronous document build, while stable exports and new drafts still succeed', async () => {
  for (const format of ['Excel', 'PDF']) {
    const dom = new JSDOM('<!doctype html><div id="app"></div>', {url: 'http://localhost/'});
    const previous = {window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, exports: globalThis.__onboardingExports, gate: globalThis.__onboardingExportGate};
    Object.assign(globalThis, {window: dom.window, document: dom.window.document, __onboardingExports: [], __onboardingExportGate: null});
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    dom.window.confirm = () => true;
    const item = {section_key: 's', section_title: 'S', item_order: 1, checked: true, element: 'Persisted item'};
    let current = {...record(9), client_nom: 'Client A', compte_rendu: {resume_executif: 'Persisted report'}, items: [item]};
    let details = 0;
    globalThis.fetch = async url => {
      if (url.endsWith('/options')) return Response.json({clients: [{id: 1, nom: 'Client A'}], techniciens: []});
      if (url === '/api/client-onboardings?archived=false') return Response.json([record(9)]);
      if (url === '/api/client-onboardings/9') {details++; return Response.json(current);}
      if (url.includes('/9/history?')) return Response.json({events: [{id: 1, event_type: 'created'}], nextBefore: null});
      throw Error(`Unexpected ${url}`);
    };
    const root = createRoot(dom.window.document.getElementById('app'));
    const button = text => [...dom.window.document.querySelectorAll('button')].find(e => e.textContent === text);
    try {
      await act(async () => root.render(React.createElement(RouterProvider, {router: createMemoryRouter([{path: '/', element: React.createElement(Page)}])})));
      await tick(300);
      await act(async () => [...dom.window.document.querySelectorAll('button')].find(e => e.textContent.includes('Dossier 9')).click());
      await act(async () => button(format).click());
      assert.equal(globalThis.__onboardingExports.length, 1, 'stable version downloads');
      assert.equal(details, 3, 'opening plus pre-history and final detail checks');
      assert.equal(globalThis.__onboardingExports[0][1].compte_rendu.resume_executif, 'Persisted report');
      assert.deepEqual(globalThis.__onboardingExports[0][2], [item]);
      const gate = deferred(); globalThis.__onboardingExportGate = gate;
      await act(async () => button(format).click());
      current = {...current, version: 2, compte_rendu: {resume_executif: 'Concurrent report'}};
      await act(async () => gate.resolve());
      assert.equal(globalThis.__onboardingExports.length, 1, 'change during build prevents second download');
      assert.match(dom.window.document.body.textContent, /rafraîchiss.*réessay/i);
      globalThis.__onboardingExportGate = null;
      await act(async () => button('Nouvelle').click());
      await act(async () => button(format).click());
      assert.equal(globalThis.__onboardingExports.length, 2, 'unsaved new draft remains exportable');
      assert.equal(globalThis.__onboardingExports[1][1].id, undefined);
    } finally {await act(async () => root.unmount()); Object.assign(globalThis, {...previous, __onboardingExports: previous.exports, __onboardingExportGate: previous.gate}); dom.window.close();}
  }
});
