import type { DiskCache } from './cache';

/** Something a source loader can use: other sources by id. */
export interface SourceContext {
  get<T>(id: string): Promise<T>;
}

export interface SourceDef<T = unknown> {
  readonly id: string;
  /** Makes this a family of sources, e.g. /^market:orders:([a-z0-9_]+)$/; `load` gets the concrete id. */
  readonly idPattern?: RegExp;
  /** Short Russian description shown in the data status panel. */
  readonly title: string;
  /** How long cached data is fresh. Infinity = only on manual refresh. */
  readonly ttlMs: number;
  /** Static sources are re-fetched by the "Обновить данные" button. */
  readonly refreshable?: boolean;
  load(ctx: SourceContext, id: string): Promise<T>;
}

export interface SourceResult<T = unknown> {
  readonly id: string;
  readonly fetchedAt: string;
  readonly stale: boolean;
  readonly error?: string;
  readonly data: T;
}

export interface SourceStatus {
  readonly id: string;
  readonly title: string;
  readonly fetchedAt?: string;
  readonly error?: string;
}

export function defineSource<T>(def: SourceDef<T>): SourceDef<T> {
  return def;
}

interface HubOptions {
  readonly cache: DiskCache;
  readonly now?: () => number;
  readonly onRefreshStart?: () => void;
}

export function createSourceHub(defs: readonly SourceDef[], { cache, now = Date.now, onRefreshStart }: HubOptions) {
  const byId = new Map(defs.filter((def) => !def.idPattern).map((def) => [def.id, def]));
  const families = defs.filter((def) => def.idPattern);
  const memory = new Map<string, SourceResult>();
  const inflight = new Map<string, Promise<SourceResult>>();
  const lastErrors = new Map<string, string>();
  let forced: ReadonlySet<string> = new Set<string>();

  const ctx: SourceContext = { get: async <T>(id: string) => (await get<T>(id)).data };

  function isFresh(def: SourceDef, fetchedAt: string): boolean {
    return now() - Date.parse(fetchedAt) < def.ttlMs;
  }

  async function cached(id: string): Promise<SourceResult | undefined> {
    const inMemory = memory.get(id);
    if (inMemory) return inMemory;
    const onDisk = await cache.read(id);
    if (!onDisk) return undefined;
    const result: SourceResult = { id, fetchedAt: onDisk.fetchedAt, stale: false, data: onDisk.data };
    memory.set(id, result);
    return result;
  }

  function resolve(id: string): SourceDef | undefined {
    const direct = byId.get(id);
    if (direct) return direct;
    const family = families.find((def) => def.idPattern?.test(id));
    return family ? { ...family, id } : undefined;
  }

  async function load(def: SourceDef, refresh: boolean): Promise<SourceResult> {
    const previous = await cached(def.id);
    if (previous && !refresh && isFresh(def, previous.fetchedAt)) return previous;
    try {
      const data = await def.load(ctx, def.id);
      const stored = await cache.write(def.id, data, new Date(now()));
      const result: SourceResult = { id: def.id, fetchedAt: stored.fetchedAt, stale: false, data };
      memory.set(def.id, result);
      lastErrors.delete(def.id);
      return result;
    } catch (error) {
      const message = (error as Error).message ?? String(error);
      lastErrors.set(def.id, message);
      console.error(`[source:${def.id}]`, message);
      if (previous) return { ...previous, stale: true, error: message };
      throw new Error(`Источник «${def.title}» недоступен: ${message}`);
    }
  }

  function get<T>(id: string, options: { refresh?: boolean } = {}): Promise<SourceResult<T>> {
    const def = resolve(id);
    if (!def) return Promise.reject(new Error(`Неизвестный источник данных: ${id}`));
    const refresh = Boolean(options.refresh) || forced.has(id);
    const running = inflight.get(id);
    if (running && !refresh) return running as Promise<SourceResult<T>>;
    forced = new Set([...forced].filter((other) => other !== id));
    const pending = load(def, refresh).finally(() => inflight.delete(id));
    inflight.set(id, pending);
    return pending as Promise<SourceResult<T>>;
  }

  /**
   * Re-fetch every refreshable source that is in use. All refreshable ids are
   * marked, so a dependency pulled in by a dependant is re-fetched as well.
   */
  async function refreshAll(): Promise<readonly SourceStatus[]> {
    onRefreshStart?.();
    const refreshable = [...byId.values()].filter((def) => def.refreshable).map((def) => def.id);
    forced = new Set(refreshable);
    for (const id of refreshable) {
      const inUse = memory.has(id) || (await cache.read(id)) !== undefined;
      if (inUse && forced.has(id)) await get(id).catch(() => undefined);
    }
    return status();
  }

  /** Includes sources that are only on disk so far (e.g. right after a restart). */
  async function status(): Promise<readonly SourceStatus[]> {
    return Promise.all([...byId.values()].map(async (def) => ({
      id: def.id,
      title: def.title,
      fetchedAt: memory.get(def.id)?.fetchedAt ?? (await cache.read(def.id))?.fetchedAt,
      error: lastErrors.get(def.id),
    })));
  }

  return { get, refreshAll, status, has: (id: string) => resolve(id) !== undefined };
}

export type SourceHub = ReturnType<typeof createSourceHub>;
