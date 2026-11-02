import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-prime-servo-test-'));
process.env.SQLITE_PATH = path.join(dir, 'prime.sqlite');
process.env.APP_PRIME_ALLOW_NEW_DATABASE = '1';
delete process.env.DATABASE_URL;
const db = await import('./database/index.js');

 test('le lien Servo reste attaché au client App Prime après une édition locale', async () => {
  try {
    await db.initDb();
    const prime = await db.createPrime({ nom: 'Prime test' });
    const client = await db.createClient({ nom: 'Client Servo test', secteur: '', statut: 'actif', primeId: prime.id, servoClientId: 42 });
    assert.equal(client.servoClientId, 42);
    const edited = await db.updateClient(client.id, { nom: 'Nouveau nom', secteur: 'TI', statut: 'actif', primeId: prime.id },
      { primeId: prime.id, servoClientId: 42 });
    assert.equal(edited.servoClientId, 42);
    assert.equal((await db.listClients()).find(c => c.id === client.id).servoClientId, 42);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
