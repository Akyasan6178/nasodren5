// Merkezi hız sınırı: her "kova:anahtar" çifti (ör. "adminLogin:203.0.113.5") için tek bir Durable Object.
// Bir nesnenin tüm çağrıları sırayla işlendiğinden sayım atomiktir; hangi Worker isolate'ı ya da
// veri merkezi isteği alırsa alsın aynı sayaç kullanılır. Pencere dolunca alarm nesnenin deposunu siler,
// böylece kayıtlar sınırsız büyümez.
import { DurableObject } from 'cloudflare:workers';
import { applyHit, checkBucket } from '../engine/limit.mjs';

export class RateLimiter extends DurableObject {
  async hit(max, windowMs) {
    const now = Date.now();
    const current = await this.ctx.storage.get('b');
    const r = applyHit(current ?? null, now, max, windowMs);
    if (!r.limited) {
      await this.ctx.storage.put('b', r.bucket);
      if (!current || current.resetAt !== r.bucket.resetAt) await this.ctx.storage.setAlarm(r.bucket.resetAt);
    }
    return r.limited ? { limited: true, retryAfter: r.retryAfter } : { limited: false };
  }

  async check(max) {
    return checkBucket((await this.ctx.storage.get('b')) ?? null, Date.now(), max);
  }

  async reset() {
    await this.ctx.storage.deleteAll();
  }

  async alarm() {
    const b = await this.ctx.storage.get('b');
    if (!b || b.resetAt <= Date.now()) await this.ctx.storage.deleteAll();
    else await this.ctx.storage.setAlarm(b.resetAt);
  }
}
