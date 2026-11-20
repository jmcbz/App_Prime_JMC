import { useState } from 'react';
import { Card } from '../components/ui';
import { localDay, portfolioClients, searchClients } from '../lib/suivisPortfolio';
import type { ClientPrime, Suivi } from '../services/dataService';
import type { TableauSuivi } from '../services/tableauxSuiviService';

export default function SuivisPortfolio({clients, tableaux, suivis, onSelect}: {
  clients: ClientPrime[]; tableaux: TableauSuivi[]; suivis: Suivi[]; onSelect:(id:number)=>void;
}) {
  const [search,setSearch]=useState('');
  const [filter,setFilter]=useState('tous');
  const today=localDay();
  const rows=portfolioClients(clients,tableaux,suivis,today);
  const totals=rows.reduce((sum,r)=>({overdue:sum.overdue+r.overdue,today:sum.today+r.dueToday,undated:sum.undated+r.undated}),{overdue:0,today:0,undated:0});
  const visible=searchClients(rows,search).filter(r=>filter==='retard'?r.overdue>0:filter==='aujourdhui'?r.dueToday>0:filter==='sans'?r.undated>0:true);
  return <section aria-label="Vue d’ensemble des clients et priorités" className="space-y-5">
    <div><h2 className="text-xl font-semibold text-white">Clients et priorités</h2>
      <p className="mt-1 max-w-3xl text-sm text-slate-400">Les actions ouvertes de vos tableaux courants et les anciens suivis non clôturés. Classement par échéance réelle, de la plus ancienne à la plus proche.</p>
    </div>
    <div aria-label="Totaux du portefeuille filtré par Prime" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {[{key:'tous',value:rows.length,label:'Clients',tone:'text-white'}, {key:'retard',value:totals.overdue,label:'Actions en retard',tone:'text-red-300'},
        {key:'aujourdhui',value:totals.today,label:'À échéance aujourd’hui',tone:'text-amber-200'}, {key:'sans',value:totals.undated,label:'Sans échéance',tone:'text-slate-200'}].map(item=><button key={item.key} type="button" aria-pressed={filter===item.key} onClick={()=>setFilter(item.key)}
        className={`min-w-0 rounded-xl border p-4 text-left transition-colors ${filter===item.key?'border-titan-cyan/60 bg-titan-cyan/5':'border-white/10 bg-white/5 hover:border-white/30'}`}>
        <span className={`block text-2xl font-semibold tabular-nums ${item.tone}`}>{item.value}</span><span className="mt-1 block text-xs text-slate-300">{item.label}</span>
      </button>)}
    </div>
    <div className="flex flex-wrap items-end justify-between gap-3">
      <label className="grid w-full gap-1 text-sm text-slate-300 sm:max-w-md">Rechercher un client
        <input type="search" aria-label="Rechercher un client" placeholder="Nom du client…" value={search} onChange={e=>setSearch(e.target.value)} className="min-w-0 rounded-xl border border-white/20 bg-bz-dark2 px-3 py-2.5 text-white" />
      </label>
      <p role="status" className="text-xs text-slate-400">{visible.length} client{visible.length===1?'':'s'} affiché{visible.length===1?'':'s'} sur {rows.length} · totaux avant recherche</p>
    </div>
    {visible.length===0 && <Card><p className="text-sm text-slate-300">{rows.length===0?'Aucun client pour ce filtre.':'Aucun client ne correspond à cette recherche ou à ce filtre.'}</p>
      {rows.length>0 && <button type="button" onClick={()=>{setSearch('');setFilter('tous');}} className="mt-3 text-sm text-titan-cyan">Réinitialiser la recherche et les priorités</button>}
    </Card>}
    <div className="space-y-3">{visible.map(row=>{
      const previewActions=row.actions.filter(a=>filter==='retard'?a.due && a.due<today:filter==='aujourdhui'?a.due===today:filter==='sans'?!a.due:true);
      return <article key={row.client.id} data-client-id={row.client.id} className="min-w-0 rounded-xl border border-white/10 bg-bz-dark2/70 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><h3 className="break-words text-base font-semibold text-white">{row.client.nom}</h3>
          <p className="mt-1 text-xs text-slate-400">{row.actions.length} action{row.actions.length===1?'':'s'} ouverte{row.actions.length===1?'':'s'} · {row.board?'Tableau courant':'Aucun tableau courant'}</p></div>
        <button type="button" onClick={()=>onSelect(row.client.id)} className="max-w-full rounded-lg border border-titan-cyan/30 bg-titan-cyan/5 px-3 py-2 text-sm text-titan-cyan hover:bg-titan-cyan/10">Ouvrir {row.client.nom}</button>
      </div>
      {previewActions.length>0 ? <ul className="mt-3 divide-y divide-white/5">{previewActions.slice(0,2).map(action=><li key={action.id} className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm">
        <div className="min-w-0 flex-1"><p className="break-words text-slate-200">{action.text}</p><p className="mt-1 text-xs text-slate-400">{action.source==='ancien'?'Ancien suivi · compléments':'Tableau courant'}{action.blocked?' · Bloqué':''}</p></div>
        <span className={`shrink-0 text-xs ${action.due && action.due<today?'text-red-300':'text-slate-300'}`}>{action.due ? `${action.due}${action.due<today?' · En retard':action.due===today?' · Aujourd’hui':''}`:'Sans échéance'}</span>
      </li>)}</ul> : <p className="mt-3 text-sm text-slate-400">Aucune action ouverte renseignée.</p>}
      {previewActions.length>2 && <p className="mt-2 text-xs text-slate-400">{previewActions.length-2} autre{previewActions.length-2===1?'':'s'} action{previewActions.length-2===1?'':'s'} correspondant au filtre dans la fiche client</p>}
    </article>;})}</div>
    <p className="text-xs text-slate-400">Les tableaux archivés et suivis terminés sont exclus des priorités. Une date de visite n’est jamais utilisée comme échéance. Les suivis sans client restent séparés ci-dessous.</p>
  </section>;
}
