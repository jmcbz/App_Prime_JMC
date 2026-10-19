import type { ReactNode } from 'react';

export function PageHeader({ titre, sousTitre, action }: { titre: string; sousTitre: string; action?: ReactNode }) {
  return (
    <header className="mb-6 flex items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-white">{titre}</h1>
        <p className="mt-1 text-sm text-slate-400">{sousTitre}</p>
      </div>
      {action}
    </header>
  );
}

export function Page({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-6xl px-8 py-8">{children}</div>;
}
