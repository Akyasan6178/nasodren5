// Central tuning + content. Everything a designer/marketer may want to tweak lives here.

/** Classic arcade "100%" speed in tiles per second. */
export const FULL_SPEED = 9.47;

export const SIM_HZ = 120;
export const SIM_STEP = 1 / SIM_HZ;

export const START_LIVES = 3;
export const EXTRA_LIFE_SCORE = 10000;

export const SCORE = {
  pellet: 10,
  power: 50,
  ghosts: [200, 400, 800, 1600],
  trap: 100,
} as const;

/** Positive loop: quick consecutive pellets build a multiplier. */
export const COMBO = {
  window: 0.55, // seconds between pellets to keep the chain
  perStep: 12, // pellets per multiplier step
  maxMultiplier: 5,
  maxSpeedBonus: 0.06, // +6% player speed at max multiplier ("flow")
} as const;

/** Negative loop: symptom pressure builds over time, cyclamen resets it. */
export const PRESSURE = {
  graceSeconds: 25,
  rampSeconds: 50, // from 0 to 100% after the grace period
  maxGhostBonus: 0.18, // +18% ghost speed at full pressure
} as const;

export const TRAP = {
  spawnAtPellets: [60, 150],
  lifetime: 9,
  reliefSeconds: 2.2, // short "vasoconstriction" boost
  reliefSpeedBonus: 0.15,
  reboundSeconds: 7,
  reboundSpeedFactor: 0.78,
  swellTiles: 9,
} as const;

export interface LevelSpec {
  pacSpeed: number;
  pacFrightSpeed: number;
  ghostSpeed: number;
  ghostTunnelSpeed: number;
  ghostFrightSpeed: number;
  frightTime: number;
  /** Alternating scatter/chase durations; last entry repeats forever (chase). */
  modes: number[];
  elroyDots: number;
}

export function levelSpec(level: number): LevelSpec {
  const tier = level <= 1 ? 0 : level <= 4 ? 1 : 2;
  return {
    pacSpeed: [0.8, 0.9, 1.0][tier],
    pacFrightSpeed: [0.9, 0.95, 1.0][tier],
    ghostSpeed: [0.75, 0.85, 0.95][tier],
    ghostTunnelSpeed: [0.4, 0.45, 0.5][tier],
    ghostFrightSpeed: [0.5, 0.55, 0.6][tier],
    // Cyclamen stays meaningful at every level (never drops to 0 like the arcade).
    frightTime: Math.max(2.5, 6.5 - (level - 1) * 0.6),
    modes: tier === 0 ? [7, 20, 7, 20, 5, 20, 5] : tier === 1 ? [7, 20, 7, 20, 5] : [5, 20, 5, 20, 5],
    elroyDots: Math.min(40, 20 + (level - 1) * 4),
  };
}

// ---------------------------------------------------------------------------
// Marketing / CTA. Article URLs are placeholders pointing at the homepage until
// the exact article slugs are confirmed; utm_content separates touchpoints.
// ---------------------------------------------------------------------------
const SITE = 'https://yasasinsaglik.com/';
const UTM = 'utm_source=pacman_game&utm_medium=gamification&utm_campaign=siklamen_awareness';

export function ctaUrl(content: 'gameover' | 'levelclear' | 'safety' | 'sidebar', path = ''): string {
  return `${SITE}${path}?${UTM}&utm_content=${content}`;
}

export const LINKS = {
  gameOver: () => ctaUrl('gameover'),
  levelClear: () => ctaUrl('levelclear'),
  safety: () => ctaUrl('safety'),
  sidebar: () => ctaUrl('sidebar'),
};

export const TEXT = {
  title: 'Sinüs Labirenti',
  subtitle: 'Tıkanıklığı aş, nefesini özgür bırak!',
  ready: 'HAZIR!',
  levelClearTitle: '24 Saatlik Ferahlık Sağlandı',
  levelClearTag: 'Doğal Koruma',
  levelClearBody:
    'Tebrikler! Sinüslerinizi başarıyla temizlediniz. Gerçek hayatta da günde sadece 1 doz ile 24 saatlik ferahlık sağlamak ve Siklamenin tıbbi formülasyonlarının (ozmotik etki) nasıl çalıştığını öğrenmek için yasasinsaglik.com adresindeki uzman makalelerini okuyun.',
  levelClearCta: 'Uzman Makalelerini Oku',
  gameOverTitle: 'Tıkanıklık Galip Geldi',
  gameOverBody:
    'Sinüzit semptomları sizi köşeye mi sıkıştırdı? Burun tıkanıklığı ve yüz baskısından kurtulmanın, doğanın gizli gücü olan Siklamen çiçeği ile nasıl mümkün olduğunu keşfedin.',
  gameOverCta: 'Doğal Çözüm Rehberini Oku',
  safety:
    'Önemli: Siklamen bitkisi evde kaynatılarak burun damlası olarak kullanılmamalıdır. Bitkinin etkisinden yalnızca özel işlemlerden geçirilmiş (liyofilize) standart tıbbi ekstrakt formunda güvenle faydalanılabilir.',
  safetyCta: 'Neden evde hazırlanmamalı?',
  shareText: (score: number) =>
    `Benim sinüs temizlik skorum ${score.toLocaleString('tr-TR')}! Sen tıkanıklığı ne kadar hızlı aşabilirsin?`,
  disclaimer: 'Bu oyun yalnızca bilgilendirme amaçlıdır. Tıbbi tavsiye veya teşhis için bir uzmana danışın.',
  toastPower: 'Siklamen özü: ozmotik drenaj başladı!',
  toastTrap: 'Kimyasal açıcı: kısa süreli rahatlama…',
  toastRebound: 'Rebound etkisi! Mukoza şişti, yollar daraldı.',
  toastExtraLife: 'Ekstra nefes kazandın!',
  toastPressure: 'Semptom baskısı artıyor — Siklamen bul!',
};

export const FACTS = [
  'Sağlıklı burunda siliyer hücreler mukusu sürekli genize doğru süpürerek toz ve mikropları dışarı atar.',
  'Rinosinüzitte mukoza şişer, sinüs çıkış kanalları (ostiumlar) tıkanır ve mukus birikir.',
  'Siklamen yumrusundaki saponinler burun mukozasında ozmotik etki yaratarak koyulaşmış mukusun sulanmasına yardımcı olur.',
  'Saponinler trigeminal sinir uçlarını uyararak refleks bir salgı artışı ile sinüslerin doğal drenajını destekler.',
  'Kimyasal dekonjestan spreylerin 5 günden uzun kullanımı "rebound" tıkanıklığa yol açabilir.',
  'Siklamen bitkisi evde kaynatılıp kullanılmamalıdır; yalnızca liyofilize standart ekstrakt formu güvenlidir.',
];

export const GHOST_INFO = [
  { name: 'Akut Enfeksiyon', short: 'Ateş', desc: 'Peşini hiç bırakmaz, doğrudan seni hedefler.' },
  { name: 'Sinüs Baş Ağrısı', short: 'Baş Ağrısı', desc: 'Önünü keser, beklenmedik köşelerde pusu kurar.' },
  { name: 'Yüz Baskısı', short: 'Yüz Baskısı', desc: 'Enfeksiyonla iş birliği yapıp seni sıkıştırır.' },
  { name: 'İnatçı Tıkanıklık', short: 'Tıkanıklık', desc: 'Bazen açılır bazen kapanır; tutarsız ve inatçı.' },
] as const;
