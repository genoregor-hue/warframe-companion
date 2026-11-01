import { describe, expect, it } from 'vitest';
import { emptyLibrary, metaWeights, recordBuild } from './metaLearning';

describe('recordBuild', () => {
  it('counts builds and mod usage per group without mutating the library', () => {
    const empty = emptyLibrary();
    const once = recordBuild(empty, { group: 'Rifle', itemId: '/W/Soma', mods: ['/M/Serration', '/M/Hunter'], source: 'overframe', score: 100 });
    expect(empty.groups).toEqual({});
    expect(once.groups.Rifle).toEqual({ builds: 1, mods: { '/M/Serration': 1, '/M/Hunter': 1 } });
    expect(once.builds).toHaveLength(1);
  });

  it('ignores duplicate mods in one build', () => {
    const lib = recordBuild(emptyLibrary(), { group: 'Rifle', itemId: '/W/Soma', mods: ['/M/A', '/M/A'], source: 'manual', score: 1 });
    expect(lib.groups.Rifle.mods['/M/A']).toBe(1);
  });

  it('keeps only the newest builds in history', () => {
    let lib = emptyLibrary();
    for (let i = 0; i < 205; i += 1) lib = recordBuild(lib, { group: 'Rifle', itemId: `/W/${i}`, mods: [], source: 'manual', score: i });
    expect(lib.builds).toHaveLength(200);
    expect(lib.builds[0].itemId).toBe('/W/204');
  });
});

describe('metaWeights', () => {
  it('turns usage frequency into small score bonuses for mods with unmodelled effects', () => {
    let lib = emptyLibrary();
    lib = recordBuild(lib, { group: 'Rifle', itemId: '/W/1', mods: ['/M/Hunter', '/M/Serration'], source: 'overframe', score: 1 });
    lib = recordBuild(lib, { group: 'Rifle', itemId: '/W/2', mods: ['/M/Hunter'], source: 'overframe', score: 1 });
    const weights = metaWeights(lib, 'Rifle', (id) => id === '/M/Hunter');
    expect(weights['/M/Hunter']).toBeCloseTo(0.08);
    expect(weights['/M/Serration']).toBeUndefined();
  });

  it('needs a few builds before it trusts the statistics', () => {
    const lib = recordBuild(emptyLibrary(), { group: 'Rifle', itemId: '/W/1', mods: ['/M/Hunter'], source: 'overframe', score: 1 });
    expect(metaWeights(lib, 'Rifle', () => true, 2)).toEqual({});
    expect(metaWeights(emptyLibrary(), 'Rifle', () => true)).toEqual({});
  });
});
