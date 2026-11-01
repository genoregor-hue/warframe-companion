/** Build calculator screen: two panels side by side, comparison, my mods and import. */
import type { ModuleContext } from '../../core/context';
import { errorBox, fmt, fmt2, h, heroBlock, loading, pct, replace, toast } from '../../core/dom';
import { glyph } from '../../core/icons';
import type { Catalog } from '../../data/catalog';
import { MARKET_SERVICE, type MarketService } from '../market/contract';
import type { ModChoice } from './logic/autoBuild';
import { emptyBuild, evaluateBuild, MAIN_SLOT_COUNT, modById, type BuildEvaluation, type BuildKind, type BuildState } from './logic/buildEval';
import { emptyLibrary, metaWeights, recordBuild, type MetaLibrary } from './logic/metaLearning';
import { parseStatLines, statsAtRank } from './logic/modStats';
import { DEFAULT_SETTINGS, panelMods, renderPanel, type OptimizerSettings } from './viewPanel';
import { renderOwned, shutdownOcr } from './viewOwned';

type PanelId = 'A' | 'B';
const PANELS: readonly PanelId[] = ['A', 'B'];

interface Metric {
  readonly label: string;
  readonly get: (e: BuildEvaluation) => number | undefined;
  readonly show: (v: number) => string;
}

const WEAPON_METRICS: readonly Metric[] = [
  { label: 'DPS по цели', get: (e) => e.effectiveDps, show: fmt },
  { label: 'DPS очередью', get: (e) => e.weapon?.burstDps, show: fmt },
  { label: 'DPS с перезарядкой', get: (e) => e.weapon?.sustainedDps, show: fmt },
  { label: 'Урон за снаряд', get: (e) => e.weapon?.totalPerPellet, show: fmt },
  { label: 'Шанс крита', get: (e) => e.weapon?.critChance, show: pct },
  { label: 'Множитель крита', get: (e) => e.weapon?.critMultiplier, show: fmt2 },
  { label: 'Шанс статуса', get: (e) => e.weapon?.statusChance, show: pct },
  { label: 'Статусов в секунду', get: (e) => e.weapon?.procsPerSecond, show: fmt2 },
  { label: 'Скорострельность', get: (e) => e.weapon?.fireRate, show: fmt2 },
];
const FRAME_METRICS: readonly Metric[] = [
  { label: 'Сила', get: (e) => e.frame?.strength, show: pct },
  { label: 'Длительность', get: (e) => e.frame?.duration, show: pct },
  { label: 'Дальность', get: (e) => e.frame?.range, show: pct },
  { label: 'Эффективность', get: (e) => e.frame?.efficiency, show: pct },
  { label: 'Эффективное здоровье', get: (e) => e.frame?.effectiveHealth, show: fmt },
  { label: 'Энергия', get: (e) => e.frame?.energy, show: fmt },
];

function comparison(kind: BuildKind, a?: BuildEvaluation, b?: BuildEvaluation): HTMLElement | null {
  if (!a || !b) return null;
  const metrics = (kind === 'weapon' ? WEAPON_METRICS : FRAME_METRICS).filter((m) => m.get(a) !== undefined || m.get(b) !== undefined);
  const rows = metrics.map((m) => {
    const [va, vb] = [m.get(a) ?? 0, m.get(b) ?? 0];
    const delta = va === 0 ? 0 : (vb - va) / Math.abs(va);
    const cls = delta > 0.0005 ? 'delta-up' : delta < -0.0005 ? 'delta-down' : 'muted';
    return h('tr', {}, h('td', {}, m.label), h('td', { class: 'num' }, m.show(va)), h('td', { class: 'num' }, m.show(vb)),
      h('td', { class: `num ${cls}` }, `${delta > 0 ? '+' : ''}${fmt2(delta * 100)}%`));
  });
  return h('div', { class: 'card' }, h('h2', {}, 'Сравнение A и B'),
    h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', { class: 'num' }, 'A'), h('th', { class: 'num' }, 'B'), h('th', { class: 'num' }, 'B к A'))), h('tbody', {}, ...rows)));
}

/** Learning group: weapon class for weapons, the frame itself for warframes. */
function groupOf(state: BuildState, catalog: Catalog): string {
  if (state.kind === 'weapon') return catalog.weapons.find((w) => w.uniqueName === state.itemId)?.weaponClass ?? 'weapon';
  return `frame:${state.itemId ?? ''}`;
}

function isUnmodelled(catalog: Catalog, id: string): boolean {
  const mod = modById(catalog, id);
  if (!mod) return false;
  const parsed = parseStatLines(statsAtRank(mod.stats, mod.fusionLimit));
  return parsed.unknown.length > 0 || parsed.stats.length === 0;
}

export function mountBuildCalc(root: HTMLElement, ctx: ModuleContext): () => void {
  const market = ctx.services.get<MarketService>(MARKET_SERVICE);
  let kind = ctx.storage.get<BuildKind>('kind', 'weapon');
  let builds = ctx.storage.get<Record<BuildKind, Record<PanelId, BuildState>>>('builds', {
    weapon: { A: emptyBuild('weapon'), B: emptyBuild('weapon') }, frame: { A: emptyBuild('frame'), B: emptyBuild('frame') },
  });
  let settings = ctx.storage.get<OptimizerSettings>('settings', DEFAULT_SETTINGS);
  let owned = ctx.storage.get<Record<string, number>>('owned', {});
  let library = ctx.storage.get<MetaLibrary>('library', emptyLibrary());
  let missing: Record<PanelId, readonly ModChoice[]> = { A: [], B: [] };
  let catalog: Catalog | undefined;
  let cleanupOwned: (() => void) | undefined;

  const body = h('div', { class: 'stack' }, loading('Загружаю каталог предметов…'));
  const tabs = h('div', { class: 'segmented' });
  replace(root, heroBlock('Калькулятор билдов', 'Топ-билд.', 'Из ваших модов.', 'Слоты, полярности и вместимость, точные формулы урона, сравнение двух билдов и автосборка — с ценами на недостающие моды.', glyph('builds', 16)),

    h('div', { class: 'row', style: 'justify-content:center;margin-bottom:24px' }, tabs), body);

  const save = () => {
    ctx.storage.set('kind', kind);
    ctx.storage.set('builds', builds);
    ctx.storage.set('settings', settings);
    ctx.storage.set('owned', owned);
    ctx.storage.set('library', library);
  };

  const setPanel = (id: PanelId, state: BuildState) => {
    builds = { ...builds, [kind]: { ...builds[kind], [id]: state } };
    save();
    render();
  };

  const importBuild = (modIds: readonly string[], id: PanelId, isTopBuild: boolean) => {
    if (!catalog) return;
    const current = builds[kind][id];
    if (!current.itemId) return toast(`Сначала выберите предмет в билде ${id}`);
    const pool = panelMods(catalog, current);
    const fits = (mid: string) => pool.main.some((m) => m.uniqueName === mid);
    const auraId = modIds.find((mid) => pool.auras.some((m) => m.uniqueName === mid));
    const mainIds = modIds.filter(fits).slice(0, MAIN_SLOT_COUNT);
    const rankOf = (mid: string) => owned[mid] ?? modById(catalog!, mid)?.fusionLimit ?? 0;
    const slots = Array.from({ length: MAIN_SLOT_COUNT }, (_, i) => (mainIds[i] ? { uniqueName: mainIds[i], rank: rankOf(mainIds[i]), polarity: modById(catalog!, mainIds[i])?.polarity ?? '' } : { rank: 0, polarity: '' }));
    const next: BuildState = { ...current, slots, ...(auraId ? { aura: { uniqueName: auraId, rank: rankOf(auraId), polarity: modById(catalog, auraId)?.polarity ?? '' } } : {}) };
    if (isTopBuild) {
      const score = evaluateBuild(next, catalog)?.weapon?.burstDps ?? 0;
      library = recordBuild(library, { group: groupOf(next, catalog), itemId: next.itemId ?? '', mods: [...mainIds, ...(auraId ? [auraId] : [])], source: 'overframe', score, savedAt: new Date().toISOString() });
    }
    toast(`Импортировано модов: ${mainIds.length}${modIds.length > mainIds.length ? ` (не подошли к предмету: ${modIds.length - mainIds.length})` : ''}`);
    setPanel(id, next);
  };

  const render = () => {
    if (!catalog) return;
    const cat = catalog;
    replace(tabs, ...([['weapon', 'Оружие'], ['frame', 'Варфрейм']] as const).map(([k, t]) =>
      h('button', { type: 'button', class: k === kind ? 'active' : '', on: { click: () => { kind = k; save(); render(); } } }, t)));
    const panels = PANELS.map((id) => renderPanel({
      label: id,
      state: builds[kind][id],
      settings,
      catalog: cat,
      owned,
      market,
      missing: missing[id],
      metaWeights: (state) => metaWeights(library, groupOf(state, cat), (mid) => isUnmodelled(cat, mid)),
      onChange: (state) => { missing = { ...missing, [id]: [] }; setPanel(id, state); },
      onBuilt: (state, lacking) => { missing = { ...missing, [id]: lacking }; setPanel(id, state); },
      onSettings: (next) => { settings = next; save(); render(); },
    }));
    cleanupOwned?.();
    const ownedView = renderOwned({
      catalog: cat, owned, library,
      onOwned: (next) => { owned = next; save(); render(); },
      onImport: importBuild,
      onResetLibrary: () => { library = emptyLibrary(); save(); render(); },
    });
    cleanupOwned = ownedView.cleanup;
    const [a, b] = PANELS.map((id) => evaluateBuild(builds[kind][id], cat));
    replace(body,
      h('div', { class: 'grid two' }, ...panels),
      comparison(kind, a, b),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost', type: 'button', on: { click: () => setPanel('B', builds[kind].A) } }, 'Скопировать A → B'),
        h('button', { class: 'btn ghost', type: 'button', on: { click: () => setPanel('A', builds[kind].B) } }, 'Скопировать B → A')),
      ownedView.element);
  };

  ctx.data.source<Catalog>('catalog')
    .then(({ data }) => { catalog = data; render(); })
    .catch((error: Error) => replace(body, errorBox(`Каталог недоступен: ${error.message}. Нажмите «Обновить данные».`)));

  return () => {
    cleanupOwned?.();
    void shutdownOcr();
  };
}
