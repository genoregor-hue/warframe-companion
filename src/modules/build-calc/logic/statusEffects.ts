/**
 * Steady-state model of status effects on one target: how many stacks your
 * proc rate keeps up, and what they add (Viral bonus, armor strip, DoTs).
 * Proc rates come from the calculator; the effect numbers below are game
 * knowledge (not in the official export) and are documented in README.
 */
import { DAMAGE_TYPES, type DamageType } from './damageTypes';
import { armorReduction, enemyMultiplier, typeMultiplier, type EnemyProfile } from './enemy';
import type { WeaponResult } from './weaponCalc';

export const STATUS_RULES = {
  viral: { duration: 6, maxStacks: 10, first: 1, perExtra: 0.25 },
  corrosive: { duration: 8, maxStacks: 10, first: 0.26, perExtra: 0.06, maxStrip: 0.8 },
  heat: { duration: 6, strip: 0.5, dotPerTick: 0.5, ticks: 6 },
  slash: { dotPerTick: 0.35, ticks: 6 },
  toxin: { dotPerTick: 0.5, ticks: 6 },
} as const;

const NO_ENEMY: EnemyProfile = { armor: 0, armorStrip: 0, weak: [], resist: [] };

export interface TargetDps {
  /** Hit damage per second after armor, weaknesses and Viral. */
  readonly direct: number;
  /** Damage over time per second (Slash bleed, Heat, Toxin). */
  readonly dot: number;
  readonly total: number;
  readonly viralBonus: number;
  /** Total share of armor removed (manual strip, Corrosive, Heat). */
  readonly armorStrip: number;
}

export function steadyStacks(procsPerSecond: number, duration: number, maxStacks: number): number {
  return Math.min(maxStacks, Math.max(0, procsPerSecond) * duration);
}

/** Damage bonus against health: +100% at one stack, +25% per extra stack, +325% at ten. */
export function viralBonus(stacks: number): number {
  const { first, perExtra, maxStacks } = STATUS_RULES.viral;
  if (stacks <= 1) return Math.max(0, stacks) * first;
  return first + perExtra * (Math.min(stacks, maxStacks) - 1);
}

export function corrosiveStrip(stacks: number): number {
  const { first, perExtra, maxStrip } = STATUS_RULES.corrosive;
  if (stacks <= 1) return Math.max(0, stacks) * first;
  return Math.min(maxStrip, first + perExtra * (stacks - 1));
}

/** Procs per second of each type: status procs are split by damage share. */
export function procRates(result: WeaponResult): Record<DamageType, number> {
  const total = DAMAGE_TYPES.reduce((sum, t) => sum + result.damage[t], 0);
  return Object.fromEntries(DAMAGE_TYPES.map((t) => [t, total > 0 ? result.procsPerSecond * (result.damage[t] / total) : 0])) as Record<DamageType, number>;
}

function combinedStrip(...strips: readonly number[]): number {
  return 1 - strips.reduce((left, strip) => left * (1 - Math.min(1, Math.max(0, strip))), 1);
}

export function targetDps(result: WeaponResult, enemy: EnemyProfile | undefined, withStatuses: boolean): TargetDps {
  const target = enemy ?? NO_ENEMY;
  if (!withStatuses) {
    const direct = result.burstDps * enemyMultiplier(result.damage, target);
    return { direct, dot: 0, total: direct, viralBonus: 0, armorStrip: target.armorStrip };
  }
  const rates = procRates(result);
  const viral = viralBonus(steadyStacks(rates.viral, STATUS_RULES.viral.duration, STATUS_RULES.viral.maxStacks));
  const corrosive = corrosiveStrip(steadyStacks(rates.corrosive, STATUS_RULES.corrosive.duration, STATUS_RULES.corrosive.maxStacks));
  const heatUptime = Math.min(1, rates.heat * STATUS_RULES.heat.duration);
  const armorStrip = combinedStrip(target.armorStrip, corrosive, STATUS_RULES.heat.strip * heatUptime);
  const stripped = { ...target, armorStrip };
  const boost = 1 + viral;
  const direct = result.burstDps * enemyMultiplier(result.damage, stripped) * boost;

  const hit = result.totalPerPellet * result.averageCrit * result.factionMultiplier;
  const armorFactor = 1 - armorReduction(stripped.armor, armorStrip);
  const dot = (type: DamageType, perTick: number, ticks: number, ignoresArmor: boolean) =>
    rates[type] * perTick * ticks * hit * typeMultiplier(type, stripped) * (ignoresArmor ? 1 : armorFactor) * boost;
  const dotDps = dot('slash', STATUS_RULES.slash.dotPerTick, STATUS_RULES.slash.ticks, true)
    + dot('heat', STATUS_RULES.heat.dotPerTick, STATUS_RULES.heat.ticks, false)
    + dot('toxin', STATUS_RULES.toxin.dotPerTick, STATUS_RULES.toxin.ticks, false);
  return { direct, dot: dotDps, total: direct + dotDps, viralBonus: viral, armorStrip };
}
