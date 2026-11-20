import test from 'node:test';
import assert from 'node:assert/strict';
import * as view from './suivisPortfolio.ts';

test('recherche accentuée et anciens suivis ouverts restent distincts, fermés exclus', () => {
  const clients=[{id:1,nom:'École Bêta',primeId:7},{id:2,nom:'Autre',primeId:8}];
  const suivis=[{id:2,clientId:1,statut:'en_cours',titre:'Relancer ancien',echeance:'2026-11-21'}, {id:3,clientId:1,statut:'termine',titre:'Fermé',echeance:'2020-01-01'}];
  const rows=view.portfolioClients(clients,[],suivis,'2026-11-20');
  assert.equal(rows[0].actions.length,1); assert.equal(rows[0].actions[0].source,'ancien');
  assert.equal(view.searchClients(rows,'ecole beta').length,1);
  assert.equal(view.searchClients(rows,'absent').length,0);
  assert.equal(view.validDue('2026-02-30'),false);
});

test('priorités complètes: seulement échéances réelles des actions ouvertes, archives exclues', () => {
  assert.equal(typeof view.portfolioClients, 'function');
  const clients = Array.from({ length: 65 }, (_, i) => ({ id: i+1, nom: `Client ${i+1}`, primeId: 7 }));
  const rubric = (key, changes={}) => ({ key, statut:'en_cours', date:'2020-01-01', prochaineAction:'Appeler', prochaineActionEcheance:null, note:'', version:null, ...changes });
  const boards = clients.map(c=>({ id:c.id, clientId:c.id, archivedAt:null, createdAt:'2026-01-01', rubriques:[rubric('projets')] }));
  boards[64].rubriques.push(rubric('backups',{prochaineActionEcheance:'2026-11-19'}));
  boards[0].rubriques.push(rubric('rencontre',{statut:'termine', prochaineActionEcheance:'2020-01-01'}),rubric('vm_bz',{prochaineAction:' ',prochaineActionEcheance:'2020-01-01'}));
  boards.push({id:100,clientId:1,archivedAt:'2026-01-01',rubriques:[rubric('projets',{prochaineActionEcheance:'2020-01-01'})]});
  const rows = view.portfolioClients(clients,boards,[], '2026-11-20');
  assert.equal(rows.length,65); assert.equal(rows[0].client.id,65);
  assert.equal(rows.reduce((n,r)=>n+r.overdue,0),1);
  assert.equal(rows.reduce((n,r)=>n+r.undated,0),65);
  assert.equal(rows.reduce((n,r)=>n+r.actions.length,0),66);
});
