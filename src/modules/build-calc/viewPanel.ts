/** One build panel (A or B): item, slots, arcanes, optimizer controls and results. */
import { emptyState, errorBox, fmt, fmt2, h, loading, pct, replace, searchBox, stageImage } from '../../core/dom';
import { POLARITY_NAMES, POLARITY_SHORT, polarityIcon } from '../../core/icons';
import type { ArcaneEntry, Catalog, ModEntry } from '../../data/catalog';
import type { MarketService } from '../market/contract';
import { autoBuildFrame, autoBuildWeapon, type FrameBuild, type FrameWeights, type ModChoice, type WeaponBuild, type WeaponGoal } from './logic/autoBuild';
import { modDrain } from './logic/capacity';
import { applyAutoBuild, evaluateBuild, MAIN_SLOT_COUNT, modById, rivenLines, type BuildEvaluation, type BuildState, type SlotState } from './logic/buildEval';
import { frameExtras, weaponExtras } from './viewExtras';
import { frameArcanes, frameCompatible, isAura, weaponArcanes, weaponCompatible } from './logic/compat';
import { COMPOUND_ELEMENTS, DAMAGE_LABELS_RU, DAMAGE_TYPES, FACTION_LABELS_RU, FACTIONS, PRIMARY_ELEMENTS, type DamageType, type Faction } from './logic/damageTypes';

export const POLARITIES: readonly [string, string][] = [
  ['', 'без полярности'], ['AP_ATTACK', 'Мадурай (V)'], ['AP_DEFENSE', 'Вазарин (D)'], ['AP_TACTIC', 'Нарамон (—)'],
  ['AP_POWER', 'Зенурик (=)'], ['AP_WARD', 'Унайру (Y)'], ['AP_PRECEPT', 'Пенджага'], ['AP_UMBRA', 'Умбра'], ['AP_UNIVERSAL', 'Любая'],
];
const GOALS: readonly [WeaponGoal, string][] = [['burst', 'Макс. DPS (очередь)'], ['sustained', 'Макс. DPS с перезарядкой'], ['status', 'Макс. статусов в секунду']];
const FRAME_STATS: readonly [keyof FrameWeights, string][] = [['strength', 'Сила'], ['duration', 'Длительность'], ['range', 'Дальность'], ['efficiency', 'Эффективность'], ['survivability', 'Живучесть']];
const MAX_WEIGHT = 3;

export interface OptimizerSettings {
  readonly goal: WeaponGoal;
  readonly element: DamageType | '';
  readonly weights: FrameWeights;
  readonly autoForma: boolean;
  readonly ownedOnly: boolean;
  readonly useMeta: boolean;
}

export const DEFAULT_SETTINGS: OptimizerSettings = {
  goal: 'burst', element: '', weights: { strength: 2, duration: 1, range: 1, efficiency: 1, survivability: 1 }, autoForma: true, ownedOnly: false, useMeta: true,
};

export interface PanelProps {
  readonly label: string;
  readonly state: BuildState;
  readonly settings: OptimizerSettings;
  readonly catalog: Catalog;
  readonly owned: Readonly<Record<string, number>>;
  readonly metaWeights: (state: BuildState) => Readonly<Record<string, number>>;
  readonly market?: MarketService;
  /** Mods the last optimizer run used but the player does not own. */
  readonly missing: readonly ModChoice[];
  onChange(state: BuildState): void;
  onBuilt(state: BuildState, missing: readonly ModChoice[]): void;
  onSettings(settings: OptimizerSettings): void;
}

const isRankVariant = (mod: ModEntry) => /\/(Beginner|Intermediate)\//.test(mod.uniqueName);

/** Mods offered in the UI for the panel's item (rank-variant duplicates hidden). */
export function panelMods(catalog: Catalog, state: BuildState): { main: ModEntry[]; auras: ModEntry[]; arcanes: ArcaneEntry[] } {
  const weapon = catalog.weapons.find((w) => w.uniqueName === state.itemId);
  const frame = catalog.frames.find((f) => f.uniqueName === state.itemId);
  const usable = catalog.mods.filter((m) => !isRankVariant(m));
  if (weapon) return { main: usable.filter((m) => weaponCompatible(m, weapon)), auras: [], arcanes: weaponArcanes(catalog.arcanes, weapon) };
  if (frame) return { main: usable.filter((m) => frameCompatible(m, frame)), auras: usable.filter(isAura), arcanes: frameArcanes(catalog.arcanes) };
  return { main: [], auras: [], arcanes: [] };
}

function slotEditor(label: string, slot: SlotState, mods: readonly ModEntry[], listId: string, catalog: Catalog, owned: Readonly<Record<string, number>>, onSlot: (slot: SlotState) => void, special = false): HTMLElement {
  const mod = modById(catalog, slot.uniqueName);
  const byName = new Map(mods.map((m) => [m.name.ru.toLowerCase(), m]));
  const name = h('input', { class: 'field', list: listId, value: mod?.name.ru ?? '', placeholder: 'пусто' });
  name.addEventListener('change', () => {
    const picked = byName.get(name.value.trim().toLowerCase());
    if (!name.value.trim()) return onSlot({ ...slot, uniqueName: undefined, rank: 0 });
    if (!picked) { name.value = mod?.name.ru ?? ''; return; }
    onSlot({ ...slot, uniqueName: picked.uniqueName, rank: Math.min(picked.fusionLimit, owned[picked.uniqueName] ?? picked.fusionLimit) });
  });
  const rank = h('input', { class: 'field rank', type: 'number', min: 0, max: mod?.fusionLimit ?? 10, value: String(slot.rank), title: 'Ранг' });
  rank.addEventListener('change', () => onSlot({ ...slot, rank: Math.max(0, Math.min(mod?.fusionLimit ?? 10, Number(rank.value) || 0)) }));
  const polarity = h('select', { class: 'field', title: 'Полярность слота' }, ...POLARITIES.map(([value]) => h('option', { value, selected: value === slot.polarity }, value ? `${POLARITY_SHORT[value] ?? ''} ${POLARITY_NAMES[value]}` : '○ нет')));
  polarity.addEventListener('change', () => onSlot({ ...slot, polarity: polarity.value }));
  const missing = mod && Object.keys(owned).length > 0 && owned[mod.uniqueName] === undefined;
  const effectiveRank = mod ? Math.min(slot.rank, mod.fusionLimit) : 0;
  const drain = mod ? modDrain({ baseDrain: mod.baseDrain, rank: effectiveRank, polarity: mod.polarity }, slot.polarity) : undefined;
  const imageUrl = mod ? catalog.images[mod.uniqueName] : undefined;
  const art = h('div', { class: 'mod-art' }, imageUrl ? h('img', { src: imageUrl, alt: '', loading: 'lazy', on: { error: (e) => (e.target as HTMLElement).remove() } }) : polarityIcon(slot.polarity, 22));
  const dots = mod ? h('div', { class: 'rank-dots', title: `Ранг ${effectiveRank} из ${mod.fusionLimit}` },
    ...Array.from({ length: mod.fusionLimit }, (_, i) => h('i', { class: i < effectiveRank ? 'on' : '' }))) : null;
  name.classList.add('name');
  name.title = mod?.name.ru ?? '';
  name.placeholder = '+ добавить мод';
  const classes = ['mod', mod ? `filled ${mod.rarity}` : '', special ? 'special' : '', missing ? 'missing' : ''].filter(Boolean).join(' ');
  return h('div', { class: classes, title: mod?.statsRu.join('\n') ?? '' },
    art,
    mod || slot.polarity ? h('div', { class: 'mod-top' }, polarityIcon(slot.polarity || mod?.polarity || '', 12), drain === undefined ? '' : String(drain)) : null,
    h('div', { class: 'mod-body' }, h('div', { class: 'mod-label' }, label), name, dots, h('div', { class: 'mod-row' }, rank, polarity)));
}

const CLASS_RU: Readonly<Record<string, string>> = {
  Rifle: 'Винтовка', Shotgun: 'Дробовик', Bow: 'Лук', Sniper: 'Снайперская винтовка', Pistol: 'Вторичное', Melee: 'Ближний бой',
};

function itemHero(state: BuildState, catalog: Catalog): HTMLElement | null {
  const weapon = catalog.weapons.find((w) => w.uniqueName === state.itemId);
  const frame = catalog.frames.find((f) => f.uniqueName === state.itemId);
  const item = weapon ?? frame;
  if (!item) return null;
  const chips = weapon
    ? [CLASS_RU[weapon.weaponClass] ?? weapon.weaponClass, `МР ${weapon.masteryReq}`, `Крит ${pct(weapon.critChance)} ×${fmt2(weapon.critMultiplier)}`, `Статус ${pct(weapon.statusChance)}`]
    : [`МР ${frame!.masteryReq}`, `Здоровье ${frame!.health}`, `Броня ${frame!.armor}`, `Энергия ${frame!.energy}`];
  return h('div', { class: 'item-hero' },
    stageImage(catalog.images[item.uniqueName], item.name.ru),
    h('div', {},
      h('div', { class: 'title' }, item.name.ru),
      item.name.en !== item.name.ru ? h('div', { class: 'sub' }, item.name.en) : null,
      h('div', { class: 'chips' }, ...chips.map((c) => h('span', { class: 'badge' }, c)))));
}

function targetBreakdown(evaluation: BuildEvaluation): string {
  const t = evaluation.target;
  const raw = `без учёта цели ${fmt(evaluation.weapon?.burstDps ?? 0)}`;
  if (!t || t.dot === 0 && t.viralBonus === 0) return `${raw} · снято брони ${pct(t?.armorStrip ?? 0)}`;
  return `прямой ${fmt(t.direct)} · со временем ${fmt(t.dot)} · вирус +${pct(t.viralBonus)} · снято брони ${pct(t.armorStrip)} · ${raw}`;
}

function weaponStats(evaluation: BuildEvaluation, melee: boolean): HTMLElement {
  const r = evaluation.weapon!;
  const ranged: [string, string][] = [['Мультивыстрел', fmt2(r.multishot)]];
  const ammo: [string, string][] = [['Магазин', fmt(r.magazine)], ['Перезарядка', `${fmt2(r.reloadTime)} с`]];
  const kpis: [string, string][] = [
    ['DPS очередью', fmt(r.burstDps)], ['DPS с перезарядкой', fmt(r.sustainedDps)], [melee ? 'Урон за удар' : 'Урон за снаряд', fmt(r.totalPerPellet)],
    ...(melee ? [] : ranged), ['Шанс крита', pct(r.critChance)], ['Множитель крита', `×${fmt2(r.critMultiplier)}`],
    ['Шанс статуса', pct(r.statusChance)], [melee ? 'Скорость атаки' : 'Скорострельность', fmt2(r.fireRate)],
    ...(melee ? [] : ammo), ['Статусов в секунду', fmt2(r.procsPerSecond)],
  ];
  const total = r.totalPerPellet || 1;
  const bars = DAMAGE_TYPES.filter((t) => r.damage[t] > 0.0001).map((t) => h('div', { class: `bar dmg-${t}` },
    h('span', {}, DAMAGE_LABELS_RU[t]), h('div', { class: 'track' }, h('div', { style: `width:${(r.damage[t] / total) * 100}%` })), h('span', { class: 'num' }, fmt2(r.damage[t]))));
  return h('div', { class: 'stack' },
    evaluation.effectiveDps === undefined
      ? h('div', { class: 'headline-metric' }, h('span', {}, 'DPS очередью'), h('b', {}, fmt(r.burstDps)), h('span', {}, `с перезарядкой ${fmt(r.sustainedDps)}`))
      : h('div', { class: 'headline-metric' }, h('span', {}, 'DPS по цели'), h('b', {}, fmt(evaluation.effectiveDps)), h('span', {}, targetBreakdown(evaluation))),
    h('div', { class: 'kpi' }, ...kpis.slice(2).map(([k, v]) => h('div', {}, h('b', {}, v), h('span', {}, k)))),
    h('div', { class: 'stack', style: 'gap:8px' }, h('h3', { style: 'margin:4px 0 0' }, 'Урон по типам'), ...bars));
}

function frameStats(evaluation: BuildEvaluation): HTMLElement {
  const r = evaluation.frame!;
  const kpis: [string, string][] = [
    ['Сила', pct(r.strength)], ['Длительность', pct(r.duration)], ['Дальность', pct(r.range)], ['Эффективность', pct(r.efficiency)],
    ['Здоровье', fmt(r.health)], ['Щиты', fmt(r.shield)], ['Броня', fmt(r.armor)], ['Энергия', fmt(r.energy)],
    ['Эффективное здоровье', fmt(r.effectiveHealth)], ['Снижение урона', pct(r.damageReduction)],
  ];
  return h('div', { class: 'stack' },
    h('div', { class: 'headline-metric' }, h('span', {}, 'Сила способностей'), h('b', {}, pct(r.strength)), h('span', {}, `эффективное здоровье ${fmt(r.effectiveHealth)}`)),
    h('div', { class: 'kpi' }, ...kpis.slice(1).map(([k, v]) => h('div', {}, h('b', {}, v), h('span', {}, k)))));
}

function optimizerControls(props: PanelProps, run: (improve: boolean) => void): HTMLElement {
  const s = props.settings;
  const set = (patch: Partial<OptimizerSettings>) => props.onSettings({ ...s, ...patch });
  const check = (text: string, value: boolean, patch: (v: boolean) => Partial<OptimizerSettings>, title = '') => {
    const input = h('input', { type: 'checkbox', checked: value, on: { change: (e) => set(patch((e.target as HTMLInputElement).checked)) } });
    return h('label', { class: 'check', title }, input, text);
  };
  const weaponControls = props.state.kind === 'weapon' ? [
    h('select', { class: 'field', on: { change: (e) => set({ goal: (e.target as HTMLSelectElement).value as WeaponGoal }) } },
      ...GOALS.map(([v, t]) => h('option', { value: v, selected: v === s.goal }, t))),
    h('select', { class: 'field', title: 'Какой элемент обязательно собрать', on: { change: (e) => set({ element: (e.target as HTMLSelectElement).value as DamageType | '' }) } },
      h('option', { value: '' }, 'Любые элементы'),
      ...[...COMPOUND_ELEMENTS, ...PRIMARY_ELEMENTS].map((t) => h('option', { value: t, selected: t === s.element }, DAMAGE_LABELS_RU[t]))),
  ] : FRAME_STATS.map(([key, text]) => {
    const input = h('input', { type: 'range', min: 0, max: MAX_WEIGHT, step: 1, value: String(s.weights[key] ?? 0) });
    input.addEventListener('change', () => set({ weights: { ...s.weights, [key]: Number(input.value) } }));
    return h('label', { class: 'check', title: 'Важность характеристики для автосборки' }, text, input);
  });
  return h('div', { class: 'card inset stack' },
    h('div', { class: 'row' }, h('b', {}, 'Топ-билд'), ...weaponControls),
    h('div', { class: 'row' },
      check('Форма под каждый мод', s.autoForma, (v) => ({ autoForma: v }), 'Без этого учитываются полярности слотов, выставленные вручную'),
      check('Только мои моды', s.ownedOnly, (v) => ({ ownedOnly: v }), 'Иначе недостающие моды покажутся с ценой на маркете'),
      check('Учитывать мету', s.useMeta, (v) => ({ useMeta: v }), 'Бонус модам, которые часто стоят в импортированных топ-сборках')),
    h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', on: { click: () => run(false) } }, 'Собрать топ-билд'),
      h('button', { class: 'btn secondary', type: 'button', on: { click: () => run(true) } }, 'Улучшить текущий')));
}

function missingList(missing: readonly ModChoice[], catalog: Catalog, market?: MarketService): HTMLElement | null {
  if (missing.length === 0) return null;
  return h('div', { class: 'card inset stack' },
    h('b', {}, `Не хватает модов: ${missing.length}`),
    ...missing.map((m) => h('div', { class: 'row small' },
      h('span', {}, modById(catalog, m.uniqueName)?.name.ru ?? m.uniqueName, ` (ранг ${m.rank})`),
      market ? market.priceTag(m.uniqueName, m.rank) : h('span', { class: 'muted' }, 'модуль маркета не установлен'))));
}

export function renderPanel(props: PanelProps): HTMLElement {
  const { state, catalog } = props;
  const pool = panelMods(catalog, state);
  const listId = `mods-${props.label}`;
  const auraListId = `auras-${props.label}`;
  const items = state.kind === 'weapon' ? catalog.weapons : catalog.frames;
  const itemName = items.find((i) => i.uniqueName === state.itemId)?.name.ru ?? '';
  const result = h('div', { class: 'stack' });
  const optimizerOutput = h('div', {}, missingList(props.missing, catalog, props.market));

  const setSlot = (index: number) => (slot: SlotState) => props.onChange({ ...state, slots: state.slots.map((s, i) => (i === index ? slot : s)) });
  const find = (query: string) => items.filter((i) => `${i.name.ru} ${i.name.en}`.toLowerCase().includes(query.toLowerCase()))
    .map((i) => ({ label: i.name.ru, hint: i.name.en, image: catalog.images[i.uniqueName], value: i.uniqueName }));
  const picker = searchBox(state.kind === 'weapon' ? 'Оружие: Сома Прайм, Кува Брамма…' : 'Варфрейм: Сарин Прайм, Вольт…', find,
    (id) => props.onChange({ ...state, itemId: id }), itemName);

  const run = (improve: boolean) => {
    replace(optimizerOutput, loading('Подбираю моды…'));
    setTimeout(() => {
      try {
        const s = props.settings;
        const owned = s.ownedOnly || Object.keys(props.owned).length > 0 ? props.owned : undefined;
        if (s.ownedOnly && Object.keys(props.owned).length === 0) throw new Error('Отметьте свои моды в блоке «Мои моды» или снимите «Только мои моды»');
        const common = {
          conditional: state.conditional, autoForma: s.autoForma, potato: state.potato, owned, allowMissing: !s.ownedOnly,
          initial: improve ? state.slots.map((slot) => slot.uniqueName).filter((id): id is string => Boolean(id)) : undefined,
          slotPolarities: state.slots.map((slot) => slot.polarity), extraCapacity: state.extraCapacity,
          metaWeights: s.useMeta ? props.metaWeights(state) : undefined,
        };
        const weapon = catalog.weapons.find((w) => w.uniqueName === state.itemId);
        const frame = catalog.frames.find((f) => f.uniqueName === state.itemId);
        let built: WeaponBuild | FrameBuild;
        if (weapon) built = autoBuildWeapon(weapon, pool.main, pool.arcanes, {
          ...common, goal: s.goal, faction: state.faction, requiredElement: s.element || undefined, enemy: state.enemy,
          riven: state.riven ? { lines: rivenLines(state.riven.text), drain: state.riven.drain } : undefined,
          bonusElement: state.bonusElement, comboMultiplier: state.comboMultiplier, statusTypes: state.statusTypes, statusEffects: state.statusEffects,
        });
        else if (frame) built = autoBuildFrame(frame, [...pool.main, ...pool.auras], pool.arcanes, { ...common, weights: s.weights, shards: state.shards });
        else throw new Error('Сначала выберите предмет');
        props.onBuilt(applyAutoBuild(state, built), built.missing);
      } catch (error) {
        replace(optimizerOutput, errorBox((error as Error).message));
      }
    }, 20);
  };

  const evaluation = evaluateBuild(state, catalog);
  if (evaluation) {
    const over = evaluation.capacityUsed > evaluation.capacity;
    replace(result,
      h('div', { class: 'row small' }, h('span', {}, `Вместимость: ${evaluation.capacityUsed} / ${evaluation.capacity}`), over ? h('span', { class: 'badge red' }, 'перебор') : null),
      h('div', { class: `capacity${over ? ' over' : ''}` }, h('div', { style: `width:${Math.min(100, (evaluation.capacityUsed / Math.max(1, evaluation.capacity)) * 100)}%` })),
      evaluation.weapon ? weaponStats(evaluation, catalog.weapons.find((w) => w.uniqueName === state.itemId)?.category === 'melee') : frameStats(evaluation),
      evaluation.ignoredLines.length ? h('div', { class: 'small muted' }, `Не моделируется в расчёте: ${evaluation.ignoredLines.join('; ')}`) : null);
  }

  const arcaneSlots = state.kind === 'weapon' ? 1 : 2;
  const arcaneSelects = Array.from({ length: arcaneSlots }, (_, i) => {
    const select = h('select', { class: 'field' }, h('option', { value: '' }, 'Без мистификатора'),
      ...pool.arcanes.map((a) => h('option', { value: a.uniqueName, selected: state.arcanes[i] === a.uniqueName }, a.name.ru)));
    select.addEventListener('change', () => {
      const next = [...state.arcanes];
      next[i] = select.value;
      props.onChange({ ...state, arcanes: next.filter(Boolean) });
    });
    return select;
  });

  const toggles = h('div', { class: 'row' },
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: state.potato, on: { change: (e) => props.onChange({ ...state, potato: (e.target as HTMLInputElement).checked }) } }), 'Реактор / катализатор'),
    h('label', { class: 'check', title: 'Бонусы «при убийстве», «при попадании» и т.п. на максимум стаков' },
      h('input', { type: 'checkbox', checked: state.conditional, on: { change: (e) => props.onChange({ ...state, conditional: (e.target as HTMLInputElement).checked }) } }), 'Условные бонусы'),
    state.kind === 'weapon' ? h('select', { class: 'field', on: { change: (e) => props.onChange({ ...state, faction: ((e.target as HTMLSelectElement).value || undefined) as Faction | undefined }) } },
      h('option', { value: '' }, 'Против всех'), ...FACTIONS.map((f) => h('option', { value: f, selected: state.faction === f }, `Против: ${FACTION_LABELS_RU[f]}`))) : null);

  return h('div', { class: 'card stack' },
    h('div', { class: 'row' }, h('span', { class: 'badge blue' }, `Билд ${props.label}`), h('span', { class: 'spacer' }), toggles),
    picker,
    state.itemId ? h('div', { class: 'stack' },
      itemHero(state, catalog),
      state.kind === 'weapon' ? weaponExtras(state, catalog.weapons.find((w) => w.uniqueName === state.itemId), props.onChange) : frameExtras(state, props.onChange),
      result,
      optimizerControls(props, run),
      optimizerOutput,
      h('datalist', { id: listId }, ...pool.main.map((m) => h('option', { value: m.name.ru }))),
      h('datalist', { id: auraListId }, ...pool.auras.map((m) => h('option', { value: m.name.ru }))),
      h('h3', {}, 'Моды'),
      h('div', { class: 'slots' },
        ...Array.from({ length: MAIN_SLOT_COUNT }, (_, i) => slotEditor(`Слот ${i + 1}`, state.slots[i], pool.main, listId, catalog, props.owned, setSlot(i))),
        state.kind === 'frame' ? slotEditor('Аура', state.aura, pool.auras, auraListId, catalog, props.owned, (aura) => props.onChange({ ...state, aura }), true) : null,
        slotEditor('Эксилус', state.exilus, pool.main.filter((m) => m.isUtility), listId, catalog, props.owned, (exilus) => props.onChange({ ...state, exilus }), true)),
      h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'Мистификаторы'), ...arcaneSelects))
      : emptyState(state.kind === 'weapon' ? 'builds' : 'spark', state.kind === 'weapon' ? 'Выберите оружие — например, Сома Прайм.' : 'Выберите варфрейм — например, Сарина Прайм.'));
}
