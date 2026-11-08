import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { withSqliteOwner } from './database/sqlite-isolation.js';

assert.equal(process.env.APP_PRIME_ISOLATED_TEST, '1', 'Disposable SQLite fixture required');
assert.equal(process.env.DATABASE_URL, undefined, 'SQLite fixture only');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prime-sqlite-isolation-'));
process.env.SQLITE_PATH = path.join(dir, 'fixture.sqlite');
process.env.APP_PRIME_ALLOW_NEW_DATABASE = '1';
process.env.NODE_ENV = 'test';
const db = await import('./database/index.js');
const driver = await db.initDb();
const actor = await db.createUserWithPrime({ email: 'owner@example.test', passwordHash: 'fixture', prenom: 'Owner', nom: 'Prime' });
const client = await db.createClient({ nom: 'Before', clientType: 'ti', primeId: actor.prime.id });
const expected = { primeId: actor.prime.id, servoClientId: null };
const input = { nom: 'After', clientType: 'ti', primeId: actor.prime.id };
const record = { client_id: client.id, technicien_id: actor.user.id, titre: 'Onboarding', statut: 'À faire', priorite: 'Moyenne', compte_rendu: {} };
const identity = { sub: actor.user.id, role: 'prime', email: actor.user.email };
const rubrique = { statut: 'en_cours', date: null, note: 'Concurrent', prochaineAction: '', version: null };

async function overlapping(onOpen) {
  driver.sqlite.exec("CREATE TRIGGER test_onboarding_abort BEFORE INSERT ON client_onboarding_history BEGIN SELECT RAISE(ABORT, 'injected onboarding failure'); END");
  let pending;
  try {
    pending = db.createClientOnboarding(record, [], identity, randomUUID());
    for (let i = 0; i < 100 && !driver.sqlite.inTransaction; i++) await Promise.resolve();
    assert.equal(driver.sqlite.inTransaction, true, 'onboarding opened its transaction');
    const result = await onOpen();
    await assert.rejects(pending, /injected onboarding failure/);
    return result;
  } finally {
    if (pending) await pending.catch(() => {});
    driver.sqlite.exec('DROP TRIGGER test_onboarding_abort');
  }
}

async function heldOwner(onOpen) {
  let release;
  const pending = withSqliteOwner(() => new Promise(resolve => { release = resolve; }));
  try { await onOpen(); }
  finally { release(); await pending; }
}

try {
  await test('an interleaved client update never reports success and then disappears', async () => {
    let succeeded = false;
    await overlapping(async () => {
      try { await db.updateClient(client.id, input, expected); succeeded = true; }
      catch (error) { assert.match(error.message, /transaction|busy|locked|isolation/i); }
    });
    assert.equal(succeeded, false, 'an uncommitted unrelated write must not report success');
    assert.equal((await db.listClients()).find(c => c.id === client.id).nom, 'Before');
    assert.equal((await db.updateClient(client.id, input, expected)).nom, 'After');
    assert.equal((await db.listClients()).find(c => c.id === client.id).nom, 'After');
  });
  await test('portfolio and tableau writes cannot join a different onboarding transaction', async () => {
    const board = (await db.listTableaux(actor.user.id, false)).find(t => t.clientId === client.id);
    await overlapping(async () => {
      const operations = [
        () => db.updatePrimePortfolio(actor.prime.id, { ...actor.prime, nom: 'Changed' }, { remove: [], add: [] }),
        () => db.updateTableauRubrique(board.id, 'projets', rubrique, actor.user.id, false),
        () => db.createTableau(client.id, actor.user.id, false, board.id),
        () => db.createSuivi({ titre: 'Transient', clientId: client.id, primeId: actor.prime.id }),
        () => db.setUserActive(actor.user.id, false),
      ];
      const attempts = operations.map(operation => operation());
      for (const attempt of attempts) await assert.rejects(attempt, /transaction|busy|locked|isolation/i);
    });
    assert.equal((await db.listPrimes()).find(p => p.id === actor.prime.id).nom, actor.prime.nom);
    assert.equal((await db.listTableaux(actor.user.id, false)).filter(t => t.clientId === client.id).length, 1);
    assert.equal((await db.listSuivis()).length, 0);
    assert.equal((await db.getUserById(actor.user.id)).is_active, true);
  });
  await test('cached statements and transactions cannot bypass the connection guard', async () => {
    const statement = driver.sqlite.prepare('UPDATE clients SET data = ? WHERE id = ?').safeIntegers();
    const transaction = driver.sqlite.transaction(() => 1);
    await overlapping(async () => {
      assert.throws(() => statement.run(JSON.stringify({ nom: 'Cached write' }), client.id), /transaction isolation/i);
      assert.throws(() => transaction.immediate(), /transaction isolation/i);
    });
    assert.equal((await db.listClients()).find(c => c.id === client.id).nom, 'After');
  });
  await test('a cached exec result cannot expose a raw connection during another owner', async () => {
    const chained = driver.sqlite.exec('SELECT 1');
    assert.strictEqual(chained, driver.sqlite, 'exec returns the guarded connection');
    assert.strictEqual(driver.sqlite.defaultSafeIntegers(false), driver.sqlite);
    assert.strictEqual(driver.sqlite.unsafeMode(false), driver.sqlite);
    await overlapping(async () => {
      assert.throws(() => chained.prepare('UPDATE clients SET data = ? WHERE id = ?'), /transaction isolation/i);
      assert.throws(() => chained.exec('UPDATE clients SET data = NULL'), /transaction isolation/i);
    });
  });
  await test('fluent statement methods retain the guard', async () => {
    const statement = driver.sqlite.prepare('SELECT id FROM clients');
    for (const mode of ['expand', 'safeIntegers', 'pluck', 'raw', 'bind']) {
      assert.strictEqual(statement[mode](), statement, `${mode} returns the guarded statement`);
    }
    const cachedPluck = statement.pluck;
    const cachedRun = driver.sqlite.prepare('UPDATE clients SET data = ? WHERE id = ?').run;
    await overlapping(async () => {
      assert.throws(() => statement.get(), /transaction isolation/i);
      assert.throws(() => cachedPluck(), /transaction isolation/i);
      assert.throws(() => cachedRun(JSON.stringify({ nom: 'Leaked' }), client.id), /transaction isolation/i);
    });
  });
  await test('statement and iterator handle properties cannot expose raw objects', async () => {
    const statement = driver.sqlite.prepare('SELECT id FROM clients');
    assert.strictEqual(statement.database, driver.sqlite);
    assert.strictEqual(Object.getOwnPropertyDescriptor(statement, 'database').value, driver.sqlite);
    assert.strictEqual(Object.getOwnPropertyDescriptors(statement).database.value, driver.sqlite);
    const iterator = statement.iterate();
    try {
      assert.strictEqual(iterator.statement, statement);
      assert.strictEqual(Object.getOwnPropertyDescriptor(iterator, 'statement').value, statement);
      assert.strictEqual(iterator.statement.database, driver.sqlite);
      await heldOwner(async () => {
        assert.throws(() => iterator.statement.get(), /transaction isolation/i);
        assert.throws(() => statement.database.exec('SELECT 1'), /transaction isolation/i);
      });
    } finally { iterator.return(); }
  });
  await test('cached iterator symbols and methods cannot yield an unguarded iterator', async () => {
    const iterator = driver.sqlite.prepare('SELECT id FROM clients').iterate();
    try {
      assert.strictEqual(iterator[Symbol.iterator](), iterator, 'symbol iterator returns the guarded iterator');
      const cachedSymbol = iterator[Symbol.iterator];
      const cachedNext = iterator.next;
      await heldOwner(async () => {
        assert.throws(() => cachedSymbol(), /transaction isolation/i);
        assert.throws(() => cachedNext(), /transaction isolation/i);
        assert.throws(() => iterator.next(), /transaction isolation/i);
        assert.throws(() => [...iterator], /transaction isolation/i);
        assert.throws(() => iterator.return(), /transaction isolation/i);
      });
      assert.equal(iterator.next().done, false);
    } finally { iterator.return(); }
  });
  await test('an asynchronous business seed also owns the SQLite connection until commit', async () => {
    const pending = db.seedMetier();
    for (let i = 0; i < 100 && !driver.sqlite.inTransaction; i++) await Promise.resolve();
    assert.equal(driver.sqlite.inTransaction, true);
    try {
      await assert.rejects(db.updateClient(client.id, { ...input, nom: 'Seed interleave' }, expected), /transaction isolation/i);
    } finally {
      assert.equal(await pending, false);
    }
    assert.equal((await db.listClients()).find(c => c.id === client.id).nom, 'After');
  });
} finally {
  driver.sqlite.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
