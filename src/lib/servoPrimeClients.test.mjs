import test from 'node:test';
import assert from 'node:assert/strict';
import { filterServoClients } from './servoPrimeClients.ts';

const servo = [
  { id: 10, nom: 'École du Nord', alias: 'EDN' },
  { id: 20, nom: 'Ville Exemple', alias: '' },
  { id: 30, nom: 'Coopérative Test', alias: '' },
];
test('recherche clients Servo insensible aux accents et inclut les alias', () => {
  assert.deepEqual(filterServoClients(servo, 'ecole').map(c=>c.id), [10]);
  assert.deepEqual(filterServoClients(servo, ' edn ').map(c=>c.id), [10]);
  assert.deepEqual(filterServoClients(servo, 'ville').map(c=>c.id), [20]);
  assert.deepEqual(filterServoClients(servo, 'aucun'), []);
  assert.equal(filterServoClients(servo, '').length, 3);
});
