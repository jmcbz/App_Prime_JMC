import {Link} from 'react-router-dom';
import {ArrowRight,ArrowUpRight,ClipboardList,Clock3,FolderOpen,Monitor,Wrench} from 'lucide-react';
import {Card} from './ui';
import {useControlData} from '../hooks/useControlData';
import {fetchTools,type ToolItem} from '../services/controlTowerService';

const focusClass = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-titan-cyan';
const actions = [
 {href:'/procedures/prise-en-charge',title:'Prise en charge',description:'Consulter les dossiers de prise en charge client.',icon:ClipboardList},
 {href:'/procedures/installation-postes',title:'Installation postes',description:'Retrouver les procédures et les dossiers de montage.',icon:Monitor},
];

function ToolList({items,recent=false}:{items:ToolItem[];recent?:boolean}) {
 return <ul className="mt-3 divide-y divide-white/10">{items.map(item=><li key={`${item.module}:${item.id}`}><Link to={item.href} className={`group flex min-h-16 items-center justify-between gap-3 rounded-lg px-3 py-3 hover:bg-white/5 ${focusClass}`}>
  <div className="min-w-0"><span className="text-xs font-medium text-titan-cyan">{item.module==='onboarding'?'Prise en charge':'Installation postes'}</span><p className="break-words text-sm font-semibold text-white">{item.title}</p><p className="break-words text-xs leading-relaxed text-slate-300">{item.clientName}{recent&&item.openedAt&&<> · <time dateTime={item.openedAt}>{new Date(item.openedAt).toLocaleString('fr-CA',{timeZone:'America/Toronto'})}</time></>}</p></div><ArrowUpRight aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-400 group-hover:text-titan-cyan"/>
 </Link></li>)}</ul>;
}

export default function ToolActivityPanel(){
 const {value,error,loading,reload}=useControlData(fetchTools);
 return <Card className="mt-6">
  <h2 className="flex items-center gap-2 text-base font-bold text-white"><Wrench aria-hidden="true" className="h-5 w-5 text-titan-cyan"/>Trousse d’outils</h2>
  <p className="mt-1 text-sm leading-relaxed text-slate-400">Votre activité de consultation · dossiers du portefeuille courant</p>
  <nav aria-label="Accès aux outils" className="mt-4 grid gap-3 md:grid-cols-2">
   {actions.map(({href,title,description,icon:Icon})=><Link key={href} to={href} className={`group flex min-h-20 items-center gap-3 rounded-xl border border-titan-cyan/25 bg-titan-cyan/5 p-4 transition-colors hover:border-titan-cyan/60 hover:bg-titan-cyan/10 ${focusClass}`}>
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-titan-cyan/10 text-titan-cyan"><Icon aria-hidden="true" className="h-5 w-5"/></span>
    <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-white">{title}</span><span className="mt-1 block text-xs leading-relaxed text-slate-300">{description}</span></span>
    <ArrowRight aria-hidden="true" className="h-5 w-5 shrink-0 text-titan-cyan"/>
   </Link>)}
  </nav>
  {loading?<p role="status" className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm text-slate-300">Chargement des dossiers…</p>:error?<div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-400/20 bg-red-400/5 p-4 text-sm text-red-300"><span>{error}</span><button onClick={reload} className={`min-h-11 rounded-lg border border-red-300/30 px-4 py-2 font-medium hover:bg-red-400/10 ${focusClass}`}>Réessayer</button></div>:value&&<div className="mt-4 grid gap-4 md:grid-cols-2">
   <section aria-label="Derniers dossiers consultés" className="min-w-0 rounded-xl border border-white/10 bg-white/[0.02] p-4">
    <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-100"><Clock3 aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-400"/><span className="flex-1">Derniers dossiers consultés</span><span aria-label={`${value.recent.length} dossiers affichés`} className="rounded-full bg-white/10 px-2 py-0.5 text-xs tabular-nums text-slate-200">{value.recent.length}</span></h3>
    <p className="mt-2 text-xs leading-relaxed text-slate-400">{value.recentHasMore?`Les ${value.limit} dernières consultations`:'Consultations enregistrées avec ce compte'} · heure de Toronto</p>
    {value.recent.length?<ToolList items={value.recent} recent/>:<div className="mt-4 text-sm leading-relaxed"><p className="font-medium text-slate-200">Aucun dossier récent enregistré.</p><p className="mt-1 text-slate-400">Ouvrez un dossier dans l’un des outils ci-dessus pour le retrouver ici.</p></div>}
   </section>
   <section aria-label="Dossiers en cours" className="min-w-0 rounded-xl border border-white/10 bg-white/[0.02] p-4">
    <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-100"><FolderOpen aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-400"/><span className="flex-1">Dossiers en cours</span><span aria-label={`${value.activeTotal} dossiers en cours`} className="rounded-full bg-white/10 px-2 py-0.5 text-xs tabular-nums text-slate-200">{value.activeTotal}</span></h3>
    <p className="mt-2 text-xs leading-relaxed text-slate-400">{value.activeHasMore?`${value.active.length} sur ${value.activeTotal} · ouvrez les modules pour tout consulter`:'Non archivés · prise en charge ouverte ou étapes poste à faire'}</p>
    {value.active.length?<ToolList items={value.active}/>:<div className="mt-4 text-sm leading-relaxed"><p className="font-medium text-slate-200">Aucun dossier en cours dans ce portefeuille.</p><p className="mt-1 text-slate-400">Consultez les outils ci-dessus pour retrouver vos dossiers.</p></div>}
   </section>
  </div>}
 </Card>;
}
