import test from 'node:test';import assert from 'node:assert/strict';import React,{act} from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router-dom';import {JSDOM} from 'jsdom';import {build} from 'esbuild';import {unlink} from 'node:fs/promises';
const outfile=new URL('./.control-tower-ui-test.mjs',import.meta.url).pathname;let pages;
try{await build({stdin:{contents:"export {default as Dashboard} from './Dashboard';export {AuthProvider} from '../context/AuthContext';",resolveDir:new URL('.',import.meta.url).pathname,loader:'ts'},outfile,bundle:true,format:'esm',platform:'node',packages:'external',jsx:'automatic'});pages=await import(outfile);}finally{await unlink(outfile).catch(()=>{});}
const period={key:'2026-11',start:'2026-11-01',end:'2026-12-01',last:'2026-11-30',today:'2026-11-20',timeZone:'America/Toronto'};
const summary={period,clientCount:4,riskCount:1,primes:[{id:1,nom:'Prime A',manualAvailability:'disponible',effectiveAvailability:'charge',autoCharge:true,monthlyCount:8}],tasks:Array.from({length:8},(_,i)=>({id:`tableau:1:${i}`,source:'tableau',boardId:1,key:'projets',clientId:2,primeId:1,clientName:'Alpha',title:`Action ${i}`,departure:'2026-11-02',due:'2026-11-25',status:'en_cours'}))};
for(const failed of [false,true])test(`monthly tower exact count and independent tool error=${failed}`,async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'});const previous={window:globalThis.window,document:globalThis.document,navigator:globalThis.navigator,fetch:globalThis.fetch};Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});Object.defineProperty(globalThis,'navigator',{configurable:true,value:dom.window.navigator});
 globalThis.fetch=async path=>{
  if(path==='/api/auth/me')return Response.json({user:{id:1,email:'a@test.invalid',prenom:'A',nom:'Prime',role:'prime',is_active:true}});
  if(path==='/api/control-tower')return Response.json(summary);
  if(path==='/api/tool-activity')return failed?Response.json({error:'Tools offline'},{status:503}):Response.json({recent:[{module:'onboarding',id:88,title:'Dossier récent',clientName:'Alpha',clientId:2,openedAt:'2026-11-20T12:00:00Z',href:'/procedures/prise-en-charge?dossier=88'}],recentHasMore:false,active:[],activeTotal:0,activeHasMore:false,limit:6});
  if(path==='/api/primes')return Response.json({primes:[]});if(path==='/api/clients')return Response.json({clients:[]});if(path==='/api/suivis')return Response.json({suivis:[]});throw Error(path);
 };
 const root=createRoot(document.getElementById('root'));
 try{await act(async()=>root.render(React.createElement(MemoryRouter,null,React.createElement(pages.AuthProvider,null,React.createElement(pages.Dashboard)))));
  assert.match(document.body.textContent,/Suivis prioritaires dans le prochain mois/);assert.match(document.body.textContent,/2026-11-01.*2026-11-30/);assert.match(document.body.textContent,/mois civil en cours/);assert.match(document.body.textContent,/8 tâches/);
  assert.match(document.body.textContent,/Date de départ/);assert.match(document.body.textContent,/Automatique/);
  if(failed){assert.match(document.body.textContent,/Tools offline/);assert.doesNotMatch(document.body.textContent,/Aucun dossier récent/);}else assert.equal(document.querySelector('a[href="/procedures/prise-en-charge?dossier=88"]')!==null,true);
 }finally{await act(async()=>root.unmount());dom.window.close();Object.assign(globalThis,{window:previous.window,document:previous.document,fetch:previous.fetch});Object.defineProperty(globalThis,'navigator',{configurable:true,value:previous.navigator});}
});
