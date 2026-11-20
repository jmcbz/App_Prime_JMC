import { useEffect, useRef, useState } from 'react';
import type { TableauSuivi } from '../services/tableauxSuiviService';
import SuivisBoard from './SuivisBoard';

export function SuivisArchiveDialog({clientName,busy,onCancel,onConfirm}: {clientName:string;busy:boolean;onCancel:()=>void;onConfirm:()=>void}) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const dialog=ref.current;
    const opener=document.activeElement as HTMLElement | null;
    if(dialog?.showModal)dialog.showModal();else dialog?.setAttribute('open','');
    return ()=>{dialog?.close?.();if(opener?.isConnected)opener.focus();};
  },[]);
  return <dialog ref={ref} role="dialog" aria-modal="true" aria-labelledby="archive-title" onKeyDown={e=>{
    if(e.key!=='Tab')return;
    const controls=Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
    const index=controls.indexOf(document.activeElement as HTMLButtonElement);
    if(!controls.length){e.preventDefault();return;}
    if(e.shiftKey && index<=0){e.preventDefault();controls[controls.length-1].focus();}
    else if(!e.shiftKey && (index===controls.length-1 || index<0)){e.preventDefault();controls[0].focus();}
  }} onCancel={e=>{e.preventDefault();if(!busy)onCancel();}}
    className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-white/20 bg-bz-dark2 p-5 text-white shadow-titan backdrop:bg-black/70">
    <h2 id="archive-title" className="text-lg font-bold">Archiver le tableau courant ?</h2>
    <p className="mt-2 text-sm text-slate-300">Le tableau actuel de « {clientName} » sera archivé en lecture seule et un nouveau tableau vide sera créé.</p>
    <div className="mt-5 flex flex-wrap justify-end gap-2">
      <button type="button" disabled={busy} onClick={onCancel} className="rounded-xl border border-white/20 px-4 py-2 text-sm disabled:opacity-50">Annuler</button>
      <button type="button" disabled={busy} onClick={onConfirm} className="rounded-xl bg-bz-blue px-4 py-2 text-sm font-semibold disabled:opacity-50">{busy?'Création…':'Créer et archiver'}</button>
    </div>
  </dialog>;
}
export function SuivisArchives({archives}:{archives:TableauSuivi[]}) {
  const [selected,setSelected]=useState<number|null>(null);
  const ordered=[...archives].sort((a,b)=>(b.archivedAt??'').localeCompare(a.archivedAt??'') || b.id-a.id);
  return <section aria-label="Tableaux archivés" className="mt-3 space-y-3">
    <p className="text-xs text-slate-400">Historique en lecture seule · le plus récent en premier</p>
    {ordered.map(t=><div key={t.id} className="rounded-xl border border-white/10 p-3">
      <button type="button" aria-expanded={selected===t.id} onClick={()=>setSelected(selected===t.id?null:t.id)} className="w-full py-2 text-left text-sm text-titan-cyan">Consulter le tableau du {t.createdAt?.slice(0,10)} · archivé le {t.archivedAt?.slice(0,10)} · Lecture seule {selected===t.id?'−':'+'}</button>
      {selected===t.id && <SuivisBoard tableau={t} onSave={async()=>{throw new Error('Archive en lecture seule');}} />}
    </div>)}
  </section>;
}
