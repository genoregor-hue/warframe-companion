/** Extra build inputs: target enemy, riven, progenitor element, combo/status, archon shards. */
import { h } from '../../core/dom';
import type { WeaponEntry } from '../../data/catalog';
import type { BuildState } from './logic/buildEval';
import { DAMAGE_LABELS_RU, type DamageType } from './logic/damageTypes';
import { ENEMY_PRESETS, type EnemyPresetId } from './logic/enemy';
import { MAX_SHARDS, SHARD_OPTIONS, type ShardChoice } from './logic/frameCalc';

type OnChange = (state: BuildState) => void;

const BONUS_ELEMENTS: readonly DamageType[] = ['heat', 'cold', 'electricity', 'toxin', 'impact', 'magnetic', 'radiation'];
const MAX_COMBO = 12;
const MAX_STATUS_TYPES = 10;
const MAX_BONUS_PERCENT = 60;
const DEFAULT_BONUS = 0.6;
const PERCENT = 100;

function numberField(label: string, value: number, min: number, max: number, onValue: (v: number) => void, title = ''): HTMLElement {
  const input = h('input', { class: 'field', type: 'number', min, max, value: String(value), style: 'width:76px' });
  input.addEventListener('change', () => onValue(Math.min(max, Math.max(min, Number(input.value) || 0))));
  return h('label', { class: 'check', title }, label, input);
}

function enemyControls(state: BuildState, onChange: OnChange): HTMLElement {
  const presetId = (state.enemyPreset ?? 'none') as EnemyPresetId;
  const select = h('select', { class: 'field' }, ...(Object.keys(ENEMY_PRESETS) as EnemyPresetId[])
    .map((id) => h('option', { value: id, selected: id === presetId }, ENEMY_PRESETS[id].label)));
  select.addEventListener('change', () => {
    const id = select.value as EnemyPresetId;
    const { armor, armorStrip, weak, resist } = ENEMY_PRESETS[id];
    onChange({ ...state, enemyPreset: id, enemy: id === 'none' ? undefined : { armor, armorStrip, weak, resist } });
  });
  const enemy = state.enemy;
  const weak = enemy?.weak.map((t) => DAMAGE_LABELS_RU[t]).join(', ');
  return h('div', { class: 'stack', style: 'gap:8px' },
    h('div', { class: 'row' }, h('b', { class: 'small' }, 'Цель'), select,
      enemy ? numberField('броня', enemy.armor, 0, 100_000, (armor) => onChange({ ...state, enemy: { ...enemy, armor } }), 'Броня врага растёт с уровнем; на Стальном пути — тысячи') : null,
      enemy ? numberField('снято брони, %', Math.round(enemy.armorStrip * PERCENT), 0, PERCENT, (v) => onChange({ ...state, enemy: { ...enemy, armorStrip: v / PERCENT } }), 'Коррозия, огонь, способности') : null),
    h('label', { class: 'check', title: 'Вирус, коррозия, огонь, кровотечение и токсин: стаки при вашей частоте статусов' },
      h('input', { type: 'checkbox', checked: Boolean(state.statusEffects), on: { change: (e) => onChange({ ...state, statusEffects: (e.target as HTMLInputElement).checked }) } }),
      'Учитывать эффекты статусов (вирус, коррозия, огонь, кровотечение)'),
    enemy && weak ? h('div', { class: 'small muted' }, `Уязвимость +50%: ${weak}. Пресеты фракций — из знаний об игре, а не из официальных данных.`) : null);
}

function rivenControls(state: BuildState, onChange: OnChange): HTMLElement {
  const text = h('textarea', { class: 'field', rows: 3, placeholder: 'Ривен: по строке на стат, по-английски, как на карточке\n+150% Critical Chance\n+90% Multishot', style: 'width:100%' });
  text.value = state.riven?.text ?? '';
  text.addEventListener('change', () => onChange({ ...state, riven: text.value.trim() ? { text: text.value, drain: state.riven?.drain ?? 0 } : undefined }));
  const riven = state.riven;
  return h('div', { class: 'stack', style: 'gap:8px' },
    h('div', { class: 'row' }, h('b', { class: 'small' }, 'Ривен'),
      riven ? numberField('вместимость', riven.drain, 0, 30, (drain) => onChange({ ...state, riven: { ...riven, drain } }), 'Сколько ривен стоит в своём слоте') : null,
      riven ? h('span', { class: 'small muted' }, 'занимает один из 8 слотов') : null),
    text);
}

function bonusControls(state: BuildState, onChange: OnChange): HTMLElement {
  const select = h('select', { class: 'field' }, h('option', { value: '' }, 'нет'),
    ...BONUS_ELEMENTS.map((t) => h('option', { value: t, selected: state.bonusElement?.type === t }, DAMAGE_LABELS_RU[t])));
  select.addEventListener('change', () => onChange({
    ...state,
    bonusElement: select.value ? { type: select.value as DamageType, fraction: state.bonusElement?.fraction ?? DEFAULT_BONUS } : undefined,
  }));
  const bonus = state.bonusElement;
  return h('div', { class: 'row' }, h('b', { class: 'small' }, 'Бонус Кувы/Тенет'), select,
    bonus ? numberField('%', Math.round(bonus.fraction * PERCENT), 0, MAX_BONUS_PERCENT, (v) => onChange({ ...state, bonusElement: { ...bonus, fraction: v / PERCENT } })) : null);
}

export function weaponExtras(state: BuildState, weapon: WeaponEntry | undefined, onChange: OnChange): HTMLElement {
  const melee = weapon?.category === 'melee';
  return h('div', { class: 'card inset stack' },
    enemyControls(state, onChange),
    h('div', { class: 'row' },
      melee ? numberField('множитель комбо ×', state.comboMultiplier ?? 1, 1, MAX_COMBO, (comboMultiplier) => onChange({ ...state, comboMultiplier }), 'Для Blood Rush, Weeping Wounds и т.п.') : null,
      numberField('статусов на цели', state.statusTypes ?? 0, 0, MAX_STATUS_TYPES, (statusTypes) => onChange({ ...state, statusTypes }), 'Для Condition Overload, Galvanized Aptitude и т.п.')),
    bonusControls(state, onChange),
    rivenControls(state, onChange));
}

function shardValue(shard: ShardChoice | undefined): string {
  return shard ? `${shard.type}:${shard.stat}:${shard.tauforged ? 1 : 0}` : '';
}

export function frameExtras(state: BuildState, onChange: OnChange): HTMLElement {
  const shards = state.shards ?? [];
  const selects = Array.from({ length: MAX_SHARDS }, (_, i) => {
    const current = shardValue(shards[i]);
    const select = h('select', { class: 'field' }, h('option', { value: '' }, 'пусто'),
      ...SHARD_OPTIONS.flatMap((o) => [false, true].map((tau) => {
        const value = `${o.type}:${o.stat}:${tau ? 1 : 0}`;
        return h('option', { value, selected: value === current }, `${o.label}${tau ? ' (тауфордж)' : ''}`);
      })));
    select.addEventListener('change', () => {
      const [type, stat, tau] = select.value.split(':');
      const picked = select.value ? ({ type, stat, tauforged: tau === '1' } as ShardChoice) : undefined;
      const next = Array.from({ length: MAX_SHARDS }, (_, j) => (j === i ? picked : shards[j])).filter((s): s is ShardChoice => s !== undefined);
      onChange({ ...state, shards: next });
    });
    return select;
  });
  return h('div', { class: 'card inset stack' },
    h('div', { class: 'row' }, h('b', { class: 'small' }, 'Осколки архонта'), h('span', { class: 'small muted' }, 'значения — из знаний об игре: официальных данных по осколкам нет')),
    h('div', { class: 'row' }, ...selects));
}
