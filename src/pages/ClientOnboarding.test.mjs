import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');
test('Prime entre dans la trousse mais les anciennes procédures restent réservées aux admins', () => {
  assert.match(source('../App.tsx'), /path="\/procedures" element=\{<Procedures/);
  assert.match(source('../App.tsx'), /path="\/procedures\/prise-en-charge"/);
  assert.doesNotMatch(source('../layout/Sidebar.tsx'), /to !== '\/procedures' \|\| user\?\.role === 'admin'/);
  assert.match(source('./Procedures.tsx'), /user\?\.role === 'admin'/);
});
test('éditeur par section et archives verrouillées', () => {
  const ui = source('./ClientOnboarding.tsx');
  assert.doesNotMatch(ui, /activeItems\[questionIndex\]/);
  assert.match(ui, /activeItems\.map/);
  assert.match(ui, /disabled=\{readOnly/);
  assert.match(ui, /beforeunload/);
  assert.match(ui, /selected\.version/);
});
test('les chargements concurrents, mutations et pagination sont protégés', () => {
  const ui = source('./ClientOnboarding.tsx');
  assert.match(ui, /detailRequest\.current/);
  assert.match(ui, /busyRef\.current/);
  assert.match(ui, /getClientOnboardingHistory/);
  assert.match(ui, /nextBefore/);
  assert.match(ui, /disabled=\{busy/);
});