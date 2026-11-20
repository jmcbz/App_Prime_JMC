import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';
assert.equal(process.env.APP_PRIME_ISOLATED_TEST,'1');assert.equal(process.env.NODE_ENV,'test');assert(!fs.existsSync('/proc/1/root/root/.hermes'));assert(fs.existsSync('/proc/1/root/work/server/index.js'));
for(const n of ['net','mnt'])assert.notEqual(fs.readlinkSync(`/proc/self/ns/${n}`),process.env[`HOST_${n.toUpperCase()}`]);
assert.equal(process.env.DATABASE_URL,undefined);process.env.APP_PRIME_ALLOW_NEW_DATABASE='1';process.env.SQLITE_PATH=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'tools-')),'db.sqlite');
const db=await import('./database/index.js');const d=await db.initDb();
try{await test('real per-account recency, current portfolio focus, complete server selection and deleted dossier exclusion',async()=>{
 const a=await db.createUserWithPrime({email:'a@invalid.test',passwordHash:'fixture',prenom:'A'});const b=await db.createUserWithPrime({email:'b@invalid.test',passwordHash:'fixture',prenom:'B'});
 const actor={sub:a.user.id,role:'prime',email:a.user.email},other={sub:b.user.id,role:'prime',email:b.user.email};
 const c=await db.createClient({nom:'Own',primeId:a.prime.id});const foreign=await db.createClient({nom:'Other',primeId:b.prime.id});
 const standard=(await db.standardWorkstationTemplate()).template;
 const make=async clientId=>(await db.createWorkstationDossier(actor,{requestKey:randomUUID(),clientId,templateId:standard.id,employee:'User',computer:'PC',ticket:'T',date:'2026-01-01'})).dossier;
 const first=await make(c.id);for(let n=0;n<51;n++)await make(c.id);
 assert.equal((await db.toolFeed(actor)).recent.length,0,'no invented history from creation');
 await db.recordToolOpen(actor,'workstation',first.id);
 let feed=await db.toolFeed(actor);assert.equal(feed.recent[0].id,first.id,'old ID opened now is first');assert.equal(feed.activeTotal,52);assert.equal(feed.active.length,6);assert.equal(feed.activeHasMore,true);
 await assert.rejects(db.recordToolOpen(other,'workstation',first.id),/introuvable/i);
 assert.equal((await db.toolFeed(other)).recent.length,0);
 const on=await db.createClientOnboarding({client_id:foreign.id,technicien_id:null,titre:'Shared access',statut:'En cours',priorite:'Moyenne'},[],actor,randomUUID());
 await db.recordToolOpen(actor,'onboarding',on.id);assert.equal((await db.toolFeed(actor)).recent.some(x=>x.id===on.id&&x.module==='onboarding'),false,'personal focus does not change expanded module rights');
 await db.updateClient(c.id,{...c,primeId:b.prime.id},{primeId:a.prime.id,servoClientId:null});
 assert.equal((await db.toolFeed(actor)).recent.length,0,'transfer revalidates previous activity');
 await db.recordToolOpen(other,'workstation',first.id);assert.equal((await db.toolFeed(other)).recent.length,1);
 const workstation=await import('./database/workstation-procedures.js');await workstation.deleteDossier(d,{...other,role:'admin'},first.id,first.version);
 assert.equal((await db.toolFeed(other)).recent.length,0,'deleted content never returned');
});}finally{d.sqlite.close();}
