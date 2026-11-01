/**
 * Builds the strongest loadout for a weapon or warframe from the mods the
 * player owns (or from all mods, listing what is missing to buy).
 */
import type { ArcaneEntry, FrameEntry, ModEntry, WeaponEntry } from '../../../data/catalog';
import { auraBonus, buildCapacity, modDrain, placeDrain } from './capacity';
import { frameArcanes, frameCompatible, isAura, modRankStats, weaponArcanes, weaponCompatible } from './compat';
import { COMPOUND_RECIPES, PRIMARY_ELEMENTS, type DamageType, type Faction } from './damageTypes';
import { enemyMultiplier, type EnemyProfile } from './enemy';
import { targetDps } from './statusEffects';
import { computeFrame, type FrameResult, type ShardChoice } from './frameCalc';
import { parseStatLines, statsAtRank, type ParsedStat, type StatKey } from './modStats';
import { optimizeSelection, type Candidate } from './optimizer';
import { computeWeapon, withBonusElement, type WeaponResult } from './weaponCalc';

export type WeaponGoal = 'burst' | 'sustained' | 'status';
export type FrameWeights = Partial<Record<'strength' | 'duration' | 'range' | 'efficiency' | 'survivability', number>>;

interface CommonOptions {
  readonly conditional: boolean;
  readonly autoForma: boolean;
  readonly potato: boolean;
  /** uniqueName → rank the player has. Undefined = assume every mod at max rank. */
  readonly owned?: Readonly<Record<string, number>>;
  /** With `owned`: also use mods the player lacks and report them in `missing`. */
  readonly allowMissing?: boolean;
  /** Current build (uniqueNames) to improve instead of starting from scratch. */
  readonly initial?: readonly string[];
  readonly slotPolarities?: readonly string[];
  readonly extraCapacity?: number;
  /** uniqueName → score bonus learned from imported community builds (see metaLearning.ts). */
  readonly metaWeights?: Readonly<Record<string, number>>;
}

export interface RivenInput {
  /** English stat lines as shown on the riven card, e.g. "+150% Critical Chance". */
  readonly lines: readonly string[];
  /** Capacity the riven costs in its slot. */
  readonly drain: number;
}

export interface WeaponAutoOptions extends CommonOptions {
  readonly goal: WeaponGoal;
  readonly faction?: Faction;
  readonly requiredElement?: DamageType;
  /** Score against this target (armor, weaknesses) instead of raw damage. */
  readonly enemy?: EnemyProfile;
  /** Always equipped; takes one of the 8 slots. */
  readonly riven?: RivenInput;
  readonly bonusElement?: { readonly type: DamageType; readonly fraction: number };
  readonly comboMultiplier?: number;
  readonly statusTypes?: number;
  /** Model Viral, Corrosive, Heat and bleed effects (see statusEffects.ts). */
  readonly statusEffects?: boolean;
}

export interface FrameAutoOptions extends CommonOptions {
  readonly weights: FrameWeights;
  readonly shards?: readonly ShardChoice[];
}

export interface ModChoice {
  readonly uniqueName: string;
  readonly rank: number;
  readonly owned: boolean;
  /** The slot polarity this choice assumes (the mod's own polarity when forma is allowed). */
  readonly polarity: string;
}

interface BuildBase {
  readonly mods: readonly ModChoice[];
  readonly exilus?: ModChoice;
  readonly arcanes: readonly string[];
  readonly capacityUsed: number;
  readonly capacity: number;
  readonly missing: readonly ModChoice[];
}

export interface WeaponBuild extends BuildBase {
  readonly result: WeaponResult;
  /** Burst DPS that lands on the chosen enemy (armor and weaknesses applied). */
  readonly effectiveDps?: number;
}
export interface FrameBuild extends BuildBase { readonly aura?: ModChoice; readonly result: FrameResult }

interface ModCandidate extends Candidate {
  readonly mod: ModEntry;
  readonly rank: number;
  readonly owned: boolean;
  readonly stats: readonly ParsedStat[];
}

const MAIN_SLOTS = 8;
const MISSING_ELEMENT_PENALTY = 0.001;
const LOCK_OPTIONS = 3;
const MAX_ELEMENT_PERMUTATIONS = 5;
const AURA_OPTIONS = 6;
const FRAME_ARCANE_SLOTS = 2;

const WEAPON_KEYS: ReadonlySet<StatKey> = new Set<StatKey>([
  'damage', 'multishot', 'critChance', 'critDamage', 'statusChance', 'fireRate', 'magazine', 'reloadSpeed',
  'impact', 'puncture', 'slash', 'heat', 'cold', 'electricity', 'toxin', 'blast', 'radiation', 'gas', 'magnetic', 'viral', 'corrosive',
]);
const FRAME_KEYS: ReadonlySet<StatKey> = new Set<StatKey>(['strength', 'duration', 'range', 'efficiency', 'health', 'shield', 'armor', 'energy']);

/** `relevant` undefined = keep every mod (auras are worth their capacity alone). */
function makeCandidates(mods: readonly ModEntry[], keep: (mod: ModEntry) => boolean, relevant: ReadonlySet<StatKey> | undefined, options: CommonOptions): ModCandidate[] {
  return mods.filter(keep).flatMap((mod) => {
    const ownedRank = options.owned?.[mod.uniqueName];
    if (options.owned && ownedRank === undefined && !options.allowMissing) return [];
    const rank = Math.min(mod.fusionLimit, ownedRank ?? mod.fusionLimit);
    const stats = modRankStats(mod, rank).stats;
    const learned = (options.metaWeights?.[mod.uniqueName] ?? 0) > 0;
    const useful = !relevant || learned || stats.some((s) => relevant.has(s.key) && (!s.conditional || options.conditional));
    if (!useful) return [];
    return [{ id: mod.uniqueName, family: mod.family, mod, rank, owned: !options.owned || ownedRank !== undefined, stats }];
  });
}

function drainOf(selection: readonly ModCandidate[], options: CommonOptions): number {
  const mods = selection.map((c) => ({ baseDrain: c.mod.baseDrain, rank: c.rank, polarity: c.mod.polarity }));
  if (options.autoForma) return mods.reduce((sum, m) => sum + modDrain(m, m.polarity), 0);
  return placeDrain(mods, options.slotPolarities ?? Array(MAIN_SLOTS).fill(''));
}

const metaFactor = (selection: readonly ModCandidate[], options: CommonOptions) =>
  1 + selection.reduce((sum, c) => sum + (options.metaWeights?.[c.id] ?? 0), 0);

const choiceFor = (options: CommonOptions) => (c: ModCandidate): ModChoice => ({
  uniqueName: c.mod.uniqueName, rank: c.rank, owned: c.owned, polarity: options.autoForma ? c.mod.polarity : '',
});
const hasElement = (c: ModCandidate, element: DamageType) => c.stats.some((s) => s.key === element);
const isElemental = (c: ModCandidate) => c.stats.some((s) => PRIMARY_ELEMENTS.includes(s.key as DamageType));

function arcaneStats(arcane: ArcaneEntry): readonly ParsedStat[] {
  return parseStatLines(statsAtRank(arcane.stats, arcane.stats.length - 1)).stats;
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, i) => permutations(items.filter((_, j) => j !== i)).map((rest) => [item, ...rest]));
}

// ---------- weapons ----------

function weaponEvaluator(weapon: WeaponEntry, options: WeaponAutoOptions) {
  const base = withBonusElement({ ...weapon, isBow: weapon.weaponClass === 'Bow' }, options.bonusElement?.type, options.bonusElement?.fraction ?? 0);
  const rivenStats = options.riven ? [parseStatLines(options.riven.lines).stats] : [];
  const onTarget = (r: WeaponResult) => (options.statusEffects ? targetDps(r, options.enemy, true).total : r.burstDps * (options.enemy ? enemyMultiplier(r.damage, options.enemy) : 1));
  const uptime = (r: WeaponResult) => (r.burstDps > 0 ? r.sustainedDps / r.burstDps : 1);
  const value = (r: WeaponResult) => (options.goal === 'sustained' ? onTarget(r) * uptime(r) : options.goal === 'status' ? r.procsPerSecond : onTarget(r));
  const run = (ordered: readonly ModCandidate[], extra: readonly (readonly ParsedStat[])[]) => {
    const fireRateLocked = ordered.some((c) => c.mod.locksFireRate);
    const result = computeWeapon(base, [...ordered.map((c) => c.stats), ...rivenStats, ...extra], { ...options, fireRateLocked });
    const ok = !options.requiredElement || result.damage[options.requiredElement] > 0;
    return { result, score: value(result) * (ok ? 1 : MISSING_ELEMENT_PENALTY) * metaFactor(ordered, options), ordered };
  };
  // Element order decides combinations; it only matters when some element is worth more than another.
  const orderMatters = Boolean(options.requiredElement) || Boolean(options.statusEffects) || (options.enemy !== undefined && options.enemy.weak.length + options.enemy.resist.length > 0);
  return (selection: readonly ModCandidate[], extra: readonly (readonly ParsedStat[])[] = []) => {
    const elemental = selection.filter(isElemental);
    if (!orderMatters || elemental.length < 2 || elemental.length > MAX_ELEMENT_PERMUTATIONS) return run(selection, extra);
    const others = selection.filter((c) => !isElemental(c));
    return permutations(elemental)
      .map((order) => run([...order, ...others], extra))
      .reduce((best, next) => (next.score > best.score ? next : best));
  };
}

function elementLocks(candidates: readonly ModCandidate[], required?: DamageType): readonly (readonly ModCandidate[])[] {
  if (!required) return [[]];
  const parts: readonly DamageType[] = COMPOUND_RECIPES[required] ?? [required];
  const top = (element: DamageType) =>
    candidates.filter((c) => hasElement(c, element)).sort((a, b) => b.stats[0].value - a.stats[0].value).slice(0, LOCK_OPTIONS);
  const [first, second] = parts.map(top);
  if (parts.length === 1) return [[], ...first.map((c) => [c])];
  return [[], ...first.flatMap((a) => second.filter((b) => b.family !== a.family).map((b) => [a, b]))];
}

export function autoBuildWeapon(weapon: WeaponEntry, mods: readonly ModEntry[], arcanes: readonly ArcaneEntry[], options: WeaponAutoOptions): WeaponBuild {
  const choice = choiceFor(options);
  const relevant = new Set<StatKey>([...WEAPON_KEYS, ...(options.faction ? [`faction${options.faction}` as StatKey] : [])]);
  const candidates = makeCandidates(mods, (m) => weaponCompatible(m, weapon), relevant, options);
  const capacity = buildCapacity({ potato: options.potato, bonus: options.extraCapacity ?? 0 });
  const rivenDrain = options.riven?.drain ?? 0;
  const slots = MAIN_SLOTS - (options.riven ? 1 : 0);
  const evaluate = weaponEvaluator(weapon, options);
  const fits = (selection: readonly ModCandidate[]) => drainOf(selection, options) + rivenDrain <= capacity;
  const initial = candidates.filter((c) => options.initial?.includes(c.id));

  const best = elementLocks(candidates, options.requiredElement)
    .map((locked) => optimizeSelection({ candidates, slots, fits, score: (s) => evaluate(s).score, locked, initial }))
    .reduce((a, b) => (b.score > a.score ? b : a));
  let current = evaluate(best.selection);

  const exilus = candidates
    .filter((c) => c.mod.isUtility && !best.selection.some((s) => s.family === c.family))
    .filter((c) => fits([...best.selection, c]))
    .map((c) => ({ c, score: evaluate([...best.selection, c]).score }))
    .reduce<{ c: ModCandidate; score: number } | undefined>((top, next) => (next.score > (top?.score ?? current.score) ? next : top), undefined);
  const withExilus = exilus ? [...current.ordered, exilus.c] : current.ordered;
  if (exilus) current = evaluate(withExilus);

  const arcane = weaponArcanes(arcanes, weapon)
    .map((a) => ({ a, eval: evaluate(withExilus, [arcaneStats(a)]) }))
    .reduce<{ a: ArcaneEntry; eval: ReturnType<typeof evaluate> } | undefined>((top, next) => (next.eval.score > (top?.eval.score ?? current.score) ? next : top), undefined);
  const final = arcane ? arcane.eval : current;

  const mainMods = final.ordered.filter((c) => c !== exilus?.c);
  const chosen = [...mainMods, ...(exilus ? [exilus.c] : [])];
  return {
    mods: mainMods.map(choice),
    ...(exilus ? { exilus: choice(exilus.c) } : {}),
    arcanes: arcane ? [arcane.a.uniqueName] : [],
    result: final.result,
    ...(options.enemy || options.statusEffects ? { effectiveDps: targetDps(final.result, options.enemy, Boolean(options.statusEffects)).total } : {}),
    capacityUsed: drainOf(chosen, options) + rivenDrain,
    capacity,
    missing: chosen.filter((c) => !c.owned).map(choice),
  };
}

// ---------- warframes ----------

function frameScorer(frame: FrameEntry, options: FrameAutoOptions) {
  const baseEhp = computeFrame(frame, [], options).effectiveHealth || 1;
  const w = options.weights;
  return (stats: readonly (readonly ParsedStat[])[]) => {
    const r = computeFrame(frame, stats, options);
    // Doubling effective health is worth as much as +100% of an ability stat.
    const survivability = 1 + Math.log2(Math.max(r.effectiveHealth, 1) / baseEhp);
    const score = (w.strength ?? 0) * r.strength + (w.duration ?? 0) * r.duration + (w.range ?? 0) * r.range
      + (w.efficiency ?? 0) * r.efficiency + (w.survivability ?? 0) * survivability;
    return { result: r, score };
  };
}

export function autoBuildFrame(frame: FrameEntry, mods: readonly ModEntry[], arcanes: readonly ArcaneEntry[], options: FrameAutoOptions): FrameBuild {
  const choice = choiceFor(options);
  const candidates = makeCandidates(mods, (m) => frameCompatible(m, frame), FRAME_KEYS, options);
  const allAuras = makeCandidates(mods, isAura, undefined, options);
  const byStats = allAuras.filter((c) => c.stats.some((s) => FRAME_KEYS.has(s.key)));
  const byCapacity = [...allAuras].sort((a, b) => auraBonus({ ...b.mod, rank: b.rank }, '') - auraBonus({ ...a.mod, rank: a.rank }, ''));
  const auras = [undefined, ...new Set([...byStats, ...byCapacity].slice(0, AURA_OPTIONS + byStats.length))];
  const scoreOf = frameScorer(frame, options);
  const initial = candidates.filter((c) => options.initial?.includes(c.id));

  const runs = auras.map((aura) => {
    const bonus = aura ? auraBonus({ ...aura.mod, rank: aura.rank }, options.autoForma ? aura.mod.polarity : '') : 0;
    const capacity = buildCapacity({ potato: options.potato, bonus: bonus + (options.extraCapacity ?? 0) });
    const auraStats = aura ? [aura.stats] : [];
    const result = optimizeSelection({
      candidates,
      slots: MAIN_SLOTS,
      fits: (s) => drainOf(s, options) <= capacity,
      score: (s) => scoreOf([...s.map((c) => c.stats), ...auraStats]).score * metaFactor(s, options),
      initial,
    });
    return { aura, capacity, auraStats, ...result };
  });
  // On a tie the aura with the bigger capacity bonus wins: an empty aura slot is never better.
  const bonusOf = (run: (typeof runs)[number]) => run.capacity;
  const best = runs.reduce((a, b) => (b.score > a.score + 1e-9 || (Math.abs(b.score - a.score) <= 1e-9 && bonusOf(b) > bonusOf(a)) ? b : a));

  const statsOf = (selection: readonly ModCandidate[], extra: readonly (readonly ParsedStat[])[] = []) =>
    [...selection.map((c) => c.stats), ...best.auraStats, ...extra];
  const exilus = candidates
    .filter((c) => c.mod.isUtility && !best.selection.some((s) => s.family === c.family))
    .filter((c) => drainOf([...best.selection, c], options) <= best.capacity)
    .map((c) => ({ c, score: scoreOf(statsOf([...best.selection, c])).score }))
    .reduce<{ c: ModCandidate; score: number } | undefined>((top, next) => (next.score > (top?.score ?? scoreOf(statsOf(best.selection)).score) + 1e-9 ? next : top), undefined);
  const withExilus = exilus ? [...best.selection, exilus.c] : best.selection;

  const baseScore = scoreOf(statsOf(withExilus)).score;
  const chosenArcanes = frameArcanes(arcanes)
    .map((a) => ({ a, gain: scoreOf(statsOf(withExilus, [arcaneStats(a)])).score - baseScore }))
    .filter((x) => x.gain > 0)
    .sort((x, y) => y.gain - x.gain)
    .slice(0, FRAME_ARCANE_SLOTS)
    .map((x) => x.a);
  const final = scoreOf(statsOf(withExilus, chosenArcanes.map(arcaneStats)));
  const chosen = [...withExilus, ...(best.aura ? [best.aura] : [])];
  return {
    mods: best.selection.map(choice),
    ...(exilus ? { exilus: choice(exilus.c) } : {}),
    ...(best.aura ? { aura: choice(best.aura) } : {}),
    arcanes: chosenArcanes.map((a) => a.uniqueName),
    result: final.result,
    capacityUsed: drainOf(withExilus, options),
    capacity: best.capacity,
    missing: chosen.filter((c) => !c.owned).map(choice),
  };
}
