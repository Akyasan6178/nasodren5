import '@fontsource/poppins/400.css';
import '@fontsource/poppins/500.css';
import '@fontsource/poppins/600.css';
import '@fontsource/poppins/700.css';
import '@fontsource/poppins/800.css';
import './admin.css';
import {
  deleteQuestion, detectMode, loadAdmin, login, logout, replaceAll, resetStats,
  saveQuestion, saveSettings, validate, type Question, type Settings, type Stats,
} from '../shared/store';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

let questions: Question[] = [];
let stats: Stats = { games: 0, finished: 0, totalCorrect: 0, perQuestion: {} };
let settings: Settings = { questionsPerGame: 15, endOnWrong: true, secondsPerQuestion: 30 };
let editingId: string | null = null;

// ---------- bildirim ----------

let toastTimer = 0;
function toast(msg: string, err = false) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('err', err);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove('show'), 2600);
}

/** Yetki hatasında girişe döner; diğer hataları bildirir. */
function fail(e: unknown) {
  const err = e as Error & { status?: number };
  if (err.status === 401) {
    showLogin('Oturum süresi doldu, yeniden giriş yapın.');
  } else {
    toast(err.message || 'Bir hata oluştu.', true);
  }
}

// ---------- giriş ----------

function showLogin(message = '') {
  $('app').hidden = true;
  $('login').hidden = false;
  const e = $('login-error');
  e.textContent = message;
  e.hidden = !message;
  $<HTMLInputElement>('login-pass').focus();
}

$('login-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const pass = $<HTMLInputElement>('login-pass');
  try {
    await login(pass.value);
    pass.value = ''; // parola sayfada tutulmaz; oturum HttpOnly cookie'dedir
    await refresh();
    $('login').hidden = true;
    $('app').hidden = false;
  } catch (e) {
    const err = e as Error & { status?: number };
    showLogin(err.status === 401 ? 'Şifre hatalı.' : err.message);
  }
});

$('logout').addEventListener('click', async () => {
  await logout().catch(() => undefined); // cookie sunucuda silinir; hata olsa da giriş ekranına dönülür
  $<HTMLInputElement>('login-pass').value = '';
  showLogin();
});

// ---------- veri ----------

async function refresh() {
  ({ questions, stats, settings } = await loadAdmin());
  renderStats();
  renderCategories();
  renderList();
  renderSettings();
}

function renderStats() {
  const active = questions.filter((q) => q.aktif !== false).length;
  const avg = stats.games ? stats.totalCorrect / stats.games : 0;
  const cards: [string, string][] = [
    [String(questions.length), 'Toplam soru'],
    [String(active), 'Oyunda aktif'],
    [String(stats.games), 'Oynanan oyun'],
    [String(stats.finished), 'Sonuna kadar oynanan'],
    [avg.toFixed(1), 'Oyun başına ort. doğru'],
  ];
  $('stats').innerHTML = cards.map(([v, l]) => `<div class="card stat"><b>${v}</b><span>${l}</span></div>`).join('');
  if (active < settings.questionsPerGame) {
    $('stats').insertAdjacentHTML('beforeend',
      `<div class="card stat" style="border-color:rgba(255,190,60,.5)"><b style="color:#ffd27a">!</b><span>Aktif soru sayısı (${active}), oyun başına soru sayısından (${settings.questionsPerGame}) az. Oyun ${active} soruyla oynanır.</span></div>`);
  }
}

function categories() {
  return [...new Set(questions.map((q) => q.kategori?.trim()).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'tr'));
}

function renderCategories() {
  const cats = categories();
  $('cat-list').innerHTML = cats.map((c) => `<option value="${esc(c)}"></option>`).join('');
  const sel = $<HTMLSelectElement>('cat-filter');
  const cur = sel.value;
  sel.innerHTML = '<option value="">Tüm kategoriler</option>' + cats.map((c) => `<option>${esc(c)}</option>`).join('');
  sel.value = cats.includes(cur) ? cur : '';
}

function renderList() {
  const term = $<HTMLInputElement>('search').value.trim().toLocaleLowerCase('tr');
  const cat = $<HTMLSelectElement>('cat-filter').value;
  const rows = [...questions].reverse().filter((q) => { // en yeni soru en üstte
    if (cat && q.kategori !== cat) return false;
    if (!term) return true;
    return [q.soru, q.dogru, ...q.yanlislar, q.kategori ?? ''].some((s) => s.toLocaleLowerCase('tr').includes(term));
  });
  $('q-count').textContent = `(${questions.length})`;
  $('q-empty').hidden = rows.length > 0;
  $('q-body').innerHTML = rows.map((q) => {
    const st = stats.perQuestion[q.id];
    const rate = st?.asked
      ? `<span class="rate" title="${st.correct}/${st.asked} doğru">%${Math.round((st.correct / st.asked) * 100)}<i style="--p:${(st.correct / st.asked) * 100}%"></i></span>`
      : '<span class="rate none">—</span>';
    const on = q.aktif !== false;
    return `<tr data-id="${esc(q.id)}" class="${on ? '' : 'off'} ${q.id === editingId ? 'selected' : ''}">
      <td class="q-cell"><strong>${esc(q.soru)}</strong><span class="ans">${esc(q.dogru)}</span></td>
      <td>${q.kategori ? `<span class="tag">${esc(q.kategori)}</span>` : ''}</td>
      <td>${rate}</td>
      <td><button class="switch" role="switch" aria-checked="${on}" aria-label="Oyunda göster" data-act="toggle"></button></td>
      <td class="actions"><button class="icon-btn" data-act="edit">Düzenle</button><button class="icon-btn del" data-act="del">Sil</button></td>
    </tr>`;
  }).join('');
}

function renderSettings() {
  const f = $<HTMLFormElement>('s-form');
  (f.elements.namedItem('questionsPerGame') as HTMLInputElement).value = String(settings.questionsPerGame);
  (f.elements.namedItem('endOnWrong') as HTMLInputElement).checked = settings.endOnWrong;
  (f.elements.namedItem('secondsPerQuestion') as HTMLInputElement).value = String(settings.secondsPerQuestion);
}

// ---------- soru formu ----------

const form = $<HTMLFormElement>('q-form');
/** Formdaki zorunlu alanlar (boş kalanlar kırmızıyla işaretlenir). */
const REQUIRED = ['soru', 'kategori', 'dogru', 'aciklama', 'y0', 'w0', 'y1', 'w1', 'y2', 'w2', 'ipucu'];
const field = (n: string) => form.elements.namedItem(n) as HTMLInputElement;

function readForm(): Omit<Question, 'id'> {
  return {
    soru: field('soru').value.trim(),
    dogru: field('dogru').value.trim(),
    yanlislar: [0, 1, 2].map((i) => field(`y${i}`).value.trim()),
    kategori: field('kategori').value.trim(),
    ipucu: field('ipucu').value.trim(),
    aciklama: field('aciklama').value.trim(),
    yanlisAciklamalar: [0, 1, 2].map((i) => field(`w${i}`).value.trim()),
    aktif: field('aktif').checked,
  };
}

function fillForm(q: Question | null) {
  editingId = q?.id ?? null;
  field('soru').value = q?.soru ?? '';
  field('dogru').value = q?.dogru ?? '';
  [0, 1, 2].forEach((i) => { field(`y${i}`).value = q?.yanlislar[i] ?? ''; });
  field('kategori').value = q?.kategori ?? '';
  field('ipucu').value = q?.ipucu ?? '';
  field('aciklama').value = q?.aciklama ?? '';
  [0, 1, 2].forEach((i) => { field(`w${i}`).value = q?.yanlisAciklamalar?.[i] ?? ''; });
  field('aktif').checked = q ? q.aktif !== false : true;
  $('form-title').textContent = q ? 'Soruyu düzenle' : 'Yeni soru ekle';
  $('form-submit').textContent = q ? 'Değişiklikleri kaydet' : 'Soruyu kaydet';
  $('form-cancel').hidden = !q;
  $('editor').classList.toggle('editing', !!q);
  $('form-error').hidden = true;
  form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  renderList();
}

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const data = readForm();
  const err = validate(data);
  form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  if (err) {
    $('form-error').textContent = err;
    $('form-error').hidden = false;
    for (const n of REQUIRED) if (!field(n).value.trim()) field(n).setAttribute('aria-invalid', 'true');
    return;
  }
  const btn = $<HTMLButtonElement>('form-submit');
  btn.disabled = true;
  try {
    const wasEditing = !!editingId;
    await saveQuestion(editingId ? { ...data, id: editingId } : data);
    toast(wasEditing ? 'Soru güncellendi.' : 'Soru eklendi.');
    const keepCat = data.kategori;
    fillForm(null);
    if (!wasEditing) field('kategori').value = keepCat ?? ''; // art arda aynı kategoride soru girmek kolay olsun
    await refresh();
    field('soru').focus();
  } catch (e) {
    fail(e);
  } finally {
    btn.disabled = false;
  }
});

$('form-cancel').addEventListener('click', () => fillForm(null));

// ---------- liste eylemleri ----------

$('q-body').addEventListener('click', async (ev) => {
  const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
  const id = btn?.closest<HTMLTableRowElement>('tr')?.dataset.id;
  const q = questions.find((x) => x.id === id);
  if (!btn || !q) return;
  const act = btn.dataset.act;
  try {
    if (act === 'edit') {
      fillForm(q);
      $('editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
      field('soru').focus({ preventScroll: true });
    } else if (act === 'toggle') {
      await saveQuestion({ ...q, aktif: q.aktif === false });
      await refresh();
    } else if (act === 'del') {
      if (!confirm(`Bu soru silinsin mi?\n\n"${q.soru}"`)) return;
      await deleteQuestion(q.id);
      if (editingId === q.id) fillForm(null);
      toast('Soru silindi.');
      await refresh();
    }
  } catch (e) {
    fail(e);
  }
});

$('search').addEventListener('input', renderList);
$('cat-filter').addEventListener('change', renderList);

// ---------- ayarlar ve veri ----------

$('s-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.target as HTMLFormElement;
  const n = Number((f.elements.namedItem('questionsPerGame') as HTMLInputElement).value);
  const next: Settings = {
    questionsPerGame: Math.min(50, Math.max(1, Math.round(n) || 15)),
    endOnWrong: (f.elements.namedItem('endOnWrong') as HTMLInputElement).checked,
    secondsPerQuestion: Math.min(180, Math.max(0, Math.round(Number((f.elements.namedItem('secondsPerQuestion') as HTMLInputElement).value)) || 0)),
    // Okunan sürüm: arada başka bir oturum ayarları değiştirdiyse sunucu 409 döndürür (eski veri yenisini ezmez).
    surum: settings.surum,
  };
  try {
    await saveSettings(next);
    toast('Ayarlar kaydedildi.');
    await refresh();
  } catch (e) {
    fail(e);
    if ((e as { status?: number }).status === 409) await refresh().catch(() => undefined);
  }
});

$('export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(questions, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `siklamen-sorular-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

$<HTMLInputElement>('import').addEventListener('change', async (ev) => {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const list = JSON.parse(await file.text());
    if (!Array.isArray(list)) throw new Error('Geçersiz dosya: soru listesi bekleniyor.');
    if (!confirm(`${list.length} soru içe aktarılacak ve mevcut ${questions.length} sorunun yerini alacak. Devam edilsin mi?`)) return;
    await replaceAll(list);
    toast(`${list.length} soru içe aktarıldı.`);
    fillForm(null);
    await refresh();
  } catch (e) {
    fail(e instanceof SyntaxError ? new Error('Dosya okunamadı: geçerli bir JSON değil.') : e);
  }
});

$('reset-stats').addEventListener('click', async () => {
  if (!confirm('Tüm oyun istatistikleri sıfırlansın mı?')) return;
  try {
    await resetStats();
    toast('İstatistikler sıfırlandı.');
    await refresh();
  } catch (e) {
    fail(e);
  }
});

// ---------- açılış ----------

(async () => {
  // Mod derlemede seçilir; sunucu modunda veriler yalnızca API'den okunur ve API'ye yazılır.
  const mode = await detectMode();
  $('local-banner').hidden = mode === 'sunucu';
  $('logout').hidden = mode !== 'sunucu';
  try {
    await refresh();
    $('app').hidden = false;
  } catch (e) {
    const err = e as Error & { status?: number };
    if (err.status === 401) showLogin();
    // Sunucuya ulaşılamadı: boş bir panel gösterilmez; giriş ekranından yeniden denenebilir.
    else if (mode === 'sunucu') showLogin(err.message);
    else { $('app').hidden = false; toast(err.message, true); }
  }
})();
