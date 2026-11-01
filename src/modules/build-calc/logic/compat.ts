import type { ArcaneEntry, FrameEntry, ModEntry, ModType, WeaponClass, WeaponEntry } from '../../../data/catalog';
import { parseStatLines, statsAtRank, type ParsedLines } from './modStats';

const MOD_TYPE_BY_CATEGORY: Readonly<Record<WeaponEntry['category'], ModType>> = { primary: 'PRIMARY', secondary: 'SECONDARY', melee: 'MELEE' };

/** compatName values that apply to a whole weapon class. */
const CLASS_COMPAT: Readonly<Record<WeaponClass, readonly string[]>> = {
  Rifle: ['Rifle', 'Assault Rifle'],
  Sniper: ['Rifle', 'Sniper'],
  Bow: ['Rifle', 'Bow'],
  Shotgun: ['Shotgun'],
  Pistol: ['Pistol'],
  Melee: ['Melee'],
};
const GENERIC_COMPAT: ReadonlySet<string> = new Set(['ANY', 'PRIMARY', 'SECONDARY', 'MELEE', 'WARFRAME', 'AURA']);
const MIN_AUGMENT_NAME = 3;

/** Augments use the item name as compatName (e.g. "Soma" for Soma Prime). */
function isAugmentFor(compatName: string, itemName: string): boolean {
  return compatName.length >= MIN_AUGMENT_NAME && !GENERIC_COMPAT.has(compatName) && itemName.toLowerCase().includes(compatName.toLowerCase());
}

/** Stats of a mod at a rank; mods with a trigger description are conditional as a whole. */
export function modRankStats(mod: ModEntry, rank: number): ParsedLines {
  const parsed = parseStatLines(statsAtRank(mod.stats, Math.min(rank, mod.fusionLimit)));
  return mod.conditional ? { ...parsed, stats: parsed.stats.map((s) => ({ ...s, conditional: true })) } : parsed;
}

export function weaponCompatible(mod: ModEntry, weapon: WeaponEntry): boolean {
  if (mod.type !== MOD_TYPE_BY_CATEGORY[weapon.category]) return false;
  if (mod.semiAutoOnly && weapon.trigger !== 'SEMI') return false;
  return GENERIC_COMPAT.has(mod.compatName) || CLASS_COMPAT[weapon.weaponClass].includes(mod.compatName) || isAugmentFor(mod.compatName, weapon.name.en);
}

export function frameCompatible(mod: ModEntry, frame: FrameEntry): boolean {
  if (mod.type !== 'WARFRAME') return false;
  return GENERIC_COMPAT.has(mod.compatName) || isAugmentFor(mod.compatName, frame.name.en);
}

export const isAura = (mod: ModEntry): boolean => mod.type === 'AURA';

export function weaponArcanes(arcanes: readonly ArcaneEntry[], weapon: WeaponEntry): ArcaneEntry[] {
  return arcanes.filter((a) => a.target === weapon.category);
}

export function frameArcanes(arcanes: readonly ArcaneEntry[]): ArcaneEntry[] {
  return arcanes.filter((a) => a.target === 'warframe');
}
