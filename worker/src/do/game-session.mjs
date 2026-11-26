// Tek oyunculu oyun oturumu: oturum başına bir Durable Object (anahtar = tahmin edilemez oturum kimliği).
// Durum nesnenin deposunda kalıcıdır (Worker yeniden başlatılsa ya da istek başka bir isolate'a gitse de
// oturum sürer). Nesneye gelen istekler sırayla işlenir: aynı soruya eşzamanlı gelen cevaplardan yalnızca
// biri kabul edilir. Oyun bitince sonuç Supabase'e oyun kimliğiyle bir kez yazılır.
import { DurableObject } from 'cloudflare:workers';
import { HttpError, GENERIC_ERROR } from '../engine/ortak.mjs';
import { answer, isExpired, lifeline, pendingRecord, SESSION_TTL_MS } from '../engine/oturum.mjs';
import { loadConfig } from '../config.mjs';
import { createRepo } from '../repo.mjs';

const NOT_FOUND = { status: 404, body: { error: 'Oyun bulunamadı ya da süresi doldu. Yeni oyun başlatın.' } };

export class GameSession extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.repo = createRepo(loadConfig(env).supabase);
  }

  async load() {
    const s = await this.ctx.storage.get('s');
    if (!s) return null;
    if (isExpired(s, Date.now())) {
      await this.ctx.storage.deleteAll();
      return null;
    }
    return s;
  }

  async save(s) {
    s.touched = Date.now();
    await this.ctx.storage.put('s', s);
    await this.ctx.storage.setAlarm(s.touched + SESSION_TTL_MS + 1000);
  }

  async create(state) {
    if (await this.ctx.storage.get('s')) return { status: 409, body: { error: 'Oturum zaten var.' } };
    await this.save(state);
    return { status: 201 };
  }

  /** Hata: kontrollü (HttpError) ise o yanıt; değilse genel 500 (ayrıntı günlüğe). */
  async run(fn) {
    const s = await this.load();
    if (!s) return NOT_FOUND;
    let body;
    try {
      body = fn(s);
    } catch (err) {
      if (err instanceof HttpError) return { status: err.status, body: { error: err.message } };
      throw err;
    }
    await this.save(s); // sonuç istemciye gitmeden önce kalıcı
    const record = pendingRecord(s);
    if (record) {
      try {
        await this.repo.oyunKaydet(record.gameId, 'tek', record.answers, record.finished);
        s.recorded = true;
        await this.save(s);
      } catch (err) {
        // Cevap kabul edildi ama istatistik yazılamadı: istemci aynı cevabı yeniden gönderince tekrar denenir
        // (veritabanı oyun kimliğiyle aynı oyunu ikinci kez saymaz).
        console.error('[oturum] oyun sonucu kaydedilemedi:', err?.message ?? err);
        return { status: 500, body: { error: GENERIC_ERROR } };
      }
    }
    return { status: 200, body };
  }

  answer(body) {
    return this.run((s) => answer(s, body));
  }

  lifeline(body) {
    return this.run((s) => lifeline(s, body));
  }

  async alarm() {
    const s = await this.ctx.storage.get('s');
    if (!s || isExpired(s, Date.now())) await this.ctx.storage.deleteAll();
    else await this.ctx.storage.setAlarm(s.touched + SESSION_TTL_MS + 1000);
  }
}
