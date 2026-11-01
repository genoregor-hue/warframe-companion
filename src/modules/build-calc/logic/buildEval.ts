/** Evaluates a build the player assembled by hand (or loaded from the optimizer). */
import type { ArcaneEntry, Catalog, ModEntry } from '../../../data/catalog';
import type { FrameBuild, ModChoice, WeaponBuild } from './autoBuild';
import { auraBonus, buildCapacity, modDrain } from './capacity';
import { modRankStats } from './compat';
import type { DamageType, Faction } from './damageTypes';
import type { EnemyProfile } from './enemy';
import { targetDps, type TargetDps } from './statusEffects';
import { computeFrame, type FrameResult, type ShardChoice } from './frameCalc';
import { parseStatLines, statsAtRank, type ParsedStat } from './modStats';
import { computeWeapon, withBonusElement, type WeaponResult } from './weaponCalc';

export type BuildKind = 'weapon' | 'frame';

export interface SlotState {
  readonly uniqueName?: string;
  readonly rank: number;
  /** Slot polarity ('' = none). */
  readonly polarity: string;
}

export interface BuildState {
  readonly kind: BuildKind;
  readonly itemId?: string;
  readonly slots: readonly SlotState[];
  readonly exilus: SlotState;
  readonly aura: SlotState;
  readonly arcanes: readonly string[];
  readonly potato: boolean;
  readonly extraCapacity: number;
  readonly conditional: boolean;
  readonly faction?: Faction;
  /** Target for "DPS по врагу"; undefined = raw damage. */
  readonly enemy?: EnemyProfile;
  readonly enemyPreset?: string;
  /** Riven mod typed by the player; takes one of the 8 slots. */
  readonly riven?: { readonly text: string; readonly drain: number };
  /** Kuva/Tenet/Coda progenitor bonus. */
  readonly bonusElement?: { readonly type: DamageType; readonly fraction: number };
  readonly comboMultiplier?: number;
  readonly statusTypes?: number;
  readonly shards?: readonly ShardChoice[];
  /** Model Viral, Corrosive, Heat and bleed effects on the target. */
  readonly statusEffects?: boolean;
}

export interface BuildEvaluation {
  readonly weapon?: WeaponResult;
  /** DPS that lands on the target (armor, weaknesses and, if enabled, status effects). */
  readonly effectiveDps?: number;
  readonly target?: TargetDps;
  readonly frame?: FrameResult;
  readonly capacityUsed: number;
  readonly capacity: number;
  /** Stat lines that are shown in game but not modelled by the calculator. */
  readonly ignoredLines: readonly string[];
}

export const MAIN_SLOT_COUNT = 8;
const EMPTY_SLOT: SlotState = { rank: 0, polarity: '' };

export function emptyBuild(kind: BuildKind): BuildState {
  return {
    kind,
    slots: Array.from({ length: MAIN_SLOT_COUNT }, () => EMPTY_SLOT),
    exilus: EMPTY_SLOT,
    aura: EMPTY_SLOT,
    arcanes: [],
    potato: true,
    extraCapacity: 0,
    conditional: false,
  };
}

const modIndexes = new WeakMap<Catalog, ReadonlyMap<string, ModEntry>>();
const arcaneIndexes = new WeakMap<Catalog, ReadonlyMap<string, ArcaneEntry>>();

export function modById(catalog: Catalog, uniqueName: string | undefined): ModEntry | undefined {
  if (!uniqueName) return undefined;
  let index = modIndexes.get(catalog);
  if (!index) {
    index = new Map(catalog.mods.map((m) => [m.uniqueName, m]));
    modIndexes.set(catalog, index);
  }
  return index.get(uniqueName);
}

export function arcaneById(catalog: Catalog, uniqueName: string): ArcaneEntry | undefined {
  let index = arcaneIndexes.get(catalog);
  if (!index) {
    index = new Map(catalog.arcanes.map((a) => [a.uniqueName, a]));
    arcaneIndexes.set(catalog, index);
  }
  return index.get(uniqueName);
}

interface SlotStats {
  readonly stats: readonly ParsedStat[];
  readonly unknown: readonly string[];
}

function slotStats(catalog: Catalog, slot: SlotState): SlotStats | undefined {
  const mod = modById(catalog, slot.uniqueName);
  return mod ? modRankStats(mod, slot.rank) : undefined;
}

function slotDrain(catalog: Catalog, slot: SlotState): number {
  const mod = modById(catalog, slot.uniqueName);
  return mod ? modDrain({ baseDrain: mod.baseDrain, rank: Math.min(slot.rank, mod.fusionLimit), polarity: mod.polarity }, slot.polarity) : 0;
}

export function evaluateBuild(state: BuildState, catalog: Catalog): BuildEvaluation | undefined {
  const weapon = state.kind === 'weapon' ? catalog.weapons.find((w) => w.uniqueName === state.itemId) : undefined;
  const frame = state.kind === 'frame' ? catalog.frames.find((f) => f.uniqueName === state.itemId) : undefined;
  if (!weapon && !frame) return undefined;

  const auraSlots = frame ? [state.aura] : [];
  const modded = [...state.slots, state.exilus, ...auraSlots].map((slot) => slotStats(catalog, slot)).filter((s): s is SlotStats => s !== undefined);
  const arcaneStats = state.arcanes
    .map((id) => arcaneById(catalog, id))
    .filter((a): a is ArcaneEntry => a !== undefined)
    .map((a) => parseStatLines(statsAtRank(a.stats, a.stats.length - 1)));
  const riven = state.riven?.text.trim() ? [parseStatLines(rivenLines(state.riven.text))] : [];
  const all = [...modded, ...riven, ...arcaneStats];
  const statLists = all.map((s) => s.stats);
  const ignoredLines = [...new Set(all.flatMap((s) => s.unknown))];

  const auraMod = frame ? modById(catalog, state.aura.uniqueName) : undefined;
  const bonus = auraMod ? auraBonus({ baseDrain: auraMod.baseDrain, rank: Math.min(state.aura.rank, auraMod.fusionLimit), polarity: auraMod.polarity }, state.aura.polarity) : 0;
  const capacity = buildCapacity({ potato: state.potato, bonus: bonus + state.extraCapacity });
  const rivenDrain = riven.length ? Math.max(0, state.riven?.drain ?? 0) : 0;
  const capacityUsed = [...state.slots, state.exilus].reduce((sum, slot) => sum + slotDrain(catalog, slot), 0) + rivenDrain;

  if (weapon) {
    const fireRateLocked = state.slots.some((slot) => modById(catalog, slot.uniqueName)?.locksFireRate);
    const base = withBonusElement({ ...weapon, isBow: weapon.weaponClass === 'Bow' }, state.bonusElement?.type, state.bonusElement?.fraction ?? 0);
    const result = computeWeapon(base, statLists, {
      conditional: state.conditional, faction: state.faction, fireRateLocked, comboMultiplier: state.comboMultiplier, statusTypes: state.statusTypes,
    });
    const target = state.enemy || state.statusEffects ? targetDps(result, state.enemy, Boolean(state.statusEffects)) : undefined;
    return { weapon: result, ...(target ? { effectiveDps: target.total, target } : {}), capacityUsed, capacity, ignoredLines };
  }
  return { frame: computeFrame(frame!, statLists, { conditional: state.conditional, shards: state.shards }), capacityUsed, capacity, ignoredLines };
}

/** Riven text as typed or pasted: one stat per line. */
export function rivenLines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

/** Without forma the choice carries no polarity, so the player's slot polarity is kept. */
const toSlot = (choice: ModChoice | undefined, current: SlotState): SlotState =>
  choice ? { uniqueName: choice.uniqueName, rank: choice.rank, polarity: choice.polarity || current.polarity } : { ...EMPTY_SLOT, polarity: current.polarity };

/** Loads an optimizer result into the slots, with forma matching each mod. */
export function applyAutoBuild(state: BuildState, auto: WeaponBuild | FrameBuild): BuildState {
  const slots = Array.from({ length: MAIN_SLOT_COUNT }, (_, i) => toSlot(auto.mods[i], state.slots[i] ?? EMPTY_SLOT));
  const aura = 'aura' in auto ? toSlot(auto.aura, state.aura) : state.aura;
  return { ...state, slots, exilus: toSlot(auto.exilus, state.exilus), aura, arcanes: auto.arcanes };
}
