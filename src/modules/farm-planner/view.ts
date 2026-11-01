import type { ModuleContext } from '../../core/context';
import { emptyState, errorBox, fmt, h, heroBlock, loading, pct, replace, searchBox, stageImage, thumbImage, timeLeft } from '../../core/dom';
import { glyph } from '../../core/icons';
import type { Catalog } from '../../data/catalog';
import type { DropEntry, Refinement } from '../../data/dropTables';
import type { Fissure, WorldState } from '../../data/worldstate';
import { MARKET_SERVICE, type MarketService } from '../market/contract';
import { buildPlan, indexDrops, listTargets, type ComponentPlan, type DirectSource, type DropIndex, type FarmTarget, type RelicSource, type TargetKind } from './logic/planner';

const KIND_RU: Readonly<Record<TargetKind, string>> = {
  warframe: 'Варфрейм', weapon: 'Оружие', mod: 'Мод', arcane: 'Мистификатор', relic: 'Реликвия', resource: 'Ресурс / часть',
};
const KIND_ORDER: readonly TargetKind[] = ['warframe', 'weapon', 'mod', 'arcane', 'relic', 'resource'];
const REFINEMENT_RU: Readonly<Record<Refinement, string>> = { Intact: 'Целая', Exceptional: 'Исключительная', Flawless: 'Безупречная', Radiant: 'Сияющая' };
const MISSION_RU: Readonly<Record<string, string>> = {
  Survival: 'Выживание', Defense: 'Оборона', 'Mobile Defense': 'Мобильная оборона', Capture: 'Захват', Exterminate: 'Истребление',
  Extermination: 'Истребление', Interception: 'Перехват', Excavation: 'Раскопки', Disruption: 'Срыв', Spy: 'Шпионаж', Rescue: 'Спасение',
  Sabotage: 'Саботаж', Defection: 'Дезертирство', Assassination: 'Убийство', Hijack: 'Угон', Caches: 'Тайники',
  Alchemy: 'Алхимия', Cascade: 'Каскад', Flood: 'Потоп', 'Void Flood': 'Потоп Бездны', 'Void Cascade': 'Каскад Бездны', 'Void Armageddon': 'Армагеддон Бездны',
  Railjack: 'Рэйлджек', Skirmish: 'Стычка', 'Infested Salvage': 'Заражённая утилизация', Netracells: 'Нетраклетки',
};
const PLANETS_RU: Readonly<Record<string, string>> = {
  Mercury: 'Меркурий', Venus: 'Венера', Earth: 'Земля', Lua: 'Луа', Mars: 'Марс', Phobos: 'Фобос', Deimos: 'Деймос', Ceres: 'Церера',
  Jupiter: 'Юпитер', Europa: 'Европа', Saturn: 'Сатурн', Uranus: 'Уран', Neptune: 'Нептун', Pluto: 'Плутон', Sedna: 'Седна', Eris: 'Эрида',
  Void: 'Бездна', 'Kuva Fortress': 'Крепость Кувы', Zariman: 'Зариман', Duviri: 'Дувири',
};
const ROTATION_HINT: Readonly<Record<string, string>> = {
  A: 'ротация A (1-й и 2-й этап)',
  B: 'ротация B (3-й этап)',
  C: 'ротация C (каждый 4-й этап: 20 мин выживания / 20 волн обороны)',
};
const TIERS = ['Lith', 'Meso', 'Neo', 'Axi', 'Requiem', 'Omnia'] as const;
const TIER_RU: Readonly<Record<string, string>> = { Lith: 'Лит', Meso: 'Мезо', Neo: 'Нео', Axi: 'Акси', Requiem: 'Реквием', Omnia: 'Омния' };
const VISIBLE_RELIC_SOURCES = 3;

function localizeSource(source: string): string {
  const match = /^([^/]+)\/(.+?) \((.+)\)$/.exec(source);
  if (!match) return source;
  const [, planet, node, type] = match;
  return `${PLANETS_RU[planet] ?? planet} / ${node} · ${MISSION_RU[type] ?? type}`;
}

function sourceLabel(entry: DropEntry): string {
  const where = entry.kind === 'enemy' ? `${entry.source} (враг)` : localizeSource(entry.source);
  const extras = [entry.rotation ? ROTATION_HINT[entry.rotation] ?? `ротация ${entry.rotation}` : '', entry.stage ?? ''].filter(Boolean);
  return extras.length ? `${where} — ${extras.join(', ')}` : where;
}

const runsText = (source: DirectSource) => `≈ ${fmt(source.expectedRuns)} · 90%: ${Number.isFinite(source.runs90) ? source.runs90 : '∞'}`;

function directTable(sources: readonly DirectSource[]): HTMLElement {
  return h('table', {},
    h('thead', {}, h('tr', {}, h('th', {}, 'Где'), h('th', { class: 'num' }, 'Шанс'), h('th', { class: 'num' }, 'Прогонов'))),
    h('tbody', {}, ...sources.map((s) => h('tr', {}, h('td', {}, sourceLabel(s.entry)), h('td', { class: 'num' }, h('b', {}, pct(s.entry.chance))), h('td', { class: 'num muted' }, runsText(s))))));
}

function fissureList(fissures: readonly Fissure[]): HTMLElement {
  if (fissures.length === 0) return h('div', { class: 'muted small' }, 'Подходящих разрывов сейчас нет — список обновляется каждые 2 минуты.');
  return h('div', { class: 'row' }, ...fissures.map((f) => h('span', { class: `badge tier tier-${f.tier}` },
    `${f.node} · ${MISSION_RU[f.missionType] ?? f.missionType}${f.steelPath ? ' · Стальной путь' : ''} · ${timeLeft(f.expiry)}`)));
}

function relicBlock(relic: RelicSource): HTMLElement {
  const status = relic.vaulted
    ? h('span', { class: `badge ${relic.varzia ? 'green' : 'red'}` }, relic.varzia ? 'В хранилище · есть у Варзии' : 'В хранилище')
    : h('span', { class: 'badge green' }, 'Выпадает');
  const odds = (Object.entries(relic.chances) as [Refinement, number][]).map(([r, c]) => h('span', {}, `${REFINEMENT_RU[r]} `, h('b', {}, pct(c))));
  return h('div', { class: `relic tier-${relic.tier}` }, h('div', { class: 'stack', style: 'gap:10px' },
    h('div', { class: 'row' }, h('b', {}, relic.relic.ru), relic.relic.ru !== relic.relic.en ? h('span', { class: 'muted small' }, relic.relic.en) : null, h('span', { class: 'spacer' }), status),
    h('div', { class: 'odds' }, ...odds),
    h('div', { class: 'small muted' }, `Открыть ≈ ${fmt(relic.expectedRelics)} шт. в одиночку · ≈ ${fmt(relic.expectedRelicsSquad)} в отряде из 4 с одной реликвией`),
    relic.whereToGet.length > 0 ? h('div', {}, h('h3', { style: 'margin-top:0' }, 'Где взять реликвию'), directTable(relic.whereToGet.slice(0, VISIBLE_RELIC_SOURCES))) : null,
    h('div', {}, h('h3', { style: 'margin-top:0' }, `Открыть сейчас · разрывы ${TIER_RU[relic.tier] ?? relic.tier}`), fissureList(relic.fissures))));
}

function componentCard(component: ComponentPlan, image: string | undefined, market?: MarketService): HTMLElement {
  const live = component.live.map((l) => h('span', { class: 'badge green' }, `${l.kind === 'invasion' ? 'Вторжение' : 'Событие'}: ${l.title} ${l.detail}`));
  return h('div', { class: 'card stack' },
    h('div', { class: 'component-head' },
      stageImage(image, component.name.ru),
      h('div', {},
        h('h2', {}, component.name.ru, component.count > 1 ? ` ×${component.count}` : ''),
        component.name.ru !== component.name.en ? h('div', { class: 'muted small' }, component.name.en) : null),
      market ? h('div', { class: 'row small' }, h('span', { class: 'muted' }, 'Купить'), market.priceTag(component.uniqueName)) : null),
    live.length ? h('div', { class: 'row' }, ...live) : null,
    component.relics.length ? h('div', { class: 'stack' }, h('h3', {}, 'Реликвии'), ...component.relics.map(relicBlock)) : null,
    component.direct.length ? h('div', {}, h('h3', {}, 'Прямой дроп'), directTable(component.direct)) : null);
}

function worldSummary(world: WorldState | undefined): HTMLElement {
  if (!world) return h('div', { class: 'tiers muted small' }, 'Состояние мира недоступно: разрывы и события не учитываются.');
  const pills = TIERS.map((tier) => {
    const list = world.fissures.filter((f) => f.tier === tier && !f.storm);
    if (list.length === 0) return null;
    const steel = list.filter((f) => f.steelPath).length;
    return h('span', { class: `tier-pill tier tier-${tier}`, title: steel ? `из них Стальной путь: ${steel}` : '' }, h('b', {}, String(list.length)), TIER_RU[tier]);
  });
  return h('div', { class: 'tiers' }, ...pills,
    world.vaultTrader ? h('span', { class: 'tier-pill badge green' }, h('b', {}, String(world.vaultTrader.items.length)), 'у Варзии') : null,
    world.invasions.length ? h('span', { class: 'tier-pill badge' }, h('b', {}, String(world.invasions.length)), 'вторжений') : null);
}

function targetFinder(targets: readonly (FarmTarget & { haystack: string })[], images: Catalog['images']) {
  return (query: string) => {
    const q = query.toLowerCase();
    return targets
      .filter((t) => t.haystack.includes(q))
      .sort((a, b) => Number(!a.haystack.startsWith(q)) - Number(!b.haystack.startsWith(q))
        || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.name.ru.length - b.name.ru.length)
      .map((t) => ({ label: t.name.ru, hint: KIND_RU[t.kind], image: images[t.uniqueName], value: t }));
  };
}

function targetHero(target: FarmTarget, catalog: Catalog, parts: number): HTMLElement {
  return h('div', { class: 'card item-hero' },
    stageImage(catalog.images[target.uniqueName], target.name.ru),
    h('div', {},
      h('div', { class: 'eyebrow' }, KIND_RU[target.kind]),
      h('div', { class: 'title' }, target.name.ru),
      target.name.en !== target.name.ru ? h('div', { class: 'sub' }, target.name.en) : null,
      h('div', { class: 'chips' }, h('span', { class: 'badge blue' }, `Частей в маршруте: ${parts}`))));
}

export function mountPlanner(root: HTMLElement, ctx: ModuleContext): () => void {
  const summary = h('div', {});
  const search = h('div', {}, loading('Загружаю каталог и официальные таблицы дропа (первый запуск — до минуты)…'));
  const plan = h('div', { class: 'section' });
  replace(root,
    heroBlock('Планировщик фарма', 'Что фармим', 'сегодня?', 'Варфрейм, оружие, прайм-часть, мод или ресурс — маршрут по официальным таблицам дропа и текущим разрывам Бездны.', glyph('farm', 16)),
    h('div', { class: 'card stack' }, search, summary),
    plan);

  let world: WorldState | undefined;
  let state: { catalog: Catalog; drops: DropIndex } | undefined;
  let current: FarmTarget | undefined;
  const market = ctx.services.get<MarketService>(MARKET_SERVICE);

  const render = () => {
    replace(summary, worldSummary(world));
    if (!state) return;
    if (!current) return replace(plan, h('div', { class: 'card' }, emptyState('search', 'Начните вводить название — например, «Сома Прайм» или «Зазубрины».')));
    const { catalog } = state;
    const target = current;
    const result = buildPlan(target, catalog, state.drops, world);
    replace(plan,
      targetHero(target, catalog, result.components.length),
      ...result.notes.map((note) => h('div', { class: 'card small' }, note)),
      ...result.components.map((c) => componentCard(c, catalog.images[c.uniqueName] ?? catalog.images[target.uniqueName], market)),
      result.resources.length ? h('div', { class: 'card' }, h('h2', {}, 'Ресурсы для сборки'),
        h('table', {}, h('tbody', {}, ...result.resources.map((r) => h('tr', {},
          h('td', { style: 'width:52px' }, thumbImage(catalog.images[r.uniqueName], r.name.ru)),
          h('td', {}, h('b', {}, r.name.ru)), h('td', { class: 'num' }, `×${r.count}`),
          h('td', { class: 'small muted' }, r.direct.map((d) => `${sourceLabel(d.entry)} ${pct(d.entry.chance)}`).join('; ') || 'добывается на планетах / в магазине')))))) : null);
  };

  const off = ctx.events.on<WorldState>('worldstate:updated', (next) => { world = next; render(); });

  Promise.all([
    ctx.data.source<Catalog>('catalog'),
    ctx.data.source<{ entries: DropEntry[] }>('droptables'),
    ctx.data.source<WorldState>('worldstate').then((r) => r.data).catch((error: Error) => { console.warn('[farm] worldstate', error.message); return undefined; }),
  ]).then(([catalog, drops, worldState]) => {
    world = worldState;
    state = { catalog: catalog.data, drops: indexDrops(drops.data.entries) };
    const targets = listTargets(catalog.data).map((t) => ({ ...t, haystack: `${t.name.ru} ${t.name.en}`.toLowerCase() }));
    const last = ctx.storage.get<string | null>('target', null);
    current = targets.find((t) => t.uniqueName === last);
    replace(search, searchBox('Сома Прайм, Зазубрины, Ствол Сомы Прайм…', targetFinder(targets, catalog.data.images), (target) => {
      current = target;
      ctx.storage.set('target', target.uniqueName);
      render();
    }, current?.name.ru ?? ''));
    render();
  }).catch((error: Error) => replace(search, errorBox(`Не удалось загрузить данные: ${error.message}. Проверьте интернет и нажмите «Обновить данные».`)));

  return off;
}
