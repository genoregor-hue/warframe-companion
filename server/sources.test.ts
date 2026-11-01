import { describe, expect, it, vi } from 'vitest';
import type { CachedValue, DiskCache } from './cache';
import { createSourceHub, defineSource } from './sources';

function memoryCache(initial: Record<string, CachedValue> = {}): DiskCache {
  const store = new Map(Object.entries(initial));
  return {
    read: async <T>(id: string) => store.get(id) as CachedValue<T> | undefined,
    write: async <T>(id: string, data: T, now = new Date()) => {
      const value = { id, fetchedAt: now.toISOString(), data };
      store.set(id, value);
      return value;
    },
  };
}

const T0 = Date.parse('2026-10-30T12:00:00Z');

describe('createSourceHub', () => {
  it('loads a source once and serves it from memory afterwards', async () => {
    const load = vi.fn(async () => 42);
    const hub = createSourceHub([defineSource({ id: 'a', title: 'A', ttlMs: Infinity, load })], { cache: memoryCache(), now: () => T0 });
    expect((await hub.get('a')).data).toBe(42);
    expect((await hub.get('a')).data).toBe(42);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('uses the disk cache while it is fresh', async () => {
    const load = vi.fn(async () => 'new');
    const cache = memoryCache({ w: { id: 'w', fetchedAt: new Date(T0 - 1_000).toISOString(), data: 'old' } });
    const hub = createSourceHub([defineSource({ id: 'w', title: 'W', ttlMs: 60_000, load })], { cache, now: () => T0 });
    expect((await hub.get('w')).data).toBe('old');
    expect(load).not.toHaveBeenCalled();
  });

  it('reloads when the ttl has passed', async () => {
    const cache = memoryCache({ w: { id: 'w', fetchedAt: new Date(T0 - 120_000).toISOString(), data: 'old' } });
    const hub = createSourceHub([defineSource({ id: 'w', title: 'W', ttlMs: 60_000, load: async () => 'new' })], { cache, now: () => T0 });
    expect((await hub.get('w')).data).toBe('new');
  });

  it('falls back to stale data when loading fails', async () => {
    const cache = memoryCache({ w: { id: 'w', fetchedAt: new Date(T0 - 120_000).toISOString(), data: 'old' } });
    const hub = createSourceHub([defineSource({ id: 'w', title: 'W', ttlMs: 60_000, load: async () => { throw new Error('offline'); } })], { cache, now: () => T0 });
    const result = await hub.get('w');
    expect(result).toMatchObject({ data: 'old', stale: true, error: 'offline' });
    expect((await hub.status())[0].error).toBe('offline');
  });

  it('reports the cache date of sources not loaded yet', async () => {
    const cache = memoryCache({ w: { id: 'w', fetchedAt: '2026-10-30T10:00:00.000Z', data: 1 } });
    const hub = createSourceHub([defineSource({ id: 'w', title: 'W', ttlMs: Infinity, load: async () => 2 })], { cache, now: () => T0 });
    expect((await hub.status())[0].fetchedAt).toBe('2026-10-30T10:00:00.000Z');
  });

  it('explains which source failed when nothing is cached', async () => {
    const hub = createSourceHub([defineSource({ id: 'w', title: 'Мир', ttlMs: 1, load: async () => { throw new Error('offline'); } })], { cache: memoryCache(), now: () => T0 });
    await expect(hub.get('w')).rejects.toThrow(/Мир.*offline/);
  });

  it('rejects unknown ids', async () => {
    const hub = createSourceHub([], { cache: memoryCache() });
    await expect(hub.get('nope')).rejects.toThrow(/nope/);
    expect(hub.has('nope')).toBe(false);
  });

  it('refreshes used sources and their dependencies on refreshAll', async () => {
    let version = 1;
    const onRefreshStart = vi.fn();
    const hub = createSourceHub([
      defineSource({ id: 'raw', title: 'Raw', ttlMs: Infinity, refreshable: true, load: async () => version }),
      defineSource({ id: 'derived', title: 'Derived', ttlMs: Infinity, refreshable: true, load: async (ctx) => (await ctx.get<number>('raw')) * 10 }),
      defineSource({ id: 'unused', title: 'Unused', ttlMs: Infinity, refreshable: true, load: async () => { throw new Error('should not load'); } }),
    ], { cache: memoryCache(), now: () => T0, onRefreshStart });
    expect((await hub.get('derived')).data).toBe(10);
    version = 2;
    await hub.refreshAll();
    expect((await hub.get('derived')).data).toBe(20);
    expect(onRefreshStart).toHaveBeenCalledOnce();
  });

  it('serves parameterized sources through an id pattern', async () => {
    const hub = createSourceHub([
      defineSource({ id: 'orders:*', idPattern: /^orders:([a-z_]+)$/, title: 'Заказы', ttlMs: 60_000, load: async (_ctx, id) => `for ${id}` }),
    ], { cache: memoryCache(), now: () => T0 });
    expect(hub.has('orders:serration')).toBe(true);
    expect(hub.has('orders:BAD!')).toBe(false);
    expect((await hub.get('orders:serration')).data).toBe('for orders:serration');
  });
});
