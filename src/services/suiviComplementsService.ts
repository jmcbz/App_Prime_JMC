import type { StatutSuivi, Suivi } from './dataService';

export interface SuiviComplement {
  id: number;
  statut: StatutSuivi;
  echeance: string | null;
  note: string | null;
  createdAt: string;
}
export interface ComplementsPage {
  complements: SuiviComplement[];
  hasMore: boolean;
  nextBefore: number | null;
}
export interface ComplementInput {
  statut: StatutSuivi;
  echeance: string | null;
  note: string;
  expectedLastId: number | null;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { credentials: 'include', ...init });
  const text = await response.text();
  let data: Record<string, unknown>;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : `Erreur ${response.status}`);
  return data as T;
}

export function fetchSuiviComplements(id: number, before?: number): Promise<ComplementsPage> {
  return request(`/api/suivis/${id}/complements${before === undefined ? '' : `?before=${before}`}`);
}

export function appendSuiviComplement(id: number, input: ComplementInput): Promise<{ suivi: Suivi; complement: SuiviComplement }> {
  return request(`/api/suivis/${id}/complements`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
}
