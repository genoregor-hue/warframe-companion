/**
 * Turns a farming goal into a route: which parts are needed, which relics
 * hold them, where those relics drop, and how many runs to expect.
 */
import type { Catalog, LocalName } from '../../../data/catalog';
import type { DropEntry, Refinement } from '../../../data/dropTables';
import type { Fissure, WorldState } from '../../../data/worldstate';

export type TargetKind = 'warframe' | 'weapon' | 'mod' | 'arcane' | 'resource' | 'relic';

export interface FarmTarget {
  readonly uniqueName: string;
  readonly name: LocalName;
  readonly kind: TargetKind;
}

export type DropIndex = ReadonlyMap<string, readonly DropEntry[]>;

export interface DirectSource {
  readonly entry: DropEntry;
  readonly expectedRuns: number;
  readonly runs90: number;
}

export interface RelicSource {
  readonly relic: LocalName;
  readonly tier: string;
  readonly chances: Partial<Record<Refinement, number>>;
  readonly vaulted: boolean;
  readonly varzia: boolean;
  readonly whereToGet: readonly DirectSource[];
  readonly fissures: readonly Fissure[];
  /** Relics to open with the best refinement, solo. */
  readonly expectedRelics: number;
  /** Same, sharing the same relic in a squad of four. */
  readonly expectedRelicsSquad: number;
}

export interface LiveSource {
  readonly kind: 'invasion' | 'event';
  readonly title: string;
  readonly detail: string;
}

export interface ComponentPlan {
  readonly uniqueName: string;
  readonly name: LocalName;
  readonly count: number;
  readonly direct: readonly DirectSource[];
  readonly relics: readonly RelicSource[];
  readonly live: readonly LiveSource[];
}

export interface ResourceNeed {
  readonly uniqueName: string;
  readonly name: LocalName;
  readonly count: number;
  readonly direct: readonly DirectSource[];
}

export interface FarmPlan {
  readonly target: FarmTarget;
  readonly components: readonly ComponentPlan[];
  readonly resources: readonly ResourceNeed[];
  readonly notes: readonly string[];
}

const CONFIDENCE = 0.9;
const SQUAD_SIZE = 4;
const MAX_DIRECT = 8;
const MAX_RESOURCE_SOURCES = 3;
const MAX_RELIC_SOURCES = 6;

export function runsFor(chance: number, confidence: number): number {
  if (chance >= 1) return 1;
  if (chance <= 0) return Infinity;
  return Math.ceil(Math.log(1 - confidence) / Math.log(1 - chance));
}

export const expectedRuns = (chance: number): number => (chance > 0 ? 1 / chance : Infinity);

export function indexDrops(entries: readonly DropEntry[]): DropIndex {
  const index = new Map<string, DropEntry[]>();
  for (const entry of entries) {
    const key = entry.item.toLowerCase();
    index.set(key, [...(index.get(key) ?? []), entry]);
  }
  return index;
}

export function listTargets(catalog: Catalog): FarmTarget[] {
  const used = new Set<string>();
  const add = (kind: TargetKind) => (item: { uniqueName: string; name: LocalName }): FarmTarget[] => {
    if (used.has(item.uniqueName)) return [];
    used.add(item.uniqueName);
    return [{ uniqueName: item.uniqueName, name: item.name, kind }];
  };
  return [
    ...catalog.frames.flatMap(add('warframe')),
    ...catalog.weapons.flatMap(add('weapon')),
    ...catalog.mods.flatMap(add('mod')),
    ...catalog.arcanes.flatMap(add('arcane')),
    ...catalog.relics.flatMap((r) => add('relic')({ uniqueName: r.uniqueNames[0], name: r.name })),
    ...Object.entries(catalog.names).flatMap(([uniqueName, name]) => add('resource')({ uniqueName, name })),
  ];
}

const toDirect = (entry: DropEntry): DirectSource => ({ entry, expectedRuns: expectedRuns(entry.chance), runs90: runsFor(entry.chance, CONFIDENCE) });
const byChance = (a: DirectSource, b: DirectSource) => b.entry.chance - a.entry.chance;

function lookup(drops: DropIndex, names: readonly string[]): readonly DropEntry[] {
  return names.flatMap((name) => drops.get(name.toLowerCase()) ?? []);
}

function relicSources(entries: readonly DropEntry[], catalog: Catalog, drops: DropIndex, world?: WorldState): RelicSource[] {
  const grouped = new Map<string, DropEntry[]>();
  for (const entry of entries.filter((e) => e.kind === 'relic')) grouped.set(entry.source, [...(grouped.get(entry.source) ?? []), entry]);
  const relics = [...grouped.entries()].map(([relicName, rows]) => {
    const info = catalog.relics.find((r) => r.name.en === relicName);
    const tier = info?.tier ?? relicName.split(' ')[0];
    const chances = Object.fromEntries(rows.filter((r) => r.refinement).map((r) => [r.refinement, r.chance])) as Partial<Record<Refinement, number>>;
    const best = Math.max(...rows.map((r) => r.chance));
    const whereToGet = lookup(drops, [relicName]).filter((e) => e.kind !== 'relic').map(toDirect).sort(byChance).slice(0, MAX_RELIC_SOURCES);
    const vaultItems = new Set(world?.vaultTrader?.items ?? []);
    return {
      relic: info?.name ?? { en: relicName, ru: relicName },
      tier,
      chances,
      vaulted: whereToGet.length === 0,
      varzia: (info?.uniqueNames ?? []).some((u) => vaultItems.has(u)),
      whereToGet,
      fissures: (world?.fissures ?? []).filter((f) => f.tier === tier && !f.storm),
      expectedRelics: expectedRuns(best),
      expectedRelicsSquad: expectedRuns(1 - (1 - best) ** SQUAD_SIZE),
    };
  });
  const bestChance = (r: RelicSource) => Math.max(...Object.values(r.chances).map((c) => c ?? 0));
  return relics.sort((a, b) => Number(a.vaulted) - Number(b.vaulted) || bestChance(b) - bestChance(a));
}

function liveSources(uniqueNames: ReadonlySet<string>, world?: WorldState): LiveSource[] {
  if (!world) return [];
  const invasions = world.invasions
    .filter((inv) => inv.rewards.some((r) => uniqueNames.has(r.uniqueName)))
    .map((inv) => ({ kind: 'invasion' as const, title: inv.node, detail: `${Math.round(inv.completion)}%` }));
  const events = world.events
    .filter((e) => e.rewards.some((r) => uniqueNames.has(r.uniqueName)))
    .map((e) => ({ kind: 'event' as const, title: e.name, detail: e.expiry ? `до ${e.expiry.slice(0, 10)}` : '' }));
  return [...invasions, ...events];
}

interface Part {
  readonly uniqueName: string;
  readonly name: LocalName;
  readonly count: number;
  readonly dropNames: readonly string[];
}

function componentPlan(part: Part, catalog: Catalog, drops: DropIndex, world?: WorldState): ComponentPlan {
  const entries = lookup(drops, part.dropNames);
  const blueprintIds = catalog.recipes.filter((r) => r.resultType === part.uniqueName).map((r) => r.uniqueName);
  return {
    uniqueName: part.uniqueName,
    name: part.name,
    count: part.count,
    direct: entries.filter((e) => e.kind !== 'relic').map(toDirect).sort(byChance).slice(0, MAX_DIRECT),
    relics: relicSources(entries, catalog, drops, world),
    live: liveSources(new Set([part.uniqueName, ...blueprintIds]), world),
  };
}

const isCraftedPart = (uniqueName: string, catalog: Catalog) =>
  uniqueName.includes('/Recipes/') || catalog.weapons.some((w) => w.uniqueName === uniqueName) || catalog.frames.some((f) => f.uniqueName === uniqueName);

function partsOf(target: FarmTarget, catalog: Catalog): { parts: Part[]; resources: { uniqueName: string; count: number }[] } {
  const recipe = catalog.recipes.find((r) => r.resultType === target.uniqueName);
  const self: Part = { uniqueName: target.uniqueName, name: target.name, count: 1, dropNames: [target.name.en, `${target.name.en} Blueprint`] };
  if (!recipe || (target.kind !== 'weapon' && target.kind !== 'warframe')) return { parts: [self], resources: [] };
  const blueprint: Part = {
    uniqueName: recipe.uniqueName,
    name: { en: `${target.name.en} Blueprint`, ru: `${target.name.ru}: чертёж` },
    count: 1,
    dropNames: [`${target.name.en} Blueprint`],
  };
  const parts = recipe.ingredients
    .filter((i) => isCraftedPart(i.uniqueName, catalog))
    .map((i) => {
      const name = catalog.names[i.uniqueName] ?? { en: i.uniqueName.split('/').pop() ?? i.uniqueName, ru: i.uniqueName };
      return { uniqueName: i.uniqueName, name, count: i.count, dropNames: [name.en, `${name.en} Blueprint`] };
    });
  const resources = recipe.ingredients.filter((i) => !isCraftedPart(i.uniqueName, catalog));
  return { parts: [blueprint, ...parts], resources };
}

export function buildPlan(target: FarmTarget, catalog: Catalog, drops: DropIndex, world?: WorldState): FarmPlan {
  const { parts, resources } = partsOf(target, catalog);
  const components = parts.map((part) => componentPlan(part, catalog, drops, world));
  const resourceNeeds = resources.map(({ uniqueName, count }) => {
    const name = catalog.names[uniqueName] ?? { en: uniqueName, ru: uniqueName };
    return { uniqueName, name, count, direct: lookup(drops, [name.en]).map(toDirect).sort(byChance).slice(0, MAX_RESOURCE_SOURCES) };
  });
  const notes: string[] = [];
  const empty = components.filter((c) => c.direct.length === 0 && c.relics.length === 0 && c.live.length === 0);
  if (empty.length > 0) {
    notes.push(`В официальных таблицах дропа не найдено: ${empty.map((c) => c.name.ru).join(', ')}. Вероятно, это рынок, синдикат, квест, Баро Ки'Тир или исследование клана.`);
  }
  const relicOnly = components.filter((c) => c.relics.length > 0 && c.direct.length === 0);
  if (relicOnly.length > 0 && relicOnly.every((c) => c.relics.every((r) => r.vaulted))) {
    notes.push('Все реликвии для этих частей сейчас в хранилище: их можно купить у игроков, получить у Варзии или дождаться возвращения.');
  }
  return { target, components, resources: resourceNeeds, notes };
}
