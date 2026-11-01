/** Small inline SVG icons, built with DOM APIs (no innerHTML). */

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(paths: readonly string[], size: number, title: string): SVGSVGElement {
  const root = document.createElementNS(SVG_NS, 'svg');
  root.setAttribute('viewBox', '0 0 24 24');
  root.setAttribute('width', String(size));
  root.setAttribute('height', String(size));
  root.setAttribute('aria-label', title);
  root.setAttribute('role', 'img');
  root.classList.add('icon');
  const label = document.createElementNS(SVG_NS, 'title');
  label.textContent = title;
  root.appendChild(label);
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    root.appendChild(path);
  }
  return root;
}

/** Stylized polarity glyphs (Madurai, Vazarin, Naramon...). */
const POLARITY_PATHS: Readonly<Record<string, readonly string[]>> = {
  AP_ATTACK: ['M5 5l7 14 7-14', 'M9 5l3 6 3-6'],
  AP_DEFENSE: ['M7 4h5a8 8 0 0 1 0 16H7z', 'M11 9v6'],
  AP_TACTIC: ['M3 12h18', 'M7 8l-4 4 4 4', 'M17 8l4 4-4 4'],
  AP_POWER: ['M4 8h16', 'M4 16h16', 'M8 12h8'],
  AP_WARD: ['M12 21v-9', 'M12 12L5 4', 'M12 12l7-8'],
  AP_PRECEPT: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 8v8', 'M8 12h8'],
  AP_UMBRA: ['M12 3l9 9-9 9-9-9z', 'M12 8l4 4-4 4-4-4z'],
  AP_UNIVERSAL: ['M12 3v18', 'M3 12h18', 'M6 6l12 12', 'M18 6L6 18'],
};

export const POLARITY_NAMES: Readonly<Record<string, string>> = {
  '': 'без полярности', AP_ATTACK: 'Мадурай', AP_DEFENSE: 'Вазарин', AP_TACTIC: 'Нарамон', AP_POWER: 'Зенурик',
  AP_WARD: 'Унайру', AP_PRECEPT: 'Пенджага', AP_UMBRA: 'Умбра', AP_UNIVERSAL: 'Любая',
};

export function polarityIcon(code: string, size = 16): SVGSVGElement {
  return svg(POLARITY_PATHS[code] ?? ['M8 12h8'], size, POLARITY_NAMES[code] ?? code);
}

const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  logo: ['M12 2l8 5v10l-8 5-8-5V7z', 'M12 7l4 2.5v5L12 17l-4-2.5v-5z'],
  farm: ['M12 2l7 4v6c0 5-3 8-7 10-4-2-7-5-7-10V6z', 'M9 12l2 2 4-4'],
  builds: ['M4 4h7v7H4z', 'M13 4h7v7h-7z', 'M4 13h7v7H4z', 'M13 13h7v7h-7z'],
  market: ['M4 7h16l-1.5 10a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2z', 'M9 7a3 3 0 0 1 6 0'],
  refresh: ['M20 11a8 8 0 1 0-2.3 5.7', 'M20 4v7h-7'],
  search: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'M20 20l-4-4'],
  spark: ['M12 3v4', 'M12 17v4', 'M3 12h4', 'M17 12h4', 'M6 6l2.5 2.5', 'M15.5 15.5L18 18', 'M18 6l-2.5 2.5', 'M8.5 15.5L6 18'],
  plus: ['M12 5v14', 'M5 12h14'],
  copy: ['M8 8h11v11H8z', 'M5 16V5h11'],
  screen: ['M3 5h18v11H3z', 'M8 20h8', 'M12 16v4'],
  image: ['M4 5h16v14H4z', 'M4 15l4-4 4 4 3-3 5 5', 'M15 9h.01'],
};

export function glyph(name: string, size = 18): SVGSVGElement {
  return svg(GLYPHS[name] ?? GLYPHS.spark, size, name);
}

/** One-character polarity marks, readable even in a narrow select. */
export const POLARITY_SHORT: Readonly<Record<string, string>> = {
  AP_ATTACK: 'V', AP_DEFENSE: 'D', AP_TACTIC: '—', AP_POWER: '=', AP_WARD: 'Y', AP_PRECEPT: 'П', AP_UMBRA: 'U', AP_UNIVERSAL: '✱',
};
