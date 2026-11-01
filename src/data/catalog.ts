/**
 * Builds a compact, localized catalog from the official Public Export files.
 * Pure function: the server runs it once per data refresh and caches the result.
 */

export interface LocalName {
  readonly en: string;
  readonly ru: string;
}

export type WeaponCategory = 'primary' | 'secondary' | 'melee';
export type WeaponClass = 'Rifle' | 'Shotgun' | 'Bow' | 'Sniper' | 'Pistol' | 'Melee';
export type ModType = 'PRIMARY' | 'SECONDARY' | 'MELEE' | 'WARFRAME' | 'AURA';
export type ArcaneTarget = 'warframe' | 'primary' | 'secondary' | 'melee' | 'other';

export interface WeaponEntry {
  readonly uniqueName: string;
  readonly name: LocalName;
  readonly category: WeaponCategory;
  readonly weaponClass: WeaponClass;
  readonly damage: readonly number[];
  readonly critChance: number;
  readonly critMultiplier: number;
  readonly statusChance: number;
  readonly fireRate: number;
  readonly multishot: number;
  readonly magazine: number;
  readonly reload: number;
  readonly masteryReq: number;
  /** AUTO, SEMI, BURST, CHARGE, HELD... */
  readonly trigger?: string;
}

export interface FrameEntry {
  readonly uniqueName: string;
  readonly name: LocalName;
  readonly health: number;
  readonly shield: number;
  readonly armor: number;
  readonly energy: number;
  readonly sprint: number;
  readonly masteryReq: number;
  readonly abilities: readonly LocalName[];
}

export interface ModEntry {
  readonly uniqueName: string;
  readonly name: LocalName;
  readonly polarity: string;
  readonly rarity: string;
  readonly baseDrain: number;
  readonly fusionLimit: number;
  readonly type: ModType;
  readonly compatName: string;
  readonly isUtility: boolean;
  readonly family: string;
  /** English stat lines per rank (index = rank). Used for calculations. */
  readonly stats: readonly (readonly string[])[];
  /** Russian stat lines at max rank. Used for display. */
  readonly statsRu: readonly string[];
  /** "Only compatible with Semi-Auto Trigger." */
  readonly semiAutoOnly?: boolean;
  /** "Fire Rate cannot be modified." */
  readonly locksFireRate?: boolean;
  /** The description starts with a trigger ("On Hit:", "When Aiming:"), so every stat is conditional. */
  readonly conditional?: boolean;
}

export interface ArcaneEntry {
  readonly uniqueName: string;
  readonly name: LocalName;
  readonly rarity: string;
  readonly target: ArcaneTarget;
  readonly stats: readonly (readonly string[])[];
  readonly statsRu: readonly string[];
}

export interface RelicEntry {
  readonly name: LocalName;
  readonly tier: string;
  readonly uniqueNames: readonly string[];
  readonly rewards: readonly { readonly uniqueName: string; readonly rarity: string }[];
}

export interface RecipeEntry {
  readonly uniqueName: string;
  readonly resultType: string;
  readonly ingredients: readonly { readonly uniqueName: string; readonly count: number }[];
}

export interface Catalog {
  readonly weapons: readonly WeaponEntry[];
  readonly frames: readonly FrameEntry[];
  readonly mods: readonly ModEntry[];
  readonly arcanes: readonly ArcaneEntry[];
  readonly relics: readonly RelicEntry[];
  readonly recipes: readonly RecipeEntry[];
  readonly names: Readonly<Record<string, LocalName>>;
  /** uniqueName → official icon URL (ExportManifest). */
  readonly images: Readonly<Record<string, string>>;
}

type Raw = Record<string, unknown>;

interface ExportSet {
  readonly weapons?: unknown;
  readonly warframes?: unknown;
  readonly upgrades?: unknown;
  readonly relicArcane?: unknown;
  readonly resources?: unknown;
}

export interface CatalogInput {
  readonly en: ExportSet;
  readonly ru: ExportSet;
  readonly recipes: unknown;
  /** ExportManifest.json: item icons. */
  readonly manifest?: unknown;
}

const IMAGE_ORIGIN = 'https://content.warframe.com/PublicExport';

const WEAPON_CATEGORIES: Readonly<Record<string, WeaponCategory>> = { LongGuns: 'primary', Pistols: 'secondary', Melee: 'melee' };
const MOD_TYPES: ReadonlySet<string> = new Set(['PRIMARY', 'SECONDARY', 'MELEE', 'WARFRAME', 'AURA']);
const EXCLUDED_MOD_PATHS = ['/PvPMods/', '/Randomized/'];
const PRIMARY_ARCANE = /^(Primary|Shotgun|Longbow|Rifle) /;
const SECONDARY_ARCANE = /^(Secondary|Pistol|Akimbo|Fractalized) /;
const FRAME_ARCANE_PATHS = ['/Offensive/', '/Defensive/', '/Utility/', '/Zariman/'];

function list(section: unknown, key: string): readonly Raw[] {
  const value = (section as Raw | undefined)?.[key];
  return Array.isArray(value) ? (value as Raw[]) : [];
}

const str = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);
const num = (value: unknown, fallback = 0): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

function ruLookup(items: readonly Raw[]): ReadonlyMap<string, Raw> {
  return new Map(items.map((item) => [str(item.uniqueName), item]));
}

function localName(en: Raw, ru: Raw | undefined): LocalName {
  const enName = str(en.name);
  return { en: enName, ru: str(ru?.name) || enName };
}

function levelStats(item: Raw | undefined): readonly (readonly string[])[] {
  const levels = Array.isArray(item?.levelStats) ? (item.levelStats as Raw[]) : [];
  return levels.map((level) => (Array.isArray(level.stats) ? (level.stats as unknown[]).map((s) => str(s)) : []));
}

function weaponClass(category: WeaponCategory, path: string): WeaponClass {
  if (category === 'secondary') return 'Pistol';
  if (category === 'melee') return 'Melee';
  if (/Shotgun/i.test(path)) return 'Shotgun';
  if (/Bows?\//i.test(path)) return 'Bow';
  if (/Sniper/i.test(path)) return 'Sniper';
  return 'Rifle';
}

function buildWeapons(en: readonly Raw[], ru: ReadonlyMap<string, Raw>): WeaponEntry[] {
  return en.flatMap((w) => {
    const category = WEAPON_CATEGORIES[str(w.productCategory)];
    if (!category) return [];
    const uniqueName = str(w.uniqueName);
    const damage = Array.isArray(w.damagePerShot) ? (w.damagePerShot as unknown[]).map((d) => num(d)) : [];
    return [{
      uniqueName,
      name: localName(w, ru.get(uniqueName)),
      category,
      weaponClass: weaponClass(category, uniqueName),
      damage,
      critChance: num(w.criticalChance),
      critMultiplier: num(w.criticalMultiplier, 1),
      statusChance: num(w.procChance),
      fireRate: num(w.fireRate, 1),
      multishot: num(w.multishot, 1),
      magazine: num(w.magazineSize),
      reload: num(w.reloadTime),
      masteryReq: num(w.masteryReq),
      ...(str(w.trigger) ? { trigger: str(w.trigger).toUpperCase() } : {}),
    }];
  });
}

function buildFrames(en: readonly Raw[], ru: ReadonlyMap<string, Raw>): FrameEntry[] {
  return en
    .filter((f) => str(f.productCategory) === 'Suits')
    .map((f) => {
      const uniqueName = str(f.uniqueName);
      const ruFrame = ru.get(uniqueName);
      const ruAbilities = Array.isArray(ruFrame?.abilities) ? (ruFrame.abilities as Raw[]) : [];
      const abilities = (Array.isArray(f.abilities) ? (f.abilities as Raw[]) : []).map((a, i) => ({
        en: str(a.abilityName),
        ru: str(ruAbilities[i]?.abilityName) || str(a.abilityName),
      }));
      return {
        uniqueName,
        name: localName(f, ruFrame),
        health: num(f.health),
        shield: num(f.shield),
        armor: num(f.armor),
        energy: num(f.power),
        sprint: num(f.sprintSpeed, 1),
        masteryReq: num(f.masteryReq),
        abilities,
      };
    });
}

const VARIANT_PREFIX = /^(Primed|Archon|Umbral|Amalgam|Flawed) /i;
/** Variant stems whose base mod has a longer name. */
const STEM_ALIASES: Readonly<Record<string, string>> = { fiber: 'steel fiber' };

/**
 * Only one mod per family may be equipped: Primed, Archon, Umbral and Amalgam
 * versions replace the base mod. Galvanized mods are separate in the game.
 */
export function familyKey(type: string, englishName: string): string {
  const stem = englishName.trim().replace(VARIANT_PREFIX, '').toLowerCase();
  return `${type}:${STEM_ALIASES[stem] ?? stem}`;
}

/**
 * Tutorial (Beginner/Intermediate) variants and "Expert" variants that are not
 * named "Primed ..." share the regular mod's name but have other numbers;
 * players cannot equip them, so they would skew the optimizer.
 */
function isHiddenVariant(uniqueName: string, name: string): boolean {
  if (/\/(Beginner|Intermediate)\//.test(uniqueName)) return true;
  return /\/Expert\//.test(uniqueName) && !/^Primed /i.test(name);
}

function maxRankRu(item: Raw | undefined): readonly string[] {
  const stats = levelStats(item);
  return stats.length > 0 ? stats[stats.length - 1] : [];
}

function buildMods(en: readonly Raw[], ru: ReadonlyMap<string, Raw>): ModEntry[] {
  return en.flatMap((m) => {
    const uniqueName = str(m.uniqueName);
    const type = str(m.type);
    const stats = levelStats(m);
    if (!MOD_TYPES.has(type) || stats.length === 0 || EXCLUDED_MOD_PATHS.some((p) => uniqueName.includes(p))) return [];
    if (isHiddenVariant(uniqueName, str(m.name))) return [];
    const ruMod = ru.get(uniqueName);
    const description = Array.isArray(m.description) ? (m.description as unknown[]).map((d) => str(d).trim()) : [];
    return [{
      uniqueName,
      name: localName(m, ruMod),
      semiAutoOnly: description.some((d) => /Only compatible with Semi-Auto Trigger/i.test(d)),
      locksFireRate: description.some((d) => /Fire Rate cannot be modified/i.test(d)),
      conditional: description.some((d) => d.endsWith(':')),
      polarity: str(m.polarity),
      rarity: str(m.rarity),
      baseDrain: num(m.baseDrain),
      fusionLimit: num(m.fusionLimit),
      type: type as ModType,
      compatName: str(m.compatName),
      isUtility: m.isUtility === true,
      family: familyKey(type, str(m.name)),
      stats,
      statsRu: maxRankRu(ruMod),
    }];
  });
}

function arcaneTarget(name: string, path: string): ArcaneTarget {
  if (PRIMARY_ARCANE.test(name)) return 'primary';
  if (SECONDARY_ARCANE.test(name)) return 'secondary';
  if (/^Melee /.test(name)) return 'melee';
  if (FRAME_ARCANE_PATHS.some((p) => path.includes(p))) return 'warframe';
  return 'other';
}

function buildArcanes(en: readonly Raw[], ru: ReadonlyMap<string, Raw>): ArcaneEntry[] {
  return en
    .filter((a) => !Array.isArray(a.relicRewards))
    .map((a) => {
      const uniqueName = str(a.uniqueName);
      const ruArcane = ru.get(uniqueName);
      return {
        uniqueName,
        name: localName(a, ruArcane),
        rarity: str(a.rarity),
        target: arcaneTarget(str(a.name), uniqueName),
        stats: levelStats(a),
        statsRu: maxRankRu(ruArcane),
      };
    });
}

export function stripStoreItemsPath(path: string): string {
  return path.replace('/StoreItems/', '/');
}

function buildRelics(en: readonly Raw[], ru: ReadonlyMap<string, Raw>): RelicEntry[] {
  const byName = new Map<string, RelicEntry>();
  for (const relic of en.filter((r) => Array.isArray(r.relicRewards))) {
    const uniqueName = str(relic.uniqueName);
    const name = str(relic.name);
    const existing = byName.get(name);
    if (existing) {
      byName.set(name, { ...existing, uniqueNames: [...existing.uniqueNames, uniqueName] });
      continue;
    }
    const rewards = (relic.relicRewards as Raw[]).map((r) => ({ uniqueName: stripStoreItemsPath(str(r.rewardName)), rarity: str(r.rarity) }));
    byName.set(name, { name: localName(relic, ru.get(uniqueName)), tier: name.split(' ')[0], uniqueNames: [uniqueName], rewards });
  }
  return [...byName.values()];
}

function buildRecipes(raw: unknown): RecipeEntry[] {
  return list(raw, 'ExportRecipes').map((r) => ({
    uniqueName: str(r.uniqueName),
    resultType: str(r.resultType),
    ingredients: (Array.isArray(r.ingredients) ? (r.ingredients as Raw[]) : []).map((i) => ({ uniqueName: str(i.ItemType), count: num(i.ItemCount, 1) })),
  }));
}

interface Named {
  readonly uniqueName: string;
  readonly name: LocalName;
}

function buildNames(groups: readonly (readonly Named[])[], resources: readonly Raw[], ru: ReadonlyMap<string, Raw>): Record<string, LocalName> {
  const entries = [
    ...resources.map((r) => [str(r.uniqueName), localName(r, ru.get(str(r.uniqueName)))] as const),
    ...groups.flat().map((item) => [item.uniqueName, item.name] as const),
  ];
  return Object.fromEntries(entries);
}

export function buildCatalog(input: CatalogInput): Catalog {
  const pick = (key: keyof ExportSet, exportKey: string) => ({
    en: list(input.en[key], exportKey),
    ru: ruLookup(list(input.ru[key], exportKey)),
  });
  const weapons = pick('weapons', 'ExportWeapons');
  const frames = pick('warframes', 'ExportWarframes');
  const upgrades = pick('upgrades', 'ExportUpgrades');
  const relicArcane = pick('relicArcane', 'ExportRelicArcane');
  const resources = pick('resources', 'ExportResources');

  const catalog = {
    weapons: buildWeapons(weapons.en, weapons.ru),
    frames: buildFrames(frames.en, frames.ru),
    mods: buildMods(upgrades.en, upgrades.ru),
    arcanes: buildArcanes(relicArcane.en, relicArcane.ru),
    relics: buildRelics(relicArcane.en, relicArcane.ru),
    recipes: buildRecipes(input.recipes),
  };
  const relicNames = catalog.relics.flatMap((r) => r.uniqueNames.map((uniqueName) => ({ uniqueName, name: r.name })));
  const names = buildNames([catalog.weapons, catalog.frames, catalog.mods, catalog.arcanes, relicNames], resources.en, resources.ru);
  return { ...catalog, names, images: buildImages(input.manifest, names) };
}

/** Keeps icons only for items the catalog knows, to keep the payload small. */
function buildImages(manifest: unknown, names: Readonly<Record<string, LocalName>>): Record<string, string> {
  const entries = list(manifest, 'Manifest')
    .filter((m) => str(m.textureLocation) && names[str(m.uniqueName)])
    .map((m) => [str(m.uniqueName), `${IMAGE_ORIGIN}${str(m.textureLocation)}`] as const);
  return Object.fromEntries(entries);
}
