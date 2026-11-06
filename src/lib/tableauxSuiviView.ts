import type { ClientPrime, Suivi } from '../services/dataService';
import type { TableauSuivi } from '../services/tableauxSuiviService';

export function clientsPourPrime<T extends Pick<ClientPrime, 'primeId'>>(clients: T[], filtre: string, isAdmin: boolean): T[] {
  if (!isAdmin || filtre === 'tous') return clients;
  if (filtre === 'sans') return clients.filter(c => c.primeId == null);
  return /^\d+$/.test(filtre) ? clients.filter(c => c.primeId === Number(filtre)) : [];
}

export function tableauxDuClient<T extends Pick<TableauSuivi, 'clientId' | 'archivedAt'>>(tableaux: T[], clientId: number): T[] {
  return tableaux.filter(t => t.clientId === clientId).sort((a, b) => Number(a.archivedAt !== null) - Number(b.archivedAt !== null));
}

export function anciensSuivisDuClient<T extends Pick<Suivi, 'clientId' | 'primeId'>>(suivis: T[], clients: Pick<ClientPrime, 'id' | 'primeId'>[], clientId: number | null, filtre: string, isAdmin: boolean): T[] {
  const owners = new Map(clients.map(c => [c.id, c.primeId]));
  return suivis.filter(s => {
    if (s.clientId !== clientId) return false;
    if (!isAdmin || filtre === 'tous') return true;
    const owner = s.clientId != null && owners.has(s.clientId) ? owners.get(s.clientId) : s.primeId;
    return filtre === 'sans' ? owner == null : /^\d+$/.test(filtre) && owner === Number(filtre);
  });
}
