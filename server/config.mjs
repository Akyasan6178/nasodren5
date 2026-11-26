// Sunucu yapılandırması. Ortam değişkenlerini okur, doğrular ve güvenli sınırlar içinde tutar.
//
// Mod ayrımı:
//   production  — `npm start` (server.mjs). ADMIN_PASSWORD zorunludur ve güçlü olmalıdır;
//                 aksi hâlde sunucu başlamaz (fail-fast).
//   development — `npm run dev` (Vite). ADMIN_PASSWORD verilmezse yalnızca yerel geliştirme için
//                 bilinen geliştirme parolası kullanılır ve uyarı yazılır.

/** Yalnızca geliştirme modunda, ADMIN_PASSWORD verilmediğinde kullanılan parola. Production'da reddedilir. */
export const DEV_ADMIN_PASSWORD = 'siklamen';
export const MIN_ADMIN_PASSWORD_LENGTH = 12;

// Bilinen varsayılan / örnek / zayıf değerler (küçük harfe çevrilerek karşılaştırılır).
const WEAK_PASSWORDS = new Set([
  DEV_ADMIN_PASSWORD, 'admin', 'administrator', 'password', 'parola', 'sifre', 'şifre', 'changeme', 'change-me',
  'degistir', 'değiştir', 'secret', 'gizli', 'qwerty', '123456', '12345678', '123456789', '1234567890',
  'admin123', 'password123', 'siklamen123', 'yonetici', 'yönetici',
]);

/** Rate-limit ayarları: [varsayılan, en az, en çok]. */
const LIMIT_SPECS = {
  ADMIN_LOGIN_MAX_FAILURES: [10, 1, 1000],
  ADMIN_LOGIN_WINDOW_SECONDS: [900, 10, 86_400],
  ROOM_CREATE_MAX: [20, 1, 1000],
  ROOM_CREATE_WINDOW_SECONDS: [900, 10, 86_400],
  GAME_START_MAX: [120, 1, 10_000],
  GAME_START_WINDOW_SECONDS: [900, 10, 86_400],
};

export class ConfigError extends Error {}

/**
 * Parolayı değerlendirir; sorun varsa açıklama döndürür. Açıklama asla parolanın kendisini içermez.
 * @returns {string | null}
 */
export function adminPasswordProblem(value) {
  if (value === undefined || value === null) return 'ADMIN_PASSWORD ortam değişkeni ayarlanmamış.';
  const pw = String(value);
  if (!pw.trim()) return 'ADMIN_PASSWORD ortam değişkeni boş.';
  if (WEAK_PASSWORDS.has(pw.trim().toLocaleLowerCase('tr'))) {
    return 'ADMIN_PASSWORD bilinen bir varsayılan ya da zayıf değer. Benzersiz ve güçlü bir parola seçin.';
  }
  if ([...pw].length < MIN_ADMIN_PASSWORD_LENGTH) {
    return `ADMIN_PASSWORD çok kısa; en az ${MIN_ADMIN_PASSWORD_LENGTH} karakter olmalı.`;
  }
  if (new Set(pw).size < 4) return 'ADMIN_PASSWORD çok tekdüze; farklı karakterler içeren bir parola seçin.';
  return null;
}

/** Tam sayı okur; geçersizse varsayılanı, aralık dışındaysa en yakın sınırı kullanır. */
function intSetting(env, name, [def, min, max], warnings) {
  const raw = env[name];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  if (!Number.isInteger(n)) {
    warnings.push(`${name} geçerli bir tam sayı değil; varsayılan (${def}) kullanılıyor.`);
    return def;
  }
  if (n < min || n > max) {
    const c = Math.min(max, Math.max(min, n));
    warnings.push(`${name} ${min}–${max} aralığı dışında; ${c} kullanılıyor.`);
    return c;
  }
  return n;
}

/** TRUST_PROXY: 0/false = proxy'ye güvenme (varsayılan), 1–5 = güvenilen ters vekil sayısı, true = 1. */
function trustProxySetting(env, warnings) {
  const raw = String(env.TRUST_PROXY ?? '').trim().toLowerCase();
  if (!raw || raw === '0' || raw === 'false' || raw === 'no') return 0;
  if (raw === 'true' || raw === 'yes') return 1;
  const n = Number(raw);
  if (Number.isInteger(n) && n >= 1 && n <= 5) return n;
  warnings.push('TRUST_PROXY geçersiz (0–5 ya da true/false olmalı); proxy başlıklarına güvenilmiyor.');
  return 0;
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {'production' | 'development'} mode
 */
export function loadConfig(env, mode) {
  if (mode !== 'production' && mode !== 'development') throw new ConfigError(`Bilinmeyen mod: ${mode}`);
  const warnings = [];

  let adminPassword = env.ADMIN_PASSWORD;
  if (mode === 'production') {
    const problem = adminPasswordProblem(adminPassword);
    if (problem) throw new ConfigError(`${problem} Production sunucusu güvenli bir yönetici parolası olmadan başlamaz.`);
  } else if (adminPassword === undefined || adminPassword === '') {
    adminPassword = DEV_ADMIN_PASSWORD;
    warnings.push('Geliştirme modu: ADMIN_PASSWORD verilmedi, yalnızca yerel geliştirme için varsayılan parola kullanılıyor.');
  }

  let port = 8080;
  if (env.PORT !== undefined && env.PORT !== '') {
    const p = Number(env.PORT);
    if (Number.isInteger(p) && p >= 0 && p <= 65_535) port = p;
    else warnings.push('PORT geçersiz; 8080 kullanılıyor.');
  }

  const n = (k) => intSetting(env, k, LIMIT_SPECS[k], warnings);
  return {
    mode,
    adminPassword,
    port,
    trustProxy: trustProxySetting(env, warnings),
    limits: {
      adminLogin: { max: n('ADMIN_LOGIN_MAX_FAILURES'), windowMs: n('ADMIN_LOGIN_WINDOW_SECONDS') * 1000 },
      roomCreate: { max: n('ROOM_CREATE_MAX'), windowMs: n('ROOM_CREATE_WINDOW_SECONDS') * 1000 },
      gameStart: { max: n('GAME_START_MAX'), windowMs: n('GAME_START_WINDOW_SECONDS') * 1000 },
    },
    warnings,
  };
}
