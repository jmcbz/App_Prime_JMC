import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

// Same contract runs through the production auth/router on both real databases.
export async function directoryContract({db,auth,request,tokens,token,admin,a,b,sections}) {
 const base='/api/workstation-procedures';
 const orphan=await db.createUser({email:'directory-orphan@test.invalid',passwordHash:'dummy',role:'prime'});
 tokens.orphan=await token(orphan);
 tokens.forged=auth.issueSessionToken({...a.user,role:'admin'},await db.getMfaByUserId(a.user.id)); // live account, not JWT role, is authoritative
 const clients=[];
 for(const primeId of [a.prime.id,b.prime.id,null])for(const clientType of ['ti','telecom',null]){
  clients.push(await db.createClient({nom:`Directory ${primeId}-${clientType}`,primeId,clientType}));
 }
 const global=(await request('GET',base+'/templates/standard','admin')).body.template;
 const before=(await request('GET','/api/clients','admin')).body.clients;
 for(const c of clients){
  const owner=c.primeId===a.prime.id?'a':c.primeId===b.prime.id?'b':'admin';
  const key=randomUUID(),payload={requestKey:key,clientId:c.id,name:'Directory procedure '+c.id,sections};
  const created=await request('POST',base+'/templates',owner,payload);
  assert.equal(created.status,201,`visible directory client ${c.id} (${c.clientType}/${c.primeId}) must support saving: ${JSON.stringify(created)}`);
  const t=created.body.template;
  assert.equal((await request('POST',base+'/templates',owner,payload)).body.template.id,t.id);
  assert.equal((await request('GET',base+'/templates/by-request/'+key,owner)).body.template.id,t.id);
  assert.equal((await request('PUT',base+'/templates/'+t.id,owner,{expectedVersion:1,name:t.name,sections})).status,200);
  assert.equal((await request('PUT',base+'/templates/'+t.id,owner,{expectedVersion:1,name:t.name,sections})).status,409);
  const dkey=randomUUID(), dp={requestKey:dkey,clientId:c.id,templateId:t.id,employee:'Directory',computer:'PC',ticket:'D',date:'2026-11-12'};
  const dr=await request('POST',base+'/dossiers',owner,dp);assert.equal(dr.status,201,JSON.stringify(dr));const d=dr.body.dossier;
  for(const who of ['admin','a','b','orphan','forged']){
   const directory=(await request('GET','/api/clients',who)).body.clients;
   const visible=directory.some(v=>v.id===c.id),status=visible?200:404;
   assert.equal((await request('GET',base+'/audit-source?clientId='+c.id+'&templateId='+global.id,who)).status,status,who+' global source '+c.id);
   assert.equal((await request('GET',base+'/audit-source?clientId='+c.id+'&templateId='+t.id,who)).status,status,who+' source '+c.id);
   assert.equal((await request('GET',base+'/audit-source/dossier/'+d.id,who)).status,status,who+' snapshot '+c.id);
   assert.equal((await request('GET',base+'/dossiers/'+d.id,who)).status,status);
   assert.equal((await request('GET',base+'/templates',who)).body.templates.some(x=>x.id===t.id),visible);
   assert.equal((await request('GET',base+'/dossiers',who)).body.dossiers.some(x=>x.id===d.id),visible);
   if(!visible){
    assert.equal((await request('POST',base+'/templates',who,{...payload,requestKey:randomUUID()})).status,404);
    assert.equal((await request('POST',base+'/templates',who,payload)).status,404);
    assert.equal((await request('GET',base+'/templates/by-request/'+key,who)).status,404);
    assert.equal((await request('PUT',base+'/templates/'+t.id,who,{expectedVersion:2,name:t.name,sections})).status,404);
    assert.equal((await request('POST',base+'/dossiers',who,dp)).status,404);
    assert.equal((await request('POST',base+'/dossiers',who,{...dp,requestKey:randomUUID()})).status,404);
    assert.equal((await request('GET',base+'/dossiers/by-request/'+dkey,who)).status,404);
    assert.equal((await request('PUT',base+'/dossiers/'+d.id,who,{...d,expectedVersion:1})).status,404);
    assert.equal((await request('POST',base+'/dossiers/'+d.id+'/archive',who,{expectedVersion:1})).status,404);
   }
   if(who!=='admin')assert.equal((await request('DELETE',base+'/dossiers/'+d.id,who,{expectedVersion:1})).status,403);
  }
  assert.equal((await request('GET',base+'/dossiers/by-request/'+dkey,owner)).body.dossier.id,d.id);
  assert.equal((await request('PUT',base+'/dossiers/'+d.id,owner,{...d,expectedVersion:1})).status,200);
  assert.equal((await request('POST',base+'/dossiers/'+d.id+'/archive',owner,{expectedVersion:2})).status,200);
  assert.equal((await request('DELETE',base+'/dossiers/'+d.id,'admin',{expectedVersion:2})).status,409);
  assert.equal((await request('DELETE',base+'/dossiers/'+d.id,'admin',{expectedVersion:3})).status,200);
  assert.equal((await request('GET',base+'/dossiers/'+d.id,'admin')).status,404);
  assert.equal((await request('GET',base+'/audit-source/dossier/'+d.id,'admin')).status,404);
 }
 assert.deepEqual((await request('GET','/api/clients','admin')).body.clients,before,'procedures never reclassify or reassign clients');
 assert.equal((await request('GET',base+'/templates')).status,401);
}
