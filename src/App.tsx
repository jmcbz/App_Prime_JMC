import { Routes, Route, Navigate } from 'react-router-dom';
import { Loader2, Menu } from 'lucide-react';
import { useRef, useState } from 'react';
import Sidebar from './layout/Sidebar';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Primes from './pages/Primes';
import Clients from './pages/Clients';
import Procedures from './pages/Procedures';
import WorkstationProcedures from './pages/WorkstationProcedures';
import ClientOnboarding from './pages/ClientOnboarding';
import Suivis from './pages/Suivis';
import Administration from './pages/Administration';
import { useAuth } from './context/AuthContext';
import type { ReactNode } from 'react';

function ProtectedShell({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  return (
    <div className="min-h-screen titan-grid">
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-white/10 bg-bz-dark px-4 py-3 text-white md:hidden">
        <button ref={menuButton} type="button" aria-label="Ouvrir le menu" aria-controls="primary-navigation"
          aria-expanded={menuOpen} onClick={() => setMenuOpen(open => !open)}
          className="rounded-lg border border-white/20 p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-titan-cyan">
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
        <span className="text-sm font-extrabold tracking-wide">PRIsME Prime</span>
      </header>
      {menuOpen && <button type="button" data-testid="navigation-backdrop" aria-label="Fermer le menu"
        className="fixed inset-0 z-40 bg-black/60 md:hidden" onClick={() => setMenuOpen(false)} />}
      <Sidebar mobileOpen={menuOpen} onClose={() => setMenuOpen(false)}
        onEscape={() => { setMenuOpen(false); menuButton.current?.focus(); }} />
      <main className="min-h-screen min-w-0 md:ml-64">{children}</main>
    </div>
  );
}

export default function App() {
  const { user, loading, verified, refresh } = useAuth();

  if (loading && !user) {
    return (
      <div className="flex min-h-screen items-center justify-center titan-grid">
        <Loader2 className="h-6 w-6 animate-spin text-titan-cyan" />
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  const concealed = loading || !verified;
  return (
    <>
    {concealed && <div role="status" className="flex min-h-screen items-center justify-center titan-grid text-white">
      {loading ? 'Vérification de la session…' : <button type="button" onClick={() => { void refresh().catch(() => {}); }}>Session non vérifiée — réessayer</button>}
    </div>}
    <div key={user.id} hidden={concealed} ref={node => { if (node) node.toggleAttribute('inert', concealed); }} aria-hidden={concealed} style={concealed ? { display: 'none' } : undefined}>
    <ProtectedShell>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/primes" element={<Primes />} />
        <Route path="/clients" element={<Clients />} />
        <Route path="/procedures" element={<Procedures />} />
        <Route path="/procedures/installation-postes" element={<WorkstationProcedures />} />
        <Route path="/procedures/prise-en-charge" element={<ClientOnboarding />} />
        <Route path="/suivis" element={<Suivis />} />
        <Route
          path="/administration"
          element={user.role === 'admin' ? <Administration /> : <Navigate to="/" replace />}
        />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ProtectedShell>
    </div>
    </>
  );
}
