// Kim Nefes Almak İster? — sunucu ekranı (projeksiyon / büyük ekran).
// Oda açar, katılma kodunu ve QR'ı gösterir, soruları yönetir; oyuncular telefondan /katil ile bağlanır.
import '@fontsource/poppins/500.css';
import '@fontsource/poppins/600.css';
import '@fontsource/poppins/700.css';
import '@fontsource/poppins/800.css';
import '@fontsource/poppins/900.css';
import './canli.css';
import qrcode from 'qrcode-generator';
import { isSoundOn, play, setSound, unlockAudio } from '../game/audio';
import { music } from '../game/music';
import {
  GAME_NAME, LETTERS, SHAPES, countUp, deadlineFrom, fmtScore, get, h, post, serverAvailable, storage, stream,
  type HostPlayer, type HostView,
} from './net';

const WARN_SECONDS = 5;
const saved = storage<{ code: string; hostToken: string }>('knai.sunucu', 'session');
const app = document.getElementById('app')!;

let code = '';
let hostToken = '';
let lan: string[] = [];
let view: HostView | null = null;
let shownKey = '';
let deadline = 0;
let lastSecond = -1;
let stopStream: (() => void) | null = null;
/** Lobide seçilen ayarlar (sunucuya "başla" ile gönderilir). */
const opt = { count: 10, seconds: 20 };
let optTouched = false;

// ---------- iskelet ----------

const linkLost = h('div.link-lost', { hidden: true }, 'Bağlantı koptu, yeniden bağlanılıyor…');
const codePill = h('div.code-pill', { hidden: true }, 'PIN', h('b'));
const soundBtn = h('button.btn.ghost.icon', { title: 'Ses', 'aria-label': 'Ses', onclick: toggleSound });
const fullBtn = h('button.btn.ghost.icon', { title: 'Tam ekran', 'aria-label': 'Tam ekran', onclick: toggleFull }, '⛶');
const stage = h('main.stage');
app.replaceChildren(
  h('div.host',
    null,
    h('header.host-top', null,
      h('div.logo', null,
        h('img', { src: 'img/siklamen.svg', alt: '', width: 52, height: 52 }),
        h('div.t', null, 'Kim Nefes ', h('span', null, 'Almak İster?'), h('small', null, 'Siklamen · Çok oyunculu')),
      ),
      h('div.tools', null, codePill, h('button.btn.ghost.home', { onclick: goHome }, '← Ana menü'), soundBtn, document.fullscreenEnabled ? fullBtn : null),
    ),
    stage,
  ),
  linkLost,
);
syncSoundBtn();

/** Sahneyi verilen öğelerle değiştirir (boş öğeler atlanır). */
function show(...nodes: (Node | null | false)[]) {
  stage.className = 'stage';
  stage.replaceChildren(...nodes.filter((n): n is Node => !!n));
}

/** Ana menüye döner. Odada oyuncu varsa önce sorar; oda kapatılır, oyunculara bildirilir. */
async function goHome() {
  const busy = view && (view.players.length > 0 || view.phase !== 'lobi');
  if (busy && !confirm('Ana menüye dönülsün mü? Bu oda kapanır ve oyuncuların bağlantısı kesilir.')) return;
  stopStream?.();
  music.stop();
  if (code && hostToken) {
    try { await post(`/api/canli/oda/${code}/komut`, { hostToken, type: 'kapat' }); } catch { /* oda zaten kapalı */ }
  }
  saved.clear();
  location.href = './';
}

function toggleSound() {
  setSound(!isSoundOn());
  syncSoundBtn();
  if (isSoundOn()) play('click');
}
function syncSoundBtn() {
  soundBtn.textContent = isSoundOn() ? '🔊' : '🔇';
}
function toggleFull() {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen?.().catch(() => undefined);
}

function message(title: string, body: string, action?: { label: string; run: () => void }) {
  music.stop();
  codePill.hidden = true;
  show(
    h('div.center-msg.panel', null,
      h('h1', null, title),
      h('p.muted', null, body),
      action ? h('button.btn.primary', { onclick: action.run }, action.label) : null,
    ),
  );
}

// ---------- bağlantı ----------

async function boot() {
  if (!(await serverAvailable())) {
    message('Sunucu gerekli', 'Çok oyunculu mod, oyunun sunucu modu sürümünü gerektirir. Yerel (statik) modda kullanılamaz.');
    return;
  }
  const s = saved.get();
  if (s) {
    try {
      ({ lan } = await get<{ lan: string[] }>(`/api/canli/oda/${s.code}`));
      ({ code, hostToken } = s);
      connect();
      return;
    } catch {
      saved.clear();
    }
  }
  await createRoom();
}

async function createRoom() {
  stopStream?.();
  show(h('div.center-msg', null, h('p.muted', null, 'Oda hazırlanıyor…')));
  try {
    const r = await post<{ code: string; hostToken: string; options: { count: number; seconds: number }; lan: string[] }>('/api/canli/oda', {});
    code = r.code;
    hostToken = r.hostToken;
    lan = r.lan ?? [];
    if (!optTouched) Object.assign(opt, r.options);
    saved.set({ code, hostToken });
    shownKey = '';
    connect();
  } catch (e) {
    message('Oda açılamadı', (e as Error).message, { label: 'Tekrar dene', run: () => void createRoom() });
  }
}

function connect() {
  stopStream?.();
  stopStream = stream<HostView>(
    `/api/canli/oda/${code}/akis?host=${encodeURIComponent(hostToken)}`,
    onView,
    (ok) => { linkLost.hidden = ok; },
  );
}

async function cmd(type: string, extra: Record<string, unknown> = {}) {
  try {
    await post(`/api/canli/oda/${code}/komut`, { hostToken, type, ...extra });
  } catch (e) {
    toast((e as Error).message);
  }
}

let toastTimer = 0;
function toast(msg: string) {
  let t = document.getElementById('toast');
  if (!t) {
    t = h('div.link-lost', { id: 'toast' });
    document.body.append(t);
  }
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { t!.hidden = true; }, 3500);
}

// ---------- durum ----------

function onView(v: HostView) {
  if (v.phase === 'yok') {
    saved.clear();
    view = null;
    message('Oda kapandı', v.mesaj ?? 'Bu oda artık açık değil.', { label: 'Yeni oda aç', run: () => void createRoom() });
    return;
  }
  const prev = view;
  view = v;
  if (v.remainingMs != null) deadline = deadlineFrom(v.remainingMs);
  if (!optTouched && v.phase === 'lobi') Object.assign(opt, v.options);
  codePill.hidden = v.phase === 'lobi';
  codePill.querySelector('b')!.textContent = spaced(v.code);

  const key = `${v.phase}:${v.index}`;
  if (key !== shownKey) {
    shownKey = key;
    enterPhase(v);
  } else {
    refresh(v, prev);
  }
}

/** Faz değişti: ekran baştan kurulur, ses ve müzik ayarlanır. */
function enterPhase(v: HostView) {
  lastSecond = -1;
  switch (v.phase) {
    case 'lobi': music.stop(); renderLobby(v); break;
    case 'hazir': music.stop(); play('lifeline'); renderReady(v); break;
    case 'soru': play('select'); music.start(); music.setIntensity(0); renderQuestion(v); break;
    case 'sonuc': {
      music.stop();
      const right = v.players.filter((p) => p.gained > 0).length;
      play(right ? 'correct' : 'wrong');
      renderResult(v);
      break;
    }
    case 'tablo': play('click'); renderBoard(v); break;
    case 'bitti': music.stop(); play('win'); renderFinal(v); break;
  }
}

/** Aynı fazda küçük güncelleme (yeni oyuncu, cevap sayısı vb.). */
function refresh(v: HostView, prev: HostView | null) {
  if (v.phase === 'lobi') {
    if (prev && v.players.length > prev.players.length) play('select');
    updateRoster(v);
  } else if (v.phase === 'soru') {
    const n = document.getElementById('answered-n');
    if (n) n.textContent = String(v.answered);
    const of = document.getElementById('answered-of');
    if (of) of.textContent = `/ ${v.players.length} cevap`;
    if (prev && v.answered > prev.answered) play('click');
  }
}

// ---------- lobi ----------

const spaced = (c: string) => `${c.slice(0, 3)} ${c.slice(3)}`;

function joinBase(): string {
  const { protocol, hostname, port } = location;
  const local = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  const host = local && lan.length ? lan[0] : hostname;
  return `${protocol}//${host}${port ? `:${port}` : ''}`;
}

function qrSvg(text: string): SVGElement | null {
  try {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const wrap = document.createElement('div');
    wrap.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    return wrap.querySelector('svg');
  } catch {
    return null;
  }
}

function stepper(label: string, key: 'count' | 'seconds', step: number, min: number, max: number, unit: string) {
  const out = h('output', null, `${opt[key]}${unit}`);
  const set = (d: number) => {
    opt[key] = Math.min(max, Math.max(min, opt[key] + d));
    optTouched = true;
    out.textContent = `${opt[key]}${unit}`;
    play('click');
  };
  return h('label', null, label,
    h('span.stepper', null,
      h('button', { type: 'button', 'aria-label': `${label} azalt`, onclick: () => set(-step) }, '−'),
      out,
      h('button', { type: 'button', 'aria-label': `${label} artır`, onclick: () => set(step) }, '+'),
    ),
  );
}

let chipMap = new Map<string, HTMLElement>();

function renderLobby(v: HostView) {
  const base = joinBase();
  const shownUrl = `${base.replace(/^https?:\/\//, '')}/katil`;
  const qr = qrSvg(`${base}/katil?kod=${v.code}`);
  chipMap = new Map();
  show(
    h('section.lobby', null,
      h('div.join-card.panel.neon', null,
        h('div.how', null,
          h('p.step', null, 'Telefonundan şu adrese girip PIN’i yaz ya da QR kodu okut:'),
          h('p.url', null, shownUrl),
          h('p.eyebrow.code-lbl', null, 'Oyun PIN’i'),
          h('div.code', null, spaced(v.code)),
        ),
        qr ? h('div.qr', null, qr) : null,
      ),
      h('div.roster.panel', null,
        h('div.roster-head', null, h('h2', null, 'Oyuncular'), h('span.count', { id: 'roster-count' }, '0')),
        h('div.chips', { id: 'chips' }),
        h('div.empty-roster', { id: 'roster-empty' }, h('div.breath'), 'Oyuncular bekleniyor… Derin bir nefes alın.'),
      ),
      h('div.setup.panel', null,
        h('h2', null, 'Yarışma ayarları'),
        stepper('Soru sayısı', 'count', 1, 1, 50, ''),
        stepper('Soru başına süre', 'seconds', 5, 5, 120, ' sn'),
        h('p.note.muted', null, 'Doğru cevap 500–1000 puan getirir; ne kadar hızlı, o kadar çok puan. Art arda doğrularda seri bonusu var. Çıkarmak istediğiniz oyuncunun adına tıklayın.'),
        h('button.btn.primary.big', { id: 'start-btn', onclick: startGame }, 'Yarışmayı başlat ▶'),
      ),
    ),
  );
  updateRoster(v);
}

function updateRoster(v: HostView) {
  const chips = document.getElementById('chips');
  if (!chips) return;
  const seen = new Set<string>();
  // katılma sırasıyla göster (sunucu puana göre sıralı gönderir; lobide herkes 0)
  for (const p of v.players) {
    seen.add(p.id);
    let el = chipMap.get(p.id);
    if (!el) {
      el = h('button.chip', { type: 'button', title: `${p.name} oyundan çıkarılsın mı?`, onclick: () => kick(p) }, p.name);
      chipMap.set(p.id, el);
      chips.append(el);
    }
    el.classList.toggle('off', !p.online);
  }
  for (const [id, el] of chipMap) if (!seen.has(id)) { el.remove(); chipMap.delete(id); }
  document.getElementById('roster-count')!.textContent = String(v.players.length);
  document.getElementById('roster-empty')!.hidden = v.players.length > 0;
  (document.getElementById('start-btn') as HTMLButtonElement).disabled = v.players.length === 0;
}

function kick(p: HostPlayer) {
  if (confirm(`"${p.name}" oyundan çıkarılsın mı?`)) void cmd('at', { id: p.id });
}

function startGame() {
  unlockAudio();
  if (!view?.players.length) return;
  void cmd('basla', { count: opt.count, seconds: opt.seconds });
}

// ---------- soru ----------

function qHead(v: HostView, right: Node | null = null) {
  return h('div.q-head', null, h('div.counter', null, `SORU ${v.index + 1} / ${v.total}`), right);
}

function qBox(v: HostView) {
  const q = v.question!;
  return h('div.qbox.panel.neon', null, q.kategori ? h('p.eyebrow', null, q.kategori) : null, h('h1', null, q.soru));
}

function choiceGrid(v: HostView, reveal: boolean) {
  const q = v.question!;
  return h('div.choices', null, ...q.choices.map((c, i) => {
    if (!reveal) return h(`div.choice.o${i}`, null, h('span.letter', null, LETTERS[i]), h('span.txt', null, c), h('span.tick.shape', null, SHAPES[i]));
    // açıklama: her şıkkın altında neden doğru / neden yanlış olduğu yazar
    const right = i === q.correct;
    const why = q.whys?.[i] ?? (right ? q.why : '');
    return h(`div.choice.o${i}.${right ? 'right' : 'dim'}`, { style: { animationDelay: `${right ? 0 : 150 + i * 80}ms` } },
      h('span.letter', null, LETTERS[i]),
      h('span.body', null,
        h('span.txt', null, c),
        why ? h('span.why-in', null, h('b', null, right ? 'Neden doğru? ' : 'Neden yanlış? '), why) : null),
      h('span.tick', null, right ? '✓' : '✕'));
  }));
}

function renderReady(v: HostView) {
  const ms = Math.max(300, v.remainingMs ?? 3000);
  const bar = h('i');
  bar.style.animationDuration = `${ms}ms`;
  show(
    qHead(v),
    h('div.ready', null, h('div.rise', null, qBox(v)), h('div.bar.ready-bar', null, bar)),
  );
}

let clockEl: HTMLElement | null = null;
let clockArc: SVGCircleElement | null = null;
let clockNum: HTMLElement | null = null;
const R = 52;
const CIRC = 2 * Math.PI * R;

function clock() {
  const wrap = document.createElement('div');
  wrap.className = 'clock';
  wrap.innerHTML = `<svg viewBox="0 0 120 120"><circle class="bg" cx="60" cy="60" r="${R}"/><circle class="fg" cx="60" cy="60" r="${R}" stroke-dasharray="${CIRC}" stroke-dashoffset="0"/></svg><b></b>`;
  clockEl = wrap;
  clockArc = wrap.querySelector('.fg');
  clockNum = wrap.querySelector('b');
  return wrap;
}

function renderQuestion(v: HostView) {
  show(
    qHead(v),
    qBox(v),
    h('div.q-mid', null,
      clock(),
      h('p.mid-note', null, 'Telefonundan cevabını seç! Hızlı olan daha çok puan alır.'),
      h('div.answered', null, h('b', { id: 'answered-n' }, String(v.answered)), h('span', { id: 'answered-of' }, `/ ${v.players.length} cevap`)),
    ),
    choiceGrid(v, false),
    h('div.foot', null, h('button.btn.ghost', { onclick: () => void cmd('bitir-sure') }, 'Süreyi bitir ⏭')),
  );
  tickClock();
}

function tickClock() {
  if (view?.phase !== 'soru' || !clockEl) return;
  const total = view.options.seconds;
  const left = Math.max(0, (deadline - performance.now()) / 1000);
  const sec = Math.ceil(left);
  clockArc!.setAttribute('stroke-dashoffset', String(CIRC * (1 - left / total)));
  if (clockNum!.textContent !== String(sec)) clockNum!.textContent = String(sec);
  clockEl.classList.toggle('warn', left / total <= 0.5 && left / total > 0.25);
  clockEl.classList.toggle('crit', left / total <= 0.25);
  music.setIntensity(1 - left / total);
  if (sec !== lastSecond) {
    if (lastSecond > 0 && sec > 0 && sec <= WARN_SECONDS) play('tick');
    lastSecond = sec;
  }
}

// ---------- sonuç ----------

function renderResult(v: HostView) {
  const q = v.question!;
  const counts = q.counts ?? [0, 0, 0, 0];
  const max = Math.max(1, ...counts);
  const right = counts[q.correct ?? 0] ?? 0;
  show(
    qHead(v, h('div.answered', null, h('b', null, String(right)), h('span', null, `/ ${v.players.length} doğru`))),
    qBox(v),
    h('div.q-mid', { style: { gridTemplateColumns: '1fr' } },
      h('div.dist', null, ...counts.map((n, i) => {
        const bar = h('i');
        bar.style.height = `${Math.max(4, (n / max) * 100)}%`;
        bar.style.animationDelay = `${i * 90}ms`;
        return h(`div.col.o${i}${i === q.correct ? '' : '.dim'}`, null, h('b', null, String(n)), bar, h('span', null, `${LETTERS[i]} ${i === q.correct ? '✓' : ''}`));
      })),
    ),
    choiceGrid(v, true),
    h('div.foot', null, h('button.btn.primary', { onclick: () => void cmd('tablo') }, 'Skor tablosu ▶')),
  );
  stage.className = 'stage result';
}

// ---------- skor tablosu ----------

function renderBoard(v: HostView) {
  const last = v.index >= v.total - 1;
  const top = v.players.slice(0, 5);
  const list = h('ol.ranks');
  top.forEach((p, i) => {
    const sc = h('span.sc', null, fmtScore(p.score - p.gained));
    const moved = v.index > 0 && p.prevRank ? p.prevRank - p.rank : 0; // ilk soruda herkes 0'dan başlar
    const li = h('li.panel', { style: { animationDelay: `${i * 90}ms` } },
      h('span.no', null, String(p.rank)),
      h('span.nm', null, p.name,
        moved > 0 ? h('span.move.up', null, `▲${moved}`) : moved < 0 ? h('span.move.down', null, `▼${-moved}`) : null,
        p.streak >= 2 ? h('span.streak', null, ` 🔥${p.streak}`) : null),
      h('span.gain', null, p.gained ? `+${fmtScore(p.gained)}` : ''),
      sc,
    );
    list.append(li);
    window.setTimeout(() => countUp(sc, p.score - p.gained, p.score), 400 + i * 90);
  });
  show(
    h('h1.board-title.rise', null, last ? 'Son durum' : 'Skor tablosu'),
    v.players.length ? list : h('p.muted', { style: { textAlign: 'center' } }, 'Henüz oyuncu yok.'),
    h('div.foot', { style: { justifyContent: 'center', marginTop: 'auto', paddingTop: '18px' } },
      last ? null : h('button.btn.ghost', { onclick: () => confirm('Yarışma şimdi bitirilsin mi?') && void cmd('bitir') }, 'Yarışmayı bitir'),
      h('button.btn.primary.big', { onclick: () => void cmd('sonraki') }, last ? 'Kazananları göster 🏆' : 'Sonraki soru ▶'),
    ),
  );
}

// ---------- final ----------

function renderFinal(v: HostView) {
  const [a, b, c] = v.players;
  const col = (p: HostPlayer | undefined, place: 1 | 2 | 3) =>
    p
      ? h(`div.p.p${place}`, null,
          h('div.medal', null, ['🥇', '🥈', '🥉'][place - 1]),
          h('div.who', null, p.name),
          h('div.pts', null, `${fmtScore(p.score)} puan`),
          h('div.block', null, String(place)))
      : h(`div.p.p${place}`, { style: { visibility: 'hidden' } }, h('div.block'));
  show(
    h('h1.board-title.rise', null, `${GAME_NAME} · Kazananlar`),
    h('div.podium', null, col(b, 2), col(a, 1), col(c, 3)),
    h('div.final-foot', null,
      h('button.btn.primary', { onclick: () => void cmd('lobi') }, 'Aynı oyuncularla yeniden oyna'),
      h('button.btn.ghost', { onclick: () => { void cmd('kapat'); saved.clear(); void createRoom(); } }, 'Yeni oda aç'),
    ),
  );
}

// ---------- girdiler ----------

window.addEventListener('pointerdown', unlockAudio, { passive: true });
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || !view) return;
  if (e.key !== 'Enter' && e.key !== ' ') return;
  if ((e.target as HTMLElement).closest('button')) return; // odaktaki düğme zaten tıklanır
  e.preventDefault();
  unlockAudio();
  switch (view.phase) {
    case 'lobi': startGame(); break;
    case 'soru': void cmd('bitir-sure'); break;
    case 'sonuc': void cmd('tablo'); break;
    case 'tablo': void cmd('sonraki'); break;
  }
});

(function loop() {
  tickClock();
  requestAnimationFrame(loop);
})();

void boot();
