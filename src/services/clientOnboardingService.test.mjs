import test from 'node:test';
import assert from 'node:assert/strict';
import { CLIENT_ONBOARDING_TEMPLATE, createTemplateItems, listClientOnboardings, getOnboardingOptions, getClientOnboardingHistory, getCompleteOnboardingHistory, createClientOnboarding, reconcileClientOnboarding, updateClientOnboarding, archiveClientOnboarding, restoreClientOnboarding } from './clientOnboardingService.ts';

test('create and reconcile use the identical requestKey, independently of list filters', async () => {
  const original = globalThis.fetch;
  const key = '5dd87d23-e7ad-4a9e-b993-726f7d40b4a9';
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(options.credentials, 'include');
      if (options.method === 'POST') {
        assert.equal(url, '/api/client-onboardings');
        assert.deepEqual(JSON.parse(options.body), {onboarding: {client_id: 1, titre: 'Original'}, items: [], requestKey: key});
        return Response.json({error: 'Timeout'}, {status: 503});
      }
      assert.equal(url, `/api/client-onboardings/reconcile?requestKey=${key}`);
      return Response.json({found: true, id: 12, archived: true});
    };
    await assert.rejects(createClientOnboarding({client_id: 1, titre: 'Original'}, [], key), /Timeout/);
    assert.deepEqual(await reconcileClientOnboarding(key), {found: true, id: 12, archived: true});
  } finally { globalThis.fetch = original; }
});

test('201 create requires a usable persisted record before confirming the POST', async () => {
  const original = globalThis.fetch;
  try {
    for (const invalid of [{}, {id: 0, version: 1, client_id: 1, items: []},
      {id: 7, version: null, client_id: 1, items: []},
      {id: 7, version: 1, client_id: 0, items: []},
      {id: 7, version: 1, client_id: 1, items: null}]) {
      globalThis.fetch = async () => Response.json(invalid, {status: 201});
      await assert.rejects(createClientOnboarding({client_id: 1}, [], 'key'), /Réponse de création invalide/);
    }
    globalThis.fetch = async () => Response.json({id: 7, version: 1, client_id: 1, items: []}, {status: 201});
    assert.equal((await createClientOnboarding({client_id: 1}, [], 'key')).id, 7);
  } finally {globalThis.fetch = original;}
});

test('201 create rejects every malformed checklist item before treating the dossier as confirmed', async () => {
  const original = globalThis.fetch;
  const valid = {section_key: 'section', section_title: 'Section', element: 'Question', item_order: 0, checked: false};
  const dossier = {id: 7, version: 1, client_id: 1};
  try {
    for (const item of [null, 3, 'question', [], {},
      ...['section_key', 'section_title', 'element', 'item_order', 'checked'].map(key => {const copy = {...valid}; delete copy[key]; return copy;}),
      ...['section_key', 'section_title', 'element'].flatMap(key => [{...valid, [key]: ''}, {...valid, [key]: 42}]),
      {...valid, item_order: -1}, {...valid, item_order: 1.5}, {...valid, item_order: '0'},
      {...valid, checked: 0}, {...valid, checked: 'false'}]) {
      globalThis.fetch = async () => Response.json({...dossier, items: [valid, item]}, {status: 201});
      await assert.rejects(createClientOnboarding({client_id: 1}, [], 'key'), /Réponse de création invalide/, JSON.stringify(item));
    }
    globalThis.fetch = async () => Response.json({...dossier, items: [valid]}, {status: 201});
    assert.deepEqual((await createClientOnboarding({client_id: 1}, [], 'key')).items, [valid]);
    const template = createTemplateItems();
    assert.equal(template.length, 123);
    globalThis.fetch = async () => Response.json({...dossier, items: template}, {status: 201});
    assert.equal((await createClientOnboarding({client_id: 1}, template, 'key')).items.length, 123);
  } finally {globalThis.fetch = original;}
});

test('le questionnaire BZ conserve onze sections et une question par élément', () => {
  assert.equal(CLIENT_ONBOARDING_TEMPLATE.length, 11);
  assert.equal(createTemplateItems().length, CLIENT_ONBOARDING_TEMPLATE.reduce((n, s) => n + s.items.length, 0));
  assert.equal(createTemplateItems()[0].statut, 'À faire');
});
test('options Prime et filtres utilisent l’API dédiée et les IDs canoniques', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(options.credentials, 'include');
      if (url === '/api/client-onboardings/options') return Response.json({ clients: [{ id: 4, nom: 'Client' }], techniciens: [] });
      assert.equal(url, '/api/client-onboardings?search=test&client_id=4&technicien_id=3&statut=Fait&archived=true');
      return Response.json([{ id: 1, version: 2 }]);
    };
    assert.equal((await getOnboardingOptions()).clients[0].id, 4);
    assert.equal((await listClientOnboardings({ search: 'test', client_id: 4, technicien_id: 3, statut: 'Fait', archived: true }))[0].version, 2);
  } finally { globalThis.fetch = original; }
});
test('registre récupère les dossiers au-delà de la première page de 50', async () => {
  const original = globalThis.fetch;
  const urls = [];
  try {
    globalThis.fetch = async url => {
      urls.push(url);
      return Response.json(url.includes('before=') ? [{id: 1}] : Array.from({length: 50}, (_, i) => ({id: 101 - i})));
    };
    const rows = await listClientOnboardings({archived: false});
    assert.equal(rows.length, 51);
    assert.deepEqual(urls, ['/api/client-onboardings?archived=false', '/api/client-onboardings?archived=false&before=52']);
  } finally { globalThis.fetch = original; }
});
test('écritures protègent la version et propagent les conflits', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, '/api/client-onboardings/8');
      assert.equal(options.method, 'PUT');
      assert.deepEqual(JSON.parse(options.body), { onboarding: { client_id: 4 }, items: [], expectedVersion: 3 });
      return Response.json({ error: 'Conflit de version' }, { status: 409 });
    };
    await assert.rejects(updateClientOnboarding(8, { client_id: 4 }, [], 3), /Conflit de version/);
    globalThis.fetch = async (url, options) => {
      assert.equal(options.credentials, 'include');
      assert.equal(JSON.parse(options.body).expectedVersion, 3);
      return Response.json(url.endsWith('/restore') ? { id: 8, version: 4 } : { success: true });
    };
    await archiveClientOnboarding(8, 3);
    assert.equal((await restoreClientOnboarding(8, 3)).version, 4);
  } finally { globalThis.fetch = original; }
});
test('pagination historique transmet le curseur et le nombre demandé', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, '/api/client-onboardings/8/history?limit=50&before=41');
      assert.equal(options.credentials, 'include');
      return Response.json({history: [{id: 40}], hasMore: true, nextBefore: 40});
    };
    assert.equal((await getClientOnboardingHistory(8, 41)).nextBefore, 40);
  } finally { globalThis.fetch = original; }
});
test('export history retrieves all pages beyond 50 events', async () => {
  const original = globalThis.fetch;
  const urls = [];
  try {
    globalThis.fetch = async url => {
      urls.push(url);
      return Response.json(url.includes('before=') ? {events: [{id: 1, event_type: 'created'}], nextBefore: null} :
        {events: Array.from({length: 100}, (_, i) => ({id: 101 - i, event_type: 'updated'})), nextBefore: 2});
    };
    const events = await getCompleteOnboardingHistory(8);
    assert.equal(events.length, 101);
    assert.deepEqual(urls, ['/api/client-onboardings/8/history?limit=100', '/api/client-onboardings/8/history?limit=100&before=2']);
  } finally { globalThis.fetch = original; }
});
test('export history rejects a failed page instead of returning a partial export', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async url => url.includes('before=') ? Response.json({error: 'Historique indisponible'}, {status: 503}) : Response.json({events: [{id: 2}], nextBefore: 2});
    await assert.rejects(getCompleteOnboardingHistory(8), /Historique indisponible/);
  } finally { globalThis.fetch = original; }
});
test('export history rejects a stagnant cursor', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({events: [{id: 2}], nextBefore: 2});
    await assert.rejects(getCompleteOnboardingHistory(8), /[Pp]agination/);
  } finally { globalThis.fetch = original; }
});
test('export history rejects hasMore without a cursor', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({events: [{id: 2}], hasMore: true, nextBefore: null});
    await assert.rejects(getCompleteOnboardingHistory(8), /[Pp]agination/);
  } finally { globalThis.fetch = original; }
});