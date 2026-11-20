import type { ClientPrime, Suivi } from '../services/dataService';
import type { TableauSuivi, RubriqueKey } from '../services/tableauxSuiviService';

export function localDay() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
export function validDue(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0,10) === value;
}
export interface FollowupAction { id: string; source: 'tableau' | 'ancien'; key?: RubriqueKey; text: string; due: string | null; blocked: boolean }
export function boardActions(board: TableauSuivi | undefined): FollowupAction[] {
  if (!board || board.archivedAt !== null) return [];
  return board.rubriques.filter(r => r.statut !== 'termine' && r.prochaineAction?.trim()).map(r => ({
    id: `tableau:${board.id}:${r.key}`, source: 'tableau', key: r.key, text: r.prochaineAction!.trim(),
    due: validDue(r.prochaineActionEcheance) ? r.prochaineActionEcheance : null, blocked: r.statut === 'bloque',
  }));
}
export function sortActions(actions: FollowupAction[]) {
  return [...actions].sort((a,b) => (a.due ?? '9999-99-99').localeCompare(b.due ?? '9999-99-99') || a.id.localeCompare(b.id));
}
export function legacyActions(suivis: Suivi[]): FollowupAction[] {
  return suivis.filter(s=>s.statut!=='termine').map(s=>({id:`ancien:${s.id}`,source:'ancien',text:s.titre,
    due:validDue(s.echeance)?s.echeance:null,blocked:s.statut==='bloque'}));
}
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('fr').trim();
export function searchClients<T extends {client: {nom: string}}>(rows: T[], search: string): T[] {
  return rows.filter(r=>normalize(r.client.nom).includes(normalize(search)));
}
export function portfolioClients(clients: ClientPrime[], boards: TableauSuivi[], suivis: Suivi[], today = localDay()) {
  return clients.map(client => {
    const board = boards.find(b=>b.clientId===client.id && b.archivedAt===null);
    const actions = sortActions([...boardActions(board), ...legacyActions(suivis.filter(s=>s.clientId===client.id))]);
    return { client, board, actions, overdue: actions.filter(a=>a.due && a.due<today).length,
      undated: actions.filter(a=>!a.due).length, dueToday: actions.filter(a=>a.due===today).length };
  }).sort((a,b)=>(a.actions[0]?.due ?? '9999-99-99').localeCompare(b.actions[0]?.due ?? '9999-99-99') || a.client.nom.localeCompare(b.client.nom,'fr'));
}
