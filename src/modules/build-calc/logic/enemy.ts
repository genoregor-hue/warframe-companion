/**
 * Target model: armor damage reduction plus faction weaknesses/resistances.
 * Formulas: DR = armor / (armor + 300), capped at 90%; weakness ×1.5, resistance ×0.5.
 * Faction presets come from game knowledge, not from the official export (see README).
 */
import { DAMAGE_TYPES, type DamageType } from './damageTypes';

export interface EnemyProfile {
  readonly armor: number;
  /** 0..1 — share of armor removed (Corrosive/Heat procs, abilities). */
  readonly armorStrip: number;
  readonly weak: readonly DamageType[];
  readonly resist: readonly DamageType[];
}

export interface EnemyPreset extends EnemyProfile {
  readonly label: string;
}

export type EnemyPresetId = 'none' | 'grineer' | 'corpus' | 'infested';

const ARMOR_CONSTANT = 300;
const MAX_REDUCTION = 0.9;
const WEAKNESS = 1.5;
const RESISTANCE = 0.5;
/** Mid-level heavy Grineer; players adjust it to the enemy level they fight. */
const DEFAULT_GRINEER_ARMOR = 500;

export const ENEMY_PRESETS: Readonly<Record<EnemyPresetId, EnemyPreset>> = {
  none: { label: 'Без брони и уязвимостей', armor: 0, armorStrip: 0, weak: [], resist: [] },
  grineer: { label: 'Гринир', armor: DEFAULT_GRINEER_ARMOR, armorStrip: 0, weak: ['impact', 'corrosive'], resist: [] },
  corpus: { label: 'Корпус', armor: 0, armorStrip: 0, weak: ['puncture', 'magnetic'], resist: [] },
  infested: { label: 'Заражённые', armor: 0, armorStrip: 0, weak: ['slash', 'heat'], resist: [] },
};

export function armorReduction(armor: number, armorStrip: number): number {
  const effective = Math.max(0, armor) * (1 - Math.min(1, Math.max(0, armorStrip)));
  if (effective === 0) return 0;
  return Math.min(MAX_REDUCTION, effective / (effective + ARMOR_CONSTANT));
}

export function typeMultiplier(type: DamageType, enemy: EnemyProfile): number {
  if (enemy.weak.includes(type)) return WEAKNESS;
  if (enemy.resist.includes(type)) return RESISTANCE;
  return 1;
}

/** Share of the listed damage that actually lands on this enemy (true damage ignores armor). */
export function enemyMultiplier(damage: Readonly<Record<DamageType, number>>, enemy: EnemyProfile): number {
  const total = DAMAGE_TYPES.reduce((sum, t) => sum + damage[t], 0);
  if (total <= 0) return 0;
  const armorFactor = 1 - armorReduction(enemy.armor, enemy.armorStrip);
  const landed = DAMAGE_TYPES.reduce((sum, t) => sum + damage[t] * typeMultiplier(t, enemy) * (t === 'true' ? 1 : armorFactor), 0);
  return landed / total;
}
