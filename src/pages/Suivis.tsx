import { useState } from 'react';
import { Page, PageHeader } from '../layout/Page';
import { Card, SuiviBadge } from '../components/ui';
import { SUIVIS, CLIENTS, PRIMES, type StatutSuivi } from '../data/mock';

const COLONNES: { statut: StatutSuivi; titre: string }[] = [
  { statut: 'a_faire', titre: 'À faire' },
  { statut: 'en_cours', titre: 'En cours' },
  { statut: 'bloque', titre: 'Bloqué' },
  { statut: 'termine', titre: 'Terminé' },
];

export default function Suivis() {
  const [vue, setVue] = useState<'tableau' | 'liste'>('tableau');

  return (
    <Page>
      <PageHeader
        titre="Suivis"
        sousTitre="Tâches et dossiers en cours par client, façon tableau d’opérations."
        action={
          <div className="flex rounded-xl border border-white/10 bg-white/5 p-0.5 text-xs font-medium">
            {(['tableau', 'liste'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setVue(v)}
                className={`rounded-lg px-3 py-1.5 capitalize transition-colors ${
                  vue === v ? 'bg-bz-blue/25 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        }
      />

      {vue === 'tableau' ? (
        <div className="grid gap-4 md:grid-cols-4">
          {COLONNES.map((col) => {
            const items = SUIVIS.filter((s) => s.statut === col.statut);
            return (
              <div key={col.statut}>
                <div className="mb-2 flex items-center justify-between px-1">
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-300">{col.titre}</span>
                  <span className="text-xs text-slate-500">{items.length}</span>
                </div>
                <div className="space-y-2">
                  {items.map((s) => {
                    const client = CLIENTS.find((c) => c.id === s.clientId);
                    const prime = PRIMES.find((p) => p.id === s.primeId);
                    return (
                      <Card key={s.id} className="p-3.5">
                        <div className="text-sm font-medium text-white">{s.titre}</div>
                        <div className="mt-1 text-xs text-slate-400">{client?.nom}</div>
                        {s.note && <div className="mt-1.5 text-[11px] italic text-slate-500">{s.note}</div>}
                        <div className="mt-2.5 flex items-center justify-between">
                          <span className="text-[11px] text-titan-cyan">{prime?.codeTitan}</span>
                          <span className="text-[11px] text-slate-500">{s.echeance}</span>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-white/5">
            {SUIVIS.map((s) => {
              const client = CLIENTS.find((c) => c.id === s.clientId);
              return (
                <li key={s.id} className="flex items-center justify-between px-5 py-3.5">
                  <div>
                    <div className="text-sm font-medium text-white">{s.titre}</div>
                    <div className="text-xs text-slate-400">{client?.nom} • échéance {s.echeance}</div>
                  </div>
                  <SuiviBadge statut={s.statut} />
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </Page>
  );
}
