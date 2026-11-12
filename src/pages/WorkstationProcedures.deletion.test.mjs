import test from 'node:test';
import assert from 'node:assert/strict';
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router-dom';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
import {unlink} from 'node:fs/promises';

// Keep the real AuthProvider: window.confirm returning focus can revalidate /me.
const outfile=new URL('./.workstation-deletion-auth-test.mjs',import.meta.url).pathname;
await build({stdin:{contents:`export {default as App} from '${new URL('../App.tsx',import.meta.url).pathname}';export {AuthProvider} from '${new URL('../context/AuthContext.tsx',import.meta.url).pathname}';`,resolveDir:new URL('.',import.meta.url).pathname,loader:'js'},outfile,bundle:true,format:'esm',platform:'node',packages:'external',jsx:'automatic'});
const {App,AuthProvider}=await import(outfile);await unlink(outfile);
const admin={id:1,email:'admin@fixture.invalid',prenom:'A',nom:'Admin',role:'admin',is_active:true};
const model={id:3,clientId:null,name:'Global fixture',version:1,sections:[{title:'Preparation',steps:[{id:'s',title:'Check',note:''}]}]};
const dossier={id:11,clientId:2,clientName:'Client fixture',templateId:3,employee:'Alice',computer:'PC-1',ticket:'',date:'2026-11-12',version:1,archivedAt:null,sections:[{title:'Preparation',steps:[{id:'s',title:'Check',note:'',etat:'todo',commentaire:''}]}]};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
async function fixture({deleteStatus=200,readStatus=404}={}){
 const dom=new JSDOM('<div id="app"></div>',{url:'http://localhost/procedures/installation-postes'});
 const old={window:globalThis.window,document:globalThis.document,fetch:globalThis.fetch};
 const deletion=deferred(),readback=deferred();let identity=admin,deleted=false;
 const requests=[];
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,fetch:async(url,options={})=>{
  const method=options.method||'GET';requests.push({url,method});
  if(url==='/api/auth/me')return Response.json({user:identity});
  if(url==='/api/clients')return Response.json({clients:[{id:2,nom:'Client fixture',clientType:'ti',primeId:1}]});
  if(url==='/api/workstation-procedures/templates/standard')return Response.json({template:model});
  if(url==='/api/workstation-procedures/templates')return Response.json({templates:[model],hasMore:false,nextBefore:null});
  if(url==='/api/workstation-procedures/dossiers')return Response.json({dossiers:identity.id===admin.id?[dossier]:[],hasMore:false,nextBefore:null});
  if(url==='/api/workstation-procedures/dossiers/11'&&method==='DELETE'){
   await deletion.promise;deleted=deleteStatus===200;
   return Response.json(deleted?{deleted:{id:11,version:2}}:{error:'Dossier introuvable'},{status:deleteStatus});
  }
  if(url==='/api/workstation-procedures/dossiers/11'&&method==='GET'){
   await readback.promise;
   return Response.json(readStatus===200?{dossier}:{error:'Dossier introuvable'},{status:readStatus});
  }
  throw Error(`Unexpected ${method} ${url}`);
 }});
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;dom.window.confirm=()=>true;
 const root=createRoot(dom.window.document.getElementById('app'));
 await act(async()=>root.render(React.createElement(BrowserRouter,{future:{v7_startTransition:true,v7_relativeSplatPath:true}},React.createElement(AuthProvider,null,React.createElement(App)))));
 const buttons=()=>[...dom.window.document.querySelectorAll('button')];
 return {dom,requests,get deleted(){return deleted;},
  async start(){const b=buttons().find(b=>b.textContent==='Supprimer l’historique #11');assert.ok(b);await act(async()=>b.click());},
  async refresh(user=identity){identity=user;await act(async()=>dom.window.dispatchEvent(new dom.window.Event('focus')));},
  async commit(){await act(async()=>deletion.resolve());},
  async confirm(){await act(async()=>readback.resolve());},
  hasRow:()=>buttons().some(b=>b.textContent==='Supprimer l’historique #11'),
  text:()=>dom.window.document.body.textContent,
  async close(){await act(async()=>{deletion.resolve();readback.resolve();});await act(async()=>root.unmount());Object.assign(globalThis,old);dom.window.close();},
 };
}

test('same-account focus verification during successful deletion still removes the exact history after readback',async()=>{
 for(const refreshAt of ['before-delete-response','before-readback-response']){
  const f=await fixture();try{
   await f.start();assert.equal(f.hasRow(),true);
   if(refreshAt==='before-delete-response')await f.refresh();
   await f.commit();assert.equal(f.deleted,true);assert.equal(f.hasRow(),true,'DELETE alone must not remove the history');
   if(refreshAt==='before-readback-response')await f.refresh();
   await f.confirm();
   assert.equal(f.hasRow(),false,refreshAt+': completed deletion must not be discarded by same-account /me');
   assert.match(f.text(),/Historique supprimé/);
   assert.equal(f.requests.filter(r=>r.url==='/api/auth/me').length,2);
   assert.deepEqual(f.requests.filter(r=>r.url.endsWith('/dossiers/11')).map(r=>r.method),['DELETE','GET']);
  }finally{await f.close();}
 }
});

test('a changed account never receives a prior account deletion notice or resurrected history',async()=>{
 const f=await fixture();try{
  await f.start();await f.refresh({...admin,id:2,email:'other@fixture.invalid'});await f.commit();await f.confirm();
  assert.equal(f.hasRow(),false);assert.doesNotMatch(f.text(),/Historique supprimé|Alice/);assert.match(f.text(),/other@fixture.invalid/);
 }finally{await f.close();}
});

test('a stale DELETE 404 is not accepted as proof of deletion',async()=>{
 const f=await fixture({deleteStatus:404});try{
  await f.start();await f.commit();await f.confirm();assert.equal(f.hasRow(),true);assert.match(f.text(),/Dossier introuvable/);assert.doesNotMatch(f.text(),/Historique supprimé/);
  assert.equal(f.requests.filter(r=>r.url.endsWith('/dossiers/11')&&r.method==='GET').length,0);
 }finally{await f.close();}
});

test('a successful DELETE with an accessible readback keeps the history and reports nonconfirmation',async()=>{
 const f=await fixture({readStatus:200});try{
  await f.start();await f.refresh();await f.commit();await f.confirm();assert.equal(f.hasRow(),true);assert.match(f.text(),/dossier encore accessible/);assert.doesNotMatch(f.text(),/Historique supprimé/);
 }finally{await f.close();}
});
