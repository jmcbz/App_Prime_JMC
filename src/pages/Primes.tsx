import { useRef, useState } from 'react';
import { Loader2, Plus, Pencil, Trash2, X } from 'lucide-react';
import { Page, PageHeader } from '../layout/Page';
import { Card, TitanAvatar, DispoPastille, ConfirmDialog } from '../components/ui';
import EntityFormModal, { type ChampDef } from '../components/EntityFormModal';
import { useMetier } from '../hooks/useMetier';
import { useAuth } from '../context/AuthContext';
import { fetchServoClients, type Prime } from '../services/dataService';
import { createPrime, updatePrimePortfolio, deletePrime, type PrimeInput } from '../services/metierAdminService';
import { filterServoClients, type ServoClient } from '../lib/servoPrimeClients';

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
  const [servoClients, setServoClients] = useState<ServoClient[]>([]);
  const [servoLoading, setServoLoading] = useState(false);
  const [servoError, setServoError] = useState('');
  const [recherche, setRecherche] = useState('');
  const [removedClientIds, setRemovedClientIds] = useState<number[]>([]);
  const [addedServoIds, setAddedServoIds] = useState<number[]>([]);
  const requestId = useRef(0);

  const fermer = () => { requestId.current += 1; setForm(null); setEditId(null); };
  const ouvrirAjout = () => { requestId.current += 1; setEditId(null); setForm({ ...VIDE }); };
  const ouvrirEdition = (p: Prime) => {
    const currentRequest = ++requestId.current;
    setEditId(p.id);
    setForm({ nom: p.nom, codeTitan: p.codeTitan, avatarInitiales: p.avatarInitiales, specialites: p.specialites, disponibilite: p.disponibilite });
    setRemovedClientIds([]);
    setAddedServoIds([]);
    setRecherche('');
    setServoClients([]);
    setServoError('');
    setServoLoading(true);
    void fetchServoClients().then((clients) => {
      if (requestId.current === currentRequest) setServoClients(clients);
    }).catch((e: unknown) => {
      if (requestId.current === currentRequest) setServoError(e instanceof Error ? e.message : 'Liste Servo indisponible');
    }).finally(() => {
      if (requestId.current === currentRequest) setServoLoading(false);
    });
  };

  async function soumettre() {
    const payload = form as unknown as PrimeInput;
    if (editId === null) await createPrime(payload);
    else await updatePrimePortfolio(editId, payload, addedServoIds, removedClientIds);
    fermer();
    reload();
  }

  const selectedLocalClients = allClients.filter((c) => c.primeId === editId && !removedClientIds.includes(c.id));
  const selectedServoClients = servoClients.filter((c) => addedServoIds.includes(c.id));
  const options = filterServoClients(servoClients, recherche).filter((c) =>
    !addedServoIds.includes(c.id) && !selectedLocalClients.some((local) => local.servoClientId === c.id));

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
          onClose={fermer}
        >
          {editId !== null && (
            <div className="border-t border-white/10 pt-3">
              <div className="mb-1 text-xs font-medium text-slate-300">Clients du Prime</div>
              <div className="flex flex-wrap gap-1.5">
                {selectedLocalClients.map((client) => (
                  <span key={`local-${client.id}`} className="inline-flex items-center gap-1 rounded-lg bg-bz-blue/20 px-2 py-1 text-xs text-white">
                    {client.nom}
                    <button type="button" title={`Retirer ${client.nom}`} aria-label={`Retirer ${client.nom}`}
                      onClick={() => setRemovedClientIds((ids) => ids.includes(client.id) ? ids : [...ids, client.id])}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ))}
                {selectedServoClients.map((client) => (
                  <span key={`servo-${client.id}`} className="inline-flex items-center gap-1 rounded-lg bg-titan-violet/20 px-2 py-1 text-xs text-white">
                    {client.nom}
                    <button type="button" title={`Retirer ${client.nom}`} aria-label={`Retirer ${client.nom}`}
                      onClick={() => setAddedServoIds((ids) => ids.filter((id) => id !== client.id))}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ))}
                {!selectedLocalClients.length && !selectedServoClients.length && <span className="text-xs text-slate-500">Aucun client sélectionné</span>}
              </div>
              <label htmlFor="servo-client-search" className="mb-1 mt-3 block text-xs font-medium text-slate-400">Rechercher un client actif dans Servo</label>
              <input id="servo-client-search" type="search" value={recherche}
                onChange={(e) => setRecherche(e.target.value)} placeholder="Nom ou alias du client"
                className="mb-2 w-full rounded-xl border border-white/10 bg-bz-dark px-3 py-2 text-sm text-white outline-none focus:border-bz-blue" />
              <label htmlFor="servo-client-select" className="mb-1 block text-xs font-medium text-slate-400">Ajouter un client</label>
              <select id="servo-client-select" aria-label="Ajouter un client Servo" value=""
                disabled={servoLoading || !!servoError}
                onChange={(e) => {
                  const id = Number(e.target.value);
                  if (!id) return;
                  const removed = allClients.find((client) => client.primeId === editId && client.servoClientId === id);
                  if (removed) setRemovedClientIds((ids) => ids.filter((clientId) => clientId !== removed.id));
                  else setAddedServoIds((ids) => ids.includes(id) ? ids : [...ids, id]);
                }}
                className="w-full rounded-xl border border-white/10 bg-bz-dark px-3 py-2 text-sm text-white outline-none focus:border-bz-blue disabled:opacity-50">
                <option value="">{servoLoading ? 'Chargement des clients…' : '— Sélectionner un client —'}</option>
                {options.map((client) => {
                  const owner = allClients.find((local) => local.servoClientId === client.id)?.primeId;
                  const otherPrime = owner && owner !== editId ? primes.find((p) => p.id === owner) : null;
                  return <option key={client.id} value={client.id} disabled={!!otherPrime}>
                    {client.nom}{client.alias ? ` (${client.alias})` : ''}{otherPrime ? ` — déjà attribué à ${otherPrime.nom}` : ''}
                  </option>;
                })}
              </select>
              {servoError && <p role="alert" className="mt-1 text-xs text-red-400">{servoError} — les clients déjà associés restent disponibles.</p>}
              {!servoLoading && !servoError && <p className="mt-1 text-[11px] text-slate-500">{options.length} client(s) dans la liste. La sélection ajoute un client; seul « Retirer » enlève une association existante.</p>}
            </div>
          )}
        </EntityFormModal>
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
