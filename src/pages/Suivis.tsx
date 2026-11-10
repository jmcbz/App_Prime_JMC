import { useEffect, useRef, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { Page, PageHeader } from '../layout/Page';
import { Card, SuiviBadge } from '../components/ui';
import { useMetier } from '../hooks/useMetier';
import { useAuth } from '../context/AuthContext';
import { clientsPourPrime, tableauxDuClient, anciensSuivisDuClient } from '../lib/tableauxSuiviView';
import { createTableauSuivi, fetchTableauxSuivi, updateRubriqueSuivi,
  type TableauSuivi, type RubriqueKey, type RubriqueInput } from '../services/tableauxSuiviService';
import { fetchSuivis, type StatutSuivi, type Suivi } from '../services/dataService';
import { appendSuiviComplement, fetchSuiviComplements, type SuiviComplement } from '../services/suiviComplementsService';
import SuivisBoard from './SuivisBoard';

const STATUTS: { value: StatutSuivi; label: string }[] = [
  { value: 'a_faire', label: 'À faire' }, { value: 'en_cours', label: 'En cours' },
  { value: 'bloque', label: 'Bloqué' }, { value: 'termine', label: 'Terminé' },
];
const statutLabel = (value: StatutSuivi) => STATUTS.find(s => s.value === value)?.label ?? value;

function AncienSuiviCard({ initial, onConfirmed }: { initial: Suivi; onConfirmed: (suivi: Suivi) => void }) {
  const [suivi, setSuivi] = useState(initial);
  const [open, setOpen] = useState(false);
  const [statut, setStatut] = useState<StatutSuivi>(initial.statut);
  const [echeance, setEcheance] = useState(initial.echeance ?? '');
  const [note, setNote] = useState('');
  const [history, setHistory] = useState<SuiviComplement[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [saving, setSaving] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [needsReview, setNeedsReview] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  const pending = useRef(false);
  const mutationVersion = useRef(0);
  const generation = useRef(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const refreshRef = useRef<HTMLButtonElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  useEffect(() => () => { alive.current = false; generation.current++; }, []);
  useEffect(() => {
    if (!confirmClose) return;
    const opener = document.activeElement;
    const dialog = dialogRef.current;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
    focusable()[0]?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!pending.current) setConfirmClose(false);
      } else if (event.key === 'Tab') {
        const controls = focusable();
        const index = controls.indexOf(document.activeElement as HTMLButtonElement);
        if (!controls.length) { event.preventDefault(); return; }
        if (event.shiftKey && index <= 0) { event.preventDefault(); controls[controls.length - 1].focus(); }
        else if (!event.shiftKey && (index === controls.length - 1 || index === -1)) { event.preventDefault(); controls[0].focus(); }
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const target = opener?.isConnected && !(opener as HTMLButtonElement).disabled ? opener as HTMLElement :
        refreshRef.current?.isConnected && !refreshRef.current.disabled ? refreshRef.current : toggleRef.current;
      target?.focus();
    };
  }, [confirmClose]);

  async function loadHistory(before?: number) {
    const request = ++generation.current;
    setLoadingHistory(true);
    try {
      const page = await fetchSuiviComplements(suivi.id, before);
      if (!alive.current || request !== generation.current) return;
      setHistory(previous => before === undefined ? page.complements : [...previous, ...page.complements.filter(c => !previous.some(p => p.id === c.id))]);
      setHasMore(page.hasMore);
      setNextBefore(page.nextBefore);
    } catch (e) {
      if (alive.current && request === generation.current) setError(e instanceof Error ? e.message : 'Historique indisponible');
    } finally { if (alive.current && request === generation.current) setLoadingHistory(false); }
  }
  function toggle() {
    if (!open) void loadHistory();
    setOpen(value => !value);
  }
  async function refresh() {
    if (pending.current || refreshing) return;
    const version = mutationVersion.current;
    setRefreshing(true);
    try {
      const list = await fetchSuivis();
      if (!alive.current || pending.current || version !== mutationVersion.current) return;
      const latest = list.find(s => s.id === suivi.id);
      if (!latest) throw new Error('Suivi introuvable après actualisation');
      const latestEcheance = latest.echeance ?? '';
      const priorEcheance = suivi.echeance ?? '';
      const divergent = (statut !== suivi.statut && latest.statut !== suivi.statut && statut !== latest.statut) ||
        (echeance !== priorEcheance && latestEcheance !== priorEcheance && echeance !== latestEcheance);
      if (statut === suivi.statut) setStatut(latest.statut);
      if (echeance === priorEcheance) setEcheance(latestEcheance);
      setSuivi(latest);
      onConfirmed(latest);
      setBlocked(false);
      setNeedsReview(divergent);
      setError('');
      if (open) void loadHistory();
    } catch (e) {
      if (alive.current && !pending.current && version === mutationVersion.current) setError(e instanceof Error ? e.message : 'Actualisation impossible');
    } finally { if (alive.current && version === mutationVersion.current) setRefreshing(false); }
  }
  const hasComplement = !!note.trim() || statut !== suivi.statut || (echeance || null) !== (suivi.echeance || null);
  async function save() {
    if (pending.current || blocked || needsReview || suivi.statut === 'termine' || !hasComplement) return;
    pending.current = true;
    mutationVersion.current++; // Invalider les GET antérieurs même si le POST échoue.
    setSaving(true); setError('');
    try {
      const result = await appendSuiviComplement(suivi.id, {
        statut, echeance: echeance || null, note: note.trim(), expectedLastId: suivi.dernierComplementId ?? null,
      });
      if (!alive.current) return;
      mutationVersion.current++;
      generation.current++; // Une réponse GET plus ancienne ne doit pas écraser le POST.
      setLoadingHistory(false);
      setSuivi(result.suivi);
      onConfirmed(result.suivi);
      setStatut(result.suivi.statut);
      setEcheance(result.suivi.echeance ?? '');
      setHistory(previous => [result.complement, ...previous.filter(c => c.id !== result.complement.id)]);
      // Reprendre la pagination sur l'état confirmé, pas sur un GET pré-POST devenu caduc.
      void loadHistory();
      setNote('');
      setConfirmClose(false);
    } catch (e) {
      if (alive.current) {
        setBlocked(true); // Même une réponse réseau perdue peut cacher un POST réussi.
        setConfirmClose(false);
        setError(`${e instanceof Error ? e.message : 'Enregistrement incertain'}. Actualisez le suivi avant de réessayer; votre brouillon est conservé.`);
      }
    } finally {
      mutationVersion.current++;
      pending.current = false;
      if (alive.current) { setSaving(false); setRefreshing(false); }
    }
  }

  return <Card className="min-w-0 p-3 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-2"><span className="min-w-0 break-words font-medium text-white">{suivi.titre}</span><SuiviBadge statut={suivi.statut} /></div>
    <p className="mt-1 text-xs text-slate-400">Échéance actuelle : {suivi.echeance || '—'}</p>
    {suivi.note && <p className="mt-1 whitespace-pre-wrap break-words text-xs text-slate-300">{suivi.note}</p>}
    <button ref={toggleRef} type="button" aria-expanded={open} onClick={toggle} className="mt-3 rounded-xl border border-white/20 px-3 py-2 text-left text-sm text-titan-cyan hover:text-white">
      {suivi.statut === 'termine' ? 'Voir les compléments' : 'Compléter le suivi'} {open ? '−' : '+'}
    </button>
    {open && <div className="mt-4 space-y-4 border-t border-white/10 pt-4">
      <div className="rounded-xl bg-white/5 p-3 text-xs text-slate-300">
        <p>Statut initial : {statutLabel(suivi.initialStatut ?? initial.statut)}</p>
        <p>Échéance initiale : {suivi.initialEcheance ?? initial.echeance ?? '—'}</p>
        {suivi.note && <p className="mt-1 whitespace-pre-wrap break-words">Note originale : {suivi.note}</p>}
      </div>
      <div aria-label="Historique des compléments">
        <h4 className="font-semibold text-white">Compléments datés</h4>
        {history.map(c => <div key={c.id} className="mt-2 border-l-2 border-white/20 pl-3 text-xs text-slate-300">
          <time dateTime={c.createdAt}>{new Date(c.createdAt).toLocaleString('fr-CA')}</time> · {statutLabel(c.statut)} · Échéance : {c.echeance || '—'}
          {c.note && <p className="mt-1 whitespace-pre-wrap break-words">{c.note}</p>}
        </div>)}
        {loadingHistory && <p className="mt-2 text-xs text-slate-400">Chargement de l’historique…</p>}
        {hasMore && nextBefore !== null && <button type="button" disabled={loadingHistory} onClick={() => void loadHistory(nextBefore)} className="mt-2 rounded-xl border border-white/20 px-3 py-2 text-titan-cyan disabled:opacity-50">Afficher les compléments précédents</button>}
      </div>
      {suivi.statut !== 'termine' && <div className="grid gap-3">
        <label className="grid gap-1 text-slate-300">Statut
          <select aria-label="Nouveau statut" disabled={saving || refreshing} value={statut} onChange={e => setStatut(e.target.value as StatutSuivi)} className="w-full rounded-xl border border-white/20 bg-bz-dark2 px-3 py-2 text-white">
            {STATUTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-slate-300">Échéance
          <input aria-label="Nouvelle échéance" type="date" disabled={saving || refreshing} value={echeance} onChange={e => setEcheance(e.target.value)} className="w-full min-w-0 rounded-xl border border-white/20 bg-bz-dark2 px-3 py-2 text-white" />
        </label>
        <label className="grid gap-1 text-slate-300">Nouvelle note
          <textarea aria-label="Nouvelle note" rows={3} disabled={saving || refreshing} value={note} onChange={e => setNote(e.target.value)} className="w-full min-w-0 rounded-xl border border-white/20 bg-bz-dark2 px-3 py-2 text-white" />
        </label>
        <button type="button" disabled={saving || refreshing || blocked || needsReview || !hasComplement} onClick={() => statut === 'termine' ? setConfirmClose(true) : void save()} className="w-full rounded-xl bg-bz-blue px-3 py-2 font-semibold text-white disabled:opacity-50 sm:w-fit">{saving ? 'Enregistrement…' : 'Enregistrer le complément'}</button>
      </div>}
      {(error || needsReview) && <div role="alert" className="rounded-xl border border-red-500/30 p-3 text-red-300">
        {needsReview && <p>Statut ou échéance modifié sur le serveur ({statutLabel(suivi.statut)}, {suivi.echeance || '—'}). Vérifiez vos choix avant de réessayer.</p>}
        {error}
        {needsReview && <button type="button" onClick={() => { setNeedsReview(false); setError(''); }} className="ml-2 underline">Confirmer mes choix</button>}
        <button ref={refreshRef} type="button" disabled={refreshing || saving} onClick={() => void refresh()} className="ml-2 underline disabled:opacity-50">{refreshing ? 'Actualisation…' : 'Actualiser le suivi'}</button>
      </div>}
    </div>}
    {confirmClose && <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Confirmer la clôture du suivi" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-2xl border border-white/20 bg-bz-dark2 p-5 text-white">
        <h3 className="text-lg font-bold">Clôturer définitivement ce suivi ?</h3>
        <p className="mt-2 text-sm text-slate-300">Après confirmation, ce suivi et ses compléments seront en lecture seule. L’original restera conservé.</p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" disabled={saving} onClick={() => setConfirmClose(false)} className="rounded-xl border border-white/20 px-4 py-2">Annuler</button>
          <button type="button" disabled={saving} onClick={() => void save()} className="rounded-xl bg-bz-blue px-4 py-2 font-semibold disabled:opacity-50">Confirmer la clôture</button>
        </div>
      </div>
    </div>}
  </Card>;
}

function AnciensSuivis({ suivis, titre, identity, onConfirmed }: { suivis: Suivi[]; titre: string; identity: string; onConfirmed: (suivi: Suivi) => void }) {
  return <section className="mt-5">
    <h3 className="mb-2 text-sm font-semibold text-slate-300">{titre}</h3>
    {suivis.length === 0 ? <p className="text-sm text-slate-500">Aucun ancien suivi.</p> :
      <ul className="space-y-2">{suivis.map(s => <li key={`${identity}:${s.id}`}><AncienSuiviCard initial={s} onConfirmed={onConfirmed} /></li>)}</ul>}
  </section>;
}

export default function Suivis() {
  const { suivis, clients, primes, loading, error } = useMetier();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [filtrePrime, setFiltrePrime] = useState('tous');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tableaux, setTableaux] = useState<TableauSuivi[]>([]);
  const [boardsLoading, setBoardsLoading] = useState(true);
  const [boardError, setBoardError] = useState('');
  const [showArchives, setShowArchives] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  const [creating, setCreating] = useState(false);
  const [creationUncertain, setCreationUncertain] = useState(false);
  const [confirmed, setConfirmed] = useState<{ owner: number; items: Record<number, Suivi> } | null>(null);
  const onConfirmed = (owner: number | undefined, updated: Suivi) => {
    if (owner === undefined) return;
    setConfirmed(previous => ({ owner, items: { ...(previous?.owner === owner ? previous.items : {}), [updated.id]: updated } }));
  };

  async function refreshBoards() {
    const list = await fetchTableauxSuivi();
    setTableaux(list);
    setBoardError('');
  }
  async function retryBoards() {
    setBoardsLoading(true);
    try { await refreshBoards(); setCreationUncertain(false); }
    catch (e) { setBoardError(e instanceof Error ? e.message : 'Erreur de synchronisation des tableaux'); }
    finally { setBoardsLoading(false); }
  }
  useEffect(() => {
    let cancelled = false;
    fetchTableauxSuivi().then(list => { if (!cancelled) setTableaux(list); })
      .catch(e => { if (!cancelled) setBoardError(e instanceof Error ? e.message : 'Erreur de chargement des tableaux'); })
      .finally(() => { if (!cancelled) setBoardsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const visibleClients = clientsPourPrime(clients, filtrePrime, isAdmin);
  const clientId = visibleClients.some(c => c.id === selectedId) ? selectedId : visibleClients[0]?.id ?? null;
  const client = visibleClients.find(c => c.id === clientId);
  const clientBoards = clientId === null ? [] : tableauxDuClient(tableaux, clientId);
  const active = clientBoards.find(t => t.archivedAt === null);
  const archives = clientBoards.filter(t => t.archivedAt !== null);
  const visibleSuivis = confirmed && user && confirmed.owner === user.id ? suivis.map(s => confirmed.items[s.id] ?? s) : suivis;
  const anciensClient = anciensSuivisDuClient(visibleSuivis, clients, clientId, filtrePrime, isAdmin);
  const sansClient = anciensSuivisDuClient(visibleSuivis, clients, null, filtrePrime, isAdmin);

  async function createBoard() {
    if (clientId === null) return;
    setCreating(true); setBoardError('');
    try {
      const created = await createTableauSuivi(clientId, active?.id ?? null);
      setTableaux(previous => [
        ...previous.map(t => t.clientId === clientId && t.archivedAt === null
          ? { ...t, archivedAt: created.createdAt } : t),
        created,
      ]);
      setShowArchives(false); setConfirmNew(false); setCreationUncertain(false);
      try { await refreshBoards(); }
      catch (e) { setBoardError(`Nouveau tableau créé; synchronisation indisponible. ${e instanceof Error ? e.message : 'Réessayez le chargement.'}`); }
    } catch (e) {
      setConfirmNew(false);
      setCreationUncertain(true);
      setBoardError(`Résultat de création incertain. Synchronisez les tableaux avant toute autre création. ${e instanceof Error ? e.message : ''}`);
    }
    finally { setCreating(false); }
  }
  async function saveRubrique(tableauId: number, key: RubriqueKey, input: RubriqueInput) {
    const updated = await updateRubriqueSuivi(tableauId, key, input);
    setTableaux(previous => previous.map(t => t.id === updated.id ? updated : t));
  }

  return <Page>
    <PageHeader titre="Suivis" sousTitre="Tableaux de suivi par client et anciens suivis conservés avec compléments datés." />
    {isAdmin && <label className="mb-4 flex items-center gap-2 text-sm text-slate-300">
      Filtrer par Prime
      <select aria-label="Filtrer par Prime" value={filtrePrime} onChange={e => { setFiltrePrime(e.target.value); setShowArchives(false); }} className="rounded-xl border border-white/10 bg-bz-dark2 px-3 py-2 text-white">
        <option value="tous">Tous les Primes</option>
        {primes.map(p => <option key={p.id} value={String(p.id)}>{p.nom} · {p.codeTitan}</option>)}
        <option value="sans">Sans Prime</option>
      </select>
    </label>}
    {(loading || boardsLoading) && <div className="flex items-center gap-2 py-6 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Chargement…</div>}
    {(error || boardError) && <div role="alert" className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
      {error || boardError}
      {boardError && <button type="button" onClick={() => void retryBoards()} className="ml-3 underline">Réessayer la synchronisation</button>}
    </div>}
    {!loading && !boardsLoading && !error && <>
      {visibleClients.length > 0 ? <>
        <label className="mb-4 block text-sm text-slate-300">Client
          <select aria-label="Client" value={clientId ?? ''} onChange={e => { setSelectedId(Number(e.target.value)); setShowArchives(false); }} className="mt-1 block w-full max-w-md rounded-xl border border-white/10 bg-bz-dark2 px-3 py-2 text-white">
            {visibleClients.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
          </select>
        </label>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
          <h2 className="text-lg font-bold text-white">{client?.nom}</h2>
          <button type="button" disabled={creating || creationUncertain || (!!boardError && !active)} onClick={() => active ? setConfirmNew(true) : void createBoard()} className="inline-flex items-center gap-2 rounded-xl bg-bz-blue px-3.5 py-2 text-sm font-semibold text-white hover:bg-bz-blue2 disabled:opacity-50">
            <Plus className="h-4 w-4" /> {creating ? 'Création…' : 'Nouveau tableau'}
          </button>
        </div>
        {active ? <SuivisBoard key={active.id} tableau={active} onSave={(key, input) => saveRubrique(active.id, key, input)} /> :
          <Card className="mt-4 text-sm text-slate-400">Aucun tableau courant pour ce client. Créez-en un pour commencer.</Card>}
        {archives.length > 0 && <section className="mt-6">
          <button type="button" aria-expanded={showArchives} onClick={() => setShowArchives(v => !v)} className="text-sm font-semibold text-titan-cyan hover:text-white">Historique des tableaux ({archives.length}) {showArchives ? '−' : '+'}</button>
          {showArchives && archives.map(t => <SuivisBoard key={t.id} tableau={t} onSave={async () => {}} />)}
        </section>}
        <section className="mt-7 border-t border-white/10 pt-4" aria-label="Anciens suivis">
          <h2 className="text-lg font-bold text-white">Anciens suivis</h2>
          <p className="text-xs text-slate-400">Originaux conservés sans conversion ni suppression; les compléments s’ajoutent à l’historique.</p>
          <AnciensSuivis key={`${user?.id}:${clientId}:${filtrePrime}`} identity={`${user?.id}:${clientId}:${filtrePrime}`} titre={`Suivis de ${client?.nom}`} suivis={anciensClient} onConfirmed={updated => onConfirmed(user?.id, updated)} />
          {sansClient.length > 0 && <AnciensSuivis key={`${user?.id}:sans:${filtrePrime}`} identity={`${user?.id}:sans:${filtrePrime}`} titre="Sans client" suivis={sansClient} onConfirmed={updated => onConfirmed(user?.id, updated)} />}
        </section>
      </> : <>
        <Card className="text-sm text-slate-400">Aucun client pour ce filtre.</Card>
        <section className="mt-7" aria-label="Anciens suivis"><h2 className="text-lg font-bold text-white">Anciens suivis</h2>
          {sansClient.length > 0 && <AnciensSuivis key={`${user?.id}:sans:${filtrePrime}`} identity={`${user?.id}:sans:${filtrePrime}`} titre="Sans client" suivis={sansClient} onConfirmed={updated => onConfirmed(user?.id, updated)} />}</section>
      </>}
    </>}
    {confirmNew && <div role="dialog" aria-modal="true" aria-labelledby="archive-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-bz-dark2 p-5 shadow-titan">
        <h2 id="archive-title" className="text-lg font-bold text-white">Archiver le tableau courant ?</h2>
        <p className="mt-2 text-sm text-slate-300">Le tableau actuel de « {client?.nom} » sera archivé en lecture seule et un nouveau tableau vide sera créé.</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => setConfirmNew(false)} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-white">Annuler</button>
          <button type="button" disabled={creating} onClick={() => void createBoard()} className="rounded-xl bg-bz-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{creating ? 'Création…' : 'Créer et archiver'}</button>
        </div>
      </div>
    </div>}
  </Page>;
}
