import { createPortal } from 'react-dom';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useState } from 'react';
import type { Disponibilite, StatutSuivi } from '../services/dataService';

const DISPO_MAP: Record<Disponibilite, { label: string; dot: string; text: string }> = {
  disponible: { label: 'Disponible', dot: 'bg-bz-emerald', text: 'text-bz-emerald' },
  charge: { label: 'Chargé', dot: 'bg-bz-amber', text: 'text-bz-amber' },
  surcharge: { label: 'Surchargé', dot: 'bg-red-500', text: 'text-red-400' },
};

export function DispoPastille({ dispo }: { dispo: Disponibilite }) {
  const m = DISPO_MAP[dispo];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${m.text}`}>
      <span className={`h-2 w-2 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  );
}

const SUIVI_MAP: Record<StatutSuivi, { label: string; cls: string }> = {
  a_faire: { label: 'À faire', cls: 'bg-slate-500/15 text-slate-300 border-slate-500/30' },
  en_cours: { label: 'En cours', cls: 'bg-bz-blue/15 text-bz-blue2 border-bz-blue/30' },
  termine: { label: 'Terminé', cls: 'bg-bz-emerald/15 text-bz-emerald border-bz-emerald/30' },
  bloque: { label: 'Bloqué', cls: 'bg-red-500/15 text-red-400 border-red-500/30' },
};

export function SuiviBadge({ statut }: { statut: StatutSuivi }) {
  const m = SUIVI_MAP[statut];
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${m.cls}`}>
      {m.label}
    </span>
  );
}

export function TitanAvatar({ initiales }: { initiales: string }) {
  return (
    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-bz-blue to-titan-violet text-sm font-bold text-white shadow-titan">
      {initiales}
    </span>
  );
}

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-white/10 bg-bz-dark2/80 p-5 shadow-lg backdrop-blur ${className}`}>
      {children}
    </div>
  );
}

/** Dialogue de confirmation de suppression (thème sombre). */
export function ConfirmDialog({ titre, message, onConfirm, onClose }: {
  titre: string; message: string; onConfirm: () => Promise<void> | void; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState('');
  async function confirmer() {
    setErreur(''); setBusy(true);
    try { await onConfirm(); } catch (e) { setErreur(e instanceof Error ? e.message : 'Erreur'); setBusy(false); return; }
    setBusy(false);
  }
  if (typeof document === 'undefined' || !document.body) return null;
  return createPortal(
    <>
      <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-md rounded-2xl border border-white/10 bg-bz-dark2 p-5 shadow-titan">
          <div className="mb-3 flex items-center gap-2 text-red-400">
            <AlertTriangle className="h-5 w-5" />
            <h2 className="text-base font-bold text-white">{titre}</h2>
          </div>
          <p className="text-sm text-slate-300">{message}</p>
          {erreur && <p className="mt-2 text-sm text-red-400">{erreur}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={onClose}
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-300 hover:text-white">
              Annuler
            </button>
            <button type="button" onClick={confirmer} disabled={busy}
              className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-60">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Supprimer
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
