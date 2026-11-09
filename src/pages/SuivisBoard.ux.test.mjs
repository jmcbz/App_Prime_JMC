import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { unlink } from 'node:fs/promises';

const outfile = new URL('./.suivis-ux-test.mjs', import.meta.url).pathname;
let Board;
try {
  await build({ entryPoints: [new URL('./SuivisBoard.tsx', import.meta.url).pathname], outfile,
    bundle: true, format: 'esm', platform: 'node', packages: 'external', jsx: 'automatic' });
  Board = (await import(outfile)).default;
} finally { await unlink(outfile).catch(() => {}); }

const rubric = (key, overrides = {}) => ({ key, statut: 'a_faire', date: null, note: '', prochaineAction: '', prochaineActionEcheance: null, version: null, ...overrides });
const board = (rubriques = [], archivedAt = null) => ({ id: 5, clientId: 2, createdAt: '2026-01-01', archivedAt, rubriques });
async function mount(tableau, onSave = async () => {}) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost' });
  const prev = { window: globalThis.window, document: globalThis.document, navigator: globalThis.navigator, IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT };
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(dom.window.document.getElementById('root'));
  await act(async () => root.render(React.createElement(Board, { tableau, onSave })));
  const click = async button => { assert.ok(button); await act(async () => button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))); };
  const change = async (input, value) => { assert.ok(input); await act(async () => { input.value = value; Simulate.change(input, { target: { value } }); }); };
  const cleanup = async () => { await act(async () => root.unmount()); dom.window.close(); globalThis.window = prev.window; globalThis.document = prev.document; Object.defineProperty(globalThis, 'navigator', { configurable: true, value: prev.navigator }); globalThis.IS_REACT_ACT_ENVIRONMENT = prev.IS_REACT_ACT_ENVIRONMENT; };
  return { document: dom.window.document, click, change, cleanup };
}

test('une rubrique active enregistre une échéance distincte de sa date historique', async () => {
  let saved;
  const ui = await mount(board(), async (key, input) => { saved = { key, input }; });
  try {
    const due = ui.document.querySelector('input[aria-label="Échéance de la prochaine action — À quand le plan directeur"]');
    assert.equal(due?.type, 'date');
    await ui.change(due, '2026-11-18');
    const form = due.closest('form');
    await act(async () => form.dispatchEvent(new ui.document.defaultView.Event('submit', { bubbles: true, cancelable: true })));
    assert.equal(saved.key, 'plan_directeur');
    assert.equal(saved.input.prochaineActionEcheance, '2026-11-18');
    assert.equal(saved.input.date, null);
  } finally { await ui.cleanup(); }
});

const localDay = offset => {
  const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test('le résumé du client affiche statuts et actions; seuls les vrais retards actifs sont signalés', async () => {
  const ui = await mount(board([
    rubric('plan_directeur', { statut: 'en_cours', prochaineAction: 'Appeler la direction', prochaineActionEcheance: localDay(-1) }),
    rubric('projets', { statut: 'bloque', prochaineAction: 'Relancer le projet', prochaineActionEcheance: localDay(0) }),
    rubric('rencontre', { statut: 'termine', prochaineAction: 'Ancienne action', prochaineActionEcheance: localDay(-3) }),
    rubric('comite_ti', { prochaineAction: '  ', prochaineActionEcheance: localDay(-4) }),
    rubric('backups', { prochaineAction: 'Date erronée', prochaineActionEcheance: '2026-02-30' }),
  ]));
  try {
    const summary = ui.document.querySelector('[aria-label="Résumé du tableau courant"]');
    assert.ok(summary);
    assert.match(summary.textContent, /9 rubriques/);
    assert.match(summary.textContent, /1 en cours/);
    assert.match(summary.textContent, /1 bloquée/);
    assert.match(summary.textContent, /1 terminée/);
    assert.match(summary.textContent, /3 prochaines actions/);
    assert.match(summary.textContent, /1 en retard/);
    assert.match(summary.querySelector('[aria-label="Actions en retard"]')?.textContent ?? '', /Appeler la direction/);
    assert.doesNotMatch(summary.querySelector('[aria-label="Actions en retard"]')?.textContent ?? '', /Ancienne action|Date erronée|Relancer le projet/);
    assert.match(summary.textContent, /Relancer le projet/);
  } finally { await ui.cleanup(); }
});

test('les neuf rubriques se replient individuellement sans perdre les brouillons', async () => {
  const ui = await mount(board());
  try {
    const sections = ui.document.querySelectorAll('[data-rubrique]');
    assert.equal(sections.length, 9);
    const first = sections[0];
    const toggle = first.querySelector('button[aria-expanded]');
    assert.equal(toggle?.getAttribute('aria-expanded'), 'true');
    const note = first.querySelector('textarea[aria-label^="Note"]');
    await ui.change(note, 'Brouillon non sauvegardé');
    await ui.click(toggle);
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(first.querySelector('form').hidden, true);
    assert.equal(sections[1].querySelector('form').hidden, false);
    await ui.click(toggle);
    assert.equal(first.querySelector('textarea[aria-label^="Note"]').value, 'Brouillon non sauvegardé');
  } finally { await ui.cleanup(); }
});

test('une archive présente son échéance historique sans badge de retard ni édition', async () => {
  const ui = await mount(board([rubric('projets', { prochaineAction: 'Appeler', prochaineActionEcheance: localDay(-4) })], '2026-03-01'));
  try {
    assert.equal(ui.document.querySelector('[aria-label="Résumé du tableau courant"]'), null);
    assert.equal(ui.document.querySelector('[aria-label="Actions en retard"]'), null);
    assert.doesNotMatch(ui.document.body.textContent, /En retard/);
    assert.ok(ui.document.body.textContent.includes(`Échéance de la prochaine action : ${localDay(-4)}`));
    assert.equal(ui.document.querySelectorAll('form, input, textarea, select').length, 0);
  } finally { await ui.cleanup(); }
});

test('un échec de sauvegarde conserve l’échéance brouillon et le message d’erreur', async () => {
  const ui = await mount(board(), async () => { throw new Error('Réseau indisponible'); });
  try {
    const due = ui.document.querySelector('input[aria-label="Échéance de la prochaine action — À quand le plan directeur"]');
    await ui.change(due, localDay(2));
    await act(async () => due.closest('form').dispatchEvent(new ui.document.defaultView.Event('submit', { bubbles: true, cancelable: true })));
    assert.equal(due.value, localDay(2));
    assert.match(due.closest('form').querySelector('[role="alert"]')?.textContent ?? '', /Réseau indisponible/);
  } finally { await ui.cleanup(); }
});
