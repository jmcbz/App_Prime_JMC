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
import SkillsMatrixPanel from '../components/SkillsMatrixPanel';

const CHAMPS: ChampDef[] = [
  { nom: 'nom', label: 'Nom', type: 'text', requis: true },
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
  const [polyvalence, setPolyvalence] = useState(false);

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
  const searchInput = useRef<HTMLInputElement>(null);

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
        titre={isAdmin ? 'Les Primes' : 'Mon Prime'}
        sousTitre={isAdmin ? 'L’équipe des responsables de clients — chaque Prime et ses clients.' : 'Mon profil Prime et mes clients associés.'}
        action={isAdmin && (
          <button onClick={ouvrirAjout}
            className="inline-flex items-center gap-2 rounded-xl bg-bz-blue px-3.5 py-2 text-sm font-semibold text-white hover:bg-bz-blue2">
            <Plus className="h-4 w-4" /> Ajouter un Prime
          </button>
        )}
      />
      <div className="mb-5 flex flex-wrap gap-2">
        <button className="rounded-xl border border-white/20 px-4 py-2 text-sm text-white" aria-pressed={!polyvalence} onClick={()=>{if(!polyvalence||window.dispatchEvent(new Event('prime-skills:before-leave',{cancelable:true})))setPolyvalence(false);}}>Profils et clients</button>
        <button className="rounded-xl border border-white/20 px-4 py-2 text-sm text-white" aria-pressed={polyvalence} onClick={()=>setPolyvalence(true)}>Maîtrise de polyvalence</button>
      </div>
      <div hidden={!polyvalence}>{polyvalence&&<SkillsMatrixPanel key={`${user?.id}:${user?.role}`}/>}</div>
      <div hidden={polyvalence}>
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
                    </div>
                    <div className="flex items-center gap-2">
                      <DispoPastille dispo={p.effectiveAvailability ?? p.disponibilite} />
                      {p.monthlyCount !== undefined && <span className="text-xs text-slate-400">{p.monthlyCount} tâches ce mois{p.autoCharge ? ' · charge automatique' : ''}</span>}
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
              <input ref={searchInput} id="servo-client-search" type="search" value={recherche}
                aria-controls="servo-client-results" aria-describedby="servo-client-status servo-client-help"
                onKeyDown={(e) => {
                  // Enter searches here; it must not save/close the enclosing Prime form.
                  if (e.key === 'Enter') e.preventDefault();
                }}
                onChange={(e) => setRecherche(e.target.value)} placeholder="Nom ou alias du client"
                className="mb-2 w-full rounded-xl border border-white/10 bg-bz-dark px-3 py-2 text-sm text-white outline-none focus:border-bz-blue" />
              <p id="servo-client-status" role="status" className="mb-1 text-xs text-slate-400">
                {servoLoading ? 'Chargement des clients…' : servoError ? 'Recherche indisponible.' : options.length ? `${options.length} client(s) — cliquez pour ajouter.` : 'Aucun client correspondant à ajouter.'}
              </p>
              <ul id="servo-client-results" aria-label="Résultats clients Servo" aria-busy={servoLoading}
                className="max-h-60 overflow-y-auto rounded-xl border border-white/10 bg-bz-dark">
                {!servoLoading && !servoError && options.map((client) => {
                  const owner = allClients.find((local) => local.servoClientId === client.id)?.primeId;
                  const assignedElsewhere = owner != null && owner !== editId;
                  const otherPrime = assignedElsewhere ? primes.find((p) => p.id === owner) : null;
                  return <li key={client.id}>
                    <button type="button" disabled={assignedElsewhere}
                      onClick={() => {
                        const removed = allClients.find((local) => local.primeId === editId && local.servoClientId === client.id);
                        if (removed) setRemovedClientIds((ids) => ids.filter((id) => id !== removed.id));
                        else setAddedServoIds((ids) => ids.includes(client.id) ? ids : [...ids, client.id]);
                        searchInput.current?.focus();
                      }}
                      className="min-h-11 w-full break-words px-3 py-2 text-left text-sm text-white hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-bz-blue disabled:cursor-not-allowed disabled:text-slate-500">
                      {client.nom}{client.alias ? ` (${client.alias})` : ''}{assignedElsewhere ? ` — déjà attribué à ${otherPrime?.nom ?? 'un autre Prime'}` : ''}
                    </button>
                  </li>;
                })}
              </ul>
              {servoError && <p role="alert" className="mt-1 text-xs text-red-400">{servoError} — les clients déjà associés restent disponibles.</p>}
              <p id="servo-client-help" className="mt-1 text-[11px] text-slate-500">Tab pour parcourir les résultats, Entrée ou Espace pour ajouter. Faites défiler la liste pour voir tous les résultats. Seul « Retirer » enlève une association; « Enregistrer » sauvegarde les changements.</p>
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
      </div>
    </Page>
  );
}
