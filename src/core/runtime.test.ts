import { describe, expect, it, vi } from 'vitest';
import { createDataApi, createEventBus, createServices, createStorage, type StorageBackend } from './runtime';

function fakeFetch(responses: Record<string, { status?: number; body: unknown }>) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url}`;
    const response = responses[key];
    if (!response) throw new Error(`unexpected ${key}`);
    return new Response(JSON.stringify(response.body), { status: response.status ?? 200 });
  });
}

describe('createDataApi', () => {
  it('fetches a source and memoizes it', async () => {
    const fetchFn = fakeFetch({ 'GET /api/source/catalog': { body: { id: 'catalog', data: 1 } } });
    const api = createDataApi(fetchFn);
    await api.source('catalog');
    const result = await api.source('catalog');
    expect(result.data).toBe(1);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('encodes ids and passes the refresh flag', async () => {
    const fetchFn = fakeFetch({ 'GET /api/source/market%3Aorders%3Aserration?refresh=1': { body: { data: 2 } } });
    expect((await createDataApi(fetchFn).source('market:orders:serration', { refresh: true })).data).toBe(2);
  });

  it('surfaces the server error message', async () => {
    const fetchFn = fakeFetch({ 'GET /api/source/x': { status: 502, body: { error: 'Источник недоступен' } } });
    await expect(createDataApi(fetchFn).source('x')).rejects.toThrow('Источник недоступен');
  });

  it('does not cache failures', async () => {
    let calls = 0;
    const fetchFn = vi.fn(async () => {
      calls += 1;
      return calls === 1 ? new Response('{"error":"boom"}', { status: 502 }) : new Response('{"data":3}');
    });
    const api = createDataApi(fetchFn);
    await expect(api.source('y')).rejects.toThrow('boom');
    expect((await api.source('y')).data).toBe(3);
  });

  it('refreshes everything and forgets memoized sources', async () => {
    const fetchFn = fakeFetch({
      'GET /api/source/a': { body: { data: 1 } },
      'POST /api/refresh': { body: { sources: [{ id: 'a', title: 'A' }] } },
    });
    const api = createDataApi(fetchFn);
    await api.source('a');
    expect(await api.refreshAll()).toEqual([{ id: 'a', title: 'A' }]);
    await api.source('a');
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('reads status', async () => {
    const fetchFn = fakeFetch({ 'GET /api/status': { body: { sources: [] } } });
    expect(await createDataApi(fetchFn).status()).toEqual([]);
  });
});

describe('createStorage', () => {
  function memoryBackend(): StorageBackend & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
  }

  it('namespaces keys per module', () => {
    const backend = memoryBackend();
    createStorage('farm', backend).set('goal', { id: 1 });
    expect(backend.data.get('wfc:farm:goal')).toBe('{"id":1}');
    expect(createStorage('farm', backend).get('goal', null)).toEqual({ id: 1 });
  });

  it('returns the fallback for missing or broken values', () => {
    const backend = memoryBackend();
    backend.data.set('wfc:x:bad', '{nope');
    const storage = createStorage('x', backend);
    expect(storage.get('missing', 5)).toBe(5);
    expect(storage.get('bad', 'fallback')).toBe('fallback');
  });

  it('survives a backend that throws', () => {
    const broken: StorageBackend = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); } };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const storage = createStorage('x', broken);
    expect(storage.get('k', 1)).toBe(1);
    expect(() => storage.set('k', 2)).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('createEventBus', () => {
  it('delivers events until unsubscribed', () => {
    const bus = createEventBus();
    const handler = vi.fn();
    const off = bus.on('data:refreshed', handler);
    bus.emit('data:refreshed', 1);
    off();
    bus.emit('data:refreshed', 2);
    expect(handler).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('keeps notifying other handlers when one throws', () => {
    const bus = createEventBus();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const good = vi.fn();
    bus.on('e', () => { throw new Error('bad handler'); });
    bus.on('e', good);
    bus.emit('e', null);
    expect(good).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe('createServices', () => {
  it('provides and resolves services by name', () => {
    const services = createServices();
    services.provide('market.prices', { ok: true });
    expect(services.get('market.prices')).toEqual({ ok: true });
    expect(services.get('missing')).toBeUndefined();
  });

  it('refuses to silently replace a service', () => {
    const services = createServices();
    services.provide('a', 1);
    expect(() => services.provide('a', 2)).toThrow(/a/);
  });
});
