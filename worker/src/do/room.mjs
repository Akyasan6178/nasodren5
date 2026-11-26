// Çok oyunculu oda: PIN başına bir Durable Object — odanın tek yetkili koordinatörü.
// Katılım, cevaplar, host komutları, puan ve sıralama yalnızca burada işlenir; nesneye gelen istekler
// sırayla çalıştığından eşzamanlı cevaplar deterministik işlenir.
//
// Kalıcılık: oda durumu her değişiklikte nesnenin deposuna yazılır. Nesne yeniden başlarsa (deploy,
// taşıma) durum depodan yüklenir; açık SSE bağlantıları kopar ve istemciler (EventSource) otomatik olarak
// yeniden bağlanıp kaldıkları yerden devam eder.
// Zamanlama: faz geçişleri (soru açılması / kapanması) ve oda temizliği tek bir alarmla yürür.
// Temizlik: hiç işlem olmayan oda 3 saat, sunucu ekranı kapalı kalan oda 30 dakika sonra silinir.
import { DurableObject } from 'cloudflare:workers';
import { HttpError } from '../engine/ortak.mjs';
import * as E from '../engine/oda.mjs';
import { loadConfig } from '../config.mjs';
import { createRepo } from '../repo.mjs';
import { json, readJson } from '../http.mjs';

const enc = new TextEncoder();
const NO_ROOM = 'Bu PIN ile açık bir oyun bulunamadı.';

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    const cfg = loadConfig(env);
    this.repo = createRepo(cfg.supabase);
    this.timing = cfg.timing;
    this.ttl = { idle: cfg.timing.roomIdleMs, hostless: cfg.timing.roomHostlessMs };
    this.room = undefined; // undefined: yüklenmedi, null: oda yok
    this.streams = new Map(); // writer -> { kind: 'host' | 'player', id }
    this.ping = null;
    this.starting = false;
    this.online = (id) => [...this.streams.values()].some((m) => m.kind === 'player' && m.id === id);
  }

  hostOnline() {
    return [...this.streams.values()].some((m) => m.kind === 'host');
  }

  async getRoom() {
    if (this.room === undefined) this.room = (await this.ctx.storage.get('room')) ?? null;
    return this.room;
  }

  /** Durumu kalıcı yazar, ekranlara gönderir ve sonraki alarmı kurar. */
  async commit(onlyPlayerId) {
    await this.ctx.storage.put('room', this.room);
    this.push(onlyPlayerId);
    await this.ctx.storage.setAlarm(E.nextAlarm(this.room, this.hostOnline(), this.ttl));
  }

  async destroy(message) {
    for (const w of [...this.streams.keys()]) this.end(w, { phase: 'yok', mesaj: message });
    this.room = null;
    await this.ctx.storage.deleteAll();
  }

  // ---------- akış (SSE) ----------

  write(w, data) {
    w.write(enc.encode(`data: ${JSON.stringify(data)}\n\n`)).catch(() => this.drop(w));
  }

  end(w, data) {
    this.write(w, data);
    this.streams.delete(w);
    w.close().catch(() => undefined);
  }

  /** Bağlantı koptu. Host koptuysa "sunucu ekranı kapalı" süresi başlar; oyuncu koptuysa host görür. */
  drop(w) {
    const meta = this.streams.get(w);
    if (!meta) return;
    this.streams.delete(w);
    if (!this.streams.size && this.ping) { clearInterval(this.ping); this.ping = null; }
    const room = this.room;
    if (!room) return;
    if (meta.kind === 'host') {
      room.hostSeen = Date.now();
      this.commit().catch((err) => console.error('[oda] kayıt hatası:', err?.message ?? err));
    } else if (!this.online(meta.id)) {
      this.push(meta.id);
    }
  }

  openStream(kind, id) {
    const { readable, writable } = new TransformStream();
    const w = writable.getWriter();
    this.streams.set(w, { kind, id });
    w.closed.catch(() => this.drop(w));
    w.write(enc.encode('retry: 1500\n\n')).catch(() => this.drop(w));
    if (!this.ping) {
      this.ping = setInterval(() => {
        for (const x of [...this.streams.keys()]) x.write(enc.encode(': ping\n\n')).catch(() => this.drop(x));
      }, this.timing.pingMs);
    }
    const res = new Response(readable, {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store, no-transform',
        'x-accel-buffering': 'no',
        'x-content-type-options': 'nosniff',
      },
    });
    return { w, res };
  }

  /** Oda yoksa tek mesajlık, kendini kapatan akış (Worker bunu yanlış PIN denemesi sayar). */
  closedStream(phase, mesaj, missing = false) {
    const body = enc.encode(`retry: 1500\n\ndata: ${JSON.stringify({ phase, mesaj })}\n\n`);
    return new Response(body, {
      headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', ...(missing ? { 'x-oda-yok': '1' } : {}) },
    });
  }

  /** Değişikliği ilgili ekranlara gönderir. `onlyPlayerId` verilirse oyunculardan yalnız ona. */
  push(onlyPlayerId) {
    const room = this.room;
    if (!room) return;
    const now = Date.now();
    let hv;
    for (const [w, meta] of this.streams) {
      if (meta.kind === 'host') this.write(w, (hv ??= E.hostView(room, now, this.online)));
      else if (!onlyPlayerId || meta.id === onlyPlayerId) {
        const p = E.findById(room, meta.id);
        if (p) this.write(w, E.playerView(room, p, now));
      }
    }
  }

  endPlayer(id, mesaj) {
    for (const [w, meta] of this.streams) if (meta.kind === 'player' && meta.id === id) this.end(w, { phase: 'atildi', mesaj });
  }

  record(rec) {
    if (!rec) return;
    this.repo.oyunKaydet(rec.gameId, 'canli', rec.answers, true)
      .catch((err) => console.error('[oda] oyun sonucu kaydedilemedi:', err?.message ?? err));
  }

  // ---------- istekler (yalnızca Worker'dan) ----------

  async fetch(request) {
    try {
      return await this.route(request);
    } catch (err) {
      if (err instanceof HttpError) return json(err.status, { error: err.message }, err.headers);
      throw err;
    }
  }

  async route(request) {
    const url = new URL(request.url);
    const op = url.pathname.slice(1);
    const now = Date.now();
    const room = await this.getRoom();

    if (op === 'create' && request.method === 'POST') {
      const body = await readJson(request);
      if (room && !E.expired(room, now, this.hostOnline(), this.ttl)) return json(409, { error: 'PIN kullanımda.' });
      if (room) await this.destroy('Oda kapandı.');
      this.room = E.newRoom({ code: body.code, settings: body.settings ?? {}, now });
      await this.commit();
      return json(201, { code: this.room.code, hostToken: this.room.hostToken, options: this.room.options, lan: [] });
    }

    if (op === 'stream' && request.method === 'GET') {
      if (!room) return this.closedStream('yok', NO_ROOM, true);
      const hostToken = url.searchParams.get('host');
      if (hostToken) {
        if (hostToken !== room.hostToken) return this.closedStream('yok', 'Bu odayı yönetme izniniz yok.');
        const { w, res } = this.openStream('host', null);
        room.hostSeen = now;
        await this.ctx.storage.put('room', room);
        await this.ctx.storage.setAlarm(E.nextAlarm(room, true, this.ttl));
        this.write(w, E.hostView(room, now, this.online));
        return res;
      }
      const p = E.findByToken(room, url.searchParams.get('oyuncu'));
      if (!p) return this.closedStream('atildi', 'Oyunda kaydınız bulunamadı. Yeniden katılın.');
      const wasOffline = !this.online(p.id);
      const { w, res } = this.openStream('player', p.id);
      if (wasOffline) this.push(p.id); // sunucu ekranında "çevrimiçi" görünsün
      else this.write(w, E.playerView(room, p, now));
      return res;
    }

    if (!room) return json(404, { error: NO_ROOM });

    if (op === 'info' && request.method === 'GET') {
      return json(200, { code: room.code, phase: room.phase, players: room.players.length, lan: [] });
    }
    if (request.method !== 'POST') return json(404, { error: 'Bulunamadı' });
    const body = await readJson(request);

    if (op === 'join') {
      const p = E.join(room, body.name, now);
      await this.commit();
      return json(201, { token: p.token, id: p.id, name: p.name });
    }

    if (op === 'answer') {
      const p = E.findByToken(room, body.token);
      if (!p) return json(403, { error: 'Oyunda kaydınız bulunamadı.' });
      const err = E.answer(room, p, body.choice, now, this.online);
      if (err) return json(409, { error: err });
      await this.commit(p.id);
      return json(200, { ok: true });
    }

    if (op === 'leave') {
      const p = E.findByToken(room, body.token);
      if (p) {
        this.endPlayer(p.id, 'Oyundan ayrıldın.');
        E.removePlayer(room, p.id, now, this.online);
        await this.commit();
      }
      return json(200, { ok: true });
    }

    if (op === 'command') {
      if (typeof body.hostToken !== 'string' || body.hostToken !== room.hostToken) return json(403, { error: 'Bu odayı yönetme izniniz yok.' });
      if (body.type === 'kapat') {
        await this.destroy('Sunucu oyunu kapattı.');
        return json(200, { ok: true });
      }
      if (body.type === 'basla') {
        if (this.starting || room.phase !== 'lobi') return json(409, { error: 'Oyun zaten başladı.' });
        if (!room.players.length) return json(409, { error: 'Henüz katılan oyuncu yok.' });
        this.starting = true;
        let err;
        try {
          const { questions } = await this.repo.oyunVerisi();
          err = E.start(room, { count: body.count, seconds: body.seconds, readyMs: this.timing.readyMs }, questions, Date.now());
        } finally {
          this.starting = false;
        }
        if (err) return json(409, { error: err });
        await this.commit();
        return json(200, { ok: true });
      }
      // İstemciden gelen alanlardan yalnızca gerekenler alınır (ör. zamanlama asla istemciden gelmez).
      const r = E.command(room, body.type, { id: body.id, readyMs: this.timing.readyMs }, now, this.online);
      if (r.error) return json(409, { error: r.error });
      if (r.kicked) this.endPlayer(r.kicked.id, 'Oyundan çıkarıldınız.');
      this.record(r.record);
      await this.commit();
      return json(200, { ok: true });
    }

    return json(404, { error: 'Bulunamadı' });
  }

  async alarm() {
    const room = await this.getRoom();
    if (!room) {
      await this.ctx.storage.deleteAll();
      return;
    }
    const now = Date.now();
    if (E.expired(room, now, this.hostOnline(), this.ttl)) {
      await this.destroy('Oda kapandı.');
      return;
    }
    E.onTimer(room, now);
    await this.commit();
  }
}
