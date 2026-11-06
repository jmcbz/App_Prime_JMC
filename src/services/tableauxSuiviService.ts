import type { StatutSuivi } from './dataService';

export const RUBRIQUES = [
  { key: 'plan_directeur', label: 'À quand le plan directeur' },
  { key: 'projets', label: 'Projets à venir' },
  { key: 'rencontre', label: 'Dernière visite/rencontre' },
  { key: 'comite_ti', label: 'Est-ce qu’il y a un comité TI' },
  { key: 'backups', label: 'Validation des backups' },
  { key: 'routeur', label: 'Routeur (mise à jour ou remplacement)', version: true },
  { key: 'serveur_sur_place', label: 'Serveur sur place (mise à jour et version)', version: true },
  { key: 'vm_bz', label: 'VM chez BZ (version et mises à jour)', version: true },
  { key: 'ia_agentique', label: 'IA ou implantation possible d’agent agentique' },
] as const;

export type RubriqueKey = typeof RUBRIQUES[number]['key'];
export interface RubriqueSuivi {
  key: RubriqueKey;
  statut: StatutSuivi;
  date: string | null;
  note: string | null;
  prochaineAction: string | null;
  version: string | null;
}
export interface TableauSuivi {
  id: number;
  clientId: number;
  createdAt: string;
  archivedAt: string | null;
  rubriques: RubriqueSuivi[];
}
export type RubriqueInput = Omit<RubriqueSuivi, 'key'>;

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method, credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data: Record<string, unknown>;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : `Erreur ${response.status}`);
  return data as T;
}

export async function fetchTableauxSuivi(): Promise<TableauSuivi[]> {
  return (await request<{ tableaux: TableauSuivi[] }>('/api/tableaux-suivi')).tableaux;
}
export async function createTableauSuivi(clientId: number, expectedActiveId: number | null): Promise<TableauSuivi> {
  return (await request<{ tableau: TableauSuivi }>('/api/tableaux-suivi', 'POST', { clientId, expectedActiveId })).tableau;
}
export async function updateRubriqueSuivi(id: number, key: RubriqueKey, input: RubriqueInput): Promise<TableauSuivi> {
  return (await request<{ tableau: TableauSuivi }>(`/api/tableaux-suivi/${id}/rubriques/${key}`, 'PUT', input)).tableau;
}
