import { DAMAGE_LABELS_EN, DT_TAGS, FACTIONS, type DamageType, type Faction } from './damageTypes';

/** Every stat the calculator understands. Unknown lines are reported, not guessed. */
export type StatKey =
  | 'damage' | 'multishot' | 'critChance' | 'critDamage' | 'statusChance' | 'fireRate' | 'magazine' | 'reloadSpeed'
  | DamageType
  | `faction${Faction}`
  | 'strength' | 'duration' | 'range' | 'efficiency' | 'health' | 'shield' | 'armor' | 'energy';

export interface ParsedStat {
  readonly key: StatKey;
  readonly value: number;
  /** Needs a trigger (kill, hit, aim...). Counted only when the user enables conditional bonuses. */
  readonly conditional: boolean;
  readonly maxStacks: number;
  readonly bowMultiplier?: number;
  /** Grows with the melee combo multiplier or with status types on the target. */
  readonly scaling?: 'combo' | 'status';
}

export interface ParsedLines {
  readonly stats: readonly ParsedStat[];
  readonly unknown: readonly string[];
}

export type StatTotals = Partial<Record<StatKey, number>>;

const NAME_KEYS: Readonly<Record<string, StatKey>> = {
  'damage': 'damage', 'melee damage': 'damage', 'multishot': 'multishot',
  'critical chance': 'critChance', 'critical damage': 'critDamage', 'status chance': 'statusChance',
  'fire rate': 'fireRate', 'attack speed': 'fireRate', 'magazine capacity': 'magazine', 'reload speed': 'reloadSpeed',
  'ability strength': 'strength', 'ability duration': 'duration', 'ability range': 'range', 'ability efficiency': 'efficiency',
  'health': 'health', 'shield capacity': 'shield', 'armor': 'armor', 'energy max': 'energy',
  'direct damage': 'damage',
};

const COMBO_SCALING = /\s+(?:stacks with|per) Combo Multiplier/i;
const STATUS_SCALING = /\s+per Status Type affecting the target/i;

const PERCENT_LINE = /^([+-]?\d+(?:\.\d+)?)%\s*(?:<(DT_[A-Z]+)_COLOR>)?\s*(.+)$/;
const FACTION_LINE = /^x(\d+(?:\.\d+)?) Damage to (\w+)/;
const TIMED = /\bfor \d+(?:\.\d+)?s\b|\bwhen\b/i;
const STACKS = /Stacks up to (\d+)x/i;
const BOW = /\(x(\d+(?:\.\d+)?) for Bows\)/i;
const PRECISION = 1e6;

const round = (value: number) => Math.round(value * PRECISION) / PRECISION;

function cleanName(rest: string): string {
  return rest
    .replace(/\s*\(x[\d.]+ for [^)]+\)/gi, '')
    .replace(/\s+when\b.*$/i, '')
    .replace(/\s+for \d+(?:\.\d+)?s\b.*$/i, '')
    .replace(COMBO_SCALING, '')
    .replace(STATUS_SCALING, '')
    .replace(/[.\s]+$/, '')
    .trim();
}

function parseLine(line: string): ParsedStat | null {
  const faction = FACTION_LINE.exec(line);
  if (faction && (FACTIONS as readonly string[]).includes(faction[2])) {
    return { key: `faction${faction[2] as Faction}`, value: round(Number(faction[1]) - 1), conditional: false, maxStacks: 1 };
  }
  const match = PERCENT_LINE.exec(line);
  if (!match) return null;
  const [, number, tag, rest] = match;
  const name = cleanName(rest);
  const element = tag ? DT_TAGS[tag] : undefined;
  const key: StatKey | undefined = element
    ? (DAMAGE_LABELS_EN[element] === name ? element : undefined)
    : NAME_KEYS[name.toLowerCase()];
  if (!key) return null;
  const stacks = STACKS.exec(rest);
  const bow = BOW.exec(rest);
  const scaling = COMBO_SCALING.test(rest) ? 'combo' : STATUS_SCALING.test(rest) ? 'status' : undefined;
  return {
    key,
    value: round(Number(number) / 100),
    conditional: TIMED.test(rest),
    maxStacks: stacks ? Number(stacks[1]) : 1,
    ...(bow ? { bowMultiplier: Number(bow[1]) } : {}),
    ...(scaling ? { scaling } : {}),
  };
}

/**
 * Parses the English stat strings of one mod/arcane rank. A line ending with
 * ":" (On Kill:, On Hit:...) makes the following lines conditional; a passive
 * line that also appears as its own entry is counted once, as passive.
 */
export function parseStatLines(entries: readonly string[]): ParsedLines {
  const standalone = new Set(entries.filter((e) => !/\r?\n/.test(e)).map((e) => e.trim()));
  const stats: ParsedStat[] = [];
  const unknown: string[] = [];
  for (const entry of entries) {
    const lines = entry.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const multiLine = lines.length > 1;
    let conditional = false;
    for (const line of lines) {
      if (line.endsWith(':')) {
        conditional = !/^On Equip:$/i.test(line);
        continue;
      }
      if (multiLine && standalone.has(line)) continue;
      const parsed = parseLine(line);
      if (parsed) stats.push({ ...parsed, conditional: parsed.conditional || conditional });
      else unknown.push(line);
    }
  }
  return { stats, unknown };
}

export function statsAtRank(levels: readonly (readonly string[])[], rank: number): readonly string[] {
  if (levels.length === 0) return [];
  const index = Math.min(levels.length - 1, Math.max(0, Math.floor(rank)));
  return levels[index];
}

export interface SumOptions {
  readonly conditional: boolean;
  readonly isBow?: boolean;
  /** Melee combo multiplier (1 = no combo). */
  readonly comboMultiplier?: number;
  /** Number of different status effects on the target. */
  readonly statusTypes?: number;
}

/** Combo mods give their value per combo step above 1x; status mods per status type. */
function situationalFactor(stat: ParsedStat, options: SumOptions): number {
  if (stat.scaling === 'combo') return Math.max(0, (options.comboMultiplier ?? 1) - 1);
  if (stat.scaling === 'status') return Math.max(0, options.statusTypes ?? 0);
  return 1;
}

export function statContribution(stat: ParsedStat, options: SumOptions): number {
  if (stat.conditional && !options.conditional) return 0;
  const stacks = stat.conditional ? stat.maxStacks : 1;
  const bow = options.isBow && stat.bowMultiplier ? stat.bowMultiplier : 1;
  return stat.value * stacks * bow * situationalFactor(stat, options);
}

export function sumStats(stats: readonly ParsedStat[], options: SumOptions): StatTotals {
  return stats.reduce<StatTotals>((totals, stat) => {
    const amount = statContribution(stat, options);
    return amount === 0 ? totals : { ...totals, [stat.key]: (totals[stat.key] ?? 0) + amount };
  }, {});
}
