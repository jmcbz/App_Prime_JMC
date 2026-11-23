import { useCallback, useEffect, useRef, useState } from 'react';
import {useBlocker} from 'react-router-dom';
import { LEVELS, loadSkills, skillsRequest, SkillsApiError, type Competence, type Evaluation, type SkillsMatrix } from '../services/skillsService';
import { useAuth } from '../context/AuthContext';

const input='rounded-lg border border-white/20 bg-bz-dark px-3 py-2 text-sm text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-bz-blue';
const button='rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm text-white hover:bg-white/10 disabled:opacity-50';
const availability=(value:string)=>({disponible:'Disponible',charge:'Chargé',surcharge:'Surchargé'}[value]??'Non renseignée');
export default function SkillsMatrixPanel(){
 const {user}=useAuth();
 const [data,setData]=useState<SkillsMatrix|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false);
 const [prime,setPrime]=useState(''),[skill,setSkill]=useState(''),[level,setLevel]=useState(''),[archives,setArchives]=useState(false);
 const [view,setView]=useState<'matrix'|'summary'|'match'|'manage'>('matrix');
 const [requirements,setRequirements]=useState<Record<string,number>>({});
 const [edit,setEdit]=useState<Competence|null>(null);
 const [conflict,setConflict]=useState<Competence|null>(null);
 const revision=useRef(0),locked=useRef(false),pending=useRef<Competence|null>(null);
 const admin=user?.role==='admin'&&data?.canEdit===true;
 const canLeave=useCallback(()=>!busy&&!uncertain&&(!edit||window.confirm('Des modifications de compétence non sauvegardées seront perdues. Continuer ?')),[busy,uncertain,edit]);
 const blocker=useBlocker(Boolean(edit)||busy||uncertain);
 useEffect(()=>{if(blocker.state==='blocked'){if(canLeave())blocker.proceed();else blocker.reset();}},[blocker,canLeave]);
 useEffect(()=>{
  const leave=(event:Event)=>{if(!canLeave())event.preventDefault();};
  const unload=(event:BeforeUnloadEvent)=>{if(edit||busy||uncertain){event.preventDefault();event.returnValue='';}};
  const external=(event:MouseEvent)=>{
   const anchor=event.target instanceof Element?event.target.closest('a[href]') as HTMLAnchorElement|null:null;
   if(anchor&&anchor.origin!==window.location.origin&&!event.defaultPrevented&&!canLeave())event.preventDefault();
  };
  window.addEventListener('prime-skills:before-leave',leave);
  window.addEventListener('client-onboarding:before-logout',leave);
  window.addEventListener('beforeunload',unload);document.addEventListener('click',external,true);
  return()=>{window.removeEventListener('prime-skills:before-leave',leave);window.removeEventListener('client-onboarding:before-logout',leave);window.removeEventListener('beforeunload',unload);document.removeEventListener('click',external,true);};
 },[canLeave,edit,busy,uncertain]);
 useEffect(()=>{
  const request=++revision.current;
  loadSkills().then(d=>{if(request===revision.current)setData(d);}).catch(e=>{if(request===revision.current)setError(e.message);});
  return()=>{revision.current++;};
 },[]);
 const begin=()=>{if(locked.current)return null;locked.current=true;setBusy(true);setError('');setNotice('');return ++revision.current;};
 const finish=(request:number)=>{if(request===revision.current){locked.current=false;setBusy(false);}};
 const sameContent=(a:Competence,b:Competence)=>a.id===b.id&&a.name===b.name.trim()&&a.archived===b.archived;
 async function refresh(){
  const request=begin();if(request===null)return;
  try{
   const fresh=await loadSkills();if(request!==revision.current)return;setData(fresh);setUncertain(false);setConflict(null);
   const intent=pending.current;const draft=intent??edit;
   if(draft){
    const found=fresh.competences.find(s=>s.id===draft.id);
    if(intent&&found&&found.version===intent.version+1&&sameContent(found,intent)){
     setEdit(null);setNotice('Compétence enregistrée et relue.');
    }else if(found&&found.version!==draft.version){
     setConflict(found);setError('La version partagée a changé. Votre saisie est conservée; comparez avant de reprendre.');
    }else if(intent)setNotice('Écriture non confirmée par cette relecture. Saisie et identifiant conservés; vous pouvez réessayer.');
    pending.current=null;
   }
  }catch(e){if(request===revision.current)setError(e instanceof Error?e.message:'Lecture impossible');}finally{finish(request);}
 }
 function openEditor(next:Competence|null){setEdit(next);setConflict(null);setError('');setNotice('');}
 function evaluation(p:number,s:string){return data?.evaluations.find(e=>e.primeId===p&&e.competenceId===s);}
 async function saveLevel(p:number,s:string,value:string){
  const before=evaluation(p,s),next=value==='0'?null:Number(value);
  const request=begin();if(request===null)return;
  try{
   const saved=await skillsRequest<{evaluation:Evaluation}>(`/evaluations/${p}/${s}`,{level:next,expectedVersion:before?.version??0});
   const fresh=await loadSkills(),found=fresh.evaluations.find(e=>e.primeId===p&&e.competenceId===s);
   if(request!==revision.current)return;setData(fresh);
   if(!found||found.level!==next||found.version!==saved.evaluation?.version)throw new Error('Évaluation modifiée depuis votre sauvegarde. Rechargez la matrice.');
   setNotice('Évaluation enregistrée et relue.');
  }catch(e){if(request===revision.current){setError(`${e instanceof Error?e.message:'Enregistrement impossible'} — Rechargez pour vérifier l’état partagé avant une nouvelle modification.`);setUncertain(true);}}finally{finish(request);}
 }
 async function saveSkill(){
  if(!edit||conflict)return;
  const draft={...edit},request=begin();if(request===null)return;
  let writeConfirmed=false;
  try{
   const saved=await skillsRequest<{competence:Competence}>(`/competences/${draft.id}`,{name:draft.name,archived:draft.archived,expectedVersion:draft.version});
   writeConfirmed=true;
   const fresh=await loadSkills(),found=fresh.competences.find(s=>s.id===draft.id);
   if(request!==revision.current)return;setData(fresh);
   if(!found||found.version!==saved.competence?.version||!sameContent(found,draft))throw new Error('Compétence modifiée depuis votre sauvegarde');
   pending.current=null;setEdit(null);setConflict(null);setNotice('Compétence enregistrée et relue.');
  }catch(e){if(request===revision.current){
   const rejected=!writeConfirmed&&e instanceof SkillsApiError&&[400,409].includes(e.status);
   setError(`${e instanceof Error?e.message:'Enregistrement impossible'} — ${rejected?'Votre saisie est conservée. Corrigez-la ou rechargez pour comparer.':'Rechargez pour vérifier l’état partagé; votre saisie est conservée.'}`);
   setUncertain(!rejected);pending.current=rejected?null:draft;
  }}finally{finish(request);}
 }
 const active=data?.competences.filter(s=>!s.archived)??[];
 const columns=data?.competences.filter(s=>(archives||!s.archived)&&(!skill||s.id===skill))??[];
 const rows=data?.primes.filter(p=>(!prime||String(p.id)===prime)&&(!level||columns.some(s=>String(evaluation(p.id,s.id)?.level??0)===level)))??[];
 const required=active.filter(s=>requirements[s.id]);
 return <section aria-label="Maîtrise de polyvalence" className="min-w-0 space-y-4">
  <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold text-white">Maîtrise de polyvalence</h2><p className="mt-1 text-sm text-slate-400">À évaluer signifie inconnu, pas un niveau faible. Les spécialités des fiches alimentent ce catalogue partagé, sans déduire de niveau. Le libellé d’origine reste conservé.</p></div><button className={button} disabled={busy} onClick={()=>void refresh()}>Recharger la matrice</button></div>
  {error&&<p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-red-300">{error}</p>}
  {notice&&<p role="status" className="text-emerald-300">{notice}</p>}
  {!data&&!error&&<p role="status">Chargement de la matrice…</p>}
  {data&&<><nav aria-label="Vues polyvalence" className="flex flex-wrap gap-2">
   {([['matrix','Matrice'],['summary',admin?'Synthèse équipe':'Ma synthèse'],...(admin?[['match','Aide à l’attribution'],['manage','Gérer les compétences']]:[])] as [typeof view,string][]).map(([key,label])=><button key={key} className={button} aria-pressed={view===key} disabled={busy||!!edit} onClick={()=>{setView(key);setNotice('');}}>{label}</button>)}
  </nav>
  {view==='matrix'&&<><div className="flex flex-wrap gap-3">
   <label className="grid gap-1 text-sm">Prime<select aria-label="Filtre Prime" className={input} value={prime} onChange={e=>setPrime(e.target.value)}><option value="">Tous les profils accessibles</option>{data.primes.map(p=><option key={p.id} value={p.id}>{p.nom}</option>)}</select></label>
   <label className="grid gap-1 text-sm">Compétence<select aria-label="Filtre compétence" className={input} value={skill} onChange={e=>setSkill(e.target.value)}><option value="">Toutes les compétences</option>{data.competences.filter(s=>archives||!s.archived).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
   <label className="grid gap-1 text-sm">Niveau<select aria-label="Filtre niveau" className={input} value={level} onChange={e=>setLevel(e.target.value)}><option value="">Tous les niveaux</option>{LEVELS.map((l,i)=><option key={l} value={i}>{l}</option>)}</select></label>
   <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={archives} onChange={e=>{setArchives(e.target.checked);setSkill('');}}/>Inclure les compétences archivées</label>
  </div>
  <p className="text-xs text-slate-400">{admin?'Chaque changement de niveau est enregistré immédiatement. Seuls les administrateurs peuvent modifier.':'Évaluations en lecture seule; contactez un administrateur pour une modification.'} Le filtre niveau conserve les lignes avec au moins une correspondance dans les colonnes affichées.</p>
  <div className="max-w-full overflow-x-auto rounded-xl border border-white/10" tabIndex={0} aria-label="Défilement horizontal de la matrice">
   <table aria-label="Matrice de polyvalence" className="w-full border-collapse text-left text-sm"><thead className="bg-bz-dark"><tr><th scope="col" className="min-w-48 p-3">Prime / disponibilité actuelle</th>{columns.map(s=><th scope="col" key={s.id} className="min-w-52 max-w-64 p-3">{s.name}{s.archived?' · archivée':''}</th>)}</tr></thead>
   <tbody>{rows.map(p=><tr key={p.id} className="border-t border-white/10"><th scope="row" className="p-3"><span className="text-white">{p.nom}</span><span className="mt-1 block text-xs font-normal text-slate-400">{availability(p.disponibilite)} · {p.monthlyCount} tâches ce mois</span></th>{columns.map(s=>{const e=evaluation(p.id,s.id),value=e?.level??0;return <td key={s.id} className={`p-3 ${value===0?'text-slate-400':value>=3?'text-emerald-300':'text-amber-300'}`}>{data.specialties.filter(link=>link.primeId===p.id&&link.competenceId===s.id).map(link=><span key={link.label} className="mb-2 block text-xs text-violet-300">Spécialité : {link.label}</span>)}{admin&&!s.archived?<select aria-label={`${p.nom} — ${s.name}`} className={`${input} w-full`} disabled={busy||uncertain} value={value} onChange={ev=>void saveLevel(p.id,s.id,ev.target.value)}>{LEVELS.map((l,i)=><option key={l} value={i}>{l}</option>)}</select>:LEVELS[value]}{e&&<span className="mt-1 block text-xs text-slate-500">Évalué le {new Date(e.updatedAt).toLocaleDateString('fr-CA')}</span>}</td>;})}</tr>)}</tbody></table>
  </div>{!rows.length&&<p>{data.primes.length?'Aucun profil ne correspond aux filtres.':'Aucun profil Prime associé à votre compte. Contactez un administrateur.'}</p>}
  </>}
  {view==='summary'&&<div className="grid gap-4 lg:grid-cols-2"><div className="rounded-xl border border-white/10 p-4"><h3 className="font-semibold text-white">{admin?'Couverture de l’équipe':'Couverture de mon profil'}</h3><p className="my-2 text-xs text-slate-400">Sans autonome évalué ne signifie pas sans compétence. Les évaluations manquantes sont affichées séparément.</p><ul className="space-y-3">{active.map(s=>{const autonomy=data.primes.filter(p=>(evaluation(p.id,s.id)?.level??0)>=3);const unknown=data.primes.filter(p=>evaluation(p.id,s.id)?.level==null);return <li key={s.id}><strong>{s.name}</strong><div className="text-sm text-slate-400">{autonomy.length===0?'Sans autonome évalué':autonomy.length===1&&admin?`Dépendance à une seule personne évaluée : ${autonomy[0].nom}`:`${autonomy.length} autonome(s) / référent(s)`} · {unknown.length} à évaluer</div></li>;})}</ul></div><div className="rounded-xl border border-white/10 p-4"><h3 className="font-semibold text-white">Forces et pistes de formation</h3>{data.primes.map(p=><div key={p.id} className="mt-4"><h4 className="font-semibold">{p.nom}</h4><p className="text-sm text-emerald-300">Forces évaluées : {active.filter(s=>(evaluation(p.id,s.id)?.level??0)>=3).map(s=>s.name).join(', ')||'Aucune renseignée'}</p><p className="text-sm text-amber-300">Formation / accompagnement : {active.filter(s=>[1,2].includes(evaluation(p.id,s.id)?.level??0)).map(s=>s.name).join(', ')||'Aucun besoin évalué renseigné'}</p></div>)}</div></div>}
  {view==='match'&&admin&&<div className="space-y-4"><h3 className="font-semibold text-white">Exigences du client ou du projet</h3><p className="text-sm text-slate-400">Sélection temporaire, sans création de projet ni attribution automatique. Tous les profils sont présentés dans le même ordre, sans score ni classement selon leur disponibilité.</p><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{active.map(s=><label key={s.id} className="grid gap-1 text-sm">{s.name}<select aria-label={`Exigence — ${s.name}`} className={input} value={requirements[s.id]??0} onChange={e=>setRequirements(r=>({...r,[s.id]:Number(e.target.value)}))}><option value="0">Non requise</option>{LEVELS.slice(1).map((l,i)=><option key={l} value={i+1}>{l} minimum</option>)}</select></label>)}</div>
   {!required.length?<p>Sélectionnez au moins une compétence requise.</p>:<div className="grid gap-4 lg:grid-cols-2">{data.primes.map(p=><article key={p.id} className="rounded-xl border border-white/10 p-4"><h4 className="font-bold text-white">{p.nom}</h4><p className="my-2 text-sm">Disponibilité actuelle : {availability(p.disponibilite)} · {p.monthlyCount} tâches ce mois</p><ul className="space-y-1 text-sm">{required.map(s=>{const value=evaluation(p.id,s.id)?.level;const covered=value!=null&&value>=requirements[s.id];return <li key={s.id} className={covered?'text-emerald-300':'text-amber-300'}>{s.name} : {covered?'Exigence couverte':value==null?'À évaluer — couverture inconnue':'Écart'} · {LEVELS[value??0]} / requis {LEVELS[requirements[s.id]]}</li>;})}</ul></article>)}</div>}
  </div>}
  {view==='manage'&&admin&&<div className="space-y-4"><p className="text-sm text-slate-400">Archivage non destructif : les évaluations restent consultables. Le renommage conserve les anciens libellés des fiches comme correspondances; il ne réécrit pas les spécialités. Une spécialité encore utilisée ne peut pas être archivée; sa réintroduction dans une fiche restaure la compétence. Maximum 100 compétences, archives comprises.</p><button className={button} disabled={busy||!!edit||uncertain} onClick={()=>openEditor({id:crypto.randomUUID(),name:'',archived:false,version:0})}>Ajouter une compétence</button>
   {conflict&&edit&&<div className="rounded-xl border border-amber-500/40 p-3 text-sm"><p>Version partagée {conflict.version} : {conflict.name} · {conflict.archived?'archivée':'active'}. Votre saisie reste ci-dessous.</p><button type="button" className={button} disabled={busy||uncertain} onClick={()=>{if(window.confirm('Reprendre votre saisie sur cette version partagée ? Une prochaine sauvegarde remplacera son nom et son état.')){setEdit({...edit,version:conflict.version});setConflict(null);setError('');}}}>Reprendre sur la version actuelle</button></div>}
   {edit&&<form className="rounded-xl border border-bz-blue p-4 space-y-3" onSubmit={e=>{e.preventDefault();void saveSkill();}}><label className="grid gap-1">Nom de la compétence<input aria-label="Nom de la compétence" required maxLength={100} className={input} value={edit.name} disabled={busy||uncertain} onChange={e=>setEdit({...edit,name:e.target.value})}/></label><label className="flex gap-2"><input type="checkbox" checked={edit.archived} disabled={busy||uncertain} onChange={e=>setEdit({...edit,archived:e.target.checked})}/>Archivée (évaluations conservées)</label><div className="flex gap-2"><button className={button} disabled={busy||uncertain||!!conflict} type="submit">Enregistrer la compétence</button><button className={button} disabled={busy||uncertain} type="button" onClick={()=>openEditor(null)}>Annuler</button></div></form>}
   <ul className="space-y-2">{data.competences.map(s=><li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 p-3"><span>{s.name}{s.archived?' · archivée':''}</span><button className={button} disabled={busy||!!edit||uncertain} onClick={()=>openEditor({...s})} aria-label={`Modifier ${s.name}`}>Modifier</button></li>)}</ul>
  </div>}
  <p className="text-xs text-slate-500">Disponibilité distincte du niveau, relue le {new Date(data.availabilityAt).toLocaleString('fr-CA')}. Aucune attribution automatique.</p>
  </>}
 </section>;
}
