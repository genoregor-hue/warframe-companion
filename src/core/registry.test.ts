import { describe, expect, it } from 'vitest';
import { collectModules, createRegistry, defineModule } from './registry';

const mount = () => undefined;

describe('createRegistry', () => {
  it('sorts modules by order then title', () => {
    const registry = createRegistry([
      defineModule({ id: 'b', title: 'Б', order: 2, mount }),
      defineModule({ id: 'a', title: 'А', order: 1, mount }),
      defineModule({ id: 'c', title: 'В', mount }),
    ]);
    expect(registry.modules.map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('finds a module by route and falls back to the first one', () => {
    const registry = createRegistry([defineModule({ id: 'farm', title: 'Фарм', order: 1, mount }), defineModule({ id: 'calc', title: 'Калькулятор', route: 'builds', order: 2, mount })]);
    expect(registry.resolve('builds').id).toBe('calc');
    expect(registry.resolve('nope').id).toBe('farm');
  });

  it('rejects duplicate ids', () => {
    expect(() => createRegistry([defineModule({ id: 'x', title: 'X', mount }), defineModule({ id: 'x', title: 'Y', mount })])).toThrow(/x/);
  });

  it('rejects invalid ids', () => {
    expect(() => createRegistry([defineModule({ id: 'Bad Id', title: 'X', mount })])).toThrow(/Bad Id/);
  });

  it('requires at least one module', () => {
    expect(() => createRegistry([])).toThrow();
  });

  it('does not let callers mutate the module list', () => {
    const registry = createRegistry([defineModule({ id: 'a', title: 'A', mount })]);
    expect(Object.isFrozen(registry.modules)).toBe(true);
  });
});

describe('collectModules', () => {
  it('takes default exports from discovered files and reports broken ones', () => {
    const good = defineModule({ id: 'good', title: 'Хороший', mount });
    const { modules, errors } = collectModules({
      './modules/good/index.ts': { default: good },
      './modules/bad/index.ts': { default: { id: 'bad' } },
      './modules/empty/index.ts': {},
    });
    expect(modules).toEqual([good]);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('bad');
  });
});
