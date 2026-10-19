import { useState } from 'react';
import { Loader2, Plus, Pencil, Trash2 } from 'lucide-react';
import { Page, PageHeader } from '../layout/Page';
import { Card, SuiviBadge, ConfirmDialog } from '../components/ui';
import EntityFormModal, { type ChampDef } from '../components/EntityFormModal';
import { useMetier } from '../hooks/useMetier';
import { useAuth } from '../context/AuthContext';
import type { StatutSuivi, Suivi, ClientPrime, Prime } from '../services/dataService';
import { createSuivi, updateSuivi, deleteSuivi, type SuiviInput } from '../services/metierAdminService';

const COLONNES: { statut: StatutSuivi; titre: string }[] = [
  { statut: 'a_faire', titre: 'À faire' },
  { statut: 'en_cours', titre: 'En cours' },
  { statut: 'bloque', titre: 'Bloqué' },
  { statut: 'termine', titre: 'Terminé' },
];

function champs(clients: ClientPrime[], primes: Prime[]): ChampDef[] {
  return [
    { nom: 'titre', label: 'Titre', type: 'text', requis: true },
    { nom: 'clientId', label: 'Client', type: 'select', options: [
      { value: '', label: '— Aucun —' },
      ...clients.map((c) => ({ value: String(c.id), label: c.nom })),
    ] },
    { nom: 'primeId', label: 'Prime responsable', type: 'select', options: [
      { value: '', label: '— Aucun —' },
      ...primes.map((p) => ({ value: String(p.id), label: `${p.nom} · ${p.codeTitan}` })),
    ] },
    { nom: 'statut', label: 'Statut', type: 'select', options: [
      { value: 'a_faire', label: 'À faire' },
      { value: 'en_cours', label: 'En cours' },
      { value: 'bloque', label: 'Bloqué' },
      { value: 'termine', label: 'Terminé' },
    ] },
    { nom: 'echeance', label: 'Échéance', type: 'date' },
    { nom: 'note', label: 'Note', type: 'textarea' },
  ];
}

export default function Suivis() {
  const [vue, setVue] = useState<'tableau' | 'liste'>('tableau');
  const { suivis, clients, primes, loading, error, reload } = useMetier();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [form, setForm] = useState<Record<string, unknown> | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [suppr, setSuppr] = useState<Suivi | null>(null);

  const ouvrirAjout = () => { setEditId(null); setForm({ titre: '', clientId: '', primeId: '', statut: 'a_faire', echeance: '', note: '' }); };
  const ouvrirEdition = (s: Suivi) => {
    setEditId(s.id);
    setForm({
      titre: s.titre, clientId: s.clientId == null ? '' : String(s.clientId),
      primeId: s.primeId == null ? '' : String(s.primeId), statut: s.statut,
      echeance: s.echeance ?? '', note: s.note ?? '',
    });
  };

  async function soumettre() {
    const f = form ?? {};
    const payload: SuiviInput = {
      titre: String(f.titre ?? ''),
      clientId: f.clientId ? Number(f.clientId) : null,
      primeId: f.primeId ? Number(f.primeId) : null,
      statut: (f.statut as StatutSuivi) || 'a_faire',
      echeance: f.echeance ? String(f.echeance) : null,
      note: f.note ? String(f.note) : null,
    };
    if (editId) await updateSuivi(editId, payload); else await createSuivi(payload);
    setForm(null); setEditId(null); reload();
  }

  function BoutonsAdmin({ s }: { s: Suivi }) {
    if (!isAdmin) return null;
    return (
      <div className="flex gap-1">
        <button onClick={() => ouvrirEdition(s)} title="Modifier"
          className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-slate-300 hover:text-white">
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button onClick={() => setSuppr(s)} title="Supprimer"
          className="rounded-lg border border-red-500/30 bg-red-500/10 p-1.5 text-red-400 hover:bg-red-500/20">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <Page>
      <PageHeader
        titre="Suivis"
        sousTitre="Tâches et dossiers en cours par client, façon tableau d’opérations."
        action={
          <div className="flex items-center gap-2">
            {isAdmin && (
              <button onClick={ouvrirAjout}
                className="inline-flex items-center gap-2 rounded-xl bg-bz-blue px-3.5 py-2 text-sm font-semibold text-white hover:bg-bz-blue2">
                <Plus className="h-4 w-4" /> Ajouter
              </button>
            )}
            <div className="flex rounded-xl border border-white/10 bg-white/5 p-0.5 text-xs font-medium">
              {(['tableau', 'liste'] as const).map((v) => (
                <button key={v} onClick={() => setVue(v)}
                  className={`rounded-lg px-3 py-1.5 capitalize transition-colors ${vue === v ? 'bg-bz-blue/25 text-white' : 'text-slate-400 hover:text-white'}`}>
                  {v}
                </button>
              ))}
            </div>
          </div>
        }
      />

      {loading && (
        <div className="flex items-center gap-2 px-1 py-8 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
        </div>
      )}
      {error && <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-400">{error}</div>}

      {!loading && !error && (vue === 'tableau' ? (
        <div className="grid gap-4 md:grid-cols-4">
          {COLONNES.map((col) => {
            const items = suivis.filter((s) => s.statut === col.statut);
            return (
              <div key={col.statut}>
                <div className="mb-2 flex items-center justify-between px-1">
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-300">{col.titre}</span>
                  <span className="text-xs text-slate-500">{items.length}</span>
                </div>
                <div className="space-y-2">
                  {items.map((s) => {
                    const client = clients.find((c) => c.id === s.clientId);
                    const prime = primes.find((p) => p.id === s.primeId);
                    return (
                      <Card key={s.id} className="p-3.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="text-sm font-medium text-white">{s.titre}</div>
                          <BoutonsAdmin s={s} />
                        </div>
                        <div className="mt-1 text-xs text-slate-400">{client?.nom}</div>
                        {s.note && <div className="mt-1.5 text-[11px] italic text-slate-500">{s.note}</div>}
                        <div className="mt-2.5 flex items-center justify-between">
                          <span className="text-[11px] text-titan-cyan">{prime?.codeTitan}</span>
                          <span className="text-[11px] text-slate-500">{s.echeance ?? '—'}</span>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-white/5">
            {suivis.map((s) => {
              const client = clients.find((c) => c.id === s.clientId);
              return (
                <li key={s.id} className="flex items-center justify-between px-5 py-3.5">
                  <div>
                    <div className="text-sm font-medium text-white">{s.titre}</div>
                    <div className="text-xs text-slate-400">{client?.nom} • échéance {s.echeance ?? '—'}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <SuiviBadge statut={s.statut} />
                    <BoutonsAdmin s={s} />
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      ))}

      {form && (
        <EntityFormModal
          titre={editId ? 'Modifier le suivi' : 'Ajouter un suivi'}
          champs={champs(clients, primes)}
          valeurs={form}
          onChange={(nom, val) => setForm((f) => ({ ...(f ?? {}), [nom]: val }))}
          onSubmit={soumettre}
          onClose={() => { setForm(null); setEditId(null); }}
        />
      )}
      {suppr && (
        <ConfirmDialog
          titre="Supprimer ce suivi ?"
          message={`« ${suppr.titre} » sera supprimé définitivement.`}
          onConfirm={async () => { await deleteSuivi(suppr.id); setSuppr(null); reload(); }}
          onClose={() => setSuppr(null)}
        />
      )}
    </Page>
  );
}
