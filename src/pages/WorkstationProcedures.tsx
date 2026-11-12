import { useEffect, useRef, useState } from 'react';
import { Page, PageHeader } from '../layout/Page';
import { Card } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { generateWorkstationAuditScript, DEFAULT_WORKSTATION_AUDIT_OPTIONS } from '../services/workstationAuditScript';
import { generateWorkstationProcedureHtml } from '../services/workstationHtmlExport';
import {
  createDossier, createTemplate, deleteDossier, getDossier, getDossierByRequest, getTemplateByRequest, getStandardTemplate, listDossiers, listTemplates,
  ProcedureApiError, updateTemplate, listWorkstationClients, getAuditTemplateSource,
  type WorkstationDossier, type WorkstationTemplate, type TemplateSection, type DossierSection,
} from '../services/workstationProcedures';
import type { ClientPrime } from '../services/dataService';

const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const message = (error: unknown) => error instanceof Error ? error.message : 'Erreur inconnue';
const today = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; };
const blank = { clientId: '', templateId: '', employee: '', computer: '', ticket: '', date: today() };
const newSection = (): TemplateSection => ({ title: '', steps: [] });
const exportName = (clientName: string, template: WorkstationTemplate, extension: string) => {
  const slug = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0,70) || 'procedure';
  // Encoded identity suffix distinguishes names that normalize to the same slug.
  return `${slug(clientName)}-${slug(template.name)}-${template.clientId!.toString(36)}-${template.id.toString(36)}.${extension}`;
};
const inputClass = 'w-full min-w-0 rounded-lg border border-white/20 bg-bz-dark p-2 text-sm text-white disabled:opacity-60';
const buttonClass = 'rounded-lg border border-white/20 px-3 py-2 text-sm text-white disabled:opacity-50';
type Intent = {kind:'dossier';payload:Parameters<typeof createDossier>[0]} | {kind:'template';payload:Parameters<typeof createTemplate>[0]};
const pendingKey=(id:number)=>`workstation-procedures:pending-create:${id}`;
function readPending(id:number|null):Intent|null {
  if(id===null)return null;
  const raw=window.sessionStorage.getItem(pendingKey(id));if(!raw)return null;
  try {const value=JSON.parse(raw) as Intent;
    if((value.kind==='dossier'||value.kind==='template')&&/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(value.payload?.requestKey))return value;
  }catch{ /* fail closed on malformed stored intent */ }
  throw Error('Création en attente illisible : nouvelle création bloquée');
}
const mergeById=<T extends {id:number}>(old:T[],incoming:T[])=>[...old,...incoming.filter(item=>!old.some(i=>i.id===item.id))];
const sameTemplate=(selected:WorkstationTemplate,fresh:WorkstationTemplate)=>
  selected.id===fresh.id && selected.version===fresh.version && selected.name===fresh.name && selected.clientId===fresh.clientId &&
  JSON.stringify(selected.sections)===JSON.stringify(fresh.sections);
type Recovery = { creation: typeof blank; draft: WorkstationDossier | null; model: WorkstationTemplate | null; dirty: boolean; modelDirty: boolean; duplicating: boolean; modelRequestKey: string | null };
const recovery = new WeakMap<Window, { userId: number | null; snapshot: Recovery | null }>();

export default function WorkstationProcedures() {
  const { user } = useAuth();
  return <WorkstationEditor key={user?.id ?? 'anonymous'} userId={user?.id ?? null} isAdmin={user?.role === 'admin'} />;
}

function WorkstationEditor({ userId, isAdmin }: { userId: number | null; isAdmin: boolean }) {
  const auth = useAuth();
  const exportIdentity = useRef<AbortController | null>(null);
  const activeExport = useRef<AbortSignal | null>(null);
  const exportLocked = useRef(false);
  useEffect(() => {
    if (!auth.verified || auth.loading || auth.user?.id !== userId) return;
    const controller = new AbortController();
    exportIdentity.current = controller;
    return () => { controller.abort(); if (exportIdentity.current === controller) exportIdentity.current = null; };
  }, [auth.verified, auth.loading, auth.verificationEpoch, auth.user?.id, userId]);
  useEffect(() => auth.onVerificationStart(() => {
    exportIdentity.current?.abort();
    exportIdentity.current = null;
    if (activeExport.current) { activeExport.current = null; exportLocked.current = false; setBusy(false); }
  }), [auth.onVerificationStart]);
  // Window-scoped memory survives route remounts, but never crosses an identity change.
  const entry = recovery.get(window);
  if (!entry || entry.userId !== userId) recovery.set(window, { userId, snapshot: null });
  const restored = useRef(recovery.get(window)?.snapshot);
  const [duplicating, setDuplicating] = useState(restored.current?.duplicating ?? false);
  const [clients, setClients] = useState<ClientPrime[]>([]);
  const [templates, setTemplates] = useState<WorkstationTemplate[]>([]);
  const [dossiers, setDossiers] = useState<WorkstationDossier[]>([]);
  const [templateBefore,setTemplateBefore]=useState<number|null>(null);
  const [dossierBefore,setDossierBefore]=useState<number|null>(null);
  const [pending,setPending]=useState<Intent|null>(()=>{try{return readPending(userId);}catch{return null;}});
  const [pendingInvalid]=useState(()=>{try{readPending(userId);return false;}catch{return true;}});
  const [draft, setDraft] = useState<WorkstationDossier | null>(restored.current?.draft ?? null);
  const [model, setModel] = useState<WorkstationTemplate | null>(restored.current?.model ?? null);
  const [modelRequestKey, setModelRequestKey] = useState<string|null>(restored.current?.modelRequestKey ?? null);
  const [creation, setCreation] = useState(restored.current?.creation ?? { ...blank });
  const creationDirty = false; // Client/procedure selection is not an unsaved record.
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [accessDenied, setAccessDenied] = useState(false);
  const [scriptConfirmed, setScriptConfirmed] = useState(false);
  const denyAccess = () => {exportIdentity.current?.abort();setAccessDenied(true);};
  const [busy, setBusy] = useState(false);
  const dirty = false; // Historical dossiers are consultation-only.
  const [modelDirty, setModelDirty] = useState(restored.current?.modelDirty ?? false);
  const [script, setScript] = useState({ prefix: DEFAULT_WORKSTATION_AUDIT_OPTIONS.computerPrefix, admin: DEFAULT_WORKSTATION_AUDIT_OPTIONS.adminLocal, keyboard: DEFAULT_WORKSTATION_AUDIT_OPTIONS.keyboards.join(', '), printer: DEFAULT_WORKSTATION_AUDIT_OPTIONS.printerName, apps: DEFAULT_WORKSTATION_AUDIT_OPTIONS.apps.join('\n') });
  const requestId = useRef(0);
  const historyRequest = useRef(0);
  const deletedHistory = useRef(new Set<number>());
  const locked = useRef(false);
  // Reconciliation owns the editor only until a person selects or edits another one.
  const editorRevision = useRef(0);
  const creationRevision = useRef(0);
  const scriptRevision = useRef(0);
  const editorState = useRef({ dirty, modelDirty, creationDirty, model, modelRequestKey });
  editorState.current = { dirty, modelDirty, creationDirty, model, modelRequestKey };
  const confirmLeave = () => (!dirty && !modelDirty && !creationDirty) || window.confirm('Des modifications non sauvegardées seront perdues. Continuer ?');
  useEffect(() => {
    const entry = recovery.get(window);
    if (entry?.userId === userId) entry.snapshot = dirty || modelDirty || creationDirty
      ? { draft, model, creation, dirty, modelDirty, duplicating, modelRequestKey } : null;
  }, [userId, draft, model, creation, dirty, modelDirty, creationDirty, duplicating, modelRequestKey]);

  useEffect(() => {
    let active = true;
    const failed=(e:unknown)=>{if(active){if(e instanceof ProcedureApiError && [401,403].includes(e.status))denyAccess();setError(message(e));}};
    void listWorkstationClients().then(c=>{if(active)setClients(c);}).catch(failed);
    void listTemplates().then(t=>{if(active){setTemplates(items=>mergeById(items,t.items));setTemplateBefore(t.nextBefore);}}).catch(failed);
    void getStandardTemplate().then(standard=>{if(active)setTemplates(items=>mergeById(items,[standard]));}).catch(failed);
    void listDossiers().then(d=>{if(active){setDossiers(items=>mergeById(d.items,items).filter(d=>!deletedHistory.current.has(d.id)));setDossierBefore(d.nextBefore);}}).catch(failed);
    return () => { active = false; requestId.current++; };
  }, []);
  useEffect(() => {
    // The global first page is not the selected client's complete catalogue.
    // Continue cursor traversal when choosing a client, without requiring a
    // load-more action in the unrelated reusable-template card.
    if (!creation.clientId || templateBefore === null) return;
    let active = true;
    void listTemplates(templateBefore).then(page => {
      if (!active) return;
      if (page.hasMore && page.nextBefore !== null && page.nextBefore >= templateBefore) throw Error('Curseur invalide');
      setTemplates(items => mergeById(items, page.items));
      setTemplateBefore(page.nextBefore);
    }).catch(e => { if (active) { if (e instanceof ProcedureApiError && [401,403].includes(e.status)) denyAccess(); setError(message(e)); } });
    return () => { active = false; };
  }, [creation.clientId, templateBefore]);
  useEffect(() => {
    // React Router's links are delegated; intercept before it handles navigation.
    const onLink = (event: MouseEvent) => {
      if ((!dirty && !modelDirty && !creationDirty && !busy) || event.defaultPrevented) return;
      const target = event.target;
      const anchor = target && 'closest' in target ? (target as Element).closest('a[href]') as HTMLAnchorElement | null : null;
      if (!anchor) return;
      // Export blobs are downloads, not page navigation. Only exempt same-origin blob URLs.
      if (anchor.hasAttribute('download') && anchor.protocol === 'blob:' && new URL(anchor.href).origin === window.location.origin) return;
      if (busy || !window.confirm('Des modifications non sauvegardées seront perdues. Continuer ?')) event.preventDefault();
    };
    document.addEventListener('click', onLink, true);
    return () => document.removeEventListener('click', onLink, true);
  }, [dirty, modelDirty, creationDirty, busy]);
  useEffect(() => {
    const onLogout = (event: Event) => {
      if (busy || ((dirty || modelDirty || creationDirty) && !window.confirm('Des modifications non sauvegardées seront perdues. Se déconnecter ?'))) event.preventDefault();
    };
    window.addEventListener('client-onboarding:before-logout', onLogout);
    return () => window.removeEventListener('client-onboarding:before-logout', onLogout);
  }, [busy, dirty, modelDirty, creationDirty]);
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty || modelDirty || creationDirty || busy) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty, modelDirty, creationDirty, busy]);
  const run = async (action: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); }
    catch (e) { if(e instanceof ProcedureApiError && [401,403].includes(e.status))denyAccess();setError(e instanceof ProcedureApiError && e.status === 409 ? `Conflit de version : ${message(e)}. Vos modifications sont conservées; rechargez après les avoir copiées ou réessayez après vérification.` : message(e)); }
    finally { locked.current = false; setBusy(false); }
  };
  const runExport = async (action: (signal: AbortSignal) => Promise<void>) => {
    const signal = exportIdentity.current?.signal;
    if (locked.current || exportLocked.current || !signal || signal.aborted || !auth.verified || auth.loading || auth.user?.id !== userId) return;
    exportLocked.current = true; activeExport.current = signal; setBusy(true); setError(''); setNotice('');
    try { await action(signal); }
    catch (e) { if (!signal.aborted) {if(e instanceof ProcedureApiError && [401,403].includes(e.status))denyAccess();setError(message(e));} }
    finally { if (activeExport.current === signal) { activeExport.current = null; exportLocked.current = false; setBusy(false); } }
  };
  const finishIntent=(intent:Intent,item:WorkstationDossier|WorkstationTemplate,editorAtStart:number,_creationAtStart:number,ownsDraft=false)=>{
    const stored=readPending(userId);
    if(!stored)return; // Another readback has already reconciled this intent.
    if(stored.kind!==intent.kind||stored.payload.requestKey!==intent.payload.requestKey)throw Error('Création en attente différente : réconciliation bloquée');
    if(intent.kind==='template'){
      const saved=item as WorkstationTemplate;
      if(saved.clientId!==intent.payload.clientId || saved.name!==intent.payload.name || JSON.stringify(saved.sections)!==JSON.stringify(intent.payload.sections))throw Error('Procédure confirmée différente : création à vérifier');
    }
    window.sessionStorage.removeItem(pendingKey(userId!));
    if(window.sessionStorage.getItem(pendingKey(userId!))!==null)throw Error('Nettoyage de la création impossible');
    const current=editorState.current;
    const canSelect=editorRevision.current===editorAtStart&&(ownsDraft||!current.dirty&&!current.modelDirty);
    if(intent.kind==='dossier'){
      const saved=item as WorkstationDossier;
      if (deletedHistory.current.has(saved.id)) { setPending(null); return; }
      setDossiers(items=>mergeById(items,[saved]).filter(d=>!deletedHistory.current.has(d.id)));
      // Legacy receipt reconciliation may add history, never select a client procedure.
      if(canSelect)setDraft(copy(saved));
      setNotice('Dossier créé.');
    }
    else {
      const saved=item as WorkstationTemplate;
      setTemplates(items=>mergeById(items,[saved]));
      const linkedDraft=current.modelRequestKey===intent.payload.requestKey && current.model?.id===0;
      if(linkedDraft){
        // Rebase newer edits of this exact creation onto its saved identity.
        // A different editor has no receipt link and must never be replaced.
        const rebased={...copy(current.model!),id:saved.id,version:saved.version,clientId:saved.clientId};
        setModel(rebased);setModelDirty(!sameTemplate(rebased,saved));setModelRequestKey(null);setDuplicating(false);editorRevision.current++;if(saved.clientId!==null)selectSaved(saved);
      }else if(canSelect){setModel(copy(saved));setModelDirty(false);setModelRequestKey(null);setDuplicating(false);editorRevision.current++;if(saved.clientId!==null)selectSaved(saved);}
      setNotice('Modèle sauvegardé. Les dossiers déjà créés ne sont pas modifiés.');
    }
    setPending(null);
  };
  const lookupIntent=(intent:Intent)=>intent.kind==='dossier'?getDossierByRequest(intent.payload.requestKey):getTemplateByRequest(intent.payload.requestKey);
  const discardRejectedIntent=()=>{
    // A validation rejection precedes insertion. Never allow a new UUID until storage confirms removal.
    window.sessionStorage.removeItem(pendingKey(userId!));
    if(window.sessionStorage.getItem(pendingKey(userId!))!==null)throw Error('Nettoyage de la création impossible : nouvelle création bloquée');
    setPending(null);
  };
  const executeIntent=async(intent:Intent,retry=false)=>{
    const editorAtStart=editorRevision.current,creationAtStart=creationRevision.current;
    if(userId===null)throw Error('Connexion requise');
    if(!retry){
      if(pending||pendingInvalid||window.sessionStorage.getItem(pendingKey(userId)))throw Error('Création en attente : réessayez avec la même clé.');
      const serialized=JSON.stringify(intent);
      window.sessionStorage.setItem(pendingKey(userId),serialized);
      if(window.sessionStorage.getItem(pendingKey(userId))!==serialized)throw Error('Stockage de récupération indisponible');
      setPending(intent);
      if(intent.kind==='template')setModelRequestKey(intent.payload.requestKey);
    }
    try {if(intent.kind==='dossier')await createDossier(intent.payload);else await createTemplate(intent.payload);}
    catch(e){
      if(e instanceof ProcedureApiError&&e.status===400&&e.message!=='Réponse serveur invalide'){
        discardRejectedIntent();
        throw e;
      }
      if(e instanceof ProcedureApiError&&[401,403,409].includes(e.status))throw e;
    }
    try {finishIntent(intent,await lookupIntent(intent),editorAtStart,creationAtStart,!retry);}
    catch(e){if(e instanceof ProcedureApiError&&[401,403].includes(e.status))denyAccess();throw Error(`Création non confirmée. Vérifiez ou réessayez avec la même clé. ${message(e)}`);}
  };
  useEffect(()=>{
    if(!pending)return;
    let active=true;
    const editorAtStart=editorRevision.current,creationAtStart=creationRevision.current;
    void lookupIntent(pending).then(item=>{if(active)finishIntent(pending,item,editorAtStart,creationAtStart);}).catch(e=>{if(active&&!(e instanceof ProcedureApiError&&e.status===404)){if(e instanceof ProcedureApiError&&[401,403].includes(e.status))denyAccess();setError(`Création à vérifier : ${message(e)}`);}});
    return ()=>{active=false;};
    // Only on mount: 404 can be temporary and must never trigger a new key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  const loadMore=(kind:'template'|'dossier')=>{const before=kind==='template'?templateBefore:dossierBefore;if(!before)return;
    void run(async()=>{const result=kind==='template'?await listTemplates(before):await listDossiers(before);
      if(result.hasMore&&result.nextBefore!==null&&result.nextBefore>=before)throw Error('Curseur invalide');
      if(kind==='template'){setTemplates(items=>mergeById(items,result.items as WorkstationTemplate[]));setTemplateBefore(result.nextBefore);}
      else {setDossiers(items=>mergeById(items,result.items as WorkstationDossier[]).filter(d=>!deletedHistory.current.has(d.id)));setDossierBefore(result.nextBefore);}
    });
  };
  const openDossier = (id: number) => {
    if (locked.current) return;
    const token = ++historyRequest.current;
    setError('');
    void run(async () => { const item = await getDossier(id); if (item.id !== id) throw Error('Dossier reçu différent'); if (token !== historyRequest.current || deletedHistory.current.has(id)) return; setDraft(copy(item)); });
  };
  const removeHistory = (item: WorkstationDossier) => {
    const signal = exportIdentity.current?.signal;
    if (!isAdmin || locked.current || !signal || signal.aborted || !auth.verified || auth.loading) return;
    if (!window.confirm(`Supprimer l’historique de ${item.clientName} — poste ${item.computer || 'non renseigné'} — dossier #${item.id} ? Cette action est irréversible. Un reçu technique sans contenu sera conservé pour empêcher sa recréation par rejeu.`)) return;
    void run(async () => {
      await deleteDossier(item.id, item.version);
      if (signal.aborted) return;
      historyRequest.current++;
      deletedHistory.current.add(item.id);
      setDossiers(items => items.filter(d => d.id !== item.id));
      setDraft(current => current?.id === item.id ? null : current);
      setNotice('Historique supprimé.');
    });
  };
  const mutateModel = (change: (item: WorkstationTemplate) => void) => {
    if (!model) return;
    const next = copy(model); change(next); editorRevision.current++;setModel(next); setModelDirty(true);
  };

  const saveModel = () => { if (!model) return; void run(async () => {
    if(!model.id){await executeIntent({kind:'template',payload:{clientId:model.clientId,name:model.name,sections:copy(model.sections),requestKey:crypto.randomUUID()}});return;}
    const saved = await updateTemplate(model.id, { name: model.name, sections: model.sections, expectedVersion: model.version });
    if(!sameTemplate({...model,version:saved.version},saved))throw Error('Procédure sauvegardée différente : rechargez avant export.');
    setTemplates(items => [...items.filter(i => i.id !== saved.id), saved]); setModel(copy(saved)); setModelDirty(false); setDuplicating(false); if(saved.clientId!==null)selectSaved(saved); setNotice('Modèle sauvegardé. Les dossiers déjà créés ne sont pas modifiés.');
  }); };
  const resetScript = () => { setScriptConfirmed(false);scriptRevision.current++;setScript({prefix:DEFAULT_WORKSTATION_AUDIT_OPTIONS.computerPrefix,admin:DEFAULT_WORKSTATION_AUDIT_OPTIONS.adminLocal,keyboard:DEFAULT_WORKSTATION_AUDIT_OPTIONS.keyboards.join(', '),printer:DEFAULT_WORKSTATION_AUDIT_OPTIONS.printerName,apps:DEFAULT_WORKSTATION_AUDIT_OPTIONS.apps.join('\n')}); };
  const clearSelectionFeedback = () => { setNotice(''); setError(''); };
  const selectSaved = (saved: WorkstationTemplate) => {
    clearSelectionFeedback();
    if(String(saved.clientId)!==creation.clientId)resetScript();
    requestId.current++;creationRevision.current++;setCreation({...blank,clientId:String(saved.clientId),templateId:String(saved.id)});
  };
  const chooseClient = (id:string) => {
    if(!confirmLeave())return;
    clearSelectionFeedback();
    if(id!==creation.clientId)resetScript();
    requestId.current++;creationRevision.current++;editorRevision.current++;
    setCreation({...blank,clientId:id});setModelRequestKey(null);setModel(null);setModelDirty(false);setDuplicating(false);
  };
  const chooseProcedure = (id:string) => {
    if(!confirmLeave())return;
    clearSelectionFeedback();
    const saved=templates.find(t=>String(t.id)===id && t.clientId!==null && String(t.clientId)===creation.clientId);
    requestId.current++;creationRevision.current++;editorRevision.current++;
    setCreation({...creation,templateId:saved?String(saved.id):''});setModelRequestKey(null);setModel(saved?copy(saved):null);setModelDirty(false);setDuplicating(false);
  };
  const clientTemplates = templates.filter(t => t.clientId !== null && String(t.clientId) === creation.clientId);
  const progress = draft ? draft.sections.flatMap(s => s.steps).reduce((v, step) => ({ done: v.done + Number(step.etat === 'fait'), total: v.total + Number(step.etat !== 'na') }), { done: 0, total: 0 }) : null;
  const updateScript = (key: keyof typeof script, value: string) => { setScriptConfirmed(false);scriptRevision.current++; setScript(current => ({ ...current, [key]: value })); };
  const downloadScript = () => {
    if (locked.current || exportLocked.current) return;

    if (modelDirty || (model !== null && !model.id)) { setError('Sauvegardez le modèle ou annulez vos modifications en rouvrant le modèle avant de générer le script.'); return; }
    if (pending || pendingInvalid) { setError('Confirmez la création en attente avant de générer son audit.'); return; }
    const selectedClient = clients.find(c => String(c.id) === creation.clientId && c.clientType === 'ti');
    const selectedTemplate = templates.find(t => String(t.id) === creation.templateId);
    if (!selectedClient || !selectedTemplate || selectedTemplate.clientId !== selectedClient.id) { setError('Choisissez un client TI et son modèle pour générer le script.'); return; }
    const selectionRevision = requestId.current;
    const creationAtStart = creationRevision.current;
    const editorAtStart = editorRevision.current;
    const scriptAtStart = scriptRevision.current;
    const settings = { ...script };
    void runExport(async (signal) => {
      let clientName: string;
      let procedure: { name: string; sections: TemplateSection[] | DossierSection[] };
      const source = await getAuditTemplateSource(selectedClient!.id, selectedTemplate!.id);
      if (signal.aborted) return;
      if (selectionRevision !== requestId.current || creationAtStart !== creationRevision.current || scriptAtStart !== scriptRevision.current || editorAtStart !== editorRevision.current) return;
      if (source.template.clientId !== selectedClient!.id || !sameTemplate(selectedTemplate!, source.template)) throw Error('Modèle modifié depuis sa sélection : rechargez-le avant de générer le script.');
      clientName = source.client.nom;
      procedure = { name: source.template.name, sections: source.template.sections };
      const text = generateWorkstationAuditScript({
        clientName, computerPrefix: settings.prefix, adminLocal: settings.admin,
        keyboards: settings.keyboard.split(',').map(v => v.trim()).filter(Boolean),
        printerName: settings.printer, apps: settings.apps.split('\n').map(v => v.trim()).filter(Boolean),
        procedure,
      });
      if (signal.aborted || selectionRevision !== requestId.current || creationAtStart !== creationRevision.current || scriptAtStart !== scriptRevision.current) return;
      const url = URL.createObjectURL(new Blob(['\uFEFF', text], { type: 'text/plain;charset=utf-8' }));
      const a = document.createElement('a'); a.href = url; a.download = exportName(clientName, source.template, 'ps1'); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(`Script généré pour ${clientName} selon ${procedure.name}.`);
    });
  };
  const downloadHtml = () => {
    if (locked.current || exportLocked.current) return;

    if (modelDirty || (model !== null && !model.id)) { setError('Sauvegardez le modèle ou annulez vos modifications avant de télécharger sa procédure HTML.'); return; }
    if (pending || pendingInvalid) { setError('Confirmez la création en attente avant de télécharger la procédure HTML.'); return; }
    const selectedClient = clients.find(c => String(c.id) === creation.clientId && c.clientType === 'ti');
    const selectedTemplate = templates.find(t => String(t.id) === creation.templateId);
    if (!selectedClient || !selectedTemplate || selectedTemplate.clientId !== selectedClient.id) { setError('Choisissez un client TI et son modèle pour télécharger la procédure HTML.'); return; }
    const selectionRevision = requestId.current;
    const creationAtStart = creationRevision.current;
    const editorAtStart = editorRevision.current;
    void runExport(async (signal) => {
      let html: string;
      let clientName: string;
      const source = await getAuditTemplateSource(selectedClient!.id, selectedTemplate!.id);
      if (signal.aborted) return;
      if (selectionRevision !== requestId.current || creationAtStart !== creationRevision.current || editorAtStart !== editorRevision.current) return;
      if (source.template.clientId !== selectedClient!.id || !sameTemplate(selectedTemplate!, source.template)) throw Error('Modèle modifié depuis sa sélection : rechargez-le avant de télécharger la procédure HTML.');
      clientName = source.client.nom;
      html = generateWorkstationProcedureHtml({ kind: 'template', clientName, template: source.template });
      if (signal.aborted || selectionRevision !== requestId.current || creationAtStart !== creationRevision.current) return;
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
      const a = document.createElement('a'); a.href = url; a.download = exportName(clientName, source.template, 'html'); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(`Procédure HTML générée pour ${clientName}. Vérifiez les téléchargements de votre navigateur.`);
    });
  };
  if(accessDenied || !auth.verified || auth.loading || auth.user?.id!==userId)return <Page><p role="alert">Accès refusé ou session à vérifier. Rechargez après vérification de vos droits.</p></Page>;
  return <Page>
    <style data-workstation-print>{`@media print {
      .min-h-screen { min-height: 0 !important; }
      #primary-navigation, header { display: none !important; }
      main { margin-left: 0 !important; background: white !important; }
      main > div { max-width: none !important; padding: 0 !important; }
      body, .titan-grid { background: white !important; }
      .workstation-print-area { break-inside: avoid; }
      .workstation-print-control { display: none !important; }
      .workstation-print-answer { display: block !important; color: #000 !important; white-space: pre-wrap; overflow-wrap: anywhere; }
    }`}</style>
    <PageHeader titre="Procédures par client" sousTitre="Procédures générales, gabarits réutilisables et historiques" />
    {error && <p role="alert" className="mb-4 rounded-lg border border-red-500 p-3 text-red-300">{error}</p>}
    {notice && <p role="status" className="mb-4 text-green-300">{notice}</p>}
    {(pending||pendingInvalid)&&<div role="status" className="mb-4 text-amber-300">Création en attente de confirmation. Aucune nouvelle création autorisée. {pending&&<><button className={buttonClass} disabled={busy} onClick={()=>void run(async()=>{const editorAtStart=editorRevision.current,creationAtStart=creationRevision.current;finishIntent(pending,await lookupIntent(pending),editorAtStart,creationAtStart);})}>Vérifier la création</button><button className={buttonClass} disabled={busy} onClick={()=>void run(()=>executeIntent(pending,true))}>Réessayer la création {pending.kind==='dossier'?'du dossier':'du modèle'}</button></>}</div>}
    <div className="grid gap-5 lg:grid-cols-2 print:hidden">
      <Card><fieldset disabled={busy}><h2 className="mb-3 text-lg font-semibold text-white">Procédure générale du client</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm text-slate-300">Client<select aria-label="Client" className={inputClass} value={creation.clientId} onChange={e => chooseClient(e.target.value)}><option value="">Choisir</option>{clients.map(c => <option key={c.id} value={c.id} disabled={c.clientType !== 'ti'}>{c.nom}{c.clientType === 'ti' ? '' : ' — À classer TI dans Clients'}</option>)}</select></label>
          <label className="text-sm text-slate-300">Procédure enregistrée<select aria-label="Modèle" className={inputClass} value={creation.templateId} onChange={e => chooseProcedure(e.target.value)}><option value="">Choisir une procédure</option>{clientTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        </div><p className="mt-3 text-sm text-slate-300">Choisissez une procédure enregistrée ou créez une variante pour ce client. Aucun employé, poste, billet ou date requis.</p>
        {creation.clientId && !clientTemplates.length && <p role="status" className="mt-2 text-sm text-amber-300">{templateBefore ? 'Recherche des procédures enregistrées dans les pages suivantes…' : 'Aucune procédure liée à ce client. Une ancienne procédure globale reste dans les gabarits : utilisez « Dupliquer pour un client » puis sauvegardez sa copie pour ce client.'}</p>}
        <button className={`${buttonClass} mt-3`} disabled={busy || !!pending || pendingInvalid || !clients.some(c=>String(c.id)===creation.clientId && c.clientType==='ti')} onClick={()=>{if(!confirmLeave())return;clearSelectionFeedback();requestId.current++;editorRevision.current++;setModelRequestKey(null);setModel({id:0,clientId:Number(creation.clientId),name:'',version:0,sections:[]});setModelDirty(true);setDuplicating(false);}}>Nouvelle procédure client</button>
        {clients.filter(c=>c.clientType==='ti').map(c=><section key={c.id} aria-label={`Procédures — ${c.nom}`} className="mt-4"><h3 className="font-semibold text-white">{c.nom}</h3>{templates.filter(t=>t.clientId===c.id).map(t=><button key={t.id} className={`${buttonClass} mt-2 w-full text-left`} onClick={()=>{if(!confirmLeave())return;selectSaved(t);editorRevision.current++;setModelRequestKey(null);setModel(copy(t));setModelDirty(false);setDuplicating(false);}}>{t.name}</button>)}</section>)}
      </fieldset></Card>
      <Card><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold text-white">Gabarits globaux réutilisables</h2>{isAdmin&&<button className={buttonClass} disabled={busy} onClick={()=>{if(!confirmLeave())return;clearSelectionFeedback();requestId.current++;editorRevision.current++;setModelRequestKey(null);setModel({id:0,clientId:null,name:'',version:0,sections:[]});setModelDirty(true);setDuplicating(false);}}>Nouveau modèle global</button>}</div>
        <p className="mb-3 text-xs text-slate-400">Dupliquez un gabarit pour le client avant de produire sa procédure. Les historiques restent inchangés.</p>
        <div className="space-y-2">{templates.filter(t=>t.clientId===null).map(t=><div key={t.id} className="flex flex-wrap gap-2">{isAdmin&&<button className={buttonClass} disabled={busy} onClick={()=>{if(!confirmLeave())return;clearSelectionFeedback();requestId.current++;editorRevision.current++;setModelRequestKey(null);setModel(copy(t));setModelDirty(false);setDuplicating(false);}}>{t.name} · Global</button>}<button className={buttonClass} disabled={busy} onClick={()=>{if(!confirmLeave())return;clearSelectionFeedback();requestId.current++;editorRevision.current++;setModelRequestKey(null);setModel({...copy(t),id:0,clientId:null,version:0});setDuplicating(true);setModelDirty(true);}}>Dupliquer pour un client · {t.name}</button></div>)}</div>{templateBefore&&<button className={buttonClass} disabled={busy} onClick={()=>loadMore('template')}>Charger plus de modèles</button>}
      </Card>
    </div>
    <Card className="my-5 print:hidden"><h2 className="mb-3 text-lg font-semibold text-white">Historiques des dossiers — consultation seulement</h2><p className="text-sm text-slate-300">Ouvrir un historique ne change pas la procédure client sélectionnée ni ses exports.</p>{Array.from(new Set(dossiers.map(d=>d.clientId))).map(clientId=><section key={clientId} aria-label={`Historiques — ${dossiers.find(d=>d.clientId===clientId)!.clientName}`} className="mt-4"><h3 className="font-semibold text-white">{dossiers.find(d=>d.clientId===clientId)!.clientName}</h3><div className="grid gap-2 sm:grid-cols-2">{dossiers.filter(d=>d.clientId===clientId).map(d=><div key={d.id}><button disabled={busy} className={`${buttonClass} text-left`} onClick={()=>openDossier(d.id)}>Ouvrir {d.employee || d.computer || 'dossier historique'} · {d.clientName}{d.archivedAt?' · Archivé':''}</button>{isAdmin&&<button className={buttonClass} disabled={busy} onClick={()=>removeHistory(d)}>Supprimer l’historique #{d.id}</button>}</div>)}</div></section>)}{dossierBefore&&<button className={buttonClass} disabled={busy} onClick={()=>loadMore('dossier')}>Charger plus de dossiers</button>}</Card>
    {model && <Card className="my-5 print:hidden"><fieldset disabled={busy}><h2 className="mb-4 text-lg font-semibold text-white">Éditeur de procédure / gabarit</h2>
      <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm text-slate-300">Nom du modèle<input aria-label="Nom du modèle" className={inputClass} value={model.name} onChange={e => mutateModel(t => { t.name = e.target.value; })} /></label>
      {!model.id && <label className="text-sm text-slate-300">Portée<select aria-label="Client du modèle" disabled={!!pending && modelRequestKey===pending.payload.requestKey} className={inputClass} value={model.clientId ?? ''} onChange={e => mutateModel(t => { t.clientId = e.target.value ? Number(e.target.value) : null; })}>{duplicating && <option value="">Choisir un client TI</option>}{isAdmin && !duplicating && <option value="">Global</option>}{clients.filter(c => c.clientType === 'ti').map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}</select></label>}</div>
      {model.sections.map((section, i) => <div key={i} className="mt-4 rounded-lg border border-white/10 p-3"><div className="flex gap-2"><input aria-label={`Titre de section ${i + 1}`} className={inputClass} placeholder="Titre de section" value={section.title} onChange={e => mutateModel(t => { t.sections[i].title = e.target.value; })} /><button className={buttonClass} onClick={() => mutateModel(t => { t.sections.splice(i, 1); })}>Retirer la section {i + 1}</button></div>
        {section.steps.map((step, j) => <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]" key={step.id}><input aria-label={`Titre étape ${i + 1}.${j + 1}`} className={inputClass} placeholder="Étape" value={step.title} onChange={e => mutateModel(t => { t.sections[i].steps[j].title = e.target.value; })} /><input aria-label={`Note étape ${i + 1}.${j + 1}`} className={inputClass} placeholder="Note" value={step.note} onChange={e => mutateModel(t => { t.sections[i].steps[j].note = e.target.value; })} /><button className={buttonClass} onClick={() => mutateModel(t => { t.sections[i].steps.splice(j, 1); })}>Retirer l’étape</button></div>)}
        <button className={`${buttonClass} mt-2`} onClick={() => mutateModel(t => { t.sections[i].steps.push({ id: crypto.randomUUID(), title: '', note: '' }); })}>Ajouter une étape {i + 1}</button></div>)}
      <div className="mt-4 flex flex-wrap gap-2"><button className={buttonClass} onClick={() => mutateModel(t => { t.sections.push(newSection()); })}>Ajouter une section</button><button className={buttonClass} disabled={busy || (!model.id&&(!!pending||pendingInvalid)) || ((duplicating || !isAdmin) && !model.clientId) || !model.name.trim() || !model.sections.length || model.sections.some(s => !s.title.trim() || !s.steps.length || s.steps.some(step => !step.title.trim()))} onClick={saveModel}>Sauvegarder le modèle</button></div>
    </fieldset></Card>}
    {draft && <Card className="my-5 print:border-0 print:bg-white print:text-black"><fieldset disabled={busy}><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold text-white print:text-black">Dossier d’installation — {draft.clientName}</h2><p className="text-sm text-slate-300 print:text-black">{draft.archivedAt ? 'Archivé · Lecture seule' : 'Historique · Lecture seule'} · {progress?.done} / {progress?.total} étapes applicables terminées</p></div><div className="flex gap-2 print:hidden"><button className={buttonClass} disabled={dirty} onClick={() => window.print()}>Imprimer</button>{isAdmin&&<button className={buttonClass} disabled={busy} onClick={()=>removeHistory(draft)}>Supprimer l’historique ouvert #{draft.id}</button>}</div></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">{(['employee', 'computer', 'ticket', 'date'] as const).map(key => <label key={key} className="text-sm text-slate-300 print:text-black">{{employee:'Employé',computer:'Ordinateur',ticket:'Billet',date:'Date'}[key]}<input aria-label={{employee:'Employé',computer:'Ordinateur',ticket:'Billet',date:'Date'}[key]} className={`${inputClass} print:border-black print:bg-white print:text-black`} type={key === 'date' ? 'date' : 'text'} value={draft[key]} disabled readOnly /></label>)}</div>
      {draft.sections.map((section: DossierSection, i) => <section key={i} className="mt-5"><h3 className="mb-2 font-semibold text-white print:text-black">{section.title}</h3>{section.steps.map(step => <div key={step.id} className="workstation-print-area mb-3 rounded-lg border border-white/10 p-3 print:border-black"><div className="font-medium text-white print:text-black">{step.title}</div>{step.note && <p className="text-sm text-slate-400 print:text-black">{step.note}</p>}<div className="mt-2 grid gap-2 sm:grid-cols-[auto_1fr]"><label className="text-xs text-slate-300 print:text-black">État<select aria-label={`État — ${step.title}`} className={`${inputClass} workstation-print-control`} value={step.etat} disabled><option value="todo">À faire</option><option value="fait">Fait</option><option value="na">N/A</option></select><span className="workstation-print-answer hidden">{{todo:'À faire',fait:'Fait',na:'N/A'}[step.etat]}</span></label><label className="text-xs text-slate-300 print:text-black">Commentaire<textarea aria-label={`Commentaire — ${step.title}`} className={`${inputClass} workstation-print-control`} value={step.commentaire} disabled readOnly /><span className="workstation-print-answer hidden">{step.commentaire}</span></label></div></div>)}</section>)}

    </fieldset></Card>}
    <Card className="my-5 print:hidden"><h2 className="text-lg font-semibold text-white">Procédure HTML hors ligne</h2><p className="my-2 text-sm text-slate-300">Téléchargez uniquement la procédure générale enregistrée sélectionnée pour le client TI, indépendamment de l’historique ouvert. Le fichier autonome est une checklist cochable hors ligne. Utilisez « Imprimer / Enregistrer en PDF » pour conserver les coches sur papier ou en PDF : elles ne sont pas sauvegardées automatiquement. Copie locale, aucune synchronisation ni modification du dossier partagé dans Prime.</p><button className={`${buttonClass} mt-2`} disabled={busy} onClick={downloadHtml}>Télécharger la procédure HTML</button></Card>
    <Card className="my-5 print:hidden"><h2 className="text-lg font-semibold text-white">Générateur de script d’audit Windows</h2><p className="my-2 text-sm text-amber-300">Le script valide uniquement des éléments du poste Windows. Installation, configuration et autres tâches manuelles restent à vérifier par le technicien. Aucun script n’est exécuté dans le navigateur ou sur le serveur.</p>
      <p role="status" className="my-2 text-sm text-slate-200">Source : {`procédure enregistrée ${templates.find(t => String(t.id) === creation.templateId)?.name ?? 'à choisir'} du client ${clients.find(c => String(c.id) === creation.clientId)?.nom ?? 'à choisir'}`}.</p>
      <p className="my-2 text-xs text-amber-300">{scriptConfirmed ? `Paramètres confirmés pour ${clients.find(c=>String(c.id)===creation.clientId)?.nom}.` : "Les paramètres préremplis sont ceux de BZ : confirmez le préfixe, le compte, le clavier, l’imprimante et les applications pour ce client avant de télécharger."} Les étapes non automatisables resteront à vérifier.</p><button className={buttonClass} disabled={busy || !creation.clientId} onClick={()=>setScriptConfirmed(true)}>Confirmer les paramètres pour {clients.find(c=>String(c.id)===creation.clientId)?.nom ?? 'le client à choisir'}</button>
      <div className="grid gap-3 sm:grid-cols-2">{(['prefix','admin','keyboard','printer','apps'] as const).map(key => <label className="text-sm text-slate-300" key={key}>{{prefix:'Préfixe du client',admin:'Compte administrateur',keyboard:'Clavier attendu',printer:'Motif de l’imprimante (ex. TOSHIBA; vide = à vérifier)',apps:'Applications attendues (une par ligne)'}[key]}{key === 'apps' ? <textarea aria-label="Applications attendues" className={inputClass} value={script[key]} onChange={e => updateScript(key, e.target.value)} /> : <input aria-label={{prefix:'Préfixe du client',admin:'Compte administrateur',keyboard:'Clavier attendu',printer:'Motif de l’imprimante',apps:''}[key]} className={inputClass} value={script[key]} onChange={e => updateScript(key, e.target.value)} />}</label>)}</div>
      <button className={`${buttonClass} mt-3`} disabled={busy} onClick={downloadScript}>Télécharger le script .ps1</button>
    </Card>
  </Page>;
}
