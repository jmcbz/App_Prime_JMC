import { useEffect, useState } from 'react';
import { Card, SuiviBadge } from '../components/ui';
import { RUBRIQUES, type RubriqueInput, type RubriqueKey, type TableauSuivi } from '../services/tableauxSuiviService';

const STATUTS = [
  { value: 'a_faire', label: 'À faire' }, { value: 'en_cours', label: 'En cours' },
  { value: 'bloque', label: 'Bloqué' }, { value: 'termine', label: 'Terminé' },
] as const;

function validDay(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function RubriqueRow({ tableau, definition, onSave }: {
  tableau: TableauSuivi;
  definition: typeof RUBRIQUES[number];
  onSave: (key: RubriqueKey, input: RubriqueInput) => Promise<void>;
}) {
  const saved = tableau.rubriques.find(r => r.key === definition.key);
  const initial: RubriqueInput = {
    statut: saved?.statut ?? 'a_faire', date: saved?.date ?? null,
    note: saved?.note ?? '', prochaineAction: saved?.prochaineAction ?? '',
    prochaineActionEcheance: saved?.prochaineActionEcheance ?? null,
    version: 'version' in definition ? saved?.version ?? '' : null,
  };
  const [draft, setDraft] = useState<RubriqueInput>(initial);
  const [expanded, setExpanded] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setDraft(initial); }, [saved?.statut, saved?.date, saved?.note, saved?.prochaineAction, saved?.prochaineActionEcheance, saved?.version, tableau.id]);
  const change = (field: keyof RubriqueInput, value: string | null) => setDraft(d => ({ ...d, [field]: value }));

  return (
    <div data-rubrique={definition.key} className="min-w-0 border-t border-white/10 py-4 first:border-t-0">
      <h3 className="mb-3 text-sm font-semibold text-white">
        <button type="button" aria-expanded={expanded} aria-controls={`rubrique-${tableau.id}-${definition.key}`} onClick={() => setExpanded(value => !value)} className="flex w-full min-w-0 items-center justify-between gap-2 rounded-lg py-1 text-left hover:text-titan-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-titan-cyan">
          <span className="min-w-0 break-words">{definition.label}</span>
          <span aria-hidden="true" className="shrink-0 text-slate-400">{expanded ? '−' : '+'}</span>
        </button>
      </h3>
      {tableau.archivedAt ? (
        <div id={`rubrique-${tableau.id}-${definition.key}`} hidden={!expanded} className={expanded ? 'grid min-w-0 gap-2 break-words text-sm text-slate-300 sm:grid-cols-2 lg:grid-cols-3' : 'hidden'}>
          <div><span className="text-slate-500">Statut : </span><SuiviBadge statut={initial.statut} /></div>
          <div><span className="text-slate-500">Date : </span>{initial.date || '—'}</div>
          <div><span className="text-slate-500">Note : </span>{initial.note || '—'}</div>
          <div><span className="text-slate-500">Prochaine action : </span>{initial.prochaineAction || '—'}</div>
          <div><span className="text-slate-500">Échéance de la prochaine action : </span>{initial.prochaineActionEcheance || '—'}</div>
          {'version' in definition && <div><span className="text-slate-500">Version : </span>{initial.version || '—'}</div>}
        </div>
      ) : (
        <form id={`rubrique-${tableau.id}-${definition.key}`} hidden={!expanded} onSubmit={async e => {
          e.preventDefault(); setBusy(true); setError('');
          try { await onSave(definition.key, draft); }
          catch (err) { setError(err instanceof Error ? err.message : 'Erreur de sauvegarde'); }
          finally { setBusy(false); }
        }}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-xs text-slate-400">Statut
              <select aria-label={`Statut — ${definition.label}`} value={draft.statut} onChange={e => change('statut', e.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-bz-dark2 p-2 text-sm text-white">
                {STATUTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-400">Date
              <input aria-label={`Date — ${definition.label}`} type="date" value={draft.date ?? ''} onChange={e => change('date', e.target.value || null)} className="mt-1 w-full rounded-lg border border-white/10 bg-bz-dark2 p-2 text-sm text-white" />
            </label>
            {'version' in definition && <label className="text-xs text-slate-400">Version
              <input aria-label={`Version — ${definition.label}`} value={draft.version ?? ''} onChange={e => change('version', e.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-bz-dark2 p-2 text-sm text-white" />
            </label>}
            <label className="text-xs text-slate-400">Note
              <textarea aria-label={`Note — ${definition.label}`} value={draft.note ?? ''} onChange={e => change('note', e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-white/10 bg-bz-dark2 p-2 text-sm text-white" />
            </label>
            <label className="text-xs text-slate-400">Prochaine action
              <textarea aria-label={`Prochaine action — ${definition.label}`} value={draft.prochaineAction ?? ''} onChange={e => change('prochaineAction', e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-white/10 bg-bz-dark2 p-2 text-sm text-white" />
            </label>
            <label className="text-xs text-slate-400">Échéance de la prochaine action
              <input aria-label={`Échéance de la prochaine action — ${definition.label}`} type="date" value={draft.prochaineActionEcheance ?? ''} onChange={e => change('prochaineActionEcheance', e.target.value || null)} className="mt-1 w-full rounded-lg border border-white/10 bg-bz-dark2 p-2 text-sm text-white" />
            </label>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <button type="submit" disabled={busy} className="rounded-lg bg-bz-blue px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{busy ? 'Sauvegarde…' : 'Sauvegarder'}</button>
            {error && <span role="alert" className="text-xs text-red-400">{error}</span>}
          </div>
        </form>
      )}
    </div>
  );
}

export default function SuivisBoard({ tableau, onSave }: {
  tableau: TableauSuivi;
  onSave: (key: RubriqueKey, input: RubriqueInput) => Promise<void>;
}) {
  const today = localToday();
  const actions = RUBRIQUES.flatMap(definition => {
    const saved = tableau.rubriques.find(r => r.key === definition.key);
    return saved?.prochaineAction?.trim() && saved.statut !== 'termine'
      ? [{ label: definition.label, text: saved.prochaineAction.trim(), due: saved.prochaineActionEcheance,
        overdue: validDay(saved.prochaineActionEcheance) && saved.prochaineActionEcheance < today }] : [];
  });
  const overdue = actions.filter(action => action.overdue);
  const statusCount = (status: string) => RUBRIQUES.filter(definition =>
    (tableau.rubriques.find(r => r.key === definition.key)?.statut ?? 'a_faire') === status).length;
  return <Card className="mt-4">
    <div className="mb-3 text-xs text-slate-400">Créé le {tableau.createdAt?.slice(0, 10) ?? '—'}{tableau.archivedAt && ` · Archivé le ${tableau.archivedAt.slice(0, 10)}`}</div>
    {!tableau.archivedAt && <section aria-label="Résumé du tableau courant" className="mb-4 rounded-xl border border-white/10 bg-white/5 p-3 sm:p-4">
      <h3 className="text-base font-semibold text-white">Vue d’ensemble du client</h3>
      <p className="mt-1 text-sm text-slate-300">{RUBRIQUES.length} rubriques · {statusCount('a_faire')} à faire · {statusCount('en_cours')} en cours · {statusCount('bloque')} bloquée{statusCount('bloque') === 1 ? '' : 's'} · {statusCount('termine')} terminée{statusCount('termine') === 1 ? '' : 's'} · {actions.length} prochaine{actions.length === 1 ? '' : 's'} action{actions.length === 1 ? '' : 's'}</p>
      {overdue.length > 0 && <div aria-label="Actions en retard" className="mt-3 rounded-lg border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-200">
        <strong>{overdue.length} en retard</strong>
        <ul className="mt-1 space-y-1">{overdue.map(action => <li key={action.label} className="break-words">{action.label} : {action.text} · {action.due}</li>)}</ul>
      </div>}
      {actions.length > 0 && <ul aria-label="Prochaines actions" className="mt-3 space-y-1 text-sm text-slate-300">
        {actions.map(action => <li key={action.label} className="break-words"><span className="font-medium text-white">{action.label}</span> : {action.text}{action.due && ` · ${action.due}`}{action.overdue && <span className="ml-2 font-semibold text-red-300">En retard</span>}</li>)}
      </ul>}
    </section>}
    {RUBRIQUES.map(definition => <RubriqueRow key={`${tableau.id}-${definition.key}`} tableau={tableau} definition={definition} onSave={onSave} />)}
  </Card>;
}
