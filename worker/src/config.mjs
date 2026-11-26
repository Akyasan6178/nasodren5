// Worker yapılandırması: ortam değişkenleri (vars) ve secret'lar. Değerleri doğrular, sınırlar ve
// eksik/zayıf secret varsa yapılandırmayı "geçersiz" işaretler (Worker bu durumda fail-closed çalışır:
// sağlık kontrolü dışındaki tüm API istekleri 503 alır).
//
// ORTAM: production (varsayılan, bilinmeyen değerler de production sayılır) | preview | development
//   production / preview — ADMIN_PASSWORD güçlü olmalı, SUPABASE_URL https olmalı.
//   development          — ADMIN_PASSWORD verilmezse bilinen geliştirme parolası kullanılır (uyarıyla).
//
// Secret'lar (wrangler secret put): ADMIN_PASSWORD, SUPABASE_URL, SUPABASE_SERVICE_KEY
// Değerler hiçbir mesaja, uyarıya ya da günlüğe yazılmaz; yalnızca değişken adları geçer.

export const DEV_ADMIN_PASSWORD = 'siklamen';
export const MIN_ADMIN_PASSWORD_LENGTH = 12;

const WEAK_PASSWORDS = new Set([
  DEV_ADMIN_PASSWORD, 'admin', 'administrator', 'password', 'parola', 'sifre', 'şifre', 'changeme', 'change-me',
  'degistir', 'değiştir', 'secret', 'gizli', 'qwerty', '123456', '12345678', '123456789', '1234567890',
  'admin123', 'password123', 'siklamen123', 'yonetici', 'yönetici',
]);

/** Hız sınırları: [varsayılan, en az, en çok]. Pencereler saniye cinsinden. */
const LIMIT_SPECS = {
  adminLogin: { max: ['ADMIN_LOGIN_MAX_FAILURES', 10, 1, 1000], window: ['ADMIN_LOGIN_WINDOW_SECONDS', 900, 10, 86_400] },
  roomCreate: { max: ['ROOM_CREATE_MAX', 20, 1, 1000], window: ['ROOM_CREATE_WINDOW_SECONDS', 900, 10, 86_400] },
  gameStart: { max: ['GAME_START_MAX', 120, 1, 10_000], window: ['GAME_START_WINDOW_SECONDS', 900, 10, 86_400] },
  pinFail: { max: ['PIN_FAIL_MAX', 20, 1, 1000], window: ['PIN_FAIL_WINDOW_SECONDS', 600, 10, 86_400] },
  join: { max: ['JOIN_MAX', 30, 1, 1000], window: ['JOIN_WINDOW_SECONDS', 600, 10, 86_400] },
  stream: { max: ['STREAM_MAX', 120, 1, 10_000], window: ['STREAM_WINDOW_SECONDS', 600, 10, 86_400] },
  action: { max: ['ACTION_MAX', 600, 1, 100_000], window: ['ACTION_WINDOW_SECONDS', 600, 10, 86_400] },
};

/**
 * Parolayı değerlendirir; sorun varsa açıklama döndürür. Açıklama asla parolanın kendisini içermez.
 * @returns {string | null}
 */
export function adminPasswordProblem(value) {
  if (value === undefined || value === null) return 'ADMIN_PASSWORD secret tanımlı değil.';
  const pw = String(value);
  if (!pw.trim()) return 'ADMIN_PASSWORD secret boş.';
  if (WEAK_PASSWORDS.has(pw.trim().toLocaleLowerCase('tr'))) {
    return 'ADMIN_PASSWORD bilinen bir varsayılan ya da zayıf değer. Benzersiz ve güçlü bir parola seçin.';
  }
  if ([...pw].length < MIN_ADMIN_PASSWORD_LENGTH) return `ADMIN_PASSWORD çok kısa; en az ${MIN_ADMIN_PASSWORD_LENGTH} karakter olmalı.`;
  if (new Set(pw).size < 4) return 'ADMIN_PASSWORD çok tekdüze; farklı karakterler içeren bir parola seçin.';
  return null;
}

function intSetting(env, [name, def, min, max], warnings) {
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

function parseOrigins(raw, warnings) {
  const out = [];
  for (const part of String(raw ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    try {
      const u = new URL(part);
      if (u.origin === 'null' || part === '*') throw new Error();
      out.push(u.origin);
    } catch {
      warnings.push('ALLOWED_ORIGINS içinde geçersiz bir değer yok sayıldı (yalnızca tam origin kabul edilir, * kabul edilmez).');
    }
  }
  return out;
}

/** @param {Record<string, string | undefined>} env */
export function loadConfig(env) {
  const ortam = ['production', 'preview', 'development'].includes(env.ORTAM) ? env.ORTAM : 'production';
  const strict = ortam !== 'development';
  const warnings = [];
  const problems = [];

  let adminPassword = env.ADMIN_PASSWORD;
  if (strict) {
    const p = adminPasswordProblem(adminPassword);
    if (p) problems.push(p);
  } else if (adminPassword === undefined || adminPassword === '') {
    adminPassword = DEV_ADMIN_PASSWORD;
    warnings.push('Geliştirme modu: ADMIN_PASSWORD verilmedi, yalnızca yerel geliştirme için varsayılan parola kullanılıyor.');
  }

  let supabaseUrl = null;
  if (!env.SUPABASE_URL) problems.push('SUPABASE_URL secret tanımlı değil.');
  else {
    try {
      const u = new URL(env.SUPABASE_URL);
      if (strict && u.protocol !== 'https:') problems.push('SUPABASE_URL https ile başlamalı.');
      else supabaseUrl = u.origin;
    } catch {
      problems.push('SUPABASE_URL geçerli bir adres değil.');
    }
  }
  if (!env.SUPABASE_SERVICE_KEY) problems.push('SUPABASE_SERVICE_KEY secret tanımlı değil.');

  const limits = {};
  for (const [k, spec] of Object.entries(LIMIT_SPECS)) {
    limits[k] = { max: intSetting(env, spec.max, warnings), windowMs: intSetting(env, spec.window, warnings) * 1000 };
  }

  // Zamanlama ayarları yalnızca geliştirme/test ortamında değiştirilebilir.
  const dev = (name, def, min, max) => (strict ? def : intSetting(env, [name, def, min, max], warnings));
  const timing = {
    readyMs: dev('CANLI_HAZIR_MS', 3500, 0, 10_000),
    roomIdleMs: dev('ODA_BOSTA_SANIYE', 3 * 3600, 1, 86_400) * 1000,
    roomHostlessMs: dev('ODA_SUNUCUSUZ_SANIYE', 30 * 60, 1, 86_400) * 1000,
    // Canlı bağlantı yoklaması: kopan bağlantı en geç bu sürede fark edilir (sunucu ekranı / oyuncu çevrimdışı).
    pingMs: dev('CANLI_PING_MS', 20_000, 200, 60_000),
  };

  return {
    ortam,
    ok: problems.length === 0,
    problems,
    warnings,
    adminPassword,
    supabase: { url: supabaseUrl, key: env.SUPABASE_SERVICE_KEY ?? '' },
    allowedOrigins: parseOrigins(env.ALLOWED_ORIGINS, warnings),
    limits,
    timing,
    commit: env.GIT_COMMIT || 'bilinmiyor',
  };
}
