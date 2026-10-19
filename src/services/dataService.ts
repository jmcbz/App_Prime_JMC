// Service de données métier — PRIsME Prime (API backend).
// Les types restent la source de vérité partagée avec l'UI.

export type Disponibilite = 'disponible' | 'charge' | 'surcharge';

export interface Prime {
  id: number;
  nom: string;
  codeTitan: string;
  specialites: string[];
  disponibilite: Disponibilite;
  avatarInitiales: string;
  clientsIds: number[]; // dérivé côté client à partir des clients
}

export interface ClientPrime {
  id: number;
  nom: string;
  secteur: string;
  primeId: number | null;
  statut: 'actif' | 'onboarding' | 'risque';
}

export type StatutSuivi = 'a_faire' | 'en_cours' | 'termine' | 'bloque';

export interface Suivi {
  id: number;
  titre: string;
  clientId: number | null;
  primeId: number | null;
  statut: StatutSuivi;
  echeance: string | null;
  note?: string | null;
}

async function parseJson(r: Response) {
  const t = await r.text();
  if (!t) return {};
  try { return JSON.parse(t); } catch { return { error: t }; }
}

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(path, { credentials: 'include' });
  const d = await parseJson(r);
  if (!r.ok) throw new Error(d.error || `Erreur ${r.status}`);
  return d as T;
}

/** Charge primes + clients ensemble et dérive clientsIds par Prime. */
export async function fetchPrimesEtClients(): Promise<{ primes: Prime[]; clients: ClientPrime[] }> {
  const [pp, cc] = await Promise.all([
    getJson<{ primes: Omit<Prime, 'clientsIds'>[] }>('/api/primes'),
    getJson<{ clients: ClientPrime[] }>('/api/clients'),
  ]);
  const clients = cc.clients;
  const primes: Prime[] = pp.primes.map((p) => ({
    ...p,
    clientsIds: clients.filter((c) => c.primeId === p.id).map((c) => c.id),
  }));
  return { primes, clients };
}

export async function fetchPrimes(): Promise<Prime[]> {
  return (await fetchPrimesEtClients()).primes;
}

export async function fetchClients(): Promise<ClientPrime[]> {
  const d = await getJson<{ clients: ClientPrime[] }>('/api/clients');
  return d.clients;
}

export async function fetchSuivis(): Promise<Suivi[]> {
  const d = await getJson<{ suivis: Suivi[] }>('/api/suivis');
  return d.suivis;
}
