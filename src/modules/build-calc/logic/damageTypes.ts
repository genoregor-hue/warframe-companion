/** Damage types in the order of the Public Export `damagePerShot` array. */
export const DAMAGE_TYPES = [
  'impact', 'puncture', 'slash', 'heat', 'cold', 'electricity', 'toxin', 'blast', 'radiation', 'gas',
  'magnetic', 'viral', 'corrosive', 'void', 'tau', 'cinematic', 'shieldDrain', 'healthDrain', 'energyDrain', 'true',
] as const;

export type DamageType = (typeof DAMAGE_TYPES)[number];

export const PHYSICAL: readonly DamageType[] = ['impact', 'puncture', 'slash'];
export const PRIMARY_ELEMENTS: readonly DamageType[] = ['heat', 'cold', 'electricity', 'toxin'];
export const COMPOUND_ELEMENTS: readonly DamageType[] = ['blast', 'radiation', 'gas', 'magnetic', 'viral', 'corrosive'];

/** Which two primary elements make each compound element. */
export const COMPOUND_RECIPES: Readonly<Record<string, readonly [DamageType, DamageType]>> = {
  blast: ['heat', 'cold'],
  radiation: ['heat', 'electricity'],
  gas: ['heat', 'toxin'],
  magnetic: ['cold', 'electricity'],
  viral: ['cold', 'toxin'],
  corrosive: ['electricity', 'toxin'],
};

export function combine(a: DamageType, b: DamageType): DamageType | undefined {
  const entry = Object.entries(COMPOUND_RECIPES).find(([, [x, y]]) => (x === a && y === b) || (x === b && y === a));
  return entry?.[0] as DamageType | undefined;
}

/** Color tags used in mod descriptions, e.g. <DT_FIRE_COLOR>Heat. */
export const DT_TAGS: Readonly<Record<string, DamageType>> = {
  DT_IMPACT: 'impact', DT_PUNCTURE: 'puncture', DT_SLASH: 'slash',
  DT_FIRE: 'heat', DT_FREEZE: 'cold', DT_ELECTRICITY: 'electricity', DT_POISON: 'toxin',
  DT_EXPLOSION: 'blast', DT_RADIATION: 'radiation', DT_GAS: 'gas', DT_MAGNETIC: 'magnetic',
  DT_VIRAL: 'viral', DT_CORROSIVE: 'corrosive',
};

export const DAMAGE_LABELS_EN: Readonly<Partial<Record<DamageType, string>>> = {
  impact: 'Impact', puncture: 'Puncture', slash: 'Slash', heat: 'Heat', cold: 'Cold', electricity: 'Electricity',
  toxin: 'Toxin', blast: 'Blast', radiation: 'Radiation', gas: 'Gas', magnetic: 'Magnetic', viral: 'Viral', corrosive: 'Corrosive',
};

export const DAMAGE_LABELS_RU: Readonly<Record<DamageType, string>> = {
  impact: 'Удар', puncture: 'Пронзание', slash: 'Разрез', heat: 'Огонь', cold: 'Холод', electricity: 'Электричество',
  toxin: 'Токсин', blast: 'Взрыв', radiation: 'Радиация', gas: 'Газ', magnetic: 'Магнит', viral: 'Вирус',
  corrosive: 'Коррозия', void: 'Бездна', tau: 'Тау', cinematic: 'Кинематика', shieldDrain: 'Поглощение щитов',
  healthDrain: 'Поглощение здоровья', energyDrain: 'Поглощение энергии', true: 'Чистый',
};

export const FACTIONS = ['Grineer', 'Corpus', 'Infested', 'Orokin', 'Murmur', 'Sentient'] as const;
export type Faction = (typeof FACTIONS)[number];

export const FACTION_LABELS_RU: Readonly<Record<Faction, string>> = {
  Grineer: 'Гринир', Corpus: 'Корпус', Infested: 'Заражённые', Orokin: 'Орокин (порченые)', Murmur: 'Шёпот', Sentient: 'Сентиенты',
};
