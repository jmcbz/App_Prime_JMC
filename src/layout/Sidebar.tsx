import { NavLink } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { LayoutDashboard, Users, Building2, BookOpen, ListChecks, ShieldCheck, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import LogoTitan from '../components/LogoTitan';

const NAV = [
  { to: '/', label: 'Tour de contrôle', icon: LayoutDashboard, end: true },
  { to: '/primes', label: 'Les Primes', icon: Users },
  { to: '/clients', label: 'Clients', icon: Building2 },
  { to: '/procedures', label: 'Trousse d’outils', icon: BookOpen },
  { to: '/suivis', label: 'Suivis', icon: ListChecks },
];

export default function Sidebar({ mobileOpen = false, onClose, onEscape }: {
  mobileOpen?: boolean;
  onClose?: () => void;
  onEscape?: () => void;
}) {
  const { user, logout } = useAuth();
  const [logoutError, setLogoutError] = useState('');
  useEffect(() => {
    if (mobileOpen) document.querySelector<HTMLAnchorElement>('#primary-navigation nav a')?.focus();
  }, [mobileOpen]);
  useEffect(() => {
    if (!mobileOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onEscape?.();
        if (!onEscape) onClose?.();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [mobileOpen, onClose, onEscape]);
  const guardedLogout = async () => {
    if (!window.dispatchEvent(new window.Event('client-onboarding:before-logout', { cancelable: true }))) return;
    try { setLogoutError(''); await logout(); }
    catch (error) { setLogoutError(`Déconnexion bloquée : ${error instanceof Error ? error.message : 'nettoyage du brouillon impossible'}`); }
  };

  return (
    <aside id="primary-navigation" aria-label="Navigation principale"
      className={`fixed left-0 top-0 z-50 h-screen w-64 flex-col overflow-y-auto border-r border-white/10 bg-bz-dark md:z-40 md:flex ${mobileOpen ? 'flex' : 'hidden'}`}>
      <div className="flex items-center gap-3 border-b border-white/10 px-6 py-5">
        <LogoTitan size={40} />
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
            onClick={onClose}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive ? 'bg-bz-blue/15 text-white shadow-titan' : 'text-slate-400 hover:bg-white/5 hover:text-white'
              }`
            }
          >
            <Icon className="h-[18px] w-[18px]" />
            {to === '/primes' && user?.role !== 'admin' ? 'Mon Prime' : label}
          </NavLink>
        ))}

        {user?.role === 'admin' && (
          <>
            <div className="px-3 pb-1 pt-4 text-[10px] font-bold uppercase tracking-wider text-slate-600">Administration</div>
            <NavLink
              to="/administration"
              onClick={onClose}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive ? 'bg-bz-blue/15 text-white shadow-titan' : 'text-slate-400 hover:bg-white/5 hover:text-white'
                }`
              }
            >
              <ShieldCheck className="h-[18px] w-[18px]" />
              Administration
            </NavLink>
          </>
        )}
      </nav>

      <div className="border-t border-white/10 px-4 py-4">
        {logoutError && <p role="alert" className="mb-2 text-xs text-red-300">{logoutError}</p>}
        {user && (
          <div className="mb-3">
            <div className="truncate text-sm font-medium text-white">{user.prenom} {user.nom}</div>
            <div className="truncate text-[11px] text-slate-500">{user.email}</div>
            <span className="mt-1 inline-flex items-center rounded-full border border-titan-cyan/30 bg-titan-cyan/10 px-2 py-0.5 text-[10px] font-medium text-titan-cyan">
              {user.role === 'admin' ? 'Administrateur' : 'Prime'}
            </span>
          </div>
        )}
        <button
          onClick={guardedLogout}
          className="flex w-full items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-300 transition-colors hover:text-white"
        >
          <LogOut className="h-4 w-4" /> Se déconnecter
        </button>
      </div>
    </aside>
  );
}
