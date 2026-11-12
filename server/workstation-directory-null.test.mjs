import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {randomUUID} from 'node:crypto';
import * as procedures from './database/workstation-procedures.js';

test('legacy NULL portfolio links never authorize unassigned directory clients',async()=>{
 const sqlite=new Database(':memory:'),driver={kind:'sqlite',sqlite};
 // Deliberately emulate a legacy nullable link, unlike the current NOT NULL DDL.
 sqlite.exec('CREATE TABLE clients(id INTEGER PRIMARY KEY,prime_id INTEGER,data TEXT); CREATE TABLE prime_user_links(user_id INTEGER,prime_id INTEGER);');
 sqlite.prepare('INSERT INTO clients VALUES(1,NULL,?)').run(JSON.stringify({nom:'Unassigned TI',clientType:'ti'}));
 sqlite.exec('INSERT INTO prime_user_links VALUES(1,NULL)');
 procedures.migrateSqlite(sqlite);
 const admin={role:'admin',sub:10},prime={role:'prime',sub:1};
 const payload={requestKey:randomUUID(),clientId:1,name:'Unassigned',sections:[{title:'Section',steps:[{id:'s',title:'Check',note:''}]}]};
 try{
  const {template}=await procedures.createTemplate(driver,admin,payload);
  await assert.rejects(procedures.createTemplate(driver,prime,{...payload,requestKey:randomUUID()}),e=>e.statusCode===404);
  await assert.rejects(procedures.reconcileTemplate(driver,prime,payload.requestKey),e=>e.statusCode===404);
  await assert.rejects(procedures.updateTemplate(driver,prime,template.id,{...payload,expectedVersion:1}),e=>e.statusCode===404);
  assert.ok(!(await procedures.listTemplates(driver,prime,{})).templates.some(t=>t.id===template.id));
  await assert.rejects(procedures.auditSource(driver,prime,{clientId:'1',templateId:String(template.id)}),e=>e.statusCode===404);
  assert.equal((await procedures.auditSource(driver,admin,{clientId:'1',templateId:String(template.id)})).client.id,1);
  const dp={requestKey:randomUUID(),clientId:1,templateId:template.id,employee:'E',computer:'PC',ticket:'T',date:'2026-11-12'};
  const {dossier}=await procedures.createDossier(driver,admin,dp);
  await assert.rejects(procedures.createDossier(driver,prime,{...dp,requestKey:randomUUID()}),e=>e.statusCode===404);
  await assert.rejects(procedures.getDossier(driver,prime,dossier.id),e=>e.statusCode===404);
  await assert.rejects(procedures.auditDossierSource(driver,prime,String(dossier.id)),e=>e.statusCode===404);
  assert.equal((await procedures.listDossiers(driver,prime,{})).dossiers.length,0);
 }finally{sqlite.close();}
});
