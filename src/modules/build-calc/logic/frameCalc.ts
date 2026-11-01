import { sumStats, type ParsedStat } from './modStats';

export interface FrameBase {
  readonly health: number;
  readonly shield: number;
  readonly armor: number;
  readonly energy: number;
}

export type ShardType = 'crimson' | 'azure';
export type ShardStat = 'strength' | 'duration' | 'health' | 'shield' | 'armor' | 'energy';

export interface ShardChoice {
  readonly type: ShardType;
  readonly stat: ShardStat;
  readonly tauforged: boolean;
}

export interface ShardOption {
  readonly type: ShardType;
  readonly stat: ShardStat;
  readonly label: string;
  /** Fraction for strength/duration, flat amount otherwise. */
  readonly value: number;
  readonly tauforgedValue: number;
}

/**
 * Archon shard bonuses. The official export has no shard stats, so these are
 * game values kept in one place (README lists them as an assumption).
 */
export const SHARD_OPTIONS: readonly ShardOption[] = [
  { type: 'crimson', stat: 'strength', label: 'Красный: сила способностей', value: 0.1, tauforgedValue: 0.15 },
  { type: 'crimson', stat: 'duration', label: 'Красный: длительность', value: 0.1, tauforgedValue: 0.15 },
  { type: 'azure', stat: 'health', label: 'Лазурный: здоровье', value: 150, tauforgedValue: 225 },
  { type: 'azure', stat: 'shield', label: 'Лазурный: щиты', value: 150, tauforgedValue: 225 },
  { type: 'azure', stat: 'armor', label: 'Лазурный: броня', value: 150, tauforgedValue: 225 },
  { type: 'azure', stat: 'energy', label: 'Лазурный: энергия', value: 50, tauforgedValue: 75 },
];

export const MAX_SHARDS = 5;

function shardTotals(shards: readonly ShardChoice[]): Partial<Record<ShardStat, number>> {
  return shards.slice(0, MAX_SHARDS).reduce<Partial<Record<ShardStat, number>>>((totals, shard) => {
    const option = SHARD_OPTIONS.find((o) => o.type === shard.type && o.stat === shard.stat);
    if (!option) return totals;
    return { ...totals, [shard.stat]: (totals[shard.stat] ?? 0) + (shard.tauforged ? option.tauforgedValue : option.value) };
  }, {});
}

export interface FrameOptions {
  readonly conditional: boolean;
  readonly shards?: readonly ShardChoice[];
}

export interface FrameResult {
  readonly strength: number;
  readonly duration: number;
  readonly range: number;
  readonly efficiency: number;
  readonly health: number;
  readonly shield: number;
  readonly armor: number;
  readonly energy: number;
  readonly damageReduction: number;
  readonly effectiveHealth: number;
}

/**
 * Public Export lists rank 0 values. A rank 30 frame gains +100 health and
 * shields and 50% more energy. Assumption documented in README.
 */
export const RANK30 = { healthBonus: 100, shieldBonus: 100, energyMultiplier: 1.5 } as const;

export const LIMITS = { efficiencyMax: 1.75, durationMin: 0.125, rangeMin: 0.34, strengthMin: 0 } as const;

/** Armor damage reduction constant: DR = armor / (armor + 300). */
const ARMOR_CONSTANT = 300;

export function computeFrame(base: FrameBase, modStats: readonly (readonly ParsedStat[])[], options: FrameOptions): FrameResult {
  const totals = sumStats(modStats.flat(), options);
  const shards = shardTotals(options.shards ?? []);
  // Shard survivability is a flat bonus on top of modded values.
  const health = (base.health + RANK30.healthBonus) * (1 + (totals.health ?? 0)) + (shards.health ?? 0);
  const shield = (base.shield + RANK30.shieldBonus) * (1 + (totals.shield ?? 0)) + (shards.shield ?? 0);
  const armor = base.armor * (1 + (totals.armor ?? 0)) + (shards.armor ?? 0);
  const energy = base.energy * RANK30.energyMultiplier * (1 + (totals.energy ?? 0)) + (shards.energy ?? 0);
  return {
    strength: Math.max(LIMITS.strengthMin, 1 + (totals.strength ?? 0) + (shards.strength ?? 0)),
    duration: Math.max(LIMITS.durationMin, 1 + (totals.duration ?? 0) + (shards.duration ?? 0)),
    range: Math.max(LIMITS.rangeMin, 1 + (totals.range ?? 0)),
    efficiency: Math.min(LIMITS.efficiencyMax, 1 + (totals.efficiency ?? 0)),
    health,
    shield,
    armor,
    energy,
    damageReduction: armor / (armor + ARMOR_CONSTANT),
    effectiveHealth: health * (1 + armor / ARMOR_CONSTANT) + shield,
  };
}
