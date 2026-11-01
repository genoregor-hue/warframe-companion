import { describe, expect, it } from 'vitest';
import { matchNames, similarity, skeleton } from './ocrMatch';

const ENTRIES = [
  { id: 'serration', names: ['Serration', 'Зазубрины'] },
  { id: 'point', names: ['Point Strike', 'Точный удар'] },
  { id: 'split', names: ['Split Chamber', 'Раздвоенный патронник'] },
  { id: 'vital', names: ['Vital Sense', 'Жизненное чутьё'] },
];

describe('skeleton', () => {
  it('folds case, ё and latin look-alikes of cyrillic letters', () => {
    expect(skeleton('Жизненное ЧУТЬЁ')).toBe(skeleton('жизненное чутье'));
    expect(skeleton('3a3yбpины')).toBe(skeleton('Зазубрины'));
  });

  it('drops punctuation and collapses spaces', () => {
    expect(skeleton('  Point-Strike!! ')).toBe('point strike');
  });
});

describe('similarity', () => {
  it('is 1 for equal strings and lower for typos', () => {
    expect(similarity('serration', 'serration')).toBe(1);
    expect(similarity('serration', 'serratlon')).toBeGreaterThan(0.85);
    expect(similarity('abc', '')).toBe(0);
  });
});

describe('matchNames', () => {
  it('finds exact names inside noisy OCR text', () => {
    const text = 'РАНГ 10\nЗазубрины\n+165% к урону\nТочный удар\n+150% шанс крит.';
    expect(matchNames(text, ENTRIES).map((m) => m.id)).toEqual(['serration', 'point']);
  });

  it('tolerates OCR letter confusion', () => {
    expect(matchNames('3a3yбpины', ENTRIES).map((m) => m.id)).toEqual(['serration']);
    expect(matchNames('Spllt Chamber', ENTRIES).map((m) => m.id)).toEqual(['split']);
  });

  it('joins names broken across two lines', () => {
    expect(matchNames('Раздвоенный\nпатронник\n+90% мультивыстрел', ENTRIES).map((m) => m.id)).toEqual(['split']);
  });

  it('separates several names on one line (cards side by side)', () => {
    expect(matchNames('Зазубрины    Жизненное чутьё    Точный удар', ENTRIES).map((m) => m.id)).toEqual(['serration', 'vital', 'point']);
  });

  it('reports each mod once, in reading order', () => {
    expect(matchNames('Point Strike\nSerration\nPoint Strike', ENTRIES).map((m) => m.id)).toEqual(['point', 'serration']);
  });

  it('ignores unrelated text', () => {
    expect(matchNames('Ранг 10/10\nВместимость 60\nСортировать по', ENTRIES)).toEqual([]);
  });
});
