'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');

function createPostgresStore({ repository, tenantId } = {}) {
  if (!repository || typeof repository.withTenant !== 'function') {
    throw new TypeError('A PostgreSQL tenant repository is required.');
  }
  if (typeof tenantId !== 'string' || !tenantId.trim()) {
    throw new TypeError('A server-configured tenant ID is required.');
  }

  const context = new AsyncLocalStorage();
  const stateProxy = new Proxy(Object.create(null), {
    get(_target, key) {
      const active = context.getStore();
      if (!active) throw new Error('PostgreSQL store accessed outside a tenant request.');
      return active.state[key];
    },
    set(_target, key, value) {
      const active = context.getStore();
      if (!active) throw new Error('PostgreSQL store accessed outside a tenant request.');
      active.state[key] = value;
      active.dirty = true;
      return true;
    },
    ownKeys() {
      const active = context.getStore();
      if (!active) throw new Error('PostgreSQL store accessed outside a tenant request.');
      return Reflect.ownKeys(active.state);
    },
    getOwnPropertyDescriptor(_target, key) {
      const active = context.getStore();
      if (!active) throw new Error('PostgreSQL store accessed outside a tenant request.');
      if (!Object.prototype.hasOwnProperty.call(active.state, key)) return undefined;
      return { configurable: true, enumerable: true, writable: true, value: active.state[key] };
    }
  });

  const store = {
    db: stateProxy,
    async runInTenant(work, selectedTenantId = tenantId) {
      if (typeof work !== 'function') throw new TypeError('A request callback is required.');
      if (typeof selectedTenantId !== 'string' || !selectedTenantId.trim()) throw new TypeError('A verified tenant ID is required.');
      return repository.withTenant(selectedTenantId, async (tx) => {
        const active = { state: tx.state, dirty: false };
        return context.run(active, async () => {
          let result;
          let failure;
          try {
            result = await work();
          } catch (error) {
            failure = error;
          }
          if (active.dirty) await tx.save(active.state);
          if (failure) throw failure;
          return result;
        });
      });
    },
    save() {
      const active = context.getStore();
      if (!active) throw new Error('PostgreSQL store save called outside a tenant request.');
      active.dirty = true;
    },
    async close() {
      if (typeof repository.close === 'function') await repository.close();
    }
  };
  return Object.freeze(store);
}

module.exports = { createPostgresStore };
