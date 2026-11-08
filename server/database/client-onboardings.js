// App Prime-owned onboarding storage; never use BZ/Servo identifiers here.
import {randomUUID} from 'node:crypto';
import { withSqliteOwner } from './sqlite-isolation.js';
const schema = pg => {
  const id=pg?'SERIAL':'INTEGER', auto=pg?'':' AUTOINCREMENT';
  const j=pg?'JSONB':'TEXT', b=pg?'BOOLEAN':'INTEGER', stamp=pg?'TIMESTAMP':'TEXT';
  const now=pg?'CURRENT_TIMESTAMP':"(datetime('now'))";
  const empty=pg?"'{}'::jsonb":"'{}'";
  const f=pg?'false':'0';
  return `
    CREATE TABLE IF NOT EXISTS client_onboardings (
      id ${id} PRIMARY KEY${auto}, request_key TEXT NOT NULL UNIQUE, client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
      technicien_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      titre TEXT NOT NULL, statut TEXT NOT NULL, priorite TEXT NOT NULL,
      urgence_ti TEXT,site_principal TEXT,contact_principal TEXT,periode_couverte TEXT,prepare_pour TEXT,
      avancement_global TEXT,risques_critiques TEXT,actions_ouvertes TEXT,decisions_requises TEXT,prochaine_rencontre TEXT,
      compte_rendu ${j} NOT NULL DEFAULT ${empty}, data ${j} NOT NULL DEFAULT ${empty},
      version INTEGER NOT NULL DEFAULT 1, archived ${b} NOT NULL DEFAULT ${f}, archived_at ${stamp},
      created_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,created_by_email TEXT,
      updated_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,updated_by_email TEXT,
      created_at ${stamp} NOT NULL DEFAULT ${now},updated_at ${stamp} NOT NULL DEFAULT ${now}
    );
    CREATE TABLE IF NOT EXISTS client_onboarding_items (
      id ${id} PRIMARY KEY${auto},onboarding_id INTEGER NOT NULL REFERENCES client_onboardings(id) ON DELETE CASCADE,
      section_key TEXT NOT NULL,section_title TEXT NOT NULL,item_order INTEGER NOT NULL,checked ${b} NOT NULL DEFAULT ${f},
      priorite TEXT,statut TEXT,element TEXT NOT NULL,notes TEXT,action TEXT,responsable TEXT,echeance ${pg?'DATE':'TEXT'},
      created_at ${stamp} NOT NULL DEFAULT ${now},updated_at ${stamp} NOT NULL DEFAULT ${now},
      UNIQUE(onboarding_id,section_key,item_order)
    );
    CREATE TABLE IF NOT EXISTS client_onboarding_history (
      id ${id} PRIMARY KEY${auto},onboarding_id INTEGER NOT NULL REFERENCES client_onboardings(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,snapshot ${j} NOT NULL DEFAULT ${empty},actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      actor_email TEXT,created_at ${stamp} NOT NULL DEFAULT ${now}
    );
    CREATE INDEX IF NOT EXISTS idx_prime_onboarding_client ON client_onboardings(client_id);
    CREATE INDEX IF NOT EXISTS idx_prime_onboarding_technicien ON client_onboardings(technicien_id);
    CREATE INDEX IF NOT EXISTS idx_prime_onboarding_archived ON client_onboardings(archived,id);
    CREATE INDEX IF NOT EXISTS idx_prime_onboarding_items ON client_onboarding_items(onboarding_id);
    CREATE INDEX IF NOT EXISTS idx_prime_onboarding_history ON client_onboarding_history(onboarding_id,id);
  `;
};
export function createOnboardingSchemaSqlite(sqlite) {
  const legacy=sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='client_onboardings'").get() &&
    !sqlite.prepare('PRAGMA table_info(client_onboardings)').all().some(c=>c.name==='request_key');
  if (legacy) {
    if (sqlite.pragma('foreign_keys',{simple:true})!==0) throw new Error('Migration prise en charge: désactiver les FK avant transaction');
    const ddl=schema(false).match(/CREATE TABLE IF NOT EXISTS client_onboardings \([\s\S]*?\n    \);/)[0]
      .replace('CREATE TABLE IF NOT EXISTS client_onboardings (','CREATE TABLE client_onboardings_new (');
    sqlite.exec(ddl);
    const old=sqlite.prepare('PRAGMA table_info(client_onboardings)').all().map(c=>c.name);
    const allowed=new Set(sqlite.prepare('PRAGMA table_info(client_onboardings_new)').all().map(c=>c.name));
    if (old.some(c=>!allowed.has(c) || !/^[a-z_]+$/.test(c))) throw new Error('Migration prise en charge: colonnes inconnues');
    const insert=sqlite.prepare(`INSERT INTO client_onboardings_new (${old.join(',')},request_key) SELECT ${old.join(',')},? FROM client_onboardings WHERE id=?`);
    for (const {id} of sqlite.prepare('SELECT id FROM client_onboardings').all()) insert.run(randomUUID(),id);
    sqlite.exec('DROP TABLE client_onboardings; ALTER TABLE client_onboardings_new RENAME TO client_onboardings');
  }
  sqlite.exec(schema(false));
}
export async function createOnboardingSchemaPg(connection) {
  const exists=await connection.query("SELECT 1 FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='client_onboardings'");
  if (exists.rowCount) {
    const key=await connection.query("SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='client_onboardings' AND column_name='request_key'");
    if (!key.rowCount) {
      await connection.query('ALTER TABLE client_onboardings ADD COLUMN request_key TEXT');
      // Values for pre-idempotency dossiers are server-generated, never client-controlled.
      const ids=await connection.query('SELECT id FROM client_onboardings');
      for (const {id} of ids.rows) await connection.query('UPDATE client_onboardings SET request_key=$1 WHERE id=$2',[randomUUID(),id]);
      await connection.query('ALTER TABLE client_onboardings ALTER COLUMN request_key SET NOT NULL, ADD CONSTRAINT client_onboardings_request_key_key UNIQUE(request_key)');
    }
  }
  await connection.query(schema(true));
}
const fail = (statusCode, message) => { throw Object.assign(new Error(message), { statusCode }); };
const STATUSES = ['À faire', 'En cours', 'Bloqué', 'Fait', 'N/A'];
const PRIORITIES = ['Critique', 'Haute', 'Moyenne', 'Basse'];
const TEXT = ['titre','urgence_ti','site_principal','contact_principal','periode_couverte','prepare_pour','avancement_global','risques_critiques','actions_ouvertes','decisions_requises','prochaine_rencontre'];
const REPORT = ['resume_executif','points_valides','points_a_corriger','recommandations_prioritaires','prochaines_etapes'];
const ITEM_TEXT = ['section_key','section_title','element','notes','action','responsable'];
const MAX_ITEMS = 300;
const validId = v => Number.isSafeInteger(v) && v > 0;
export const validRequestKey = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
function requireRequestKey(key) { if (!validRequestKey(key)) fail(400,'requestKey UUID invalide ou absent'); }
const text = (v, max = 4000) => typeof v === 'string' && v.length <= max;
const date = v => v === null || v === '' || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0,10) === v);
const json = v => typeof v === 'string' ? JSON.parse(v) : v;
const archived = v => v === true || v === 1;
const eligible = c => json(c.data).clientType === 'ti';

function validate(input, items, creating) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400,'Données invalides');
  if (!validId(input.client_id)) fail(400,'client_id Prime invalide');
  if (input.technicien_id !== null && input.technicien_id !== '' && input.technicien_id !== undefined && !validId(input.technicien_id)) fail(400,'technicien_id invalide');
  if (!STATUSES.includes(input.statut) || !PRIORITIES.includes(input.priorite)) fail(400,'Statut ou priorité invalide');
  for (const k of TEXT) if (!text(input[k] ?? '', k === 'titre' ? 200 : 4000)) fail(400,`${k} invalide`);
  if (!input.titre?.trim()) fail(400,'Titre requis');
  const report = input.compte_rendu ?? {};
  if (!report || typeof report !== 'object' || Array.isArray(report) || Object.keys(report).some(k => !REPORT.includes(k))) fail(400,'Compte rendu invalide');
  for (const k of REPORT) if (!text(report[k] ?? '', 12000)) fail(400,`Compte rendu ${k} invalide`);
  if (creating && !Array.isArray(items)) fail(400,'Items requis');
  if (items !== undefined) {
    if (!Array.isArray(items) || items.length > MAX_ITEMS) fail(400,'Nombre d’items invalide');
    const keys = new Set(), sections = new Map();
    for (const [i,item] of items.entries()) {
      if (!item || typeof item !== 'object' || Array.isArray(item) || !Number.isSafeInteger(item.item_order) || item.item_order < 0 || item.item_order > 100000 || typeof item.checked !== 'boolean' || !date(item.echeance ?? null)) fail(400,`Item ${i} invalide`);
      for (const k of ITEM_TEXT) if (!text(item[k] ?? '', k === 'notes' || k === 'action' ? 4000 : 500)) fail(400,`Item ${i}: ${k} invalide`);
      if (!item.section_key?.trim() || !item.section_title?.trim() || !item.element?.trim() || !/^[a-z0-9-]+$/.test(item.section_key) || !['',...PRIORITIES].includes(item.priorite ?? '') || !['',...STATUSES].includes(item.statut ?? '')) fail(400,`Item ${i} invalide`);
      const key = `${item.section_key}:${item.item_order}`;
      if (keys.has(key) || (sections.has(item.section_key) && sections.get(item.section_key) !== item.section_title)) fail(400,'Section ou ordre dupliqué');
      keys.add(key); sections.set(item.section_key,item.section_title);
    }
    if (sections.size > 30) fail(400,'Trop de sections');
  }
  return { ...Object.fromEntries(TEXT.map(k => [k,input[k] ?? ''])), client_id: input.client_id, technicien_id: input.technicien_id || null, statut: input.statut, priorite: input.priorite, compte_rendu: report };
}

let sqliteQueue = Promise.resolve();
function serialize(driver, fn) {
  if (driver.kind !== 'sqlite') return fn();
  const task = sqliteQueue.then(fn);
  sqliteQueue = task.catch(() => {});
  return task;
}
function adapter(driver, connection) {
  if (driver.kind === 'pg') return async (sql, vals=[]) => {
    let n=0;
    const result = await connection.query(sql.replace(/\?/g, () => `$${++n}`), vals);
    return result.rows;
  };
  return async (sql, vals=[]) => { const stmt=driver.sqlite.prepare(sql); const args=vals.map(v => typeof v === 'boolean' ? Number(v) : v); return stmt.reader ? stmt.all(...args) : (stmt.run(...args), []); };
}
async function transaction(driver, fn) {
  const conn=await driver.pool.connect();
  try { await conn.query('BEGIN'); const result=await fn(adapter(driver,conn)); await conn.query('COMMIT'); return result; }
  catch(e) { await conn.query('ROLLBACK'); throw e; }
  finally { conn.release(); }
}
async function run(driver, fn) {
  if (driver.kind === 'sqlite') return serialize(driver, () => withSqliteOwner(async () => {
    driver.sqlite.exec('BEGIN IMMEDIATE');
    try { const result=await fn(adapter(driver));driver.sqlite.exec('COMMIT');return result; }
    catch(e) { driver.sqlite.exec('ROLLBACK');throw e; }
  }));
  return transaction(driver,fn);
}
const row = async (q,sql,vals) => (await q(sql,vals))[0];
// Creation and every later event must identify this exact dossier/client.
// JSON array guards keep corrupt SQLite TEXT and non-array JSON fail-closed.
function provenClientSql(pg) {
  const matches=pg
    ? `h.snapshot->'onboarding'->'client_id' = to_jsonb(o.client_id)
       AND h.snapshot->'onboarding'->'id' = to_jsonb(o.id)
       AND jsonb_typeof(h.snapshot->'items')='array'
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(h.snapshot->'items')='array' THEN h.snapshot->'items' ELSE '[]'::jsonb END) item(value)
         WHERE item.value->'onboarding_id' IS DISTINCT FROM to_jsonb(o.id)
           OR jsonb_typeof(item.value->'id')!='number'
           OR coalesce(item.value->>'id' !~ '^[1-9][0-9]*$',true)
           OR EXISTS (SELECT 1 FROM client_onboarding_items actual
             WHERE actual.id::text=item.value->>'id' AND actual.onboarding_id<>o.id))`
    : `CASE WHEN json_valid(h.snapshot) THEN
         json_type(h.snapshot,'$.onboarding.client_id')='integer' AND json_extract(h.snapshot,'$.onboarding.client_id')=o.client_id
         AND json_type(h.snapshot,'$.onboarding.id')='integer' AND json_extract(h.snapshot,'$.onboarding.id')=o.id
         AND json_type(h.snapshot,'$.items')='array'
         AND NOT EXISTS (SELECT 1 FROM json_each(CASE WHEN json_type(h.snapshot,'$.items')='array' THEN h.snapshot ELSE '{"items":[]}' END,'$.items') item
           WHERE CASE WHEN item.type='object' THEN
             coalesce(json_type(item.value,'$.onboarding_id')!='integer' OR json_extract(item.value,'$.onboarding_id')!=o.id,1)
             OR coalesce(json_type(item.value,'$.id')!='integer' OR json_extract(item.value,'$.id')<1,1)
             OR EXISTS (SELECT 1 FROM client_onboarding_items actual WHERE actual.id=json_extract(item.value,'$.id') AND actual.onboarding_id<>o.id)
           ELSE 1 END)
       ELSE 0 END`;
  return `EXISTS (SELECT 1 FROM client_onboarding_history h WHERE h.onboarding_id=o.id AND h.event_type='created' AND h.id=(SELECT MIN(first.id) FROM client_onboarding_history first WHERE first.onboarding_id=o.id) AND (${matches}))
    AND NOT EXISTS (SELECT 1 FROM client_onboarding_history h WHERE h.onboarding_id=o.id AND NOT (CASE WHEN ${matches} THEN 1 ELSE 0 END = 1))`;
}
async function requireProvenClient(q,id,pg) {
  if (!await row(q,`SELECT 1 FROM client_onboardings o WHERE o.id=? AND ${provenClientSql(pg)}`,[id])) fail(404,'Prise en charge introuvable');
}
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
function reportShape(value) {
  let report;
  try { report=json(value); } catch { fail(500,'Compte rendu enregistré invalide'); }
  if (!object(report) || REPORT.some(k=>report[k] !== undefined && typeof report[k] !== 'string')) fail(500,'Compte rendu enregistré invalide');
  return Object.fromEntries(REPORT.filter(k=>Object.hasOwn(report,k)).map(k=>[k,report[k]]));
}
function shape(o, historical=false) {
  if (!object(o) || (historical && !validId(o.client_id))) fail(500,'Dossier historique invalide');
  if (historical && (['id','technicien_id','version'].some(k=>Object.hasOwn(o,k) && o[k] !== null && !validId(o[k])) ||
    [...TEXT,'statut','priorite','archived_at','created_at','updated_at'].some(k=>Object.hasOwn(o,k) && o[k] !== null && typeof o[k] !== 'string') ||
    (Object.hasOwn(o,'archived') && ![true,false,0,1].includes(o.archived)))) fail(500,'Dossier historique invalide');
  // Project only schema-approved public columns. Persisted data is arbitrary
  // legacy JSON, never a source of public fields or authorized identity.
  // Audit authors remain available only in scoped history events.
  const fields=['id','client_id','technicien_id','statut','priorite',...TEXT,
    'archived_at','created_at','updated_at'];
  const result=Object.fromEntries(fields.filter(k=>!historical || Object.hasOwn(o,k)).map(k=>[k,o[k]]));
  if (!historical || Object.hasOwn(o,'archived')) result.archived=archived(o.archived);
  if (!historical || Object.hasOwn(o,'compte_rendu')) result.compte_rendu=reportShape(o.compte_rendu);
  if (!historical || Object.hasOwn(o,'version')) result.version=o.version;
  return result;
}
async function scopedClient(q,id,actor,lock=false) {
  const c=await row(q,`SELECT c.id,c.prime_id,c.data FROM clients c WHERE c.id = ?${lock ? ' FOR UPDATE':''}`,[id]);
  if (!c || !eligible(c)) fail(404,'Client introuvable');
  if (actor.role !== 'admin' && !(await row(q,`SELECT 1 FROM prime_user_links WHERE user_id = ? AND prime_id = ?${lock ? ' FOR SHARE':''}`,[actor.sub,c.prime_id]))) fail(404,'Client introuvable');
  return c;
}
async function tech(q,id,actor) {
  if (actor.role !== 'admin') {
    if (id !== null && id !== actor.sub) fail(400,'Technicien non autorisé');
  } else if (id !== null && !(await row(q,"SELECT 1 FROM users u JOIN prime_user_links l ON l.user_id=u.id WHERE u.id=? AND u.role='prime' AND u.is_active=?",[id,true]))) fail(400,'Technicien non autorisé');
}
async function get(q,id,actor,lock=false) {
  const o=await row(q,'SELECT * FROM client_onboardings WHERE id = ?',[id]);
  if (!o) fail(404,'Prise en charge introuvable');
  await scopedClient(q,o.client_id,actor,lock);
  // In READ COMMITTED, a transfer can commit between the initial lookup and
  // the client lock. Never load content under authorization for the old client.
  if (lock) {
    const current=await row(q,'SELECT * FROM client_onboardings WHERE id = ?',[id]);
    if (!current || current.client_id !== o.client_id) fail(404,'Prise en charge introuvable');
    await requireProvenClient(q,id,true);
    return current;
  }
  await requireProvenClient(q,id,false);
  return o;
}
async function full(q,o) {
  const client=await row(q,'SELECT data FROM clients WHERE id=?',[o.client_id]);
  const user=o.technicien_id ? await row(q,'SELECT prenom,nom,email FROM users WHERE id=?',[o.technicien_id]) : null;
  const items=await q('SELECT * FROM client_onboarding_items WHERE onboarding_id=? ORDER BY item_order,section_key,id',[o.id]);
  return {...shape(o),client_nom:json(client.data).nom,technicien_nom:user ? `${user.prenom} ${user.nom}`.trim() : '',technicien_email:user?.email ?? null,total_items:items.length,completed_items:items.filter(i=>archived(i.checked)).length,high_priority_open_items:items.filter(i=>!archived(i.checked)&&['Critique','Haute'].includes(i.priorite)).length,items:items.map(itemShape)};
}
const ITEM_PUBLIC=['id','onboarding_id','section_key','section_title','item_order','checked','priorite','statut','element','notes','action','responsable','echeance'];
function itemShape(i) {
  if (!object(i) || !validId(i.id) || !validId(i.onboarding_id) ||
    typeof i.section_key !== 'string' || !i.section_key.trim() ||
    typeof i.section_title !== 'string' || !i.section_title.trim() ||
    !Number.isSafeInteger(i.item_order) || i.item_order < 0 ||
    ![true,false,0,1].includes(i.checked) || typeof i.element !== 'string' || !i.element.trim() ||
    ['priorite','statut','notes','action','responsable','echeance'].some(k=>Object.hasOwn(i,k) && i[k] !== null && typeof i[k] !== 'string' && !(k==='echeance' && i[k] instanceof Date))) fail(500,'Item historique invalide');
  const result=Object.fromEntries(ITEM_PUBLIC.filter(k=>Object.hasOwn(i,k)).map(k=>[k,i[k]]));
  result.checked=archived(i.checked);
  if (result.echeance instanceof Date) result.echeance=result.echeance.toISOString().slice(0,10);
  return result;
}
function snapshotShape(value,clientId,dossierId) {
  if (!object(value) || !object(value.onboarding) || value.onboarding.client_id!==clientId || value.onboarding.id!==dossierId ||
      !Array.isArray(value.items) || value.items.some(item=>!object(item) || item.onboarding_id!==dossierId) ||
      !Number.isSafeInteger(value.items_count) || value.items_count!==value.items.length) fail(500,'Snapshot historique invalide');
  return {onboarding:shape(value.onboarding,true),items:value.items.map(itemShape),items_count:value.items_count};
}
async function snapshot(q,o) {
  const items=await q('SELECT * FROM client_onboarding_items WHERE onboarding_id=? ORDER BY item_order,section_key,id',[o.id]);
  return {onboarding:shape(o),items:items.map(itemShape),items_count:items.length};
}
const columns=['client_id','technicien_id','titre','statut','priorite',...TEXT.filter(k=>k!=='titre'),'compte_rendu'];
const values=p=>columns.map(k=>k==='compte_rendu'?JSON.stringify(p[k]):p[k]);
async function writeItems(q,id,items) {
  await q('DELETE FROM client_onboarding_items WHERE onboarding_id=?',[id]);
  for (const item of items) await q(`INSERT INTO client_onboarding_items (onboarding_id,section_key,section_title,item_order,checked,priorite,statut,element,notes,action,responsable,echeance) VALUES (${Array(12).fill('?').join(',')})`,[id,item.section_key,item.section_title,item.item_order,item.checked,item.priorite||null,item.statut||null,item.element,item.notes||'',item.action||'',item.responsable||'',item.echeance||null]);
}
async function history(q,id,event,actor,snapshot) {
  await q('INSERT INTO client_onboarding_history (onboarding_id,event_type,actor_id,actor_email,snapshot) VALUES (?,?,?,?,?)',[id,event,actor.sub,actor.email,JSON.stringify(snapshot)]);
}
export async function options(driver,actor) {
  const q=adapter(driver,driver.pool);
  const clients=await q(`SELECT c.id,c.data FROM clients c ${actor.role==='admin'?'':'JOIN prime_user_links l ON l.prime_id=c.prime_id WHERE l.user_id=?'} ORDER BY c.id`,actor.role==='admin'?[]:[actor.sub]);
  const users=await q(`SELECT u.id,u.prenom,u.nom,u.email FROM users u JOIN prime_user_links l ON l.user_id=u.id WHERE u.is_active=? AND u.role='prime' ${actor.role==='admin'?'':'AND u.id=?'} ORDER BY u.nom,u.prenom`,actor.role==='admin'?[true]:[true,actor.sub]);
  return {clients:clients.filter(eligible).map(c=>({id:c.id,nom:json(c.data).nom})),techniciens:users};
}
// Backfill can discover a lower client id after a later page; sorted locks
// within one page alone cannot prevent a B -> A inversion across pages.
// Take a transaction-scoped shared gate for lists, exclusive for mutations,
// before any client/row locks; parallel lists remain possible.
export const pgListTransferLock = (q,write=false) => q(`SELECT pg_advisory_xact_lock${write?'':'_shared'}(176930415, 20261106)`);
export async function list(driver,actor,filters={}) {
  return driver.kind==='pg' ? transaction(driver,async q=>{
    await pgListTransferLock(q);
    return listRows(driver,q,actor,filters);
  }) : serialize(driver,()=>listRows(driver,adapter(driver),actor,filters));
}
async function listRows(driver,q,actor,filters) {
  const where=[], vals=[];
  // GET /api/client-onboardings returns an array. Query params: limit 1..50
  // (default 50), before = exclusive onboarding id; use the last id as cursor.
  const pageNumber=(raw,name)=>{
    if(typeof raw!=='string' || !/^[1-9]\d*$/.test(raw) || !validId(Number(raw))) fail(400,`${name} invalide`);
    return Number(raw);
  };
  const limit=filters.limit===undefined?50:pageNumber(filters.limit,'limit');
  if(limit>50) fail(400,'limit invalide');
  if(filters.before!==undefined){where.push('o.id<?');vals.push(pageNumber(filters.before,'before'));}
  const params=[['clientId','client_id'],['technicienId','technicien_id']];
  for (const [key,col] of params) {
    const raw=filters[col] ?? filters[key];
    if(raw === undefined || raw === '') continue;
    const v=Number(raw);if(!validId(v)) fail(400,'Filtre invalide');where.push(`o.${col}=?`);vals.push(v);
  }
  if(filters.statut){if(!STATUSES.includes(filters.statut)) fail(400,'Statut invalide');where.push('o.statut=?');vals.push(filters.statut);}
  if(filters.archived !== undefined && !['true','false'].includes(String(filters.archived))) fail(400,'Archive invalide');
  where.push('o.archived=?'); vals.push(filters.archived === 'true' || filters.archived === true);
  const search=String(filters.search||'').trim().toLowerCase();if(search.length>200) fail(400,'Recherche trop longue');
  const field=key=>driver.kind==='pg'?`c.data->>'${key}'`:`json_extract(c.data,'$.${key}')`;
  where.push(`${field('clientType')}=?`);vals.push('ti');
  if(search){
    where.push(`(LOWER(o.titre) LIKE ? ESCAPE ? OR LOWER(${field('nom')}) LIKE ? ESCAPE ? OR LOWER(u.prenom) LIKE ? ESCAPE ? OR LOWER(u.nom) LIKE ? ESCAPE ?)`);
    const pattern=`%${search.replaceAll('\\','\\\\').replaceAll('%','\\%').replaceAll('_','\\_')}%`;
    for(let i=0;i<4;i++) vals.push(pattern,'\\');
  }
  // Aggregate only items belonging to each bounded batch; never read snapshots.
  const joins=`FROM client_onboardings o JOIN clients c ON c.id=o.client_id LEFT JOIN users u ON u.id=o.technicien_id ${actor.role==='admin'?'':'JOIN prime_user_links l ON l.prime_id=c.prime_id'}`;
  const criteria=`WHERE ${actor.role==='admin'?'':'l.user_id=? AND '}${where.join(' AND ')} AND ${provenClientSql(driver.kind==='pg')}`;
  const projection=`o.*,${field('nom')} AS client_nom,u.prenom AS tech_prenom,u.nom AS tech_nom,u.email AS technicien_email,
    (SELECT COUNT(*) FROM client_onboarding_items i WHERE i.onboarding_id=o.id) AS total_items,
    (SELECT COUNT(*) FROM client_onboarding_items i WHERE i.onboarding_id=o.id AND i.checked=?) AS completed_items,
    (SELECT COUNT(*) FROM client_onboarding_items i WHERE i.onboarding_id=o.id AND i.checked=? AND i.priorite IN ('Critique','Haute')) AS high_priority_open_items`;
  const argumentsFor=(cursor,remaining)=>[true,false,...(actor.role==='admin'?[]:[actor.sub]),...vals,...(cursor===null?[]:[cursor]),remaining];
  const visible=[];
  let cursor=null;
  do {
    const remaining=limit-visible.length;
    const cursorSql=cursor===null?'':' AND o.id < ?';
    if(driver.kind!=='pg') {
      const records=await q(`SELECT ${projection} ${joins} ${criteria}${cursorSql} ORDER BY o.id DESC LIMIT ?`,argumentsFor(cursor,remaining));
      visible.push(...records);
      break;
    }
    // The candidate query takes no client locks: a descending onboarding page
    // can encounter B before A, whereas transfers always lock A before B.
    const candidates=await q(`SELECT o.id,o.client_id ${joins} ${criteria}${cursorSql} ORDER BY o.id DESC LIMIT ?`,
      [...(actor.role==='admin'?[]:[actor.sub]),...vals,...(cursor===null?[]:[cursor]),remaining]);
    if(!candidates.length) break;
    cursor=candidates.at(-1).id;
    for(const clientId of [...new Set(candidates.map(r=>r.client_id))].sort((a,b)=>a-b))
      await q('SELECT id FROM clients WHERE id=? FOR SHARE',[clientId]);
    if(actor.role!=='admin') {
      const primes=await q(`SELECT DISTINCT prime_id FROM clients WHERE id IN (${candidates.map(()=>'?').join(',')})`,candidates.map(r=>r.client_id));
      for(const primeId of [...new Set(primes.map(r=>r.prime_id))].sort((a,b)=>a-b))
        await q('SELECT 1 FROM prime_user_links WHERE user_id=? AND prime_id=? FOR SHARE',[actor.sub,primeId]);
    }
    const current=await q(`SELECT id,client_id FROM client_onboardings WHERE id IN (${candidates.map(()=>'?').join(',')}) ORDER BY id FOR SHARE`,candidates.map(r=>r.id));
    const original=new Map(candidates.map(r=>[r.id,r.client_id]));
    const stable=current.filter(r=>original.get(r.id)===r.client_id);
    if(stable.length) {
      const pairSql=stable.map(()=>'(?,?)').join(',');
      const records=await q(`SELECT ${projection} ${joins} ${criteria} AND (o.id,o.client_id) IN (${pairSql}) ORDER BY o.id DESC LIMIT ?`,
        [true,false,...(actor.role==='admin'?[]:[actor.sub]),...vals,...stable.flatMap(r=>[r.id,r.client_id]),remaining]);
      visible.push(...records);
    }
    if(candidates.length<remaining) break;
  } while(visible.length<limit);
  return visible.map(({tech_prenom,tech_nom,...r})=>({...shape(r),client_nom:r.client_nom,technicien_email:r.technicien_email,technicien_nom:tech_prenom||tech_nom?`${tech_prenom||''} ${tech_nom||''}`.trim():'',total_items:Number(r.total_items),completed_items:Number(r.completed_items),high_priority_open_items:Number(r.high_priority_open_items)}));
}
export async function detail(driver,id,actor) {
  if(!validId(id)) fail(400,'ID invalide');
  const read=async q=>full(q,await get(q,id,actor,driver.kind==='pg'));
  return driver.kind==='pg' ? transaction(driver,read) : serialize(driver,()=>read(adapter(driver)));
}
export async function reconcile(driver,key,actor) {
  requireRequestKey(key);
  const read=async q=>{
    const target=await row(q,'SELECT id,client_id,created_by_id FROM client_onboardings WHERE request_key=?',[key]);
    if (!target) return {found:false};
    if (target.created_by_id !== actor.sub) fail(404,'Prise en charge introuvable');
    await scopedClient(q,target.client_id,actor,driver.kind==='pg');
    const current=await row(q,'SELECT id,client_id,archived,created_by_id FROM client_onboardings WHERE request_key=?',[key]);
    if (!current || current.client_id!==target.client_id || current.created_by_id!==actor.sub) fail(404,'Prise en charge introuvable');
    await requireProvenClient(q,current.id,driver.kind==='pg');
    return {found:true,id:current.id,archived:archived(current.archived)};
  };
  return driver.kind==='pg' ? transaction(driver,read) : serialize(driver,()=>read(adapter(driver)));
}
export async function create(driver,data,items,actor,requestKey) {
  requireRequestKey(requestKey);
  const p=validate(data,items,true);
  return run(driver,async q=>{
    await scopedClient(q,p.client_id,actor,driver.kind==='pg');await tech(q,p.technicien_id,actor);
    const inserted=await row(q,`INSERT INTO client_onboardings (request_key,${columns.join(',')},data,created_by_id,created_by_email,updated_by_id,updated_by_email) VALUES (${Array(columns.length+6).fill('?').join(',')}) ON CONFLICT(request_key) DO NOTHING RETURNING *`,[requestKey,...values(p),JSON.stringify({}),actor.sub,actor.email,actor.sub,actor.email]);
    if (!inserted) fail(409,'Clé de requête déjà utilisée; vérifiez la création avant de réessayer');
    await writeItems(q,inserted.id,items);await history(q,inserted.id,'created',actor,await snapshot(q,inserted));
    return full(q,inserted);
  });
}
export async function mutate(driver,id,data,items,actor,event,expectedVersion) {
  if(!validId(id)) fail(400,'ID invalide');
  if(!validId(expectedVersion)) fail(400,'expectedVersion requis');
  const p=event==='updated'?validate(data,items,false):null;
  return run(driver,async q=>{
    if(driver.kind==='pg') await pgListTransferLock(q,true);
    // Lock the persisted client before the dossier row. A PUT can never
    // reassign this client, so no destination client lock is necessary.
    const target=await row(q,'SELECT client_id FROM client_onboardings WHERE id=?',[id]);if(!target) fail(404,'Prise en charge introuvable');
    if(driver.kind==='pg' && event==='updated') await q('SELECT id FROM clients WHERE id=? FOR UPDATE',[target.client_id]);
    await scopedClient(q,target.client_id,actor,driver.kind==='pg');
    const current=await row(q,`SELECT * FROM client_onboardings WHERE id=?${driver.kind==='pg'?' FOR UPDATE':''}`,[id]);if(!current) fail(404,'Prise en charge introuvable');
    if(current.client_id!==target.client_id) fail(404,'Prise en charge introuvable');
    await requireProvenClient(q,id,driver.kind==='pg');
    if(current.version!==expectedVersion) fail(409,'Version modifiée; rechargez la prise en charge');
    if(event==='updated' && current.client_id!==p.client_id) fail(409,'Client du dossier immuable; créez un nouveau dossier pour cet autre client');
    if(event==='updated' && current.statut==='Fait') fail(409,'Dossier terminé immuable');
    if(event==='updated' && archived(current.archived)) fail(409,'Archive immuable; restaurez-la avant modification');
    if(event==='updated'){
      await tech(q,p.technicien_id,actor);
      await q(`UPDATE client_onboardings SET ${columns.map(k=>`${k}=?`).join(',')},updated_by_id=?,updated_by_email=?,updated_at=CURRENT_TIMESTAMP,version=version+1 WHERE id=?`,[...values(p),actor.sub,actor.email,id]);
      if(items!==undefined) await writeItems(q,id,items);
    } else {
      const desired=event==='restored';
      if(archived(current.archived)===!desired) fail(409,'État déjà modifié; rechargez la prise en charge');
      await q(`UPDATE client_onboardings SET archived=?,archived_at=${desired?'NULL':'CURRENT_TIMESTAMP'},updated_by_id=?,updated_by_email=?,updated_at=CURRENT_TIMESTAMP,version=version+1 WHERE id=?`,[!desired,actor.sub,actor.email,id]);
    }
    const updated=await row(q,'SELECT * FROM client_onboardings WHERE id=?',[id]);
    await history(q,id,event,actor,await snapshot(q,updated));return full(q,updated);
  });
}
export async function historyPage(driver,id,actor,params={}) {
  if(!validId(id)) fail(400,'ID invalide');
  const parse = (value,name) => {
    if(typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !validId(Number(value))) fail(400,`${name} invalide`);
    return Number(value);
  };
  const before=params.before === undefined ? null : parse(params.before,'before');
  const limit=params.limit === undefined ? 50 : parse(params.limit,'limit');
  if(limit > 100) fail(400,'limit invalide');
  const maxBytes=4*1024*1024;
  const read=async q=>{
    const current=await get(q,id,actor,driver.kind==='pg');
    // The dossier-wide provenance gate in get() already rejects any foreign
    // or unknown event. Retain per-event checks as defense in depth; neither
    // branch changes stored audit rows.
    const sameClient=driver.kind==='pg'
      ? "snapshot->'onboarding'->'client_id' = to_jsonb(?::integer) AND snapshot->'onboarding'->'id' = to_jsonb(?::integer)"
      : "CASE WHEN json_valid(snapshot) THEN json_type(snapshot,'$.onboarding.client_id')='integer' AND json_extract(snapshot,'$.onboarding.client_id')=? AND json_type(snapshot,'$.onboarding.id')='integer' AND json_extract(snapshot,'$.onboarding.id')=? ELSE 0 END";
    // Measure only visible snapshots before fetching them. Redacted multi-MB
    // rows cost only metadata bytes, and cannot block cursor traversal.
    const size=driver.kind==='pg'?'OCTET_LENGTH(snapshot::text)':'length(CAST(snapshot AS BLOB))';
    const metadata=await q(`SELECT id,CASE WHEN ${sameClient} THEN ${size} ELSE 0 END AS snapshot_bytes FROM client_onboarding_history WHERE onboarding_id=?${before===null?'':' AND id < ?'} ORDER BY id DESC LIMIT ?`,[current.client_id,id,id,...(before===null?[]:[before]),limit+1]);
    const selected=[];let bytes=0;
    for(const entry of metadata.slice(0,limit)) {
      // Reserve room for event fields, JSON framing, and escaping; exact check below.
      const estimate=Number(entry.snapshot_bytes)+1024;
      if(bytes+estimate>maxBytes) {
        // Raw audit JSON may be huge only because of fields the public
        // projection discards. Fetch a single oversized candidate and apply
        // the exact post-projection byte check below before returning it.
        if(!selected.length) selected.push(entry.id);
        break;
      }
      selected.push(entry.id);bytes+=estimate;
    }
    if(!selected.length) return {events:[],nextBefore:null};
    const events=(await q(`SELECT id,onboarding_id,event_type,created_at,
      CASE WHEN visible THEN snapshot ELSE NULL END AS snapshot,
      CASE WHEN visible THEN actor_id ELSE NULL END AS actor_id,
      CASE WHEN visible THEN actor_email ELSE NULL END AS actor_email
      FROM (SELECT *,${sameClient} AS visible FROM client_onboarding_history
        WHERE id IN (${selected.map(()=>'?').join(',')}) AND onboarding_id=?) scoped ORDER BY id DESC`,[current.client_id,id,...selected,id]))
      .map(h=>{
        if(h.snapshot===null) return h;
        return {...h,snapshot:snapshotShape(json(h.snapshot),current.client_id,id)};
      });
    while(events.length) {
      const result={events,nextBefore:metadata.length>events.length?events.at(-1).id:null};
      if(Buffer.byteLength(JSON.stringify(result))<=maxBytes) return result;
      if(events.length===1) fail(413,'Snapshot historique trop volumineux');
      events.pop();
    }
    fail(413,'Snapshot historique trop volumineux');
  };
  return driver.kind==='pg' ? transaction(driver,read) : serialize(driver,()=>read(adapter(driver)));
}
