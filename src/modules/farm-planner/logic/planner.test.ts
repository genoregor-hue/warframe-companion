import { describe, expect, it } from 'vitest';
import type { Catalog } from '../../../data/catalog';
import type { DropEntry } from '../../../data/dropTables';
import type { WorldState } from '../../../data/worldstate';
import { buildPlan, expectedRuns, indexDrops, listTargets, runsFor } from './planner';

const n = (en: string, ru = en) => ({ en, ru });
const BARREL = '/Lotus/Types/Recipes/Weapons/WeaponParts/SomaPrimeBarrel';
const BP = '/Lotus/Types/Recipes/Weapons/SomaPrimeBlueprint';

const CATALOG: Catalog = {
  weapons: [{ uniqueName: '/W/SomaPrime', name: n('Soma Prime', 'Сома Прайм'), category: 'primary', weaponClass: 'Rifle', damage: [], critChance: 0, critMultiplier: 1, statusChance: 0, fireRate: 1, multishot: 1, magazine: 0, reload: 0, masteryReq: 0 }],
  frames: [],
  mods: [{ uniqueName: '/Mods/Serration', name: n('Serration', 'Зазубрины'), polarity: '', rarity: '', baseDrain: 4, fusionLimit: 10, type: 'PRIMARY', compatName: 'Rifle', isUtility: false, family: '', stats: [], statsRu: [] }],
  arcanes: [],
  relics: [
    { name: n('Axi S1 Relic', 'Акси S1'), tier: 'Axi', uniqueNames: ['/R/AxiS1Bronze', '/R/AxiS1Gold'], rewards: [] },
    { name: n('Lith S2 Relic', 'Лит S2'), tier: 'Lith', uniqueNames: ['/R/LithS2Bronze'], rewards: [] },
  ],
  recipes: [{ uniqueName: BP, resultType: '/W/SomaPrime', ingredients: [{ uniqueName: BARREL, count: 1 }, { uniqueName: '/Res/OrokinCell', count: 10 }] }],
  images: {},
  names: { [BARREL]: n('Soma Prime Barrel', 'Ствол Сомы Прайм'), '/Res/OrokinCell': n('Orokin Cell', 'Клетка Орокин'), '/W/SomaPrime': n('Soma Prime', 'Сома Прайм') },
};

const drop = (item: string, kind: DropEntry['kind'], source: string, chance: number, extra: Partial<DropEntry> = {}): DropEntry => ({ item, kind, source, chance, rarity: 'Rare', ...extra });

const DROPS = indexDrops([
  drop('Soma Prime Barrel', 'relic', 'Axi S1 Relic', 0.02, { refinement: 'Intact' }),
  drop('Soma Prime Barrel', 'relic', 'Axi S1 Relic', 0.1, { refinement: 'Radiant' }),
  drop('Soma Prime Barrel', 'relic', 'Lith S2 Relic', 0.2533, { refinement: 'Intact' }),
  drop('Soma Prime Blueprint', 'relic', 'Lith S2 Relic', 0.11, { refinement: 'Intact' }),
  drop('Lith S2 Relic', 'mission', 'Earth/Mantle (Capture)', 0.1429),
  drop('Lith S2 Relic', 'mission', 'Mercury/Apollodorus (Survival)', 0.1106, { rotation: 'C' }),
  drop('Orokin Cell', 'enemy', 'Sargas Ruk', 0.3),
  drop('Serration', 'mission', 'Mercury/Apollodorus (Survival)', 0.0769, { rotation: 'B' }),
  drop('Serration', 'enemy', 'Corrupted Lancer', 0.003),
]);

const WORLD: WorldState = {
  source: 'warframestat',
  fissures: [
    { node: 'Hydron (Sedna)', missionType: 'Defense', tier: 'Lith', steelPath: false, storm: false, expiry: '2026-10-30T18:00:00Z' },
    { node: 'Storm (Veil)', missionType: 'Railjack', tier: 'Lith', steelPath: false, storm: true, expiry: '2026-10-30T18:00:00Z' },
    { node: 'Ukko (Void)', missionType: 'Capture', tier: 'Axi', steelPath: true, storm: false, expiry: '2026-10-30T18:00:00Z' },
  ],
  invasions: [{ node: 'Amalthea (Jupiter)', completion: 40, rewards: [{ uniqueName: BARREL, name: 'Soma Prime Barrel', count: 1 }] }],
  events: [],
  vaultTrader: { items: ['/R/AxiS1Gold'] },
};

describe('runsFor', () => {
  it('returns runs needed for a confidence level', () => {
    expect(runsFor(0.1, 0.9)).toBe(22);
    expect(runsFor(1, 0.9)).toBe(1);
    expect(runsFor(0, 0.9)).toBe(Infinity);
  });

  it('returns the expected number of runs', () => {
    expect(expectedRuns(0.25)).toBe(4);
    expect(expectedRuns(0)).toBe(Infinity);
  });
});

describe('listTargets', () => {
  it('offers weapons, mods, relics and resources', () => {
    const kinds = listTargets(CATALOG).map((t) => [t.name.en, t.kind]);
    expect(kinds).toEqual(expect.arrayContaining([['Soma Prime', 'weapon'], ['Serration', 'mod'], ['Axi S1 Relic', 'relic'], ['Orokin Cell', 'resource']]));
  });
});

describe('buildPlan for a prime weapon', () => {
  const target = listTargets(CATALOG).find((t) => t.name.en === 'Soma Prime')!;
  const plan = buildPlan(target, CATALOG, DROPS, WORLD);
  const barrel = plan.components.find((c) => c.name.en === 'Soma Prime Barrel')!;

  it('splits the item into blueprint and parts, resources separately', () => {
    expect(plan.components.map((c) => c.name.en)).toEqual(['Soma Prime Blueprint', 'Soma Prime Barrel']);
    expect(plan.resources).toEqual([expect.objectContaining({ name: n('Orokin Cell', 'Клетка Орокин'), count: 10 })]);
  });

  it('lists relics with chances per refinement, available ones first', () => {
    expect(barrel.relics.map((r) => r.relic.en)).toEqual(['Lith S2 Relic', 'Axi S1 Relic']);
    expect(barrel.relics[1].chances).toEqual({ Intact: 0.02, Radiant: 0.1 });
  });

  it('marks relics without mission sources as vaulted and notices Varzia', () => {
    const axi = barrel.relics[1];
    expect(axi).toMatchObject({ vaulted: true, varzia: true });
    expect(barrel.relics[0].vaulted).toBe(false);
  });

  it('tells where to farm a relic, best chance first', () => {
    expect(barrel.relics[0].whereToGet.map((s) => s.entry.source)).toEqual(['Earth/Mantle (Capture)', 'Mercury/Apollodorus (Survival)']);
  });

  it('shows matching active fissures, without railjack storms', () => {
    expect(barrel.relics[0].fissures.map((f) => f.node)).toEqual(['Hydron (Sedna)']);
    expect(barrel.relics[1].fissures.map((f) => f.node)).toEqual(['Ukko (Void)']);
  });

  it('estimates relics to open solo and in a 4-player radshare', () => {
    const lith = barrel.relics[0];
    expect(lith.expectedRelics).toBeCloseTo(1 / 0.2533);
    expect(lith.expectedRelicsSquad).toBeCloseTo(1 / (1 - (1 - 0.2533) ** 4));
  });

  it('surfaces live invasions that reward the part', () => {
    expect(barrel.live).toEqual([{ kind: 'invasion', title: 'Amalthea (Jupiter)', detail: '40%' }]);
  });
});

describe('buildPlan for a mod', () => {
  const target = listTargets(CATALOG).find((t) => t.name.en === 'Serration')!;
  const plan = buildPlan(target, CATALOG, DROPS, undefined);

  it('lists direct sources sorted by chance with run estimates', () => {
    const [best, worst] = plan.components[0].direct;
    expect(best.entry.source).toBe('Mercury/Apollodorus (Survival)');
    expect(best.expectedRuns).toBeCloseTo(1 / 0.0769);
    expect(worst.runs90).toBe(runsFor(0.003, 0.9));
  });
});

describe('buildPlan without drop data', () => {
  it('explains that the item is not in the drop tables', () => {
    const plan = buildPlan({ uniqueName: '/X', name: n('Mystery'), kind: 'resource' }, CATALOG, indexDrops([]), undefined);
    expect(plan.notes.join(' ')).toMatch(/не найден/);
  });
});
