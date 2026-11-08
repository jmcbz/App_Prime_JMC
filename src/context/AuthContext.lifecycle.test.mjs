import test from 'node:test';
import assert from 'node:assert/strict';
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
import {unlink} from 'node:fs/promises';

const outfile = new URL('./.auth-lifecycle-test.mjs', import.meta.url).pathname;
try {
  await build({stdin: {contents: `export {AuthProvider, useAuth} from '${new URL('./AuthContext.tsx', import.meta.url).pathname}'; export {currentOnboardingSessionGeneration} from '${new URL('../services/onboardingSessionGeneration.ts', import.meta.url).pathname}'; export {getOnboardingOptions} from '${new URL('../services/clientOnboardingService.ts', import.meta.url).pathname}';`, resolveDir: new URL('.', import.meta.url).pathname, loader: 'js'}, outfile,
    bundle: true, format: 'esm', platform: 'node', packages: 'external', jsx: 'automatic'});
} catch (error) { await unlink(outfile).catch(() => {}); throw error; }
const {AuthProvider, useAuth, currentOnboardingSessionGeneration, getOnboardingOptions} = await import(outfile);
await unlink(outfile);
const a = {id: 101, email: 'a@example.com', prenom: 'A', nom: 'User', role: 'admin', is_active: true};
const b = {...a, id: 202, email: 'b@example.com'};
const key = id => `client-onboarding:pending-create:${id}`;
function deferred() { let resolve; const promise = new Promise(r => {resolve = r;}); return {promise, resolve}; }
async function harness(fetch) {
  const dom = new JSDOM('<div id="app"></div>', {url: 'http://localhost/'});
  const previous = {window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch};
  Object.assign(globalThis, {window: dom.window, document: dom.window.document, fetch});
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let auth;
  function Child() { auth = useAuth(); return React.createElement('div', null, auth.user && auth.verified && !auth.loading ? `private:${auth.user.id}` : 'hidden'); }
  const root = createRoot(dom.window.document.getElementById('app'));
  await act(async () => root.render(React.createElement(AuthProvider, null, React.createElement(Child))));
  return {dom, get auth() {return auth;}, visible: () => dom.window.document.body.textContent,
    close: async () => {await act(async () => root.unmount()); Object.assign(globalThis, previous); dom.window.close();}};
}

test('logout hides account and invalidates a late /me before logout HTTP completes', async () => {
  const me = deferred(), logout = deferred();
  let checks = 0;
  const h = await harness((url) => {
    if (url === '/api/auth/me') return ++checks === 1 ? Response.json({user: a}) : me.promise;
    if (url === '/api/auth/logout') return logout.promise;
    throw Error(`Unexpected ${url}`);
  });
  try {
    assert.equal(h.visible(), 'private:101');
    h.dom.window.sessionStorage.setItem(key(101), 'uncertain draft');
    h.dom.window.confirm = () => true;
    await act(async () => h.dom.window.dispatchEvent(new h.dom.window.Event('focus')));
    assert.equal(h.visible(), 'hidden');
    let finishing;
    await act(async () => {finishing = h.auth.logout();});
    assert.equal(h.visible(), 'hidden');
    assert.equal(h.dom.window.sessionStorage.getItem(key(101)), null);
    await act(async () => me.resolve(Response.json({user: a})));
    assert.equal(h.visible(), 'hidden', 'late /me must never restore signed-out account');
    await act(async () => {logout.resolve(Response.json({success: true})); await finishing;});
    assert.equal(h.visible(), 'hidden');
  } finally {await h.close();}
});

test('503 logout keeps private UI hidden with visible retry despite focus /me returning A', async () => {
  let logouts = 0, checks = 0;
  const h = await harness(url => {
    if (url === '/api/auth/me') { checks++; return Response.json({user: a}); }
    if (url === '/api/auth/logout') { logouts++; return Response.json({error: 'unavailable'}, {status: 503}); }
    throw Error(`Unexpected ${url}`);
  });
  try {
    h.dom.window.sessionStorage.setItem(key(101), 'recoverable');
    h.dom.window.confirm = () => true;
    await act(async () => { await h.auth.logout().catch(() => {}); });
    assert.match(h.visible(), /déconnexion.*(échoué|incertaine|impossible)/i);
    assert.match(h.visible(), /réessayer/i);
    assert.doesNotMatch(h.visible(), /private:101/);
    assert.equal(h.dom.window.sessionStorage.getItem(key(101)), null, 'consented destruction stays explicit');
    const beforeFocus = checks;
    await act(async () => h.dom.window.dispatchEvent(new h.dom.window.Event('focus')));
    assert.doesNotMatch(h.visible(), /private:101/);
    assert.match(h.visible(), /réessayer/i);
    assert.equal(checks, beforeFocus, 'focus must not expose A during failed logout');
    assert.equal(logouts, 1);
  } finally {await h.close();}
});

test('retry after 503 succeeds without second consent or restoring A', async () => {
  let attempts = 0, confirmations = 0;
  const h = await harness(url => {
    if (url === '/api/auth/me') return Response.json({user: a});
    if (url === '/api/auth/logout') return ++attempts === 1 ?
      Response.json({error: 'unavailable'}, {status: 503}) : Response.json({success: true});
    throw Error(`Unexpected ${url}`);
  });
  try {
    h.dom.window.sessionStorage.setItem(key(101), 'consented draft');
    h.dom.window.confirm = () => { confirmations++; return true; };
    await act(async () => { await h.auth.logout().catch(() => {}); });
    assert.match(h.visible(), /réessayer/i);
    const retry = h.dom.window.document.querySelector('button');
    await act(async () => { retry.click(); });
    assert.equal(h.visible(), 'hidden');
    await act(async () => h.dom.window.dispatchEvent(new h.dom.window.Event('focus')));
    assert.equal(h.visible(), 'hidden');
    assert.equal(attempts, 2);
    assert.equal(confirmations, 1);
    assert.equal(h.dom.window.sessionStorage.getItem(key(101)), null);
  } finally {await h.close();}
});

test('network logout failure and failed /me verification stay visibly blocked until retry', async () => {
  let attempts = 0;
  const h = await harness(url => {
    if (url === '/api/auth/me') return attempts ? Promise.reject(Error('offline')) : Response.json({user: a});
    if (url === '/api/auth/logout') { attempts++; return Promise.reject(Error('offline')); }
    throw Error(`Unexpected ${url}`);
  });
  try {
    await act(async () => { await h.auth.logout().catch(() => {}); });
    assert.match(h.visible(), /réessayer/i);
    assert.doesNotMatch(h.visible(), /private:101/);
    await act(async () => h.dom.window.dispatchEvent(new h.dom.window.Event('focus')));
    assert.match(h.visible(), /session peut encore être active/i);
    await act(async () => h.dom.window.document.querySelector('button').click());
    assert.equal(attempts, 2);
    assert.match(h.visible(), /réessayer/i);
  } finally {await h.close();}
});

test('failed logout with /me 401 confirms sign-out instead of showing retry', async () => {
  let attempts = 0;
  const h = await harness(url => {
    if (url === '/api/auth/me') return attempts ? new Response(null, {status: 401}) : Response.json({user: a});
    if (url === '/api/auth/logout') { attempts++; return Response.json({error: 'unavailable'}, {status: 503}); }
    throw Error(`Unexpected ${url}`);
  });
  try {
    await act(async () => { await h.auth.logout(); });
    assert.equal(h.visible(), 'hidden');
    assert.equal(attempts, 1);
  } finally {await h.close();}
});

test('transient 5xx and network /me outages hide loaded data but preserve recovery for the same user', async () => {
  let response = Response.json({user: a});
  const h = await harness(url => {
    if (url === '/api/auth/me') return response instanceof Error ? Promise.reject(response) : response;
    throw Error(`Unexpected ${url}`);
  });
  try {
    const draft = JSON.stringify({requestKey: 'original-uuid', onboarding: {titre: 'secret'}});
    h.dom.window.sessionStorage.setItem(key(101), draft);
    for (const outage of [Response.json({error: 'Unavailable'}, {status: 503}), Error('offline')]) {
      response = outage;
      await act(async () => h.dom.window.dispatchEvent(new h.dom.window.Event('focus')));
      assert.equal(h.visible(), 'hidden');
      assert.equal(h.dom.window.sessionStorage.getItem(key(101)), draft);
    }
    response = Response.json({user: a});
    await act(async () => h.dom.window.dispatchEvent(new h.dom.window.Event('focus')));
    assert.equal(h.visible(), 'private:101');
    assert.equal(h.dom.window.sessionStorage.getItem(key(101)), draft);
  } finally {await h.close();}
});

test('malformed 200 /me hides A without losing its draft, then recovers A', async () => {
  let response = Response.json({user: a});
  const h = await harness(url => {
    if (url === '/api/auth/me') return response;
    throw Error(`Unexpected ${url}`);
  });
  try {
    const draft = 'recoverable A';
    h.dom.window.sessionStorage.setItem(key(101), draft);
    response = new Response('<html>proxy error</html>', {status: 200, headers: {'Content-Type': 'text/html'}});
    await act(async () => h.dom.window.dispatchEvent(new h.dom.window.Event('focus')));
    assert.equal(h.visible(), 'hidden');
    assert.equal(h.dom.window.sessionStorage.getItem(key(101)), draft);
    response = Response.json({user: a});
    await act(async () => h.dom.window.dispatchEvent(new h.dom.window.Event('focus')));
    assert.equal(h.visible(), 'private:101');
    assert.equal(h.dom.window.sessionStorage.getItem(key(101)), draft);
  } finally {await h.close();}
});

test('absent or invalid user in 200 /me hides A and retains its draft', async () => {
  let response = Response.json({user: a});
  const h = await harness(url => {
    if (url === '/api/auth/me') return response;
    throw Error(`Unexpected ${url}`);
  });
  try {
    h.dom.window.sessionStorage.setItem(key(101), 'recoverable A');
    for (const body of [{}, {user: null}, {user: 'A'}, {user: []}, {user: {id: '101'}}, {user: {...a, id: '101'}}, {user: {...a, role: 'other'}}]) {
      response = Response.json(body);
      await act(async () => h.dom.window.dispatchEvent(new h.dom.window.Event('focus')));
      assert.equal(h.visible(), 'hidden', JSON.stringify(body));
      assert.equal(h.dom.window.sessionStorage.getItem(key(101)), 'recoverable A', JSON.stringify(body));
    }
  } finally {await h.close();}
});

test('confirmed B after malformed 200 purges A draft before exposing B', async () => {
  let response = Response.json({user: a});
  const h = await harness(url => {
    if (url === '/api/auth/me') return response;
    throw Error(`Unexpected ${url}`);
  });
  try {
    h.dom.window.sessionStorage.setItem(key(101), 'private A');
    response = Response.json({user: null});
    await act(async () => h.dom.window.dispatchEvent(new h.dom.window.Event('focus')));
    assert.equal(h.visible(), 'hidden');
    assert.equal(h.dom.window.sessionStorage.getItem(key(101)), 'private A');
    response = Response.json({user: b});
    await act(async () => h.dom.window.dispatchEvent(new h.dom.window.Event('focus')));
    assert.equal(h.dom.window.sessionStorage.getItem(key(101)), null);
    assert.equal(h.visible(), 'private:202');
  } finally {await h.close();}
});

test('confirmed 401 expiry purges A draft while an unknown response does not', async () => {
  let response = Response.json({user: a});
  const h = await harness(url => {
    if (url === '/api/auth/me') return response;
    throw Error(`Unexpected ${url}`);
  });
  try {
    h.dom.window.sessionStorage.setItem(key(101), 'private A');
    response = Response.json({error: 'expired'}, {status: 401});
    await act(async () => h.dom.window.dispatchEvent(new h.dom.window.Event('focus')));
    assert.equal(h.visible(), 'hidden');
    assert.equal(h.dom.window.sessionStorage.getItem(key(101)), null);
  } finally {await h.close();}
});

test('direct logout and identity switch notify listeners synchronously, but vetoed logout does not', async () => {
  const h = await harness(url => {
    if (url === '/api/auth/me') return Response.json({user: a});
    if (url === '/api/auth/logout') return Response.json({success: true});
    throw Error(`Unexpected ${url}`);
  });
  try {
    let aborts = 0;
    h.auth.onVerificationStart(() => {aborts++;});
    h.dom.window.sessionStorage.setItem(key(101), 'draft A');
    h.dom.window.confirm = () => false;
    await act(async () => {const pending = h.auth.logout(); assert.equal(aborts, 0); await pending;});
    assert.equal(h.visible(), 'private:101');
    h.dom.window.confirm = () => true;
    const original = h.dom.window.Storage.prototype.removeItem;
    h.dom.window.Storage.prototype.removeItem = () => {throw Error('storage failed');};
    try {
      await act(async () => assert.rejects(h.auth.logout(), /storage failed/));
      assert.equal(aborts, 0);
    } finally {h.dom.window.Storage.prototype.removeItem = original;}
    await act(async () => {const pending = h.auth.logout(); assert.equal(aborts, 1); await pending;});
  } finally {await h.close();}

  const other = await harness(url => {
    if (url === '/api/auth/me') return Response.json({user: a});
    throw Error(`Unexpected ${url}`);
  });
  try {
    let aborts = 0;
    other.auth.onVerificationStart(() => {aborts++;});
    await act(async () => {other.auth.setUser(b); assert.equal(aborts, 1);});
    assert.equal(other.visible(), 'private:202');
    await act(async () => {other.auth.setUser(b); assert.equal(aborts, 1);});
  } finally {await other.close();}
});

test('current 401 during pending /me aborts immediately but confirmed A preserves draft', async () => {
  const me = deferred(); let checks = 0;
  const h = await harness(url => {
    if (url === '/api/auth/me') return ++checks === 1 ? Response.json({user: a}) : me.promise;
    throw Error(`Unexpected ${url}`);
  });
  try {
    h.dom.window.sessionStorage.setItem(key(101), 'draft A');
    let aborts = 0;
    h.auth.onVerificationStart(() => {aborts++;});
    await act(async () => h.dom.window.dispatchEvent(new h.dom.window.Event('focus')));
    const before = aborts;
    await act(async () => {
      h.dom.window.dispatchEvent(new h.dom.window.CustomEvent('client-onboarding:unauthorized', {detail: {generation: currentOnboardingSessionGeneration()}}));
      assert.equal(aborts, before + 1);
    });
    assert.equal(h.dom.window.sessionStorage.getItem(key(101)), 'draft A');
    await act(async () => me.resolve(Response.json({user: a})));
    assert.equal(h.visible(), 'private:101');
    assert.equal(h.dom.window.sessionStorage.getItem(key(101)), 'draft A');
  } finally {await h.close();}
});

test('overlapping /me checks let the latest epoch decide after an onboarding 401', async () => {
  const first = deferred(), second = deferred(); let checks = 0;
  const h = await harness(url => {
    if (url === '/api/auth/me') return [Response.json({user: a}), first.promise, second.promise][checks++];
    throw Error(`Unexpected ${url}`);
  });
  try {
    h.dom.window.sessionStorage.setItem(key(101), 'draft A');
    await act(async () => h.dom.window.dispatchEvent(new h.dom.window.Event('focus')));
    await act(async () => h.dom.window.dispatchEvent(new h.dom.window.Event('focus')));
    await act(async () => {
      h.dom.window.dispatchEvent(new h.dom.window.CustomEvent('client-onboarding:unauthorized', {detail: {generation: currentOnboardingSessionGeneration()}}));
    });
    await act(async () => first.resolve(new Response(null, {status: 401})));
    assert.equal(h.dom.window.sessionStorage.getItem(key(101)), 'draft A', 'obsolete /me cannot expire A');
    await act(async () => second.resolve(Response.json({user: a})));
    assert.equal(h.visible(), 'private:101');
    assert.equal(h.dom.window.sessionStorage.getItem(key(101)), 'draft A');
  } finally {await h.close();}
});

test('pending 401 waits for /me confirmed expiry; /me outage keeps draft and hides UI', async () => {
  for (const result of [new Response(null, {status: 401}), Response.json({error: 'offline'}, {status: 503})]) {
    const me = deferred(); let checks = 0;
    const h = await harness(url => {
      if (url === '/api/auth/me') return ++checks === 1 ? Response.json({user: a}) : me.promise;
      throw Error(`Unexpected ${url}`);
    });
    try {
      h.dom.window.sessionStorage.setItem(key(101), 'draft A');
      await act(async () => h.dom.window.dispatchEvent(new h.dom.window.Event('focus')));
      await act(async () => h.dom.window.dispatchEvent(new h.dom.window.CustomEvent('client-onboarding:unauthorized', {detail: {generation: currentOnboardingSessionGeneration()}})));
      assert.equal(h.dom.window.sessionStorage.getItem(key(101)), 'draft A');
      await act(async () => me.resolve(result));
      assert.equal(h.visible(), 'hidden');
      assert.equal(h.dom.window.sessionStorage.getItem(key(101)), result.status === 401 ? null : 'draft A');
    } finally {await h.close();}
  }
});

test('external setUser(B) aborts A export before draft cleanup throws and keeps UI fail closed', async () => {
  const h = await harness(url => {
    if (url === '/api/auth/me') return Response.json({user: a});
    throw Error(`Unexpected ${url}`);
  });
  const original = h.dom.window.Storage.prototype.removeItem;
  try {
    h.dom.window.sessionStorage.setItem(key(101), 'private A');
    let aborted = false;
    h.auth.onVerificationStart(() => {aborted = true;});
    h.dom.window.Storage.prototype.removeItem = () => {
      assert.equal(aborted, true, 'A export must be aborted before destructive cleanup');
      throw Error('storage failed');
    };
    await act(async () => assert.throws(() => h.auth.setUser(b), /storage failed/));
    assert.equal(aborted, true);
    assert.match(h.visible(), /Nettoyage des brouillons impossible/);
    assert.doesNotMatch(h.visible(), /private:101|private:202/);
    assert.equal(h.dom.window.sessionStorage.getItem(key(101)), 'private A');
  } finally {h.dom.window.Storage.prototype.removeItem = original; await h.close();}
});

test('onboarding request issued before same-account /me cannot expire confirmed A after it settles', async () => {
  const request = deferred(), me = deferred(); let checks = 0;
  const h = await harness(url => {
    if (url === '/api/auth/me') return ++checks === 1 ? Response.json({user: a}) : me.promise;
    if (url === '/api/client-onboardings/options') return request.promise;
    throw Error(`Unexpected ${url}`);
  });
  try {
    h.dom.window.sessionStorage.setItem(key(101), 'draft A');
    const stale = getOnboardingOptions().catch(error => error);
    await act(async () => h.dom.window.dispatchEvent(new h.dom.window.Event('focus')));
    await act(async () => me.resolve(Response.json({user: a})));
    assert.equal(h.visible(), 'private:101');
    await act(async () => request.resolve(new Response(null, {status: 401})));
    assert.match((await stale).message, /Session expirée/);
    assert.equal(h.visible(), 'private:101');
    assert.equal(h.dom.window.sessionStorage.getItem(key(101)), 'draft A');
  } finally {await h.close();}
});

test('onboarding 401 issued after same-account /me still expires A and purges its draft', async () => {
  let checks = 0;
  const h = await harness(url => {
    if (url === '/api/auth/me') {checks++; return Response.json({user: a});}
    if (url === '/api/client-onboardings/options') return new Response(null, {status: 401});
    throw Error(`Unexpected ${url}`);
  });
  try {
    h.dom.window.sessionStorage.setItem(key(101), 'draft A');
    await act(async () => h.dom.window.dispatchEvent(new h.dom.window.Event('focus')));
    assert.equal(checks, 2);
    await act(async () => assert.rejects(getOnboardingOptions(), /Session expirée/));
    assert.equal(h.visible(), 'hidden');
    assert.equal(h.dom.window.sessionStorage.getItem(key(101)), null);
  } finally {await h.close();}
});

test('direct setUser(B) during pending /me clears loading and supersedes stale A response', async () => {
  const me = deferred(); let checks = 0;
  const h = await harness(url => {
    if (url === '/api/auth/me') return ++checks === 1 ? Response.json({user: a}) : me.promise;
    throw Error(`Unexpected ${url}`);
  });
  try {
    h.dom.window.sessionStorage.setItem(key(101), 'draft A');
    await act(async () => h.dom.window.dispatchEvent(new h.dom.window.Event('focus')));
    assert.equal(h.visible(), 'hidden');
    await act(async () => h.auth.setUser(b));
    assert.equal(h.auth.loading, false);
    assert.equal(h.visible(), 'private:202');
    assert.equal(h.dom.window.sessionStorage.getItem(key(101)), null);
    await act(async () => me.resolve(Response.json({user: a})));
    assert.equal(h.visible(), 'private:202');
  } finally {await h.close();}
});
