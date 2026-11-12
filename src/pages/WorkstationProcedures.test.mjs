import test from 'node:test';
import assert from 'node:assert/strict';
import React, {act} from 'react';
import {BrowserRouter, Link, MemoryRouter, Route, Routes} from 'react-router-dom';
import {createRoot} from 'react-dom/client';
import {Simulate} from 'react-dom/test-utils';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
import {unlink, readFile} from 'node:fs/promises';

const outfile = new URL('./.workstation-ui-test.mjs', import.meta.url).pathname;
await build({entryPoints:[new URL('./WorkstationProcedures.tsx', import.meta.url).pathname], outfile, bundle:true, format:'esm', platform:'node', packages:'external', jsx:'automatic', plugins:[{name:'auth-and-script',setup(p){
  p.onResolve({filter:/context\/AuthContext$/},()=>({path:'auth',namespace:'fixture'}));
  p.onLoad({filter:/./,namespace:'fixture'},()=>({contents:'export const useAuth = () => ({user: globalThis.__workstationAuth ? globalThis.__workstationAuth.user : {id:globalThis.__workstationUserId||1,role:globalThis.__workstationRole||"admin"}, verified:globalThis.__workstationAuth?.verified ?? true, loading:globalThis.__workstationAuth?.loading ?? false, verificationEpoch:globalThis.__workstationAuth?.epoch ?? 0, onVerificationStart:globalThis.__workstationAuth?.subscribe ?? (()=>()=>{})})',loader:'js'}));
  p.onResolve({filter:/workstationAuditScript$/},()=>({path:'script',namespace:'script-fixture'}));
  p.onLoad({filter:/./,namespace:'script-fixture'},()=>({contents:'export const DEFAULT_WORKSTATION_AUDIT_OPTIONS={clientName:"BZ",computerPrefix:"PC-",adminLocal:"bzinc",keyboards:["fr-CA"],printerName:"",apps:[]};export const generateWorkstationAuditScript = config => { globalThis.__scriptConfig = config; return "# Test PS1"; };',loader:'js'}));
}}]});
const Page = (await import(outfile)).default;
await unlink(outfile);
const template = {id:3,clientId:null,name:'Standard Windows',version:1,sections:[{title:'Préparation',steps:[{id:'s1',title:'Clavier',note:'Vérifier FR'}]}]};
const dossier = {id:11,clientId:2,clientName:'Acme TI',templateId:3,employee:'Alice',computer:'PC-1',ticket:'T-1',date:'2026-11-09',version:1,archivedAt:null,sections:[{title:'Préparation',steps:[{id:'s1',title:'Clavier',note:'Vérifier FR',etat:'todo',commentaire:''}]}]};
function fixture({dossiers=[],templates=[template],putStatus=200,browserRouter=false,override,pendingSeed}={}) {
  const dom = new JSDOM('<!doctype html><div id="app"></div>',{url:browserRouter?'http://localhost/procedures/installation-postes':'http://localhost/'});
  dom.window.URL.revokeObjectURL=()=>{};
  const old={window:globalThis.window,document:globalThis.document,fetch:globalThis.fetch,Blob:globalThis.Blob,URL:globalThis.URL};
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,Blob:dom.window.Blob,URL:dom.window.URL});
  if(pendingSeed)dom.window.sessionStorage.setItem('workstation-procedures:pending-create:1',JSON.stringify(pendingSeed));
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  const listeners=new Set();
  const auth={user:{id:globalThis.__workstationUserId||1,role:globalThis.__workstationRole||'admin'},verified:true,loading:false,epoch:0,subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},start(){for(const listener of listeners)listener();this.verified=false;this.loading=true;this.epoch++;}};
  globalThis.__workstationAuth=auth;
  const requests=[];
  globalThis.fetch=async (url,options={})=>{
    const method=options.method||'GET'; const body=options.body&&JSON.parse(options.body);
    requests.push({url,method,body});
    const custom=override?.({url,method,body,requests});if(custom!==undefined)return custom;
    if(url==='/api/clients')return Response.json({clients:[{id:2,nom:'Acme TI',clientType:'ti',primeId:1},{id:4,nom:'Télécom',clientType:'telecom',primeId:1},{id:5,nom:'À classer',clientType:null,primeId:1},{id:6,nom:'Sans Prime',clientType:'ti',primeId:null}]});
    if(url==='/api/workstation-procedures/templates/standard')return Response.json({template});
    if(url.startsWith('/api/workstation-procedures/audit-source?'))return Response.json({client:{id:2,nom:'Acme TI'},template});
    if(url==='/api/workstation-procedures/templates'&&method==='GET')return Response.json({templates,hasMore:false,nextBefore:null});
    if(url==='/api/workstation-procedures/dossiers'&&method==='GET')return Response.json({dossiers,hasMore:false,nextBefore:null});
    if(url.includes('/by-request/'))return Response.json({[url.includes('/templates/')?'template':'dossier']:url.includes('/templates/')?template:dossier});
    if(url==='/api/workstation-procedures/dossiers'&&method==='POST')return Response.json({dossier:{...dossier,...body}},{status:201});
    if(url==='/api/workstation-procedures/audit-source/dossier/11'&&method==='GET')return Response.json({dossier:dossiers.find(d=>d.id===11)||dossier});
    if(url==='/api/workstation-procedures/dossiers/11'&&method==='GET')return Response.json({dossier:dossiers.find(d=>d.id===11)||dossier});
    if(url==='/api/workstation-procedures/dossiers/11'&&method==='PUT')return putStatus===409?Response.json({error:'Conflit de version'},{status:409}):Response.json({dossier:{...dossier,...body,version:2}});
    if(url==='/api/workstation-procedures/dossiers/11/archive')return Response.json({dossier:{...dossier,archivedAt:'2026-11-10',version:2}});
    if(url==='/api/workstation-procedures/templates'&&method==='POST')return Response.json({template:{...template,...body,id:9}},{status:201});
    if(url==='/api/workstation-procedures/templates/3'&&method==='PUT')return Response.json({template:{...template,...body,version:2}});
    throw Error(`Unexpected ${method} ${url}`);
  };
  const root=createRoot(dom.window.document.getElementById('app'));
  const render=async()=>{await act(async()=>root.render(browserRouter?React.createElement(BrowserRouter,{future:{v7_startTransition:true,v7_relativeSplatPath:true}},React.createElement('nav',null,React.createElement(Link,{to:'/clients'},'Clients')),React.createElement(Routes,null,React.createElement(Route,{path:'/procedures/installation-postes',element:React.createElement(Page)}),React.createElement(Route,{path:'/clients',element:React.createElement('p',null,'Page clients')}))):React.createElement(Page)));};
  const input=async(label,value)=>{const el=[...dom.window.document.querySelectorAll('input,textarea,select')].find(e=>e.getAttribute('aria-label')===label);assert.ok(el,`Missing input ${label}`);await act(async()=>{const proto=el.tagName==='TEXTAREA'?dom.window.HTMLTextAreaElement.prototype:el.tagName==='SELECT'?dom.window.HTMLSelectElement.prototype:dom.window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,value);el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));el.dispatchEvent(new dom.window.Event('change',{bubbles:true}));Simulate.change(el,{target:{value}});});};
  const click=async(text)=>{const el=[...dom.window.document.querySelectorAll('button')].find(e=>e.textContent.trim().startsWith(text));assert.ok(el,`Missing button ${text}`);await act(async()=>el.click());};
  const cleanup=async()=>{await act(async()=>root.unmount());delete globalThis.__workstationAuth;Object.assign(globalThis,old);dom.window.close();};
  return {dom,requests,render,input,click,cleanup,auth};
}

test('Prime tools exposes the workstation editor route',async()=>{
  const app=await readFile(new URL('../App.tsx',import.meta.url),'utf8');
  assert.match(app,/<Route path="\/procedures\/installation-postes" element=\{<WorkstationProcedures \/>\}/);
  const output=new URL('./.procedures-nav-test.mjs',import.meta.url).pathname;
  await build({entryPoints:[new URL('./Procedures.tsx',import.meta.url).pathname],outfile:output,bundle:true,format:'esm',platform:'node',packages:'external',jsx:'automatic',plugins:[{name:'auth',setup(p){p.onResolve({filter:/context\/AuthContext$/},()=>({path:'auth',namespace:'fixture'}));p.onLoad({filter:/./,namespace:'fixture'},()=>({contents:'export const useAuth = () => ({user:{id:1,role:"user"}})',loader:'js'}));}}]});
  const Procedures=(await import(output)).default;await unlink(output);
  const dom=new JSDOM('<div id="app"></div>',{url:'http://localhost/'});const old={window:globalThis.window,document:globalThis.document};Object.assign(globalThis,{window:dom.window,document:dom.window.document});const root=createRoot(dom.window.document.getElementById('app'));
  try{globalThis.IS_REACT_ACT_ENVIRONMENT=true;await act(async()=>root.render(React.createElement(MemoryRouter,{future:{v7_startTransition:true,v7_relativeSplatPath:true}},React.createElement(Procedures))));assert.ok(dom.window.document.querySelector('a[href="/procedures/installation-postes"]'));}finally{await act(async()=>root.unmount());Object.assign(globalThis,old);dom.window.close();}
});

test('HTML download panel explains the local checklist and PDF retention', async()=>{
  const f=fixture();try{await f.render();const panel=[...f.dom.window.document.querySelectorAll('button')].find(b=>b.textContent==='Télécharger la procédure HTML').parentElement;
    assert.match(panel.textContent,/checklist cochable hors ligne/i);
    assert.match(panel.textContent,/Imprimer \/ Enregistrer en PDF/);
    assert.match(panel.textContent,/pas sauvegardées automatiquement/i);
    assert.match(panel.textContent,/aucune synchronisation/i);
  }finally{await f.cleanup();}
});

test('lists shared models and scoped TI clients, excluding telecom',async()=>{const f=fixture();try{await f.render();assert.match(f.dom.window.document.body.textContent,/Standard Windows/);assert.match(f.dom.window.document.body.textContent,/Acme TI/);assert.doesNotMatch(f.dom.window.document.querySelector('select[aria-label="Client"]')?.textContent??'',/Télécom/);}finally{await f.cleanup();}});

test('assigned but unclassified clients appear disabled until classified TI, without telecom or unassigned clients',async()=>{const f=fixture();try{await f.render();const select=f.dom.window.document.querySelector('select[aria-label="Client"]');const options=[...select.options];assert.equal(options.find(o=>o.textContent.includes('Acme TI'))?.disabled,false);const pending=options.find(o=>o.textContent.includes('À classer'));assert.ok(pending,'assigned unclassified client should be visible');assert.equal(pending.disabled,true);assert.match(pending.textContent,/classer TI/i);assert.ok(!options.some(o=>o.textContent.includes('Télécom')||o.textContent.includes('Sans Prime')));}finally{await f.cleanup();}});

test('creates a dossier from a model and saves step state, notes and metadata with version',async()=>{const f=fixture();try{await f.render();await f.input('Client','2');await f.input('Modèle','3');await f.input('Employé','Alice');await f.input('Ordinateur','PC-1');await f.click('Créer le dossier');assert.equal(f.requests.find(r=>r.method==='POST'&&r.url.endsWith('/dossiers')).body.clientId,2);await f.input('État — Clavier','fait');await f.input('Commentaire — Clavier','Vérifié');await f.click('Sauvegarder le dossier');const put=f.requests.find(r=>r.method==='PUT');assert.equal(put.body.expectedVersion,1);assert.equal(put.body.sections[0].steps[0].commentaire,'Vérifié');assert.match(f.dom.window.document.body.textContent,/1 \/ 1/);}finally{await f.cleanup();}});

test('a version conflict preserves unsaved edits',async()=>{const f=fixture({dossiers:[dossier],putStatus:409});try{await f.render();await f.click('Ouvrir Alice · Acme TI');await f.input('Commentaire — Clavier','Important');await f.click('Sauvegarder le dossier');assert.match(f.dom.window.document.querySelector('[role="alert"]').textContent,/Conflit/);assert.equal(f.dom.window.document.querySelector('[aria-label="Commentaire — Clavier"]').value,'Important');}finally{await f.cleanup();}});

test('archived dossier is read-only and progress excludes N/A',async()=>{const archived={...dossier,archivedAt:'2026-11-10',sections:[{title:'Préparation',steps:[{...dossier.sections[0].steps[0],etat:'na'}]}]};const f=fixture({dossiers:[archived]});try{await f.render();await f.click('Ouvrir Alice · Acme TI');assert.match(f.dom.window.document.body.textContent,/0 \/ 0/);assert.equal(f.dom.window.document.querySelector('[aria-label="Commentaire — Clavier"]').disabled,true);assert.ok(![...f.dom.window.document.querySelectorAll('button')].some(e=>e.textContent==='Sauvegarder le dossier'));}finally{await f.cleanup();}});

test('print view hides the app shell and keeps the dossier readable',async()=>{const f=fixture({dossiers:[dossier]});try{await f.render();await f.click('Ouvrir Alice · Acme TI');const css=f.dom.window.document.querySelector('style[data-workstation-print]')?.textContent||'';assert.match(css,/#primary-navigation/);assert.match(css,/main/);assert.match(css,/print/);}finally{await f.cleanup();}});

test('archiving a saved dossier posts its version and locks the editor',async()=>{const f=fixture({dossiers:[dossier]});try{await f.render();await f.click('Ouvrir Alice · Acme TI');f.dom.window.confirm=()=>true;await f.click('Archiver le dossier');assert.equal(f.requests.find(r=>r.url.endsWith('/archive')).body.expectedVersion,1);assert.equal(f.dom.window.document.querySelector('[aria-label="Commentaire — Clavier"]').disabled,true);assert.match(f.dom.window.document.body.textContent,/Archivé · Lecture seule/);}finally{await f.cleanup();}});

test('unsaved dossier edits block in-app navigation unless confirmed',async()=>{const f=fixture({dossiers:[dossier]});try{await f.render();await f.click('Ouvrir Alice · Acme TI');await f.input('Commentaire — Clavier','À conserver');f.dom.window.confirm=()=>false;const anchor=f.dom.window.document.createElement('a');anchor.href='/clients';f.dom.window.document.body.append(anchor);const event=new f.dom.window.MouseEvent('click',{bubbles:true,cancelable:true});anchor.dispatchEvent(event);assert.equal(event.defaultPrevented,true);assert.equal(f.dom.window.document.querySelector('[aria-label="Commentaire — Clavier"]').value,'À conserver');}finally{await f.cleanup();}});

test('unsaved workstation edits veto sidebar logout',async()=>{const f=fixture({dossiers:[dossier]});try{await f.render();await f.click('Ouvrir Alice · Acme TI');await f.input('Commentaire — Clavier','À conserver');f.dom.window.confirm=()=>false;const event=new f.dom.window.Event('client-onboarding:before-logout',{cancelable:true});assert.equal(f.dom.window.dispatchEvent(event),false);}finally{await f.cleanup();}});

test('unfinished new dossier metadata blocks navigation',async()=>{const f=fixture();try{await f.render();await f.input('Employé','Brouillon');f.dom.window.confirm=()=>false;const anchor=f.dom.window.document.createElement('a');anchor.href='/clients';f.dom.window.document.body.append(anchor);const event=new f.dom.window.MouseEvent('click',{bubbles:true,cancelable:true});anchor.dispatchEvent(event);assert.equal(event.defaultPrevented,true);assert.equal(f.dom.window.document.querySelector('[aria-label="Employé"]').value,'Brouillon');}finally{await f.cleanup();}});

test('printer motif label warns that an empty value requires verification, not any printer',async()=>{const f=fixture();try{await f.render();const label=f.dom.window.document.querySelector('input[aria-label="Motif de l’imprimante"]')?.closest('label')?.textContent||'';assert.match(label,/vide = à vérifier/i);assert.doesNotMatch(label,/vide = toute imprimante/i);}finally{await f.cleanup();}});

test('audit download requires a client and its selected procedure',async()=>{const f=fixture();const oldCreate=URL.createObjectURL;let downloads=0;URL.createObjectURL=()=>{downloads++;return 'blob:fixture';};try{await f.render();await f.click('Télécharger le script .ps1');assert.equal(downloads,0);assert.ok(!f.requests.some(r=>r.url.includes('/audit-source?')));assert.match(f.dom.window.document.body.textContent,/Choisissez.*client.*modèle/i);}finally{URL.createObjectURL=oldCreate;await f.cleanup();}});

test('audit uses an authoritative selected client and template instead of generic BZ defaults',async()=>{const f=fixture();const oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL,oldClick=f.dom.window.HTMLAnchorElement.prototype.click;URL.createObjectURL=()=> 'blob:fixture';URL.revokeObjectURL=()=>{};f.dom.window.HTMLAnchorElement.prototype.click=function(){};try{await f.render();await f.input('Client','2');await f.input('Modèle','3');await f.click('Télécharger le script .ps1');assert.ok(f.requests.some(r=>r.url.includes('/audit-source?clientId=2&templateId=3')));assert.equal(globalThis.__scriptConfig.clientName,'Acme TI');assert.equal(globalThis.__scriptConfig.procedure.name,'Standard Windows');assert.deepEqual(globalThis.__scriptConfig.procedure.sections,template.sections);}finally{f.dom.window.HTMLAnchorElement.prototype.click=oldClick;URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke;await f.cleanup();}});

test('denied or malformed audit source never falls back to a generic client script',async()=>{for(const answer of [Response.json({error:'Introuvable'},{status:404}),Response.json({client:{id:4,nom:'Autre client'},template})]){const f=fixture({override:({url})=>url.includes('/audit-source?')?answer:undefined});const oldCreate=URL.createObjectURL;let downloads=0;URL.createObjectURL=()=>{downloads++;return 'blob:fixture';};try{await f.render();await f.input('Client','2');await f.input('Modèle','3');await f.click('Télécharger le script .ps1');assert.equal(downloads,0);assert.ok(f.dom.window.document.querySelector('[role="alert"]'));}finally{URL.createObjectURL=oldCreate;await f.cleanup();}}});

test('audit uses the assignment-scoped saved dossier snapshot even when the creation form has no model selected',async()=>{const f=fixture({dossiers:[dossier]});const oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL,oldClick=f.dom.window.HTMLAnchorElement.prototype.click;URL.createObjectURL=()=> 'blob:fixture';URL.revokeObjectURL=()=>{};f.dom.window.HTMLAnchorElement.prototype.click=function(){};try{await f.render();await f.click('Ouvrir Alice · Acme TI');await f.click('Télécharger le script .ps1');assert.equal(f.requests.filter(r=>r.url==='/api/workstation-procedures/dossiers/11').length,1);assert.deepEqual(f.requests.filter(r=>r.url==='/api/workstation-procedures/audit-source/dossier/11').map(r=>r.method),['GET']);assert.equal(globalThis.__scriptConfig.clientName,'Acme TI');assert.deepEqual(globalThis.__scriptConfig.procedure.sections,dossier.sections);assert.ok(!f.requests.some(r=>r.url.includes('/audit-source?')));}finally{f.dom.window.HTMLAnchorElement.prototype.click=oldClick;URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke;await f.cleanup();}});

test('denied saved-dossier audit does not fall back to historical read or create a Blob',async()=>{for(const status of [403,404]){const f=fixture({dossiers:[dossier],override:({url})=>url==='/api/workstation-procedures/audit-source/dossier/11'?Response.json({error:'Dossier non attribué'},{status}):undefined});const oldCreate=URL.createObjectURL;let downloads=0;URL.createObjectURL=()=>{downloads++;return 'blob:fixture';};try{await f.render();await f.click('Ouvrir Alice · Acme TI');await f.click('Télécharger le script .ps1');assert.equal(downloads,0);assert.equal(f.requests.filter(r=>r.url==='/api/workstation-procedures/dossiers/11').length,1);assert.deepEqual(f.requests.filter(r=>r.url==='/api/workstation-procedures/audit-source/dossier/11').map(r=>r.method),['GET']);assert.match(f.dom.window.document.querySelector('[role="alert"]')?.textContent??'',/Dossier non attribué/);}finally{URL.createObjectURL=oldCreate;await f.cleanup();}}});

test('invalid saved-dossier audit projection cannot fall back or create a Blob',async()=>{for(const payload of [{dossier:{...dossier,id:12}},{dossier:{id:11,version:1}},{...dossier}]){const f=fixture({dossiers:[dossier],override:({url})=>url==='/api/workstation-procedures/audit-source/dossier/11'?Response.json(payload):undefined});const oldCreate=URL.createObjectURL;let downloads=0;URL.createObjectURL=()=>{downloads++;return 'blob:fixture';};try{await f.render();await f.click('Ouvrir Alice · Acme TI');await f.click('Télécharger le script .ps1');assert.equal(downloads,0);assert.equal(f.requests.filter(r=>r.url==='/api/workstation-procedures/dossiers/11').length,1);assert.ok(f.dom.window.document.querySelector('[role="alert"]'));}finally{URL.createObjectURL=oldCreate;await f.cleanup();}}});

test('audit refuses a dossier changed on the server instead of mixing procedure versions',async()=>{let reads=0;const f=fixture({dossiers:[dossier],override:({url,method})=>url==='/api/workstation-procedures/dossiers/11'&&method==='GET'?(reads++,Response.json({dossier})):url==='/api/workstation-procedures/audit-source/dossier/11'?Response.json({dossier:{...dossier,version:2}}):undefined});const oldCreate=URL.createObjectURL;let downloads=0;URL.createObjectURL=()=>{downloads++;return 'blob:fixture';};try{await f.render();await f.click('Ouvrir Alice · Acme TI');await f.click('Télécharger le script .ps1');assert.equal(reads,1);assert.equal(downloads,0);assert.match(f.dom.window.document.body.textContent,/modifié.*rechargez/i);}finally{URL.createObjectURL=oldCreate;await f.cleanup();}});

test('unsaved dossier edits block an audit download without losing the edit',async()=>{const f=fixture({dossiers:[dossier]});const oldCreate=URL.createObjectURL;let downloads=0;URL.createObjectURL=()=>{downloads++;return 'blob:fixture';};try{await f.render();await f.click('Ouvrir Alice · Acme TI');await f.input('Commentaire — Clavier','À sauvegarder');await f.click('Télécharger le script .ps1');assert.equal(downloads,0);assert.equal(f.dom.window.document.querySelector('[aria-label="Commentaire — Clavier"]').value,'À sauvegarder');assert.match(f.dom.window.document.body.textContent,/Sauvegardez.*dossier/i);}finally{URL.createObjectURL=oldCreate;await f.cleanup();}});

test('changing the creation model while audit-source is pending never downloads the old script',async()=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const alternate={...template,id:8,name:'Other Windows'};
  const f=fixture({templates:[template,alternate],override:({url})=>url.includes('/audit-source?')?gate.then(()=>Response.json({client:{id:2,nom:'Acme TI'},template})):undefined});
  const oldCreate=URL.createObjectURL;let downloads=0;URL.createObjectURL=()=>{downloads++;return 'blob:fixture';};
  try{
    await f.render();await f.input('Client','2');await f.input('Modèle','3');
    await act(()=>[...f.dom.window.document.querySelectorAll('button')].find(b=>b.textContent==='Télécharger le script .ps1').click());
    assert.ok(f.requests.some(r=>r.url.includes('/audit-source?clientId=2&templateId=3')));
    await f.input('Modèle','8');await act(async()=>release());
    assert.equal(f.dom.window.document.querySelector('[aria-label="Modèle"]').value,'8');
    assert.equal(downloads,0);assert.doesNotMatch(f.dom.window.document.body.textContent,/Script généré/);
  }finally{release();URL.createObjectURL=oldCreate;await f.cleanup();}
});

test('changing the creation client while audit-source is pending never downloads the old script',async()=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const f=fixture({override:({url})=>url.includes('/audit-source?')?gate.then(()=>Response.json({client:{id:2,nom:'Acme TI'},template})):undefined});
  const oldCreate=URL.createObjectURL;let downloads=0;URL.createObjectURL=()=>{downloads++;return 'blob:fixture';};
  try{
    await f.render();await f.input('Client','2');await f.input('Modèle','3');
    await act(()=>[...f.dom.window.document.querySelectorAll('button')].find(b=>b.textContent==='Télécharger le script .ps1').click());
    assert.ok(f.requests.some(r=>r.url.includes('/audit-source?clientId=2&templateId=3')));
    await f.input('Client','');await act(async()=>release());
    assert.equal(f.dom.window.document.querySelector('[aria-label="Client"]').value,'');
    assert.equal(downloads,0);assert.doesNotMatch(f.dom.window.document.body.textContent,/Script généré/);
  }finally{release();URL.createObjectURL=oldCreate;await f.cleanup();}
});

test('changing generator prefix during audit-source fetch preserves the edit and skips the stale template download',async()=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const f=fixture({override:({url})=>url.includes('/audit-source?')?gate.then(()=>Response.json({client:{id:2,nom:'Acme TI'},template})):undefined});
  const oldCreate=URL.createObjectURL;let downloads=0;URL.createObjectURL=()=>{downloads++;return 'blob:fixture';};
  try{
    await f.render();await f.input('Client','2');await f.input('Modèle','3');await f.input('Préfixe du client','OLD-');
    await act(()=>[...f.dom.window.document.querySelectorAll('button')].find(b=>b.textContent==='Télécharger le script .ps1').click());
    assert.ok(f.requests.some(r=>r.url.includes('/audit-source?clientId=2&templateId=3')));
    await f.input('Préfixe du client','NEW-');await act(async()=>release());
    assert.equal(f.dom.window.document.querySelector('[aria-label="Préfixe du client"]').value,'NEW-');
    assert.equal(downloads,0);assert.doesNotMatch(f.dom.window.document.body.textContent,/Script généré/);
  }finally{release();URL.createObjectURL=oldCreate;await f.cleanup();}
});

test('changing generator applications during dossier recheck preserves the edit and skips the stale dossier download',async()=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});let reads=0;
  const f=fixture({dossiers:[dossier],override:({url,method})=>url==='/api/workstation-procedures/dossiers/11'&&method==='GET'?(reads++,Response.json({dossier})):url==='/api/workstation-procedures/audit-source/dossier/11'?(reads++,gate.then(()=>Response.json({dossier}))):undefined});
  const oldCreate=URL.createObjectURL;let downloads=0;URL.createObjectURL=()=>{downloads++;return 'blob:fixture';};
  try{
    await f.render();await f.click('Ouvrir Alice · Acme TI');await f.input('Applications attendues','Old app');
    await act(()=>[...f.dom.window.document.querySelectorAll('button')].find(b=>b.textContent==='Télécharger le script .ps1').click());
    assert.equal(reads,2);
    await f.input('Applications attendues','New app');await act(async()=>release());
    assert.equal(f.dom.window.document.querySelector('[aria-label="Applications attendues"]').value,'New app');
    assert.equal(downloads,0);assert.doesNotMatch(f.dom.window.document.body.textContent,/Script généré/);
  }finally{release();URL.createObjectURL=oldCreate;await f.cleanup();}
});

test('unsaved procedure-model edits block audit export without discarding edits',async()=>{
  const f=fixture();const oldCreate=URL.createObjectURL;let downloads=0;
  URL.createObjectURL=()=>{downloads++;return 'blob:fixture';};
  try{
    await f.render();await f.input('Client','2');await f.input('Modèle','3');
    f.dom.window.confirm=()=>true;
    await f.click('Standard Windows · Global');await f.input('Titre étape 1.1','Clavier modifié non sauvegardé');
    await f.click('Télécharger le script .ps1');
    assert.equal(downloads,0);assert.ok(!f.requests.some(r=>r.url.includes('/audit-source?')));
    assert.match(f.dom.window.document.querySelector('[role="alert"]')?.textContent??'',/Sauvegardez.*modèle.*(annulez|rouvr)/i);
    assert.equal(f.dom.window.document.querySelector('[aria-label="Titre étape 1.1"]').value,'Clavier modifié non sauvegardé');
    assert.equal([...f.dom.window.document.querySelectorAll('button')].find(b=>b.textContent==='Sauvegarder le modèle').disabled,false);
  }finally{URL.createObjectURL=oldCreate;await f.cleanup();}
});

test('script panel passes client-specific audit settings to generator',async()=>{const f=fixture();const oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL;URL.createObjectURL=()=> 'blob:fixture';URL.revokeObjectURL=()=>{};const oldClick=f.dom.window.HTMLAnchorElement.prototype.click;f.dom.window.HTMLAnchorElement.prototype.click=function(){globalThis.__downloadName=this.download;};try{await f.render();await f.input('Client','2');await f.input('Modèle','3');await f.input('Préfixe du client','ACME-');await f.input('Compte administrateur','local-admin');await f.input('Clavier attendu','fr-CA, en-US');await f.input('Motif de l’imprimante','Bureau');await f.input('Applications attendues','Office\nChrome');await f.click('Télécharger le script .ps1');assert.equal(globalThis.__scriptConfig.clientName,'Acme TI');assert.equal(globalThis.__scriptConfig.computerPrefix,'ACME-');assert.equal(globalThis.__scriptConfig.adminLocal,'local-admin');assert.deepEqual(globalThis.__scriptConfig.keyboards,['fr-CA','en-US']);assert.equal(globalThis.__scriptConfig.printerName,'Bureau');assert.deepEqual(globalThis.__scriptConfig.apps,['Office','Chrome']);assert.deepEqual(globalThis.__scriptConfig.procedure.sections,template.sections);assert.equal(globalThis.__downloadName,'audit-poste-windows.ps1');}finally{f.dom.window.HTMLAnchorElement.prototype.click=oldClick;URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke;await f.cleanup();}});

test('Prime cannot edit global template but can create a client-scoped model',async()=>{globalThis.__workstationRole='user';const f=fixture();try{await f.render();assert.ok(![...f.dom.window.document.querySelectorAll('button')].some(b=>b.textContent.includes('Standard Windows · Global')));await f.click('Nouveau modèle');const scope=f.dom.window.document.querySelector('[aria-label="Client du modèle"]');assert.ok(scope);assert.ok(![...scope.options].some(o=>o.value===''));await f.input('Client du modèle','2');await f.input('Nom du modèle','Client Windows');await f.click('Ajouter une section');await f.input('Titre de section 1','Installation');await f.click('Ajouter une étape 1');await f.input('Titre étape 1.1','Imprimante');await f.click('Sauvegarder le modèle');assert.equal(f.requests.find(r=>r.method==='POST'&&r.url.endsWith('/templates')).body.clientId,2);}finally{globalThis.__workstationRole='admin';await f.cleanup();}});

test('Prime duplicates the global standard into an explicitly selected TI client without changing the source',async()=>{globalThis.__workstationRole='user';const f=fixture();try{await f.render();assert.ok(![...f.dom.window.document.querySelectorAll('button')].some(b=>b.textContent.includes('Standard Windows · Global')));await f.click('Dupliquer pour un client');assert.equal(f.dom.window.document.querySelector('[aria-label="Nom du modèle"]').value,'Standard Windows');assert.equal(f.dom.window.document.querySelector('[aria-label="Titre de section 1"]').value,'Préparation');assert.equal(f.dom.window.document.querySelector('[aria-label="Titre étape 1.1"]').value,'Clavier');const save=[...f.dom.window.document.querySelectorAll('button')].find(b=>b.textContent==='Sauvegarder le modèle');assert.equal(save.disabled,true);await f.input('Client du modèle','2');await f.input('Titre étape 1.1','Clavier client');await f.click('Sauvegarder le modèle');const post=f.requests.find(r=>r.method==='POST'&&r.url.endsWith('/templates'));assert.equal(post.body.clientId,2);assert.equal(post.body.sections[0].steps[0].title,'Clavier client');assert.equal(template.sections[0].steps[0].title,'Clavier');assert.ok(!f.requests.some(r=>r.method==='PUT'&&r.url.endsWith('/templates/3')));}finally{globalThis.__workstationRole='admin';await f.cleanup();}});

test('unfinished creation metadata is guarded when switching editors',async()=>{const f=fixture();try{await f.render();await f.input('Employé','À conserver');f.dom.window.confirm=()=>false;await f.click('Nouveau modèle');assert.ok(!f.dom.window.document.querySelector('[aria-label="Nom du modèle"]'));assert.equal(f.dom.window.document.querySelector('[aria-label="Employé"]').value,'À conserver');}finally{await f.cleanup();}});

test('script download link is not canceled by the page navigation guard while export is busy',async()=>{const f=fixture();const oldCreate=URL.createObjectURL,oldClick=f.dom.window.HTMLAnchorElement.prototype.click;let blocked;URL.createObjectURL=()=> 'blob:http://localhost/fixture';f.dom.window.HTMLAnchorElement.prototype.click=function(){this.addEventListener('click',e=>{blocked=e.defaultPrevented;e.preventDefault();},{once:true});this.dispatchEvent(new f.dom.window.MouseEvent('click',{bubbles:true,cancelable:true}));};try{await f.render();await f.input('Client','2');await f.input('Modèle','3');await f.click('Télécharger le script .ps1');assert.equal(blocked,false,'download anchor must reach Chrome without preventDefault');}finally{URL.createObjectURL=oldCreate;f.dom.window.HTMLAnchorElement.prototype.click=oldClick;await f.cleanup();}});

test('download attribute on an external link cannot bypass the unsaved-edit navigation guard',async()=>{const f=fixture({dossiers:[dossier]});try{await f.render();await f.click('Ouvrir Alice · Acme TI');await f.input('Commentaire — Clavier','À conserver');f.dom.window.confirm=()=>false;const anchor=f.dom.window.document.createElement('a');anchor.href='https://example.org/leave';anchor.download='fichier.html';f.dom.window.document.body.append(anchor);const event=new f.dom.window.MouseEvent('click',{bubbles:true,cancelable:true});anchor.dispatchEvent(event);assert.equal(event.defaultPrevented,true);}finally{await f.cleanup();}});

test('downloads a self-contained HTML procedure from the authorized client model',async()=>{const f=fixture();const oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL,oldClick=f.dom.window.HTMLAnchorElement.prototype.click;let blob,filename;URL.createObjectURL=value=>{blob=value;return 'blob:fixture';};URL.revokeObjectURL=()=>{};f.dom.window.HTMLAnchorElement.prototype.click=function(){filename=this.download;};try{await f.render();await f.input('Client','2');await f.input('Modèle','3');await f.click('Télécharger la procédure HTML');assert.ok(f.requests.some(r=>r.url.includes('/audit-source?clientId=2&templateId=3')));assert.equal(filename,'procedure-installation-poste.html');assert.ok(blob,'HTML file should be created');const html=await new Promise((resolve,reject)=>{const reader=new f.dom.window.FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsText(blob);});assert.match(html,/<!doctype html>/i);assert.match(html,/Standard Windows/);assert.match(html,/Acme TI/);assert.match(html,/Clavier/);assert.match(html,/Vérifier FR/);}finally{URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke;f.dom.window.HTMLAnchorElement.prototype.click=oldClick;await f.cleanup();}});

test('exports saved dossier HTML with recorded answers and never substitutes the model',async()=>{const saved={...dossier,sections:[{title:'Section du dossier',steps:[{id:'saved-only',title:'Installation terminée',note:'Vérifiée',etat:'fait',commentaire:'Prêt à livrer'}]}]};const f=fixture({dossiers:[saved]});const oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL,oldClick=f.dom.window.HTMLAnchorElement.prototype.click;let blob;URL.createObjectURL=value=>{blob=value;return 'blob:fixture';};URL.revokeObjectURL=()=>{};f.dom.window.HTMLAnchorElement.prototype.click=function(){};try{await f.render();await f.click('Ouvrir Alice · Acme TI');await f.click('Télécharger la procédure HTML');assert.ok(f.requests.some(r=>r.url==='/api/workstation-procedures/audit-source/dossier/11'));assert.ok(!f.requests.some(r=>r.url.includes('/audit-source?')));assert.ok(blob);const html=await new Promise((resolve,reject)=>{const reader=new f.dom.window.FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsText(blob);});assert.match(html,/Installation terminée/);assert.match(html,/Prêt à livrer/);assert.doesNotMatch(html,/Clavier/);}finally{URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke;f.dom.window.HTMLAnchorElement.prototype.click=oldClick;await f.cleanup();}});

test('HTML export refuses unsaved dossier changes and assignment-denied snapshots',async()=>{const f=fixture({dossiers:[dossier],override:({url})=>url==='/api/workstation-procedures/audit-source/dossier/11'?Response.json({error:'Accès refusé'},{status:403}):undefined});const oldCreate=URL.createObjectURL;let blobs=0;URL.createObjectURL=()=>{blobs++;return 'blob:fixture';};try{await f.render();await f.click('Ouvrir Alice · Acme TI');await f.input('Commentaire — Clavier','À sauvegarder');await f.click('Télécharger la procédure HTML');assert.equal(blobs,0);assert.match(f.dom.window.document.body.textContent,/Sauvegardez le dossier/);assert.ok(!f.requests.some(r=>r.url.includes('/audit-source/')));await f.click('Sauvegarder le dossier');await f.click('Télécharger la procédure HTML');assert.equal(blobs,0);assert.match(f.dom.window.document.querySelector('[role="alert"]')?.textContent??'',/Accès refusé/);}finally{URL.createObjectURL=oldCreate;await f.cleanup();}});

test('denied HTML template source never falls back to a listed model or creates a Blob',async()=>{
  const f=fixture({override:({url})=>url.includes('/audit-source?')?Response.json({error:'Accès refusé'},{status:403}):undefined});
  const oldCreate=URL.createObjectURL;let blobs=0;URL.createObjectURL=()=>{blobs++;return 'blob:fixture';};
  try{await f.render();await f.input('Client','2');await f.input('Modèle','3');await f.click('Télécharger la procédure HTML');assert.equal(blobs,0);assert.match(f.dom.window.document.querySelector('[role="alert"]')?.textContent??'',/Accès refusé/);}
  finally{URL.createObjectURL=oldCreate;await f.cleanup();}
});

test('HTML and PS1 refuse a server-changed selected template and ask to reload',async()=>{
  for(const format of ['Télécharger la procédure HTML','Télécharger le script .ps1'])for(const changed of [
    {...template,version:2},{...template,name:'Modèle modifié'},
    {...template,clientId:2},{...template,sections:[{title:'Nouvelle section',steps:[]}]}
  ]){
    const f=fixture({override:({url})=>url.includes('/audit-source?')?Response.json({client:{id:2,nom:'Acme TI'},template:changed}):undefined});
    const oldCreate=URL.createObjectURL;let blobs=0;URL.createObjectURL=()=>{blobs++;return 'blob:fixture';};
    try{await f.render();await f.input('Client','2');await f.input('Modèle','3');await f.click(format);assert.equal(blobs,0,`${format}: ${JSON.stringify(changed)}`);assert.match(f.dom.window.document.querySelector('[role="alert"]')?.textContent??'',/rechargez/i);}
    finally{URL.createObjectURL=oldCreate;await f.cleanup();}
  }
});

test('verification-start synchronously cancels deferred HTML and PS1 exports, even after same-account re-arm',async()=>{
  for(const format of ['Télécharger la procédure HTML','Télécharger le script .ps1'])for(const useDossier of [false,true]){
    let release;const gate=new Promise(resolve=>{release=resolve;});
    const f=fixture({dossiers:useDossier?[dossier]:[],override:({url})=>url.includes('/audit-source')?gate.then(()=>url.includes('/dossier/')?Response.json({dossier}):Response.json({client:{id:2,nom:'Acme TI'},template})):undefined});
    const oldCreate=URL.createObjectURL;let blobs=0;URL.createObjectURL=()=>{blobs++;return 'blob:fixture';};
    try{
      await f.render();if(useDossier)await f.click('Ouvrir Alice · Acme TI');else{await f.input('Client','2');await f.input('Modèle','3');}
      await act(()=>[...f.dom.window.document.querySelectorAll('button')].find(b=>b.textContent===format).click());
      await act(async()=>{f.auth.start();});
      f.auth.loading=false; // /me failed: the old editor is still mounted.
      await act(async()=>release());
      assert.equal(blobs,0,`${format} must not download after failed verification`);
      await f.click(format);assert.equal(blobs,0,'failed /me cannot start a new export');
      f.auth.verified=true;f.auth.epoch++;await f.render();
      await f.click(format);assert.equal(blobs,1,'same-account confirmed /me re-arms export');
    }finally{release();URL.createObjectURL=oldCreate;await f.cleanup();}
  }
});

test('an old deferred response cannot download after same-account revalidation re-arms a newer export',async()=>{
  for(const format of ['Télécharger la procédure HTML','Télécharger le script .ps1']){
    let releaseOld,reads=0;const oldGate=new Promise(resolve=>{releaseOld=resolve;});
    const f=fixture({override:({url})=>url.includes('/audit-source?')?(++reads===1?oldGate.then(()=>Response.json({client:{id:2,nom:'Acme TI'},template})):Response.json({client:{id:2,nom:'Acme TI'},template})):undefined});
    const oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL,oldClick=f.dom.window.HTMLAnchorElement.prototype.click;let blobs=0;
    URL.createObjectURL=()=>{blobs++;return 'blob:fixture';};URL.revokeObjectURL=()=>{};f.dom.window.HTMLAnchorElement.prototype.click=function(){};
    try{await f.render();await f.input('Client','2');await f.input('Modèle','3');await act(()=>[...f.dom.window.document.querySelectorAll('button')].find(b=>b.textContent===format).click());
      await act(async()=>{f.auth.start();});f.auth.verified=true;f.auth.loading=false;await f.render();
      await f.click(format);assert.equal(blobs,1,'confirmed new export completes despite prior request');
      await act(async()=>releaseOld());assert.equal(blobs,1,'old response cannot download even after re-arm');
    }finally{releaseOld();URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke;f.dom.window.HTMLAnchorElement.prototype.click=oldClick;await f.cleanup();}
  }
});

test('account switch or logout invalidates an in-flight HTML export before its response',async()=>{
  for(const next of [{id:2,role:'admin'},null]){
    let release;const gate=new Promise(resolve=>{release=resolve;});
    const f=fixture({override:({url})=>url.includes('/audit-source?')?gate.then(()=>Response.json({client:{id:2,nom:'Acme TI'},template})):undefined});
    const oldCreate=URL.createObjectURL;let blobs=0;URL.createObjectURL=()=>{blobs++;return 'blob:fixture';};
    try{await f.render();await f.input('Client','2');await f.input('Modèle','3');await act(()=>[...f.dom.window.document.querySelectorAll('button')].find(b=>b.textContent==='Télécharger la procédure HTML').click());
      await act(async()=>{f.auth.start();f.auth.user=next;f.auth.verified=true;f.auth.loading=false;});await f.render();await act(async()=>release());
      assert.equal(blobs,0);assert.equal(f.auth.user?.id,next?.id);
    }finally{release();URL.createObjectURL=oldCreate;await f.cleanup();}
  }
});

test('changing model while the HTML source is pending cancels the old export',async()=>{let release;const gate=new Promise(resolve=>{release=resolve;});const alternate={...template,id:8,name:'Autre modèle'};const f=fixture({templates:[template,alternate],override:({url})=>url.includes('/audit-source?')?gate.then(()=>Response.json({client:{id:2,nom:'Acme TI'},template})):undefined});const oldCreate=URL.createObjectURL;let blobs=0;URL.createObjectURL=()=>{blobs++;return 'blob:fixture';};try{await f.render();await f.input('Client','2');await f.input('Modèle','3');await act(()=>[...f.dom.window.document.querySelectorAll('button')].find(b=>b.textContent==='Télécharger la procédure HTML').click());await f.input('Modèle','8');await act(async()=>release());assert.equal(blobs,0);assert.equal(f.dom.window.document.querySelector('[aria-label="Modèle"]').value,'8');}finally{release();URL.createObjectURL=oldCreate;await f.cleanup();}});

test('PowerShell download starts with a UTF-8 BOM before script text',async()=>{const f=fixture();const oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL,oldClick=f.dom.window.HTMLAnchorElement.prototype.click;let blob;URL.createObjectURL=value=>{blob=value;return 'blob:fixture';};URL.revokeObjectURL=()=>{};f.dom.window.HTMLAnchorElement.prototype.click=function(){};try{await f.render();await f.input('Client','2');await f.input('Modèle','3');await f.click('Télécharger le script .ps1');assert.ok(blob);const bytes=await new Promise((resolve,reject)=>{const reader=new f.dom.window.FileReader();reader.onload=()=>resolve(new Uint8Array(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsArrayBuffer(blob);});assert.deepEqual([...bytes].slice(0,6),[0xef,0xbb,0xbf,0x23,0x20,0x54]);}finally{f.dom.window.HTMLAnchorElement.prototype.click=oldClick;URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke;await f.cleanup();}});

test('BrowserRouter back and forward recovers unsaved dossier edits after route unmount',async()=>{const f=fixture({dossiers:[dossier],browserRouter:true});try{await f.render();await f.click('Ouvrir Alice · Acme TI');await f.input('Commentaire — Clavier','À conserver');f.dom.window.confirm=()=>true;await act(async()=>f.dom.window.document.querySelector('nav a').click());assert.match(f.dom.window.document.body.textContent,/Page clients/);await act(async()=>{f.dom.window.history.back();await new Promise(resolve=>setTimeout(resolve,30));});assert.equal(f.dom.window.location.pathname,'/procedures/installation-postes');assert.equal(f.dom.window.document.querySelector('[aria-label="Commentaire — Clavier"]')?.value,'À conserver');await act(async()=>{f.dom.window.history.forward();await new Promise(resolve=>setTimeout(resolve,30));});assert.match(f.dom.window.document.body.textContent,/Page clients/);await act(async()=>{f.dom.window.history.back();await new Promise(resolve=>setTimeout(resolve,30));});assert.equal(f.dom.window.document.querySelector('[aria-label="Commentaire — Clavier"]')?.value,'À conserver');}finally{await f.cleanup();}});

test('BrowserRouter restored edits never appear for another signed-in identity',async()=>{const f=fixture({dossiers:[dossier],browserRouter:true});try{globalThis.__workstationUserId=1;await f.render();await f.click('Ouvrir Alice · Acme TI');await f.input('Commentaire — Clavier','Secret utilisateur 1');f.dom.window.confirm=()=>true;await act(async()=>f.dom.window.document.querySelector('nav a').click());globalThis.__workstationUserId=2;f.auth.user={id:2,role:'admin'};await act(async()=>{f.dom.window.history.back();await new Promise(resolve=>setTimeout(resolve,30));});assert.ok(!f.dom.window.document.body.textContent.includes('Secret utilisateur 1'));assert.ok(!f.dom.window.document.querySelector('[aria-label="Commentaire — Clavier"]'));await f.click('Ouvrir Alice · Acme TI');assert.equal(f.dom.window.document.querySelector('[aria-label="Commentaire — Clavier"]').value,'');}finally{globalThis.__workstationUserId=1;await f.cleanup();}});

test('BrowserRouter restores unfinished creation and template edits across history',async()=>{const f=fixture({browserRouter:true});try{await f.render();await f.input('Employé','Brouillon création');f.dom.window.confirm=()=>true;await f.click('Nouveau modèle');await f.input('Nom du modèle','Brouillon modèle');await act(async()=>f.dom.window.document.querySelector('nav a').click());await act(async()=>{f.dom.window.history.back();await new Promise(resolve=>setTimeout(resolve,30));});assert.equal(f.dom.window.document.querySelector('[aria-label="Employé"]')?.value,'Brouillon création');assert.equal(f.dom.window.document.querySelector('[aria-label="Nom du modèle"]')?.value,'Brouillon modèle');}finally{await f.cleanup();}});

test('template editor can add a section and a step then save',async()=>{const f=fixture();try{await f.render();await f.click('Nouveau modèle');await f.input('Nom du modèle','Client Windows');await f.input('Client du modèle','2');await f.click('Ajouter une section');await f.input('Titre de section 1','Installation');await f.click('Ajouter une étape 1');await f.input('Titre étape 1.1','Imprimante');await f.click('Sauvegarder le modèle');const post=f.requests.find(r=>r.method==='POST'&&r.url.endsWith('/templates'));assert.equal(post.body.sections[0].steps[0].title,'Imprimante');assert.equal(post.body.clientId,2);}finally{await f.cleanup();}});

test('uncertain dossier POST reconciles by original UUID without a second POST',async()=>{let key;const f=fixture({override:({url,method,body})=>{if(url.endsWith('/dossiers')&&method==='POST'){key=body.requestKey;return Promise.reject(Error('connexion perdue'));}if(url.endsWith(`/dossiers/by-request/${key}`))return Response.json({dossier});}});try{await f.render();await f.input('Client','2');await f.input('Modèle','3');await f.click('Créer le dossier');assert.match(key,/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i);assert.equal(f.requests.filter(r=>r.method==='POST'&&r.url.endsWith('/dossiers')).length,1);assert.match(f.dom.window.document.body.textContent,/Dossier créé/);assert.equal(f.dom.window.sessionStorage.length,0);}finally{await f.cleanup();}});

test('404 after lost POST retains the same payload and key for explicit retry',async()=>{let attempts=0;const f=fixture({override:({url,method})=>{if(url.endsWith('/dossiers')&&method==='POST'&&++attempts===1)return Promise.reject(Error('timeout'));if(url.includes('/dossiers/by-request/'))return attempts===1?Response.json({error:'Introuvable'},{status:404}):Response.json({dossier});}});try{await f.render();await f.input('Client','2');await f.input('Modèle','3');await f.input('Employé','Original');await f.click('Créer le dossier');assert.doesNotMatch(f.dom.window.document.body.textContent,/Dossier créé/);await f.input('Employé','Modified');await f.click('Réessayer la création du dossier');const posts=f.requests.filter(r=>r.method==='POST'&&r.url.endsWith('/dossiers'));assert.equal(posts.length,2);assert.deepEqual(posts[0].body,posts[1].body);assert.match(f.dom.window.document.body.textContent,/Dossier créé/);}finally{await f.cleanup();}});

test('cursor controls load next pages and independent standard is deduped',async()=>{const second={...template,id:8,name:'Autre modèle'};const extra={...dossier,id:10,employee:'Bob'};const f=fixture({templates:[],override:({url})=>{if(url==='/api/workstation-procedures/templates')return Response.json({templates:[template],hasMore:true,nextBefore:3});if(url.endsWith('/templates?before=3'))return Response.json({templates:[second],hasMore:false,nextBefore:null});if(url==='/api/workstation-procedures/dossiers')return Response.json({dossiers:[dossier],hasMore:true,nextBefore:11});if(url.endsWith('/dossiers?before=11'))return Response.json({dossiers:[extra],hasMore:false,nextBefore:null});}});try{await f.render();assert.equal(f.dom.window.document.body.textContent.split('Dupliquer pour un client · Standard Windows').length-1,1);await f.click('Charger plus de modèles');await f.click('Charger plus de dossiers');assert.match(f.dom.window.document.body.textContent,/Autre modèle/);assert.match(f.dom.window.document.body.textContent,/Ouvrir Bob/);assert.ok(!f.dom.window.document.body.textContent.includes('Charger plus de modèles'));}finally{await f.cleanup();}});

test('restored pending intent on reload checks readback before allowing any POST',async()=>{const seed={kind:'dossier',payload:{requestKey:'9ecb3330-166b-4c93-9cd8-fce998336399',clientId:2,templateId:3,employee:'Secret',computer:'',ticket:'',date:'2026-11-09'}};const f=fixture({pendingSeed:seed,override:({url})=>url.includes('/by-request/')?Response.json({error:'Introuvable'},{status:404}):undefined});try{await f.render();assert.ok(f.requests.some(r=>r.url.includes(`/dossiers/by-request/${seed.payload.requestKey}`)));assert.equal(f.dom.window.document.querySelector('button').disabled,false);assert.equal([...f.dom.window.document.querySelectorAll('button')].find(b=>b.textContent==='Créer le dossier').disabled,true);assert.equal(f.requests.filter(r=>r.method==='POST').length,0);assert.deepEqual(JSON.parse(f.dom.window.sessionStorage.getItem('workstation-procedures:pending-create:1')),seed);}finally{await f.cleanup();}});

test('401 on readback never reports success and retains the original pending key',async()=>{const f=fixture({override:({url})=>url.includes('/by-request/')?Response.json({error:'Non autorisé'},{status:401}):undefined});try{await f.render();await f.input('Client','2');await f.input('Modèle','3');await f.click('Créer le dossier');assert.doesNotMatch(f.dom.window.document.body.textContent,/Dossier créé/);assert.match(f.dom.window.document.body.textContent,/Création non confirmée/);assert.ok(f.dom.window.sessionStorage.getItem('workstation-procedures:pending-create:1'));}finally{await f.cleanup();}});

test('invalid readback projection cannot clear pending creation or show success',async()=>{const f=fixture({override:({url})=>url.includes('/by-request/')?Response.json({dossier:{id:11,version:1}}):undefined});try{await f.render();await f.input('Client','2');await f.input('Modèle','3');await f.click('Créer le dossier');assert.doesNotMatch(f.dom.window.document.body.textContent,/Dossier créé/);assert.ok(f.dom.window.sessionStorage.getItem('workstation-procedures:pending-create:1'));}finally{await f.cleanup();}});

test('standard template remains available when paged template listing fails',async()=>{const f=fixture({override:({url})=>url==='/api/workstation-procedures/templates'?Response.json({error:'Unavailable'},{status:503}):undefined});try{await f.render();assert.match(f.dom.window.document.body.textContent,/Standard Windows/);assert.match(f.dom.window.document.body.textContent,/Unavailable/);}finally{await f.cleanup();}});

test('template lost POST reconciles by UUID without duplicating creation',async()=>{let key;const f=fixture({override:({url,method,body})=>{if(url.endsWith('/templates')&&method==='POST'){key=body.requestKey;return Promise.reject(Error('timeout'));}if(url.endsWith(`/templates/by-request/${key}`))return Response.json({template:{...template,id:9,clientId:2,name:'Client Windows'}});}});try{await f.render();await f.click('Nouveau modèle');await f.input('Nom du modèle','Client Windows');await f.input('Client du modèle','2');await f.click('Ajouter une section');await f.input('Titre de section 1','Installation');await f.click('Ajouter une étape 1');await f.input('Titre étape 1.1','Imprimante');await f.click('Sauvegarder le modèle');assert.match(key,/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i);assert.equal(f.requests.filter(r=>r.method==='POST'&&r.url.endsWith('/templates')).length,1);assert.match(f.dom.window.document.body.textContent,/Modèle sauvegardé/);assert.equal(f.dom.window.sessionStorage.length,0);}finally{await f.cleanup();}});

test('400 dossier validation clears verified intent and corrected 251-character employee retries with a new UUID',async()=>{const f=fixture({override:({url,method,body})=>url.endsWith('/dossiers')&&method==='POST'&&body.employee.length>250?Response.json({error:'Métadonnées invalides'},{status:400}):undefined});try{await f.render();await f.input('Client','2');await f.input('Modèle','3');await f.input('Employé','X'.repeat(251));await f.click('Créer le dossier');assert.match(f.dom.window.document.querySelector('[role="alert"]')?.textContent??'',/Métadonnées invalides/);assert.equal(f.dom.window.sessionStorage.length,0);assert.equal(f.dom.window.document.querySelector('[aria-label="Employé"]').value,'X'.repeat(251));assert.equal([...f.dom.window.document.querySelectorAll('button')].find(b=>b.textContent==='Créer le dossier').disabled,false);await f.input('Employé','Alice');await f.click('Créer le dossier');const posts=f.requests.filter(r=>r.method==='POST'&&r.url.endsWith('/dossiers'));assert.equal(posts.length,2);assert.notEqual(posts[0].body.requestKey,posts[1].body.requestKey);assert.equal(posts[1].body.employee,'Alice');assert.match(f.dom.window.document.body.textContent,/Dossier créé/);}finally{await f.cleanup();}});

test('400 invalid template keeps editable model and permits corrected retry with a new UUID',async()=>{const f=fixture({override:({url,method,body})=>url.endsWith('/templates')&&method==='POST'&&body.name.length>250?Response.json({error:'Nom invalide'},{status:400}):undefined});try{await f.render();await f.click('Nouveau modèle');await f.input('Client du modèle','2');await f.input('Nom du modèle','X'.repeat(251));await f.click('Ajouter une section');await f.input('Titre de section 1','Installation');await f.click('Ajouter une étape 1');await f.input('Titre étape 1.1','Imprimante');await f.click('Sauvegarder le modèle');assert.match(f.dom.window.document.querySelector('[role="alert"]')?.textContent??'',/Nom invalide/);assert.equal(f.dom.window.sessionStorage.length,0);assert.equal(f.dom.window.document.querySelector('[aria-label="Nom du modèle"]').value,'X'.repeat(251));assert.equal(f.dom.window.document.querySelector('[aria-label="Titre étape 1.1"]').value,'Imprimante');await f.input('Nom du modèle','Client Windows');await f.click('Sauvegarder le modèle');const posts=f.requests.filter(r=>r.method==='POST'&&r.url.endsWith('/templates'));assert.equal(posts.length,2);assert.notEqual(posts[0].body.requestKey,posts[1].body.requestKey);assert.match(f.dom.window.document.body.textContent,/Modèle sauvegardé/);}finally{await f.cleanup();}});

test('failed pending-intent removal after 400 fails closed and keeps the draft',async()=>{const f=fixture({override:({url,method})=>url.endsWith('/dossiers')&&method==='POST'?Response.json({error:'Métadonnées invalides'},{status:400}):undefined});try{await f.render();await f.input('Client','2');await f.input('Modèle','3');await f.input('Employé','X'.repeat(251));const storage=f.dom.window.sessionStorage;const storageProto=f.dom.window.Storage.prototype;const remove=storageProto.removeItem;storageProto.removeItem=function(){};try{await f.click('Créer le dossier');assert.ok(storage.getItem('workstation-procedures:pending-create:1'));assert.equal([...f.dom.window.document.querySelectorAll('button')].find(b=>b.textContent==='Créer le dossier').disabled,true);assert.equal(f.dom.window.document.querySelector('[aria-label="Employé"]').value,'X'.repeat(251));await f.input('Employé','Corrected');await f.click('Créer le dossier');assert.equal(f.requests.filter(r=>r.method==='POST'&&r.url.endsWith('/dossiers')).length,1);}finally{storageProto.removeItem=remove;}}finally{await f.cleanup();}});

test('print renders saved and edited answers as black static text while hiding controls',async()=>{const f=fixture({dossiers:[dossier]});try{await f.render();await f.click('Ouvrir Alice · Acme TI');assert.equal(f.dom.window.document.querySelector('.workstation-print-area .workstation-print-answer')?.textContent,'À faire');await f.input('État — Clavier','fait');await f.input('Commentaire — Clavier','Vérifié\nDeuxième ligne');const css=f.dom.window.document.querySelector('style[data-workstation-print]')?.textContent??'';assert.match(css,/\.workstation-print-control\s*\{[^}]*display:\s*none\s*!important/s);assert.match(css,/\.workstation-print-answer\s*\{[^}]*display:\s*block\s*!important[^}]*color:\s*(?:#000|black)\s*!important/s);const labels=[...f.dom.window.document.querySelectorAll('.workstation-print-area label')];const state=labels.find(l=>l.textContent.includes('État'));const comment=labels.find(l=>l.textContent.includes('Commentaire'));assert.equal(state?.querySelector('.workstation-print-answer')?.textContent,'Fait');assert.equal(comment?.querySelector('.workstation-print-answer')?.textContent,'Vérifié\nDeuxième ligne');assert.ok(state?.querySelector('select.workstation-print-control'));assert.ok(comment?.querySelector('textarea.workstation-print-control'));}finally{await f.cleanup();}});

test('409 create rejection retains pending UUID instead of permitting a new POST',async()=>{const f=fixture({override:({url,method})=>url.endsWith('/dossiers')&&method==='POST'?Response.json({error:'requestKey déjà utilisé'},{status:409}):undefined});try{await f.render();await f.input('Client','2');await f.input('Modèle','3');await f.click('Créer le dossier');assert.ok(f.dom.window.sessionStorage.getItem('workstation-procedures:pending-create:1'));assert.equal([...f.dom.window.document.querySelectorAll('button')].find(b=>b.textContent==='Créer le dossier').disabled,true);assert.equal(f.requests.filter(r=>r.method==='POST'&&r.url.endsWith('/dossiers')).length,1);}finally{await f.cleanup();}});

test('delayed pending dossier readback does not replace an opened dirty dossier',async()=>{
  const seed={kind:'dossier',payload:{requestKey:'9ecb3330-166b-4c93-9cd8-fce998336399',clientId:2,templateId:3,employee:'New',computer:'',ticket:'',date:'2026-11-09'}};
  const newly={...dossier,id:12,employee:'New'};
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const f=fixture({dossiers:[dossier],pendingSeed:seed,override:({url})=>url.includes('/dossiers/by-request/')?gate.then(()=>Response.json({dossier:newly})):undefined});
  try{
    await f.render();assert.ok(f.requests.some(r=>r.url.includes('/dossiers/by-request/')));
    await f.click('Ouvrir Alice · Acme TI');await f.input('Commentaire — Clavier','Important unsaved edit');
    await act(async()=>release());
    assert.equal(f.dom.window.document.querySelector('[aria-label="Commentaire — Clavier"]')?.value,'Important unsaved edit');
    assert.equal([...f.dom.window.document.querySelectorAll('button')].find(b=>b.textContent==='Sauvegarder le dossier')?.disabled,false);
    assert.match(f.dom.window.document.body.textContent,/Ouvrir New/);
    assert.match(f.dom.window.document.body.textContent,/Dossier créé/);
    assert.equal(f.dom.window.sessionStorage.length,0);
    await f.click('Sauvegarder le dossier');assert.equal(f.requests.find(r=>r.method==='PUT')?.body.sections[0].steps[0].commentaire,'Important unsaved edit');
  }finally{release();await f.cleanup();}
});

test('delayed pending template readback preserves an edited model and its save action',async()=>{
  const seed={kind:'template',payload:{requestKey:'9ecb3330-166b-4c93-9cd8-fce998336399',clientId:2,name:'New model',sections:template.sections}};
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const f=fixture({pendingSeed:seed,override:({url})=>url.includes('/templates/by-request/')?gate.then(()=>Response.json({template:{...template,id:9,clientId:2,name:'New model'}})):undefined});
  try{
    await f.render();await f.click('Standard Windows · Global');await f.input('Nom du modèle','Important unsaved edit');
    await act(async()=>release());
    assert.equal(f.dom.window.document.querySelector('[aria-label="Nom du modèle"]')?.value,'Important unsaved edit');
    assert.equal([...f.dom.window.document.querySelectorAll('button')].find(b=>b.textContent==='Sauvegarder le modèle')?.disabled,false);
    assert.match(f.dom.window.document.body.textContent,/New model/);
    assert.equal(f.dom.window.sessionStorage.length,0);
    await f.click('Sauvegarder le modèle');assert.equal(f.requests.find(r=>r.method==='PUT')?.body.name,'Important unsaved edit');
  }finally{release();await f.cleanup();}
});

test('delayed readback respects a clean editor choice and later draft edits',async()=>{
  const seed={kind:'dossier',payload:{requestKey:'9ecb3330-166b-4c93-9cd8-fce998336399',clientId:2,templateId:3,employee:'New',computer:'',ticket:'',date:'2026-11-09'}};
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const f=fixture({dossiers:[dossier],pendingSeed:seed,override:({url})=>url.includes('/dossiers/by-request/')?gate.then(()=>Response.json({dossier:{...dossier,id:12,employee:'New'}})):undefined});
  try{
    await f.render();await f.click('Ouvrir Alice · Acme TI');await act(async()=>release());
    assert.equal(f.dom.window.document.querySelectorAll('[aria-label="Commentaire — Clavier"]').length,1);
    assert.equal([...f.dom.window.document.querySelectorAll('[aria-label="Employé"]')][1]?.value,'Alice');
    await f.input('Commentaire — Clavier','Edited after reconciliation');
    assert.equal([...f.dom.window.document.querySelectorAll('button')].find(b=>b.textContent==='Sauvegarder le dossier')?.disabled,false);
    assert.match(f.dom.window.document.body.textContent,/Ouvrir New/);
  }finally{release();await f.cleanup();}
});

test('pending readback leaves newly typed creation metadata untouched',async()=>{
  const seed={kind:'dossier',payload:{requestKey:'9ecb3330-166b-4c93-9cd8-fce998336399',clientId:2,templateId:3,employee:'New',computer:'',ticket:'',date:'2026-11-09'}};
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const f=fixture({pendingSeed:seed,override:({url})=>url.includes('/dossiers/by-request/')?gate.then(()=>Response.json({dossier:{...dossier,id:12,employee:'New'}})):undefined});
  try{await f.render();await f.input('Employé','Draft for later');await act(async()=>release());assert.equal(f.dom.window.document.querySelector('[aria-label="Employé"]')?.value,'Draft for later');assert.equal(f.dom.window.sessionStorage.length,0);}finally{release();await f.cleanup();}
});

test('confirmed readback cannot report success when pending-key cleanup fails',async()=>{
  const seed={kind:'dossier',payload:{requestKey:'9ecb3330-166b-4c93-9cd8-fce998336399',clientId:2,templateId:3,employee:'New',computer:'',ticket:'',date:'2026-11-09'}};
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const f=fixture({pendingSeed:seed,override:({url})=>url.includes('/dossiers/by-request/')?gate.then(()=>Response.json({dossier:{...dossier,id:12,employee:'New'}})):undefined});
  const storageProto=f.dom.window.Storage.prototype,remove=storageProto.removeItem;
  try{await f.render();storageProto.removeItem=function(){};await act(async()=>release());assert.ok(f.dom.window.sessionStorage.getItem('workstation-procedures:pending-create:1'));assert.doesNotMatch(f.dom.window.document.body.textContent,/Dossier créé/);assert.ok(![...f.dom.window.document.querySelectorAll('button')].some(b=>b.textContent.startsWith('Ouvrir New')));}finally{storageProto.removeItem=remove;release();await f.cleanup();}
});

test('new dossier defaults to the local calendar day near UTC midnight',async()=>{
  const source=await readFile(new URL('./WorkstationProcedures.tsx',import.meta.url),'utf8');
  const output=new URL('./.workstation-date-test.mjs',import.meta.url).pathname;
  await build({stdin:{contents:`${source}\nexport { today, blank };`,resolveDir:new URL('.',import.meta.url).pathname,sourcefile:'WorkstationProcedures.tsx',loader:'tsx'},outfile:output,bundle:true,format:'esm',platform:'node',packages:'external',jsx:'automatic'});
  const originalDate=globalThis.Date,originalTZ=process.env.TZ;
  try{
    process.env.TZ='America/New_York';
    globalThis.Date=class extends originalDate {constructor(...args){super(...(args.length?args:['2026-11-10T02:30:00.000Z']));}};
    const {today,blank}=await import(output);
    assert.equal(today(),'2026-11-09');
    assert.equal(blank.date,'2026-11-09');
  }finally{globalThis.Date=originalDate;if(originalTZ===undefined)delete process.env.TZ;else process.env.TZ=originalTZ;await unlink(output);}
});
