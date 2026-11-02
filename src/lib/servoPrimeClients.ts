export interface ServoClient { id: number; nom: string; alias: string }
const normalized = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr-CA').trim();

export function filterServoClients(clients: ServoClient[], query: string): ServoClient[] {
  const needle = normalized(query);
  return needle ? clients.filter((client) => normalized(`${client.nom} ${client.alias}`).includes(needle)) : clients;
}
