// Production yapılandırması (fail-fast), yönetici girişi hız sınırı, istemci IP tespiti ve
// üretim sunucusunun statik servis güvenliği.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { ConfigError, DEV_ADMIN_PASSWORD, adminPasswordProblem, loadConfig } from '../server/config.mjs';
import { clientIp, createRateLimiter } from '../server/ratelimit.mjs';
import { ADMIN_KEY, ROOT, fakeClock, startApi, tempDir } from './helpers.mjs';

// Testlerde kullanılan güçlü parola her çalıştırmada üretilir; kodda gerçek bir değer yoktur.
const strongPassword = () => `Tst-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;

// ---------- yapılandırma ----------

test('production: eksik, boş, kısa ve bilinen varsayılan parolalar reddedilir', () => {
  const cases = [undefined, '', '   ', DEV_ADMIN_PASSWORD, 'SIKLAMEN', 'admin', 'password', 'changeme', '123456789', 'kisa-parola', 'aaaaaaaaaaaaaaaa'];
  for (const pw of cases) {
    const env = pw === undefined ? {} : { ADMIN_PASSWORD: pw };
    assert.throws(() => loadConfig(env, 'production'), (err) => {
      assert.ok(err instanceof ConfigError);
      assert.match(err.message, /ADMIN_PASSWORD/);
      if (pw && pw.trim()) assert.ok(!err.message.includes(pw), 'hata mesajı parolayı içermemeli');
      return true;
    }, `kabul edilmemeli: ${JSON.stringify(pw)}`);
  }
  assert.equal(adminPasswordProblem(strongPassword()), null);
});

test('production: güçlü parola kabul edilir; development varsayılanla çalışır', () => {
  const pw = strongPassword();
  const prod = loadConfig({ ADMIN_PASSWORD: pw }, 'production');
  assert.equal(prod.adminPassword, pw);
  assert.equal(prod.mode, 'production');

  const dev = loadConfig({}, 'development');
  assert.equal(dev.adminPassword, DEV_ADMIN_PASSWORD, 'geliştirme modu varsayılan parolayla açılır');
  assert.ok(dev.warnings.some((w) => /Geliştirme modu/.test(w)));
  assert.equal(loadConfig({ ADMIN_PASSWORD: 'kisa' }, 'development').adminPassword, 'kisa', 'geliştirmede verilen parola kullanılır');
  assert.throws(() => loadConfig({}, 'staging'), ConfigError);
});

test('rate-limit ve proxy ayarları doğrulanır ve güvenli sınırlar içinde tutulur', () => {
  const pw = strongPassword();
  const c = loadConfig({
    ADMIN_PASSWORD: pw, ADMIN_LOGIN_MAX_FAILURES: '0', ADMIN_LOGIN_WINDOW_SECONDS: '999999999',
    ROOM_CREATE_MAX: 'abc', ROOM_CREATE_WINDOW_SECONDS: '1.5', GAME_START_MAX: '-3', TRUST_PROXY: '99', PORT: '70000',
  }, 'production');
  assert.equal(c.limits.adminLogin.max, 1);
  assert.equal(c.limits.adminLogin.windowMs, 86_400_000);
  assert.equal(c.limits.roomCreate.max, 20, 'geçersiz değer varsayılana döner');
  assert.equal(c.limits.roomCreate.windowMs, 900_000);
  assert.equal(c.limits.gameStart.max, 1);
  assert.equal(c.trustProxy, 0, 'geçersiz TRUST_PROXY proxy başlıklarına güvenmez');
  assert.equal(c.port, 8080);
  assert.ok(c.warnings.length >= 6);
  assert.ok(!c.warnings.join(' ').includes(pw), 'uyarılar parolayı içermemeli');
  const d = loadConfig({ ADMIN_PASSWORD: pw }, 'production');
  assert.deepEqual(d.limits, {
    adminLogin: { max: 10, windowMs: 900_000 },
    roomCreate: { max: 20, windowMs: 900_000 },
    gameStart: { max: 120, windowMs: 900_000 },
  });
  assert.equal(loadConfig({ ADMIN_PASSWORD: pw, TRUST_PROXY: 'true' }, 'production').trustProxy, 1);
  assert.equal(loadConfig({ ADMIN_PASSWORD: pw, TRUST_PROXY: '2' }, 'production').trustProxy, 2);
});

// ---------- üretim sunucusu süreci ----------

async function freePort() {
  return new Promise((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

/** server.mjs'i verilen ortamla başlatır; çıkışı ya da "Oyun:" satırını bekler. */
function runServer(env, { waitForStart = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(ROOT, 'server.mjs')], {
      cwd: ROOT,
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`zaman aşımı: ${out}`)); }, 15_000);
    child.stdout.on('data', (d) => {
      out += d;
      if (waitForStart && out.includes('Oyun:')) { clearTimeout(timer); resolve({ child, out, started: true }); }
    });
    child.stderr.on('data', (d) => { out += d; });
    child.on('exit', (code) => { clearTimeout(timer); resolve({ code, out, started: false }); });
  });
}

test('server.mjs parola olmadan, zayıf ya da varsayılan parolayla başlamaz (fail-fast)', async () => {
  for (const env of [{}, { ADMIN_PASSWORD: '' }, { ADMIN_PASSWORD: DEV_ADMIN_PASSWORD }, { ADMIN_PASSWORD: 'kisaParola1' }]) {
    const port = await freePort();
    const r = await runServer({ ...env, PORT: String(port) });
    assert.equal(r.started, false);
    assert.equal(r.code, 1, `çıkış kodu 1 olmalı: ${r.out}`);
    assert.match(r.out, /Başlatma durduruldu: ADMIN_PASSWORD/);
    if (env.ADMIN_PASSWORD) assert.ok(!r.out.includes(env.ADMIN_PASSWORD), 'çıktı parolayı içermemeli');
  }
});

test('server.mjs güçlü parolayla başlar; seed statik olarak sunulmaz; bozuk URL sunucuyu çökertmez', async (t) => {
  const pw = strongPassword();
  const port = await freePort();
  const r = await runServer({ ADMIN_PASSWORD: pw, PORT: String(port) }, { waitForStart: true });
  t.after(() => r.child.kill());
  assert.equal(r.started, true);
  assert.ok(!r.out.includes(pw), 'başlangıç çıktısı parolayı içermemeli');
  const base = `http://127.0.0.1:${port}`;
  for (const path of ['/data/varsayilan-sorular.json', '/data/../data/varsayilan-sorular.json', '/%64ata/varsayilan-sorular.json']) {
    const res = await fetch(base + path);
    assert.equal(res.status, 404, path);
    assert.ok(!(await res.text()).includes('"dogru"'), `${path} cevap anahtarı döndürdü`);
  }
  assert.equal((await fetch(`${base}/%E0%A4%A`)).status, 400);
  assert.equal((await fetch(`${base}/`)).status !== 500, true, 'sunucu çalışmaya devam etmeli');
  // (API çağrısı yapılmaz: gerçek sunucu repo içindeki data/ klasörünü oluşturmasın.)
});

// ---------- hız sınırlayıcı ----------

test('hız sınırlayıcı: sınır, Retry-After ve pencere sonunda sıfırlanma (sahte saat)', () => {
  const now = fakeClock();
  const l = createRateLimiter({ max: 3, windowMs: 10_000, now });
  for (let i = 0; i < 3; i++) assert.equal(l.hit('a').limited, false);
  assert.deepEqual(l.hit('a'), { limited: true, retryAfter: 10 });
  assert.equal(l.hit('b').limited, false, 'anahtarlar birbirinden bağımsız');
  now.advance(4_000);
  assert.deepEqual(l.check('a'), { limited: true, retryAfter: 6 });
  now.advance(6_000);
  assert.equal(l.hit('a').limited, false, 'pencere dolunca yeniden izin verilir');
  l.reset('a');
  assert.equal(l.check('a').limited, false);
});

test('hız sınırlayıcı belleği sınırsız büyümez', () => {
  const now = fakeClock();
  const l = createRateLimiter({ max: 1, windowMs: 1000, now, maxKeys: 100 });
  for (let i = 0; i < 100; i++) l.hit(`ip-${i}`);
  assert.equal(l.size, 100);
  assert.equal(l.hit('yeni').limited, true, 'dolu tabloda yeni anahtar sınırlanır');
  now.advance(1001);
  assert.equal(l.hit('yeni').limited, false, 'süresi dolan kayıtlar temizlenir');
  assert.equal(l.size, 1);
});

test('istemci IP: proxy başlığına yalnızca TRUST_PROXY etkinse güvenilir', () => {
  const req = (xff, remote = '10.0.0.5') => ({ socket: { remoteAddress: remote }, headers: xff ? { 'x-forwarded-for': xff } : {} });
  assert.equal(clientIp(req('1.2.3.4'), 0), '10.0.0.5', 'varsayılan: başlık yok sayılır');
  assert.equal(clientIp(req('1.2.3.4'), 1), '1.2.3.4');
  assert.equal(clientIp(req('6.6.6.6, 1.2.3.4'), 1), '1.2.3.4', 'istemcinin sahte eklediği adres atlanır');
  assert.equal(clientIp(req('6.6.6.6, 1.2.3.4, 10.0.0.9'), 2), '1.2.3.4');
  assert.equal(clientIp(req(undefined, '::ffff:127.0.0.1'), 0), '127.0.0.1');
});

// ---------- yönetici girişi hız sınırı (HTTP) ----------

async function withApi(t, opts) {
  const tmp = await tempDir();
  const api = await startApi({ dataDir: join(tmp.dir, 'data'), ...opts });
  t.after(async () => { await api.close(); await tmp.cleanup(); });
  return api;
}

test('yönetici girişi: başarısız denemeler sınırlanır, doğru parola da kilit süresince 429 alır', async (t) => {
  const now = fakeClock();
  const api = await withApi(t, {
    now,
    limits: { adminLogin: { max: 3, windowMs: 900_000 }, roomCreate: { max: 10, windowMs: 60_000 }, gameStart: { max: 10, windowMs: 60_000 } },
  });
  // sınır altı: normal çalışır, başarılı giriş sayacı sıfırlar
  assert.equal((await api.request('GET', '/api/admin', { key: 'yanlis-1' })).status, 401);
  assert.equal((await api.request('GET', '/api/admin', { key: 'yanlis-2' })).status, 401);
  assert.equal((await api.request('GET', '/api/admin', { admin: true })).status, 200);
  for (let i = 0; i < 3; i++) assert.equal((await api.request('GET', '/api/admin', { key: `yanlis-${i}` })).status, 401);
  const limited = await api.request('GET', '/api/admin', { key: 'yanlis-x' });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '900');
  assert.ok(!limited.text.includes('yanlis-x'));
  const blockedCorrect = await api.request('GET', '/api/admin', { admin: true });
  assert.equal(blockedCorrect.status, 429, 'kilit sırasında doğru parola da beklemeli');
  // Herkese açık oyun uçları yönetici kilidinden etkilenmez
  assert.equal((await api.request('GET', '/api/oyun')).status, 200);
  assert.equal((await api.request('POST', '/api/oyun/oturum')).status, 201);
  now.advance(900_001);
  assert.equal((await api.request('GET', '/api/admin', { admin: true })).status, 200, 'süre dolunca giriş açılır');
  assert.ok(!api.logs.map(String).join(' ').includes(ADMIN_KEY), 'parola günlüğe yazılmamalı');
});

test('proxy arkasında: TRUST_PROXY kapalıyken sahte X-Forwarded-For sınırı atlatamaz', async (t) => {
  const api = await withApi(t, {
    limits: { adminLogin: { max: 2, windowMs: 900_000 }, roomCreate: { max: 10, windowMs: 60_000 }, gameStart: { max: 10, windowMs: 60_000 } },
  });
  for (let i = 0; i < 2; i++) await api.request('GET', '/api/admin', { key: 'x', headers: { 'x-forwarded-for': `9.9.9.${i}` } });
  const r = await api.request('GET', '/api/admin', { key: 'x', headers: { 'x-forwarded-for': '9.9.9.99' } });
  assert.equal(r.status, 429);
});

test('proxy arkasında: TRUST_PROXY=1 ile istemciler ayrı sayılır', async (t) => {
  const api = await withApi(t, {
    trustProxy: 1,
    limits: { adminLogin: { max: 2, windowMs: 900_000 }, roomCreate: { max: 10, windowMs: 60_000 }, gameStart: { max: 10, windowMs: 60_000 } },
  });
  for (let i = 0; i < 2; i++) await api.request('GET', '/api/admin', { key: 'x', headers: { 'x-forwarded-for': '9.9.9.1' } });
  assert.equal((await api.request('GET', '/api/admin', { key: 'x', headers: { 'x-forwarded-for': '9.9.9.1' } })).status, 429);
  assert.equal((await api.request('GET', '/api/admin', { admin: true, headers: { 'x-forwarded-for': '9.9.9.2' } })).status, 200);
});
