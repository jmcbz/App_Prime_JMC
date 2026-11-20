import test from 'node:test';import assert from 'node:assert/strict';import React,{act} from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router-dom';import {JSDOM} from 'jsdom';import {build} from 'esbuild';import {unlink} from 'node:fs/promises';
const out=new URL('./.dossier-link-test.mjs',import.meta.url).pathname;let Component;
try{await build({entryPoints:[new URL('./DossierDeepLink.tsx',import.meta.url).pathname],outfile:out,bundle:true,format:'esm',platform:'node',packages:'external',jsx:'automatic'});Component=(await import(out)).default;}finally{await unlink(out).catch(()=>{});}
test('direct dossier waits for verified readiness, validates ID and opens once',async()=>{
 const dom=new JSDOM('<div id="root"></div>');globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const root=createRoot(document.getElementById('root'));const opened=[],errors=[];const render=ready=>React.createElement(MemoryRouter,{initialEntries:['/procedures/prise-en-charge?dossier=88']},React.createElement(Component,{ready,onOpen:id=>opened.push(id),onError:e=>errors.push(e)}));
 try{await act(async()=>root.render(render(false)));assert.deepEqual(opened,[]);await act(async()=>root.render(render(true)));assert.deepEqual(opened,[88]);await act(async()=>root.render(render(true)));assert.deepEqual(opened,[88]);assert.deepEqual(errors,[]);}finally{await act(async()=>root.unmount());dom.window.close();}
});
