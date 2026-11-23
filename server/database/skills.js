import {withSqliteOwner} from './sqlite-isolation.js';
import {randomUUID} from 'node:crypto';
import {loadLock,reconcilePg,reconcileSqlite} from './monthly-load.js';
import {currentSessionActor} from '../session-policy.js';
export const INITIAL_SKILLS=['M365','Entra / identités','Windows / postes','Serveurs / virtualisation','Réseaux / WiFi','Fortinet','Sauvegarde / restauration','Cybersécurité','Cloud','Automatisation / intégrations','Documentation / support'];
export const skillsSchema=pg=>`CREATE TABLE IF NOT EXISTS prime_competences (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)), version INTEGER NOT NULL DEFAULT 1 CHECK(version>0)
); CREATE TABLE IF NOT EXISTS prime_evaluations (
 id TEXT PRIMARY KEY, prime_id INTEGER NOT NULL REFERENCES primes(id) ON DELETE RESTRICT,
 competence_id TEXT NOT NULL REFERENCES prime_competences(id) ON DELETE RESTRICT,
 level INTEGER CHECK(level BETWEEN 1 AND 4), version INTEGER NOT NULL CHECK(version>0), updated_at TEXT NOT NULL,
 updated_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT
); CREATE TABLE IF NOT EXISTS prime_competence_aliases (
 id TEXT PRIMARY KEY, competence_id TEXT NOT NULL REFERENCES prime_competences(id) ON DELETE RESTRICT
);`;
export const specialtyKey=label=>label.trim().normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/\s+/g,' ');
// Raw profile tags remain authoritative for membership and original spelling.
// Stable aliases keep old spellings linked after a catalogue rename.
function* ensureTags(tags){
 if(!Array.isArray(tags)||tags.length>100||tags.some(s=>typeof s!=='string'||!s.trim()||s.trim().length>100))fail(400,'Spécialités : maximum 100 libellés de 1 à 100 caractères');
 for(const label of tags){
  const key=specialtyKey(label);
  const found=(yield ['SELECT c.* FROM prime_competence_aliases a JOIN prime_competences c ON c.id=a.competence_id WHERE a.id=?',[key]])[0];
  if(found){
   if(found.archived)yield ['UPDATE prime_competences SET archived=0,version=version+1 WHERE id=?',[found.id]];
  }else{
   const count=Number((yield ['SELECT COUNT(*) AS n FROM prime_competences',[]])[0].n);
   if(count>=100)fail(409,'Limite de 100 compétences : spécialité non ajoutée; aucun changement enregistré.');
   if(Number((yield ['SELECT COUNT(*) AS n FROM prime_competence_aliases',[]])[0].n)>=1000)fail(409,'Limite de 1000 libellés historiques atteinte; spécialité non ajoutée.');
   const id=randomUUID();
   yield ['INSERT INTO prime_competences(id,name,archived,version) VALUES (?,?,0,1)',[id,label.trim()]];
   yield ['INSERT INTO prime_competence_aliases(id,competence_id) VALUES (?,?)',[key,id]];
  }
 }
}
export async function ensureSpecialties(q,tags){const it=ensureTags(tags);let step=it.next();while(!step.done)step=it.next(await q(...step.value));}
export function ensureSpecialtiesSqlite(sqlite,tags){const it=ensureTags(tags);let step=it.next();while(!step.done){const [sql,args]=step.value,s=sqlite.prepare(sql);step=it.next(s.reader?s.all(...args):(s.run(...args),[]));}}
export async function seedSkills(q){
 for(const [i,name] of INITIAL_SKILLS.entries())await q('INSERT INTO prime_competences(id,name) VALUES (?,?) ON CONFLICT(id) DO NOTHING',[`ti-${i+1}`,name]);
 for(const c of await q('SELECT id,name FROM prime_competences'))await q('INSERT INTO prime_competence_aliases(id,competence_id) VALUES (?,?) ON CONFLICT(id) DO NOTHING',[specialtyKey(c.name),c.id]);
}
export async function importSpecialties(q){for(const row of await q('SELECT data FROM primes ORDER BY id')){const d=typeof row.data==='string'?JSON.parse(row.data):row.data;await ensureSpecialties(q,d.specialites??[]);}}
export function importSpecialtiesSqlite(sqlite){
 for(const c of sqlite.prepare('SELECT id,name FROM prime_competences').all())sqlite.prepare('INSERT INTO prime_competence_aliases(id,competence_id) VALUES (?,?) ON CONFLICT(id) DO NOTHING').run(specialtyKey(c.name),c.id);
 for(const row of sqlite.prepare('SELECT data FROM primes ORDER BY id').all())ensureSpecialtiesSqlite(sqlite,JSON.parse(row.data).specialites??[]);
}
const fail=(statusCode,message)=>{throw Object.assign(new Error(message),{statusCode});};
export function adapter(driver,connection){return async(sql,args=[])=>{
 if(driver.kind==='pg'){let i=0;return (await connection.query(sql.replace(/\?/g,()=>`$${++i}`),args)).rows;}
 const stmt=driver.sqlite.prepare(sql);return stmt.reader?stmt.all(...args):(stmt.run(...args),[]);
};}
async function lockedActor(q,actor,pg){
 // Business gate, user, then MFA. SHARE locks hold identity until commit.
 // SQLite's IMMEDIATE transaction provides the same exclusion for writers.
 const lock=pg?' FOR SHARE':'';
 const user=(await q(`SELECT id,email,role,is_active FROM users WHERE id=?${lock}`,[actor.sub]))[0];
 const mfa=(await q(`SELECT mfa_enabled,secret_encrypted FROM user_mfa WHERE user_id=?${lock}`,[actor.sub]))[0];
 const current=currentSessionActor(actor,user,mfa);
 if(!current)fail(401,'Session invalide ou révoquée');
 return current;
}
async function transaction(driver,actor,fn){
 if(driver.kind==='sqlite')return withSqliteOwner(async()=>{driver.sqlite.exec('BEGIN IMMEDIATE');try{const q=adapter(driver),current=await lockedActor(q,actor,false);const result=await fn(q,current);driver.sqlite.exec('COMMIT');return result;}catch(e){driver.sqlite.exec('ROLLBACK');throw e;}});
 const tx=await driver.pool.connect();try{await tx.query('BEGIN');await loadLock(tx);const q=adapter(driver,tx),current=await lockedActor(q,actor,true);const result=await fn(q,current,tx);await tx.query('COMMIT');return result;}catch(e){await tx.query('ROLLBACK');throw e;}finally{tx.release();}
}
function checkWrite(actor,body,keys){
 if(actor.role!=='admin')fail(403,'Accès réservé aux administrateurs');
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!keys.includes(k)))fail(400,'Données invalides');
 if(!Number.isSafeInteger(body.expectedVersion)||body.expectedVersion<0)fail(400,'Version attendue invalide');
}
function checkId(id){if(typeof id!=='string'||!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id))fail(400,'Identifiant de compétence invalide');}

async function specialtiesFor(q,pg,scope='1=1',args=[]){
 const rows=await q(`SELECT p.id,${pg?"p.data->'specialites'":"json_extract(p.data,'$.specialites')"} AS tags FROM primes p WHERE ${scope} ORDER BY p.id LIMIT 101`,args);
 if(rows.length>100)fail(413,'Matrice limitée à 100 Primes; aucune ligne tronquée');
 const aliases=await q('SELECT id,competence_id FROM prime_competence_aliases LIMIT 1001');
 if(aliases.length>1000)fail(413,'Catalogue trop volumineux');
 const byKey=new Map(aliases.map(a=>[a.id,a.competence_id])),links=[];
 for(const row of rows){const tags=typeof row.tags==='string'?JSON.parse(row.tags):row.tags;
  if(!Array.isArray(tags)||tags.length>100)fail(413,'Spécialités invalides ou trop volumineuses');
  for(const label of tags){
   if(typeof label!=='string'||label.length>100)fail(413,'Spécialité trop volumineuse');
   const competenceId=byKey.get(specialtyKey(label));
   if(!competenceId)fail(409,'Spécialité non liée au catalogue. Une migration est requise.');
   links.push({primeId:row.id,competenceId,label});
  }
 }
 return links;
}
export async function saveCompetence(driver,actor,id,body){
 checkWrite(actor,body,['name','archived','expectedVersion']);checkId(id);
 if(typeof body.name!=='string'||!body.name.trim()||body.name.trim().length>100||typeof body.archived!=='boolean')fail(400,'Nom (1 à 100 caractères) et état requis');
 return transaction(driver,actor,async(q,current)=>{
  if(current.role!=='admin')fail(403,'Accès réservé aux administrateurs');
  const old=(await q('SELECT * FROM prime_competences WHERE id=?',[id]))[0];
  if((old?.version??0)!==body.expectedVersion)fail(409,'Compétence modifiée. Rechargez avant de réessayer.');
  const name=body.name.trim(),archived=Number(body.archived),version=body.expectedVersion+1;
  const key=specialtyKey(name),alias=(await q('SELECT competence_id FROM prime_competence_aliases WHERE id=?',[key]))[0];
  if(alias&&alias.competence_id!==id)fail(409,'Cette compétence existe déjà (casse et accents ignorés). Utilisez la compétence existante.');
  if(!alias&&Number((await q('SELECT COUNT(*) AS n FROM prime_competence_aliases'))[0].n)>=1000)fail(409,'Limite de 1000 libellés historiques atteinte');
  if(archived&&(await specialtiesFor(q,driver.kind==='pg')).some(s=>s.competenceId===id))fail(409,'Compétence encore présente dans les spécialités d’un Prime. Retirez d’abord cette spécialité de sa fiche; ses évaluations seront conservées.');
  if(!old){
   if(Number((await q('SELECT COUNT(*) AS n FROM prime_competences'))[0].n)>=100)fail(409,'Limite de 100 compétences, archives comprises.');
   await q('INSERT INTO prime_competences(id,name,archived,version) VALUES (?,?,?,?)',[id,name,archived,version]);
  }else await q('UPDATE prime_competences SET name=?,archived=?,version=? WHERE id=?',[name,archived,version,id]);
  if(!alias)await q('INSERT INTO prime_competence_aliases(id,competence_id) VALUES (?,?)',[key,id]);
  return {competence:{id,name,archived:body.archived,version}};
 });
}
export async function saveEvaluation(driver,actor,primeId,id,body){
 checkWrite(actor,body,['level','expectedVersion']);checkId(id);
 if(!Number.isSafeInteger(primeId)||primeId<=0||!(body.level===null||Number.isInteger(body.level)&&body.level>=1&&body.level<=4))fail(400,'Prime ou niveau invalide');
 return transaction(driver,actor,async(q,current)=>{
  if(current.role!=='admin')fail(403,'Accès réservé aux administrateurs');
  if(!(await q('SELECT id FROM primes WHERE id=?',[primeId])).length)fail(404,'Prime introuvable');
  const competence=(await q('SELECT * FROM prime_competences WHERE id=?',[id]))[0];
  if(!competence)fail(404,'Compétence introuvable');
  if(competence.archived)fail(409,'Compétence archivée : évaluations conservées en lecture seule');
  const key=`${primeId}:${id}`,old=(await q('SELECT * FROM prime_evaluations WHERE id=?',[key]))[0];
  if((old?.version??0)!==body.expectedVersion)fail(409,'Évaluation modifiée. Rechargez avant de réessayer.');
  const version=body.expectedVersion+1,updatedAt=new Date().toISOString();
  await q(`INSERT INTO prime_evaluations(id,prime_id,competence_id,level,version,updated_at,updated_by) VALUES (?,?,?,?,?,?,?)
   ON CONFLICT(id) DO UPDATE SET level=excluded.level,version=excluded.version,updated_at=excluded.updated_at,updated_by=excluded.updated_by`,[key,primeId,id,body.level,version,updatedAt,actor.sub]);
  return {evaluation:{primeId,competenceId:id,level:body.level,version,updatedAt}};
 });
}
export async function matrix(driver,actor){return transaction(driver,actor,async(q,current,tx)=>{
 const scope="(?='admin' OR EXISTS(SELECT 1 FROM prime_user_links l WHERE l.user_id=? AND l.prime_id=p.id))",args=[current.role,current.sub];
 const count=Number((await q(`SELECT COUNT(*) AS n FROM primes p WHERE ${scope}`,args))[0].n);
 const competences=await q('SELECT id,name,archived,version FROM prime_competences ORDER BY name,id LIMIT 101');
 if(count>100||competences.length>100)fail(413,'Matrice trop volumineuse (100 Primes et 100 compétences maximum). Contactez un administrateur.');
 const evaluations=await q(`SELECT e.* FROM prime_evaluations e JOIN primes p ON p.id=e.prime_id WHERE ${scope} ORDER BY e.id LIMIT 10001`,args);
 if(evaluations.length>10000)fail(413,'Matrice trop volumineuse');
 const specialties=await specialtiesFor(q,driver.kind==='pg',scope,args);
 const allowed=new Set((await q(`SELECT p.id FROM primes p WHERE ${scope}`,args)).map(p=>p.id));
 const availabilityAt=new Date();
 const tower=driver.kind==='pg'?await reconcilePg(tx,availabilityAt):reconcileSqlite(driver.sqlite,availabilityAt);
 const primes=tower.primes.filter(p=>allowed.has(p.id)).map(p=>({id:p.id,nom:p.nom,disponibilite:p.effectiveAvailability,monthlyCount:p.monthlyCount}));
 const response={primes,availabilityAt:availabilityAt.toISOString(),specialties,competences:competences.map(s=>({...s,archived:s.archived===1})),evaluations:evaluations.map(e=>({primeId:e.prime_id,competenceId:e.competence_id,level:e.level,version:e.version,updatedAt:e.updated_at})),canEdit:current.role==='admin'};
 if(Buffer.byteLength(JSON.stringify(response))>2*1024*1024)fail(413,'Matrice trop volumineuse');
 return response;
});}
