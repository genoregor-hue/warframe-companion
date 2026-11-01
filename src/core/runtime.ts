import type { DataApi, EventBus, EventHandler, ModuleStorage, Services, SourceResult, SourceStatus } from './context';

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Сервер ответил ${response.status}`);
  return body as T;
}

/** Client side of the shared data layer (see server/plugin.ts). */
export function createDataApi(fetchFn: FetchFn = (url, init) => fetch(url, init)): DataApi {
  let memo = new Map<string, Promise<SourceResult>>();

  function source<T>(id: string, options: { refresh?: boolean } = {}): Promise<SourceResult<T>> {
    const cached = memo.get(id);
    if (cached && !options.refresh) return cached as Promise<SourceResult<T>>;
    const url = `/api/source/${encodeURIComponent(id)}${options.refresh ? '?refresh=1' : ''}`;
    const pending = fetchFn(url).then((r) => readJson<SourceResult<T>>(r));
    const next = new Map(memo);
    next.set(id, pending);
    memo = next;
    pending.catch(() => {
      if (memo.get(id) === pending) memo = new Map([...memo].filter(([key]) => key !== id));
    });
    return pending;
  }

  async function refreshAll(): Promise<readonly SourceStatus[]> {
    const { sources } = await readJson<{ sources: SourceStatus[] }>(await fetchFn('/api/refresh', { method: 'POST' }));
    memo = new Map();
    return sources;
  }

  async function status(): Promise<readonly SourceStatus[]> {
    return (await readJson<{ sources: SourceStatus[] }>(await fetchFn('/api/status'))).sources;
  }

  return { source, refreshAll, status };
}

export interface StorageBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STORAGE_PREFIX = 'wfc';

export function createStorage(namespace: string, backend: StorageBackend = localStorage): ModuleStorage {
  const key = (name: string) => `${STORAGE_PREFIX}:${namespace}:${name}`;
  return {
    get<T>(name: string, fallback: T): T {
      try {
        const raw = backend.getItem(key(name));
        return raw === null ? fallback : (JSON.parse(raw) as T);
      } catch (error) {
        console.warn(`[storage] не удалось прочитать ${key(name)}:`, (error as Error).message);
        return fallback;
      }
    },
    set<T>(name: string, value: T): void {
      try {
        backend.setItem(key(name), JSON.stringify(value));
      } catch (error) {
        console.warn(`[storage] не удалось сохранить ${key(name)}:`, (error as Error).message);
      }
    },
  };
}

export function createEventBus(): EventBus {
  let handlers = new Map<string, readonly EventHandler[]>();
  return {
    on<T>(type: string, handler: EventHandler<T>) {
      handlers = new Map(handlers).set(type, [...(handlers.get(type) ?? []), handler as EventHandler]);
      return () => {
        handlers = new Map(handlers).set(type, (handlers.get(type) ?? []).filter((h) => h !== handler));
      };
    },
    emit<T>(type: string, payload: T) {
      for (const handler of handlers.get(type) ?? []) {
        try {
          handler(payload);
        } catch (error) {
          console.error(`[events] обработчик «${type}» упал:`, error);
        }
      }
    },
  };
}

export function createServices(): Services {
  const registry = new Map<string, unknown>();
  return {
    provide<T>(name: string, service: T) {
      if (registry.has(name)) throw new Error(`Сервис «${name}» уже предоставлен другим модулем`);
      registry.set(name, service);
    },
    get: <T>(name: string) => registry.get(name) as T | undefined,
  };
}
