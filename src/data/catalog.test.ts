import { describe, expect, it } from 'vitest';
import { buildCatalog, familyKey, type CatalogInput } from './catalog';

const damage = (impact: number, puncture: number, slash: number) => [impact, puncture, slash, ...Array(17).fill(0)];

function input(): CatalogInput {
  const weapon = (uniqueName: string, name: string, category: string) => ({
    uniqueName, name, productCategory: category, damagePerShot: damage(1, 2, 3), totalDamage: 6,
    criticalChance: 0.2, criticalMultiplier: 2, procChance: 0.1, fireRate: 5, masteryReq: 0,
    multishot: 1, magazineSize: 30, reloadTime: 2,
  });
  const mod = (uniqueName: string, name: string, extra: Record<string, unknown> = {}) => ({
    uniqueName, name, polarity: 'AP_ATTACK', rarity: 'RARE', baseDrain: 4, fusionLimit: 2,
    compatName: 'Rifle', type: 'PRIMARY', levelStats: [{ stats: ['+10% Damage'] }, { stats: ['+20% Damage'] }, { stats: ['+30% Damage'] }],
    ...extra,
  });
  const en = {
    weapons: { ExportWeapons: [
      weapon('/W/Shotgun/Hek', 'Hek', 'LongGuns'),
      weapon('/W/LongGuns/Soma', 'Soma', 'LongGuns'),
      weapon('/W/Bows/Paris', 'Paris', 'LongGuns'),
      weapon('/W/Pistols/Lex', 'Lex', 'Pistols'),
      weapon('/W/Melee/Skana', 'Skana', 'Melee'),
      weapon('/W/Space/Gun', 'Archgun', 'SpaceGuns'),
    ] },
    warframes: { ExportWarframes: [
      { uniqueName: '/P/Excal', name: 'Excalibur', health: 270, shield: 270, armor: 225, power: 100, sprintSpeed: 1, masteryReq: 0, productCategory: 'Suits', abilities: [{ abilityName: 'Slash Dash' }] },
      { uniqueName: '/P/Arch', name: 'Itzal', health: 1, shield: 1, armor: 1, power: 1, productCategory: 'SpaceSuits', abilities: [] },
    ] },
    upgrades: { ExportUpgrades: [
      mod('/U/Mods/Rifle/Serration', 'Serration'),
      mod('/U/Mods/Rifle/Expert/SerrationExpert', 'Primed Serration'),
      mod('/U/Mods/PvPMods/Rifle/Thing', 'Conclave Thing'),
      mod('/U/Mods/Randomized/RifleRiven', 'Riven'),
      mod('/U/Mods/Warframe/Stance', 'Stance', { type: 'STANCE' }),
      mod('/U/Mods/Warframe/Aura', 'Steel Charge', { type: 'AURA', baseDrain: -4 }),
    ] },
    relicArcane: { ExportRelicArcane: [
      { uniqueName: '/R/T4A1Bronze', name: 'Axi A1 Relic', relicRewards: [{ rewardName: '/Lotus/StoreItems/Types/Recipes/SomaPrimeBarrel', rarity: 'RARE', tier: 0, itemCount: 1 }] },
      { uniqueName: '/R/T4A1Gold', name: 'Axi A1 Relic', relicRewards: [{ rewardName: '/Lotus/StoreItems/Types/Recipes/SomaPrimeBarrel', rarity: 'RARE', tier: 0, itemCount: 1 }] },
      { uniqueName: '/A/Offensive/PrimaryMerciless', name: 'Primary Merciless', rarity: 'RARE', levelStats: [{ stats: ['+5% Damage'] }] },
      { uniqueName: '/A/Defensive/Grace', name: 'Arcane Grace', rarity: 'LEGENDARY', levelStats: [{ stats: ['+1 Arcane Revive'] }] },
      { uniqueName: '/A/OperatorAmps/Thing', name: 'Virtuos Null', rarity: 'RARE', levelStats: [{ stats: ['x'] }] },
    ] },
    resources: { ExportResources: [{ uniqueName: '/Lotus/Types/Recipes/SomaPrimeBarrel', name: 'Soma Prime Barrel' }] },
  };
  const ru = JSON.parse(JSON.stringify(en)) as typeof en;
  ru.weapons.ExportWeapons[1].name = 'Сома';
  ru.upgrades.ExportUpgrades[0].name = 'Зазубрины';
  ru.upgrades.ExportUpgrades[0].levelStats = [{ stats: ['+10% урона'] }, { stats: ['+20% урона'] }, { stats: ['+30% урона'] }];
  ru.relicArcane.ExportRelicArcane[0].name = 'Акси A1 Реликвия';
  return {
    en, ru,
    recipes: { ExportRecipes: [{ uniqueName: '/Rec/SomaPrimeBlueprint', resultType: '/W/LongGuns/Soma', ingredients: [{ ItemType: '/Lotus/Types/Recipes/SomaPrimeBarrel', ItemCount: 1 }] }] },
  };
}

describe('buildCatalog', () => {
  const catalog = buildCatalog(input());

  it('keeps only player weapon categories and merges localized names', () => {
    expect(catalog.weapons.map((w) => w.name.en)).toEqual(['Hek', 'Soma', 'Paris', 'Lex', 'Skana']);
    expect(catalog.weapons[1].name).toEqual({ en: 'Soma', ru: 'Сома' });
  });

  it('detects weapon classes from category and path', () => {
    expect(catalog.weapons.map((w) => w.weaponClass)).toEqual(['Shotgun', 'Rifle', 'Bow', 'Pistol', 'Melee']);
    expect(catalog.weapons.map((w) => w.category)).toEqual(['primary', 'primary', 'primary', 'secondary', 'melee']);
  });

  it('copies base weapon stats', () => {
    expect(catalog.weapons[1]).toMatchObject({ critChance: 0.2, critMultiplier: 2, statusChance: 0.1, fireRate: 5, multishot: 1, magazine: 30, reload: 2 });
    expect(catalog.weapons[1].damage.slice(0, 3)).toEqual([1, 2, 3]);
  });

  it('keeps only regular warframes', () => {
    expect(catalog.frames.map((f) => f.name.en)).toEqual(['Excalibur']);
    expect(catalog.frames[0]).toMatchObject({ health: 270, shield: 270, armor: 225, energy: 100 });
  });

  it('drops pvp, riven and stance mods', () => {
    expect(catalog.mods.map((m) => m.name.en)).toEqual(['Serration', 'Primed Serration', 'Steel Charge']);
  });

  it('drops hidden rank variants that are not real Primed mods', () => {
    const base = input();
    const extra = [
      { ...(base.en.upgrades as { ExportUpgrades: Record<string, unknown>[] }).ExportUpgrades[0], uniqueName: '/U/Mods/Rifle/Expert/PointStrikeExpert', name: 'Point Strike' },
      { ...(base.en.upgrades as { ExportUpgrades: Record<string, unknown>[] }).ExportUpgrades[0], uniqueName: '/U/Mods/Rifle/Beginner/SerrationBeginner', name: 'Serration' },
    ];
    const withVariants = { ...base, en: { ...base.en, upgrades: { ExportUpgrades: [...(base.en.upgrades as { ExportUpgrades: unknown[] }).ExportUpgrades, ...extra] } } };
    expect(buildCatalog(withVariants).mods.map((m) => m.uniqueName)).not.toEqual(expect.arrayContaining(['/U/Mods/Rifle/Expert/PointStrikeExpert']));
    expect(buildCatalog(withVariants).mods.map((m) => m.uniqueName)).not.toContain('/U/Mods/Rifle/Beginner/SerrationBeginner');
  });

  it('keeps per-rank english stats and max-rank russian stats', () => {
    const serration = catalog.mods[0];
    expect(serration.stats).toEqual([['+10% Damage'], ['+20% Damage'], ['+30% Damage']]);
    expect(serration.statsRu).toEqual(['+30% урона']);
  });

  it('groups primed and regular mods into one family', () => {
    expect(catalog.mods[0].family).toBe(catalog.mods[1].family);
  });

  it('classifies arcanes by target', () => {
    expect(catalog.arcanes.map((a) => [a.name.en, a.target])).toEqual([
      ['Primary Merciless', 'primary'], ['Arcane Grace', 'warframe'], ['Virtuos Null', 'other'],
    ]);
  });

  it('merges relic refinements and strips StoreItems from rewards', () => {
    expect(catalog.relics).toEqual([{
      name: { en: 'Axi A1 Relic', ru: 'Акси A1 Реликвия' }, tier: 'Axi',
      uniqueNames: ['/R/T4A1Bronze', '/R/T4A1Gold'],
      rewards: [{ uniqueName: '/Lotus/Types/Recipes/SomaPrimeBarrel', rarity: 'RARE' }],
    }]);
  });

  it('indexes names of all items including parts', () => {
    expect(catalog.names['/Lotus/Types/Recipes/SomaPrimeBarrel']).toEqual({ en: 'Soma Prime Barrel', ru: 'Soma Prime Barrel' });
  });

  it('keeps recipes with ingredients', () => {
    expect(catalog.recipes[0]).toEqual({
      uniqueName: '/Rec/SomaPrimeBlueprint', resultType: '/W/LongGuns/Soma',
      ingredients: [{ uniqueName: '/Lotus/Types/Recipes/SomaPrimeBarrel', count: 1 }],
    });
  });

  it('maps known items to official image URLs from ExportManifest', () => {
    const withManifest = buildCatalog({
      ...input(),
      manifest: { Manifest: [
        { uniqueName: '/W/LongGuns/Soma', textureLocation: '/Lotus/Interface/Icons/Soma.png!00_abc' },
        { uniqueName: '/Unknown/Cosmetic', textureLocation: '/Lotus/Interface/Icons/Scarf.png!00_x' },
        { uniqueName: '/W/Shotgun/Hek' },
      ] },
    });
    expect(withManifest.images).toEqual({ '/W/LongGuns/Soma': 'https://content.warframe.com/PublicExport/Lotus/Interface/Icons/Soma.png!00_abc' });
  });

  it('survives missing export sections', () => {
    const empty = buildCatalog({ en: {}, ru: {}, recipes: {} });
    expect(empty.weapons).toEqual([]);
    expect(empty.relics).toEqual([]);
  });
});

describe('mod restrictions from descriptions', () => {
  const base = input();
  const cannonade = { uniqueName: '/U/Mods/Rifle/Cannonade', name: 'Semi-Rifle Cannonade', polarity: 'AP_DEFENSE', rarity: 'UNCOMMON', baseDrain: 4, fusionLimit: 5,
    compatName: 'Rifle', type: 'PRIMARY', levelStats: [{ stats: ['+240% Damage'] }], description: ['Only compatible with Semi-Auto Trigger. Fire Rate cannot be modified.'] };
  const scope = { ...cannonade, uniqueName: '/U/Mods/Rifle/Scope', name: 'Scope', description: ['When Aiming:'], levelStats: [{ stats: ['+50% Critical Damage'] }] };
  const withMods = {
    ...base,
    en: { ...base.en, upgrades: { ExportUpgrades: [cannonade, scope] }, weapons: { ExportWeapons: [{ ...(base.en.weapons as { ExportWeapons: Record<string, unknown>[] }).ExportWeapons[1], trigger: 'SEMI' }] } },
  };
  const catalog = buildCatalog(withMods);

  it('flags semi-auto-only mods that lock fire rate', () => {
    expect(catalog.mods[0]).toMatchObject({ semiAutoOnly: true, locksFireRate: true, conditional: false });
  });

  it('flags mods whose whole effect needs a trigger', () => {
    expect(catalog.mods[1]).toMatchObject({ semiAutoOnly: false, locksFireRate: false, conditional: true });
  });

  it('keeps the weapon trigger type', () => {
    expect(catalog.weapons[0].trigger).toBe('SEMI');
  });
});

describe('familyKey', () => {
  it('groups Archon, Umbral, Amalgam and Primed variants with the base mod', () => {
    expect(familyKey('WARFRAME', 'Archon Vitality')).toBe(familyKey('WARFRAME', 'Vitality'));
    expect(familyKey('WARFRAME', 'Umbral Vitality')).toBe(familyKey('WARFRAME', 'Vitality'));
    expect(familyKey('WARFRAME', 'Umbral Fiber')).toBe(familyKey('WARFRAME', 'Steel Fiber'));
    expect(familyKey('PRIMARY', 'Amalgam Serration')).toBe(familyKey('PRIMARY', 'Serration'));
    expect(familyKey('WARFRAME', 'Primed Continuity')).toBe(familyKey('WARFRAME', 'Continuity'));
  });

  it('keeps Galvanized mods separate from their base mods', () => {
    expect(familyKey('PRIMARY', 'Galvanized Chamber')).not.toBe(familyKey('PRIMARY', 'Split Chamber'));
  });

  it('separates mod types', () => {
    expect(familyKey('PRIMARY', 'Serration')).not.toBe(familyKey('SECONDARY', 'Serration'));
  });
});

