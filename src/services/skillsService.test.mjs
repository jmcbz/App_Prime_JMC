import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {build} from 'esbuild';
const file='/tmp/prime-skills-service-test.mjs';
await build({entryPoints:['src/services/skillsService.ts'],bundle:true,platform:'node',format:'esm',outfile:file});
const service=await import(file);
test('reject malformed matrix rows rather than render unknown or crash',async()=>{
 const good={specialties:[],competences:[],primes:[],evaluations:[],canEdit:false,availabilityAt:new Date().toISOString()};
 const original=global.fetch;
 try{
  global.fetch=async()=>({ok:true,json:async()=>good});assert.deepEqual(await service.loadSkills(),good);
  for(const data of [{...good,primes:[null]},{...good,evaluations:[{primeId:1,competenceId:'x',level:0,version:1,updatedAt:'bad'}]},{...good,competences:[{id:'x',name:'Test',archived:'false',version:1}]}]){
   global.fetch=async()=>({ok:true,json:async()=>data});await assert.rejects(service.loadSkills(),/invalide/);
  }
 }finally{global.fetch=original;fs.unlinkSync(file);}
});
test('preserve definitive API rejection status for recoverable editor errors',async()=>{
 const original=global.fetch;
 try{for(const status of [400,409,503]){
  global.fetch=async()=>({ok:false,status,json:async()=>({error:'fixture rejection'})});
  await assert.rejects(service.skillsRequest('/competences/test',{}),e=>e instanceof service.SkillsApiError&&e.status===status&&e.message==='fixture rejection');
 }}finally{global.fetch=original;}
});
