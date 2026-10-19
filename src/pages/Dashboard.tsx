import { Link } from 'react-router-dom';
import { Users, Building2, ListChecks, AlertTriangle, ArrowRight } from 'lucide-react';
import { Page, PageHeader } from '../layout/Page';
import { Card, SuiviBadge, DispoPastille } from '../components/ui';
import { PRIMES, CLIENTS, SUIVIS, PROCEDURES } from '../data/mock';

export default function Dashboard() {
  const suivisActifs = SUIVIS.filter((s) => s.statut === 'en_cours' || s.statut === 'a_faire');
  const bloques = SUIVIS.filter((s) => s.statut === 'bloque');
  const clientsRisque = CLIENTS.filter((c) => c.statut === 'risque');

  const stats = [
    { label: 'Primes actifs', valeur: PRIMES.length, icon: Users, accent: 'text-titan-cyan' },
    { label: 'Clients suivis', valeur: CLIENTS.length, icon: Building2, accent: 'text-bz-blue2' },
    { label: 'Suivis en cours', valeur: suivisActifs.length, icon: ListChecks, accent: 'text-bz-amber' },
    { label: 'Points bloqués', valeur: bloques.length, icon: AlertTriangle, accent: 'text-red-400' },
  ];

  return (
    <Page>
      <PageHeader
        titre="Tour de contrôle"
        sousTitre="Vue d’ensemble de l’équipe Prime, des clients et des suivis en cours."
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map(({ label, valeur, icon: Icon, accent }) => (
          <Card key={label}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</span>
              <Icon className={`h-5 w-5 ${accent}`} />
            </div>
            <div className="mt-3 text-3xl font-extrabold text-white">{valeur}</div>
          </Card>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-300">Suivis prioritaires</h2>
            <Link to="/suivis" className="inline-flex items-center gap-1 text-xs font-medium text-bz-blue2 hover:text-titan-cyan">
              Tout voir <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <ul className="space-y-2">
            {suivisActifs.concat(bloques).slice(0, 5).map((s) => {
              const client = CLIENTS.find((c) => c.id === s.clientId);
              return (
                <li key={s.id} className="flex items-center justify-between rounded-xl border border-white/5 bg-white/5 px-4 py-3">
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

        <Card>
          <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-slate-300">Disponibilité des Primes</h2>
          <ul className="space-y-3">
            {PRIMES.map((p) => (
              <li key={p.id} className="flex items-center justify-between">
                <div className="text-sm text-slate-200">
                  {p.nom} <span className="text-titan-cyan">· {p.codeTitan}</span>
                </div>
                <DispoPastille dispo={p.disponibilite} />
              </li>
            ))}
          </ul>

          {clientsRisque.length > 0 && (
            <div className="mt-5 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-red-400">
                <AlertTriangle className="h-4 w-4" /> Clients à risque
              </div>
              <ul className="mt-1.5 space-y-0.5">
                {clientsRisque.map((c) => (
                  <li key={c.id} className="text-xs text-slate-300">{c.nom}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

      <div className="mt-6">
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-300">Trousse d’outils</h2>
              <p className="mt-1 text-xs text-slate-400">{PROCEDURES.length} procédures prêtes à dégainer.</p>
            </div>
            <Link to="/procedures" className="inline-flex items-center gap-1 text-xs font-medium text-bz-blue2 hover:text-titan-cyan">
              Ouvrir la trousse <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </Card>
      </div>
    </Page>
  );
}
