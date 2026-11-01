import {
  COMPOUND_ELEMENTS, DAMAGE_TYPES, PHYSICAL, PRIMARY_ELEMENTS, combine, type DamageType, type Faction,
} from './damageTypes';
import { statContribution, sumStats, type ParsedStat, type StatTotals } from './modStats';

export interface WeaponBase {
  readonly damage: readonly number[];
  readonly critChance: number;
  readonly critMultiplier: number;
  readonly statusChance: number;
  readonly fireRate: number;
  readonly multishot: number;
  readonly magazine: number;
  readonly reload: number;
  readonly isBow: boolean;
}

export interface WeaponOptions {
  readonly conditional: boolean;
  readonly faction?: Faction;
  /** Set when a mod like Semi-Rifle Cannonade forbids fire rate changes. */
  readonly fireRateLocked?: boolean;
  readonly comboMultiplier?: number;
  readonly statusTypes?: number;
}

/**
 * Kuva/Tenet/Coda weapons carry a bonus element worth a share of base damage.
 * It joins the base damage as an innate element, so mods scale from it too.
 */
export function withBonusElement(base: WeaponBase, element: DamageType | undefined, fraction: number): WeaponBase {
  if (!element || fraction <= 0) return base;
  const total = base.damage.reduce((sum, d) => sum + d, 0);
  const index = DAMAGE_TYPES.indexOf(element);
  const damage = DAMAGE_TYPES.map((_, i) => (base.damage[i] ?? 0) + (i === index ? total * fraction : 0));
  return { ...base, damage };
}

export interface WeaponResult {
  readonly damage: Readonly<Record<DamageType, number>>;
  readonly totalPerPellet: number;
  readonly critChance: number;
  readonly critMultiplier: number;
  readonly averageCrit: number;
  readonly statusChance: number;
  readonly multishot: number;
  readonly fireRate: number;
  readonly magazine: number;
  readonly reloadTime: number;
  readonly factionMultiplier: number;
  readonly burstDps: number;
  readonly sustainedDps: number;
  readonly procsPerSecond: number;
}

interface ElementPart {
  readonly type: DamageType;
  readonly amount: number;
}

const MIN_RELOAD_FACTOR = 0.01;

/** Expected damage multiplier from crits; linear in crit chance, so it also covers orange/red crits. */
export function averageCritMultiplier(critChance: number, critMultiplier: number): number {
  return 1 + Math.max(0, critChance) * (critMultiplier - 1);
}

function addPart(parts: readonly ElementPart[], type: DamageType, amount: number): readonly ElementPart[] {
  const index = parts.findIndex((p) => p.type === type);
  if (index === -1) return [...parts, { type, amount }];
  return parts.map((p, i) => (i === index ? { type, amount: p.amount + amount } : p));
}

/** Mod elements in slot order, then innate ones; equal elements merge into the first position. */
function elementOrder(base: WeaponBase, modStats: readonly (readonly ParsedStat[])[], scale: number, options: WeaponOptions): readonly ElementPart[] {
  const baseTotal = base.damage.reduce((sum, d) => sum + d, 0);
  const fromMods = modStats.flat().reduce<readonly ElementPart[]>((parts, stat) => {
    if (!PRIMARY_ELEMENTS.includes(stat.key as DamageType)) return parts;
    const value = statContribution(stat, options);
    return value === 0 ? parts : addPart(parts, stat.key as DamageType, baseTotal * scale * value);
  }, []);
  return PRIMARY_ELEMENTS.reduce((parts, type) => {
    const innate = base.damage[DAMAGE_TYPES.indexOf(type)] ?? 0;
    return innate > 0 ? addPart(parts, type, innate * scale) : parts;
  }, fromMods);
}

function combinePairs(parts: readonly ElementPart[]): readonly ElementPart[] {
  const result: ElementPart[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const [a, b] = [parts[i], parts[i + 1]];
    const compound = b ? combine(a.type, b.type) : undefined;
    if (b && compound) result.push({ type: compound, amount: a.amount + b.amount });
    else result.push(...(b ? [a, b] : [a]));
  }
  return result;
}

function damageByType(base: WeaponBase, modStats: readonly (readonly ParsedStat[])[], totals: StatTotals, options: WeaponOptions): Record<DamageType, number> {
  const scale = 1 + (totals.damage ?? 0);
  const baseTotal = base.damage.reduce((sum, d) => sum + d, 0);
  const result = Object.fromEntries(DAMAGE_TYPES.map((type, i) => {
    const value = base.damage[i] ?? 0;
    if (PRIMARY_ELEMENTS.includes(type)) return [type, 0];
    if (PHYSICAL.includes(type)) return [type, value * scale * (1 + (totals[type] ?? 0))];
    const modded = COMPOUND_ELEMENTS.includes(type) ? baseTotal * scale * (totals[type] ?? 0) : 0;
    return [type, value * scale + modded];
  })) as Record<DamageType, number>;
  for (const part of combinePairs(elementOrder(base, modStats, scale, options))) {
    result[part.type] += part.amount;
  }
  return result;
}

export function computeWeapon(base: WeaponBase, modStats: readonly (readonly ParsedStat[])[], options: WeaponOptions): WeaponResult {
  const totals = sumStats(modStats.flat(), { ...options, isBow: base.isBow });
  const damage = damageByType(base, modStats, totals, options);
  const totalPerPellet = Object.values(damage).reduce((sum, d) => sum + d, 0);
  const critChance = base.critChance * (1 + (totals.critChance ?? 0));
  const critMultiplier = base.critMultiplier * (1 + (totals.critDamage ?? 0));
  const averageCrit = averageCritMultiplier(critChance, critMultiplier);
  const statusChance = base.statusChance * (1 + (totals.statusChance ?? 0));
  const multishot = base.multishot * (1 + (totals.multishot ?? 0));
  const fireRate = Math.max(0, base.fireRate * (1 + (options.fireRateLocked ? 0 : totals.fireRate ?? 0)));
  const magazine = Math.round(base.magazine * (1 + (totals.magazine ?? 0)));
  const reloadTime = base.reload / Math.max(MIN_RELOAD_FACTOR, 1 + (totals.reloadSpeed ?? 0));
  const factionMultiplier = options.faction ? 1 + (totals[`faction${options.faction}`] ?? 0) : 1;
  const burstDps = totalPerPellet * multishot * averageCrit * fireRate * factionMultiplier;
  const firingTime = fireRate > 0 && magazine > 0 ? magazine / fireRate : 0;
  const uptime = firingTime > 0 && reloadTime > 0 ? firingTime / (firingTime + reloadTime) : 1;
  return {
    damage, totalPerPellet, critChance, critMultiplier, averageCrit, statusChance, multishot, fireRate, magazine, reloadTime,
    factionMultiplier, burstDps, sustainedDps: burstDps * uptime,
    procsPerSecond: Math.min(1, statusChance) * multishot * fireRate,
  };
}
