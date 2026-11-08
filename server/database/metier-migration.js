// Compatibility migration for App Prime's pre-JSON métier tables. Never
// interpret an unrelated table with the same name as an App Prime table.
const TABLES = {
  primes: ['id', 'nom', 'code_titan', 'specialites', 'disponibilite', 'avatar_initiales', 'created_at'],
  clients: ['id', 'nom', 'secteur', 'prime_id', 'statut', 'created_at'],
  suivis: ['id', 'titre', 'client_id', 'prime_id', 'statut', 'echeance', 'note', 'created_at'],
};
const CORE = {
  primes: ['id', 'created_at'],
  clients: ['id', 'prime_id', 'created_at'],
  suivis: ['id', 'client_id', 'prime_id', 'created_at'],
};
const LEGACY_REQUIRED = { primes: 'nom', clients: 'nom', suivis: 'titre' };
const BOARD_COLUMNS = {
  client_onboardings: ['id','client_id','technicien_id','titre','statut','priorite','urgence_ti','site_principal','contact_principal','periode_couverte','prepare_pour','avancement_global','risques_critiques','actions_ouvertes','decisions_requises','prochaine_rencontre','version','data','archived','archived_at','compte_rendu','created_by_id','created_by_email','updated_by_id','updated_by_email','created_at','updated_at'],
  client_onboarding_items: ['id','onboarding_id','section_key','section_title','item_order','checked','priorite','statut','element','notes','action','responsable','echeance','created_at','updated_at'],
  client_onboarding_history: ['id','onboarding_id','event_type','snapshot','actor_id','actor_email','created_at'],
  tableaux_suivi: ['id', 'client_id', 'created_at', 'archived_at'],
  tableau_rubriques: ['tableau_id', 'key', 'statut', 'date', 'note', 'prochaine_action', 'version'],
};
const ONBOARDING_TEXT = ['titre','statut','priorite','urgence_ti','site_principal','contact_principal','periode_couverte','prepare_pour','avancement_global','risques_critiques','actions_ouvertes','decisions_requises','prochaine_rencontre','created_by_email','updated_by_email'];
const ITEM_TEXT = ['section_key','section_title','priorite','statut','element','notes','action','responsable'];
const OWNED_TABLES = new Set(['users', 'user_mfa', 'prime_user_links', ...Object.keys(BOARD_COLUMNS), ...Object.keys(TABLES)]);
const USER_COLUMNS = {
  users: ['id', 'email', 'password_hash', 'prenom', 'nom', 'role', 'is_active', 'created_at'],
  user_mfa: ['user_id', 'secret_encrypted', 'mfa_enabled', 'pending_setup', 'enabled_at', 'created_at', 'updated_at'],
  prime_user_links: ['user_id', 'prime_id'],
};
const PG_TYPES = {
  users: { id: 'int4', email: 'text', password_hash: 'text', is_active: 'bool', created_at: 'timestamp' },
  user_mfa: { user_id: 'int4', secret_encrypted: 'text', mfa_enabled: 'bool', pending_setup: 'bool' },
  prime_user_links: { user_id: 'int4', prime_id: 'int4' },
  primes: { id: 'int4', created_at: 'timestamp', specialites: 'jsonb' },
  clients: { id: 'int4', prime_id: 'int4', created_at: 'timestamp' },
  suivis: { id: 'int4', client_id: 'int4', prime_id: 'int4', created_at: 'timestamp' },
  client_onboardings: { id:'int4',request_key:'text',client_id:'int4',technicien_id:'int4',created_by_id:'int4',updated_by_id:'int4',version:'int4',data:'jsonb',compte_rendu:'jsonb',archived:'bool',created_at:'timestamp',updated_at:'timestamp',archived_at:'timestamp',...Object.fromEntries(ONBOARDING_TEXT.map(k=>[k,'text'])) },
  client_onboarding_items: { id:'int4',onboarding_id:'int4',item_order:'int4',checked:'bool',echeance:'date',created_at:'timestamp',updated_at:'timestamp',...Object.fromEntries(ITEM_TEXT.map(k=>[k,'text'])) },
  client_onboarding_history: { id:'int4',onboarding_id:'int4',snapshot:'jsonb',actor_id:'int4',actor_email:'text',event_type:'text',created_at:'timestamp' },
  tableaux_suivi: { id: 'int4', client_id: 'int4', created_at: 'timestamp', archived_at: 'timestamp' },
  tableau_rubriques: { tableau_id: 'int4', key: 'text', statut: 'text', date: 'text', note: 'text', prochaine_action: 'text', version: 'text' },
};
const PG_FOREIGN_KEYS = [
  ['client_onboardings','client_id','clients','id','RESTRICT'],
  ['client_onboardings','technicien_id','users','id','SET NULL'],
  ['client_onboardings','created_by_id','users','id','SET NULL'],
  ['client_onboardings','updated_by_id','users','id','SET NULL'],
  ['client_onboarding_items','onboarding_id','client_onboardings','id','CASCADE'],
  ['client_onboarding_history','onboarding_id','client_onboardings','id','CASCADE'],
  ['client_onboarding_history','actor_id','users','id','SET NULL'],
  ['user_mfa', 'user_id', 'users', 'id', 'CASCADE'],
  ['prime_user_links', 'user_id', 'users', 'id', 'CASCADE'],
  ['prime_user_links', 'prime_id', 'primes', 'id', 'RESTRICT'],
  ['clients', 'prime_id', 'primes', 'id', 'SET NULL'],
  ['suivis', 'client_id', 'clients', 'id', 'CASCADE'],
  ['suivis', 'prime_id', 'primes', 'id', 'SET NULL'],
  ['tableaux_suivi', 'client_id', 'clients', 'id', 'CASCADE'],
  ['tableau_rubriques', 'tableau_id', 'tableaux_suivi', 'id', 'CASCADE'],
];
const SQLITE_TYPES = {
  users: { id: 'INTEGER', email: 'TEXT', password_hash: 'TEXT', is_active: 'INTEGER' },
  user_mfa: { user_id: 'INTEGER', secret_encrypted: 'TEXT', mfa_enabled: 'INTEGER', pending_setup: 'INTEGER' },
  prime_user_links: { user_id: 'INTEGER', prime_id: 'INTEGER' },
  primes: { id: 'INTEGER', created_at: 'TEXT', specialites: 'TEXT' },
  clients: { id: 'INTEGER', prime_id: 'INTEGER', created_at: 'TEXT' },
  suivis: { id: 'INTEGER', client_id: 'INTEGER', prime_id: 'INTEGER', created_at: 'TEXT' },
  client_onboardings: { id:'INTEGER',request_key:'TEXT',client_id:'INTEGER',technicien_id:'INTEGER',created_by_id:'INTEGER',updated_by_id:'INTEGER',version:'INTEGER',data:'TEXT',compte_rendu:'TEXT',archived:'INTEGER',created_at:'TEXT',updated_at:'TEXT',archived_at:'TEXT',...Object.fromEntries(ONBOARDING_TEXT.map(k=>[k,'TEXT'])) },
  client_onboarding_items: { id:'INTEGER',onboarding_id:'INTEGER',item_order:'INTEGER',checked:'INTEGER',echeance:'TEXT',created_at:'TEXT',updated_at:'TEXT',...Object.fromEntries(ITEM_TEXT.map(k=>[k,'TEXT'])) },
  client_onboarding_history: { id:'INTEGER',onboarding_id:'INTEGER',snapshot:'TEXT',actor_id:'INTEGER',actor_email:'TEXT',event_type:'TEXT',created_at:'TEXT' },
  tableaux_suivi: { id: 'INTEGER', client_id: 'INTEGER', created_at: 'TEXT', archived_at: 'TEXT' },
  tableau_rubriques: { tableau_id: 'INTEGER', key: 'TEXT', statut: 'TEXT', date: 'TEXT', note: 'TEXT', prochaine_action: 'TEXT', version: 'TEXT' },
};

function checkOnboardingSet(names) {
  const found=['client_onboardings','client_onboarding_items','client_onboarding_history'].filter(t=>names.has(t));
  if(found.length && found.length!==3) throw new Error('Schéma App Prime incomplet: tables prise en charge');
}
function inspect(table, columns, type = 'pg') {
  if (!columns.size) return false; // This table will be created from the new schema.
  for (const name of CORE[table]) {
    if (!columns.has(name)) throw new Error(`Schéma ${table} étranger à App Prime: colonne ${name} absente`);
  }
  const legacy = columns.has(LEGACY_REQUIRED[table]);
  if (!columns.has('data') || legacy) {
    for (const name of TABLES[table]) {
      if (!columns.has(name)) throw new Error(`Schéma ${table} hérité incomplet: colonne ${name} absente`);
    }
  }
  if (!legacy && !columns.has('data')) throw new Error(`Schéma ${table} non reconnu`);
  if (type === 'pg' && columns.has('data') && columns.get('data') !== 'jsonb') {
    throw new Error(`Schéma ${table} incompatible: data n'est pas JSONB`);
  }
  return legacy;
}

async function pgColumns(connection) {
  const result = await connection.query(
    `SELECT table_name, column_name, udt_name FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = ANY($1::text[])`,
    [Object.keys(TABLES)],
  );
  const found = Object.fromEntries(Object.keys(TABLES).map(name => [name, new Map()]));
  for (const row of result.rows) found[row.table_name].set(row.column_name, row.udt_name);
  return found;
}

export async function checkPgMetierIdentity(pool) {
  const tables = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'`,
  );
  const names = new Set(tables.rows.map(row => row.table_name));
  checkOnboardingSet(names);
  if ([...names].some(name => !OWNED_TABLES.has(name))) {
    throw new Error('Schéma étranger à App Prime: tables non autorisées');
  }
  if (!names.size && process.env.APP_PRIME_ALLOW_NEW_DATABASE !== '1') {
    throw new Error('Base App Prime non reconnue: provisionnement explicite requis pour une base vide');
  }
  if (names.size) {
    const metierCount = Object.keys(TABLES).filter(name => names.has(name)).length;
    if (!names.has('users') || !names.has('user_mfa') || (metierCount !== 0 && metierCount !== 3)) {
      throw new Error('Schéma App Prime incomplet: tables attendues absentes');
    }
  }
  if (names.has('tableaux_suivi') !== names.has('tableau_rubriques')) {
    throw new Error('Schéma étranger à App Prime: tables de suivi incomplètes');
  }
  const found = await pgColumns(pool);
  for (const table of Object.keys(TABLES)) inspect(table, found[table]);
  if (names.size) {
    const userColumns = await pool.query(
      `SELECT table_name, column_name, udt_name FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = ANY($1::text[])`,
      [Object.keys(USER_COLUMNS).concat(Object.keys(BOARD_COLUMNS))],
    );
    const allColumns = { ...found };
    for (const table of Object.keys(USER_COLUMNS)) {
      allColumns[table] = new Map(userColumns.rows.filter(row => row.table_name === table)
        .map(row => [row.column_name, row.udt_name]));
      if (table === 'prime_user_links' && !names.has(table)) continue;
      if (USER_COLUMNS[table].some(column => !allColumns[table].has(column))) {
        throw new Error(`Schéma étranger à App Prime: ${table} incompatible`);
      }
    }
    for (const [table, required] of Object.entries(BOARD_COLUMNS)) {
      if (!names.has(table)) continue;
      allColumns[table] = new Map(userColumns.rows.filter(row => row.table_name === table)
        .map(row => [row.column_name, row.udt_name]));
      if (required.some(column => !allColumns[table].has(column))) {
        throw new Error(`Schéma étranger à App Prime: ${table} incompatible`);
      }
    }
    for (const [table, expected] of Object.entries(PG_TYPES)) {
      if (!names.has(table) && BOARD_COLUMNS[table]) continue;
      const actual = allColumns[table];
      for (const [column, type] of Object.entries(expected)) {
        if (actual.has(column) && actual.get(column) !== type) {
          throw new Error(`Schéma étranger à App Prime: ${table}.${column} incompatible`);
        }
      }
    }
    const keys = await pool.query(
      `SELECT tc.table_name, tc.constraint_name, kcu.column_name, tc.constraint_type,
              ccu.table_name AS referenced_table, ccu.column_name AS referenced_column,
              rc.delete_rule
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       LEFT JOIN information_schema.constraint_column_usage ccu
         ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
       LEFT JOIN information_schema.referential_constraints rc
         ON tc.constraint_name = rc.constraint_name AND tc.constraint_schema = rc.constraint_schema
       WHERE tc.table_schema = current_schema() AND tc.constraint_type IN ('PRIMARY KEY','FOREIGN KEY','UNIQUE')`,
    );
    for (const table of names) {
      if (table === 'tableau_rubriques') {
        const groups = new Map();
        for (const row of keys.rows.filter(row => row.table_name === table && row.constraint_type === 'PRIMARY KEY')) {
          if (!groups.has(row.constraint_name)) groups.set(row.constraint_name, []);
          groups.get(row.constraint_name).push(row.column_name);
        }
        if (![...groups.values()].some(columns => new Set(columns).size === 2 && columns.includes('tableau_id') && columns.includes('key'))) {
          throw new Error('Schéma étranger à App Prime: clé primaire tableau_rubriques(tableau_id,key) absente');
        }
        continue;
      }
      const key = table === 'user_mfa' || table === 'prime_user_links' ? 'user_id' : 'id';
      if (!keys.rows.some(row => row.table_name === table && row.constraint_type === 'PRIMARY KEY' && row.column_name === key)) {
        throw new Error(`Schéma étranger à App Prime: clé primaire ${table}.${key} absente`);
      }
    }
    if (names.has('prime_user_links')) {
      const groups = new Map();
      for (const row of keys.rows.filter(row => row.table_name === 'prime_user_links' && row.constraint_type === 'UNIQUE')) {
        if (!groups.has(row.constraint_name)) groups.set(row.constraint_name, []);
        groups.get(row.constraint_name).push(row.column_name);
      }
      if (![...groups.values()].some(columns => columns.length === 1 && columns[0] === 'prime_id')) {
        throw new Error('Schéma étranger à App Prime: unicité prime_user_links.prime_id absente');
      }
    }
    if (names.has('client_onboarding_items')) {
      const groups=new Map();
      for(const r of keys.rows.filter(r=>r.table_name==='client_onboarding_items' && r.constraint_type==='UNIQUE')) {
        if(!groups.has(r.constraint_name)) groups.set(r.constraint_name,[]);
        groups.get(r.constraint_name).push(r.column_name);
      }
      if (![...groups.values()].some(cols=>new Set(cols).size===3 && ['onboarding_id','section_key','item_order'].every(c=>cols.includes(c)))) throw new Error('Schéma App Prime: unicité des items absente');
    }
    if (names.has('client_onboardings') && allColumns.client_onboardings.has('request_key')) {
      const nullable=await pool.query("SELECT is_nullable FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='client_onboardings' AND column_name='request_key'");
      const groups=new Map();
      for(const r of keys.rows.filter(r=>r.table_name==='client_onboardings' && r.constraint_type==='UNIQUE')) {
        if(!groups.has(r.constraint_name)) groups.set(r.constraint_name,[]);
        groups.get(r.constraint_name).push(r.column_name);
      }
      const unique=[...groups.values()].some(columns=>columns.length===1 && columns[0]==='request_key');
      if (nullable.rows[0].is_nullable!=='NO' || !unique) throw new Error('Schéma App Prime: request_key non unique ou nullable');
      const invalid=await pool.query("SELECT 1 FROM client_onboardings WHERE request_key !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' LIMIT 1");
      if (invalid.rowCount) throw new Error('Schéma App Prime: request_key invalide');
    }
    const expectedIndexes={idx_prime_onboarding_client:['client_onboardings','client_id'],idx_prime_onboarding_technicien:['client_onboardings','technicien_id'],idx_prime_onboarding_archived:['client_onboardings','archived','id'],idx_prime_onboarding_items:['client_onboarding_items','onboarding_id'],idx_prime_onboarding_history:['client_onboarding_history','onboarding_id','id']};
    const indexes=await pool.query('SELECT indexname, tablename, indexdef FROM pg_indexes WHERE schemaname=current_schema()');
    for(const index of indexes.rows) if(expectedIndexes[index.indexname]) {
      const [table,...fields]=expectedIndexes[index.indexname];
      if(index.tablename!==table || !index.indexdef.includes(`(${fields.join(', ')})`)) throw new Error(`Schéma App Prime: index ${index.indexname} incompatible`);
    }
    for(const [table,field] of [['client_onboardings','data'],['client_onboardings','compte_rendu'],['client_onboarding_history','snapshot']]) if(names.has(table)) {
      const invalid=await pool.query(`SELECT 1 FROM ${table} WHERE jsonb_typeof(${field}) IS DISTINCT FROM 'object' LIMIT 1`);
      if(invalid.rowCount) throw new Error(`Schéma App Prime: ${table}.${field} doit être un objet JSON`);
    }
    for (const [table, column, refTable, refColumn, deleteRule] of PG_FOREIGN_KEYS) {
      if (!names.has(table)) continue;
      if (!keys.rows.some(row => row.table_name === table && row.column_name === column &&
        row.constraint_type === 'FOREIGN KEY' && row.referenced_table === refTable &&
        row.referenced_column === refColumn && row.delete_rule === deleteRule)) {
        throw new Error(`Schéma étranger à App Prime: clé étrangère ${table}.${column} ou action de suppression incompatible`);
      }
    }
  }
}

const PG_BACKFILL = {
  primes: `jsonb_build_object('nom', nom, 'codeTitan', code_titan,
    'specialites', specialites, 'disponibilite', disponibilite,
    'avatarInitiales', avatar_initiales)`,
  clients: `jsonb_build_object('nom', nom, 'secteur', secteur, 'statut', statut)`,
  suivis: `jsonb_build_object('titre', titre, 'statut', statut,
    'echeance', echeance, 'note', note)`,
};
const DATA_KEYS = {
  primes: ['nom', 'codeTitan', 'specialites', 'disponibilite', 'avatarInitiales'],
  clients: ['nom', 'secteur', 'statut'],
  suivis: ['titre', 'statut', 'echeance', 'note'],
};

export async function migratePgMetier(pool, createSchema) {
  const connection = await pool.connect();
  try {
    await connection.query('BEGIN');
    await connection.query("SELECT pg_advisory_xact_lock(hashtext('app-prime-metier-json-v1'))");
    await checkPgMetierIdentity(connection);
    await createSchema(connection);
    await (await import('./client-onboardings.js')).createOnboardingSchemaPg(connection);
    const found = await pgColumns(connection);
    const legacy = {};
    for (const table of Object.keys(TABLES)) {
      const cols = found[table];
      legacy[table] = inspect(table, cols);
      if (!cols.has('data')) await connection.query(`ALTER TABLE ${table} ADD COLUMN data JSONB`);
      if (legacy[table]) {
        if (table === 'primes') {
          const bad = await connection.query("SELECT COUNT(*)::int AS n FROM primes WHERE jsonb_typeof(specialites) <> 'array'");
          if (bad.rows[0].n) throw new Error('Schéma primes: specialites doit être un tableau JSON');
        }
        const malformed = await connection.query(
          `SELECT 1 FROM ${table} WHERE data IS NOT NULL AND jsonb_typeof(data) <> 'object' LIMIT 1`,
        );
        if (malformed.rowCount) throw new Error(`Schéma ${table}: data doit être un objet JSON`);
        await connection.query(
          `UPDATE ${table} SET data = ${PG_BACKFILL[table]} || COALESCE(data, '{}'::jsonb)
           WHERE data IS NULL OR NOT (data ?& $1::text[])`,
          [DATA_KEYS[table]],
        );
      }
      const missing = await connection.query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE data IS NULL`);
      if (missing.rows[0].n) throw new Error(`Schéma ${table}: lignes sans data non migrables`);
      const invalid = await connection.query(
        `SELECT 1 FROM ${table} WHERE jsonb_typeof(data) <> 'object' OR
         jsonb_typeof(data->'${table === 'suivis' ? 'titre' : 'nom'}') IS DISTINCT FROM 'string'${table === 'primes' ? " OR jsonb_typeof(data->'specialites') IS DISTINCT FROM 'array'" : ''}
         LIMIT 1`,
      );
      if (invalid.rowCount) throw new Error(`Schéma ${table}: data doit être un objet JSON avec ses champs requis`);
      await connection.query(`ALTER TABLE ${table} ALTER COLUMN data SET DEFAULT '{}'::jsonb, ALTER COLUMN data SET NOT NULL`);
      if (!cols.has('updated_at')) await connection.query(`ALTER TABLE ${table} ADD COLUMN updated_at TIMESTAMP`);
      await connection.query(`UPDATE ${table} SET updated_at = COALESCE(created_at, CURRENT_TIMESTAMP) WHERE updated_at IS NULL`);
      await connection.query(`ALTER TABLE ${table} ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP, ALTER COLUMN updated_at SET NOT NULL`);
    }
    await connection.query('COMMIT');
    return legacy;
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  } finally {
    connection.release();
  }
}

function sqliteColumns(sqlite, table) {
  return new Map(sqlite.prepare(`PRAGMA table_info(${table})`).all().map(row => [row.name, row.type]));
}

export function checkSqliteMetierIdentity(sqlite) {
  const names = new Set(sqlite.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
  ).all().map(row => row.name));
  checkOnboardingSet(names);
  if ([...names].some(name => !OWNED_TABLES.has(name))) {
    throw new Error('Schéma étranger à App Prime: tables non autorisées');
  }
  if (!names.size && process.env.SQLITE_PATH && process.env.APP_PRIME_ALLOW_NEW_DATABASE !== '1') {
    throw new Error('Base App Prime non reconnue: provisionnement explicite requis pour un chemin SQLite personnalisé vide');
  }
  if (names.size) {
    const metierCount = Object.keys(TABLES).filter(name => names.has(name)).length;
    if (!names.has('users') || !names.has('user_mfa') || (metierCount !== 0 && metierCount !== 3)) {
      throw new Error('Schéma App Prime incomplet: tables attendues absentes');
    }
    for (const [table, expected] of Object.entries(USER_COLUMNS)) {
      if (table === 'prime_user_links' && !names.has(table)) continue;
      const actual = sqliteColumns(sqlite, table);
      if (expected.some(column => !actual.has(column))) {
        throw new Error(`Schéma étranger à App Prime: ${table} incompatible`);
      }
    }
  }
  if (names.has('tableaux_suivi') !== names.has('tableau_rubriques')) {
    throw new Error('Schéma étranger à App Prime: tables de suivi incomplètes');
  }
  const expectedIndexes={idx_prime_onboarding_client:['client_onboardings','client_id'],idx_prime_onboarding_technicien:['client_onboardings','technicien_id'],idx_prime_onboarding_archived:['client_onboardings','archived','id'],idx_prime_onboarding_items:['client_onboarding_items','onboarding_id'],idx_prime_onboarding_history:['client_onboarding_history','onboarding_id','id']};
  for(const [index,[table,...fields]] of Object.entries(expectedIndexes)) {
    const actual=sqlite.prepare("SELECT tbl_name,sql FROM sqlite_master WHERE type='index' AND name=?").get(index);
    if(actual && (actual.tbl_name!==table || !actual.sql?.includes(`(${fields.join(',')})`))) throw new Error(`Schéma App Prime: index ${index} incompatible`);
  }
  for(const [table,field] of [['client_onboardings','data'],['client_onboardings','compte_rendu'],['client_onboarding_history','snapshot']]) if(names.has(table)) {
    for(const record of sqlite.prepare(`SELECT id,${field} AS value FROM ${table}`).iterate()) {
      let parsed;
      try { parsed=JSON.parse(record.value); } catch { throw new Error(`Schéma App Prime: ${table}.${field} JSON invalide`); }
      if(!parsed || Array.isArray(parsed) || typeof parsed!=='object') throw new Error(`Schéma App Prime: ${table}.${field} doit être un objet JSON`);
    }
  }
  for (const table of Object.keys(TABLES)) inspect(table, sqliteColumns(sqlite, table), 'sqlite');
  for (const table of names) {
    const rows = sqlite.prepare(`PRAGMA table_info(${table})`).all();
    const columns = new Map(rows.map(row => [row.name, row]));
    if (BOARD_COLUMNS[table] && BOARD_COLUMNS[table].some(column => !columns.has(column))) {
      throw new Error(`Schéma étranger à App Prime: ${table} incompatible`);
    }
    if (table === 'tableau_rubriques') {
      if (columns.get('tableau_id')?.pk !== 1 || columns.get('key')?.pk !== 2 || rows.filter(row => row.pk).length !== 2) {
        throw new Error('Schéma étranger à App Prime: clé primaire tableau_rubriques(tableau_id,key) incompatible');
      }
    } else {
      const primaryKey = table === 'user_mfa' || table === 'prime_user_links' ? 'user_id' : 'id';
      if (rows.filter(row => row.pk).length !== 1 || columns.get(primaryKey)?.pk !== 1) {
        throw new Error(`Schéma étranger à App Prime: clé primaire ${table}.${primaryKey} incompatible`);
      }
    }
    if (table === 'client_onboardings' && columns.has('request_key')) {
      const unique=sqlite.prepare('PRAGMA index_list(client_onboardings)').all().some(index=>index.unique===1 && index.partial===0 &&
        sqlite.prepare(`PRAGMA index_info("${index.name.replaceAll('"','""')}")`).all().map(r=>r.name).join(',')==='request_key');
      const hex=n=>'[0-9a-f]'.repeat(n);
      const uuidPattern=`${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}`;
      if (columns.get('request_key').notnull!==1 || !unique ||
        sqlite.prepare('SELECT 1 FROM client_onboardings WHERE request_key NOT GLOB ? LIMIT 1').get(uuidPattern)) throw new Error('Schéma App Prime: request_key non unique, nullable ou invalide');
    }
    if (table === 'client_onboarding_items') {
      const unique=sqlite.prepare('PRAGMA index_list(client_onboarding_items)').all().some(index=>{
        if(!index.unique) return false;
        const escaped=index.name.replaceAll('"','""');
        const cols=sqlite.prepare(`PRAGMA index_info("${escaped}")`).all().map(r=>r.name);
        return cols.length===3 && ['onboarding_id','section_key','item_order'].every(c=>cols.includes(c));
      });
      if(!unique) throw new Error('Schéma App Prime: unicité des items absente');
    }
    if (table === 'prime_user_links') {
      if (columns.get('prime_id')?.notnull !== 1) {
        throw new Error('Schéma étranger à App Prime: prime_user_links.prime_id nullable');
      }
      const unique = sqlite.prepare('PRAGMA index_list(prime_user_links)').all().some(index => {
        if (index.unique !== 1) return false;
        const escaped = index.name.replaceAll('"', '""');
        const indexed = sqlite.prepare(`PRAGMA index_info("${escaped}")`).all();
        return indexed.length === 1 && indexed[0].name === 'prime_id';
      });
      if (!unique) throw new Error('Schéma étranger à App Prime: unicité prime_user_links.prime_id absente');
    }
    for (const [column, type] of Object.entries(SQLITE_TYPES[table])) {
      if (columns.has(column) && columns.get(column).type.toUpperCase() !== type) {
        throw new Error(`Schéma étranger à App Prime: ${table}.${column} incompatible`);
      }
    }
    const fks = sqlite.prepare(`PRAGMA foreign_key_list(${table})`).all();
    for (const [fkTable, column, referencedTable, referencedColumn, deleteRule] of PG_FOREIGN_KEYS) {
      if (table !== fkTable) continue;
      if (!fks.some(row => row.from === column && row.table === referencedTable &&
        row.to === referencedColumn && row.on_delete.toUpperCase() === deleteRule)) {
        throw new Error(`Schéma étranger à App Prime: clé étrangère ${table}.${column} ou action de suppression incompatible`);
      }
    }
  }
}

function sqliteLegacyData(table, row) {
  if (table === 'primes') {
    let specialites;
    try { specialites = JSON.parse(row.specialites); }
    catch { throw new Error(`Schéma primes: specialites JSON invalide (id ${row.id})`); }
    if (!Array.isArray(specialites)) throw new Error(`Schéma primes: specialites doit être un tableau (id ${row.id})`);
    return { nom: row.nom, codeTitan: row.code_titan, specialites,
      disponibilite: row.disponibilite, avatarInitiales: row.avatar_initiales };
  }
  if (table === 'clients') return { nom: row.nom, secteur: row.secteur, statut: row.statut };
  return { titre: row.titre, statut: row.statut, echeance: row.echeance, note: row.note };
}

export function migrateSqliteMetier(sqlite) {
  return sqlite.transaction(() => {
    const legacy = {};
    for (const table of Object.keys(TABLES)) {
      const cols = sqliteColumns(sqlite, table);
      legacy[table] = inspect(table, cols, 'sqlite');
      if (!cols.has('data')) sqlite.exec(`ALTER TABLE ${table} ADD COLUMN data TEXT`);
      if (!cols.has('updated_at')) sqlite.exec(`ALTER TABLE ${table} ADD COLUMN updated_at TEXT`);
      if (legacy[table]) {
        const rows = sqlite.prepare(`SELECT * FROM ${table}`).all();
        const update = sqlite.prepare(`UPDATE ${table} SET data = ? WHERE id = ?`);
        for (const row of rows) {
          let present = {};
          if (row.data !== null) {
            try {
              if (typeof row.data !== 'string') throw new Error('not text');
              present = JSON.parse(row.data);
            } catch {
              throw new Error(`Schéma ${table}: data JSON invalide (id ${row.id})`);
            }
            if (!present || Array.isArray(present) || typeof present !== 'object') {
              throw new Error(`Schéma ${table}: data doit être un objet JSON (id ${row.id})`);
            }
          }
          if (DATA_KEYS[table].some(key => !Object.hasOwn(present, key))) {
            update.run(JSON.stringify({ ...sqliteLegacyData(table, row), ...present }), row.id);
          }
        }
      }
      if (sqlite.prepare(`SELECT 1 FROM ${table} WHERE data IS NULL LIMIT 1`).get()) {
        throw new Error(`Schéma ${table}: lignes sans data non migrables`);
      }
      for (const row of sqlite.prepare(`SELECT id, data FROM ${table}`).iterate()) {
        let value;
        try {
          if (typeof row.data !== 'string') throw new Error('not text');
          value = JSON.parse(row.data);
        } catch {
          throw new Error(`Schéma ${table}: data JSON invalide (id ${row.id})`);
        }
        if (!value || Array.isArray(value) || typeof value !== 'object') {
          throw new Error(`Schéma ${table}: data doit être un objet JSON (id ${row.id})`);
        }
        const required = table === 'suivis' ? 'titre' : 'nom';
        if (typeof value[required] !== 'string' ||
            (table === 'primes' && !Array.isArray(value.specialites))) {
          throw new Error(`Schéma ${table}: data sans champs requis (id ${row.id})`);
        }
      }
      sqlite.prepare(`UPDATE ${table} SET updated_at = COALESCE(created_at, datetime('now')) WHERE updated_at IS NULL`).run();
    }
    return legacy;
  })();
}
