import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useBlocker } from 'react-router-dom';
import { Page, PageHeader } from '../layout/Page';
import { Card } from '../components/ui';
import { archiveClientOnboarding, createClientOnboarding, createTemplateItems, getClientOnboarding, getClientOnboardingHistory, getCompleteOnboardingHistory, getOnboardingOptions, listClientOnboardings, onboardingPriorities, onboardingStatuses, reconcileClientOnboarding, restoreClientOnboarding, updateClientOnboarding, type ClientOnboarding as Onboarding, type ClientOnboardingItem as Item, type ClientOnboardingHistory, type OnboardingOptions, type OnboardingReconciliation } from '../services/clientOnboardingService';
import { exportOnboardingPdf, exportOnboardingXlsx } from '../services/clientOnboardingExport';
import { useAuth } from '../context/AuthContext';

const empty = (): Onboarding => ({ client_id: '', technicien_id: '', titre: 'Prise en charge client TI', statut: 'À faire', priorite: 'Moyenne', urgence_ti: '', site_principal: '', contact_principal: '', periode_couverte: '', prepare_pour: '', avancement_global: '', risques_critiques: '', actions_ouvertes: '', decisions_requises: '', prochaine_rencontre: '', compte_rendu: { resume_executif: '', points_valides: '', points_a_corriger: '', recommandations_prioritaires: '', prochaines_etapes: '' } });
const metadata = [['titre','Titre'], ['site_principal','Site principal'], ['contact_principal','Contact principal'], ['urgence_ti','Urgence TI'], ['periode_couverte','Période couverte'], ['prepare_pour','Préparé pour'], ['avancement_global','Avancement global'], ['risques_critiques','Risques critiques'], ['actions_ouvertes','Actions ouvertes'], ['decisions_requises','Décisions requises'], ['prochaine_rencontre','Prochaine rencontre']] as const;
const reports = [['resume_executif','Résumé exécutif'], ['points_valides','Points validés'], ['points_a_corriger','Points à corriger'], ['recommandations_prioritaires','Recommandations prioritaires'], ['prochaines_etapes','Prochaines étapes']] as const;
const field = 'mt-1 w-full rounded-lg border border-white/15 bg-bz-dark px-3 py-2 text-sm text-white outline-none focus:border-titan-cyan disabled:opacity-60';
function message(e: unknown) { return e instanceof Error ? e.message : 'Erreur inattendue'; }
const pendingStorageKeyFor = (userId: number) => `client-onboarding:pending-create:${userId}`;
type PendingCreate = {requestKey: string; onboarding: Onboarding; items: Item[]};
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const optionalText = (value: unknown) => value === undefined || typeof value === 'string';
const positiveId = (value: unknown) => Number.isSafeInteger(value) && (value as number) > 0;
function validOnboarding(value: unknown): value is Onboarding {
  if (!record(value) || !positiveId(value.client_id) || typeof value.titre !== 'string' || !value.titre.trim() ||
      !onboardingStatuses.includes(value.statut as Onboarding['statut']) ||
      !onboardingPriorities.includes(value.priorite as Onboarding['priorite']) ||
      !(value.technicien_id === undefined || value.technicien_id === '' || positiveId(value.technicien_id)) ||
      metadata.some(([key]) => !optionalText(value[key])) ||
      !reports.every(([key]) => optionalText(record(value.compte_rendu) ? value.compte_rendu[key] : undefined)) ||
      (value.compte_rendu !== undefined && !record(value.compte_rendu))) return false;
  return true;
}
function validItem(value: unknown): value is Item {
  if (!record(value) || typeof value.section_key !== 'string' || !value.section_key.trim() ||
      typeof value.section_title !== 'string' || !value.section_title.trim() ||
      !Number.isSafeInteger(value.item_order) || (value.item_order as number) < 0 ||
      typeof value.element !== 'string' || !value.element.trim() || typeof value.checked !== 'boolean' ||
      ![undefined, '', ...onboardingPriorities].includes(value.priorite as Item['priorite']) ||
      ![undefined, '', ...onboardingStatuses].includes(value.statut as Item['statut']) ||
      ['notes', 'action', 'responsable'].some(key => !optionalText(value[key])) ||
      !(value.echeance === undefined || value.echeance === null || typeof value.echeance === 'string')) return false;
  return true;
}
function readPending(pendingStorageKey: string): PendingCreate | null {
  const raw = window.sessionStorage.getItem(pendingStorageKey);
  if (!raw) return null;
  const value: unknown = JSON.parse(raw);
  if (!record(value) || typeof value.requestKey !== 'string' || !uuidPattern.test(value.requestKey) ||
      !validOnboarding(value.onboarding) || !Array.isArray(value.items) || !value.items.every(validItem))
    throw new Error('Brouillon de création invalide');
  return value as PendingCreate;
}
function initialPending(pendingStorageKey: string) {
  try { return {pending: readPending(pendingStorageKey), storageError: ''}; }
  catch(e) { return {pending: null, storageError: `Stockage de session indisponible : ${message(e)}. Création bloquée.`}; }
}

export default function ClientOnboarding() {
  const { user } = useAuth();
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0) return null;
  return <ClientOnboardingForUser key={user.id} userId={user.id} />;
}

function ClientOnboardingForUser({userId}: {userId: number}) {
  const auth = useAuth();
  const pendingStorageKey = pendingStorageKeyFor(userId);
  const [options, setOptions] = useState<OnboardingOptions>({clients:[],techniciens:[]});
  const [rows, setRows] = useState<Onboarding[]>([]);
  const [recovery] = useState(() => initialPending(pendingStorageKey));
  const [selected, setSelected] = useState<Onboarding>(() => recovery.pending?.onboarding ?? empty());
  const [persistedStatus, setPersistedStatus] = useState<Onboarding['statut'] | null>(null);
  const [items, setItems] = useState<Item[]>(() => recovery.pending?.items ?? createTemplateItems());
  const [tab, setTab] = useState<'registre'|'fonctionnement'>('registre');
  const [mode, setMode] = useState<'active'|'archives'>('active');
  const [section, setSection] = useState('informations-generales');
  const [questionIndex, setQuestionIndex] = useState(0);
  const [search, setSearch] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [techFilter, setTechFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [listError, setListError] = useState('');
  const [dirty, setDirty] = useState(!!recovery.pending);
  const latestRequest = useRef(0);
  const detailRequest = useRef(0);
  const detailPendingRef = useRef(false);
  const historyRequest = useRef(0);
  const busyRef = useRef(false);
  const [history, setHistory] = useState<ClientOnboardingHistory[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [pendingCreate, setPendingCreate] = useState<PendingCreate | null>(recovery.pending);
  const [confirmedCreate, setConfirmedCreate] = useState(false);
  const [storageError, setStorageError] = useState(recovery.storageError);
  const [reconciliation, setReconciliation] = useState<OnboardingReconciliation | null>(null);
  const reconciliationEpoch = useRef(0);
  const exportIdentity = useRef<AbortController | null>(null);
  const activeExport = useRef<AbortSignal | null>(null);
  useEffect(() => {
    if (auth.verified === false || auth.loading === true) return;
    const controller = new AbortController();
    exportIdentity.current = controller;
    return () => { controller.abort(); if (exportIdentity.current === controller) exportIdentity.current = null; };
  }, [auth.verified, auth.loading, auth.verificationEpoch]);
  useEffect(() => auth.onVerificationStart?.(() => {
    exportIdentity.current?.abort();
    exportIdentity.current = null;
    if (activeExport.current) {
      activeExport.current = null;
      busyRef.current = false;
      setExporting(false);
    }
  }), [auth.onVerificationStart]);
  const invalidateReconciliation = () => { reconciliationEpoch.current++; setReconciliation(null); };
  const uncertainCreate = !!pendingCreate;
  const busy = saving || detailLoading || exporting;
  const completed = Boolean(selected.id && persistedStatus === 'Fait');
  const readOnly = completed || Boolean(selected.archived) || mode === 'archives';

  const blocker = useBlocker(dirty || busy);
  useEffect(() => { if (blocker.state === 'blocked') { if (busy) blocker.reset(); else if (window.confirm('Des modifications non sauvegardées seront perdues. Quitter?')) blocker.proceed(); else blocker.reset(); } }, [blocker, busy]);
  useEffect(() => { const guard = (event: BeforeUnloadEvent) => { if (dirty || busy) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload',guard); return () => window.removeEventListener('beforeunload',guard); }, [dirty, busy]);
  useEffect(() => {
    const guard = (event: Event) => {
      // AuthProvider gives the explicit irreversible-recovery warning for a
      // pending POST, even if this page was unmounted by ordinary navigation.
      if (busyRef.current || detailPendingRef.current || busy || (dirty && !uncertainCreate && !window.confirm('Des modifications non sauvegardées seront perdues. Quitter?'))) event.preventDefault();
    };
    window.addEventListener('client-onboarding:before-logout', guard);
    return () => window.removeEventListener('client-onboarding:before-logout', guard);
  }, [dirty, busy, uncertainCreate]);
  const confirmDiscard = () => !dirty || window.confirm('Des modifications non sauvegardées seront perdues. Continuer?');
  const reset = () => { detailRequest.current++; detailPendingRef.current = false; historyRequest.current++; setHistory([]); setNextBefore(null); setHistoryLoading(false); setHistoryError(''); setSelected(empty()); setPersistedStatus(null); setItems(createTemplateItems()); setSection('informations-generales'); setQuestionIndex(0); setDirty(false); setError(''); };
  const loadList = useCallback(async () => {
    const requestId = ++latestRequest.current;
    setLoading(true); setListError('');
    try {
      const result = await listClientOnboardings({search, client_id:clientFilter, technicien_id:techFilter, statut:statusFilter, archived:mode === 'archives'});
      if (requestId === latestRequest.current) { setRows(result); return result; }
    } catch(e) { if (requestId === latestRequest.current) setListError(`Liste indisponible : ${message(e)}`); }
    finally { if (requestId === latestRequest.current) setLoading(false); }
    return null;
  }, [search,clientFilter,techFilter,statusFilter,mode]);
  useEffect(() => { let active = true; getOnboardingOptions().then(data => { if(active) setOptions(data); }).catch(e => { if(active) setError(message(e)); }); return () => { active = false; }; }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void loadList(); }, 250); return () => { window.clearTimeout(timer); latestRequest.current++; }; }, [loadList]);
  const sections = useMemo(() => Array.from(new Map(items.map(i => [i.section_key, {key:i.section_key,title:i.section_title}])).values()), [items]);
  const activeItems = items.filter(i => i.section_key === section);
  const item = activeItems[questionIndex];
  const done = items.filter(i => i.checked).length;
  async function loadHistory(id: number, before?: number, requestId = detailRequest.current) {
    const historyId = ++historyRequest.current;
    setHistoryLoading(true); setHistoryError('');
    try {
      const page = await getClientOnboardingHistory(id, before);
      if (requestId !== detailRequest.current || historyId !== historyRequest.current) return;
      // Accept the transitional backend `events` shape until it adopts `history`.
      const events = page.history ?? page.events ?? [];
      setHistory(previous => before === undefined ? events : [...previous, ...events.filter(h => !previous.some(p => p.id === h.id))]);
      setNextBefore((page.hasMore ?? page.nextBefore != null) ? page.nextBefore : null);
    } catch(e) { if (requestId === detailRequest.current && historyId === historyRequest.current) setHistoryError(message(e)); }
    finally { if (historyId === historyRequest.current) setHistoryLoading(false); }
  }
  async function open(id?: number, reconciled = false) {
    if (!id || busyRef.current || detailPendingRef.current) return;
    if (uncertainCreate) {
      if (!reconciled || !reconciliation?.found || reconciliation.id !== id ||
          !window.confirm('Ouvrir ce dossier trouvé? Le brouillon de création non confirmée sera perdu uniquement si le dossier se charge correctement.')) return;
    } else if (!confirmDiscard()) return;
    const requestId = ++detailRequest.current;
    detailPendingRef.current = true;
    historyRequest.current++;
    setHistory([]); setNextBefore(null); setHistoryLoading(false); setHistoryError('');
    setDetailLoading(true); setError('');
    try { const row = await getClientOnboarding(id); if(requestId !== detailRequest.current) return;
      if (uncertainCreate) { removePending(pendingCreate); setPendingCreate(null); invalidateReconciliation(); }
      setSelected(row); setPersistedStatus(row.statut); setItems(row.items ?? []); setSection(row.items?.[0]?.section_key || 'informations-generales'); setQuestionIndex(0); setDirty(false); setHistory(row.history || []); void loadHistory(id, undefined, requestId); }
    catch(e) { if(requestId === detailRequest.current) setError(message(e)); } finally { if(requestId === detailRequest.current) { detailPendingRef.current = false; setDetailLoading(false); } }
  }
  function edit<K extends keyof Onboarding>(key: K, value: Onboarding[K]) {
    if(readOnly || uncertainCreate || busyRef.current || detailPendingRef.current || (key === 'client_id' && selected.id)) return;
    const tech = key === 'technicien_id' ? options.techniciens.find(t => t.id === Number(value)) : undefined;
    setSelected(previous => ({...previous,[key]:value,...(key === 'technicien_id' ? {technicien_nom: tech ? `${tech.prenom} ${tech.nom}`.trim() : ''} : {})}));
    setDirty(true);
  }
  function editItem(changes: Partial<Item>) { if(readOnly || uncertainCreate || busyRef.current || detailPendingRef.current || !item) return; setItems(previous => previous.map(i => i.section_key === item.section_key && i.item_order === item.item_order ? {...i,...changes} : i)); setDirty(true); }
  async function save() {
    if (readOnly || busyRef.current || detailPendingRef.current || uncertainCreate || (storageError && !selected.id)) return;
    if (!selected.client_id || !options.clients.some(c => c.id === Number(selected.client_id))) { setError('Choisissez un client autorisé.'); return; }
    if (selected.technicien_id && !options.techniciens.some(t => t.id === Number(selected.technicien_id))) { setError('Choisissez un technicien valide.'); return; }
    busyRef.current = true; setSaving(true); setError('');
    const creating = !selected.id;
    let posted = false;
    let createdPending: PendingCreate | null = null;
    try {
      const payload: Onboarding = {...selected,client_id:Number(selected.client_id),technicien_id:selected.technicien_id ? Number(selected.technicien_id) : ''};
      let saved: Onboarding;
      if (creating) {
        const existing = readPending(pendingStorageKey);
        if (existing) { setPendingCreate(existing); setSelected(existing.onboarding); setItems(existing.items); setDirty(true); setError('Une création en attente existe déjà; vérifiez-la avant toute nouvelle création.'); return; }
        const pending = {requestKey: crypto.randomUUID(), onboarding: payload, items};
        createdPending = pending;
        const serialized = JSON.stringify(pending);
        window.sessionStorage.setItem(pendingStorageKey, serialized);
        if (window.sessionStorage.getItem(pendingStorageKey) !== serialized) throw new Error('Brouillon de création non conservé');
        setPendingCreate(pending);
        posted = true;
        saved = await createClientOnboarding(pending.onboarding, pending.items, pending.requestKey);
      } else saved = await updateClientOnboarding(selected.id!,payload,items,selected.version!);
      detailRequest.current++; historyRequest.current++;
      setSelected(saved); setPersistedStatus(saved.statut); setItems(saved.items ?? items); setDirty(false);
      setHistory(saved.history || []); setNextBefore(null);
      if (createdPending) clearConfirmedPending(createdPending);
      // List refresh failure cannot turn a successful POST back into a retryable draft.
      await loadList();
      if (saved.id) void loadHistory(saved.id);
    } catch(e) {
      if (creating) { invalidateReconciliation();
        if (posted) setError(`Création non confirmée : ${message(e)}. Vérifiez la création par clé avant de réessayer.`);
        else { setStorageError(`Stockage de session indisponible : ${message(e)}. Création bloquée.`); setError(`Création bloquée : ${message(e)}`); }
      }
      else setError(message(e));
    } finally { busyRef.current = false; setSaving(false); }
  }
  function removePending(pending: PendingCreate) {
    // A no-op removal is not a successful cleanup: retain the recovery lock.
    const stored = readPending(pendingStorageKey);
    if (!stored || JSON.stringify(stored) !== JSON.stringify(pending)) throw new Error('Brouillon conservé introuvable ou modifié');
    window.sessionStorage.removeItem(pendingStorageKey);
    if (window.sessionStorage.getItem(pendingStorageKey) !== null) throw new Error('Brouillon conservé après nettoyage');
  }
  function clearConfirmedPending(pending: PendingCreate) {
    try {
      removePending(pending);
      setPendingCreate(null); setConfirmedCreate(false); setError(''); setStorageError('');
    } catch(e) {
      setConfirmedCreate(true);
      setError(`Création confirmée, mais nettoyage du brouillon impossible : ${message(e)}. Aucune nouvelle création avant nettoyage.`);
    }
  }
  async function verifyCreation() {
    if (!pendingCreate || confirmedCreate || busyRef.current || detailPendingRef.current) return;
    const epoch = ++reconciliationEpoch.current;
    busyRef.current = true; setSaving(true); setReconciliation(null); setError('');
    try {
      const result = await reconcileClientOnboarding(pendingCreate.requestKey);
      if (epoch === reconciliationEpoch.current) {
        if (result.found === false || (result.found === true && Number.isSafeInteger(result.id) && result.id > 0 && typeof result.archived === 'boolean')) setReconciliation(result);
        else throw new Error('Réponse de vérification invalide');
      }
    } catch(e) { if (epoch === reconciliationEpoch.current) setError(`Vérification indisponible : ${message(e)}`); }
    finally { busyRef.current = false; setSaving(false); }
  }
  async function retryCreation() {
    if (!pendingCreate || confirmedCreate || reconciliation?.found !== false || busyRef.current || !window.confirm('Le serveur ne trouve pas cette création. Réessayer avec la même clé et le brouillon original?')) return;
    const pending = pendingCreate;
    busyRef.current = true; setSaving(true); setReconciliation(null); setError('');
    try {
      const stored = readPending(pendingStorageKey);
      if (!stored || JSON.stringify(stored) !== JSON.stringify(pending)) throw new Error('Brouillon conservé introuvable ou modifié');
      const saved = await createClientOnboarding(stored.onboarding, stored.items, stored.requestKey);
      setSelected(saved); setPersistedStatus(saved.statut); setItems(saved.items ?? stored.items); setDirty(false);
      setHistory(saved.history || []); setNextBefore(null);
      clearConfirmedPending(stored);
      await loadList();
      if (saved.id) void loadHistory(saved.id);
    } catch(e) { setError(`Création non confirmée : ${message(e)}. Vérifiez à nouveau avant de réessayer.`); }
    finally { busyRef.current = false; setSaving(false); }
  }
  async function archive() {
    if (!selected.id || busyRef.current || detailPendingRef.current || !confirmDiscard() || !window.confirm('Archiver cette prise en charge?')) return;
    busyRef.current = true; setSaving(true); setError('');
    try { await archiveClientOnboarding(selected.id, selected.version!); reset(); invalidateReconciliation(); setMode('archives'); } catch(e) { setError(message(e)); } finally { busyRef.current = false; setSaving(false); }
  }
  async function restore() {
    if (!selected.id || busyRef.current || detailPendingRef.current) return;
    busyRef.current = true; setSaving(true); setError('');
    try { const row = await restoreClientOnboarding(selected.id,selected.version!); detailRequest.current++; historyRequest.current++; setSelected(row); setPersistedStatus(row.statut); setItems(row.items ?? []); invalidateReconciliation(); setMode('active'); setDirty(false); setHistory(row.history || []); setNextBefore(null); if(row.id) void loadHistory(row.id); } catch(e) { setError(message(e)); } finally { busyRef.current = false; setSaving(false); }
  }
  const name = options.clients.find(c => c.id === Number(selected.client_id))?.nom || selected.client_nom || 'client';
  const exportNeedsSave = Boolean(selected.id && dirty);
  const exportFile = async (format:'pdf'|'xlsx') => {
    if (exportNeedsSave) { setError('Sauvegardez les modifications avant d’exporter ce dossier.'); return; }
    if (busyRef.current || detailPendingRef.current) return;
    const signal = exportIdentity.current?.signal;
    if (!signal || signal.aborted) return;
    activeExport.current = signal;
    busyRef.current = true; setExporting(true); setError('');
    try {
      // The selected detail and each history page must describe one persisted version.
      // Revalidate again after the async document build, immediately before download.
      const id = selected.id;
      const version = selected.version;
      const changed = () => new Error('Le dossier a changé sur le serveur. Rafraîchissez le dossier et réessayez l’export.');
      let source = selected;
      if (id) {
        if (!Number.isSafeInteger(version) || version! <= 0) throw changed();
        source = await getClientOnboarding(id, signal);
        signal.throwIfAborted();
        if (source.id !== id || source.version !== version || !Array.isArray(source.items)) throw changed();
      }
      const completeHistory = id ? await getCompleteOnboardingHistory(id, signal) : [];
      signal.throwIfAborted();
      const verifyVersion = async () => {
        if (!id) return; // A new, unsaved draft has no persisted history or version to compare.
        const latest = await getClientOnboarding(id, signal);
        signal.throwIfAborted();
        if (latest.id !== id || latest.version !== version) throw changed();
      };
      const clientName = id ? source.client_nom || options.clients.find(c => c.id === Number(source.client_id))?.nom || 'client' : name;
      const sourceTechnician = options.techniciens.find(t => t.id === Number(source.technicien_id));
      const exported: Onboarding = {...source, technicien_nom: sourceTechnician ? `${sourceTechnician.prenom} ${sourceTechnician.nom}`.trim() : source.technicien_nom || '', history: completeHistory};
      if(format === 'pdf') await exportOnboardingPdf(exported,id ? source.items! : items,clientName,signal,verifyVersion);
      else await exportOnboardingXlsx(exported,id ? source.items! : items,clientName,signal,verifyVersion);
    } catch(e) { if (!signal.aborted) setError(`Export annulé : ${message(e)}`); }
    finally { if (activeExport.current === signal) { activeExport.current = null; busyRef.current = false; setExporting(false); } }
  };
  return <Page>
    <PageHeader titre="Prise en charge client TI" sousTitre="Checklist terrain · suivi, preuves, actions et historique" action={<Link to="/procedures" className="text-sm text-titan-cyan">← Trousse d’outils</Link>} />
    {storageError && <div role="alert" className="mb-4 rounded-xl border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-300">{storageError}</div>}
    {error && <div role="alert" className="mb-4 rounded-xl border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
    {uncertainCreate && (confirmedCreate ? <div className="mb-4 text-sm text-amber-300">Création confirmée (clé {pendingCreate.requestKey}) : le brouillon reste conservé. <button className="underline disabled:opacity-50" disabled={busy} onClick={() => clearConfirmedPending(pendingCreate)}>Nettoyer le brouillon confirmé</button></div> : <div className="mb-4 text-sm text-amber-300">Création à vérifier (clé {pendingCreate.requestKey}) : le brouillon original est conservé dans cette session jusqu’à la déconnexion. Se déconnecter détruit la récupération, même si le serveur a créé le dossier. <button className="underline disabled:opacity-50" disabled={busy} onClick={() => void verifyCreation()}>Vérifier la création</button>{reconciliation?.found === false && <> · Aucun dossier trouvé pour cette clé. <button className="underline disabled:opacity-50" disabled={busy} onClick={() => void retryCreation()}>Confirmer l’absence et réessayer</button></>}{reconciliation?.found === true && <div className="mt-2">Dossier retrouvé, même s’il a été renommé ou archivé. <button className="block underline disabled:opacity-50" disabled={busy} onClick={() => void open(reconciliation.id, true)}>Ouvrir le dossier trouvé #{reconciliation.id}{reconciliation.archived ? ' — archivé' : ''}</button></div>}</div>)}
    {listError && <div role="alert" className="mb-4 rounded-xl border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-300">{listError} <button onClick={() => void loadList()} className="underline">Réessayer la liste</button></div>}
    <div className="mb-4 flex flex-wrap gap-2">
      {(['registre','fonctionnement'] as const).map(t => <button key={t} onClick={() => { if (t !== tab) invalidateReconciliation(); setTab(t); }} className={`rounded-lg px-4 py-2 text-sm ${tab===t?'bg-bz-blue text-white':'bg-white/10 text-slate-300'}`}>{t==='registre'?'Registre':'Fonctionnement'}</button>)}
    </div>
    {tab==='fonctionnement' ? <div className="grid gap-4 md:grid-cols-3">{[['1. Cadrer le client','Choisir un client et un technicien, puis documenter le contexte.'],['2. Avancer la checklist','Parcourir les onze sections, une question à la fois. Noter preuves, actions et échéances.'],['3. Conserver la trace','Sauvegarder, exporter en Excel ou PDF, archiver et consulter l’historique.']].map(([title,text]) => <Card key={title}><h2 className="font-bold text-white">{title}</h2><p className="mt-2 text-sm text-slate-300">{text}</p></Card>)}</div> : <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
      <Card className="self-start">
        <div className="mb-3 flex gap-2">{(['active','archives'] as const).map(m => <button key={m} disabled={busy || (uncertainCreate && m !== mode)} onClick={() => { if(busyRef.current || detailPendingRef.current || uncertainCreate || !confirmDiscard()) return; if (m !== mode) invalidateReconciliation(); reset(); setMode(m); }} className={`rounded-lg px-3 py-2 text-sm ${mode===m?'bg-bz-blue text-white':'bg-white/10 text-slate-300'}`}>{m==='active'?'Actives':'Archives'}</button>)}</div>
        <input aria-label="Rechercher" placeholder="Client, titre, technicien…" value={search} onChange={e=>{ invalidateReconciliation(); setSearch(e.target.value); }} className={field} />
        <select aria-label="Filtrer par client" value={clientFilter} onChange={e=>{ invalidateReconciliation(); setClientFilter(e.target.value); }} className={field}><option value="">Tous clients</option>{options.clients.map(c=><option key={c.id} value={c.id}>{c.nom}</option>)}</select>
        <select aria-label="Filtrer par technicien" value={techFilter} onChange={e=>{ invalidateReconciliation(); setTechFilter(e.target.value); }} className={field}><option value="">Tous les techniciens</option>{options.techniciens.map(t=><option key={t.id} value={t.id}>{t.prenom} {t.nom}</option>)}</select>
        <select aria-label="Filtrer par statut" value={statusFilter} onChange={e=>{ invalidateReconciliation(); setStatusFilter(e.target.value); }} className={field}><option value="">Tous statuts</option>{onboardingStatuses.map(s=><option key={s}>{s}</option>)}</select>
        <div className="mt-4 max-h-[65vh] space-y-2 overflow-auto">{loading ? <p className="text-sm text-slate-400">Chargement…</p> : listError ? null : rows.length===0 ? <p className="text-sm text-slate-400">Aucune prise en charge trouvée.</p> : rows.map(row=><button key={row.id} onClick={()=>void open(row.id)} disabled={busy || uncertainCreate} className={`w-full rounded-xl border p-3 text-left text-sm ${selected.id===row.id?'border-titan-cyan bg-bz-blue/20':'border-white/10 bg-white/5'}`}><strong className="block text-white">{row.client_nom || row.titre}</strong><span className="text-slate-400">{row.technicien_nom || 'Technicien à choisir'} · {row.archived?'Archivée':row.statut}</span><span className="block text-xs text-titan-cyan">{row.completed_items||0}/{row.total_items||0} vérifications</span></button>)}</div>
      </Card>
      <div className="min-w-0 space-y-4">
        <Card>
          <div className="mb-4 flex flex-wrap items-center gap-2"><button disabled={busy||uncertainCreate} onClick={()=>{if(!busyRef.current && !detailPendingRef.current && !uncertainCreate && confirmDiscard()){reset();setMode('active');}}} className="rounded-lg bg-white/10 px-3 py-2 text-sm text-white disabled:opacity-50">Nouvelle</button><button onClick={()=>void save()} disabled={readOnly||busy||uncertainCreate||(!selected.id && !!storageError)} className="rounded-lg bg-bz-blue px-3 py-2 text-sm text-white disabled:opacity-50">{saving?'Sauvegarde…':'Sauvegarder'}</button><button onClick={()=>void exportFile('xlsx')} disabled={busy||exportNeedsSave} className="rounded-lg bg-emerald-700 px-3 py-2 text-sm text-white disabled:opacity-50">Excel</button><button onClick={()=>void exportFile('pdf')} disabled={busy||exportNeedsSave} className="rounded-lg bg-white/10 px-3 py-2 text-sm text-white disabled:opacity-50">PDF</button>{exportNeedsSave&&<span className="text-xs text-amber-300">Sauvegardez les modifications avant d’exporter ce dossier.</span>}{selected.id && (selected.archived || mode === 'archives' ? <button onClick={()=>void restore()} disabled={busy} className="rounded-lg bg-emerald-700 px-3 py-2 text-sm text-white">Restaurer</button> : <button onClick={()=>void archive()} disabled={busy} className="rounded-lg bg-amber-700 px-3 py-2 text-sm text-white">Archiver</button>)}{dirty&&<span className="text-xs text-amber-300">Modifications non sauvegardées</span>}</div>
          {readOnly&&<p className="mb-3 rounded-lg bg-amber-500/10 p-2 text-sm text-amber-300">{completed ? 'Dossier terminé en lecture seule. Il ne peut plus être modifié, même après restauration.' : 'Archive en lecture seule. Restaurer pour modifier.'}</p>}
          {selected.id && <p className="mb-3 text-xs text-slate-400">Client du dossier fixe après sauvegarde. Créer un nouveau dossier pour un autre client.</p>}
          {detailLoading ? <p className="text-slate-300">Chargement du dossier…</p> : <fieldset disabled={readOnly||busy||uncertainCreate} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><label className="text-xs text-slate-300">Client<select disabled={Boolean(selected.id)} value={selected.client_id} onChange={e=>edit('client_id',e.target.value?Number(e.target.value):'')} className={field}><option value="">Choisir…</option>{options.clients.map(c=><option key={c.id} value={c.id}>{c.nom}</option>)}</select></label><label className="text-xs text-slate-300">Technicien Prime<select value={selected.technicien_id||''} onChange={e=>edit('technicien_id',e.target.value?Number(e.target.value):'')} className={field}><option value="">Choisir…</option>{options.techniciens.map(t=><option key={t.id} value={t.id}>{t.prenom} {t.nom} ({t.email})</option>)}</select></label><label className="text-xs text-slate-300">Statut<select value={selected.statut} onChange={e=>edit('statut',e.target.value as Onboarding['statut'])} className={field}>{onboardingStatuses.map(s=><option key={s}>{s}</option>)}</select></label><label className="text-xs text-slate-300">Priorité<select value={selected.priorite} onChange={e=>edit('priorite',e.target.value as Onboarding['priorite'])} className={field}>{onboardingPriorities.map(s=><option key={s}>{s}</option>)}</select></label>{metadata.map(([key,label])=><label key={key} className="text-xs text-slate-300">{label}<input value={selected[key]||''} onChange={e=>edit(key,e.target.value)} className={field}/></label>)}</fieldset>}
        </Card>
        <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]"><Card className="self-start"><h2 className="mb-2 font-bold text-white">Sections · {done}/{items.length} faits</h2><nav className="max-h-[55vh] space-y-1 overflow-auto">{sections.map(s=>{const subset=items.filter(i=>i.section_key===s.key);return <button key={s.key} onClick={()=>{setSection(s.key);setQuestionIndex(0);}} className={`w-full rounded-lg p-2 text-left text-xs ${section===s.key?'bg-bz-blue/30 text-white':'text-slate-300 hover:bg-white/5'}`}>{s.title}<span className="block text-titan-cyan">{subset.filter(i=>i.checked).length}/{subset.length}</span></button>;})}</nav></Card>
          <Card><h2 className="font-bold text-white">{sections.find(s=>s.key===section)?.title}</h2><p className="mt-1 text-xs text-slate-400">Question {activeItems.length?questionIndex+1:0}/{activeItems.length}</p>{item&&<fieldset disabled={readOnly||busy||uncertainCreate} className="mt-4 space-y-4"><label className="flex items-center gap-2 text-lg font-semibold text-white"><input type="checkbox" checked={item.checked} onChange={e=>editItem({checked:e.target.checked,statut:e.target.checked?'Fait':'À faire'})} />{item.element}</label><label className="block text-xs text-slate-300">Réponse / notes / preuves<textarea value={item.notes||''} onChange={e=>editItem({notes:e.target.value})} rows={5} className={field}/></label><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"><label className="text-xs text-slate-300">Priorité<select value={item.priorite||''} onChange={e=>editItem({priorite:e.target.value as Item['priorite']})} className={field}><option value="">—</option>{onboardingPriorities.map(p=><option key={p}>{p}</option>)}</select></label><label className="text-xs text-slate-300">Statut<select value={item.statut||''} onChange={e=>editItem({statut:e.target.value as Item['statut']})} className={field}><option value="">—</option>{onboardingStatuses.map(s=><option key={s}>{s}</option>)}</select></label><label className="text-xs text-slate-300">Action / suivi<input value={item.action||''} onChange={e=>editItem({action:e.target.value})} className={field}/></label><label className="text-xs text-slate-300">Responsable<input value={item.responsable||''} onChange={e=>editItem({responsable:e.target.value})} className={field}/></label><label className="text-xs text-slate-300">Échéance<input type="date" value={item.echeance||''} onChange={e=>editItem({echeance:e.target.value||null})} className={field}/></label></div></fieldset>}<div className="mt-5 flex justify-between"><button disabled={!questionIndex} onClick={()=>setQuestionIndex(i=>i-1)} className="rounded-lg bg-white/10 px-3 py-2 text-sm text-white disabled:opacity-40">← Précédent</button><button disabled={questionIndex>=activeItems.length-1} onClick={()=>setQuestionIndex(i=>i+1)} className="rounded-lg bg-bz-blue px-3 py-2 text-sm text-white disabled:opacity-40">Suivant →</button></div></Card></div>
        <Card><h2 className="mb-3 font-bold text-white">Compte rendu professionnel</h2><fieldset disabled={readOnly||busy||uncertainCreate} className="grid gap-3 md:grid-cols-2">{reports.map(([key,label])=><label key={key} className="text-xs text-slate-300">{label}<textarea rows={4} value={selected.compte_rendu?.[key]||''} onChange={e=>edit('compte_rendu',{...selected.compte_rendu,[key]:e.target.value})} className={field}/></label>)}</fieldset></Card>
        {selected.id&&<Card><h2 className="mb-3 font-bold text-white">Historique</h2>{history.length ? history.map(h=><div key={h.id} className="border-t border-white/10 py-2 text-xs text-slate-300">{h.event_type} · {h.created_at ? new Date(h.created_at).toLocaleString('fr-CA') : ''} · {h.actor_email||'Utilisateur'}</div>) : !historyLoading && !historyError && <p className="text-sm text-slate-400">Aucun événement.</p>}{historyError && <p role="alert" className="text-sm text-red-300">Historique indisponible : {historyError} <button className="underline" onClick={() => void loadHistory(selected.id!, nextBefore ?? undefined)}>Réessayer</button></p>}{nextBefore != null && <button disabled={historyLoading} onClick={() => void loadHistory(selected.id!, nextBefore)} className="mt-3 rounded-lg bg-white/10 px-3 py-2 text-sm text-white disabled:opacity-50">{historyLoading?'Chargement…':'Afficher les événements précédents'}</button>}</Card>}
      </div>
    </div>}
  </Page>;
}
