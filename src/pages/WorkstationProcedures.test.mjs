import test from 'node:test';
import assert from 'node:assert/strict';
import React, {act} from 'react';
import {BrowserRouter, Link, MemoryRouter, Route, Routes} from 'react-router-dom';
import {createRoot} from 'react-dom/client';
import {Simulate} from 'react-dom/test-utils';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
import {unlink, readFile} from 'node:fs/promises';
import JSZip from 'jszip';
const realGenerateZip = JSZip.prototype.generateAsync;
JSZip.prototype.generateAsync = function(...args) {
  const gate = globalThis.__bundleGate;
  const task = realGenerateZip.apply(this,args).then(async bytes => {
    if(gate){globalThis.__bundleReady=true;await gate;}
    return bytes;
  });
  (globalThis.__bundleTasks ||= []).push(task);
  return task;
};

const outfile = new URL('./.workstation-ui-test.mjs', import.meta.url).pathname;
await build({entryPoints:[new URL('./WorkstationProcedures.tsx', import.meta.url).pathname], outfile, bundle:true, format:'esm', platform:'node', packages:'external', jsx:'automatic', plugins:[{name:'auth-and-script',setup(p){
  p.onResolve({filter:/context\/AuthContext$/},()=>({path:'auth',namespace:'fixture'}));
  p.onLoad({filter:/./,namespace:'fixture'},()=>({contents:'export const useAuth = () => ({user: globalThis.__workstationAuth ? globalThis.__workstationAuth.user : {id:globalThis.__workstationUserId||1,role:globalThis.__workstationRole||"admin"}, verified:globalThis.__workstationAuth?.verified ?? true, loading:globalThis.__workstationAuth?.loading ?? false, verificationEpoch:globalThis.__workstationAuth?.epoch ?? 0, onVerificationStart:globalThis.__workstationAuth?.subscribe ?? (()=>()=>{})})',loader:'js'}));
  p.onResolve({filter:/workstationAuditScript$/},args=>args.importer.endsWith('workstationAuditBundle.ts')?undefined:({path:'script',namespace:'script-fixture'}));
  p.onLoad({filter:/./,namespace:'script-fixture'},()=>({contents:'export const DEFAULT_WORKSTATION_AUDIT_OPTIONS={clientName:"BZ",computerPrefix:"PC-",adminLocal:"bzinc",keyboards:["fr-CA"],printerName:"",apps:[]};export const generateWorkstationAuditScript = config => { globalThis.__scriptConfig = config; return "# Test PS1"; };',loader:'js'}));
}}]});
const Page = (await import(outfile)).default;
await unlink(outfile);
const template = {id:3,clientId:2,name:'Standard Windows',version:1,sections:[{title:'Préparation',steps:[{id:'s1',title:'Clavier',note:'Vérifier FR'}]}]};
const dossier = {id:11,clientId:2,clientName:'Acme TI',templateId:3,employee:'Alice',computer:'PC-1',ticket:'T-1',date:'2026-11-09',version:1,archivedAt:null,sections:[{title:'Préparation',steps:[{id:'s1',title:'Clavier',note:'Vérifier FR',etat:'todo',commentaire:''}]}]};
function fixture({dossiers=[],templates=[template],putStatus=200,browserRouter=false,override,pendingSeed}={}) {
  globalThis.__bundleTasks=[];delete globalThis.__bundleReady;
  const dom = new JSDOM('<!doctype html><div id="app"></div>',{url:browserRouter?'http://localhost/procedures/installation-postes':'http://localhost/'});
  dom.window.URL.revokeObjectURL=()=>{};
  const old={window:globalThis.window,document:globalThis.document,fetch:globalThis.fetch,Blob:globalThis.Blob,URL:globalThis.URL};
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,Blob:dom.window.Blob,URL:dom.window.URL});
  if(pendingSeed)dom.window.sessionStorage.setItem('workstation-procedures:pending-create:1',JSON.stringify(pendingSeed));
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  const listeners=new Set();
  const auth={user:{id:globalThis.__workstationUserId||1,role:globalThis.__workstationRole||'admin'},verified:true,loading:false,epoch:0,subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},start(){for(const listener of listeners)listener();this.verified=false;this.loading=true;this.epoch++;}};
  globalThis.__workstationAuth=auth;
  const requests=[];let createdTemplate;
  globalThis.fetch=async (url,options={})=>{
    const method=options.method||'GET'; const body=options.body&&JSON.parse(options.body);
    requests.push({url,method,body});
    const custom=override?.({url,method,body,requests});if(custom!==undefined)return custom;
    if(url==='/api/clients')return Response.json({clients:[{id:2,nom:'Acme TI',clientType:'ti',primeId:1},{id:4,nom:'Télécom',clientType:'telecom',primeId:1},{id:5,nom:'À classer',clientType:null,primeId:1},{id:6,nom:'Sans Prime',clientType:'ti',primeId:null}]});
    if(url==='/api/workstation-procedures/templates/standard')return Response.json({template:{...template,id:30,clientId:null,name:'Gabarit Windows'}});
    if(url.startsWith('/api/workstation-procedures/audit-source?'))return Response.json({client:{id:2,nom:'Acme TI'},template});
    if(url==='/api/workstation-procedures/templates'&&method==='GET')return Response.json({templates,hasMore:false,nextBefore:null});
    if(url==='/api/workstation-procedures/dossiers'&&method==='GET')return Response.json({dossiers,hasMore:false,nextBefore:null});
    if(url.includes('/by-request/'))return Response.json({[url.includes('/templates/')?'template':'dossier']:url.includes('/templates/')?(createdTemplate||template):dossier});
    if(url==='/api/workstation-procedures/dossiers'&&method==='POST')return Response.json({dossier:{...dossier,...body}},{status:201});
    if(url==='/api/workstation-procedures/audit-source/dossier/11'&&method==='GET')return Response.json({dossier:dossiers.find(d=>d.id===11)||dossier});
    if(url==='/api/workstation-procedures/dossiers/11'&&method==='GET')return Response.json({dossier:dossiers.find(d=>d.id===11)||dossier});
    if(url==='/api/workstation-procedures/dossiers/11'&&method==='PUT')return putStatus===409?Response.json({error:'Conflit de version'},{status:409}):Response.json({dossier:{...dossier,...body,version:2}});
    if(url==='/api/workstation-procedures/dossiers/11/archive')return Response.json({dossier:{...dossier,archivedAt:'2026-11-10',version:2}});
    if(url==='/api/workstation-procedures/templates'&&method==='POST'){createdTemplate={...template,...body,id:9};return Response.json({template:createdTemplate},{status:201});}
    if(url==='/api/workstation-procedures/templates/3'&&method==='PUT')return Response.json({template:{...template,...body,version:2}});
    throw Error(`Unexpected ${method} ${url}`);
  };
  const root=createRoot(dom.window.document.getElementById('app'));
  const render=async()=>{await act(async()=>root.render(browserRouter?React.createElement(BrowserRouter,{future:{v7_startTransition:true,v7_relativeSplatPath:true}},React.createElement('nav',null,React.createElement(Link,{to:'/clients'},'Clients')),React.createElement(Routes,null,React.createElement(Route,{path:'/procedures/installation-postes',element:React.createElement(Page)}),React.createElement(Route,{path:'/clients',element:React.createElement('p',null,'Page clients')}))):React.createElement(Page)));};
  const input=async(label,value)=>{const el=[...dom.window.document.querySelectorAll('input,textarea,select')].find(e=>e.getAttribute('aria-label')===label);assert.ok(el,`Missing input ${label}`);await act(async()=>{const proto=el.tagName==='TEXTAREA'?dom.window.HTMLTextAreaElement.prototype:el.tagName==='SELECT'?dom.window.HTMLSelectElement.prototype:dom.window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,value);el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));el.dispatchEvent(new dom.window.Event('change',{bubbles:true}));Simulate.change(el,{target:{value}});});};
  const click=async(text)=>{const el=[...dom.window.document.querySelectorAll('button')].find(e=>e.textContent.trim().startsWith(text));assert.ok(el,`Missing button ${text}`);await act(async()=>{el.click();await new Promise(r=>setImmediate(r));await Promise.all(globalThis.__bundleTasks||[]);});};
  const cleanup=async()=>{await act(async()=>root.unmount());delete globalThis.__workstationAuth;Object.assign(globalThis,old);dom.window.close();};
  return {dom,requests,render,input,click,cleanup,auth,unmount:async()=>{await act(async()=>root.unmount());}};
}

test('client procedure drives both exports even with an unrelated historical dossier open',async()=>{
  const saved={...template,id:7,clientId:2,name:'Procédure générale Acme',sections:[{title:'Général',steps:[{id:'g',title:'CLIENT-GENERAL',note:'GENERAL-NOTE'}]}]};
  const f=fixture({templates:[saved],dossiers:[dossier],override:({url})=>url.includes('/audit-source?')?Response.json({client:{id:2,nom:'Acme TI'},template:saved}):undefined});
  let blob;const oldCreate=URL.createObjectURL,oldClick=f.dom.window.HTMLAnchorElement.prototype.click;URL.createObjectURL=value=>{blob=value;return 'blob:fixture';};f.dom.window.HTMLAnchorElement.prototype.click=function(){};
  try{await f.render();f.dom.window.confirm=()=>true;await f.input('Client','2');await f.input('Modèle','7');await f.click('Ouvrir Alice · Acme TI');
    await f.click('Télécharger la procédure HTML');assert.ok(blob);const html=await new Promise(resolve=>{const r=new f.dom.window.FileReader();r.onload=()=>resolve(r.result);r.readAsText(blob);});assert.match(html,/CLIENT-GENERAL/);assert.doesNotMatch(html,/Alice|PC-1|T-1/);
    await f.click('Télécharger la trousse d’audit (.zip)');assert.equal(globalThis.__scriptConfig.procedure.name,saved.name);assert.deepEqual(globalThis.__scriptConfig.procedure.sections,saved.sections);
    assert.equal(f.requests.filter(r=>r.url.includes('/audit-source?clientId=2&templateId=7')).length,2);assert.ok(!f.requests.some(r=>r.url.includes('/audit-source/dossier/')));assert.ok(!f.requests.some(r=>r.method!=='GET'));
    assert.equal(f.dom.window.document.querySelector('[aria-label="Modèle"]').value,'7');
    assert.equal(f.dom.window.document.querySelector('[aria-label="Commentaire — Clavier"]').disabled,true);
    assert.doesNotMatch(f.dom.window.document.body.textContent,/Créer le dossier|Nouveau dossier/);
  }finally{URL.createObjectURL=oldCreate;f.dom.window.HTMLAnchorElement.prototype.click=oldClick;await f.cleanup();}
});

test('explicit client save prepares a selected-client copy for review without writing the global',async()=>{
 const f=fixture();try{await f.render();await f.input('Client','2');await f.click('Gabarit Windows · Global');await f.click('Enregistrer pour ce client');
 assert.equal(f.dom.window.document.querySelector('[aria-label="Client du modèle"]').value,'2');
 assert.match(f.dom.window.document.body.textContent,/Destinataire : Acme TI/);
 assert.ok(!f.requests.some(r=>r.method!=='GET'),'copy is a draft until reviewed');
 await f.input('Note étape 1.1','Note client validée');await f.click('Enregistrer pour ce client');
 const post=f.requests.find(r=>r.method==='POST');assert.equal(post.body.clientId,2);assert.equal(post.body.sections[0].steps[0].note,'Note client validée');
 assert.equal(f.dom.window.document.querySelector('[aria-label="Modèle"]').value,'9');assert.match(f.dom.window.document.body.textContent,/Procédure enregistrée pour Acme TI/);
 assert.ok(!f.requests.some(r=>r.method==='PUT'));
 }finally{await f.cleanup();}
});

test('duplication prefills selected client and refused A-to-B navigation keeps reviewed draft',async()=>{
 const f=fixture();try{await f.render();await f.input('Client','2');await f.click('Dupliquer pour un client');
 assert.equal(f.dom.window.document.querySelector('[aria-label="Client du modèle"]').value,'2');
 await f.input('Note étape 1.1','KEEP-CLIENT-DRAFT');f.dom.window.confirm=()=>false;await f.input('Client','');
 assert.equal(f.dom.window.document.querySelector('[aria-label="Client"]').value,'2');
 assert.equal(f.dom.window.document.querySelector('[aria-label="Note étape 1.1"]').value,'KEEP-CLIENT-DRAFT');assert.ok(!f.requests.some(r=>r.method!=='GET'));
 }finally{await f.cleanup();}
});

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

test('lists every client returned by the authorized Clients directory without classification gates',async()=>{const f=fixture();try{await f.render();const select=f.dom.window.document.querySelector('select[aria-label="Client"]');assert.deepEqual([...select.options].filter(o=>o.value).map(o=>Number(o.value)).sort(),[2,4,5,6]);assert.ok([...select.options].every(o=>!o.disabled));assert.doesNotMatch(select.textContent,/classer TI/);}finally{await f.cleanup();}});

for(const id of [4,5,6])test(`directory client ${id} can prepare, copy and save a procedure without TI classification`,async()=>{const nom=id===4?'Télécom':id===5?'À classer':'Sans Prime';const f=fixture({override:({url})=>url.includes('/audit-source?')?Response.json({client:{id,nom},template:{...template,id:9,clientId:id,name:'Gabarit Windows'}}):undefined});try{await f.render();await f.input('Client',String(id));const button=[...f.dom.window.document.querySelectorAll('button')].find(b=>b.textContent==='Nouvelle procédure client');assert.equal(button.disabled,false);await f.click('Nouvelle procédure client');assert.equal(f.dom.window.document.querySelector('[aria-label="Client du modèle"]').value,String(id));f.dom.window.confirm=()=>true;await f.click('Gabarit Windows · Global');await f.click('Enregistrer pour ce client');assert.equal(f.dom.window.document.querySelector('[aria-label="Client du modèle"]').value,String(id));await f.click('Enregistrer pour ce client');assert.equal(f.requests.find(r=>r.method==='POST').body.clientId,id);assert.ok(f.dom.window.document.querySelector(`[aria-label="Procédures — ${id===4?'Télécom':id===5?'À classer':'Sans Prime'}"]`));await captureDownloads(f,async({blobs})=>{await f.click('Télécharger la procédure HTML');await f.click('Télécharger la trousse d’audit (.zip)');assert.equal(blobs.length,2);assert.equal(globalThis.__scriptConfig.clientName,id===4?'Télécom':id===5?'À classer':'Sans Prime');});}finally{await f.cleanup();}});

test('archived dossier is read-only and progress excludes N/A',async()=>{const archived={...dossier,archivedAt:'2026-11-10',sections:[{title:'Préparation',steps:[{...dossier.sections[0].steps[0],etat:'na'}]}]};const f=fixture({dossiers:[archived]});try{await f.render();await f.click('Ouvrir Alice · Acme TI');assert.match(f.dom.window.document.body.textContent,/0 \/ 0/);assert.equal(f.dom.window.document.querySelector('[aria-label="Commentaire — Clavier"]').disabled,true);assert.ok(![...f.dom.window.document.querySelectorAll('button')].some(e=>e.textContent==='Sauvegarder le dossier'));}finally{await f.cleanup();}});

test('print view hides the app shell and keeps the dossier readable',async()=>{const f=fixture({dossiers:[dossier]});try{await f.render();await f.click('Ouvrir Alice · Acme TI');const css=f.dom.window.document.querySelector('style[data-workstation-print]')?.textContent||'';assert.match(css,/#primary-navigation/);assert.match(css,/main/);assert.match(css,/print/);}finally{await f.cleanup();}});

test('printer motif label warns that an empty value requires verification, not any printer',async()=>{const f=fixture();try{await f.render();const label=f.dom.window.document.querySelector('input[aria-label="Motif de l’imprimante"]')?.closest('label')?.textContent||'';assert.match(label,/vide = à vérifier/i);assert.doesNotMatch(label,/vide = toute imprimante/i);}finally{await f.cleanup();}});

test('audit download requires a client and its selected procedure',async()=>{const f=fixture();const oldCreate=URL.createObjectURL;let downloads=0;URL.createObjectURL=()=>{downloads++;return 'blob:fixture';};try{await f.render();await f.click('Télécharger la trousse d’audit (.zip)');assert.equal(downloads,0);assert.ok(!f.requests.some(r=>r.url.includes('/audit-source?')));assert.match(f.dom.window.document.body.textContent,/Choisissez.*client.*modèle/i);}finally{URL.createObjectURL=oldCreate;await f.cleanup();}});

test('audit uses an authoritative selected client and template instead of generic BZ defaults',async()=>{const f=fixture();const oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL,oldClick=f.dom.window.HTMLAnchorElement.prototype.click;URL.createObjectURL=()=> 'blob:fixture';URL.revokeObjectURL=()=>{};f.dom.window.HTMLAnchorElement.prototype.click=function(){};try{await f.render();await f.input('Client','2');await f.input('Modèle','3');await f.click('Télécharger la trousse d’audit (.zip)');assert.ok(f.requests.some(r=>r.url.includes('/audit-source?clientId=2&templateId=3')));assert.equal(globalThis.__scriptConfig.clientName,'Acme TI');assert.equal(globalThis.__scriptConfig.procedure.name,'Standard Windows');assert.deepEqual(globalThis.__scriptConfig.procedure.sections,template.sections);}finally{f.dom.window.HTMLAnchorElement.prototype.click=oldClick;URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke;await f.cleanup();}});

test('denied or malformed audit source never falls back to a generic client script',async()=>{for(const answer of [Response.json({error:'Introuvable'},{status:404}),Response.json({client:{id:4,nom:'Autre client'},template})]){const f=fixture({override:({url})=>url.includes('/audit-source?')?answer:undefined});const oldCreate=URL.createObjectURL;let downloads=0;URL.createObjectURL=()=>{downloads++;return 'blob:fixture';};try{await f.render();await f.input('Client','2');await f.input('Modèle','3');await f.click('Télécharger la trousse d’audit (.zip)');assert.equal(downloads,0);assert.ok(f.dom.window.document.querySelector('[role="alert"]'));}finally{URL.createObjectURL=oldCreate;await f.cleanup();}}});

test('changing the creation model while audit-source is pending never downloads the old script',async()=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const alternate={...template,id:8,name:'Other Windows'};
  const f=fixture({templates:[template,alternate],override:({url})=>url.includes('/audit-source?')?gate.then(()=>Response.json({client:{id:2,nom:'Acme TI'},template})):undefined});
  const oldCreate=URL.createObjectURL;let downloads=0;URL.createObjectURL=()=>{downloads++;return 'blob:fixture';};
  try{
    await f.render();await f.input('Client','2');await f.input('Modèle','3');
    await act(()=>[...f.dom.window.document.querySelectorAll('button')].find(b=>b.textContent==='Télécharger la trousse d’audit (.zip)').click());
    assert.ok(f.requests.some(r=>r.url.includes('/audit-source?clientId=2&templateId=3')));
    await f.input('Modèle','8');await act(async()=>release());
    assert.equal(f.dom.window.document.querySelector('[aria-label="Modèle"]').value,'8');
    assert.equal(downloads,0);assert.doesNotMatch(f.dom.window.document.body.textContent,/Trousse ZIP générée/);
  }finally{release();URL.createObjectURL=oldCreate;await f.cleanup();}
});

test('changing the creation client while audit-source is pending never downloads the old script',async()=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const f=fixture({override:({url})=>url.includes('/audit-source?')?gate.then(()=>Response.json({client:{id:2,nom:'Acme TI'},template})):undefined});
  const oldCreate=URL.createObjectURL;let downloads=0;URL.createObjectURL=()=>{downloads++;return 'blob:fixture';};
  try{
    await f.render();await f.input('Client','2');await f.input('Modèle','3');
    await act(()=>[...f.dom.window.document.querySelectorAll('button')].find(b=>b.textContent==='Télécharger la trousse d’audit (.zip)').click());
    assert.ok(f.requests.some(r=>r.url.includes('/audit-source?clientId=2&templateId=3')));
    await f.input('Client','');await act(async()=>release());
    assert.equal(f.dom.window.document.querySelector('[aria-label="Client"]').value,'');
    assert.equal(downloads,0);assert.doesNotMatch(f.dom.window.document.body.textContent,/Trousse ZIP générée/);
  }finally{release();URL.createObjectURL=oldCreate;await f.cleanup();}
});

test('changing generator prefix during audit-source fetch preserves the edit and skips the stale template download',async()=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const f=fixture({override:({url})=>url.includes('/audit-source?')?gate.then(()=>Response.json({client:{id:2,nom:'Acme TI'},template})):undefined});
  const oldCreate=URL.createObjectURL;let downloads=0;URL.createObjectURL=()=>{downloads++;return 'blob:fixture';};
  try{
    await f.render();await f.input('Client','2');await f.input('Modèle','3');await f.input('Préfixe du client','OLD-');
    await act(()=>[...f.dom.window.document.querySelectorAll('button')].find(b=>b.textContent==='Télécharger la trousse d’audit (.zip)').click());
    assert.ok(f.requests.some(r=>r.url.includes('/audit-source?clientId=2&templateId=3')));
    await f.input('Préfixe du client','NEW-');await act(async()=>release());
    assert.equal(f.dom.window.document.querySelector('[aria-label="Préfixe du client"]').value,'NEW-');
    assert.equal(downloads,0);assert.doesNotMatch(f.dom.window.document.body.textContent,/Trousse ZIP générée/);
  }finally{release();URL.createObjectURL=oldCreate;await f.cleanup();}
});

test('unsaved procedure-model edits block audit export without discarding edits',async()=>{
  const f=fixture();const oldCreate=URL.createObjectURL;let downloads=0;
  URL.createObjectURL=()=>{downloads++;return 'blob:fixture';};
  try{
    await f.render();await f.input('Client','2');await f.input('Modèle','3');
    f.dom.window.confirm=()=>true;
    await f.click('Gabarit Windows · Global');await f.input('Titre étape 1.1','Clavier modifié non sauvegardé');
    await f.click('Télécharger la trousse d’audit (.zip)');
    assert.equal(downloads,0);assert.ok(!f.requests.some(r=>r.url.includes('/audit-source?')));
    assert.match(f.dom.window.document.querySelector('[role="alert"]')?.textContent??'',/Sauvegardez.*modèle.*(annulez|rouvr)/i);
    assert.equal(f.dom.window.document.querySelector('[aria-label="Titre étape 1.1"]').value,'Clavier modifié non sauvegardé');
    assert.equal([...f.dom.window.document.querySelectorAll('button')].find(b=>b.textContent==='Sauvegarder le gabarit global').disabled,false);
  }finally{URL.createObjectURL=oldCreate;await f.cleanup();}
});

test('script panel passes client-specific audit settings to generator',async()=>{const f=fixture();const oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL;URL.createObjectURL=()=> 'blob:fixture';URL.revokeObjectURL=()=>{};const oldClick=f.dom.window.HTMLAnchorElement.prototype.click;f.dom.window.HTMLAnchorElement.prototype.click=function(){globalThis.__downloadName=this.download;};try{await f.render();await f.input('Client','2');await f.input('Modèle','3');await f.input('Préfixe du client','ACME-');await f.input('Compte administrateur','local-admin');await f.input('Clavier attendu','fr-CA, en-US');await f.input('Motif de l’imprimante','Bureau');await f.input('Applications attendues','Office\nChrome');await f.click('Télécharger la trousse d’audit (.zip)');assert.equal(globalThis.__scriptConfig.clientName,'Acme TI');assert.equal(globalThis.__scriptConfig.computerPrefix,'ACME-');assert.equal(globalThis.__scriptConfig.adminLocal,'local-admin');assert.deepEqual(globalThis.__scriptConfig.keyboards,['fr-CA','en-US']);assert.equal(globalThis.__scriptConfig.printerName,'Bureau');assert.deepEqual(globalThis.__scriptConfig.apps,['Office','Chrome']);assert.deepEqual(globalThis.__scriptConfig.procedure.sections,template.sections);assert.equal(globalThis.__downloadName,'audit-client-2-procedure-3.zip');}finally{f.dom.window.HTMLAnchorElement.prototype.click=oldClick;URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke;await f.cleanup();}});

test('Prime cannot edit global template but can create a client-scoped model',async()=>{globalThis.__workstationRole='user';const f=fixture();try{await f.render();assert.ok(![...f.dom.window.document.querySelectorAll('button')].some(b=>b.textContent.includes('Gabarit Windows · Global')));await f.input('Client','2');await f.click('Nouvelle procédure client');const scope=f.dom.window.document.querySelector('[aria-label="Client du modèle"]');assert.ok(scope);assert.ok(![...scope.options].some(o=>o.value===''));await f.input('Client du modèle','2');await f.input('Nom du modèle','Client Windows');await f.click('Ajouter une section');await f.input('Titre de section 1','Installation');await f.click('Ajouter une étape 1');await f.input('Titre étape 1.1','Imprimante');await f.click('Enregistrer pour ce client');assert.equal(f.requests.find(r=>r.method==='POST'&&r.url.endsWith('/templates')).body.clientId,2);}finally{globalThis.__workstationRole='admin';await f.cleanup();}});

test('Prime duplicates the global standard into an explicitly selected TI client without changing the source',async()=>{globalThis.__workstationRole='user';const f=fixture();try{await f.render();assert.ok(![...f.dom.window.document.querySelectorAll('button')].some(b=>b.textContent.includes('Gabarit Windows · Global')));await f.click('Dupliquer pour un client');assert.equal(f.dom.window.document.querySelector('[aria-label="Nom du modèle"]').value,'Gabarit Windows');assert.equal(f.dom.window.document.querySelector('[aria-label="Titre de section 1"]').value,'Préparation');assert.equal(f.dom.window.document.querySelector('[aria-label="Titre étape 1.1"]').value,'Clavier');const save=[...f.dom.window.document.querySelectorAll('button')].find(b=>b.textContent==='Enregistrer pour ce client');assert.equal(save.disabled,true);await f.input('Client du modèle','2');await f.input('Titre étape 1.1','Clavier client');await f.click('Enregistrer pour ce client');const post=f.requests.find(r=>r.method==='POST'&&r.url.endsWith('/templates'));assert.equal(post.body.clientId,2);assert.equal(post.body.sections[0].steps[0].title,'Clavier client');assert.equal(template.sections[0].steps[0].title,'Clavier');assert.ok(!f.requests.some(r=>r.method==='PUT'&&r.url.endsWith('/templates/3')));}finally{globalThis.__workstationRole='admin';await f.cleanup();}});

test('script download link is not canceled by the page navigation guard while export is busy',async()=>{const f=fixture();const oldCreate=URL.createObjectURL,oldClick=f.dom.window.HTMLAnchorElement.prototype.click;let blocked;URL.createObjectURL=()=> 'blob:http://localhost/fixture';f.dom.window.HTMLAnchorElement.prototype.click=function(){this.addEventListener('click',e=>{blocked=e.defaultPrevented;e.preventDefault();},{once:true});this.dispatchEvent(new f.dom.window.MouseEvent('click',{bubbles:true,cancelable:true}));};try{await f.render();await f.input('Client','2');await f.input('Modèle','3');await f.click('Télécharger la trousse d’audit (.zip)');assert.equal(blocked,false,'download anchor must reach Chrome without preventDefault');}finally{URL.createObjectURL=oldCreate;f.dom.window.HTMLAnchorElement.prototype.click=oldClick;await f.cleanup();}});

test('downloads a self-contained HTML procedure from the authorized client model',async()=>{const f=fixture();const oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL,oldClick=f.dom.window.HTMLAnchorElement.prototype.click;let blob,filename;URL.createObjectURL=value=>{blob=value;return 'blob:fixture';};URL.revokeObjectURL=()=>{};f.dom.window.HTMLAnchorElement.prototype.click=function(){filename=this.download;};try{await f.render();await f.input('Client','2');await f.input('Modèle','3');await f.click('Télécharger la procédure HTML');assert.ok(f.requests.some(r=>r.url.includes('/audit-source?clientId=2&templateId=3')));assert.equal(filename,'Acme-TI-Standard-Windows-2-3.html');assert.ok(blob,'HTML file should be created');const html=await new Promise((resolve,reject)=>{const reader=new f.dom.window.FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsText(blob);});assert.match(html,/<!doctype html>/i);assert.match(html,/Standard Windows/);assert.match(html,/Acme TI/);assert.match(html,/Clavier/);assert.match(html,/Vérifier FR/);}finally{URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke;f.dom.window.HTMLAnchorElement.prototype.click=oldClick;await f.cleanup();}});

test('denied HTML template source never falls back to a listed model or creates a Blob',async()=>{
  const f=fixture({override:({url})=>url.includes('/audit-source?')?Response.json({error:'Accès refusé'},{status:403}):undefined});
  const oldCreate=URL.createObjectURL;let blobs=0;URL.createObjectURL=()=>{blobs++;return 'blob:fixture';};
  try{await f.render();await f.input('Client','2');await f.input('Modèle','3');await f.click('Télécharger la procédure HTML');assert.equal(blobs,0);assert.match(f.dom.window.document.querySelector('[role="alert"]')?.textContent??'',/Accès refusé/);}
  finally{URL.createObjectURL=oldCreate;await f.cleanup();}
});

test('HTML and PS1 refuse a server-changed selected template and ask to reload',async()=>{
  for(const format of ['Télécharger la procédure HTML','Télécharger la trousse d’audit (.zip)'])for(const changed of [
    {...template,version:2},{...template,name:'Modèle modifié'},
    {...template,clientId:null},{...template,sections:[{title:'Nouvelle section',steps:[]}]}
  ]){
    const f=fixture({override:({url})=>url.includes('/audit-source?')?Response.json({client:{id:2,nom:'Acme TI'},template:changed}):undefined});
    const oldCreate=URL.createObjectURL;let blobs=0;URL.createObjectURL=()=>{blobs++;return 'blob:fixture';};
    try{await f.render();await f.input('Client','2');await f.input('Modèle','3');await f.click(format);assert.equal(blobs,0,`${format}: ${JSON.stringify(changed)}`);assert.match(f.dom.window.document.querySelector('[role="alert"]')?.textContent??'',/rechargez/i);}
    finally{URL.createObjectURL=oldCreate;await f.cleanup();}
  }
});

test('verification-start synchronously cancels deferred HTML and PS1 exports, even after same-account re-arm',async()=>{
  for(const format of ['Télécharger la procédure HTML','Télécharger la trousse d’audit (.zip)'])for(const useDossier of [false,true]){
    let release;const gate=new Promise(resolve=>{release=resolve;});
    const f=fixture({dossiers:useDossier?[dossier]:[],override:({url})=>url.includes('/audit-source')?gate.then(()=>url.includes('/dossier/')?Response.json({dossier}):Response.json({client:{id:2,nom:'Acme TI'},template})):undefined});
    const oldCreate=URL.createObjectURL;let blobs=0;URL.createObjectURL=()=>{blobs++;return 'blob:fixture';};
    try{
      await f.render();await f.input('Client','2');await f.input('Modèle','3');if(useDossier)await f.click('Ouvrir Alice · Acme TI');
      await act(()=>[...f.dom.window.document.querySelectorAll('button')].find(b=>b.textContent===format).click());
      await act(async()=>{f.auth.start();});
      f.auth.loading=false; // /me failed: the old editor is still mounted.
      await act(async()=>release());
      assert.equal(blobs,0,`${format} must not download after failed verification`);
      assert.equal(f.dom.window.document.querySelector('button'),null,'failed /me hides client content and cannot start a new export');assert.equal(blobs,0);
      f.auth.verified=true;f.auth.epoch++;await f.render();
      await f.click(format);assert.equal(blobs,1,'same-account confirmed /me re-arms export');
    }finally{release();URL.createObjectURL=oldCreate;await f.cleanup();}
  }
});

test('an old deferred response cannot download after same-account revalidation re-arms a newer export',async()=>{
  for(const format of ['Télécharger la procédure HTML','Télécharger la trousse d’audit (.zip)']){
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

test('PowerShell download starts with a UTF-8 BOM before script text',async()=>{const f=fixture();const oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL,oldClick=f.dom.window.HTMLAnchorElement.prototype.click;let blob;URL.createObjectURL=value=>{blob=value;return 'blob:fixture';};URL.revokeObjectURL=()=>{};f.dom.window.HTMLAnchorElement.prototype.click=function(){};try{await f.render();await f.input('Client','2');await f.input('Modèle','3');await f.click('Télécharger la trousse d’audit (.zip)');assert.ok(blob);const bytes=await new Promise((resolve,reject)=>{const reader=new f.dom.window.FileReader();reader.onload=()=>resolve(new Uint8Array(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsArrayBuffer(blob);});const archive=await JSZip.loadAsync(bytes,{checkCRC32:true});assert.equal(blob.type,'application/zip');assert.equal(Object.keys(archive.files).length,2);const ps=await archive.file('audit-client-2-procedure-3.ps1').async('uint8array');assert.deepEqual([...ps].slice(0,6),[0xef,0xbb,0xbf,0x23,0x20,0x54]);const cmd=await archive.file('lancer-audit-client-2-procedure-3.cmd').async('string');assert.match(cmd,/%~dp0audit-client-2-procedure-3\.ps1/);}finally{f.dom.window.HTMLAnchorElement.prototype.click=oldClick;URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke;await f.cleanup();}});

test('template editor can add a section and a step then save',async()=>{const f=fixture();try{await f.render();await f.input('Client','2');await f.click('Nouvelle procédure client');await f.input('Nom du modèle','Client Windows');await f.input('Client du modèle','2');await f.click('Ajouter une section');await f.input('Titre de section 1','Installation');await f.click('Ajouter une étape 1');await f.input('Titre étape 1.1','Imprimante');await f.click('Enregistrer pour ce client');const post=f.requests.find(r=>r.method==='POST'&&r.url.endsWith('/templates'));assert.equal(post.body.sections[0].steps[0].title,'Imprimante');assert.equal(post.body.clientId,2);}finally{await f.cleanup();}});

test('cursor controls load next pages and independent standard is deduped',async()=>{const second={...template,id:8,name:'Autre modèle'};const extra={...dossier,id:10,employee:'Bob'};const f=fixture({templates:[],override:({url})=>{if(url==='/api/workstation-procedures/templates')return Response.json({templates:[template],hasMore:true,nextBefore:3});if(url.endsWith('/templates?before=3'))return Response.json({templates:[second],hasMore:false,nextBefore:null});if(url==='/api/workstation-procedures/dossiers')return Response.json({dossiers:[dossier],hasMore:true,nextBefore:11});if(url.endsWith('/dossiers?before=11'))return Response.json({dossiers:[extra],hasMore:false,nextBefore:null});}});try{await f.render();assert.equal(f.dom.window.document.body.textContent.split('Dupliquer pour un client · Gabarit Windows').length-1,1);await f.click('Charger plus de modèles');await f.click('Charger plus de dossiers');assert.match(f.dom.window.document.body.textContent,/Autre modèle/);assert.match(f.dom.window.document.body.textContent,/Ouvrir Bob/);assert.ok(!f.dom.window.document.body.textContent.includes('Charger plus de modèles'));}finally{await f.cleanup();}});

test('standard template remains available when paged template listing fails',async()=>{const f=fixture({override:({url})=>url==='/api/workstation-procedures/templates'?Response.json({error:'Unavailable'},{status:503}):undefined});try{await f.render();assert.match(f.dom.window.document.body.textContent,/Gabarit Windows/);assert.match(f.dom.window.document.body.textContent,/Unavailable/);}finally{await f.cleanup();}});

test('400 invalid template keeps editable model and permits corrected retry with a new UUID',async()=>{const f=fixture({override:({url,method,body})=>url.endsWith('/templates')&&method==='POST'&&body.name.length>250?Response.json({error:'Nom invalide'},{status:400}):undefined});try{await f.render();await f.input('Client','2');await f.click('Nouvelle procédure client');await f.input('Client du modèle','2');await f.input('Nom du modèle','X'.repeat(251));await f.click('Ajouter une section');await f.input('Titre de section 1','Installation');await f.click('Ajouter une étape 1');await f.input('Titre étape 1.1','Imprimante');await f.click('Enregistrer pour ce client');assert.match(f.dom.window.document.querySelector('[role="alert"]')?.textContent??'',/Nom invalide/);assert.equal(f.dom.window.sessionStorage.length,0);assert.equal(f.dom.window.document.querySelector('[aria-label="Nom du modèle"]').value,'X'.repeat(251));assert.equal(f.dom.window.document.querySelector('[aria-label="Titre étape 1.1"]').value,'Imprimante');await f.input('Nom du modèle','Client Windows');await f.click('Enregistrer pour ce client');const posts=f.requests.filter(r=>r.method==='POST'&&r.url.endsWith('/templates'));assert.equal(posts.length,2);assert.notEqual(posts[0].body.requestKey,posts[1].body.requestKey);assert.match(f.dom.window.document.body.textContent,/Procédure enregistrée pour Acme TI/);}finally{await f.cleanup();}});

test('delayed pending template readback preserves an edited model and its save action',async()=>{
  const seed={kind:'template',payload:{requestKey:'9ecb3330-166b-4c93-9cd8-fce998336399',clientId:2,name:'New model',sections:template.sections}};
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const f=fixture({pendingSeed:seed,override:({url})=>url.includes('/templates/by-request/')?gate.then(()=>Response.json({template:{...template,id:9,clientId:2,name:'New model'}})):undefined});
  try{
    await f.render();await f.click('Gabarit Windows · Global');await f.input('Nom du modèle','Important unsaved edit');
    await act(async()=>release());
    assert.equal(f.dom.window.document.querySelector('[aria-label="Nom du modèle"]')?.value,'Important unsaved edit');
    assert.equal([...f.dom.window.document.querySelectorAll('button')].find(b=>b.textContent==='Sauvegarder le gabarit global')?.disabled,false);
    assert.match(f.dom.window.document.body.textContent,/New model/);
    assert.equal(f.dom.window.sessionStorage.length,0);
    await f.click('Sauvegarder le gabarit global');assert.equal(f.requests.find(r=>r.method==='PUT')?.body.name,'Important unsaved edit');
  }finally{release();await f.cleanup();}
});

test('confirmed readback cannot report success when pending-key cleanup fails',async()=>{
  const seed={kind:'dossier',payload:{requestKey:'9ecb3330-166b-4c93-9cd8-fce998336399',clientId:2,templateId:3,employee:'New',computer:'',ticket:'',date:'2026-11-09'}};
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const f=fixture({pendingSeed:seed,override:({url})=>url.includes('/dossiers/by-request/')?gate.then(()=>Response.json({dossier:{...dossier,id:12,employee:'New'}})):undefined});
  const storageProto=f.dom.window.Storage.prototype,remove=storageProto.removeItem;
  try{await f.render();storageProto.removeItem=function(){};await act(async()=>release());assert.ok(f.dom.window.sessionStorage.getItem('workstation-procedures:pending-create:1'));assert.doesNotMatch(f.dom.window.document.body.textContent,/Dossier créé/);assert.ok(![...f.dom.window.document.querySelectorAll('button')].some(b=>b.textContent.startsWith('Ouvrir New')));}finally{storageProto.removeItem=remove;release();await f.cleanup();}
});


async function captureDownloads(f, action) {
  const oldCreate=URL.createObjectURL, oldClick=f.dom.window.HTMLAnchorElement.prototype.click;
  const blobs=[], names=[];URL.createObjectURL=b=>{blobs.push(b);return 'blob:http://localhost/fixture';};
  f.dom.window.HTMLAnchorElement.prototype.click=function(){names.push(this.download);};
  try {await action({blobs,names,read:b=>new Promise(resolve=>{const r=new f.dom.window.FileReader();r.onload=()=>resolve(r.result);r.readAsText(b);})});}
  finally{URL.createObjectURL=oldCreate;f.dom.window.HTMLAnchorElement.prototype.click=oldClick;}
}
const otherClient={id:7,nom:'Acme TÍ',clientType:'ti',primeId:1};
const variant={...template,id:8,name:'Variante Acme',sections:[{title:'Variante',steps:[{id:'v',title:'VARIANT-ONLY',note:'Variant note'}]}]};
const otherProcedure={...template,id:9,clientId:7,name:'Standard Windows',sections:[{title:'Autre client',steps:[{id:'o',title:'OTHER-CLIENT-ONLY',note:'Other note'}]}]};
const clientOverride=({url})=>url==='/api/clients'?Response.json({clients:[{id:2,nom:'Acme TI',clientType:'ti',primeId:1},otherClient]}):undefined;

test('selection changes clear the previous client/procedure export success without generating another file',async()=>{
 const items=[template,variant,otherProcedure];
 for(const format of ['Télécharger la procédure HTML','Télécharger la trousse d’audit (.zip)'])for(const change of [
  f=>f.input('Client','7'), f=>f.input('Modèle','8'),
  f=>f.click('Variante Acme'), f=>f.click('Gabarit Windows · Global'),
  f=>f.click('Dupliquer pour un client'), f=>f.click('Nouvelle procédure client'),
  f=>f.click('Nouveau modèle global')
 ]){
  const f=fixture({templates:items,override:clientOverride});
  try{await f.render();await f.input('Client','2');await f.input('Modèle','3');
   await captureDownloads(f,async({names})=>{
    await f.click(format);
    const statuses=()=>[...f.dom.window.document.querySelectorAll('[role="status"]')].map(e=>e.textContent).join(' / ');
    assert.match(statuses(),/généré[e]? pour Acme TI/);
    await change(f);
    assert.doesNotMatch(statuses(),/généré[e]? pour Acme TI|selon Standard Windows/);
    assert.equal(names.length,1,'a selection change must not generate a new file');
   });
  }finally{await f.cleanup();}
 }
});

test('export A then client B then variant A shows only the current source and clears obsolete export errors',async()=>{
 const items=[template,variant,otherProcedure];
 const f=fixture({templates:items,override:args=>clientOverride(args)??(args.url.includes('/audit-source?')?Response.json({client:args.url.includes('clientId=7&')?{id:7,nom:'Acme TÍ'}:{id:2,nom:'Acme TI'},template:items.find(i=>args.url.endsWith(`templateId=${i.id}`))}):undefined)});
 const statuses=()=>[...f.dom.window.document.querySelectorAll('[role="status"]')].map(e=>e.textContent).join(' / ');
 try{await f.render();await captureDownloads(f,async({names})=>{
  await f.input('Client','2');await f.input('Modèle','3');await f.click('Télécharger la trousse d’audit (.zip)');
  assert.match(statuses(),/Trousse ZIP générée pour Acme TI selon Standard Windows/);
  await f.input('Client','7');await f.input('Modèle','9');
  assert.doesNotMatch(statuses(),/Trousse ZIP générée pour Acme TI/);assert.match(statuses(),/Source : procédure enregistrée Standard Windows du client Acme TÍ/);
  await f.click('Télécharger la trousse d’audit (.zip)');assert.match(statuses(),/Trousse ZIP générée pour Acme TÍ/);
  await f.input('Client','2');await f.input('Modèle','8');
  assert.doesNotMatch(statuses(),/Trousse ZIP générée|Acme TÍ/);assert.match(statuses(),/Source : procédure enregistrée Variante Acme du client Acme TI/);
  await f.click('Télécharger la trousse d’audit (.zip)');assert.match(statuses(),/Trousse ZIP générée pour Acme TI selon Variante Acme/);
  await f.input('Modèle','');await f.click('Télécharger la trousse d’audit (.zip)');
  assert.match(f.dom.window.document.querySelector('[role="alert"]')?.textContent??'',/Choisissez/);
  await f.input('Modèle','3');assert.ok(!f.dom.window.document.querySelector('[role="alert"]'));
  assert.equal(names.length,3);
 });}finally{await f.cleanup();}
});

test('procedures are grouped by real client; variants survive and foreign portfolios are not labelled as generic clients',async()=>{
 const f=fixture({templates:[template,variant,otherProcedure,{...template,id:19,clientId:99,name:'FOREIGN-SECRET'}],override:clientOverride});
 try{await f.render();const groups=[...f.dom.window.document.querySelectorAll('section[aria-label^="Procédures —"]')];assert.equal(groups.length,2);
 assert.match(groups.find(e=>e.getAttribute('aria-label')==='Procédures — Acme TI').textContent,/Standard Windows.*Variante Acme/);
 assert.doesNotMatch(groups.find(e=>e.getAttribute('aria-label')==='Procédures — Acme TI').textContent,/OTHER-CLIENT|FOREIGN/);
 assert.doesNotMatch(f.dom.window.document.body.textContent,/FOREIGN-SECRET/);
 await f.input('Client','2');assert.deepEqual([...f.dom.window.document.querySelector('[aria-label="Modèle"]').options].map(o=>o.value),['','3','8']);
 await f.input('Modèle','8');assert.equal(f.dom.window.document.querySelector('[aria-label="Titre étape 1.1"]').value,'VARIANT-ONLY');
 await f.input('Client','7');assert.equal(f.dom.window.document.querySelector('[aria-label="Modèle"]').value,'');assert.deepEqual([...f.dom.window.document.querySelector('[aria-label="Modèle"]').options].map(o=>o.value),['','9']);
 }finally{await f.cleanup();}
});

test('client settings reset rather than silently carrying to another client; each client and variant exports its own saved source',async()=>{
 const items=[template,variant,otherProcedure];const f=fixture({templates:items,override:args=>clientOverride(args)??(args.url.includes('/audit-source?')?Response.json({client:args.url.includes('clientId=7&')?{id:7,nom:'Acme TÍ'}:{id:2,nom:'Acme TI'},template:items.find(i=>args.url.endsWith(`templateId=${i.id}`))}):undefined)});
 try{await f.render();await captureDownloads(f,async({blobs,names,read})=>{
 await f.input('Client','2');await f.input('Modèle','3');await f.input('Préfixe du client','ACME-ONLY-');await f.click('Télécharger la procédure HTML');await f.click('Télécharger la trousse d’audit (.zip)');assert.equal(globalThis.__scriptConfig.computerPrefix,'ACME-ONLY-');
 await f.input('Modèle','8');await f.click('Télécharger la procédure HTML');await f.click('Télécharger la trousse d’audit (.zip)');assert.equal(globalThis.__scriptConfig.procedure.name,variant.name);assert.match(await read(blobs[2]),/VARIANT-ONLY/);
 await f.input('Client','7');assert.equal(f.dom.window.document.querySelector('[aria-label="Préfixe du client"]').value,'PC-');await f.input('Modèle','9');await f.click('Télécharger la procédure HTML');await f.click('Télécharger la trousse d’audit (.zip)');assert.equal(globalThis.__scriptConfig.clientName,'Acme TÍ');assert.deepEqual(globalThis.__scriptConfig.procedure.sections,otherProcedure.sections);assert.match(await read(blobs[4]),/OTHER-CLIENT-ONLY/);assert.doesNotMatch(await read(blobs[4]),/VARIANT-ONLY/);assert.equal(names.length,6);assert.equal(new Set(names).size,6);assert.ok(names.every(n=>/^[a-zA-Z0-9-]+\.(html|zip)$/.test(n)));
 });}finally{await f.cleanup();}
});

test('global template cannot export as a fake client procedure until duplicated and confirmed by readback',async()=>{
 const global={...template,clientId:null};const f=fixture({templates:[global],override:({url})=>url.includes('/audit-source?')?Response.json({client:{id:2,nom:'Acme TI'},template:global}):undefined});
 try{await f.render();await captureDownloads(f,async({blobs})=>{await f.input('Client','2');await f.input('Modèle','3');await f.click('Télécharger la procédure HTML');await f.click('Télécharger la trousse d’audit (.zip)');assert.equal(blobs.length,0);assert.ok(!f.requests.some(r=>r.url.includes('/audit-source?')));});}finally{await f.cleanup();}
});

test('new client procedure saves through templates, reads its receipt, and exports after authoritative source recheck without any dossier POST',async()=>{
 let stored;const f=fixture({override:({url,method,body})=>{if(url.endsWith('/templates')&&method==='POST'){stored={id:12,version:1,...body};return Response.json({template:stored},{status:201});}if(url.includes('/templates/by-request/'))return Response.json({template:stored});if(url.includes('/audit-source?'))return Response.json({client:{id:2,nom:'Acme TI'},template:stored});}});
 try{await f.render();await f.input('Client','2');await f.click('Nouvelle procédure client');await f.input('Nom du modèle','Générale');await f.click('Ajouter une section');await f.input('Titre de section 1','Commun');await f.click('Ajouter une étape 1');await f.input('Titre étape 1.1','CLIENT-SAVED');
 await captureDownloads(f,async({blobs,read})=>{await f.click('Télécharger la procédure HTML');assert.equal(blobs.length,0);await f.click('Enregistrer pour ce client');assert.equal(f.dom.window.sessionStorage.length,0);assert.equal(f.dom.window.document.querySelector('[aria-label="Modèle"]').value,'12');await f.click('Télécharger la procédure HTML');assert.match(await read(blobs[0]),/CLIENT-SAVED/);await f.click('Télécharger la trousse d’audit (.zip)');assert.deepEqual(globalThis.__scriptConfig.procedure.sections,stored.sections);});
 assert.equal(f.requests.filter(r=>r.method==='POST').length,1);assert.ok(f.requests.some(r=>r.url.includes('/templates/by-request/')));assert.ok(!f.requests.some(r=>r.url.includes('/dossiers')&&r.method!=='GET'));
 }finally{await f.cleanup();}
});

test('historical active dossiers are immutable consultation; opening one preserves unsaved general procedure and blocks both exports',async()=>{
 const before=JSON.stringify(dossier);const f=fixture({dossiers:[dossier]});try{await f.render();await f.input('Client','2');await f.input('Modèle','3');await f.input('Titre étape 1.1','UNSAVED-GENERAL');await f.click('Ouvrir Alice · Acme TI');assert.equal(f.dom.window.document.querySelector('[aria-label="Titre étape 1.1"]').value,'UNSAVED-GENERAL');
 assert.ok([...f.dom.window.document.querySelectorAll('.workstation-print-control')].every(e=>e.disabled));assert.equal(f.dom.window.document.querySelector('[aria-label="Employé"]').value,'Alice');assert.equal(f.dom.window.document.querySelector('[aria-label="Employé"]').disabled,true);
 await captureDownloads(f,async({blobs})=>{await f.click('Télécharger la procédure HTML');await f.click('Télécharger la trousse d’audit (.zip)');assert.equal(blobs.length,0);});assert.equal(JSON.stringify(dossier),before);assert.ok(f.requests.every(r=>r.method==='GET'));assert.doesNotMatch(f.dom.window.document.body.textContent,/Sauvegarder le dossier|Archiver le dossier/);
 }finally{await f.cleanup();}
});

test('current authorization denial hides client content, history and settings without generating either format',async()=>{
 for(const status of [401,403]){const f=fixture({dossiers:[dossier],override:({url})=>url.includes('/audit-source?')?Response.json({error:'Accès refusé'},{status}):undefined});try{await f.render();await f.input('Client','2');await f.input('Modèle','3');await f.click('Ouvrir Alice · Acme TI');await captureDownloads(f,async({blobs})=>{await f.click('Télécharger la procédure HTML');assert.equal(blobs.length,0);});assert.doesNotMatch(f.dom.window.document.body.textContent,/Acme TI|Alice|Clavier|PC-1/);assert.equal(f.dom.window.document.querySelector('[aria-label="Préfixe du client"]'),null);}finally{await f.cleanup();}}
});

test('BZ-prefilled script settings are visibly unconfirmed, can be confirmed for a client, and reset confirmation on client switch',async()=>{
 const f=fixture({templates:[template,otherProcedure],override:clientOverride});try{await f.render();await f.input('Client','2');await f.input('Modèle','3');assert.match(f.dom.window.document.body.textContent,/préremplis.*BZ/);await f.click('Confirmer les paramètres');assert.match(f.dom.window.document.body.textContent,/Paramètres confirmés pour Acme TI/);await f.input('Client','7');assert.doesNotMatch(f.dom.window.document.body.textContent,/Paramètres confirmés pour Acme TI/);assert.match(f.dom.window.document.body.textContent,/préremplis.*BZ/);}finally{await f.cleanup();}
});

async function draftClientProcedure(f,name='Original procedure') {
 await f.input('Client','2');await f.click('Nouvelle procédure client');await f.input('Nom du modèle',name);await f.click('Ajouter une section');await f.input('Titre de section 1','Commun');await f.click('Ajouter une étape 1');await f.input('Titre étape 1.1','Original step');
}
test('uncertain template creation retries only the original UUID and payload; an unconfirmed readback preserves pending receipt and draft',async()=>{
 let attempts=0,payload;const f=fixture({override:({url,method,body})=>{if(url.endsWith('/templates')&&method==='POST'){payload=body;attempts++;return attempts===1?Promise.reject(Error('Lost response')):Response.json({template:{...body,id:22,version:1}});}if(method==='PUT'&&url.endsWith('/templates/22'))return Response.json({template:{id:22,clientId:2,version:2,name:body.name,sections:body.sections}});if(url.includes('/templates/by-request/'))return attempts===1?Response.json({error:'Not found'},{status:404}):Response.json({template:{...payload,id:22,version:1}});}});
 try{await f.render();await draftClientProcedure(f);await f.click('Enregistrer pour ce client');const receipt=f.dom.window.sessionStorage.getItem('workstation-procedures:pending-create:1');assert.ok(receipt);await f.input('Nom du modèle','Newer draft');await f.click('Réessayer la création du modèle');const posts=f.requests.filter(r=>r.method==='POST');assert.equal(posts.length,2);assert.deepEqual(posts[0].body,posts[1].body);assert.match(posts[0].body.requestKey,/^[a-f\d-]{36}$/);assert.equal(f.dom.window.sessionStorage.length,0);assert.equal(f.dom.window.document.querySelector('[aria-label="Nom du modèle"]').value,'Newer draft');assert.match(f.dom.window.document.body.textContent,/Original procedure/);await f.click('Enregistrer pour ce client');assert.equal(f.requests.filter(r=>r.method==='POST').length,2,'newer edits must update the confirmed procedure, never create a duplicate');assert.ok(f.requests.some(r=>r.method==='PUT'&&r.url.endsWith('/templates/22')));}
 finally{await f.cleanup();}
});

test('mismatched creation readback cannot erase the receipt or editable draft',async()=>{
 const f=fixture({override:({url})=>url.includes('/templates/by-request/')?Response.json({template:{...template,id:23,name:'Wrong receipt'}}):undefined});try{await f.render();await draftClientProcedure(f);await f.click('Enregistrer pour ce client');assert.ok(f.dom.window.sessionStorage.getItem('workstation-procedures:pending-create:1'));assert.equal(f.dom.window.document.querySelector('[aria-label="Nom du modèle"]').value,'Original procedure');assert.match(f.dom.window.document.body.textContent,/Création non confirmée/);assert.doesNotMatch(f.dom.window.document.body.textContent,/Procédure enregistrée pour Acme TI/);}finally{await f.cleanup();}
});

test('400 pending-template cleanup failure blocks new keys and keeps corrected draft',async()=>{
 const f=fixture({override:({url,method})=>url.endsWith('/templates')&&method==='POST'?Response.json({error:'Nom invalide'},{status:400}):undefined});try{await f.render();await draftClientProcedure(f);const proto=f.dom.window.Storage.prototype,remove=proto.removeItem;try{proto.removeItem=function(){};await f.click('Enregistrer pour ce client');const receipt=f.dom.window.sessionStorage.getItem('workstation-procedures:pending-create:1');assert.ok(receipt);await f.input('Nom du modèle','Corrected');await f.click('Enregistrer pour ce client');assert.equal(f.requests.filter(r=>r.method==='POST').length,1);assert.equal(f.dom.window.sessionStorage.getItem('workstation-procedures:pending-create:1'),receipt);assert.equal(f.dom.window.document.querySelector('[aria-label="Nom du modèle"]').value,'Corrected');}finally{proto.removeItem=remove;}}finally{await f.cleanup();}
});

test('delayed legacy dossier receipt reconciles history without replacing selected client procedure or its unsaved edits',async()=>{
 const seed={kind:'dossier',payload:{requestKey:'9ecb3330-166b-4c93-9cd8-fce998336399',clientId:2,templateId:3,employee:'Legacy',computer:'',ticket:'',date:'2026-11-09'}};let release;const gate=new Promise(r=>release=r);const f=fixture({pendingSeed:seed,override:({url})=>url.includes('/dossiers/by-request/')?gate.then(()=>Response.json({dossier:{...dossier,id:12,employee:'Legacy'}})):undefined});
 try{await f.render();await f.input('Client','2');await f.input('Modèle','3');await f.input('Titre étape 1.1','NEW GENERAL DRAFT');await act(async()=>release());assert.equal(f.dom.window.sessionStorage.length,0);assert.equal(f.dom.window.document.querySelector('[aria-label="Modèle"]').value,'3');assert.equal(f.dom.window.document.querySelector('[aria-label="Titre étape 1.1"]').value,'NEW GENERAL DRAFT');assert.match(f.dom.window.document.body.textContent,/Ouvrir Legacy/);assert.ok(f.requests.every(r=>r.method==='GET'));}finally{release();await f.cleanup();}
});

test('unsaved general procedure vetoes logout, external download navigation and survives BrowserRouter history for the same account only',async()=>{
 const f=fixture({browserRouter:true});try{await f.render();await draftClientProcedure(f,'PRIVATE DRAFT');f.dom.window.confirm=()=>false;assert.equal(f.dom.window.dispatchEvent(new f.dom.window.Event('client-onboarding:before-logout',{cancelable:true})),false);const anchor=f.dom.window.document.createElement('a');anchor.href='https://example.org';anchor.download='x';f.dom.window.document.body.append(anchor);const event=new f.dom.window.MouseEvent('click',{bubbles:true,cancelable:true});anchor.dispatchEvent(event);assert.equal(event.defaultPrevented,true);
 f.dom.window.confirm=()=>true;await act(async()=>f.dom.window.document.querySelector('nav a').click());await act(async()=>{f.dom.window.history.back();await new Promise(r=>setTimeout(r,30));});assert.equal(f.dom.window.document.querySelector('[aria-label="Nom du modèle"]').value,'PRIVATE DRAFT');await act(async()=>f.dom.window.document.querySelector('nav a').click());f.auth.user={id:2,role:'admin'};await act(async()=>{f.dom.window.history.back();await new Promise(r=>setTimeout(r,30));});assert.equal(f.dom.window.document.querySelector('[aria-label="Nom du modèle"]'),null);assert.doesNotMatch(f.dom.window.document.body.textContent,/PRIVATE DRAFT/);
 }finally{await f.cleanup();}
});

test('current denied pending receipt conceals clients while retaining the original recovery key',async()=>{
 const seed={kind:'template',payload:{requestKey:'9ecb3330-166b-4c93-9cd8-fce998336399',clientId:2,name:'Original',sections:template.sections}};
 for(const status of [401,403]){const f=fixture({pendingSeed:seed,override:({url})=>url.includes('/templates/by-request/')?Response.json({error:'Denied'},{status}):undefined});try{await f.render();assert.doesNotMatch(f.dom.window.document.body.textContent,/Acme TI|Standard Windows/);assert.deepEqual(JSON.parse(f.dom.window.sessionStorage.getItem('workstation-procedures:pending-create:1')),seed);assert.ok(f.requests.every(r=>r.method==='GET'));}finally{await f.cleanup();}}
});


test('older saved client procedure becomes selectable without loading a hidden global page',async()=>{
 const newer={...template,id:99,clientId:null,name:'New global'};
 const f=fixture({override:({url})=>url==='/api/workstation-procedures/templates'?Response.json({templates:[newer],hasMore:true,nextBefore:99}):url.endsWith('/templates?before=99')?Response.json({templates:[template],hasMore:false,nextBefore:null}):undefined});
 try{await f.render();await f.input('Client','2');assert.ok([...f.dom.window.document.querySelector('[aria-label="Modèle"]').options].some(o=>o.value==='3'),'saved client procedure hidden behind global pagination');}finally{await f.cleanup();}
});


test('admin deletes one open historical dossier after explicit confirmation without changing the selected client procedure',async()=>{
 let deleted=false,confirmation='';
 const f=fixture({dossiers:[dossier],override:({url,method})=>{
  if(url.endsWith('/dossiers/11')&&method==='DELETE'){deleted=true;return Response.json({deleted:{id:11,version:2}});}
  if(url.endsWith('/dossiers/11')&&method==='GET'&&deleted)return Response.json({error:'Absent'},{status:404});
 }});
 try{await f.render();await f.input('Client','2');await f.input('Modèle','3');await f.click('Ouvrir Alice');
 f.dom.window.confirm=text=>{confirmation=text;return false;};await f.click('Supprimer l’historique');assert.equal(deleted,false);
 f.dom.window.confirm=text=>{confirmation=text;return true;};await f.click('Supprimer l’historique');
 assert.match(confirmation,/Acme TI/);assert.match(confirmation,/PC-1/);assert.match(confirmation,/11/);assert.match(confirmation,/irréversible/i);
 assert.ok(deleted);assert.ok(!f.dom.window.document.querySelector('[aria-label="Employé"]'));assert.doesNotMatch(f.dom.window.document.body.textContent,/Ouvrir Alice/);
 assert.equal(f.dom.window.document.querySelector('[aria-label="Modèle"]').value,'3');assert.equal(f.requests.filter(r=>r.method==='DELETE').length,1);
 assert.deepEqual(f.requests.find(r=>r.method==='DELETE').body,{expectedVersion:1});
 }finally{await f.cleanup();}
});

test('non-admin has no history deletion control',async()=>{
 globalThis.__workstationRole='prime';const f=fixture({dossiers:[dossier]});
 try{await f.render();await f.click('Ouvrir Alice');assert.ok(![...f.dom.window.document.querySelectorAll('button')].some(b=>b.textContent.includes('Supprimer l’historique')));}finally{globalThis.__workstationRole='admin';await f.cleanup();}
});


test('delete failures and mismatched or unverified acknowledgements never clear history',async()=>{
 for(const mode of [400,401,403,404,409,500,'wrong-id','wrong-version','still-readable']){
  const f=fixture({dossiers:[dossier],override:({url,method})=>url.endsWith('/dossiers/11')&&method==='DELETE'?(typeof mode==='number'?Response.json({error:'Refus'},{status:mode}):Response.json({deleted:{id:mode==='wrong-id'?99:11,version:mode==='wrong-version'?3:2}})):undefined});
  try{await f.render();await f.input('Client','2');await f.input('Modèle','3');await f.click('Ouvrir Alice');f.dom.window.confirm=()=>true;await f.click('Supprimer l’historique');
   assert.doesNotMatch(f.dom.window.document.body.textContent,/Historique supprimé/);
   if(mode!==401&&mode!==403){assert.ok(f.dom.window.document.querySelector('[aria-label="Employé"]'));assert.match(f.dom.window.document.body.textContent,/Ouvrir Alice/);assert.equal(f.dom.window.document.querySelector('[aria-label="Modèle"]').value,'3');}
   else assert.doesNotMatch(f.dom.window.document.body.textContent,/Alice|Acme TI/);
  }finally{await f.cleanup();}
 }
});

test('double delete clicks send one request; delayed initial list cannot resurrect deleted history',async()=>{
 let releaseList,releaseDelete,deleted=false;
 const listGate=new Promise(r=>releaseList=r),deleteGate=new Promise(r=>releaseDelete=r);
 const f=fixture({override:({url,method})=>{
  if(url.endsWith('/dossiers')&&method==='GET')return listGate.then(()=>Response.json({dossiers:[dossier],hasMore:false,nextBefore:null}));
  if(url.endsWith('/dossiers/11')&&method==='DELETE')return deleteGate.then(()=>{deleted=true;return Response.json({deleted:{id:11,version:2}});});
  if(url.endsWith('/dossiers/11')&&method==='GET'&&deleted)return Response.json({error:'Absent'},{status:404});
 },pendingSeed:{kind:'dossier',payload:{requestKey:'9ecb3330-166b-4c93-9cd8-fce998336399',clientId:2,templateId:3,employee:'Alice',computer:'PC-1',ticket:'T-1',date:'2026-11-09'}}});
 try{await f.render();f.dom.window.confirm=()=>true;const button=[...f.dom.window.document.querySelectorAll('button')].find(b=>b.textContent.startsWith('Supprimer l’historique'));
 await act(()=>{button.click();button.click();});assert.equal(f.requests.filter(r=>r.method==='DELETE').length,1);
 await act(async()=>releaseDelete());assert.doesNotMatch(f.dom.window.document.body.textContent,/Ouvrir Alice/);
 await act(async()=>releaseList());assert.doesNotMatch(f.dom.window.document.body.textContent,/Ouvrir Alice/);assert.ok(!f.dom.window.document.querySelector('[aria-label="Employé"]'));
 }finally{releaseList();releaseDelete();await f.cleanup();}
});

test('pending history opening and pagination serialize deletion rather than letting late requests restore it',async()=>{
 for(const kind of ['open','page']){
  let release;const gate=new Promise(r=>release=r);
  const f=fixture({dossiers:[dossier],override:({url,method})=>{
   if(url.endsWith('/dossiers')&&method==='GET'&&kind==='page')return Response.json({dossiers:[dossier],hasMore:true,nextBefore:11});
   if(kind==='open'&&url.endsWith('/dossiers/11')&&method==='GET')return gate.then(()=>Response.json({dossier}));
   if(kind==='page'&&url.endsWith('/dossiers?before=11'))return gate.then(()=>Response.json({dossiers:[],hasMore:false,nextBefore:null}));
  }});
  try{await f.render();f.dom.window.confirm=()=>true;await act(()=>[...f.dom.window.document.querySelectorAll('button')].find(b=>b.textContent.startsWith(kind==='open'?'Ouvrir Alice':'Charger plus de dossiers')).click());await f.click('Supprimer l’historique');assert.equal(f.requests.filter(r=>r.method==='DELETE').length,0);await act(async()=>release());assert.match(f.dom.window.document.body.textContent,/Ouvrir Alice/);}finally{release();await f.cleanup();}
 }
});


test('late legacy receipt clears its recovery marker but never restores a deleted dossier',async()=>{
 let release,deleted=false;const gate=new Promise(r=>release=r);
 const f=fixture({dossiers:[dossier],pendingSeed:{kind:'dossier',payload:{requestKey:'9ecb3330-166b-4c93-9cd8-fce998336399',clientId:2,templateId:3,employee:'Alice',computer:'PC-1',ticket:'T-1',date:'2026-11-09'}},override:({url,method})=>{
  if(url.includes('/dossiers/by-request/'))return gate.then(()=>Response.json({dossier}));
  if(url.endsWith('/dossiers/11')&&method==='DELETE'){deleted=true;return Response.json({deleted:{id:11,version:2}});}
  if(url.endsWith('/dossiers/11')&&method==='GET'&&deleted)return Response.json({error:'Absent'},{status:404});
 }});
 try{await f.render();f.dom.window.confirm=()=>true;await f.click('Supprimer l’historique');await act(async()=>release());assert.doesNotMatch(f.dom.window.document.body.textContent,/Ouvrir Alice|Dossier créé|Création en attente/);assert.equal(f.dom.window.sessionStorage.length,0);assert.ok(!f.dom.window.document.querySelector('[aria-label="Employé"]'));}finally{release();await f.cleanup();}
});


for (const change of ['client','variant','settings','editor','verification-failed','same-account-rearm','account','logout','unmount']) {
 test(`ZIP completion rechecks ${change} after real asynchronous compression`,async()=>{
  let release;globalThis.__bundleGate=new Promise(r=>release=r);
  const f=fixture({templates:[template,variant,otherProcedure],override:clientOverride});
  const oldCreate=URL.createObjectURL,oldClick=f.dom.window.HTMLAnchorElement.prototype.click;let downloads=0;
  URL.createObjectURL=()=>{downloads++;return 'blob:fixture';};f.dom.window.HTMLAnchorElement.prototype.click=function(){};
  try{
   await f.render();await f.input('Client','2');await f.input('Modèle','3');
   await act(()=>[...f.dom.window.document.querySelectorAll('button')].find(b=>b.textContent==='Télécharger la trousse d’audit (.zip)').click());
   for(let i=0;!globalThis.__bundleReady&&i<100;i++)await act(async()=>{await new Promise(r=>setTimeout(r,5));});
   assert.equal(globalThis.__bundleReady,true,'actual ZIP serialization completed before context change');assert.equal(downloads,0);
   if(change==='client')await f.input('Client','7');
   if(change==='variant')await f.input('Modèle','8');
   if(change==='settings')await f.input('Préfixe du client','NEW-');
   if(change==='editor')await f.input('Titre étape 1.1','NEW unsaved note');
   if(['verification-failed','same-account-rearm','account','logout'].includes(change)){
    await act(async()=>{f.auth.start();});
    if(change!=='verification-failed'){f.auth.verified=true;f.auth.loading=false;if(change==='account')f.auth.user={id:2,role:'admin'};if(change==='logout')f.auth.user=null;await f.render();}
   }
   if(change==='unmount')await f.unmount();
   await act(async()=>{release();await Promise.all(globalThis.__bundleTasks);});
   assert.equal(downloads,0,'no stale ZIP Blob or download');assert.doesNotMatch(f.dom.window.document.body.textContent,/Trousse ZIP générée/);
  }finally{release();delete globalThis.__bundleGate;URL.createObjectURL=oldCreate;f.dom.window.HTMLAnchorElement.prototype.click=oldClick;await f.cleanup();}
 });
}
