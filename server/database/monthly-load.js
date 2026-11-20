import { withSqliteOwner } from './sqlite-isolation.js';
export const TIME_ZONE = 'America/Toronto';
export function periodAt(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year:'numeric',month:'2-digit',day:'2-digit' }).formatToParts(now).map(p=>[p.type,p.value]));
  const key=`${parts.year}-${parts.month}`;
  const year=Number(parts.year),month=Number(parts.month);
  return {key,start:`${key}-01`,end:`${month===12?year+1:year}-${String(month===12?1:month+1).padStart(2,'0')}-01`,last:`${key}-${new Date(Date.UTC(year,month,0)).getUTCDate()}`,today:`${key}-${parts.day}`,timeZone:TIME_ZONE};
}
export const validDay = value => typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;
export const nextLoad = (count,previous=false) => count>5 ? true : count<5 ? false : previous;
export const effectiveAvailability = (manual,auto) => manual==='surcharge'?'surcharge':manual==='charge'||auto?'charge':'disponible';

// First lock of every load-affecting PG transaction, before client/portfolio locks.
export const loadLock = connection => connection.query('SELECT pg_advisory_xact_lock(176930415, 20261120)');
// Materialize the current month BEFORE changing tasks/ownership. Otherwise a
// first writer ending at five would inherit an unrelated previous-month flag.
// Call only inside the owning transaction; reuse the returned instant post-write.
export function beginLoadSqlite(sqlite) {
 const now=new Date();reconcileSqlite(sqlite,now);return now;
}
export async function beginLoadPg(connection) {
 await loadLock(connection);
 const now=new Date();await reconcilePg(connection,now);return now;
}
export const loadSchema = pg => `CREATE TABLE IF NOT EXISTS prime_monthly_load_state (
 prime_id INTEGER PRIMARY KEY REFERENCES primes(id) ON DELETE CASCADE,
 period_key TEXT NOT NULL, auto_charge INTEGER NOT NULL CHECK(auto_charge IN (0,1)),
 evaluated_at TEXT NOT NULL
);`;
const json = value => typeof value==='string'?JSON.parse(value):value;
const tasksSql = pg => {
 const field=(alias,key)=>pg?`${alias}.data->>'${key}'`:`json_extract(${alias}.data,'$.${key}')`;
 return `SELECT 'tableau:' || t.id || ':' || r.key AS id,'tableau' AS source,t.id AS board_id,r.key,
 c.id AS client_id,c.prime_id,${field('c','nom')} AS client_name,r.prochaine_action AS title,
 r.prochaine_action_debut AS departure,r.prochaine_action_echeance AS due,r.statut
 FROM tableaux_suivi t JOIN tableau_rubriques r ON r.tableau_id=t.id JOIN clients c ON c.id=t.client_id
 WHERE t.archived_at IS NULL AND r.statut IN ('a_faire','en_cours','bloque') AND TRIM(COALESCE(r.prochaine_action,''))<>''
 UNION ALL
 SELECT 'ancien:' || s.id,'ancien',s.id,NULL,c.id,
 CASE WHEN s.client_id IS NULL THEN s.prime_id ELSE c.prime_id END,${field('c','nom')},${field('s','titre')},NULL,
 CASE WHEN last.id IS NULL THEN ${field('s','echeance')} ELSE last.echeance END,
 CASE WHEN last.id IS NULL THEN COALESCE(${field('s','statut')},'a_faire') ELSE last.statut END
 FROM suivis s LEFT JOIN clients c ON c.id=s.client_id
 LEFT JOIN suivi_complements last ON last.id=(SELECT id FROM suivi_complements WHERE suivi_id=s.id ORDER BY id DESC LIMIT 1)
 WHERE (CASE WHEN last.id IS NULL THEN COALESCE(${field('s','statut')},'a_faire') ELSE last.statut END) IN ('a_faire','en_cours','bloque')`;
};
function snapshot(primeRows,taskRows,states,period) {
 const tasks=[...new Map(taskRows.filter(r=>validDay(r.due)&&r.due>=period.start&&r.due<period.end).map(r=>[r.id,{
  id:r.id,source:r.source,boardId:r.board_id,key:r.key,clientId:r.client_id,primeId:r.prime_id,clientName:r.client_name||'Sans client',
  title:r.title,departure:r.departure??null,due:r.due,status:r.statut,
 }])).values()].sort((a,b)=>a.due.localeCompare(b.due)||a.id.localeCompare(b.id));
 const counts=new Map();for(const task of tasks) counts.set(task.primeId,(counts.get(task.primeId)||0)+1);
 const primes=primeRows.map(row=>{
  const data=json(row.data),count=counts.get(row.id)||0;
  const auto=nextLoad(count,states.find(s=>s.prime_id===row.id)?.auto_charge===1);
  const manual=data.disponibilite||'disponible';
  return {id:row.id,nom:data.nom||'',codeTitan:data.codeTitan||'',specialites:Array.isArray(data.specialites)?data.specialites:[],avatarInitiales:data.avatarInitiales||'',manualAvailability:manual,autoCharge:auto,monthlyCount:count,effectiveAvailability:effectiveAvailability(manual,auto)};
 });
 return {period,tasks,primes};
}
export function reconcileSqlite(sqlite,now=new Date()) {
 const period=periodAt(now);
 const result=snapshot(sqlite.prepare('SELECT id,data FROM primes ORDER BY id').all(),sqlite.prepare(tasksSql(false)).all(),sqlite.prepare('SELECT * FROM prime_monthly_load_state').all(),period);
 const save=sqlite.prepare(`INSERT INTO prime_monthly_load_state(prime_id,period_key,auto_charge,evaluated_at) VALUES (?,?,?,?)
 ON CONFLICT(prime_id) DO UPDATE SET period_key=excluded.period_key,auto_charge=excluded.auto_charge,evaluated_at=excluded.evaluated_at`);
 for(const prime of result.primes)save.run(prime.id,period.key,Number(prime.autoCharge),now.toISOString());
 return result;
}
export async function reconcilePg(connection,now=new Date()) {
 const period=periodAt(now);
 const result=snapshot((await connection.query('SELECT id,data FROM primes ORDER BY id')).rows,(await connection.query(tasksSql(true))).rows,(await connection.query('SELECT * FROM prime_monthly_load_state')).rows,period);
 for(const prime of result.primes)await connection.query(`INSERT INTO prime_monthly_load_state(prime_id,period_key,auto_charge,evaluated_at) VALUES ($1,$2,$3,$4)
 ON CONFLICT(prime_id) DO UPDATE SET period_key=excluded.period_key,auto_charge=excluded.auto_charge,evaluated_at=excluded.evaluated_at`,[prime.id,period.key,Number(prime.autoCharge),now.toISOString()]);
 return result;
}
export async function readTower(driver,actor=null,now) {
 if(driver.kind==='sqlite') return withSqliteOwner(()=>driver.sqlite.transaction(()=>{
  const all=reconcileSqlite(driver.sqlite,now ?? new Date());
  const link=actor?.role==='admin'||!actor?null:driver.sqlite.prepare('SELECT prime_id FROM prime_user_links WHERE user_id=?').get(actor.sub);
  const clients=driver.sqlite.prepare('SELECT id,prime_id,data FROM clients').all();
  return scoped(all,actor,link,clients);
 }).immediate());
 const tx=await driver.pool.connect();
 try {
  await tx.query('BEGIN');await loadLock(tx);
  const all=await reconcilePg(tx,now ?? new Date());
  const link=actor?.role==='admin'||!actor?null:(await tx.query('SELECT prime_id FROM prime_user_links WHERE user_id=$1',[actor.sub])).rows[0];
  const clients=(await tx.query('SELECT id,prime_id,data FROM clients')).rows;
  await tx.query('COMMIT');return scoped(all,actor,link,clients);
 }catch(e){await tx.query('ROLLBACK');throw e;}finally{tx.release();}
}
function scoped(all,actor,link,clients) {
 const admin=!actor||actor.role==='admin', own=link?.prime_id;
 const visibleClients=clients.filter(c=>admin||own!=null&&c.prime_id===own);
 return {...all,primes:all.primes.filter(p=>admin||p.id===own),tasks:all.tasks.filter(t=>admin||own!=null&&t.primeId===own),clientCount:visibleClients.length,riskCount:visibleClients.filter(c=>json(c.data).statut==='risque').length};
}
// Server-side reconciliation runs even when every browser is closed. Reads and
// every relevant writer also reconcile, so scheduler delay never affects a reply.
export function startLoadClock(driver) {
 const tick=()=>readTower(driver).catch(error=>console.error('Monthly load reconciliation failed:',error.message));
 const timer=setInterval(tick,30_000);timer.unref();return ()=>clearInterval(timer);
}
