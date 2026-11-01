/**
 * Parser for the official drop tables page (warframe.com/droptables).
 * The page is a flat list of <h3 id="section"> headers followed by tables.
 */

export type DropKind = 'mission' | 'relic' | 'key' | 'dynamic' | 'sortie' | 'bounty' | 'enemy';
export type Refinement = 'Intact' | 'Exceptional' | 'Flawless' | 'Radiant';

export interface DropEntry {
  readonly item: string;
  readonly kind: DropKind;
  readonly source: string;
  readonly rotation?: string;
  readonly refinement?: Refinement;
  readonly stage?: string;
  readonly rarity: string;
  readonly chance: number;
}

type Layout = 'rotations' | 'relics' | 'byDrop' | 'bySource';

interface SectionSpec {
  readonly kind: DropKind;
  readonly layout: Layout;
}

const SECTIONS: Readonly<Record<string, SectionSpec>> = {
  missionRewards: { kind: 'mission', layout: 'rotations' },
  relicRewards: { kind: 'relic', layout: 'relics' },
  keyRewards: { kind: 'key', layout: 'rotations' },
  transientRewards: { kind: 'dynamic', layout: 'rotations' },
  sortieRewards: { kind: 'sortie', layout: 'rotations' },
  cetusRewards: { kind: 'bounty', layout: 'rotations' },
  solarisRewards: { kind: 'bounty', layout: 'rotations' },
  deimosRewards: { kind: 'bounty', layout: 'rotations' },
  zarimanRewards: { kind: 'bounty', layout: 'rotations' },
  entratiLabRewards: { kind: 'bounty', layout: 'rotations' },
  hexRewards: { kind: 'bounty', layout: 'rotations' },
  modByDrop: { kind: 'enemy', layout: 'byDrop' },
  blueprintByDrop: { kind: 'enemy', layout: 'byDrop' },
  resourceByDrop: { kind: 'enemy', layout: 'byDrop' },
  relicByAvatar: { kind: 'enemy', layout: 'bySource' },
};

interface Cell {
  readonly tag: 'th' | 'td';
  readonly text: string;
}

const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const ROTATION = /^Rotation ([A-Z])$/;
const RELIC_HEADER = /^(.+ Relic) \((Intact|Exceptional|Flawless|Radiant)\)$/;
const SOURCE_CHANCE = /Drop Chance:\s*([\d.]+)%/;
const PERCENT = /^([\d.,]+)%$/;
const MAX_CHANCE = 1;

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|\w+);/gi, (match, code: string) => {
    if (code.startsWith('#x') || code.startsWith('#X')) return String.fromCodePoint(parseInt(code.slice(2), 16));
    if (code.startsWith('#')) return String.fromCodePoint(parseInt(code.slice(1), 10));
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

function cleanText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

function parseRows(tableHtml: string): readonly (readonly Cell[])[] {
  const rows = tableHtml.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  return rows
    .map((row) => [...row.matchAll(/<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => ({ tag: m[1].toLowerCase() as Cell['tag'], text: cleanText(m[2]) })))
    .filter((cells) => cells.some((cell) => cell.text !== ''));
}

export function parseChance(text: string): { rarity: string; chance: number } | null {
  const match = /^(.+?)\s*\(([\d.]+)%\)$/.exec(text.trim());
  if (!match) return null;
  return { rarity: match[1], chance: Math.round(Number(match[2]) * 100) / 10_000 };
}

function parsePercent(text: string): number | null {
  const match = PERCENT.exec(text.trim());
  return match ? Number(match[1].replace(/,/g, '')) / 100 : null;
}

function splitSections(html: string): readonly { id: string; body: string }[] {
  const headers = [...html.matchAll(/<h3[^>]*\bid="([^"]+)"[^>]*>/gi)];
  return headers.map((header, i) => {
    const start = (header.index ?? 0) + header[0].length;
    const end = i + 1 < headers.length ? headers[i + 1].index : html.length;
    return { id: header[1], body: html.slice(start, end) };
  });
}

interface RowState {
  readonly source?: string;
  readonly rotation?: string;
  readonly refinement?: Refinement;
  readonly stage?: string;
  readonly sourceChance?: number;
}

function entry(spec: SectionSpec, state: RowState, item: string, chanceText: string, multiplier = 1): DropEntry | null {
  const parsed = parseChance(chanceText);
  if (!parsed || !state.source) return null;
  const base: DropEntry = {
    item,
    kind: spec.kind,
    source: state.source,
    rotation: state.rotation,
    rarity: parsed.rarity,
    chance: Math.min(MAX_CHANCE, Math.round(parsed.chance * multiplier * 1e8) / 1e8),
  };
  return {
    ...base,
    ...(state.refinement ? { refinement: state.refinement } : {}),
    ...(state.stage ? { stage: state.stage } : {}),
  };
}

function headerState(spec: SectionSpec, text: string, state: RowState): RowState {
  const rotation = ROTATION.exec(text);
  if (rotation) return { ...state, rotation: rotation[1], stage: undefined };
  if (spec.layout === 'relics') {
    const relic = RELIC_HEADER.exec(text);
    return relic ? { source: relic[1], refinement: relic[2] as Refinement } : { source: text };
  }
  return { source: text };
}

/** Handles one row; returns the new state and an optional entry. */
function readRow(spec: SectionSpec, cells: readonly Cell[], state: RowState): { state: RowState; entry: DropEntry | null } {
  const texts = cells.map((cell) => cell.text);
  const allHeaders = cells.every((cell) => cell.tag === 'th');

  if (spec.layout === 'byDrop') {
    if (allHeaders && cells.length === 1) return { state: { source: texts[0] }, entry: null };
    if (allHeaders) return { state, entry: null };
    const sourceChance = parsePercent(texts[1] ?? '');
    if (cells.length !== 3 || sourceChance === null) return { state, entry: null };
    const item = state.source ?? '';
    return { state, entry: entry(spec, { source: texts[0] }, item, texts[2], sourceChance) };
  }

  if (spec.layout === 'bySource' && allHeaders) {
    const chance = SOURCE_CHANCE.exec(texts[1] ?? '');
    return { state: { source: texts[0], sourceChance: chance ? Number(chance[1]) / 100 : 1 }, entry: null };
  }

  if (cells[0]?.tag === 'th') return { state: headerState(spec, texts[0], state), entry: null };
  if (cells.length === 2 && cells[1].tag === 'th') return { state: { ...state, stage: texts[1] }, entry: null };

  const values = texts[0] === '' ? texts.slice(1) : texts;
  if (values.length !== 2) return { state, entry: null };
  return { state, entry: entry(spec, state, values[0], values[1], state.sourceChance ?? 1) };
}

function parseSection(spec: SectionSpec, body: string): readonly DropEntry[] {
  const result: DropEntry[] = [];
  let state: RowState = {};
  for (const cells of parseRows(body)) {
    const next = readRow(spec, cells, state);
    state = next.state;
    if (next.entry) result.push(next.entry);
  }
  return result;
}

export function parseDropTables(html: string): DropEntry[] {
  return splitSections(html).flatMap(({ id, body }) => {
    const spec = SECTIONS[id];
    return spec ? parseSection(spec, body) : [];
  });
}
