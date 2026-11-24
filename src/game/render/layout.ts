// Yerleşim: tasarım görselindeki ölçüler (1600×900) ve telefon için dikey karşılığı (900×1600).

export interface Rect { x: number; y: number; w: number; h: number }
export interface Line { x0: number; x1: number; y: number }

export interface Layout {
  portrait: boolean;
  W: number;
  H: number;
  sep: Line;
  btnNew: Rect;
  btnSound: Rect;
  btnFull: Rect;
  /** Oyunu duraklatma düğmesi. */
  btnPause: Rect;
  lifelines: [Rect, Rect, Rect];
  lifelineFont: number;
  title: { cx: number; brandY: number; brandSize: number; subY: number; subSize: number };
  counter: Rect;
  tagline: Rect;
  timer: { cx: number; cy: number; r: number };
  question: Rect & { pt: number; font: number; padX: number };
  answers: [Rect, Rect, Rect, Rect];
  answerPt: number;
  confirm: Rect;
  /**
   * Cevap sonrası açıklama kartı: (cx, cy) merkezine göre ortalanır, üst kenarı minY'den
   * yukarı çıkmaz. font: açıklama yazısının en büyük boyutu, lines: izin verilen satır sayısı.
   */
  feedback: { cx: number; cy: number; minY: number; w: number; font: number; lines: number };
  panel: Rect;
  panelTitle: { cx: number; cy: number; size: number };
  head: Rect;
  percent: { cx: number; cy: number; size: number };
  petals: { cx: number; cy: number; s: number };
  modal: { cx: number; cy: number; w: number; h: number };
}

const r = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

export const LANDSCAPE: Layout = {
  portrait: false,
  W: 1600,
  H: 900,
  sep: { x0: 0, x1: 1186, y: 82 },
  btnNew: r(800, 14, 190, 56),
  btnSound: r(1008, 14, 64, 56),
  btnFull: r(1090, 14, 64, 56),
  btnPause: r(718, 14, 64, 56),
  // jokerler üst satırda, "Yeni oyun" ile aynı hizada
  lifelines: [r(30, 14, 138, 56), r(182, 14, 120, 56), r(316, 14, 156, 56)],
  lifelineFont: 17,
  title: { cx: 640, brandY: 304, brandSize: 114, subY: 343, subSize: 30 },
  counter: r(515, 358, 250, 46),
  tagline: r(150, 410, 980, 32),
  timer: { cx: 180, cy: 300, r: 86 },
  question: { ...r(50, 455, 1105, 155), pt: 66, font: 35, padX: 120 },
  answers: [r(60, 630, 545, 78), r(620, 630, 525, 78), r(60, 727, 545, 78), r(620, 727, 525, 78)],
  answerPt: 40,
  confirm: r(528, 816, 200, 44),
  feedback: { cx: 596, cy: 455, minY: 20, w: 880, font: 21, lines: 2 },
  panel: r(1192, 18, 388, 840),
  panelTitle: { cx: 1386, cy: 82, size: 25 },
  head: r(1198, 140, 378, 610),
  percent: { cx: 1386, cy: 790, size: 82 },
  petals: { cx: 640, cy: 440, s: 1 },
  modal: { cx: 600, cy: 470, w: 660, h: 400 },
};

export const PORTRAIT: Layout = {
  portrait: true,
  W: 900,
  H: 1600,
  sep: { x0: 0, x1: 900, y: 104 },
  btnNew: r(536, 26, 164, 54),
  btnSound: r(714, 26, 66, 54),
  btnFull: r(794, 26, 66, 54),
  // üst satır dolu: duraklatma, başlığın solunda süre sayacının simetriğinde durur
  btnPause: r(61, 291, 66, 54),
  lifelines: [r(24, 26, 150, 54), r(186, 26, 136, 54), r(334, 26, 182, 54)],
  lifelineFont: 19,
  title: { cx: 450, brandY: 328, brandSize: 98, subY: 370, subSize: 28 },
  counter: r(325, 386, 250, 48),
  tagline: r(40, 444, 820, 34),
  timer: { cx: 806, cy: 318, r: 64 },
  question: { ...r(24, 836, 852, 200), pt: 54, font: 34, padX: 72 },
  answers: [r(40, 1056, 820, 84), r(40, 1154, 820, 84), r(40, 1252, 820, 84), r(40, 1350, 820, 84)],
  answerPt: 38,
  confirm: r(270, 1458, 360, 64),
  // dikeyde kart, sinüs panelinin altındaki soru/şık alanında ortalanır
  feedback: { cx: 450, cy: 1218, minY: 830, w: 836, font: 26, lines: 3 },
  panel: r(40, 500, 820, 310),
  panelTitle: { cx: 610, cy: 572, size: 27 },
  head: r(60, 512, 280, 286),
  percent: { cx: 610, cy: 712, size: 116 },
  petals: { cx: 450, cy: 470, s: 0.9 },
  modal: { cx: 450, cy: 800, w: 800, h: 460 },
};

// Uzun telefon ekranlarında boşluk kalmasın diye dikey tasarımın yüksekliği ekran oranına
// uyarlanır; fazladan yükseklik bölümler arasına paylaştırılır.
const portraitCache = new Map<number, Layout>();

function makePortrait(H: number): Layout {
  const e = H - PORTRAIT.H;
  const P = structuredClone(PORTRAIT);
  const dy = <T extends { y: number }>(o: T, k: number) => { o.y += Math.round(e * k); };
  const dc = <T extends { cy: number }>(o: T, k: number) => { o.cy += Math.round(e * k); };
  P.H = H;
  dy(P.sep, 0.04); dy(P.btnNew, 0.04); dy(P.btnSound, 0.04); dy(P.btnFull, 0.04);
  P.lifelines.forEach((l) => dy(l, 0.04));
  const t = Math.round(e * 0.14);
  P.title.brandY += t; P.title.subY += t;
  dy(P.btnPause, 0.14);
  dy(P.counter, 0.14); dy(P.tagline, 0.14); dc(P.timer, 0.14);
  dy(P.panel, 0.24); dy(P.head, 0.24); dc(P.panelTitle, 0.24); dc(P.percent, 0.24);
  dy(P.question, 0.38);
  P.answers.forEach((a, i) => dy(a, 0.46 + i * 0.04));
  dy(P.confirm, 0.8);
  P.feedback.minY = P.panel.y + P.panel.h + 20;
  P.feedback.cy = Math.round((P.feedback.minY + H) / 2);
  P.petals.cy += t;
  P.modal.cy = Math.round(H / 2);
  return P;
}

export function pickLayout(w: number, h: number): Layout {
  if (h <= w * 1.1) return LANDSCAPE;
  const H = Math.round(Math.min(2000, Math.max(1500, (900 * h) / w)) / 10) * 10;
  let L = portraitCache.get(H);
  if (!L) portraitCache.set(H, (L = makePortrait(H)));
  return L;
}
