// Service d'administration des données métier — PRIsME Prime (admin seulement côté serveur).
import type { Prime, ClientPrime, Suivi } from './dataService';

async function parseJson(r: Response) {
  const t = await r.text();
  if (!t) return {};
  try { return JSON.parse(t); } catch { return { error: t }; }
}

async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const d = await parseJson(r);
  if (!r.ok) throw new Error(d.error || `Erreur ${r.status}`);
  return d as T;
}

// ---- Primes ----
export type PrimeInput = Omit<Prime, 'id' | 'clientsIds'>;
export async function createPrime(input: PrimeInput): Promise<Prime> {
  return (await send<{ prime: Prime }>('POST', '/api/primes', input)).prime;
}
export async function updatePrime(id: number, input: PrimeInput): Promise<Prime> {
  return (await send<{ prime: Prime }>('PUT', `/api/primes/${id}`, input)).prime;
}
export async function deletePrime(id: number): Promise<void> {
  await send('DELETE', `/api/primes/${id}`);
}

// ---- Clients ----
export type ClientInput = Omit<ClientPrime, 'id'>;
export async function createClient(input: ClientInput): Promise<ClientPrime> {
  return (await send<{ client: ClientPrime }>('POST', '/api/clients', input)).client;
}
export async function updateClient(id: number, input: ClientInput): Promise<ClientPrime> {
  return (await send<{ client: ClientPrime }>('PUT', `/api/clients/${id}`, input)).client;
}
export async function deleteClient(id: number): Promise<void> {
  await send('DELETE', `/api/clients/${id}`);
}

// ---- Suivis ----
export type SuiviInput = Omit<Suivi, 'id'>;
export async function createSuivi(input: SuiviInput): Promise<Suivi> {
  return (await send<{ suivi: Suivi }>('POST', '/api/suivis', input)).suivi;
}
export async function updateSuivi(id: number, input: SuiviInput): Promise<Suivi> {
  return (await send<{ suivi: Suivi }>('PUT', `/api/suivis/${id}`, input)).suivi;
}
export async function deleteSuivi(id: number): Promise<void> {
  await send('DELETE', `/api/suivis/${id}`);
}
