import test from 'node:test';
import assert from 'node:assert/strict';
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
import {unlink} from 'node:fs/promises';

const outfile = new URL('./.tool-activity-test.mjs', import.meta.url).pathname;
let components;
try {
 await build({stdin:{contents:"export {default as Panel} from './ToolActivityPanel';export {AuthProvider} from '../context/AuthContext';",resolveDir:new URL('.',import.meta.url).pathname,loader:'ts'},outfile,bundle:true,format:'esm',platform:'node',packages:'external',jsx:'automatic'});
 components = await import(outfile);
} finally { await unlink(outfile).catch(()=>{}); }
const item = {module:'onboarding',id:88,title:'Dossier fixture',clientName:'Client fixture',clientId:2,openedAt:'2026-11-20T12:00:00Z',href:'/procedures/prise-en-charge?dossier=88'};
const empty = {recent:[],active:[],activeTotal:0,recentHasMore:false,activeHasMore:false,limit:5};
for (const state of ['empty','populated','error','loading']) test(`tool actions remain available with ${state} activity`, async()=>{
 const dom = new JSDOM('<div id="root"></div>', {url:'http://localhost/'});
 const previous = {window:globalThis.window,document:globalThis.document,fetch:globalThis.fetch};
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
 const requests = []; let retry = false;
 globalThis.fetch = async (url,options={})=>{
  requests.push({url,method:options.method||'GET'});
  if (url === '/api/auth/me') return Response.json({user:{id:1,email:'fixture@example.test',prenom:'Fixture',nom:'Prime',role:'prime',is_active:true}});
  assert.equal(url,'/api/tool-activity');
  if (state==='loading') return new Promise(()=>{});
  if (state==='error'&&!retry) return Response.json({error:'Activité indisponible'},{status:503});
  return Response.json(state==='populated'?{...empty,recent:[item],active:[item],recentHasMore:true,activeHasMore:true,activeTotal:12}:empty);
 };
 const root = createRoot(document.getElementById('root'));
 try {
  await act(async()=>root.render(React.createElement(MemoryRouter,null,React.createElement(components.AuthProvider,null,React.createElement(components.Panel)))));
  const nav = document.querySelector('nav[aria-label="Accès aux outils"]');
  assert.ok(nav,'tool actions form a named navigation landmark');
  const links = [...nav.querySelectorAll('a')];
  assert.deepEqual(links.map(a=>a.getAttribute('href')),['/procedures/prise-en-charge','/procedures/installation-postes']);
  for (const link of links) { assert.ok(link.querySelector('svg[aria-hidden="true"]')); assert.match(link.className,/focus-visible:outline-2/); }
  assert.match(links[0].textContent,/Consulter les dossiers de prise en charge client/);
  assert.match(links[1].textContent,/Retrouver les procédures et les dossiers de montage/);
  if (state==='empty') {
   assert.match(document.body.textContent,/Ouvrez un dossier dans l’un des outils ci-dessus/);
   assert.ok(document.querySelector('[aria-label="0 dossiers en cours"]'));
  } else if (state==='populated') {
   assert.equal(document.querySelectorAll(`a[href="${item.href}"]`).length,2);
   assert.equal(document.querySelector('time').getAttribute('datetime'),item.openedAt);
   assert.match(document.querySelector('time').textContent,/07(?: h |:)00/);
   assert.ok(document.querySelector('[aria-label="1 dossiers affichés"]'));
   assert.ok(document.querySelector('[aria-label="12 dossiers en cours"]'));
   assert.match(document.body.textContent,/1 sur 12/);
   assert.match(document.body.textContent,/Les 5 dernières consultations/);
  } else {
   assert.doesNotMatch(document.body.textContent,/Aucun dossier/);
   assert.ok(document.querySelector(`[role="${state==='error'?'alert':'status'}"]`));
   if (state==='error') {
    retry = true;
    await act(async()=>document.querySelector('button').click());
    assert.match(document.body.textContent,/Aucun dossier récent/);
    assert.equal(requests.filter(r=>r.url==='/api/tool-activity').length,2);
   }
  }
  assert.ok(requests.every(r=>r.method==='GET'),'presentation never mutates business data');
 } finally {
  await act(async()=>root.unmount());dom.window.close();Object.assign(globalThis,previous);
 }
});
