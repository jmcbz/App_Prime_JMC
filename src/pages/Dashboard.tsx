import {useState} from 'react';
import {Link} from 'react-router-dom';
import {Building2,ListChecks,AlertTriangle,CalendarDays,ArrowUpRight} from 'lucide-react';
import {Page,PageHeader} from '../layout/Page';
import {Card,SuiviBadge,DispoPastille} from '../components/ui';
import {useAuth} from '../context/AuthContext';
import {useControlData} from '../hooks/useControlData';
import {fetchTower} from '../services/controlTowerService';
import ToolActivityPanel from '../components/ToolActivityPanel';
export default function Dashboard(){
 const {user}=useAuth();const admin=user?.role==='admin';const {value,error,loading,reload}=useControlData(fetchTower);const [all,setAll]=useState(false);
 const overdue=value?.tasks.filter(t=>t.due<value.period.today).length;
 return <Page><PageHeader titre="Tour de contrôle" sousTitre={admin?'Équipe Prime · priorités, capacité et dossiers clients.':'Mon portefeuille · les bonnes actions, au bon moment.'}/>
 {loading?<div role="status" className="py-10 text-sm text-slate-400">Chargement de la synthèse…</div>:error?<Card><div role="alert" className="text-sm text-red-300">{error}. Les compteurs ne sont pas disponibles. <button onClick={reload} className="underline">Réessayer</button></div></Card>:value&&<>
  {!admin&&!value.primes.length&&<p className="mb-4 rounded-xl border border-bz-amber/30 p-4 text-sm text-bz-amber">Aucun Prime associé à votre compte. Communiquez avec un administrateur.</p>}
  <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-titan-cyan/20 bg-titan-cyan/5 px-4 py-3"><div className="flex items-center gap-2 text-sm text-titan-cyan"><CalendarDays className="h-4 w-4"/>Du {value.period.start} au {value.period.last}</div><span className="text-xs text-slate-400">Mois civil en cours · America/Toronto</span></div>
  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[
   {label:'Clients du portefeuille',n:value.clientCount,icon:Building2,color:'text-bz-blue2'},
   {label:'Tâches ouvertes du mois',n:value.tasks.length,icon:ListChecks,color:'text-titan-cyan'},
   {label:'En retard dans ce mois',n:overdue,icon:CalendarDays,color:'text-bz-amber'},
   {label:'Bloquées dans ce mois',n:value.tasks.filter(t=>t.status==='bloque').length,icon:AlertTriangle,color:'text-red-400'},
  ].map(({label,n,icon:Icon,color})=><Card key={label}><div className="flex items-start justify-between gap-2"><p className="text-xs font-medium text-slate-400">{label}</p><Icon className={`h-4 w-4 shrink-0 ${color}`}/></div><p className="mt-3 text-3xl font-extrabold text-white">{n}</p></Card>)}</div>
  <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]">
   <Card><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-base font-bold text-white">Suivis prioritaires dans le prochain mois</h2><p className="mt-1 text-xs text-slate-400">Période calculée : du {value.period.start} au {value.period.last} — mois civil en cours</p></div><span className="rounded-full bg-titan-cyan/10 px-3 py-1 text-xs font-semibold text-titan-cyan">{value.tasks.length} tâches</span></div>
    <p className="mt-3 text-xs text-slate-500">Échéances réelles · actions ouvertes seulement · archives exclues</p>
    <ul className="mt-3 divide-y divide-white/10">{value.tasks.slice(0,all?undefined:6).map(t=><li key={t.id} className="py-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[11px] font-semibold uppercase tracking-wide text-titan-cyan">{t.clientName} · {t.source==='tableau'?'Rubrique':'Ancien suivi'}</p><SuiviBadge statut={t.status}/></div><Link to={t.clientId?`/suivis?client=${t.clientId}`:'/suivis'} className="mt-2 flex items-start justify-between gap-3 text-sm font-medium text-white hover:text-titan-cyan"><span className="break-words">{t.title}</span><ArrowUpRight className="h-4 w-4 shrink-0"/></Link><div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs"><span className="text-slate-400">Date de départ : {t.departure||'—'}</span><span className={t.due<value.period.today?'text-red-300':'text-slate-300'}>Échéance : {t.due}{t.due<value.period.today?' · en retard':''}</span></div></li>)}</ul>
    {!value.tasks.length&&<p className="py-8 text-sm text-slate-400">Aucune tâche ouverte avec échéance dans ce mois.</p>}
    {value.tasks.length>6&&<button onClick={()=>setAll(v=>!v)} className="mt-3 rounded-lg border border-white/15 px-3 py-2 text-xs text-titan-cyan">{all?'Réduire la liste':`Afficher les ${value.tasks.length} tâches`}</button>}
   </Card>
   <Card><h2 className="text-base font-bold text-white">{admin?'Charge des Primes':'Ma charge du mois'}</h2><ul className="mt-3 divide-y divide-white/10">{value.primes.map(p=><li key={p.id} className="py-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-semibold text-white">{p.nom}</span><DispoPastille dispo={p.effectiveAvailability}/></div><p className="mt-2 text-sm text-slate-300">{p.monthlyCount} tâches ce mois</p><p className="mt-1 text-xs text-slate-400">{p.manualAvailability!=='disponible'?'Disponibilité manuelle conservée':p.autoCharge?'Automatique · seuil de charge atteint':'Automatique · capacité disponible'}</p>{p.autoCharge&&p.manualAvailability!=='disponible'&&<p className="mt-1 text-xs text-bz-amber">Charge automatique également active</p>}</li>)}</ul><p className="mt-3 border-t border-white/10 pt-3 text-xs leading-relaxed text-slate-500">Chargé au-delà de 5 tâches. Maintenu à 5, levé sous 5. Les états manuels Chargé et Surchargé restent prioritaires.</p>{value.riskCount>0&&<Link to="/clients" className="mt-4 block rounded-lg bg-red-500/10 p-3 text-xs text-red-300">{value.riskCount} client(s) à risque · consulter ↗</Link>}</Card>
  </div>
 </>}
 <ToolActivityPanel/>
 </Page>;
}
