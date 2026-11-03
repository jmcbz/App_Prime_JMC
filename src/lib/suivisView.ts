import type { ClientPrime, Suivi } from '../services/dataService';

export type GroupeSuivis = { clientId: number | null; nom: string; suivis: Suivi[] };

export function filtrerSuivisParPrime(suivis: Suivi[], clients: ClientPrime[], filtrePrime: string, isAdmin: boolean): Suivi[] {
  if (!isAdmin || filtrePrime === 'tous') return suivis;
  const clientsParId = new Map(clients.map((client) => [client.id, client]));
  return suivis.filter((suivi) => {
    const client = suivi.clientId == null ? undefined : clientsParId.get(suivi.clientId);
    const primeActuel = client ? client.primeId : suivi.primeId;
    if (filtrePrime === 'sans') return primeActuel == null;
    return /^\d+$/.test(filtrePrime) && primeActuel === Number(filtrePrime);
  });
}

export function regrouperSuivisParClient(suivis: Suivi[], clients: ClientPrime[]): GroupeSuivis[] {
  const clientsParId = new Map(clients.map((client) => [client.id, client]));
  const groupes = new Map<number | null, GroupeSuivis>();
  for (const suivi of suivis) {
    const client = suivi.clientId == null ? undefined : clientsParId.get(suivi.clientId);
    const id = client?.id ?? null;
    if (!groupes.has(id)) groupes.set(id, { clientId: id, nom: client?.nom ?? 'Sans client', suivis: [] });
    groupes.get(id)!.suivis.push(suivi);
  }
  const ordre: Record<Suivi['statut'], number> = { a_faire: 0, en_cours: 1, bloque: 2, termine: 3 };
  return [...groupes.values()]
    .map((groupe) => ({
      ...groupe,
      suivis: groupe.suivis.sort((a, b) => ordre[a.statut] - ordre[b.statut]
        || (a.echeance ?? '\uffff').localeCompare(b.echeance ?? '\uffff') || a.id - b.id),
    }))
    .sort((a, b) => (a.clientId === null ? 1 : 0) - (b.clientId === null ? 1 : 0)
      || a.nom.localeCompare(b.nom, 'fr-CA'));
}
