// Kim Nefes Almak İster? — oyuncu ekranı (telefon). Kodla katılır, şıklardan birine dokunarak cevaplar.
import '@fontsource/poppins/500.css';
import '@fontsource/poppins/600.css';
import '@fontsource/poppins/700.css';
import '@fontsource/poppins/800.css';
import '@fontsource/poppins/900.css';
import './canli.css';
import { play, unlockAudio } from '../game/audio';
import { GAME_NAME, LETTERS, SHAPES, countUp, deadlineFrom, fmtScore, get, h, post, serverAvailable, storage, stream, type PlayerView } from './net';

const saved = storage<{ code: string; token: string; name: string }>('knai.oyuncu');
const app = document.getElementById('app')!;
const LONG_CHOICE = 34; // bundan uzun şık varsa şıklar alt alta dizilir

let view: PlayerView | null = null;
let shownKey = '';
let deadline = 0;
let total = 0;
let stopStream: (() => void) | null = null;
let session: { code: string; token: string; name: string } | null = null;
let shownScore = 0;
let wakeLock: { release(): Promise<void> } | null = null;

const linkLost = h('div.link-lost', { hidden: true }, 'Bağlantı koptu, yeniden bağlanılıyor…');
const meName = h('span.me');
const meScore = h('span.score', null, '0');
const leaveBtn = h('button.leave', { type: 'button', 'aria-label': 'Oyundan çık', title: 'Oyundan çık', onclick: leave }, '←');
const top = h('header.p-top', { hidden: true }, leaveBtn, meName, meScore);
const body = h('main.p-body');
const shell = h('div.player', null, top, body);
app.replaceChildren(shell, linkLost);

window.addEventListener('pointerdown', unlockAudio, { passive: true });

const buzz = (p: number | number[]) => { try { navigator.vibrate?.(p); } catch { /* yoksay */ } };

async function keepAwake() {
  try {
    const wl = (navigator as unknown as { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock;
    if (wl && !wakeLock) wakeLock = await wl.request('screen');
  } catch { /* desteklenmiyor */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && session) { wakeLock = null; void keepAwake(); }
});

// ---------- katılma ----------

async function boot() {
  if (!(await serverAvailable())) {
    showMessage('Sunucu gerekli', 'Çok oyunculu mod yalnızca oyun sunucusu üzerinden çalışır.');
    return;
  }
  const params = new URLSearchParams(location.search);
  const urlCode = (params.get('kod') ?? '').replace(/\D/g, '');
  const s = saved.get();
  if (s && (!urlCode || urlCode === s.code)) return connect(s);
  if (urlCode.length === 6) return checkCode(urlCode);
  showCodeStep();
}

/** Ana menüye (tek oyunculu oyuna) dönüş bağlantısı. */
function homeLink() {
  return h('a.home', { href: './' }, '← Ana menü');
}

/** Oyun sırasında: onay sonrası odadan ayrılır, PIN ekranına döner. */
async function leave() {
  if (!session || !confirm('Oyundan çıkmak istiyor musun? Puanın silinir.')) return;
  const s = session;
  session = null;
  stopStream?.();
  saved.clear();
  linkLost.hidden = true;
  void wakeLock?.release().catch(() => undefined);
  wakeLock = null;
  try { await post(`/api/canli/oda/${s.code}/ayril`, { token: s.token }); } catch { /* oda zaten kapanmış olabilir */ }
  history.replaceState(null, '', location.pathname);
  showCodeStep();
}

function brand() {
  return h('div.logo', null,
    h('img', { src: 'img/siklamen.svg', alt: '', width: 64, height: 64 }),
    h('div.t', null, 'Kim Nefes ', h('span', null, 'Almak İster?')),
  );
}

function showCodeStep(prefill = '', error = '') {
  top.hidden = true;
  const input = h('input.code-in', {
    inputMode: 'numeric', autocomplete: 'off', maxLength: 7, placeholder: 'Oyun PIN’i', value: prefill, 'aria-label': 'Oyun PIN’i',
  });
  input.addEventListener('input', () => {
    const d = input.value.replace(/\D/g, '').slice(0, 6);
    input.value = d.length > 3 ? `${d.slice(0, 3)} ${d.slice(3)}` : d;
  });
  const err = h('p.error', { hidden: !error }, error);
  const btn = h('button.btn.primary', { type: 'submit' }, 'Katıl');
  const form = h('form', {
    onsubmit: (e: Event) => {
      e.preventDefault();
      const c = input.value.replace(/\D/g, '');
      if (c.length !== 6) { err.textContent = 'PIN 6 haneli olmalı.'; err.hidden = false; return; }
      btn.disabled = true;
      void checkCode(c);
    },
  }, input, err, btn);
  body.className = 'p-body join';
  body.replaceChildren(
    homeLink(),
    brand(),
    h('p.muted', null, 'Büyük ekrandaki 6 haneli PIN’i yaz.'),
    form,
    h('div.or', null, h('span', null, 'ya da')),
    h('div.create.panel', null,
      h('p', null, h('b', null, 'Yarışmayı sen mi yöneteceksin?')),
      h('p.muted', null, 'Büyük ekranda bir oyun oluştur, PIN’i oyunculara göster.'),
      h('a.btn.ghost', { href: 'canli.html' }, 'Oyun oluştur'),
    ),
  );
  if (!matchMedia('(pointer: coarse)').matches) input.focus(); // telefonda klavye kendiliğinden açılmasın
}

async function checkCode(c: string) {
  try {
    const r = await get<{ phase: string }>(`/api/canli/oda/${c}`);
    if (r.phase === 'bitti') return showCodeStep(c, 'Bu oyun bitti. Yeni oyunun PIN’ini bekleyin.');
    showNameStep(c);
  } catch (e) {
    showCodeStep(c, (e as Error).message);
  }
}

function showNameStep(c: string, error = '') {
  top.hidden = true;
  const input = h('input', { maxLength: 16, autocomplete: 'nickname', autocapitalize: 'words', placeholder: 'Adın ya da takma adın', 'aria-label': 'Ad', enterKeyHint: 'go' });
  const last = saved.get()?.name;
  if (last) input.value = last;
  const err = h('p.error', { hidden: !error }, error);
  const btn = h('button.btn.primary', { type: 'submit' }, 'Katıl ▶');
  const form = h('form', {
    onsubmit: async (e: Event) => {
      e.preventDefault();
      unlockAudio();
      const name = input.value.trim();
      if (name.length < 2) { err.textContent = 'Adın en az 2 karakter olmalı.'; err.hidden = false; return; }
      btn.disabled = true;
      try {
        const r = await post<{ token: string; name: string }>(`/api/canli/oda/${c}/katil`, { name });
        const s = { code: c, token: r.token, name: r.name };
        saved.set(s);
        play('select');
        connect(s);
      } catch (ex) {
        err.textContent = (ex as Error).message;
        err.hidden = false;
        btn.disabled = false;
      }
    },
  }, input, err, btn);
  body.className = 'p-body join';
  body.replaceChildren(
    homeLink(),
    brand(),
    h('p.muted', null, `PIN ${c.slice(0, 3)} ${c.slice(3)}. Ekranda görünecek adını yaz.`),
    form,
    h('button.back', { type: 'button', onclick: () => showCodeStep() }, 'Farklı bir PIN gir'),
  );
  input.focus();
}

function showMessage(title: string, text: string, again = false) {
  top.hidden = true;
  body.className = 'p-body';
  body.replaceChildren(
    h('div.wait', null,
      brand(),
      h('h1', null, title),
      h('p.hint', null, text),
      again ? h('button.btn.primary', { onclick: () => { saved.clear(); history.replaceState(null, '', location.pathname); showCodeStep(); } }, 'Yeni oyuna katıl') : null,
      h('a.btn.ghost', { href: './' }, 'Ana menüye dön'),
    ),
  );
}

// ---------- canlı akış ----------

function connect(s: { code: string; token: string; name: string }) {
  session = s;
  stopStream?.();
  shownKey = '';
  void keepAwake();
  body.className = 'p-body';
  body.replaceChildren(h('div.wait', null, h('div.breath'), h('p.hint', null, 'Bağlanılıyor…')));
  stopStream = stream<PlayerView>(
    `/api/canli/oda/${s.code}/akis?oyuncu=${encodeURIComponent(s.token)}`,
    onView,
    (ok) => { linkLost.hidden = ok || !session; },
  );
}

function onView(v: PlayerView) {
  if (v.phase === 'yok' || v.phase === 'atildi') {
    session = null;
    saved.clear();
    linkLost.hidden = true;
    void wakeLock?.release().catch(() => undefined);
    wakeLock = null;
    showMessage(v.phase === 'yok' ? 'Oyun kapandı' : 'Oyundan çıktın', v.mesaj ?? '', true);
    return;
  }
  view = v;
  if (v.remainingMs != null) deadline = deadlineFrom(v.remainingMs);
  top.hidden = false;
  meName.textContent = v.me.name;
  if (v.me.score !== shownScore) { countUp(meScore, shownScore, v.me.score); shownScore = v.me.score; }
  else meScore.textContent = fmtScore(v.me.score);

  const key = `${v.phase}:${v.index}:${v.answer ? 'a' : ''}:${v.phase === 'lobi' ? v.playerCount : ''}`;
  if (key === shownKey) return;
  const phaseChanged = shownKey.split(':').slice(0, 2).join(':') !== `${v.phase}:${v.index}`;
  shownKey = key;
  body.className = 'p-body';
  shell.className = 'player';
  switch (v.phase) {
    case 'lobi': renderLobby(v); break;
    case 'hazir': if (phaseChanged) buzz(40); renderReady(v); break;
    case 'soru': v.answer ? renderLocked(v) : renderChoices(v); break;
    case 'sonuc':
    case 'tablo': renderVerdict(v, phaseChanged && v.phase === 'sonuc'); break;
    case 'bitti': renderFinal(v); break;
  }
}

function renderLobby(v: PlayerView) {
  body.replaceChildren(
    h('div.wait', null,
      h('div.breath'),
      h('h1', null, 'Oyuna katıldın!'),
      h('p.hint', null, 'Adını büyük ekranda görüyor musun? Yarışma birazdan başlıyor.'),
      h('p.hint', null, `Odada ${v.playerCount} oyuncu var.`),
    ),
  );
}

function qHeader(v: PlayerView, big = false) {
  const q = v.question!;
  return h(`div.p-q${big ? '.big' : ''}`, null,
    h('p.eyebrow', null, `Soru ${v.index + 1} / ${v.total}${q.kategori ? ` · ${q.kategori}` : ''}`),
    h('h2', null, q.soru),
  );
}

function renderReady(v: PlayerView) {
  const bar = h('i.ready-fill');
  bar.style.animation = `fill ${Math.max(300, v.remainingMs ?? 3000)}ms linear both`;
  bar.style.transform = 'scaleX(0)';
  body.replaceChildren(
    h('div.wait.rise', null, h('p.hint', null, 'Hazır ol…')),
    qHeader(v, true),
    h('div.bar', null, bar),
  );
}

let timerEl: HTMLElement | null = null;

function renderChoices(v: PlayerView) {
  const q = v.question!;
  total = Math.max(1, v.seconds);
  const long = q.choices.some((c) => c.length > LONG_CHOICE);
  const fill = h('i');
  const num = h('b');
  timerEl = h('div.p-timer', null, h('div.bar', null, fill), num);
  body.replaceChildren(
    qHeader(v),
    timerEl,
    h(`div.p-choices${long ? '.long' : ''}`, null, ...q.choices.map((c, i) =>
      h(`button.choice.o${i}`, { type: 'button', onclick: () => choose(i) },
        h('span.letter', null, LETTERS[i]),
        h('span.txt', null, c),
        long ? null : h('span.shape', null, SHAPES[i])),
    )),
  );
  tickTimer();
}

async function choose(i: number) {
  if (!view || view.phase !== 'soru' || view.answer || !session) return;
  play('select');
  buzz(30);
  // anında kilitli görünüme geç; sunucu reddederse geri dön
  view = { ...view, answer: { choice: i } };
  shownKey = `${view.phase}:${view.index}:a:`;
  renderLocked(view);
  try {
    await post(`/api/canli/oda/${session.code}/cevap`, { token: session.token, choice: i });
  } catch (e) {
    if (view.phase === 'soru' && view.answer?.choice === i) {
      view = { ...view, answer: null };
      shownKey = '';
      renderChoices(view);
      body.prepend(h('p.error', null, (e as Error).message));
    }
  }
}

function renderLocked(v: PlayerView) {
  const i = v.answer!.choice;
  timerEl = null;
  body.replaceChildren(
    h('div.wait.locked', null,
      h(`div.chosen.o${i}`, null, LETTERS[i]),
      h('h1', null, 'Cevabın alındı!'),
      h('p.hint', null, 'Diğer oyuncular bekleniyor… Bu arada derin bir nefes al.'),
    ),
  );
}

function tickTimer() {
  if (!timerEl || view?.phase !== 'soru' || view.answer) return;
  const left = Math.max(0, (deadline - performance.now()) / 1000);
  const fill = timerEl.querySelector('i')!;
  fill.style.transform = `scaleX(${Math.min(1, left / total)})`;
  const n = String(Math.ceil(left));
  const b = timerEl.querySelector('b')!;
  if (b.textContent !== n) b.textContent = n;
  timerEl.classList.toggle('crit', left <= 5);
}

function renderVerdict(v: PlayerView, fresh: boolean) {
  const q = v.question!;
  const a = v.answer;
  const kind = !a ? 'time' : a.correct ? 'ok' : 'bad';
  if (fresh) {
    play(kind === 'ok' ? 'correct' : kind === 'bad' ? 'wrong' : 'timeout');
    buzz(kind === 'ok' ? [40, 60, 40] : 220);
  }
  shell.className = `player tint-${kind}`;
  const c = q.correct ?? 0;
  const title = { ok: 'Doğru!', bad: 'Yanlış!', time: 'Süre doldu!' }[kind];
  const icon = { ok: '✓', bad: '✕', time: '⏱' }[kind];
  body.replaceChildren(
    h(`div.verdict.${kind}`, null,
      h('div.icon', null, icon),
      h('h1', null, title),
      kind === 'ok' ? h('div.pts', null, `+${fmtScore(a!.points ?? 0)}`) : null,
      kind === 'ok' && v.me.streak >= 2
        ? h('p.streak', null, `🔥 ${v.me.streak} doğru üst üste${a!.bonus ? ` · +${a!.bonus} seri bonusu` : ''}`)
        : null,
      // yanlışta önce seçilen şık ve neden yanlış olduğu, altında doğru şık ve neden doğru olduğu
      kind === 'bad' && a
        ? h('div.right-ans.panel.is-bad', null,
            h('b', null, `Senin cevabın: ${LETTERS[a.choice]} · ${q.choices[a.choice]}`),
            q.whys?.[a.choice] ? h('span.muted', null, h('em', null, 'Neden yanlış? '), q.whys[a.choice]) : null)
        : null,
      h('div.right-ans.panel.is-ok', null,
        h('b', null, kind === 'ok' ? `Senin cevabın: ${LETTERS[c]} · ${q.choices[c]}` : `Doğru cevap: ${LETTERS[c]} · ${q.choices[c]}`),
        q.why ? h('span.muted', null, h('em', null, 'Neden doğru? '), q.why) : null,
      ),
      h('p.rank', null, 'Şu an ', h('b', null, `${v.me.rank}.`), ` sıradasın · ${fmtScore(v.me.score)} puan`),
      v.phase === 'tablo' ? h('p.hint.muted', null, 'Sonraki soru bekleniyor…') : null,
    ),
  );
}

function renderFinal(v: PlayerView) {
  const medal = ['🥇', '🥈', '🥉'][v.me.rank - 1];
  play(v.me.rank <= 3 ? 'win' : 'correct');
  body.replaceChildren(
    h('div.wait.final', null,
      medal ? h('div.medal', null, medal) : null,
      h('div.place', null, `${v.me.rank}.`),
      h('h1', null, v.me.rank === 1 ? 'Şampiyon sensin!' : 'sıradasın'),
      h('p.hint', null, `${fmtScore(v.me.score)} puan · ${v.playerCount} oyuncu arasında`),
      v.podium?.length
        ? h('ol', null, ...v.podium.map((p, i) =>
            h(`li.panel${p.name === v.me.name ? '.me' : ''}`, null, h('span', null, `${['🥇', '🥈', '🥉'][i]} ${p.name}`), h('span', null, fmtScore(p.score)))))
        : null,
      h('p.hint', null, `${GAME_NAME} · Oynadığın için teşekkürler!`),
    ),
  );
}

(function loop() {
  tickTimer();
  requestAnimationFrame(loop);
})();

void boot();
