/** What every module receives from the core. Kept small on purpose. */

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

/** Shared data layer: every source is cached on disk by the local server. */
export interface DataApi {
  source<T>(id: string, options?: { refresh?: boolean }): Promise<SourceResult<T>>;
  refreshAll(): Promise<readonly SourceStatus[]>;
  status(): Promise<readonly SourceStatus[]>;
}

/** Per-module localStorage namespace. */
export interface ModuleStorage {
  get<T>(key: string, fallback: T): T;
  set<T>(key: string, value: T): void;
}

export type EventHandler<T = unknown> = (payload: T) => void;

/** Cross-module events, e.g. 'data:refreshed', 'worldstate:updated'. */
export interface EventBus {
  on<T>(type: string, handler: EventHandler<T>): () => void;
  emit<T>(type: string, payload: T): void;
}

/** Optional capabilities one module offers to others, e.g. 'market.prices'. */
export interface Services {
  provide<T>(name: string, service: T): void;
  get<T>(name: string): T | undefined;
}

export interface CoreContext {
  readonly data: DataApi;
  readonly events: EventBus;
  readonly services: Services;
}

export interface ModuleContext extends CoreContext {
  readonly storage: ModuleStorage;
  navigate(route: string): void;
}
