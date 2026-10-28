// Each level takes place in a different part of the sinus system. Levels cycle
// through LOCATIONS; difficulty keeps rising via levelSpec(level).
// Left/right pairs share one layout, mirrored. "Sol"/"Sağ" follow the viewer's
// left/right, matching the reference art and the in-game sinus map.

import { type QuietRect, parseLayout, type Layout } from './maze.ts';

export type RegionId = 'nasal-l' | 'nasal-r' | 'maxillary-l' | 'maxillary-r' | 'ethmoid' | 'frontal' | 'sphenoid';

export interface Location {
  name: string;
  region: RegionId;
  blurb: string;
  /** Inflamed-state tints (walls are greyscale-shaded and tinted on the GPU). */
  wall: number;
  floor: number;
  layout: Layout;
}

const W = '############################';
const F = '#..........................#';

// Septum on one side, three turbinates (conchae) on the lateral side.
const NASAL = [
  W,
  F,
  '#.###.############.#######.#',
  '#o###.############.#######o#',
  '#.###..............#######.#',
  '#.###.#######.####.........#',
  '#.###.#######.####.#######.#',
  '#.###.#######.####.#######.#',
  '#.###.........####.#######.#',
  '#.###.###.###.####.#######.#',
  '#.###.###.###.####.........#',
  '#.###.###..........#######.#',
  '#.###.###.###--###.#######.#',
  '#.###.###.#______#.#######.#',
  '..........#______#.#######..',
  '#.###.###.#______#.#######.#',
  '#.###.###.########.#######.#',
  '#.###.###..................#',
  '#.###.###.##.#########.###.#',
  '#.###.###.##.#########.###.#',
  '#.###.....##...............#',
  '#.###.######.#############.#',
  '#.###.######.#############.#',
  '#.###..................###.#',
  '#.###.###.########.###.###.#',
  '#o###.###.########.###.###o#',
  '#.###......................#',
  '#.###.#######.######.#####.#',
  '#.###.#######.######.#####.#',
  F,
  W,
];

// Wide chamber full of rounded pockets; tooth-root bumps along the floor.
const MAXILLARY = [
  W,
  F,
  '#.##.##.##.###.########.##.#',
  '#o##.##.##.###.########.##.#',
  '#..............########....#',
  '#.##.##.##.###.########.##.#',
  '#.##.##.##.###.########.##.#',
  F,
  '#.##.##.##.######.##.##.##.#',
  '#.##.##.##.######.##.##.##o#',
  '#.##.##.##.######.##.##.##.#',
  F,
  '#.##.##.#.###--###.#.##.##.#',
  '#.##.##.#.#______#.#.##.##.#',
  '..........#______#..........',
  '#.##.##.#.#______#.#.##.##.#',
  '#.##.##.#.########.#.##.##.#',
  F,
  '#.##.##.#####.###.##.##.##.#',
  '#.##.##.#####.###.##.##.##.#',
  F,
  '#.#####.##.###.##.##.##.##.#',
  '#.#####.##.###.##.##.##.##.#',
  '#.#####....................#',
  '#o#####.##.###.##.##.##.##.#',
  '#.#####.##.###.##.##.##.##.#',
  F,
  '#.##.##.##.##.##.##.##.###o#',
  '#.##.##.##.##.##.##.##.###.#',
  F,
  W,
];

// Staggered small air cells, like a honeycomb.
const ETHMOID = [
  W,
  F,
  '#.###.###.########.###.###.#',
  '#o###.###.########.###.###o#',
  F,
  '###.###.###.####.###.###.###',
  '###.###.###.####.###.###.###',
  F,
  '#.###.###.########.###.###.#',
  '#.###.###.########.###.###.#',
  '#.###.###.########.###.###.#',
  F,
  '#.###.###.###--###.###.###.#',
  '#.###.###.#______#.###.###.#',
  '......###.#______#.###......',
  '#.###.###.#______#.###.###.#',
  '#.###.###.########.###.###.#',
  F,
  '###.###.###.####.###.###.###',
  '###.###.###.####.###.###.###',
  F,
  '#.###.###.########.###.###.#',
  '#.###.###.########.###.###.#',
  F,
  '###.###.###.####.###.###.###',
  '###.###.###.####.###.###.###',
  F,
  '#o###.###.########.###.###o#',
  '#.###.###.########.###.###.#',
  F,
  W,
];

// Two big lobes above the brows, split by the intersinus septum.
const FRONTAL = [
  W,
  '#...........####...........#',
  '#.#########.####.#########.#',
  '#o#########.####.#########o#',
  '#.#########.####.#########.#',
  '#.#########.####.#########.#',
  '#.#########.####.#########.#',
  '#.#########.####.#########.#',
  F,
  '#.##.####.########.####.##.#',
  '#.##.####.########.####.##.#',
  F,
  '#.##.####.###--###.####.##.#',
  '#.##.####.#______#.####.##.#',
  '.....####.#______#.####.....',
  '#.##.####.#______#.####.##.#',
  '#.##.####.########.####.##.#',
  F,
  '#.####.#####.##.#####.####.#',
  '#.####.#####.##.#####.####.#',
  F,
  '#.##########.##.##########.#',
  '#.##########.##.##########.#',
  '#.##########....##########.#',
  '#.##########.##.##########.#',
  '#o##########.##.##########o#',
  '#.##########.##.##########.#',
  '#.##########.##.##########.#',
  '#.##########.##.##########.#',
  F,
  W,
];

// The deepest sinus: a compact network with long side passages.
const SPHENOID = [
  W,
  '#.....###..........###.....#',
  '#.###.###.########.###.###.#',
  '#o###.###.########.###.###o#',
  '#.###..................###.#',
  '#.###.######.##.######.###.#',
  '#.###.######.##.######.###.#',
  '#.....###....##....###.....#',
  '#####.###.########.###.#####',
  '#####.### ######## ###.#####',
  '#####.### ######## ###.#####',
  '#####.###          ###.#####',
  '#####.### ###--### ###.#####',
  '#####.### #______# ###.#####',
  '     .    #______#    .     ',
  '#####.### #______# ###.#####',
  '#####.### ######## ###.#####',
  '#####.###          ###.#####',
  '#####.### ######## ###.#####',
  '#####.### ######## ###.#####',
  '#.....###..........###.....#',
  '#.###.######.##.######.###.#',
  '#.###.######.##.######.###.#',
  '#.###........  ........###.#',
  '#o###.###.########.###.###o#',
  '#.###.###.########.###.###.#',
  F,
  '#.##########.##.##########.#',
  '#.##########.##.##########.#',
  '#............##............#',
  W,
];

const NASAL_QUIET: QuietRect[] = [[9, 19, 6, 25]];
const MAXILLARY_QUIET: QuietRect[] = [
  [7, 20, 6, 21],
  [24, 25, 8, 19],
];
const ETHMOID_QUIET: QuietRect[] = [[7, 20, 2, 25]];
const FRONTAL_QUIET: QuietRect[] = [[9, 19, 5, 22]];

export const LOCATIONS: readonly Location[] = [
  {
    name: 'Sol Burun Boşluğu',
    region: 'nasal-l',
    blurb: 'Burun boşluğu soluduğumuz havayı ısıtır, nemlendirir ve süzer. Konkaların arasındaki kanallar tıkanınca nefes daralır.',
    wall: 0xec97b0,
    floor: 0xfde8ee,
    // Viewer-left cavity: septum toward the midline (right), turbinates lateral (left).
    layout: parseLayout(NASAL, true, NASAL_QUIET),
  },
  {
    name: 'Sağ Burun Boşluğu',
    region: 'nasal-r',
    blurb: 'Burun bölmesi (septum) iki boşluğu ayırır. Gün içinde iki taraf sırayla hafifçe tıkanıp açılır; buna burun siklusu denir.',
    wall: 0xe995b5,
    floor: 0xfde7f0,
    layout: parseLayout(NASAL, false, NASAL_QUIET),
  },
  {
    name: 'Sol Maksiller Sinüs',
    region: 'maxillary-l',
    blurb: 'Elmacık kemiklerinin arkasındaki en büyük sinüslerdir. Çıkış kanalları yukarıda olduğu için mukus kolayca birikebilir.',
    wall: 0xef9ea9,
    floor: 0xfeeaec,
    layout: parseLayout(MAXILLARY, false, MAXILLARY_QUIET),
  },
  {
    name: 'Sağ Maksiller Sinüs',
    region: 'maxillary-r',
    blurb: 'Maksiller sinüs tıkandığında yanaklarda ve üst dişlerde baskı hissedilebilir.',
    wall: 0xf0a2a8,
    floor: 0xfeebeb,
    layout: parseLayout(MAXILLARY, true, MAXILLARY_QUIET),
  },
  {
    name: 'Etmoid Sinüsler',
    region: 'ethmoid',
    blurb: 'Gözlerin arasında, petek gibi dizilmiş küçük hava hücrelerinden oluşur.',
    wall: 0xdf9ac0,
    floor: 0xfbe8f2,
    layout: parseLayout(ETHMOID, false, ETHMOID_QUIET),
  },
  {
    name: 'Frontal Sinüs',
    region: 'frontal',
    blurb: 'Alnın arkasında, kaşların üzerindedir. Tıkandığında alında baskı ve baş ağrısı hissedilebilir.',
    wall: 0xee9fae,
    floor: 0xfee9ee,
    layout: parseLayout(FRONTAL, false, FRONTAL_QUIET),
  },
  {
    name: 'Sfenoid Sinüs',
    region: 'sphenoid',
    blurb: 'Kafatasının en derinindeki sinüstür; burnun ta arkasında yer alır.',
    wall: 0xd59cc6,
    floor: 0xf9e9f4,
    layout: parseLayout(SPHENOID, false),
  },
];

export function locationForLevel(level: number): Location {
  return LOCATIONS[(level - 1) % LOCATIONS.length];
}
