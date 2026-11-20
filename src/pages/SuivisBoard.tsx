import { useEffect, useRef, useState } from 'react';
import { Card, SuiviBadge } from '../components/ui';
import { boardActions, localDay, sortActions } from '../lib/suivisPortfolio';
import { RUBRIQUES, type RubriqueInput, type RubriqueKey, type TableauSuivi } from '../services/tableauxSuiviService';

const STATUTS = [
  { value: 'a_faire', label: 'À faire' }, { value: 'en_cours', label: 'En cours' },
  { value: 'bloque', label: 'Bloqué' }, { value: 'termine', label: 'Terminé' },
] as const;
export type DraftState = { dirty: boolean; busy: boolean };
export type ReportDraft = (id: string, state: DraftState | null) => void;
const inputClass = 'mt-1 w-full min-w-0 rounded-lg border border-white/20 bg-bz-dark2 p-2 text-sm text-white';

function RubriqueRow({ tableau, definition, onSave, expanded, onToggle, onDraftState }: {
  tableau: TableauSuivi; definition: typeof RUBRIQUES[number];
  onSave: (key: RubriqueKey, input: RubriqueInput) => Promise<void>;
  expanded: boolean; onToggle: () => void; onDraftState?: ReportDraft;
}) {
  const saved = tableau.rubriques.find(r => r.key === definition.key);
  const initial: RubriqueInput = {
    statut: saved?.statut ?? 'a_faire', date: saved?.date ?? null,
    note: saved?.note ?? '', prochaineAction: saved?.prochaineAction ?? '',
    prochaineActionDebut: saved?.prochaineActionDebut ?? null,
    prochaineActionEcheance: saved?.prochaineActionEcheance ?? null,
    version: 'version' in definition ? saved?.version ?? '' : null,
  };
  const signature = JSON.stringify(initial);
  const [baseline, setBaseline] = useState(signature);
  const [draft, setDraft] = useState<RubriqueInput>(initial);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const dirty = JSON.stringify(draft) !== baseline;
  // Another rubric's response must not replace this rubric's unsaved fields.
  useEffect(() => {
    if (!dirty && !pending.current) { setDraft(JSON.parse(signature)); setBaseline(signature); }
  }, [signature, dirty]);
  const id = `tableau:${tableau.id}:${definition.key}`;
  useEffect(() => { onDraftState?.(id, {dirty, busy}); }, [id, dirty, busy, onDraftState]);
  useEffect(() => () => onDraftState?.(id, null), [id, onDraftState]);
  const change = (field: keyof RubriqueInput, value: string | null) => { setNotice(''); setDraft(d => ({ ...d, [field]: value })); };
  return <div data-rubrique={definition.key} className="min-w-0 border-t border-white/10 py-4">
    <h3 className="mb-2 text-sm font-semibold text-white">
      <button type="button" aria-expanded={expanded} aria-controls={`rubrique-${tableau.id}-${definition.key}`} onClick={onToggle}
        className="flex w-full min-w-0 items-center justify-between gap-2 rounded-lg py-2 text-left hover:text-titan-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-titan-cyan">
        <span className="min-w-0 break-words">{definition.label}</span><span className="shrink-0 text-xs text-titan-cyan">{expanded ? 'Replier −' : tableau.archivedAt ? 'Consulter +' : 'Modifier +'}</span>
      </button>
    </h3>
    <div className="mb-3 grid min-w-0 gap-2 text-sm sm:grid-cols-[8rem_minmax(0,1fr)_10rem]">
      <div><SuiviBadge statut={initial.statut} /></div>
      <p className="min-w-0 whitespace-pre-wrap break-words text-slate-300">{initial.prochaineAction || 'Aucune prochaine action renseignée'}</p>
      <div className="text-slate-400"><p>Date de départ : {initial.prochaineActionDebut || '—'}</p><p>Échéance : {initial.prochaineActionEcheance || '—'}</p></div>
    </div>
    {dirty && <p role="status" className="mb-2 text-xs text-amber-200">Modifications non enregistrées</p>}
    {notice && !dirty && <p role="status" className="mb-2 text-xs text-emerald-300">{notice}</p>}
    {tableau.archivedAt ? <div id={`rubrique-${tableau.id}-${definition.key}`} hidden={!expanded} className="min-w-0 space-y-2 whitespace-pre-wrap break-words text-sm text-slate-300">
      <p>Date du suivi / de la visite : {initial.date || '—'}</p><p>Date de départ : {initial.prochaineActionDebut || '—'}</p><p>Note : {initial.note || '—'}</p>
      <p>Échéance de la prochaine action : {initial.prochaineActionEcheance || '—'}</p>
      {'version' in definition && <p>Version : {initial.version || '—'}</p>}
    </div> : <form id={`rubrique-${tableau.id}-${definition.key}`} hidden={!expanded} onSubmit={async e => {
      e.preventDefault(); if (pending.current || !dirty) return;
      pending.current = true; setBusy(true); setError(''); setNotice('');
      const submitted = {...draft};
      try { await onSave(definition.key, submitted); setBaseline(JSON.stringify(submitted)); setNotice('Enregistré'); }
      catch (err) { setError(`${err instanceof Error ? err.message : 'Erreur de sauvegarde'}. Brouillon conservé.`); }
      finally { pending.current = false; setBusy(false); }
    }}>
      <fieldset disabled={busy} className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-xs text-slate-300">Statut<select aria-label={`Statut — ${definition.label}`} value={draft.statut} onChange={e=>change('statut',e.target.value)} className={inputClass}>{STATUTS.map(s=><option key={s.value} value={s.value}>{s.label}</option>)}</select></label>
        <label className="text-xs text-slate-300">Date du suivi / de la visite<input aria-label={`Date — ${definition.label}`} type="date" value={draft.date ?? ''} onChange={e=>change('date',e.target.value || null)} className={inputClass} /></label>
        {'version' in definition && <label className="text-xs text-slate-300">Version<input aria-label={`Version — ${definition.label}`} value={draft.version ?? ''} onChange={e=>change('version',e.target.value)} className={inputClass} /></label>}
        <label className="text-xs text-slate-300">Note<textarea aria-label={`Note — ${definition.label}`} rows={3} value={draft.note ?? ''} onChange={e=>change('note',e.target.value)} className={inputClass} /></label>
        <label className="text-xs text-slate-300">Prochaine action<textarea aria-label={`Prochaine action — ${definition.label}`} rows={3} value={draft.prochaineAction ?? ''} onChange={e=>change('prochaineAction',e.target.value)} className={inputClass} /></label>
        <label className="text-xs text-slate-300">Date de départ<input aria-label={`Date de départ — ${definition.label}`} type="date" value={draft.prochaineActionDebut ?? ''} onChange={e=>change('prochaineActionDebut',e.target.value || null)} className={inputClass} /></label>
        <label className="text-xs text-slate-300">Échéance de la prochaine action<input aria-label={`Échéance de la prochaine action — ${definition.label}`} type="date" value={draft.prochaineActionEcheance ?? ''} onChange={e=>change('prochaineActionEcheance',e.target.value || null)} className={inputClass} /></label>
      </fieldset>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy || !dirty} className="rounded-lg bg-bz-blue px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Sauvegarde…' : 'Sauvegarder'}</button>
        {error && <span role="alert" className="text-sm text-red-300">{error}</span>}
      </div>
    </form>}
  </div>;
}

export default function SuivisBoard({ tableau, onSave, onDraftState }: {
  tableau: TableauSuivi; onSave: (key: RubriqueKey, input: RubriqueInput) => Promise<void>; onDraftState?: ReportDraft;
}) {
  const [expanded, setExpanded] = useState<Set<RubriqueKey>>(new Set());
  const root = useRef<HTMLDivElement>(null);
  const today = localDay();
  const actions = sortActions(boardActions(tableau));
  const overdue = actions.filter(a=>a.due && a.due<today);
  const statusCount = (status: string) => RUBRIQUES.filter(d=>(tableau.rubriques.find(r=>r.key===d.key)?.statut ?? 'a_faire')===status).length;
  const openAction = (key: RubriqueKey) => {
    setExpanded(previous=>new Set([...previous,key]));
    root.current?.querySelector<HTMLButtonElement>(`[data-rubrique="${key}"] button`)?.focus();
  };
  return <div ref={root}><Card className="mt-4">
    <p className="mb-3 text-xs text-slate-400">Créé le {tableau.createdAt?.slice(0,10) ?? '—'}{tableau.archivedAt && ` · Archivé le ${tableau.archivedAt.slice(0,10)} · Lecture seule`}</p>
    {!tableau.archivedAt && <section aria-label="Résumé du tableau courant" className="mb-4 rounded-xl border border-white/10 bg-white/5 p-3 sm:p-4">
      <h3 className="text-base font-semibold text-white">Vue d’ensemble du client</h3>
      <p className="mt-1 text-xs text-slate-400">Valeurs enregistrées · les brouillons ne modifient pas cette synthèse</p>
      <p className="mt-2 text-sm text-slate-300">{RUBRIQUES.length} rubriques · {statusCount('a_faire')} à faire · {statusCount('en_cours')} en cours · {statusCount('bloque')} bloquée{statusCount('bloque')===1?'':'s'} · {statusCount('termine')} terminée{statusCount('termine')===1?'':'s'} · {actions.length} prochaine{actions.length===1?'':'s'} action{actions.length===1?'':'s'}</p>
      {overdue.length>0 && <p className="mt-2 font-semibold text-red-300">{overdue.length} en retard</p>}
      {['retard','date','sans'].map(group=>{
        const items=actions.filter(a=>group==='retard'?a.due && a.due<today:group==='date'?a.due && a.due>=today:!a.due);
        return items.length>0 && <div key={group} aria-label={group==='retard'?'Actions en retard':group==='date'?'Prochaines actions':'Actions sans échéance'} className="mt-3">
          <h4 className="text-xs font-semibold text-slate-400">{group==='retard'?'En retard':group==='date'?'Aujourd’hui et à venir':'Sans échéance'}</h4>
          <ul className="mt-1 divide-y divide-white/5">{items.map(a=><li key={a.id}><button type="button" onClick={()=>openAction(a.key!)} className="flex w-full flex-wrap items-center justify-between gap-2 py-2 text-left text-sm text-slate-200 hover:text-titan-cyan">
            <span className="min-w-0 break-words"><strong>{RUBRIQUES.find(r=>r.key===a.key)?.label}</strong> : {a.text}</span>
            <span className={group==='retard'?'text-red-300':'text-slate-400'}>{a.due || 'Sans échéance'} · Ouvrir</span>
          </button></li>)}</ul>
        </div>;
      })}
    </section>}
    <div className="mb-2 flex flex-wrap gap-3 text-sm text-titan-cyan">
      <button type="button" onClick={()=>setExpanded(new Set(RUBRIQUES.map(r=>r.key)))} className="rounded-lg border border-white/10 px-3 py-2">Tout déplier</button>
      <button type="button" onClick={()=>setExpanded(new Set())} className="rounded-lg border border-white/10 px-3 py-2">Tout replier</button>
    </div>
    {RUBRIQUES.map(definition=><RubriqueRow key={`${tableau.id}-${definition.key}`} tableau={tableau} definition={definition} onSave={onSave} onDraftState={onDraftState}
      expanded={expanded.has(definition.key)} onToggle={()=>setExpanded(previous=>{const next=new Set(previous);if(next.has(definition.key))next.delete(definition.key);else next.add(definition.key);return next;})} />)}
  </Card></div>;
}
