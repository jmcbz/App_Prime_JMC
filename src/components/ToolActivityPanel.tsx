import {Link} from 'react-router-dom';
import {ArrowUpRight,Clock3,Wrench} from 'lucide-react';
import {Card} from './ui';
import {useControlData} from '../hooks/useControlData';
import {fetchTools,type ToolItem} from '../services/controlTowerService';
function ToolList({items,recent=false}:{items:ToolItem[];recent?:boolean}) {
 return <ul className="mt-3 divide-y divide-white/10">{items.map(item=><li key={`${item.module}:${item.id}`}><Link to={item.href} className="group flex items-center justify-between gap-3 rounded-lg py-3 hover:bg-white/5 focus-visible:outline focus-visible:outline-titan-cyan">
  <div className="min-w-0"><span className="text-[10px] font-semibold uppercase tracking-wider text-titan-cyan">{item.module==='onboarding'?'Prise en charge':'Installation postes'}</span><p className="break-words text-sm font-medium text-white">{item.title}</p><p className="text-xs text-slate-400">{item.clientName}{recent&&item.openedAt&&<> · <time dateTime={item.openedAt}>{new Date(item.openedAt).toLocaleString('fr-CA',{timeZone:'America/Toronto'})}</time></>}</p></div><ArrowUpRight className="h-4 w-4 shrink-0 text-slate-500 group-hover:text-titan-cyan"/>
 </Link></li>)}</ul>;
}
export default function ToolActivityPanel(){
 const {value,error,loading,reload}=useControlData(fetchTools);
 return <Card className="mt-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 text-base font-bold text-white"><Wrench className="h-4 w-4 text-titan-cyan"/>Trousse d’outils</h2><p className="mt-1 text-xs text-slate-400">Votre activité de consultation · dossiers du portefeuille courant</p></div><div className="flex flex-wrap gap-3 text-xs text-titan-cyan"><Link to="/procedures/prise-en-charge">Prise en charge ↗</Link><Link to="/procedures/installation-postes">Installation postes ↗</Link></div></div>
 {loading?<p role="status" className="mt-4 text-sm text-slate-400">Chargement des dossiers…</p>:error?<div role="alert" className="mt-4 text-sm text-red-300">{error} <button onClick={reload} className="underline">Réessayer</button></div>:value&&<div className="mt-5 grid gap-6 md:grid-cols-2">
  <section aria-label="Derniers dossiers consultés"><h3 className="flex items-center gap-2 text-sm font-semibold text-slate-200"><Clock3 className="h-4 w-4"/>Derniers dossiers consultés</h3><p className="mt-1 text-xs text-slate-500">{value.recentHasMore?`Les ${value.limit} dernières consultations`:'Consultations enregistrées avec ce compte'} · heure de Toronto</p>{value.recent.length?<ToolList items={value.recent} recent/>:<p className="mt-4 text-sm text-slate-400">Aucun dossier récent enregistré. Ouvrez un dossier pour le retrouver ici.</p>}</section>
  <section aria-label="Dossiers en cours"><h3 className="text-sm font-semibold text-slate-200">Dossiers en cours · {value.activeTotal}</h3><p className="mt-1 text-xs text-slate-500">{value.activeHasMore?`${value.active.length} sur ${value.activeTotal} · ouvrez les modules pour tout consulter`:'Non archivés · prise en charge ouverte ou étapes poste à faire'}</p>{value.active.length?<ToolList items={value.active}/>:<p className="mt-4 text-sm text-slate-400">Aucun dossier en cours dans ce portefeuille.</p>}</section>
 </div>}
 </Card>;
}
