// Optional custom artwork from the /gorseller folder (see gorseller/BENIOKU.md).
// Files are discovered at build time via import.meta.glob, so missing files
// cause no 404 requests, and in dev adding a file triggers a reload. Anything
// not provided keeps its procedural drawing. Custom images are rasterized into
// the same atlas, so they cost nothing extra per frame.

export interface Slot {
  /** On-screen size of the image's longest side, in maze tiles. */
  box: number;
  /** Turn to face up/down like Pac-Man (otherwise mirror left/right and only lean). */
  rotate?: boolean;
}

/** Sprite slots that go into the game atlas. */
export const SPRITE_SLOTS = {
  oyuncu: { box: 2.7, rotate: true },
  'virus-ates': { box: 1.85 },
  'virus-bas-agrisi': { box: 1.85 },
  'virus-yuz-baskisi': { box: 1.85 },
  'virus-tikaniklik': { box: 1.85 },
  drenaj: { box: 1.8 },
  'drenaj-uyari': { box: 1.8 },
  mukus: { box: 0.42 },
  'siklamen-ozu': { box: 1.5 },
  sprey: { box: 1.5 },
  sislik: { box: 1.2 },
} satisfies Record<string, Slot>;

/** UI-only images (DOM, not atlas). */
export const UI_SLOTS = ['logo', 'arka-plan'] as const;

export type SpriteSlot = keyof typeof SPRITE_SLOTS;
export const VIRUS_SLOTS: readonly SpriteSlot[] = ['virus-ates', 'virus-bas-agrisi', 'virus-yuz-baskisi', 'virus-tikaniklik'];

export interface CustomArt {
  /** Slot -> animation frames (one or more images, in numeric order). */
  sprites: Map<SpriteSlot, HTMLImageElement[]>;
  /** UI slot -> URL. */
  ui: Map<string, string>;
}

const FILES = import.meta.glob('/gorseller/*.{png,webp,jpg,jpeg,svg,PNG,WEBP,JPG,JPEG,SVG}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

export async function loadCustomArt(): Promise<CustomArt> {
  const sprites = new Map<SpriteSlot, HTMLImageElement[]>();
  const ui = new Map<string, string>();
  const frames = new Map<SpriteSlot, Array<[number, string]>>();

  for (const [path, url] of Object.entries(FILES)) {
    const name = path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '').toLowerCase();
    if ((UI_SLOTS as readonly string[]).includes(name)) {
      ui.set(name, url);
      continue;
    }
    // "virus-ates.png" or animation frames "virus-ates-1.png", "virus-ates-2.png", ...
    const m = /^(.*?)-(\d+)$/.exec(name);
    const base = (name in SPRITE_SLOTS ? name : m && m[1] in SPRITE_SLOTS ? m[1] : null) as SpriteSlot | null;
    if (!base) {
      console.warn(`[gorseller] Tanınmayan dosya adı: "${path}". Geçerli adlar için gorseller/BENIOKU.md dosyasına bakın.`);
      continue;
    }
    const order = base === name ? 0 : Number(m![2]);
    if (!frames.has(base)) frames.set(base, []);
    frames.get(base)!.push([order, url]);
  }

  await Promise.all(
    [...frames.entries()].map(async ([slot, list]) => {
      list.sort((a, b) => a[0] - b[0]);
      const imgs = await Promise.all(list.map(([, url]) => loadImage(url)));
      const ok = imgs.filter((i): i is HTMLImageElement => i !== null);
      if (ok.length) sprites.set(slot, ok);
    }),
  );
  return { sprites, ui };
}

async function loadImage(url: string): Promise<HTMLImageElement | null> {
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  try {
    await img.decode();
    return img;
  } catch {
    console.warn(`[gorseller] Görsel yüklenemedi: ${url}`);
    return null;
  }
}
