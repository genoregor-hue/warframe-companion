import './styles.css';
import { errorBox } from './core/dom';
import { collectModules, createRegistry } from './core/registry';
import { createDataApi, createEventBus, createServices } from './core/runtime';
import { startShell } from './core/shell';

/** Every src/modules/<id>/index.ts is a module; adding a folder adds a tab. */
const discovered = import.meta.glob('./modules/*/index.ts', { eager: true });

const root = document.getElementById('app');
if (!root) throw new Error('В index.html нет элемента #app');

try {
  const { modules, errors } = collectModules(discovered);
  const core = { data: createDataApi(), events: createEventBus(), services: createServices() };
  const registry = createRegistry(modules);
  for (const module of registry.modules) {
    try {
      module.setup?.(core);
    } catch (error) {
      errors.push(`Модуль «${module.title}»: ошибка при запуске — ${(error as Error).message}`);
    }
  }
  startShell(root, registry, core, errors);
} catch (error) {
  console.error('[main]', error);
  root.replaceChildren(errorBox(`Приложение не запустилось: ${(error as Error).message}`));
}
