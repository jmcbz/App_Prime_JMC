import { Page, PageHeader } from '../layout/Page';
import { Card } from '../components/ui';
import { CLIENTS, PRIMES, type ClientPrime } from '../data/mock';

const STATUT_MAP: Record<ClientPrime['statut'], { label: string; cls: string }> = {
  actif: { label: 'Actif', cls: 'bg-bz-emerald/15 text-bz-emerald border-bz-emerald/30' },
  onboarding: { label: 'Onboarding', cls: 'bg-bz-blue/15 text-bz-blue2 border-bz-blue/30' },
  risque: { label: 'À risque', cls: 'bg-red-500/15 text-red-400 border-red-500/30' },
};

export default function Clients() {
  return (
    <Page>
      <PageHeader
        titre="Clients"
        sousTitre="Portefeuille clients et le Prime responsable associé à chacun."
      />
      <Card className="overflow-hidden p-0">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-white/10 text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-5 py-3 font-semibold">Client</th>
              <th className="px-5 py-3 font-semibold">Secteur</th>
              <th className="px-5 py-3 font-semibold">Prime responsable</th>
              <th className="px-5 py-3 font-semibold">Statut</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {CLIENTS.map((c) => {
              const prime = PRIMES.find((p) => p.id === c.primeId);
              const st = STATUT_MAP[c.statut];
              return (
                <tr key={c.id} className="hover:bg-white/5">
                  <td className="px-5 py-3 font-medium text-white">{c.nom}</td>
                  <td className="px-5 py-3 text-slate-300">{c.secteur}</td>
                  <td className="px-5 py-3 text-slate-200">
                    {prime?.nom} <span className="text-titan-cyan">· {prime?.codeTitan}</span>
                  </td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${st.cls}`}>
                      {st.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </Page>
  );
}
