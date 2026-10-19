import { useState } from 'react';
import { Loader2, Plus, Pencil, Trash2 } from 'lucide-react';
import { Page, PageHeader } from '../layout/Page';
import { Card, ConfirmDialog } from '../components/ui';
import EntityFormModal, { type ChampDef } from '../components/EntityFormModal';
import { useMetier } from '../hooks/useMetier';
import { useAuth } from '../context/AuthContext';
import type { ClientPrime, Prime } from '../services/dataService';
import { createClient, updateClient, deleteClient, type ClientInput } from '../services/metierAdminService';

const STATUT_MAP: Record<ClientPrime['statut'], { label: string; cls: string }> = {
  actif: { label: 'Actif', cls: 'bg-bz-emerald/15 text-bz-emerald border-bz-emerald/30' },
  onboarding: { label: 'Onboarding', cls: 'bg-bz-blue/15 text-bz-blue2 border-bz-blue/30' },
  risque: { label: 'À risque', cls: 'bg-red-500/15 text-red-400 border-red-500/30' },
};

function champs(primes: Prime[]): ChampDef[] {
  return [
    { nom: 'nom', label: 'Nom du client', type: 'text', requis: true },
    { nom: 'secteur', label: 'Secteur', type: 'text', placeholder: 'Ex. Municipal' },
    { nom: 'primeId', label: 'Prime responsable', type: 'select', options: [
      { value: '', label: '— Aucun —' },
      ...primes.map((p) => ({ value: String(p.id), label: `${p.nom} · ${p.codeTitan}` })),
    ] },
    { nom: 'statut', label: 'Statut', type: 'select', options: [
      { value: 'actif', label: 'Actif' },
      { value: 'onboarding', label: 'Onboarding' },
      { value: 'risque', label: 'À risque' },
    ] },
  ];
}

export default function Clients() {
  const { primes, clients, loading, error, reload } = useMetier();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [form, setForm] = useState<Record<string, unknown> | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [suppr, setSuppr] = useState<ClientPrime | null>(null);

  const ouvrirAjout = () => { setEditId(null); setForm({ nom: '', secteur: '', primeId: '', statut: 'actif' }); };
  const ouvrirEdition = (c: ClientPrime) => {
    setEditId(c.id);
    setForm({ nom: c.nom, secteur: c.secteur, primeId: c.primeId == null ? '' : String(c.primeId), statut: c.statut });
  };

  async function soumettre() {
    const f = form ?? {};
    const payload: ClientInput = {
      nom: String(f.nom ?? ''),
      secteur: String(f.secteur ?? ''),
      primeId: f.primeId ? Number(f.primeId) : null,
      statut: (f.statut as ClientPrime['statut']) || 'actif',
    };
    if (editId) await updateClient(editId, payload); else await createClient(payload);
    setForm(null); setEditId(null); reload();
  }

  return (
    <Page>
      <PageHeader
        titre="Clients"
        sousTitre="Portefeuille clients et le Prime responsable associé à chacun."
        action={isAdmin && (
          <button onClick={ouvrirAjout}
            className="inline-flex items-center gap-2 rounded-xl bg-bz-blue px-3.5 py-2 text-sm font-semibold text-white hover:bg-bz-blue2">
            <Plus className="h-4 w-4" /> Ajouter un client
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
      <Card className="overflow-hidden p-0">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-white/10 text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-5 py-3 font-semibold">Client</th>
              <th className="px-5 py-3 font-semibold">Secteur</th>
              <th className="px-5 py-3 font-semibold">Prime responsable</th>
              <th className="px-5 py-3 font-semibold">Statut</th>
              {isAdmin && <th className="px-5 py-3 font-semibold text-right">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {clients.map((c) => {
              const prime = primes.find((p) => p.id === c.primeId);
              const st = STATUT_MAP[c.statut];
              return (
                <tr key={c.id} className="hover:bg-white/5">
                  <td className="px-5 py-3 font-medium text-white">{c.nom}</td>
                  <td className="px-5 py-3 text-slate-300">{c.secteur}</td>
                  <td className="px-5 py-3 text-slate-200">
                    {prime ? <>{prime.nom} <span className="text-titan-cyan">· {prime.codeTitan}</span></> : <span className="text-slate-500">—</span>}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${st.cls}`}>
                      {st.label}
                    </span>
                  </td>
                  {isAdmin && (
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => ouvrirEdition(c)} title="Modifier"
                          className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-slate-300 hover:text-white">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => setSuppr(c)} title="Supprimer"
                          className="rounded-lg border border-red-500/30 bg-red-500/10 p-1.5 text-red-400 hover:bg-red-500/20">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      )}

      {form && (
        <EntityFormModal
          titre={editId ? 'Modifier le client' : 'Ajouter un client'}
          champs={champs(primes)}
          valeurs={form}
          onChange={(nom, val) => setForm((f) => ({ ...(f ?? {}), [nom]: val }))}
          onSubmit={soumettre}
          onClose={() => { setForm(null); setEditId(null); }}
        />
      )}
      {suppr && (
        <ConfirmDialog
          titre="Supprimer ce client ?"
          message={`« ${suppr.nom} » et ses suivis associés seront supprimés définitivement.`}
          onConfirm={async () => { await deleteClient(suppr.id); setSuppr(null); reload(); }}
          onClose={() => setSuppr(null)}
        />
      )}
    </Page>
  );
}
