/**
 * Matches text recognized from a screenshot (or a live screen capture) to mod
 * names. OCR mixes up Cyrillic and Latin look-alikes, so both sides are folded
 * to one "skeleton" alphabet and compared with a Levenshtein similarity.
 */

export interface NameEntry {
  readonly id: string;
  readonly names: readonly string[];
}

export interface OcrMatch {
  readonly id: string;
  readonly text: string;
  readonly similarity: number;
  readonly position: number;
}

const LOOKALIKES: Readonly<Record<string, string>> = {
  'а': 'a', 'в': 'b', 'е': 'e', 'ё': 'e', 'з': '3', 'к': 'k', 'м': 'm', 'н': 'h', 'о': 'o', 'р': 'p',
  'с': 'c', 'т': 't', 'у': 'y', 'х': 'x', '0': 'o', 'l': 'i', '|': 'i', '1': 'i',
};
const DEFAULT_THRESHOLD = 0.8;
const MAX_WORDS = 4;
const LENGTH_TOLERANCE = 0.25;
const CARD_GAP = /\s{2,}|\t+/;

export function skeleton(text: string): string {
  return [...text.toLowerCase()]
    .map((ch) => LOOKALIKES[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9а-яё]+/g, ' ')
    .trim();
}

function levenshtein(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return previous[b.length];
}

export function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 1 : 1 - levenshtein(a, b) / longest;
}

interface PreparedName {
  readonly id: string;
  readonly key: string;
  readonly words: number;
}

function prepare(entries: readonly NameEntry[]): readonly PreparedName[] {
  return entries.flatMap((entry) =>
    entry.names
      .map((n) => skeleton(n))
      .filter((key) => key.length > 2)
      .map((key) => ({ id: entry.id, key, words: key.split(' ').length })),
  );
}

/** Text chunks in reading order; two-line names are covered by joining neighbouring lines. */
function segments(text: string): readonly { text: string; position: number }[] {
  const lines = text.split(/\r?\n/).map((line) => line.split(CARD_GAP).map((c) => c.trim()).filter(Boolean));
  return lines.flatMap((chunks, index) => {
    const own = chunks.map((chunk, i) => ({ text: chunk, position: index * 100 + i }));
    const next = lines[index + 1];
    const joined = chunks.length === 1 && next?.length === 1 ? [{ text: `${chunks[0]} ${next[0]}`, position: index * 100 + 50 }] : [];
    return [...own, ...joined];
  });
}

function bestFor(phrase: string, names: readonly PreparedName[], threshold: number): { name: PreparedName; similarity: number } | undefined {
  const words = phrase.split(' ').length;
  let best: { name: PreparedName; similarity: number } | undefined;
  for (const name of names) {
    if (name.words !== words || Math.abs(name.key.length - phrase.length) > name.key.length * LENGTH_TOLERANCE) continue;
    const score = name.key === phrase ? 1 : similarity(name.key, phrase);
    if (score >= threshold && score > (best?.similarity ?? 0)) best = { name, similarity: score };
  }
  return best;
}

export function matchNames(text: string, entries: readonly NameEntry[], threshold = DEFAULT_THRESHOLD): OcrMatch[] {
  const names = prepare(entries);
  const found: OcrMatch[] = [];
  for (const segment of segments(text)) {
    const words = skeleton(segment.text).split(' ').filter(Boolean);
    for (let start = 0; start < words.length; start += 1) {
      for (let size = Math.min(MAX_WORDS, words.length - start); size >= 1; size -= 1) {
        const phrase = words.slice(start, start + size).join(' ');
        const hit = bestFor(phrase, names, threshold);
        if (!hit) continue;
        found.push({ id: hit.name.id, text: segment.text, similarity: hit.similarity, position: segment.position + start / 10 });
        start += size - 1;
        break;
      }
    }
  }
  const seen = new Set<string>();
  return found
    .sort((a, b) => a.position - b.position)
    .filter((match) => !seen.has(match.id) && seen.add(match.id) !== undefined);
}
