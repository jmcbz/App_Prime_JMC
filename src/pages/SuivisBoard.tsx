import { useEffect, useState } from 'react';
import { Card, SuiviBadge } from '../components/ui';
import { RUBRIQUES, type RubriqueInput, type RubriqueKey, type TableauSuivi } from '../services/tableauxSuiviService';

const STATUTS = [
  { value: 'a_faire', label: 'À faire' }, { value: 'en_cours', label: 'En cours' },
  { value: 'bloque', label: 'Bloqué' }, { value: 'termine', label: 'Terminé' },
] as const;

function RubriqueRow({ tableau, definition, onSave }: {
  tableau: TableauSuivi;
  definition: typeof RUBRIQUES[number];
  onSave: (key: RubriqueKey, input: RubriqueInput) => Promise<void>;
}) {
  const saved = tableau.rubriques.find(r => r.key === definition.key);
  const initial: RubriqueInput = {
    statut: saved?.statut ?? 'a_faire', date: saved?.date ?? null,
    note: saved?.note ?? '', prochaineAction: saved?.prochaineAction ?? '',
    version: 'version' in definition ? saved?.version ?? '' : null,
  };
  const [draft, setDraft] = useState<RubriqueInput>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setDraft(initial); }, [saved?.statut, saved?.date, saved?.note, saved?.prochaineAction, saved?.version, tableau.id]);
  const change = (field: keyof RubriqueInput, value: string | null) => setDraft(d => ({ ...d, [field]: value }));

  return (
    <div className="border-t border-white/10 py-4 first:border-t-0">
      <h3 className="mb-3 text-sm font-semibold text-white">{definition.label}</h3>
      {tableau.archivedAt ? (
        <div className="grid gap-2 text-sm text-slate-300 sm:grid-cols-2 lg:grid-cols-5">
          <div><span className="text-slate-500">Statut : </span><SuiviBadge statut={initial.statut} /></div>
          <div><span className="text-slate-500">Date : </span>{initial.date || '—'}</div>
          <div><span className="text-slate-500">Note : </span>{initial.note || '—'}</div>
          <div><span className="text-slate-500">Prochaine action : </span>{initial.prochaineAction || '—'}</div>
          {'version' in definition && <div><span className="text-slate-500">Version : </span>{initial.version || '—'}</div>}
        </div>
      ) : (
        <form onSubmit={async e => {
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
  return <Card className="mt-4">
    <div className="mb-3 text-xs text-slate-400">Créé le {tableau.createdAt?.slice(0, 10) ?? '—'}{tableau.archivedAt && ` · Archivé le ${tableau.archivedAt.slice(0, 10)}`}</div>
    {RUBRIQUES.map(definition => <RubriqueRow key={`${tableau.id}-${definition.key}`} tableau={tableau} definition={definition} onSave={onSave} />)}
  </Card>;
}
