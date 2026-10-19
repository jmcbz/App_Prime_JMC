import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Users, Building2, BookOpen, ListChecks, Shield } from 'lucide-react';

const NAV = [
  { to: '/', label: 'Tour de contrôle', icon: LayoutDashboard, end: true },
  { to: '/primes', label: 'Les Primes', icon: Users },
  { to: '/clients', label: 'Clients', icon: Building2 },
  { to: '/procedures', label: 'Trousse d’outils', icon: BookOpen },
  { to: '/suivis', label: 'Suivis', icon: ListChecks },
];

export default function Sidebar() {
  return (
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-64 flex-col border-r border-white/10 bg-bz-dark">
      <div className="flex items-center gap-3 border-b border-white/10 px-6 py-5">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-titan-cyan to-bz-blue text-lg font-extrabold text-bz-dark shadow-titan">
          T
        </span>
        <div>
          <div className="text-sm font-extrabold tracking-wide text-white">PRIsME Prime</div>
          <div className="text-[11px] font-medium text-titan-cyan">Tour des Titans BZ</div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-bz-blue/15 text-white shadow-titan'
                  : 'text-slate-400 hover:bg-white/5 hover:text-white'
              }`
            }
          >
            <Icon className="h-[18px] w-[18px]" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-white/10 px-5 py-4">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Shield className="h-4 w-4 text-bz-emerald" />
          <span>Accès BZ interne</span>
        </div>
      </div>
    </aside>
  );
}
