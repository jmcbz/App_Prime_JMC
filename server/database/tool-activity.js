import {withSqliteOwner} from './sqlite-isolation.js';
import {loadLock} from './monthly-load.js';
import {provenClientSql} from './client-onboardings.js';
export const activitySchema=pg=>`CREATE TABLE IF NOT EXISTS tool_open_activity (
 id ${pg?'SERIAL PRIMARY KEY':'INTEGER PRIMARY KEY AUTOINCREMENT'},
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 module TEXT NOT NULL CHECK(module IN ('onboarding','workstation')),
 dossier_id INTEGER NOT NULL, opened_at TEXT NOT NULL,
 UNIQUE(user_id,module,dossier_id)
); CREATE INDEX IF NOT EXISTS idx_tool_activity_user ON tool_open_activity(user_id,opened_at);`;
const fail=(code,message)=>{throw Object.assign(new Error(message),{statusCode:code});};
const positive=value=>Number.isSafeInteger(value)&&value>0;
function adapter(driver,connection){
 return async(sql,args=[])=>{
  if(driver.kind==='pg'){let n=0;return (await connection.query(sql.replace(/\?/g,()=>`$${++n}`),args)).rows;}
  const stmt=driver.sqlite.prepare(sql);return stmt.reader?stmt.all(...args):(stmt.run(...args),[]);
 };
}
async function transaction(driver,fn){
 if(driver.kind==='sqlite')return withSqliteOwner(async()=>{
  driver.sqlite.exec('BEGIN IMMEDIATE');try{const result=await fn(adapter(driver));driver.sqlite.exec('COMMIT');return result;}catch(e){driver.sqlite.exec('ROLLBACK');throw e;}
 });
 const tx=await driver.pool.connect();try{await tx.query('BEGIN');await loadLock(tx);const result=await fn(adapter(driver,tx));await tx.query('COMMIT');return result;}catch(e){await tx.query('ROLLBACK');throw e;}finally{tx.release();}
}
export async function recordOpen(driver,actor,module,id){
 if(!['onboarding','workstation'].includes(module)||!positive(id))fail(400,'Dossier invalide');
 return transaction(driver,async q=>{
  const pg=driver.kind==='pg';
  // Onboarding intentionally has broader read rights than the personal feed.
  const sql=module==='onboarding'
   ? `SELECT o.id FROM client_onboardings o JOIN clients c ON c.id=o.client_id JOIN primes p ON p.id=c.prime_id WHERE o.id=? AND ${provenClientSql(pg)}`
   : `SELECT d.id FROM workstation_dossiers d JOIN clients c ON c.id=d.client_id WHERE d.id=? AND d.deleted_at IS NULL AND (?='admin' OR EXISTS(SELECT 1 FROM prime_user_links l WHERE l.user_id=? AND l.prime_id=c.prime_id))`;
  if(!(await q(sql,module==='onboarding'?[id]:[id,actor.role,actor.sub])).length)fail(404,'Dossier introuvable');
  const openedAt=new Date().toISOString();
  await q(`INSERT INTO tool_open_activity(user_id,module,dossier_id,opened_at) VALUES (?,?,?,?)
   ON CONFLICT(user_id,module,dossier_id) DO UPDATE SET opened_at=excluded.opened_at`,[actor.sub,module,id,openedAt]);
  return {recorded:true,module,id,openedAt};
 });
}
function eligibleSql(pg){
 const name=pg?"c.data->>'nom'":"json_extract(c.data,'$.nom')";
 const todo=pg?`EXISTS(SELECT 1 FROM jsonb_array_elements(d.sections) section, jsonb_array_elements(section->'steps') step WHERE step->>'etat'='todo')`:
 `EXISTS(SELECT 1 FROM json_each(d.sections) section,json_each(json_extract(section.value,'$.steps')) step WHERE json_extract(step.value,'$.etat')='todo')`;
 return `SELECT o.id,'onboarding' AS module,o.client_id,${name} AS client_name,o.titre AS title,
 CASE WHEN o.archived=${pg?'false':'0'} AND o.statut IN ('À faire','En cours','Bloqué') THEN 1 ELSE 0 END AS active
 FROM client_onboardings o JOIN clients c ON c.id=o.client_id JOIN primes p ON p.id=c.prime_id
 WHERE ${provenClientSql(pg)} AND (?='admin' OR EXISTS(SELECT 1 FROM prime_user_links l WHERE l.user_id=? AND l.prime_id=c.prime_id))
 UNION ALL
 SELECT d.id,'workstation',d.client_id,${name},'Poste ' || CASE WHEN d.computer='' THEN '#' || d.id ELSE d.computer END,
 CASE WHEN d.archived_at IS NULL AND ${todo} THEN 1 ELSE 0 END
 FROM workstation_dossiers d JOIN clients c ON c.id=d.client_id WHERE d.deleted_at IS NULL
 AND (?='admin' OR EXISTS(SELECT 1 FROM prime_user_links l WHERE l.user_id=? AND l.prime_id=c.prime_id))`;
}
const item=row=>({id:row.id,module:row.module,clientId:row.client_id,clientName:row.client_name,title:row.title,openedAt:row.opened_at??null,
 href:`/procedures/${row.module==='onboarding'?'prise-en-charge':'installation-postes'}?dossier=${row.id}`});
export async function feed(driver,actor){
 return transaction(driver,async q=>{
  const eligible=eligibleSql(driver.kind==='pg'),scope=[actor.role,actor.sub,actor.role,actor.sub],limit=6;
  const recent=await q(`WITH eligible AS (${eligible}) SELECT e.*,a.opened_at FROM eligible e JOIN tool_open_activity a ON a.module=e.module AND a.dossier_id=e.id
   WHERE a.user_id=? ORDER BY a.opened_at DESC,a.id DESC LIMIT ?`,[...scope,actor.sub,limit+1]);
  const active=await q(`WITH eligible AS (${eligible}) SELECT * FROM eligible WHERE active=1 ORDER BY client_name,module,id DESC LIMIT ?`,[...scope,limit]);
  const total=await q(`WITH eligible AS (${eligible}) SELECT COUNT(*) AS n FROM eligible WHERE active=1`,scope);
  return {recent:recent.slice(0,limit).map(item),recentHasMore:recent.length>limit,active:active.map(item),activeTotal:Number(total[0].n),activeHasMore:Number(total[0].n)>limit,limit};
 });
}
