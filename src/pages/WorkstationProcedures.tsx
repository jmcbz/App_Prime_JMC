import { useEffect, useRef, useState } from 'react';
import { Page, PageHeader } from '../layout/Page';
import { Card } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { generateWorkstationAuditScript, DEFAULT_WORKSTATION_AUDIT_OPTIONS } from '../services/workstationAuditScript';
import {
  archiveDossier, createDossier, createTemplate, getDossier, getDossierByRequest, getTemplateByRequest, getStandardTemplate, listDossiers, listTemplates, listTiClients,
  ProcedureApiError, updateDossier, updateTemplate,
  type WorkstationDossier, type WorkstationTemplate, type TemplateSection, type DossierSection,
} from '../services/workstationProcedures';
import type { ClientPrime } from '../services/dataService';

const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const message = (error: unknown) => error instanceof Error ? error.message : 'Erreur inconnue';
const today = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; };
const blank = { clientId: '', templateId: '', employee: '', computer: '', ticket: '', date: today() };
const newSection = (): TemplateSection => ({ title: '', steps: [] });
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
type Recovery = { creation: typeof blank; draft: WorkstationDossier | null; model: WorkstationTemplate | null; dirty: boolean; modelDirty: boolean; duplicating: boolean };
const recovery = new WeakMap<Window, { userId: number | null; snapshot: Recovery | null }>();

export default function WorkstationProcedures() {
  const { user } = useAuth();
  return <WorkstationEditor key={user?.id ?? 'anonymous'} userId={user?.id ?? null} isAdmin={user?.role === 'admin'} />;
}

function WorkstationEditor({ userId, isAdmin }: { userId: number | null; isAdmin: boolean }) {
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
  const [creation, setCreation] = useState(restored.current?.creation ?? { ...blank });
  const creationDirty = Object.entries(blank).some(([key, value]) => creation[key as keyof typeof blank] !== value);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(restored.current?.dirty ?? false);
  const [modelDirty, setModelDirty] = useState(restored.current?.modelDirty ?? false);
  const [script, setScript] = useState({ prefix: DEFAULT_WORKSTATION_AUDIT_OPTIONS.computerPrefix, admin: DEFAULT_WORKSTATION_AUDIT_OPTIONS.adminLocal, keyboard: DEFAULT_WORKSTATION_AUDIT_OPTIONS.keyboards.join(', '), printer: DEFAULT_WORKSTATION_AUDIT_OPTIONS.printerName, apps: DEFAULT_WORKSTATION_AUDIT_OPTIONS.apps.join('\n') });
  const requestId = useRef(0);
  const locked = useRef(false);
  // Reconciliation owns the editor only until a person selects or edits another one.
  const editorRevision = useRef(0);
  const creationRevision = useRef(0);
  const editorState = useRef({ dirty, modelDirty, creationDirty });
  editorState.current = { dirty, modelDirty, creationDirty };
  const confirmLeave = () => (!dirty && !modelDirty && !creationDirty) || window.confirm('Des modifications non sauvegardées seront perdues. Continuer ?');
  useEffect(() => {
    const entry = recovery.get(window);
    if (entry?.userId === userId) entry.snapshot = dirty || modelDirty || creationDirty
      ? { draft, model, creation, dirty, modelDirty, duplicating } : null;
  }, [userId, draft, model, creation, dirty, modelDirty, creationDirty, duplicating]);

  useEffect(() => {
    let active = true;
    const failed=(e:unknown)=>{if(active)setError(message(e));};
    void listTiClients().then(c=>{if(active)setClients(c);}).catch(failed);
    void listTemplates().then(t=>{if(active){setTemplates(items=>mergeById(items,t.items));setTemplateBefore(t.nextBefore);}}).catch(failed);
    void getStandardTemplate().then(standard=>{if(active)setTemplates(items=>mergeById(items,[standard]));}).catch(failed);
    void listDossiers().then(d=>{if(active){setDossiers(items=>mergeById(d.items,items));setDossierBefore(d.nextBefore);}}).catch(failed);
    return () => { active = false; requestId.current++; };
  }, []);
  useEffect(() => {
    // React Router's links are delegated; intercept before it handles navigation.
    const onLink = (event: MouseEvent) => {
      if ((!dirty && !modelDirty && !creationDirty && !busy) || event.defaultPrevented) return;
      const target = event.target;
      const anchor = target && 'closest' in target ? (target as Element).closest('a[href]') : null;
      if (anchor && (busy || !window.confirm('Des modifications non sauvegardées seront perdues. Continuer ?'))) event.preventDefault();
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
    catch (e) { setError(e instanceof ProcedureApiError && e.status === 409 ? `Conflit de version : ${message(e)}. Vos modifications sont conservées; rechargez après les avoir copiées ou réessayez après vérification.` : message(e)); }
    finally { locked.current = false; setBusy(false); }
  };
  const finishIntent=(intent:Intent,item:WorkstationDossier|WorkstationTemplate,editorAtStart:number,creationAtStart:number,ownsDraft=false)=>{
    const stored=readPending(userId);
    if(!stored)return; // Another readback has already reconciled this intent.
    if(stored.kind!==intent.kind||stored.payload.requestKey!==intent.payload.requestKey)throw Error('Création en attente différente : réconciliation bloquée');
    window.sessionStorage.removeItem(pendingKey(userId!));
    if(window.sessionStorage.getItem(pendingKey(userId!))!==null)throw Error('Nettoyage de la création impossible');
    const current=editorState.current;
    const canSelect=editorRevision.current===editorAtStart&&(ownsDraft||!current.dirty&&!current.modelDirty);
    if(intent.kind==='dossier'){
      const saved=item as WorkstationDossier;
      setDossiers(items=>mergeById(items,[saved]));
      if(canSelect){setDraft(copy(saved));setModel(null);setDirty(false);setModelDirty(false);editorRevision.current++;}
      if(creationRevision.current===creationAtStart&&(ownsDraft||!current.creationDirty))setCreation({...blank});
      setNotice('Dossier créé.');
    }
    else {
      const saved=item as WorkstationTemplate;
      setTemplates(items=>mergeById(items,[saved]));
      if(canSelect){setModel(copy(saved));setModelDirty(false);setDuplicating(false);editorRevision.current++;}
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
    }
    try {if(intent.kind==='dossier')await createDossier(intent.payload);else await createTemplate(intent.payload);}
    catch(e){
      if(e instanceof ProcedureApiError&&e.status===400&&e.message!=='Réponse serveur invalide'){
        discardRejectedIntent();
        throw e;
      }
      if(e instanceof ProcedureApiError&&[403,409].includes(e.status))throw e;
    }
    try {finishIntent(intent,await lookupIntent(intent),editorAtStart,creationAtStart,!retry);}
    catch(e){throw Error(`Création non confirmée. Vérifiez ou réessayez avec la même clé. ${message(e)}`);}
  };
  useEffect(()=>{
    if(!pending)return;
    let active=true;
    const editorAtStart=editorRevision.current,creationAtStart=creationRevision.current;
    void lookupIntent(pending).then(item=>{if(active)finishIntent(pending,item,editorAtStart,creationAtStart);}).catch(e=>{if(active&&!(e instanceof ProcedureApiError&&e.status===404))setError(`Création à vérifier : ${message(e)}`);});
    return ()=>{active=false;};
    // Only on mount: 404 can be temporary and must never trigger a new key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  const loadMore=(kind:'template'|'dossier')=>{const before=kind==='template'?templateBefore:dossierBefore;if(!before)return;
    void run(async()=>{const result=kind==='template'?await listTemplates(before):await listDossiers(before);
      if(result.hasMore&&result.nextBefore!==null&&result.nextBefore>=before)throw Error('Curseur invalide');
      if(kind==='template'){setTemplates(items=>mergeById(items,result.items as WorkstationTemplate[]));setTemplateBefore(result.nextBefore);}
      else {setDossiers(items=>mergeById(items,result.items as WorkstationDossier[]));setDossierBefore(result.nextBefore);}
    });
  };
  const openDossier = (id: number) => {
    if (locked.current || !confirmLeave()) return;
    const token = ++requestId.current;
    setError('');
    void run(async () => { const item = await getDossier(id); if (token !== requestId.current) return; editorRevision.current++;setDraft(copy(item)); setModel(null); setDirty(false); setModelDirty(false); });
  };
  const mutateDossier = (change: (item: WorkstationDossier) => void) => {
    if (!draft || draft.archivedAt) return;
    const next = copy(draft); change(next); editorRevision.current++;setDraft(next); setDirty(true);
  };
  const mutateModel = (change: (item: WorkstationTemplate) => void) => {
    if (!model) return;
    const next = copy(model); change(next); editorRevision.current++;setModel(next); setModelDirty(true);
  };
  const saveDossier = () => { if (!draft || draft.archivedAt) return; void run(async () => {
    const updated = await updateDossier(draft.id, { expectedVersion: draft.version, employee: draft.employee, computer: draft.computer, ticket: draft.ticket, date: draft.date, sections: draft.sections });
    setDraft(copy(updated)); setDossiers(items => items.map(i => i.id === updated.id ? updated : i)); setDirty(false); setNotice('Dossier sauvegardé.');
  }); };
  const saveModel = () => { if (!model) return; void run(async () => {
    if(!model.id){await executeIntent({kind:'template',payload:{clientId:model.clientId,name:model.name,sections:copy(model.sections),requestKey:crypto.randomUUID()}});return;}
    const saved = await updateTemplate(model.id, { name: model.name, sections: model.sections, expectedVersion: model.version });
    setTemplates(items => [...items.filter(i => i.id !== saved.id), saved]); setModel(copy(saved)); setModelDirty(false); setDuplicating(false); setNotice('Modèle sauvegardé. Les dossiers déjà créés ne sont pas modifiés.');
  }); };
  const create = () => { if (!creation.clientId || !creation.templateId) { setError('Choisissez un client TI et un modèle.'); return; }
    if ((dirty || modelDirty) && !window.confirm('Des modifications non sauvegardées seront perdues. Continuer ?')) return;
    void run(async () => {
      await executeIntent({kind:'dossier',payload:{requestKey:crypto.randomUUID(),clientId:Number(creation.clientId),templateId:Number(creation.templateId),employee:creation.employee,computer:creation.computer,ticket:creation.ticket,date:creation.date}});
    });
  };
  const archive = () => { if (!draft || dirty || !window.confirm('Archiver ce dossier ? Il deviendra en lecture seule.')) return;
    void run(async () => { const saved = await archiveDossier(draft.id, draft.version); setDraft(copy(saved)); setDossiers(items => items.map(i => i.id === saved.id ? saved : i)); setNotice('Dossier archivé.'); });
  };
  const clientTemplates = templates.filter(t => t.clientId === null || String(t.clientId) === creation.clientId);
  const progress = draft ? draft.sections.flatMap(s => s.steps).reduce((v, step) => ({ done: v.done + Number(step.etat === 'fait'), total: v.total + Number(step.etat !== 'na') }), { done: 0, total: 0 }) : null;
  const downloadScript = () => {
    try {
      const result = generateWorkstationAuditScript({ clientName: draft?.clientName || clients.find(c => String(c.id) === creation.clientId)?.nom || DEFAULT_WORKSTATION_AUDIT_OPTIONS.clientName, computerPrefix: script.prefix, adminLocal: script.admin, keyboards: script.keyboard.split(',').map(v => v.trim()).filter(Boolean), printerName: script.printer, apps: script.apps.split('\n').map(v => v.trim()).filter(Boolean) });
      const text = typeof result === 'string' ? result : String(result);
      const url = URL.createObjectURL(new Blob(['\uFEFF', text], { type: 'text/plain;charset=utf-8' }));
      const a = document.createElement('a'); a.href = url; a.download = 'audit-poste-windows.ps1'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError(message(e)); }
  };
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
    <PageHeader titre="Installation de postes" sousTitre="Modèles partagés, dossiers d'installation et audit Windows" />
    {error && <p role="alert" className="mb-4 rounded-lg border border-red-500 p-3 text-red-300">{error}</p>}
    {notice && <p role="status" className="mb-4 text-green-300">{notice}</p>}
    {(pending||pendingInvalid)&&<div role="status" className="mb-4 text-amber-300">Création en attente de confirmation. Aucune nouvelle création autorisée. {pending&&<><button className={buttonClass} disabled={busy} onClick={()=>void run(async()=>{const editorAtStart=editorRevision.current,creationAtStart=creationRevision.current;finishIntent(pending,await lookupIntent(pending),editorAtStart,creationAtStart);})}>Vérifier la création</button><button className={buttonClass} disabled={busy} onClick={()=>void run(()=>executeIntent(pending,true))}>Réessayer la création {pending.kind==='dossier'?'du dossier':'du modèle'}</button></>}</div>}
    <div className="grid gap-5 lg:grid-cols-2 print:hidden">
      <Card><fieldset disabled={busy}><h2 className="mb-3 text-lg font-semibold text-white">Nouveau dossier</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm text-slate-300">Client<select aria-label="Client" className={inputClass} value={creation.clientId} onChange={e => {creationRevision.current++;setCreation({ ...creation, clientId: e.target.value, templateId: '' });}}><option value="">Choisir</option>{clients.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}</select></label>
          <label className="text-sm text-slate-300">Modèle<select aria-label="Modèle" className={inputClass} value={creation.templateId} onChange={e => {creationRevision.current++;setCreation({ ...creation, templateId: e.target.value });}}><option value="">Choisir</option>{clientTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          {(['employee', 'computer', 'ticket', 'date'] as const).map((key) => <label key={key} className="text-sm text-slate-300">{{ employee: 'Employé', computer: 'Ordinateur', ticket: 'Billet', date: 'Date' }[key]}<input aria-label={{ employee: 'Employé', computer: 'Ordinateur', ticket: 'Billet', date: 'Date' }[key]} type={key === 'date' ? 'date' : 'text'} className={inputClass} value={creation[key]} onChange={e => {creationRevision.current++;setCreation({ ...creation, [key]: e.target.value });}} /></label>)}
        </div><button disabled={busy||!!pending||pendingInvalid} className={`${buttonClass} mt-4`} onClick={create}>Créer le dossier</button></fieldset>
      </Card>
      <Card><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold text-white">Modèles de procédure</h2><button className={buttonClass} disabled={busy} onClick={() => { if (!confirmLeave()) return; editorRevision.current++;setModel({ id: 0, clientId: isAdmin ? null : clients[0]?.id ?? null, name: '', version: 0, sections: [] }); setDuplicating(false); setDraft(null); setDirty(false); setModelDirty(false); }}>Nouveau modèle</button></div>
        <p className="mb-3 text-xs text-slate-400">Modèles globaux ou propres à un client TI. Modifier un modèle ne change jamais les dossiers existants.</p>
        <div className="space-y-2">{templates.map(t => <div key={t.id} className="flex flex-wrap gap-2">{(isAdmin || t.clientId !== null) && <button className={`${buttonClass} min-w-0 flex-1 text-left`} disabled={busy} onClick={() => { if (!confirmLeave()) return; requestId.current++;editorRevision.current++; setModel(copy(t)); setDuplicating(false); setDraft(null); setDirty(false); setModelDirty(false); }}>{t.name} · {t.clientId == null ? 'Global' : clients.find(c => c.id === t.clientId)?.nom || 'Client TI'}</button>}{t.clientId === null && <button className={buttonClass} disabled={busy} onClick={() => { if (!confirmLeave()) return; requestId.current++;editorRevision.current++; setModel({ ...copy(t), id: 0, clientId: null, version: 0 }); setDuplicating(true); setDraft(null); setDirty(false); setModelDirty(true); }}>Dupliquer pour un client · {t.name}</button>}</div>)}</div>{templateBefore&&<button className={buttonClass} disabled={busy} onClick={()=>loadMore('template')}>Charger plus de modèles</button>}
      </Card>
    </div>
    <Card className="my-5 print:hidden"><h2 className="mb-3 text-lg font-semibold text-white">Dossiers partagés</h2><div className="grid gap-2 sm:grid-cols-2">{dossiers.map(d => <button key={d.id} disabled={busy} className={`${buttonClass} text-left`} onClick={() => openDossier(d.id)}>Ouvrir {d.employee || `dossier ${d.id}`} · {d.clientName}{d.archivedAt ? ' · Archivé' : ''}</button>)}</div>{dossierBefore&&<button className={buttonClass} disabled={busy} onClick={()=>loadMore('dossier')}>Charger plus de dossiers</button>}</Card>
    {model && <Card className="my-5 print:hidden"><fieldset disabled={busy}><h2 className="mb-4 text-lg font-semibold text-white">Éditeur de modèle</h2>
      <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm text-slate-300">Nom du modèle<input aria-label="Nom du modèle" className={inputClass} value={model.name} onChange={e => mutateModel(t => { t.name = e.target.value; })} /></label>
      {!model.id && <label className="text-sm text-slate-300">Portée<select aria-label="Client du modèle" className={inputClass} value={model.clientId ?? ''} onChange={e => mutateModel(t => { t.clientId = e.target.value ? Number(e.target.value) : null; })}>{duplicating && <option value="">Choisir un client TI</option>}{isAdmin && !duplicating && <option value="">Global</option>}{clients.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}</select></label>}</div>
      {model.sections.map((section, i) => <div key={i} className="mt-4 rounded-lg border border-white/10 p-3"><div className="flex gap-2"><input aria-label={`Titre de section ${i + 1}`} className={inputClass} placeholder="Titre de section" value={section.title} onChange={e => mutateModel(t => { t.sections[i].title = e.target.value; })} /><button className={buttonClass} onClick={() => mutateModel(t => { t.sections.splice(i, 1); })}>Retirer la section {i + 1}</button></div>
        {section.steps.map((step, j) => <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]" key={step.id}><input aria-label={`Titre étape ${i + 1}.${j + 1}`} className={inputClass} placeholder="Étape" value={step.title} onChange={e => mutateModel(t => { t.sections[i].steps[j].title = e.target.value; })} /><input aria-label={`Note étape ${i + 1}.${j + 1}`} className={inputClass} placeholder="Note" value={step.note} onChange={e => mutateModel(t => { t.sections[i].steps[j].note = e.target.value; })} /><button className={buttonClass} onClick={() => mutateModel(t => { t.sections[i].steps.splice(j, 1); })}>Retirer l’étape</button></div>)}
        <button className={`${buttonClass} mt-2`} onClick={() => mutateModel(t => { t.sections[i].steps.push({ id: crypto.randomUUID(), title: '', note: '' }); })}>Ajouter une étape {i + 1}</button></div>)}
      <div className="mt-4 flex flex-wrap gap-2"><button className={buttonClass} onClick={() => mutateModel(t => { t.sections.push(newSection()); })}>Ajouter une section</button><button className={buttonClass} disabled={busy || (!model.id&&(!!pending||pendingInvalid)) || ((duplicating || !isAdmin) && !model.clientId) || !model.name.trim() || !model.sections.length || model.sections.some(s => !s.title.trim() || !s.steps.length || s.steps.some(step => !step.title.trim()))} onClick={saveModel}>Sauvegarder le modèle</button></div>
    </fieldset></Card>}
    {draft && <Card className="my-5 print:border-0 print:bg-white print:text-black"><fieldset disabled={busy}><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold text-white print:text-black">Dossier d’installation — {draft.clientName}</h2><p className="text-sm text-slate-300 print:text-black">{draft.archivedAt ? 'Archivé · Lecture seule' : 'Dossier actif'} · {progress?.done} / {progress?.total} étapes applicables terminées</p></div><button className={`${buttonClass} print:hidden`} disabled={dirty} onClick={() => window.print()}>Imprimer</button></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">{(['employee', 'computer', 'ticket', 'date'] as const).map(key => <label key={key} className="text-sm text-slate-300 print:text-black">{{employee:'Employé',computer:'Ordinateur',ticket:'Billet',date:'Date'}[key]}<input aria-label={{employee:'Employé',computer:'Ordinateur',ticket:'Billet',date:'Date'}[key]} className={`${inputClass} print:border-black print:bg-white print:text-black`} type={key === 'date' ? 'date' : 'text'} value={draft[key]} disabled={!!draft.archivedAt} onChange={e => mutateDossier(d => { d[key] = e.target.value; })} /></label>)}</div>
      {draft.sections.map((section: DossierSection, i) => <section key={i} className="mt-5"><h3 className="mb-2 font-semibold text-white print:text-black">{section.title}</h3>{section.steps.map((step, j) => <div key={step.id} className="workstation-print-area mb-3 rounded-lg border border-white/10 p-3 print:border-black"><div className="font-medium text-white print:text-black">{step.title}</div>{step.note && <p className="text-sm text-slate-400 print:text-black">{step.note}</p>}<div className="mt-2 grid gap-2 sm:grid-cols-[auto_1fr]"><label className="text-xs text-slate-300 print:text-black">État<select aria-label={`État — ${step.title}`} className={`${inputClass} workstation-print-control`} value={step.etat} disabled={!!draft.archivedAt} onChange={e => mutateDossier(d => { d.sections[i].steps[j].etat = e.target.value as 'todo' | 'fait' | 'na'; })}><option value="todo">À faire</option><option value="fait">Fait</option><option value="na">N/A</option></select><span className="workstation-print-answer hidden">{{todo:'À faire',fait:'Fait',na:'N/A'}[step.etat]}</span></label><label className="text-xs text-slate-300 print:text-black">Commentaire<textarea aria-label={`Commentaire — ${step.title}`} className={`${inputClass} workstation-print-control`} value={step.commentaire} disabled={!!draft.archivedAt} onChange={e => mutateDossier(d => { d.sections[i].steps[j].commentaire = e.target.value; })} /><span className="workstation-print-answer hidden">{step.commentaire}</span></label></div></div>)}</section>)}
      {!draft.archivedAt && <div className="flex flex-wrap gap-2 print:hidden"><button className={buttonClass} disabled={busy || !dirty} onClick={saveDossier}>Sauvegarder le dossier</button><button className={buttonClass} disabled={busy || dirty} onClick={archive}>Archiver le dossier</button></div>}
    </fieldset></Card>}
    <Card className="my-5 print:hidden"><h2 className="text-lg font-semibold text-white">Générateur de script d’audit Windows</h2><p className="my-2 text-sm text-amber-300">Le script valide uniquement des éléments du poste Windows. Installation, configuration et autres tâches manuelles restent à vérifier par le technicien. Aucun script n’est exécuté dans le navigateur ou sur le serveur.</p>
      <div className="grid gap-3 sm:grid-cols-2">{(['prefix','admin','keyboard','printer','apps'] as const).map(key => <label className="text-sm text-slate-300" key={key}>{{prefix:'Préfixe du client',admin:'Compte administrateur',keyboard:'Clavier attendu',printer:'Motif de l’imprimante (ex. TOSHIBA; vide = toute imprimante)',apps:'Applications attendues (une par ligne)'}[key]}{key === 'apps' ? <textarea aria-label="Applications attendues" className={inputClass} value={script[key]} onChange={e => setScript({ ...script, [key]: e.target.value })} /> : <input aria-label={{prefix:'Préfixe du client',admin:'Compte administrateur',keyboard:'Clavier attendu',printer:'Motif de l’imprimante',apps:''}[key]} className={inputClass} value={script[key]} onChange={e => setScript({ ...script, [key]: e.target.value })} />}</label>)}</div>
      <button className={`${buttonClass} mt-3`} onClick={downloadScript}>Télécharger le script .ps1</button>
    </Card>
  </Page>;
}
