import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
assert.equal(process.env.SKILLS_FIXTURE,'1');
assert.equal(fs.existsSync('/proc/1/root/root/.hermes'),false);
const pg=process.env.SKILLS_PG==='1';
if(pg)assert.equal(process.env.DATABASE_URL,'postgresql://postgres@localhost/skills?host=/tmp/pg&sslmode=disable');
else{delete process.env.DATABASE_URL;process.env.SQLITE_PATH='/tmp/migration.sqlite';}
process.env.APP_PRIME_ALLOW_NEW_DATABASE='1';
test('additive upgrade preserves populated baseline, MFA and foreign schema rejection',async()=>{
 const old=await import('/evidence/baseline/server/database/index.js');
 const driver=await old.initDb();
 const q=driver.kind==='pg'?async(sql,args=[])=>{let i=0;return (await driver.pool.query(sql.replace(/\?/g,()=>`$${++i}`),args)).rows;}:async(sql,args=[])=>{const s=driver.sqlite.prepare(sql);return s.reader?s.all(...args):(s.run(...args),[]);};
 let next;
 try{
  const user=await old.createUserWithPrime({email:'preserve@example.invalid',passwordHash:'sentinel-hash',prenom:'Avant',nom:'Migration',role:'admin'});
  await old.updatePrime(user.prime.id,{...user.prime,specialites:['M365','Power Automate','Gouvernance TI']});
  await old.upsertMfaPending(user.user.id,'sentinel-ciphertext');await old.enableMfa(user.user.id);
  const client=await old.createClient({nom:'Client avant',primeId:user.prime.id});
  await old.createSuivi({titre:'Historique avant',clientId:client.id,primeId:user.prime.id});
  const tables=['users','user_mfa','primes','clients','suivis','prime_user_links','tableaux_suivi','tableau_rubriques'];
  const snap=async()=>Object.fromEntries(await Promise.all(tables.map(async t=>[t,await q(`SELECT * FROM ${t}`)])));
  const before=await snap();
  const current=await import('./database/index.js');next=await current.initDb();
  assert.deepEqual(await snap(),before);
  assert.equal(Number((await q('SELECT COUNT(*) AS n FROM prime_competences'))[0].n),13);
  assert.equal(Number((await q('SELECT COUNT(*) AS n FROM prime_evaluations'))[0].n),0);
  const {checkPgMetierIdentity,checkSqliteMetierIdentity,migratePgMetier}=await import('./database/metier-migration.js');
  await q('CREATE TABLE foreign_sentinel (id INTEGER PRIMARY KEY, value TEXT)');
  await q("INSERT INTO foreign_sentinel VALUES (1,'do not touch')");
  if(pg)await assert.rejects(migratePgMetier(driver.pool,()=>{throw Error('must not get here');}),/étranger/);
  else assert.throws(()=>checkSqliteMetierIdentity(driver.sqlite),/étranger/);
  assert.deepEqual(await q('SELECT * FROM foreign_sentinel'),[{id:1,value:'do not touch'}]);
  assert.deepEqual(await snap(),before);
  await q('DROP TABLE foreign_sentinel');
  // Identity must inspect new FKs, not merely table names.
  if(pg){
   await q('ALTER TABLE prime_evaluations DROP CONSTRAINT prime_evaluations_competence_id_fkey');
   await assert.rejects(checkPgMetierIdentity(driver.pool),/clé étrangère/);
  }else{
   await q('ALTER TABLE prime_evaluations RENAME TO broken_evaluations');
   await q('CREATE TABLE prime_evaluations (id TEXT PRIMARY KEY,prime_id INTEGER,competence_id TEXT,level INTEGER,version INTEGER,updated_at TEXT,updated_by INTEGER)');
   await q('DROP TABLE broken_evaluations');
   assert.throws(()=>checkSqliteMetierIdentity(driver.sqlite),/étrangère/);
  }
  console.log('PASS baseline data and MFA byte-equivalent; additive empty evaluations; foreign schema/FK rejection');
 }finally{if(driver.pool)await driver.pool.end();if(next?.pool)await next.pool.end();}
});
