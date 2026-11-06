import { useEffect, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { Page, PageHeader } from '../layout/Page';
import { Card, SuiviBadge } from '../components/ui';
import { useMetier } from '../hooks/useMetier';
import { useAuth } from '../context/AuthContext';
import { clientsPourPrime, tableauxDuClient, anciensSuivisDuClient } from '../lib/tableauxSuiviView';
import { createTableauSuivi, fetchTableauxSuivi, updateRubriqueSuivi,
  type TableauSuivi, type RubriqueKey, type RubriqueInput } from '../services/tableauxSuiviService';
import type { Suivi } from '../services/dataService';
import SuivisBoard from './SuivisBoard';

function AnciensSuivis({ suivis, titre }: { suivis: Suivi[]; titre: string }) {
  return <section className="mt-5">
    <h3 className="mb-2 text-sm font-semibold text-slate-300">{titre}</h3>
    {suivis.length === 0 ? <p className="text-sm text-slate-500">Aucun ancien suivi.</p> :
      <ul className="space-y-2">{suivis.map(s => <li key={s.id}>
        <Card className="p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium text-white">{s.titre}</span><SuiviBadge statut={s.statut} /></div>
          <p className="mt-1 text-xs text-slate-400">Échéance : {s.echeance || '—'}</p>
          {s.note && <p className="mt-1 whitespace-pre-wrap text-xs text-slate-300">{s.note}</p>}
        </Card>
      </li>)}</ul>}
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
  const anciensClient = anciensSuivisDuClient(suivis, clients, clientId, filtrePrime, isAdmin);
  const sansClient = anciensSuivisDuClient(suivis, clients, null, filtrePrime, isAdmin);

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
    <PageHeader titre="Suivis" sousTitre="Tableaux de suivi par client et anciens suivis conservés en lecture seule." />
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
          <p className="text-xs text-slate-400">Données historiques en lecture seule, sans conversion ni suppression.</p>
          <AnciensSuivis titre={`Suivis de ${client?.nom}`} suivis={anciensClient} />
          {sansClient.length > 0 && <AnciensSuivis titre="Sans client" suivis={sansClient} />}
        </section>
      </> : <>
        <Card className="text-sm text-slate-400">Aucun client pour ce filtre.</Card>
        <section className="mt-7" aria-label="Anciens suivis"><h2 className="text-lg font-bold text-white">Anciens suivis</h2>
          {sansClient.length > 0 && <AnciensSuivis titre="Sans client" suivis={sansClient} />}</section>
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
