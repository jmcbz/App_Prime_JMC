import { useEffect, useState } from 'react';
import {
  fetchPrimesEtClients,
  fetchSuivis,
  type Prime,
  type ClientPrime,
  type Suivi,
} from '../services/dataService';

interface MetierState {
  primes: Prime[];
  clients: ClientPrime[];
  suivis: Suivi[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/** Charge les données métier (primes, clients, suivis) depuis l'API. */
export function useMetier(): MetierState {
  const [primes, setPrimes] = useState<Prime[]>([]);
  const [clients, setClients] = useState<ClientPrime[]>([]);
  const [suivis, setSuivis] = useState<Suivi[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let annule = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [{ primes: p, clients: c }, s] = await Promise.all([
          fetchPrimesEtClients(),
          fetchSuivis(),
        ]);
        if (annule) return;
        setPrimes(p);
        setClients(c);
        setSuivis(s);
      } catch (e) {
        if (!annule) setError(e instanceof Error ? e.message : 'Erreur de chargement');
      } finally {
        if (!annule) setLoading(false);
      }
    })();
    return () => { annule = true; };
  }, [tick]);

  return { primes, clients, suivis, loading, error, reload: () => setTick((t) => t + 1) };
}
