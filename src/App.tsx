import { Routes, Route, Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import Sidebar from './layout/Sidebar';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Primes from './pages/Primes';
import Clients from './pages/Clients';
import Procedures from './pages/Procedures';
import ClientOnboarding from './pages/ClientOnboarding';
import Suivis from './pages/Suivis';
import Administration from './pages/Administration';
import { useAuth } from './context/AuthContext';
import type { ReactNode } from 'react';

function ProtectedShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen titan-grid">
      <Sidebar />
      <main className="ml-64 min-h-screen">{children}</main>
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
