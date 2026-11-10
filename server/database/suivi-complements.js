import { pgListTransferLock } from './client-onboardings.js';

const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const validId = n => Number.isSafeInteger(n) && n > 0;
const base = `SELECT s.*, CASE WHEN s.client_id IS NULL THEN s.prime_id ELSE c.prime_id END AS effective_prime_id
  FROM suivis s LEFT JOIN clients c ON c.id=s.client_id`;
const rowOut = r => ({ id:r.id, statut:r.statut, echeance:r.echeance, note:r.note,
  createdAt:r.created_at instanceof Date ? r.created_at.toISOString()
    : typeof r.created_at==='string' && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(r.created_at)
      ? `${r.created_at.replace(' ','T')}Z` : r.created_at });

export function effective(row, normalize) {
  const original = normalize(row);
  return { ...original, statut:row.latest_id == null ? original.statut : row.latest_statut,
    echeance:row.latest_id == null ? original.echeance : row.latest_echeance,
    initialStatut:original.statut, initialEcheance:original.echeance,
    dernierComplementId:row.latest_id ?? null };
}
export function listSql(pg, scoped) {
  const last = pg
    ? 'LEFT JOIN LATERAL (SELECT id,statut,echeance FROM suivi_complements WHERE suivi_id=s.id ORDER BY id DESC LIMIT 1) last ON true'
    : 'LEFT JOIN suivi_complements last ON last.id=(SELECT id FROM suivi_complements WHERE suivi_id=s.id ORDER BY id DESC LIMIT 1)';
  return `SELECT s.*, last.id AS latest_id,last.statut AS latest_statut,last.echeance AS latest_echeance,
    CASE WHEN s.client_id IS NULL THEN s.prime_id ELSE c.prime_id END AS effective_prime_id
    FROM suivis s LEFT JOIN clients c ON c.id=s.client_id ${last}
    ${scoped ? `JOIN prime_user_links link ON link.prime_id=CASE WHEN s.client_id IS NULL THEN s.prime_id ELSE c.prime_id END WHERE link.user_id=${pg?'$1':'?'}` : ''}
    ORDER BY s.id`;
}
function accessSql(pg, actor) {
  const key = pg ? '$1' : '?';
  const actorKey = pg ? '$2' : '?';
  return `${base} ${actor.role === 'admin' ? '' : `JOIN prime_user_links link ON link.prime_id=CASE WHEN s.client_id IS NULL THEN s.prime_id ELSE c.prime_id END`}
    WHERE s.id=${key} ${actor.role === 'admin' ? '' : `AND link.user_id=${actorKey}`}`;
}
function parameters(id, actor) {return actor.role === 'admin' ? [id] : [id,actor.sub];}
export async function history(driver,id,actor,before=null) {
  if (!validId(id) || (before!==null && !validId(before))) throw fail(400,'Identifiant invalide');
  const pg=driver.kind==='pg', params=parameters(id,actor);
  const sql=`SELECT id,statut,echeance,note,created_at FROM suivi_complements WHERE suivi_id=${pg?'$1':'?'}
    ${before===null?'':`AND id<${pg?'$2':'?'}`} ORDER BY id DESC LIMIT 51`;
  const values=before===null?[id]:[id,before];
  let rows;
  if (pg) {
    const tx=await driver.pool.connect();
    try {
      await tx.query('BEGIN');
      await pgListTransferLock(query=>tx.query(query));
      const initial=(await tx.query('SELECT client_id,prime_id FROM suivis WHERE id=$1',[id])).rows[0];
      if (!initial) throw fail(404,'Suivi introuvable');
      if (initial.client_id!==null) await tx.query('SELECT id FROM clients WHERE id=$1 FOR SHARE',[initial.client_id]);
      else if (initial.prime_id!==null) await tx.query('SELECT id FROM primes WHERE id=$1 FOR KEY SHARE',[initial.prime_id]);
      const row=(await tx.query(accessSql(true,actor)+' FOR SHARE OF s',params)).rows[0];
      if (!row || row.client_id!==initial.client_id) throw fail(404,'Suivi introuvable');
      if (actor.role!=='admin') {
        const link=await tx.query('SELECT 1 FROM prime_user_links WHERE user_id=$1 AND prime_id=$2 FOR SHARE',[actor.sub,row.effective_prime_id]);
        if (!link.rowCount) throw fail(404,'Suivi introuvable');
      }
      rows=(await tx.query(sql,values)).rows;
      await tx.query('COMMIT');
    } catch(error) {await tx.query('ROLLBACK');throw error;}
    finally {tx.release();}
  } else {
    const row=driver.sqlite.prepare(accessSql(false,actor)).get(...params);
    if (!row) throw fail(404,'Suivi introuvable');
    rows=driver.sqlite.prepare(sql).all(...values);
  }
  return {complements:rows.slice(0,50).map(rowOut),hasMore:rows.length>50,nextBefore:rows.length>50?rows[49].id:null};
}
function validate(input) {
  if (!input || typeof input!=='object' || Array.isArray(input) ||
    !['a_faire','en_cours','bloque','termine'].includes(input.statut) ||
    !Object.hasOwn(input,'echeance') ||
    (input.echeance!==null && (typeof input.echeance!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.echeance) ||
      !Number.isFinite(Date.parse(input.echeance)) || new Date(input.echeance).toISOString().slice(0,10)!==input.echeance)) ||
    typeof input.note!=='string' || input.note.length>10000 ||
    !Object.hasOwn(input,'expectedLastId') || (input.expectedLastId!==null && !validId(input.expectedLastId)))
    throw fail(400,'Complément invalide');
}
function check(row,last,input) {
  if ((last?.id ?? null)!==input.expectedLastId) throw fail(409,'Suivi modifié : rechargez');
  const data=typeof row.data==='string'?JSON.parse(row.data):row.data;
  const status=last?.statut ?? data.statut ?? 'a_faire';
  const date=last ? last.echeance : (data.echeance || null);
  if (status==='termine') throw fail(409,'Suivi terminé en lecture seule');
  if (!input.note.trim() && status===input.statut && date===input.echeance) throw fail(400,'Aucune modification');
}
function result(row,inserted,normalize) {
  const suivi=effective({...row,latest_id:inserted.id,latest_statut:inserted.statut,latest_echeance:inserted.echeance},normalize);
  return {suivi:{...suivi,primeId:row.effective_prime_id},complement:rowOut(inserted)};
}
export async function append(driver,id,actor,input,normalize) {
  if (!validId(id)) throw fail(400,'Identifiant invalide');
  validate(input);
  if (driver.kind==='sqlite') return driver.sqlite.transaction(()=>{
    const sqlite=driver.sqlite, row=sqlite.prepare(accessSql(false,actor)).get(...parameters(id,actor));
    if (!row) throw fail(404,'Suivi introuvable');
    const last=sqlite.prepare('SELECT id,statut,echeance FROM suivi_complements WHERE suivi_id=? ORDER BY id DESC LIMIT 1').get(id);
    check(row,last,input);
    const inserted=sqlite.prepare('INSERT INTO suivi_complements (suivi_id,author_id,statut,echeance,note) VALUES (?,?,?,?,?) RETURNING *')
      .get(id,actor.sub,input.statut,input.echeance,input.note);
    return result(row,inserted,normalize);
  }).immediate();
  const tx=await driver.pool.connect();
  try {
    await tx.query('BEGIN');
    // Portfolio takes the exclusive gate before locking clients. Use its shared side first.
    await pgListTransferLock(sql=>tx.query(sql));
    const initial=(await tx.query(`${base} WHERE s.id=$1`,[id])).rows[0];
    if (!initial) throw fail(404,'Suivi introuvable');
    // Client row first (same order as client reassignment); suivi second.
    if (initial.client_id!==null) await tx.query('SELECT id FROM clients WHERE id=$1 FOR UPDATE',[initial.client_id]);
    else if (initial.prime_id!==null) await tx.query('SELECT id FROM primes WHERE id=$1 FOR KEY SHARE',[initial.prime_id]);
    const row=(await tx.query(accessSql(true,actor)+' FOR UPDATE OF s',[...parameters(id,actor)])).rows[0];
    if (!row) throw fail(404,'Suivi introuvable');
    // Lock the link so an administrative reassignment cannot invalidate authorization before commit.
    if (actor.role!=='admin') {
      const link=await tx.query('SELECT 1 FROM prime_user_links WHERE user_id=$1 AND prime_id=$2 FOR SHARE',[actor.sub,row.effective_prime_id]);
      if (!link.rowCount) throw fail(404,'Suivi introuvable');
    }
    const last=(await tx.query('SELECT id,statut,echeance FROM suivi_complements WHERE suivi_id=$1 ORDER BY id DESC LIMIT 1',[id])).rows[0];
    check(row,last,input);
    const inserted=(await tx.query('INSERT INTO suivi_complements (suivi_id,author_id,statut,echeance,note) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [id,actor.sub,input.statut,input.echeance,input.note])).rows[0];
    await tx.query('COMMIT');
    return result(row,inserted,normalize);
  } catch(error) {await tx.query('ROLLBACK');throw error;}
  finally {tx.release();}
}
