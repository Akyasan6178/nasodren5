// "You are here" sinus map, modelled on gorseller/referans/ornek.png: a soft
// illustrated face on a light or dark panel, colour-coded sinuses, a label column with
// leader lines, and the hero (Siklamen) marking the current location.
// Convention: "Sol"/"Sağ" = the viewer's left/right (as in the reference art).
// Pure SVG: crisp at any size, no image assets.

import type { RegionId } from '../game/locations.ts';

type Pt = readonly [number, number];

/** Closed Catmull-Rom spline through points, as an SVG path. */
function smoothPath(pts: readonly Pt[]): string {
  const n = pts.length;
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return `${d}Z`;
}

/** Maps points from a source bounding box into a target rect. */
function fit(pts: readonly Pt[], src: readonly [number, number, number, number], dst: readonly [number, number, number, number]): Pt[] {
  const [sx0, sy0, sx1, sy1] = src;
  const [dx0, dy0, dx1, dy1] = dst;
  return pts.map(([x, y]) => [dx0 + ((x - sx0) / (sx1 - sx0)) * (dx1 - dx0), dy0 + ((y - sy0) / (sy1 - sy0)) * (dy1 - dy0)] as const);
}

const AXIS = 310; // face midline
const mirror = (pts: readonly Pt[]): Pt[] => pts.map(([x, y]) => [2 * AXIS - x, y] as const);

// Silhouettes traced from gorseller/referans/frontal_sol.png and maxillary_sol.png
// (viewer-left lobes; the right ones are mirrored).
const FRONTAL_SRC: Pt[] = [
  [590, 520], [560, 470], [575, 425], [555, 375], [430, 362], [300, 352], [250, 300], [268, 235],
  [330, 195], [430, 150], [515, 80], [590, 28], [670, 35], [708, 120], [705, 300], [712, 380],
  [722, 450], [715, 520],
];
const MAXILLARY_SRC: Pt[] = [
  [100, 30], [220, 22], [340, 50], [470, 100], [600, 115], [690, 150], [722, 220], [690, 290],
  [630, 330], [570, 400], [520, 480], [470, 515], [400, 505], [330, 450], [250, 390], [200, 380],
  [150, 385], [100, 360], [88, 250], [90, 100],
];
const FRONTAL_L = fit(FRONTAL_SRC, [240, 20, 725, 525], [203, 286, 302, 400]);
const MAXILLARY_L = fit(MAXILLARY_SRC, [85, 15, 725, 520], [132, 436, 262, 542]);
const ETHMOID_L: Pt[] = [
  [262, 392], [285, 384], [300, 394], [302, 430], [298, 466], [284, 480], [265, 472], [255, 446], [259, 418],
];
const NASAL_L: Pt[] = [[300, 380], [303, 430], [304, 560], [276, 563], [255, 549], [257, 500], [271, 448], [288, 404]];
const ETHMOID_CELLS: Pt[] = [[272, 402], [289, 412], [270, 428], [287, 440], [272, 456], [288, 466]];

interface Group {
  key: 'frontal' | 'sphenoid' | 'ethmoid' | 'nasal' | 'maxillary';
  label: string;
  fill: string;
  stroke: string;
  dot: string;
  labelY: number;
  anchor: Pt; // where the leader line lands
}

const GROUPS: Group[] = [
  { key: 'frontal', label: 'Frontal sinüs', fill: 'rgba(142,184,88,0.78)', stroke: '#62873a', dot: '#7fb04a', labelY: 330, anchor: [372, 338] },
  { key: 'sphenoid', label: 'Sfenoid sinüs', fill: 'rgba(232,172,92,0.55)', stroke: '#c98a3a', dot: '#e3a34f', labelY: 376, anchor: [326, 373] },
  { key: 'ethmoid', label: 'Etmoid sinüs', fill: 'rgba(140,154,208,0.75)', stroke: '#6b77aa', dot: '#6f86c9', labelY: 424, anchor: [348, 425] },
  { key: 'nasal', label: 'Burun boşluğu', fill: 'rgba(236,142,158,0.62)', stroke: '#c46c7f', dot: '#e3889a', labelY: 492, anchor: [336, 496] },
  { key: 'maxillary', label: 'Maksiller sinüs', fill: 'rgba(178,122,198,0.74)', stroke: '#8a5aa2', dot: '#9c6bb6', labelY: 548, anchor: [455, 488] },
];

const GROUP_OF: Record<RegionId, Group['key']> = {
  'nasal-l': 'nasal',
  'nasal-r': 'nasal',
  'maxillary-l': 'maxillary',
  'maxillary-r': 'maxillary',
  ethmoid: 'ethmoid',
  frontal: 'frontal',
  sphenoid: 'sphenoid',
};

/** Where the hero marker sits for each location. */
const MARKER: Record<RegionId, Pt> = {
  'nasal-l': [282, 520],
  'nasal-r': [338, 520],
  'maxillary-l': [196, 488],
  'maxillary-r': [424, 488],
  ethmoid: [282, 430],
  frontal: [250, 338],
  sphenoid: [310, 372],
};

export interface DiagramOptions {
  /** Hero icon (data URL) used as the "you are here" marker. */
  marker?: string;
  /** 'card' crops to the sinus band; 'full' shows the whole face. */
  view?: 'card' | 'full';
  /** Unique prefix for SVG ids when several diagrams share a page. */
  id?: string;
  /** Panel the diagram sits on (label/leader colours follow it). */
  theme?: 'dark' | 'light';
}

const INK = {
  dark: { on: '#ffffff', off: '#93a3ad', lineOn: 'rgba(255,255,255,0.75)', lineOff: 'rgba(190,205,215,0.35)', dot: '#fff', outline: '#ffffff' },
  light: { on: '#3a1f33', off: '#8a7383', lineOn: 'rgba(58,31,51,0.6)', lineOff: 'rgba(58,31,51,0.18)', dot: '#3a1f33', outline: '#e0218a' },
} as const;

export function faceDiagram(active: RegionId | null, opts: DiagramOptions = {}): string {
  const id = opts.id ?? 'fd';
  const full = opts.view === 'full';
  const viewBox = full ? '0 40 1010 802' : '92 282 790 292';
  const fontSize = full ? 44 : 25;
  const activeGroup = active ? GROUP_OF[active] : null;
  const ink = INK[opts.theme ?? 'dark'];
  const side = active?.endsWith('-l') ? 'l' : active?.endsWith('-r') ? 'r' : 'both';

  const shape = (d: string, g: Group, on: boolean): string =>
    `<path d="${d}" fill="${g.fill}" stroke="${on ? ink.outline : g.stroke}" stroke-width="${on ? 4 : 2}"${on ? ` filter="url(#${id}-glow)"` : ''}/>`;
  const pair = (left: Pt[], g: Group): string => {
    const isGroup = activeGroup === g.key;
    const onL = isGroup && side !== 'r';
    const onR = isGroup && side !== 'l';
    return shape(smoothPath(left), g, onL) + shape(smoothPath(mirror(left)), g, onR);
  };
  const G = Object.fromEntries(GROUPS.map((g) => [g.key, g])) as Record<Group['key'], Group>;

  const cells = [...ETHMOID_CELLS, ...mirror(ETHMOID_CELLS)]
    .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4.5" fill="#9fb6f0" opacity="0.85"/>`)
    .join('');

  const sph = G.sphenoid;
  const sphOn = activeGroup === 'sphenoid';
  const regions =
    `<ellipse cx="${AXIS}" cy="372" rx="18" ry="12" fill="${sph.fill}" stroke="${sphOn ? ink.outline : sph.stroke}" stroke-width="${sphOn ? 4 : 2}" stroke-dasharray="${sphOn ? '0' : '5 4'}"${sphOn ? ` filter="url(#${id}-glow)"` : ''}/>` +
    pair(MAXILLARY_L, G.maxillary) +
    pair(NASAL_L, G.nasal) +
    pair(ETHMOID_L, G.ethmoid) +
    cells +
    pair(FRONTAL_L, G.frontal);

  const labels = GROUPS.map((g) => {
    const on = g.key === activeGroup;
    const lx = 612;
    return `<line x1="${g.anchor[0]}" y1="${g.anchor[1]}" x2="${lx - 12}" y2="${g.labelY}" stroke="${on ? ink.lineOn : ink.lineOff}" stroke-width="${on ? 2.2 : 1.5}"/>
      <circle cx="${g.anchor[0]}" cy="${g.anchor[1]}" r="3.5" fill="${ink.dot}" opacity="${on ? 1 : 0.6}"/>
      <circle cx="${lx}" cy="${g.labelY}" r="${on ? 9 : 7}" fill="${g.dot}"/>
      <text x="${lx + 18}" y="${g.labelY + fontSize * 0.36}" font-size="${on ? fontSize + 2 : fontSize}" font-weight="${on ? 800 : 600}" fill="${on ? ink.on : ink.off}">${g.label}</text>`;
  }).join('');

  let marker = '';
  if (active && opts.marker) {
    const [mx, my] = MARKER[active];
    const tagW = 214;
    // Right-side regions put the tag on the left so it never covers the label column.
    const tx = active === 'maxillary-r' || active === 'nasal-r' ? mx - 30 - tagW : mx + 30;
    marker = `<image href="${opts.marker}" x="${mx - 28}" y="${my - 34}" width="56" height="56"/>
      <g transform="translate(${tx},${my + 4})"><rect x="0" y="-17" width="${tagW}" height="34" rx="9" fill="#26222c" opacity="0.92"/>
      <text x="${tagW / 2}" y="7" font-size="19" font-weight="800" fill="#ffe1f0" text-anchor="middle" letter-spacing="1">SİKLAMEN ÇİÇEĞİ</text></g>`;
  }

  return `<svg viewBox="${viewBox}" class="face-diagram" role="img" aria-label="Sinüs haritası">
  <defs>
    <radialGradient id="${id}-skin" cx="0.5" cy="0.42" r="0.62">
      <stop offset="0" stop-color="#dcae98"/><stop offset="0.55" stop-color="#c8957f"/>
      <stop offset="0.85" stop-color="#8f6253"/><stop offset="1" stop-color="#5c3b32"/>
    </radialGradient>
    <linearGradient id="${id}-hair" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2a1d1a"/><stop offset="1" stop-color="#4a332d"/>
    </linearGradient>
    <filter id="${id}-glow" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <path d="M195 690 L190 842 L430 842 L425 690Z" fill="#7d5546"/>
  <ellipse cx="40" cy="470" rx="30" ry="62" fill="#a77462"/><ellipse cx="580" cy="470" rx="30" ry="62" fill="#a77462"/>
  <path d="M52 460 q-14 -10 -6 -40 M568 460 q14 -10 6 -40" stroke="#7a4f42" stroke-width="5" fill="none" stroke-linecap="round"/>
  <path d="${smoothPath([[310, 92], [452, 120], [546, 212], [578, 332], [575, 472], [545, 602], [470, 712], [380, 776], [310, 792], [240, 776], [150, 712], [75, 602], [45, 472], [42, 332], [74, 212], [168, 120]])}" fill="url(#${id}-skin)"/>
  <path d="${smoothPath([[30, 330], [24, 215], [80, 108], [190, 34], [310, 12], [430, 34], [540, 108], [596, 215], [590, 330], [560, 248], [470, 156], [310, 132], [150, 156], [60, 248]])}" fill="url(#${id}-hair)"/>
  <path d="M128 352 Q190 333 262 349 M492 352 Q430 333 358 349" stroke="#4a2f28" stroke-width="14" fill="none" stroke-linecap="round"/>
  <g>
    <path d="M140 388 Q195 358 250 388 Q195 410 140 388Z" fill="#f3ebe7"/><circle cx="195" cy="388" r="16" fill="#5a89ae"/><circle cx="195" cy="388" r="7" fill="#1d2a35"/><circle cx="200" cy="383" r="4" fill="#fff"/>
    <path d="M138 386 Q195 352 252 386" stroke="#3b2620" stroke-width="4" fill="none"/>
    <path d="M370 388 Q425 358 480 388 Q425 410 370 388Z" fill="#f3ebe7"/><circle cx="425" cy="388" r="16" fill="#5a89ae"/><circle cx="425" cy="388" r="7" fill="#1d2a35"/><circle cx="430" cy="383" r="4" fill="#fff"/>
    <path d="M368 386 Q425 352 482 386" stroke="#3b2620" stroke-width="4" fill="none"/>
  </g>
  <path d="M292 402 Q284 470 276 528" stroke="rgba(90,50,40,0.22)" stroke-width="7" fill="none" stroke-linecap="round"/>
  <ellipse cx="310" cy="530" rx="28" ry="18" fill="rgba(255,222,204,0.16)"/>
  <ellipse cx="289" cy="553" rx="13" ry="7" fill="rgba(70,35,30,0.45)"/><ellipse cx="331" cy="553" rx="13" ry="7" fill="rgba(70,35,30,0.45)"/>
  <ellipse cx="310" cy="582" rx="42" ry="8" fill="rgba(60,30,25,0.16)"/>
  <path d="M232 640 Q270 626 310 634 Q350 626 388 640 Q350 648 310 646 Q270 648 232 640Z" fill="#c98078"/>
  <path d="M240 642 Q310 674 380 642 Q310 655 240 642Z" fill="#b56c64"/>
  ${regions}
  ${labels}
  ${marker}
</svg>`;
}
