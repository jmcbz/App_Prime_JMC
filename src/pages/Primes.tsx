import { Page, PageHeader } from '../layout/Page';
import { Card, TitanAvatar, DispoPastille } from '../components/ui';
import { PRIMES, CLIENTS } from '../data/mock';

export default function Primes() {
  return (
    <Page>
      <PageHeader
        titre="Les Primes"
        sousTitre="L’équipe des responsables de clients — chaque Prime, son code Titan et ses clients."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {PRIMES.map((p) => {
          const clients = CLIENTS.filter((c) => p.clientsIds.includes(c.id));
          return (
            <Card key={p.id}>
              <div className="flex items-start gap-4">
                <TitanAvatar initiales={p.avatarInitiales} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="font-bold text-white">{p.nom}</div>
                      <div className="text-xs font-medium text-titan-cyan">Code Titan · {p.codeTitan}</div>
                    </div>
                    <DispoPastille dispo={p.disponibilite} />
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {p.specialites.map((s) => (
                      <span key={s} className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-[11px] text-slate-300">
                        {s}
                      </span>
                    ))}
                  </div>

                  <div className="mt-4 border-t border-white/10 pt-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Clients ({clients.length})
                    </div>
                    <ul className="mt-1.5 space-y-0.5">
                      {clients.map((c) => (
                        <li key={c.id} className="text-sm text-slate-200">{c.nom}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </Page>
  );
}
