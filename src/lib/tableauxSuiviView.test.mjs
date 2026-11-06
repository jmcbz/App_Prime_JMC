import test from 'node:test';
import assert from 'node:assert/strict';
import { clientsPourPrime, tableauxDuClient, anciensSuivisDuClient } from './tableauxSuiviView.ts';

const clients = [{ id: 1, nom: 'Alpha', primeId: 7 }, { id: 2, nom: 'Beta', primeId: 8 }, { id: 3, nom: 'Libre', primeId: null }];
const tableaux = [
  { id: 1, clientId: 1, archivedAt: '2026-01-01' },
  { id: 2, clientId: 1, archivedAt: null },
  { id: 3, clientId: 2, archivedAt: null },
];
const suivis = [
  { id: 1, clientId: 1, primeId: 8 },
  { id: 2, clientId: 2, primeId: 8 },
  { id: 3, clientId: null, primeId: 7 },
  { id: 4, clientId: null, primeId: null },
];

test('les clients sans anciennes tâches restent dans le sélecteur et le filtre admin suit le propriétaire actuel', () => {
  assert.deepEqual(clientsPourPrime(clients, 'tous', true).map(c => c.id), [1, 2, 3]);
  assert.deepEqual(clientsPourPrime(clients, '7', true).map(c => c.id), [1]);
  assert.deepEqual(clientsPourPrime(clients, 'sans', true).map(c => c.id), [3]);
});

test('le client sélectionné présente son tableau courant et ses archives distinctes', () => {
  assert.deepEqual(tableauxDuClient(tableaux, 1).map(t => t.id), [2, 1]);
  assert.deepEqual(tableauxDuClient(tableaux, 2).map(t => t.id), [3]);
});

test('les anciens suivis suivent le propriétaire actuel du client, les sans client leur propre Prime', () => {
  assert.deepEqual(anciensSuivisDuClient(suivis, clients, 1, '7', true).map(s => s.id), [1]);
  assert.deepEqual(anciensSuivisDuClient(suivis, clients, null, '7', true).map(s => s.id), [3]);
  assert.deepEqual(anciensSuivisDuClient(suivis, clients, null, 'sans', true).map(s => s.id), [4]);
  assert.deepEqual(anciensSuivisDuClient(suivis, clients, 1, '8', true), []);
});
