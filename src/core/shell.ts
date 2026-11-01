/** App chrome: frosted top bar with module tabs, data status and refresh. */
import type { CoreContext, ModuleContext, SourceStatus } from './context';
import { errorBox, h, replace, toast } from './dom';
import { glyph } from './icons';
import { routeOf, type AppModule, type Registry } from './registry';
import { createStorage } from './runtime';

const WORLDSTATE_POLL_MS = 120_000;
const STATUS_SOURCES = ['catalog', 'droptables'];

function routeFromHash(): string {
  return decodeURIComponent(location.hash.replace(/^#\/?/, '').split('/')[0] ?? '');
}

function describeStatus(sources: readonly SourceStatus[]): { text: string; error: boolean } {
  const relevant = sources.filter((s) => STATUS_SOURCES.includes(s.id));
  const failed = relevant.find((s) => s.error);
  if (failed) return { text: `Ошибка: ${failed.title}`, error: true };
  const dates = relevant.map((s) => s.fetchedAt).filter((d): d is string => Boolean(d)).sort();
  if (dates.length === 0) return { text: 'Данные ещё не загружены', error: false };
  const date = new Date(dates[0]).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  return { text: `Данные от ${date}`, error: false };
}

export function startShell(root: HTMLElement, registry: Registry, core: CoreContext, startupErrors: readonly string[]): void {
  const tabs = h('nav', { class: 'segmented', 'aria-label': 'Модули' });
  const status = h('span', { class: 'status' }, '');
  const refreshLabel = h('span', {}, 'Обновить данные');
  const refresh = h('button', { class: 'btn secondary', type: 'button' }, glyph('refresh', 15), refreshLabel);
  const content = h('main', {});
  root.append(
    h('header', { class: 'topbar' },
      h('div', { class: 'brand' }, glyph('logo', 20), 'Warframe', h('span', {}, 'Companion')),
      tabs,
      h('div', { class: 'topbar-right' }, status, refresh)),
    content,
  );

  let cleanup: (() => void) | undefined;
  let current: AppModule | undefined;

  const updateStatus = async () => {
    try {
      const described = describeStatus(await core.data.status());
      status.textContent = described.text;
      status.classList.toggle('error', described.error);
    } catch (error) {
      status.textContent = 'Локальный сервер недоступен';
      status.classList.add('error');
      console.error('[shell] status', error);
    }
  };

  const mount = (module: AppModule) => {
    cleanup?.();
    cleanup = undefined;
    current = module;
    replace(tabs, ...registry.modules.map((m) => h('button', {
      type: 'button',
      class: m.id === module.id ? 'active' : '',
      title: m.description,
      on: { click: () => { location.hash = `#/${routeOf(m)}`; } },
    }, glyph(m.icon ?? 'spark', 15), m.title)));
    const view = h('section', {});
    replace(content, ...startupErrors.map((e) => errorBox(e)), view);
    const ctx: ModuleContext = { ...core, storage: createStorage(module.id), navigate: (route) => { location.hash = `#/${route}`; } };
    try {
      const result = module.mount(view, ctx);
      cleanup = typeof result === 'function' ? result : undefined;
    } catch (error) {
      console.error(`[module:${module.id}]`, error);
      replace(view, errorBox(`Модуль «${module.title}» не смог запуститься: ${(error as Error).message}`));
    }
    void updateStatus();
  };

  refresh.addEventListener('click', async () => {
    refresh.disabled = true;
    refreshLabel.textContent = 'Обновляю…';
    try {
      await core.data.refreshAll();
      core.events.emit('data:refreshed', null);
      toast('Данные обновлены');
      if (current) mount(current);
    } catch (error) {
      toast(`Не удалось обновить: ${(error as Error).message}`);
    } finally {
      refresh.disabled = false;
      refreshLabel.textContent = 'Обновить данные';
    }
  });

  const pollWorldState = async () => {
    try {
      const result = await core.data.source('worldstate', { refresh: true });
      core.events.emit('worldstate:updated', result.data);
    } catch (error) {
      console.warn('[shell] worldstate', (error as Error).message);
    }
  };
  setInterval(pollWorldState, WORLDSTATE_POLL_MS);

  window.addEventListener('hashchange', () => mount(registry.resolve(routeFromHash())));
  mount(registry.resolve(routeFromHash()));
}
