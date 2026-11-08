import { AsyncLocalStorage } from 'node:async_hooks';

// better-sqlite3 is synchronous, but onboarding deliberately awaits between
// statements. An unrelated synchronous DB API must never join that transaction.
const ownerContext = new AsyncLocalStorage();
let owner = null;
const blocked = () => new Error('SQLite transaction isolation: another operation owns this connection');

export function guardSqlite(sqlite) {
  const check = () => { if (owner && ownerContext.getStore() !== owner) throw blocked(); };
  // Native Statement.database and Iterator.statement are non-configurable,
  // non-writable own properties. A Proxy over the native object cannot replace
  // their values without violating Proxy invariants; use a facade target.
  const handles = new WeakMap();
  const guardedValue = value => handles.get(value) ?? value;
  const handle = (raw, kind) => {
    if (handles.has(raw)) return handles.get(raw);
    const proxy = new Proxy({}, {
      get(_facade, key) {
        const value = Reflect.get(raw, key, raw);
        if (typeof value !== 'function') return guardedValue(value);
        return (...args) => {
          check();
          const result = value.apply(raw, args);
          if (result === raw) return proxy;
          if (kind === 'connection' && key === 'prepare') return handle(result, 'statement');
          if (kind === 'connection' && key === 'transaction') return transaction(result);
          if (kind === 'statement' && key === 'iterate') return handle(result, 'iterator');
          return guardedValue(result);
        };
      },
      set(_facade, key, value) { check(); return Reflect.set(raw, key, value, raw); },
      getPrototypeOf() { return Reflect.getPrototypeOf(raw); },
      has(_facade, key) { return Reflect.has(raw, key); },
      ownKeys() { return Reflect.ownKeys(raw); },
      getOwnPropertyDescriptor(_facade, key) {
        const descriptor = Reflect.getOwnPropertyDescriptor(raw, key);
        if (!descriptor) return undefined;
        // The facade is extensible, so reflection can safely expose the
        // guarded handle rather than a native non-configurable raw value.
        if ('value' in descriptor) return { ...descriptor, value: guardedValue(descriptor.value), configurable: true };
        return {
          ...descriptor,
          configurable: true,
          get: descriptor.get && (() => guardedValue(descriptor.get.call(raw))),
          set: descriptor.set && (value => { check(); descriptor.set.call(raw, value); }),
        };
      },
    });
    handles.set(raw, proxy);
    return proxy;
  };
  const transaction = fn => {
    const wrapped = (...args) => { check(); return fn(...args); };
    for (const mode of ['default', 'deferred', 'immediate', 'exclusive']) {
      wrapped[mode] = (...args) => { check(); return fn[mode](...args); };
    }
    return wrapped;
  };
  return handle(sqlite, 'connection');
}

export function withSqliteOwner(fn) {
  const token = {};
  if (owner) throw blocked();
  owner = token;
  return ownerContext.run(token, async () => {
    try { return await fn(); }
    finally { owner = null; }
  });
}
