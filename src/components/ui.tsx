import type { Disponibilite, StatutSuivi } from '../data/mock';

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
