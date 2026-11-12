import test from 'node:test';
import assert from 'node:assert/strict';
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {Simulate} from 'react-dom/test-utils';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
import {unlink} from 'node:fs/promises';
import JSZip from 'jszip';
const outfile=new URL('./.workstation-zip-auth-test.mjs',import.meta.url).pathname;
await build({stdin:{contents:`export {default as Page} from '${new URL('./WorkstationProcedures.tsx',import.meta.url).pathname}';export {AuthProvider,useAuth} from '${new URL('../context/AuthContext.tsx',import.meta.url).pathname}';`,resolveDir:new URL('.',import.meta.url).pathname,loader:'js'},outfile,bundle:true,format:'esm',platform:'node',packages:'external',jsx:'automatic'});
const {Page,AuthProvider,useAuth}=await import(outfile);await unlink(outfile);
const admin={id:1,email:'admin@fixture.invalid',prenom:'A',nom:'Admin',role:'admin',is_active:true};
const model={id:3,clientId:2,name:'Client procedure',version:1,sections:[{title:'Preparation',steps:[{id:'s',title:'Check é',note:''}]}]};
const deferred=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};};
for(const mode of ['same-account-focus','failed-me','expired-me','different-account','logout','zip-failure']){
 test(`real AuthProvider and ZIP: ${mode} before compression resolves`,async()=>{
  const dom=new JSDOM('<div id="app"></div>',{url:'http://localhost/procedures/installation-postes'});
  const old={window:globalThis.window,document:globalThis.document,fetch:globalThis.fetch,URL:globalThis.URL,Blob:globalThis.Blob};
  let auth,meReads=0,logoutCalls=0,downloads=0;const gate=deferred(),ready=deferred(),tasks=[];
  const generate=JSZip.prototype.generateAsync;
  JSZip.prototype.generateAsync=function(...args){const task=generate.apply(this,args).then(async bytes=>{ready.resolve();await gate.promise;return bytes;});tasks.push(task);return task;};
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,URL:dom.window.URL,Blob:dom.window.Blob,fetch:async(url,options={})=>{
   if(url==='/api/auth/me'){
    meReads++;
    if(meReads>1&&mode==='failed-me')return Response.json({error:'Unavailable'},{status:503});
    if(meReads>1&&mode==='expired-me')return Response.json({error:'Expired'},{status:401});
    return Response.json({user:meReads>1&&mode==='different-account'?{...admin,id:2}:admin});
   }
   if(url==='/api/auth/logout'){logoutCalls++;return Response.json({ok:true});}
   if(url==='/api/clients')return Response.json({clients:[{id:2,nom:'Client é',clientType:'ti',primeId:1}]});
   if(url==='/api/workstation-procedures/templates/standard')return Response.json({template:{...model,id:30,clientId:null}});
   if(url==='/api/workstation-procedures/templates')return Response.json({templates:[model],hasMore:false,nextBefore:null});
   if(url==='/api/workstation-procedures/dossiers')return Response.json({dossiers:[],hasMore:false,nextBefore:null});
   if(url.startsWith('/api/workstation-procedures/audit-source?'))return Response.json({client:{id:2,nom:'Client é'},template:model});
   throw Error(`Unexpected ${options.method||'GET'} ${url}`);
  }});
  URL.createObjectURL=()=>{downloads++;return 'blob:http://localhost/zip';};URL.revokeObjectURL=()=>{};
  dom.window.HTMLAnchorElement.prototype.click=function(){};
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  function Capture(){auth=useAuth();return React.createElement(Page);}
  const root=createRoot(dom.window.document.getElementById('app'));
  const set=async(label,value)=>{const el=dom.window.document.querySelector(`[aria-label="${label}"]`);assert.ok(el);await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype,'value').set.call(el,value);Simulate.change(el,{target:{value}});});};
  try{
   await act(async()=>root.render(React.createElement(AuthProvider,null,React.createElement(Capture))));
   await set('Client','2');await set('Modèle','3');
   await act(async()=>{[...dom.window.document.querySelectorAll('button')].find(b=>b.textContent==='Télécharger la trousse d’audit (.zip)').click();await ready.promise;});
   assert.equal(downloads,0);
   if(mode==='logout')await act(async()=>auth.logout());
   else if(mode!=='zip-failure')await act(async()=>dom.window.dispatchEvent(new dom.window.Event('focus')));
   await act(async()=>{mode==='zip-failure'?gate.reject(Error('Compression indisponible')):gate.resolve();await Promise.allSettled(tasks);});
   assert.equal(downloads,0);assert.doesNotMatch(dom.window.document.body.textContent,/Trousse ZIP générée/);
   if(mode==='zip-failure')assert.match(dom.window.document.querySelector('[role="alert"]')?.textContent??'',/Compression indisponible/);
   if(mode==='logout')assert.equal(logoutCalls,1);
   if(mode==='same-account-focus')assert.equal(auth.user.id,1);
   if(!['logout','zip-failure'].includes(mode))assert.equal(meReads,2);
  }finally{gate.resolve();await act(async()=>{await Promise.allSettled(tasks);root.unmount();});JSZip.prototype.generateAsync=generate;Object.assign(globalThis,old);dom.window.close();}
 });
}
