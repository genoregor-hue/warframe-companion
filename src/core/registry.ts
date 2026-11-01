import type { CoreContext, ModuleContext } from './context';

/**
 * A feature module (tab). Drop a folder into src/modules/<id>/ with an
 * index.ts that default-exports defineModule({...}) and it is picked up.
 */
export interface AppModule {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  /** Icon name from core/icons.ts (e.g. 'farm', 'market', 'spark') shown next to the tab title. */
  readonly icon?: string;
  /** Hash route, defaults to the id: #/<route>. */
  readonly route?: string;
  /** Lower numbers come first. */
  readonly order?: number;
  /** Runs once at startup for every module, e.g. to provide services or subscribe to events. */
  setup?(core: CoreContext): void;
  /** Render into `root`. Return a cleanup function if the module holds timers or listeners. */
  mount(root: HTMLElement, ctx: ModuleContext): void | (() => void);
}

export interface Registry {
  readonly modules: readonly AppModule[];
  resolve(route: string): AppModule;
}

const ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const DEFAULT_ORDER = 100;

export function defineModule(module: AppModule): AppModule {
  return Object.freeze({ ...module });
}

export const routeOf = (module: AppModule): string => module.route ?? module.id;

export function createRegistry(modules: readonly AppModule[]): Registry {
  if (modules.length === 0) throw new Error('Не найдено ни одного модуля в src/modules');
  const seen = new Set<string>();
  for (const module of modules) {
    if (!ID_PATTERN.test(module.id)) throw new Error(`Некорректный id модуля «${module.id}»: только a-z, 0-9 и дефис`);
    if (seen.has(module.id)) throw new Error(`Модуль с id «${module.id}» зарегистрирован дважды`);
    seen.add(module.id);
  }
  const sorted = Object.freeze(
    [...modules].sort((a, b) => (a.order ?? DEFAULT_ORDER) - (b.order ?? DEFAULT_ORDER) || a.title.localeCompare(b.title, 'ru')),
  );
  return {
    modules: sorted,
    resolve: (route) => sorted.find((m) => routeOf(m) === route) ?? sorted[0],
  };
}

function isModule(value: unknown): value is AppModule {
  const candidate = value as Partial<AppModule> | undefined;
  return typeof candidate?.id === 'string' && typeof candidate.title === 'string' && typeof candidate.mount === 'function';
}

/** Accepts the result of import.meta.glob('./modules/*\/index.ts', { eager: true }). */
export function collectModules(found: Readonly<Record<string, unknown>>): { modules: AppModule[]; errors: string[] } {
  const modules: AppModule[] = [];
  const errors: string[] = [];
  for (const [path, exports] of Object.entries(found)) {
    const candidate = (exports as { default?: unknown } | undefined)?.default;
    if (isModule(candidate)) modules.push(candidate);
    else errors.push(`${path}: default export должен быть defineModule({ id, title, mount })`);
  }
  return { modules, errors };
}
