import { useState } from 'react';
import { Loader2, Plus, Pencil, Trash2 } from 'lucide-react';
import { Page, PageHeader } from '../layout/Page';
import { Card, TitanAvatar, DispoPastille, ConfirmDialog } from '../components/ui';
import EntityFormModal, { type ChampDef } from '../components/EntityFormModal';
import { useMetier } from '../hooks/useMetier';
import { useAuth } from '../context/AuthContext';
import type { Prime } from '../services/dataService';
import { createPrime, updatePrime, deletePrime, type PrimeInput } from '../services/metierAdminService';

const CHAMPS: ChampDef[] = [
  { nom: 'nom', label: 'Nom', type: 'text', requis: true },
  { nom: 'codeTitan', label: 'Code Titan', type: 'text', placeholder: 'Ex. Nightwing' },
  { nom: 'avatarInitiales', label: 'Initiales (avatar)', type: 'text', placeholder: 'Ex. JM' },
  { nom: 'specialites', label: 'Spécialités', type: 'tags', aide: 'Séparées par des virgules' },
  { nom: 'disponibilite', label: 'Disponibilité', type: 'select', options: [
    { value: 'disponible', label: 'Disponible' },
    { value: 'charge', label: 'Chargé' },
    { value: 'surcharge', label: 'Surchargé' },
  ] },
];

const VIDE: PrimeInput = { nom: '', codeTitan: '', avatarInitiales: '', specialites: [], disponibilite: 'disponible' };

export default function Primes() {
  const { primes, clients: allClients, loading, error, reload } = useMetier();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [form, setForm] = useState<Record<string, unknown> | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [suppr, setSuppr] = useState<Prime | null>(null);

  const ouvrirAjout = () => { setEditId(null); setForm({ ...VIDE }); };
  const ouvrirEdition = (p: Prime) => {
    setEditId(p.id);
    setForm({ nom: p.nom, codeTitan: p.codeTitan, avatarInitiales: p.avatarInitiales, specialites: p.specialites, disponibilite: p.disponibilite });
  };

  async function soumettre() {
    const payload = form as unknown as PrimeInput;
    if (editId) await updatePrime(editId, payload); else await createPrime(payload);
    setForm(null); setEditId(null); reload();
  }

  return (
    <Page>
      <PageHeader
        titre="Les Primes"
        sousTitre="L’équipe des responsables de clients — chaque Prime, son code Titan et ses clients."
        action={isAdmin && (
          <button onClick={ouvrirAjout}
            className="inline-flex items-center gap-2 rounded-xl bg-bz-blue px-3.5 py-2 text-sm font-semibold text-white hover:bg-bz-blue2">
            <Plus className="h-4 w-4" /> Ajouter un Prime
          </button>
        )}
      />
      {loading && (
        <div className="flex items-center gap-2 px-1 py-8 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
        </div>
      )}
      {error && <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-400">{error}</div>}
      {!loading && !error && (
      <div className="grid gap-4 sm:grid-cols-2">
        {primes.map((p) => {
          const clients = allClients.filter((c) => p.clientsIds.includes(c.id));
          return (
            <Card key={p.id}>
              <div className="flex items-start gap-4">
                <TitanAvatar initiales={p.avatarInitiales} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="font-bold text-white">{p.nom}</div>
                      <div className="text-xs font-medium text-titan-cyan">Code Titan · {p.codeTitan}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <DispoPastille dispo={p.disponibilite} />
                      {isAdmin && (
                        <div className="flex gap-1">
                          <button onClick={() => ouvrirEdition(p)} title="Modifier"
                            className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-slate-300 hover:text-white">
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => setSuppr(p)} title="Supprimer"
                            className="rounded-lg border border-red-500/30 bg-red-500/10 p-1.5 text-red-400 hover:bg-red-500/20">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {p.specialites.map((s) => (
                      <span key={s} className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-[11px] text-slate-300">
                        {s}
                      </span>
                    ))}
                  </div>

                  <div className="mt-4 border-t border-white/10 pt-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Clients ({clients.length})
                    </div>
                    <ul className="mt-1.5 space-y-0.5">
                      {clients.map((c) => (
                        <li key={c.id} className="text-sm text-slate-200">{c.nom}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
      )}

      {form && (
        <EntityFormModal
          titre={editId ? 'Modifier le Prime' : 'Ajouter un Prime'}
          champs={CHAMPS}
          valeurs={form}
          onChange={(nom, val) => setForm((f) => ({ ...(f ?? {}), [nom]: val }))}
          onSubmit={soumettre}
          onClose={() => { setForm(null); setEditId(null); }}
        />
      )}
      {suppr && (
        <ConfirmDialog
          titre="Supprimer ce Prime ?"
          message={`« ${suppr.nom} » sera retiré. Les clients associés perdront leur responsable (non supprimés).`}
          onConfirm={async () => { await deletePrime(suppr.id); setSuppr(null); reload(); }}
          onClose={() => setSuppr(null)}
        />
      )}
    </Page>
  );
}
