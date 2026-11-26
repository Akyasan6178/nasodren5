// Sabit pencereli hız sınırı hesabı (saf fonksiyonlar). RateLimiter Durable Object'i bunu kullanır:
// her anahtarın tek bir nesnesi olduğundan sayım atomiktir ve tüm Worker isolate'ları aynı sayacı görür.

/** Bir olay sayar. `bucket` null ya da süresi dolmuşsa yeni pencere açılır. */
export function applyHit(bucket, now, max, windowMs) {
  if (!bucket || bucket.resetAt <= now) bucket = { count: 0, resetAt: now + windowMs };
  if (bucket.count >= max) return { bucket, limited: true, retryAfter: retryAfter(bucket, now) };
  bucket = { ...bucket, count: bucket.count + 1 };
  return { bucket, limited: false };
}

/** Sınır aşılmış mı? Sayacı artırmaz. */
export function checkBucket(bucket, now, max) {
  if (!bucket || bucket.resetAt <= now || bucket.count < max) return { limited: false };
  return { limited: true, retryAfter: retryAfter(bucket, now) };
}

const retryAfter = (bucket, now) => Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
