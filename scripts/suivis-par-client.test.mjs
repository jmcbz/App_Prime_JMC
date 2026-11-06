import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

async function loadView() {
  const source = fs.readFileSync(new URL('../src/lib/suivisView.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
}

const primes = [
  { id: 1, nom: 'Nightwing', codeTitan: 'Nightwing' },
  { id: 2, nom: 'Batgirl', codeTitan: 'Batgirl' },
];
const clients = [
  { id: 10, nom: 'Zulu', primeId: 2 },
  { id: 11, nom: 'Alpha', primeId: 1 },
  { id: 12, nom: 'Beta', primeId: null },
];
const suivis = [
  { id: 1, titre: 'Ancien Prime', clientId: 10, primeId: 1, statut: 'en_cours', echeance: null },
  { id: 2, titre: 'Client Alpha', clientId: 11, primeId: 1, statut: 'bloque', echeance: null },
  { id: 3, titre: 'Sans client Batgirl', clientId: null, primeId: 2, statut: 'a_faire', echeance: null },
  { id: 4, titre: 'Client libre', clientId: 12, primeId: 1, statut: 'a_faire', echeance: null },
  { id: 5, titre: 'Sans Prime', clientId: null, primeId: null, statut: 'termine', echeance: null },
];

test('l’admin filtre par le Prime actuel du client, puis par Prime du suivi sans client', async () => {
  const { filtrerSuivisParPrime } = await loadView();
  assert.deepEqual(filtrerSuivisParPrime(suivis, clients, '2', true).map((s) => s.id), [1, 3]);
  assert.deepEqual(filtrerSuivisParPrime(suivis, clients, '1', true).map((s) => s.id), [2]);
  assert.deepEqual(filtrerSuivisParPrime(suivis, clients, 'sans', true).map((s) => s.id), [4, 5]);
  assert.deepEqual(filtrerSuivisParPrime(suivis, clients, 'tous', true).map((s) => s.id), [1, 2, 3, 4, 5]);
});

test('un usager standard ne peut pas activer un filtre Prime côté présentation', async () => {
  const { filtrerSuivisParPrime } = await loadView();
  assert.deepEqual(filtrerSuivisParPrime(suivis, clients, '2', false).map((s) => s.id), [1, 2, 3, 4, 5]);
});

test('les suivis sont regroupés par client, les sans-client à la fin, et triés par statut', async () => {
  const { regrouperSuivisParClient } = await loadView();
  const groups = regrouperSuivisParClient([
    ...suivis,
    { id: 6, titre: 'À faire Alpha', clientId: 11, primeId: 1, statut: 'a_faire', echeance: null },
  ], clients);
  assert.deepEqual(groups.map((g) => g.nom), ['Alpha', 'Beta', 'Zulu', 'Sans client']);
  assert.deepEqual(groups.map((g) => g.suivis.map((s) => s.id)), [[6, 2], [4], [1], [3, 5]]);
});

test('le tableau de bord nomme explicitement ses compteurs et sa liste historiques', () => {
  const source = fs.readFileSync(new URL('../src/pages/Dashboard.tsx', import.meta.url), 'utf8');
  assert.match(source, /Suivis en cours \(anciens\)/);
  assert.match(source, /Points bloqués \(anciens\)/);
  assert.match(source, /Anciens suivis prioritaires/);
});

test('la page ouvre un tableau par client, filtre le Prime côté admin et sépare les anciens suivis', () => {
  const source = fs.readFileSync(new URL('../src/pages/Suivis.tsx', import.meta.url), 'utf8');
  assert.match(source, /const \[selectedId, setSelectedId\] = useState<number \| null>\(null\)/);
  assert.match(source, /\{isAdmin\s*&&\s*<label[\s\S]*?Filtrer par Prime/);
  assert.match(source, /clientsPourPrime\(clients, filtrePrime, isAdmin\)/);
  assert.match(source, /<SuivisBoard key=\{active\.id\}/);
  assert.match(source, /aria-label="Anciens suivis"/);
});
