import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { unlink } from 'node:fs/promises';

const outfile = new URL('./.board-test-bundle.mjs', import.meta.url).pathname;
let Board;
try {
  await build({ entryPoints: [new URL('./SuivisBoard.tsx', import.meta.url).pathname], outfile,
    bundle: true, format: 'esm', platform: 'node', packages: 'external', jsx: 'automatic' });
  Board = (await import(outfile)).default;
} finally { await unlink(outfile).catch(() => {}); }

const tableau = { id: 5, clientId: 2, createdAt: '2026-01-01', archivedAt: null, rubriques: [] };
const render = (archived = false) => renderToStaticMarkup(React.createElement(Board, {
  tableau: { ...tableau, archivedAt: archived ? '2026-02-01' : null },
  onSave: async () => {},
}));

test('un tableau vide expose neuf rubriques avec les libellés exacts et trois champs version', () => {
  const html = render();
  for (const label of [
    'À quand le plan directeur', 'Projets à venir', 'Dernière visite/rencontre',
    'Est-ce qu’il y a un comité TI', 'Validation des backups',
    'Routeur (mise à jour ou remplacement)', 'Serveur sur place (mise à jour et version)',
    'VM chez BZ (version et mises à jour)', 'IA ou implantation possible d’agent agentique',
  ]) assert.ok(html.includes(label), label);
  assert.equal((html.match(/aria-label="Version —/g) ?? []).length, 3);
  assert.equal((html.match(/aria-label="Statut —/g) ?? []).length, 9);
});

test('une archive expose les valeurs sans aucun champ ni bouton sauvegarder', () => {
  const html = render(true);
  assert.equal((html.match(/<input|<textarea|<select/g) ?? []).length, 0);
  assert.ok(!html.includes('Sauvegarder'));
});
