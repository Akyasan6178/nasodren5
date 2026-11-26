// Bellek içi, sabit pencereli hız sınırlayıcı. Dış bağımlılık yoktur.
// SINIR: sayaçlar yalnızca bu Node sürecinin belleğindedir. Birden fazla süreç ya da replica
// çalıştırılırsa her biri kendi sayacını tutar; merkezi bir sınır gerekir (README "Ölçekleme").

/**
 * @param {{ max: number, windowMs: number, now?: () => number, maxKeys?: number }} opts
 */
export function createRateLimiter({ max, windowMs, now = Date.now, maxKeys = 50_000 }) {
  /** @type {Map<string, { count: number, resetAt: number }>} */
  const buckets = new Map();

  function sweep() {
    const t = now();
    for (const [k, b] of buckets) if (b.resetAt <= t) buckets.delete(k);
  }

  function current(key) {
    const b = buckets.get(key);
    if (!b) return null;
    if (b.resetAt <= now()) {
      buckets.delete(key);
      return null;
    }
    return b;
  }

  const retryAfter = (b) => Math.max(1, Math.ceil((b.resetAt - now()) / 1000));

  return {
    /** Sınır aşılmış mı? Sayacı artırmaz. */
    check(key) {
      const b = current(key);
      return b && b.count >= max ? { limited: true, retryAfter: retryAfter(b) } : { limited: false };
    },
    /** Bir olay sayar; sınır aşıldıysa `limited: true` döndürür. */
    hit(key) {
      let b = current(key);
      if (!b) {
        if (buckets.size >= maxKeys) sweep();
        // Temizlikten sonra da dolu ise yeni anahtarlar sınırlanır (belleğin sınırsız büyümesini önler).
        if (buckets.size >= maxKeys) return { limited: true, retryAfter: Math.ceil(windowMs / 1000) };
        b = { count: 0, resetAt: now() + windowMs };
        buckets.set(key, b);
      }
      if (b.count >= max) return { limited: true, retryAfter: retryAfter(b) };
      b.count += 1;
      return { limited: false };
    },
    reset(key) {
      buckets.delete(key);
    },
    sweep,
    get size() {
      return buckets.size;
    },
  };
}

/**
 * İstemci IP'si. `trustProxy` 0 ise yalnızca TCP bağlantısının adresi kullanılır; X-Forwarded-For
 * yok sayılır (sahte başlıkla sınırın atlatılmasını önler). N > 0 ise listenin sağından N. adres alınır
 * (en dıştaki N güvenilir vekilin eklediği adres).
 */
export function clientIp(req, trustProxy = 0) {
  let ip = req.socket?.remoteAddress ?? '';
  if (trustProxy > 0) {
    const xff = String(req.headers['x-forwarded-for'] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (xff.length >= trustProxy) ip = xff[xff.length - trustProxy];
  }
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip || 'bilinmiyor';
}
