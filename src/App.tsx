import { Routes, Route } from 'react-router-dom';
import Sidebar from './layout/Sidebar';
import Dashboard from './pages/Dashboard';
import Primes from './pages/Primes';
import Clients from './pages/Clients';
import Procedures from './pages/Procedures';
import Suivis from './pages/Suivis';

export default function App() {
  return (
    <div className="min-h-screen titan-grid">
      <Sidebar />
      <main className="ml-64 min-h-screen">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/primes" element={<Primes />} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/procedures" element={<Procedures />} />
          <Route path="/suivis" element={<Suivis />} />
        </Routes>
      </main>
    </div>
  );
}
