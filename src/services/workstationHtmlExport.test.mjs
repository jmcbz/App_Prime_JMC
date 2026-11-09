import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const outfile = new URL('./.workstation-html-export-test.mjs', import.meta.url).pathname;
let generateWorkstationProcedureHtml;
try {
  await build({ entryPoints: [new URL('./workstationHtmlExport.ts', import.meta.url).pathname], outfile, bundle: true, platform: 'node', format: 'esm' });
  ({ generateWorkstationProcedureHtml } = await import(outfile));
} finally { try { unlinkSync(outfile); } catch {} }

const template = {id:3,clientId:2,name:'Installation — Équipe TI',version:1,sections:[{title:'Préparation',steps:[{id:'a',title:'Clavier français',note:'Vérifier é et à'}]}]};
const dossier = {id:11,clientId:2,clientName:'Acme TI',templateId:3,employee:'Élodie',computer:'PC-01',ticket:'INC-123',date:'2026-11-09',version:2,archivedAt:null,sections:[{title:'Préparation',steps:[{id:'a',title:'Clavier français',note:'Vérifier é et à',etat:'fait',commentaire:'Terminé à Montréal'},{id:'b',title:'VPN',note:'',etat:'todo',commentaire:''},{id:'c',title:'Sans objet',note:'',etat:'na',commentaire:'Non requis'}]}]};
const modelSource = () => ({kind:'template',clientName:'Acme TI',template});
const dossierSource = () => ({kind:'dossier',dossier});
const render = source => { const html=generateWorkstationProcedureHtml(source); return {html,document:new JSDOM(html).window.document}; };

test('selected authorized model renders without invented completion or dossier metadata', () => {
  const {html,document}=render(modelSource());
  assert.match(html,/^<!doctype html><html lang="fr-CA">/i);
  assert.match(document.body.textContent,/Acme TI.*Installation — Équipe TI/s);
  assert.match(document.body.textContent,/Préparation.*Clavier français.*Vérifier é et à/s);
  assert.match(document.body.textContent,/Modèle.*statut non renseigné/s);
  assert.doesNotMatch(document.body.textContent,/Élodie|INC-123|0\s*\/\s*1|Terminé/);
  assert.equal(document.querySelectorAll('.step-status').length,0);
});

test('saved dossier renders exact statuses, comments and applicable progress', () => {
  const {html,document}=render(dossierSource());
  assert.match(document.body.textContent,/Élodie.*PC-01.*INC-123.*2026-11-09/s);
  assert.match(document.body.textContent,/1 \/ 2 étapes applicables terminées/);
  assert.deepEqual([...document.querySelectorAll('.step-status')].map(x=>x.textContent),['Fait','À faire','N/A']);
  assert.match(document.body.textContent,/Terminé à Montréal.*Non requis/s);
  assert.match(html,/@page\s*\{\s*size:\s*letter/i);
  assert.match(html,/@media print/);
  assert.match(html,/print-color-adjust/);
  assert.equal(document.querySelectorAll('[id]').length,0);
});

test('all N/A steps produce an honest zero-applicable denominator', () => {
  const source=dossierSource();
  source.dossier={...dossier,sections:[{title:'Hors portée',steps:[{...dossier.sections[0].steps[2]}]}]};
  const {html,document}=render(source);
  assert.match(document.body.textContent,/0 \/ 0 étapes applicables terminées/);
  assert.match(html,/style="width:0%"/);
  assert.doesNotMatch(html,/NaN|Infinity/);
});

test('all supplied text is escaped in text and attributes; no executable or remote resource', () => {
  const attack='"><img src=x onerror=alert(1)><script>alert(2)</script>& É';
  const source=dossierSource();
  source.dossier={...dossier,clientName:attack,employee:attack,computer:attack,ticket:attack,date:attack,sections:[{title:attack,steps:[{id:attack,title:attack,note:attack,etat:'fait',commentaire:attack}]}]};
  const {html,document}=render(source);
  assert.equal(document.querySelectorAll('script,img,iframe,object,embed,form,button,input,textarea,select,link,style[src]').length,0);
  assert.equal(document.querySelectorAll('[onerror],[onclick],[src],[href]').length,0);
  assert.doesNotMatch(html,/<script|<img|<\/html><script/i);
  assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(document.body.textContent,/<img src=x onerror=alert\(1\)>/);
  assert.doesNotMatch(html,/https?:\/\/|@import|url\(/i);
});

test('template metadata and section text are escaped too', () => {
  const source=modelSource(); const attack='</title><script>evil()</script>" &';
  source.clientName=attack; source.template={...template,name:attack,sections:[{title:attack,steps:[{id:'x',title:attack,note:attack}]}]};
  const {html,document}=render(source);
  assert.equal(document.querySelectorAll('script').length,0);
  assert.equal(document.title.includes(attack),true);
  assert.doesNotMatch(html,/<script>|<\/title><script>/);
});

test('does not mutate source snapshot or retain live references', () => {
  const source=dossierSource(); const original=structuredClone(source);
  const first=generateWorkstationProcedureHtml(source);
  assert.deepEqual(source,original);
  source.dossier.sections[0].steps[0].title='Changed later';
  assert.match(first,/Clavier français/);
  assert.doesNotMatch(first,/Changed later/);
});

test('rejects missing client and invalid status instead of presenting forged data', () => {
  const source=modelSource(); source.clientName='  ';
  assert.throws(()=>generateWorkstationProcedureHtml(source),/source|client|invalide/i);
  const saved=dossierSource(); saved.dossier={...dossier,sections:[{title:'X',steps:[{...dossier.sections[0].steps[0],etat:'done'}]}]};
  assert.throws(()=>generateWorkstationProcedureHtml(saved),/source|statut|invalide/i);
});
