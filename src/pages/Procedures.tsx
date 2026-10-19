import { useState } from 'react';
import { ChevronDown, Clock, Wrench } from 'lucide-react';
import { Page, PageHeader } from '../layout/Page';
import { Card } from '../components/ui';
import { PROCEDURES, type CategorieProcedure } from '../data/mock';

const CATEGORIES: (CategorieProcedure | 'Toutes')[] = ['Toutes', 'Onboarding', 'Incident', 'Maintenance', 'Sécurité', 'Reporting'];

const CAT_CLS: Record<CategorieProcedure, string> = {
  Onboarding: 'bg-bz-blue/15 text-bz-blue2 border-bz-blue/30',
  Incident: 'bg-red-500/15 text-red-400 border-red-500/30',
  Maintenance: 'bg-bz-amber/15 text-bz-amber border-bz-amber/30',
  Sécurité: 'bg-titan-violet/15 text-titan-violet border-titan-violet/30',
  Reporting: 'bg-titan-cyan/15 text-titan-cyan border-titan-cyan/30',
};

export default function Procedures() {
  const [filtre, setFiltre] = useState<(typeof CATEGORIES)[number]>('Toutes');
  const [ouvert, setOuvert] = useState<number | null>(null);

  const liste = filtre === 'Toutes' ? PROCEDURES : PROCEDURES.filter((p) => p.categorie === filtre);

  return (
    <Page>
      <PageHeader
        titre="Trousse d’outils"
        sousTitre="Procédures prêtes à l’emploi — le gadget-belt des Primes."
        action={<Wrench className="h-6 w-6 text-titan-cyan" />}
      />

      <div className="mb-5 flex flex-wrap gap-2">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => setFiltre(c)}
            className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
              filtre === c
                ? 'border-bz-blue/40 bg-bz-blue/20 text-white'
                : 'border-white/10 bg-white/5 text-slate-300 hover:text-white'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {liste.map((p) => {
          const open = ouvert === p.id;
          return (
            <Card key={p.id} className="p-0">
              <button
                onClick={() => setOuvert(open ? null : p.id)}
                className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${CAT_CLS[p.categorie]}`}>
                      {p.categorie}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                      <Clock className="h-3 w-3" /> {p.tempsEstime}
                    </span>
                  </div>
                  <div className="mt-1.5 font-semibold text-white">{p.titre}</div>
                  <div className="text-xs text-slate-400">{p.resume}</div>
                </div>
                <ChevronDown className={`h-5 w-5 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
              </button>

              {open && (
                <div className="border-t border-white/10 px-5 py-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Étapes</div>
                  <ol className="mt-2 space-y-2">
                    {p.etapes.map((e, i) => (
                      <li key={i} className="flex gap-3 text-sm text-slate-200">
                        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-bz-blue/20 text-[11px] font-bold text-bz-blue2">
                          {i + 1}
                        </span>
                        {e}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </Page>
  );
}
