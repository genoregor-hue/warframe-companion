/** Tiny DOM helpers. Text always goes through text nodes: no innerHTML with data. */
import { glyph } from './icons';

type Child = Node | string | number | null | undefined | false;
type Handler = (event: Event) => void;

export interface Props {
  readonly class?: string;
  readonly style?: string;
  readonly on?: Readonly<Record<string, Handler>>;
  readonly [attr: string]: unknown;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = String(value);
    else if (key === 'style') el.setAttribute('style', String(value));
    else if (key === 'on') for (const [event, handler] of Object.entries(value as Record<string, Handler>)) el.addEventListener(event, handler);
    else if (key in el && typeof value !== 'string') (el as unknown as Record<string, unknown>)[key] = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  append(el, ...children);
  return el;
}

export function append(parent: Node, ...children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child);
  }
}

export function replace(parent: Element, ...children: Child[]): void {
  parent.replaceChildren();
  append(parent, ...children);
}

const NUMBER = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const PRECISE = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

export const fmt = (value: number): string => (Number.isFinite(value) ? NUMBER.format(value) : '∞');
export const fmt2 = (value: number): string => (Number.isFinite(value) ? PRECISE.format(value) : '∞');
export const pct = (value: number): string => `${PRECISE.format(value * 100)}%`;

export function timeLeft(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((Date.parse(iso) - now) / 60_000));
  if (Number.isNaN(minutes)) return '';
  return minutes >= 60 ? `${Math.floor(minutes / 60)} ч ${minutes % 60} мин` : `${minutes} мин`;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
const TOAST_MS = 2_400;

export function toast(message: string): void {
  document.querySelector('.toast')?.remove();
  const el = h('div', { class: 'toast', role: 'status' }, message);
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), TOAST_MS);
}

export async function copyText(text: string, done = 'Скопировано — вставьте в чат игры'): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch (error) {
    console.error('[clipboard]', error);
    toast('Не удалось скопировать: разрешите доступ к буферу обмена');
  }
}

export function errorBox(message: string): HTMLElement {
  return h('div', { class: 'error-box', role: 'alert' }, message);
}

export function loading(message: string): HTMLElement {
  return h('div', { class: 'muted' }, h('span', { class: 'spinner' }), ' ', message);
}

/** Big centered page header: small accent line, headline with one gradient word, subtitle. */
export function heroBlock(eyebrow: string, title: string, accent: string, subtitle: string, icon?: SVGSVGElement): HTMLElement {
  return h('header', { class: 'hero' },
    h('div', { class: 'eyebrow' }, icon ?? null, eyebrow),
    h('h1', {}, title, ' ', h('em', {}, accent)),
    h('p', { class: 'subtitle' }, subtitle));
}

function pictureIn(box: HTMLElement, url: string | undefined, alt: string, fallback: () => SVGSVGElement): HTMLElement {
  if (!url) {
    append(box, fallback());
    return box;
  }
  const img = h('img', { src: url, alt, loading: 'lazy', decoding: 'async' });
  img.addEventListener('error', () => replace(box, fallback()));
  append(box, img);
  return box;
}

/** Item picture on a soft "stage"; falls back to a glyph when the icon is missing or fails. */
export function stageImage(url: string | undefined, alt: string): HTMLElement {
  return pictureIn(h('div', { class: 'stage' }), url, alt, () => glyph('image', 28));
}

export function thumbImage(url: string | undefined, alt = ''): HTMLElement {
  return pictureIn(h('div', { class: 'thumb' }), url, alt, () => glyph('image', 16));
}

export function emptyState(icon: string, text: string): HTMLElement {
  return h('div', { class: 'empty' }, glyph(icon, 24), h('div', {}, text));
}

export interface SearchOption<T> {
  readonly label: string;
  readonly hint?: string;
  readonly image?: string;
  readonly value: T;
}

const MAX_SUGGESTIONS = 12;

/** Text field with a suggestion list; `find` returns options for the typed text. */
export function searchBox<T>(placeholder: string, find: (query: string) => readonly SearchOption<T>[], onPick: (value: T, label: string) => void, initial = ''): HTMLElement {
  const input = h('input', { type: 'search', placeholder, value: initial, autocomplete: 'off', 'aria-label': placeholder });
  const list = h('div', { class: 'suggestions', hidden: true });
  let options: readonly SearchOption<T>[] = [];
  let focused = 0;

  const render = () => {
    replace(list, ...options.map((o, i) => h('button', {
      type: 'button',
      class: i === focused ? 'focused' : '',
      on: { mousedown: (e) => { e.preventDefault(); pick(i); } },
    }, thumbImage(o.image, o.label), h('span', {}, o.label), o.hint ? h('span', { class: 'muted small' }, o.hint) : h('span', {}))));
    list.hidden = options.length === 0;
  };
  const pick = (i: number) => {
    const option = options[i];
    if (!option) return;
    input.value = option.label;
    options = [];
    render();
    onPick(option.value, option.label);
  };
  input.addEventListener('input', () => {
    options = input.value.trim().length < 2 ? [] : find(input.value.trim()).slice(0, MAX_SUGGESTIONS);
    focused = 0;
    render();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') focused = Math.min(options.length - 1, focused + 1);
    else if (e.key === 'ArrowUp') focused = Math.max(0, focused - 1);
    else if (e.key === 'Enter') return pick(focused);
    else if (e.key === 'Escape') options = [];
    else return;
    e.preventDefault();
    render();
  });
  input.addEventListener('blur', () => { options = []; render(); });
  return h('div', { class: 'search' }, h('div', { class: 'search-field' }, glyph('search', 20), input), list);
}
