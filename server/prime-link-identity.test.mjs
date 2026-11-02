import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'app-prime-link-identity-'));
process.env.SQLITE_PATH=path.join(dir,'app.sqlite');
process.env.APP_PRIME_ALLOW_NEW_DATABASE='1';
delete process.env.DATABASE_URL;
const db=await import('./database/index.js');
const {checkSqliteMetierIdentity}=await import('./database/metier-migration.js');
await db.initDb();

test('un schéma de liaison existant sans unicité du Prime est rejeté avant migration',()=>{
  const sqlite=new BetterSqlite3(process.env.SQLITE_PATH);
  try {
    sqlite.exec(`DROP TABLE prime_user_links;
      CREATE TABLE prime_user_links (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        prime_id INTEGER NOT NULL REFERENCES primes(id) ON DELETE RESTRICT
      );`);
    assert.throws(()=>checkSqliteMetierIdentity(sqlite),/unique|unicité/i);
  } finally { sqlite.close();fs.rmSync(dir,{recursive:true,force:true}); }
});
