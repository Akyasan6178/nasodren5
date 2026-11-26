# Production operasyonu — Cloudflare Pages + Workers + ortak Supabase projesi

Bu belge oyunun production ortamının nasıl kurulduğunu, dağıtıldığını, izlendiğini ve geri alındığını
anlatır. Mimari özeti için [README](../README.md#mimari).

`<...>` ile gösterilen değerler (hesap, proje, alan adı, secret) hesaba özeldir; bunları repoya yazmayın.

> **Ortak veritabanı.** Oyun, önceki dört oyunun verisini de barındıran **mevcut ortak Supabase
> projesini** kullanır. Yeni bir Supabase projesi oluşturulmaz. Beşinci oyunun bütün veritabanı nesneleri
> `public` şemasında **`n5_` önekiyle** durur. Diğer oyunların hiçbir nesnesine dokunulmaz: bir şey
> silinmez, yeniden adlandırılmaz, değiştirilmez.

---

## 1. Bileşenler

| Bileşen | Ad | Yapılandırma |
| --- | --- | --- |
| Pages projesi (frontend + `/api` köprüsü) | `nasodren5` | `wrangler.toml`, `functions/api/[[path]].js`, `public/_headers` |
| API Worker'ı | `nasodren5-api` | `worker/wrangler.toml` |
| Durable Objects | `GameSession`, `Room`, `RateLimiter` (SQLite tabanlı) | `worker/wrangler.toml` → `migrations` tag `v1` |
| Veritabanı | Ortak Supabase projesi, `public.n5_*` nesneleri | `supabase/migrations/` |

- Pages, `/api/*` isteklerini **service binding** (`API`) ile Worker'a iletir. Tarayıcı açısından API aynı
  origin'dedir; CORS gerekmez.
- Worker'ın `workers.dev` adresi kapalıdır (`workers_dev = false`). Doğrudan dışarıdan çağrılamaz.
- **Preview ortamı yoktur.** Ayrı bir veritabanı olmadığı için test kopyası gerçek veriye karışırdı.
  - Değişiklikler yerelde `npm run dev` ile, kendi yerel veritabanında denenir.
  - Pages yapılandırmasında preview ortamının API bağlaması bilerek yoktur. Yanlışlıkla bir preview dağıtımı
    oluşursa `/api` 503 döner ve veritabanına hiçbir şey yazılamaz.
  - Pages panelinde **Settings → Builds → Preview deployments: None** seçin.
- Durable Objects, tek yetkili koordinatör gerektiren durumlar içindir: çok oyunculu oda, eşzamanlı cevaplar,
  hız sınırı sayaçları. Nedeni: Worker kopyaları arasında bellek paylaşılmaz; tutarlılık, Supabase'e yoğun
  polling yapmadan ancak bu yolla sağlanır. SQLite tabanlı Durable Objects Workers Free planında da
  kullanılabilir; plan sınırlarını Cloudflare panelinden kontrol edin.

### Veritabanı nesneleri (`public` şeması, hepsi `n5_` önekli)

| Tür | Adlar |
| --- | --- |
| Tablolar | `n5_questions`, `n5_settings`, `n5_stats_totals`, `n5_question_stats`, `n5_game_results`, `n5_data_imports`, `n5_migrations` |
| Otomatik nesneler | Tablo adından türetilen indeksler, kısıtlar, satır tipleri ve dizi (`n5_questions_pkey`, `n5_questions_sira_seq` vb.), `n5_questions_aktif_idx` |
| Fonksiyonlar (RPC) | `n5_genel_durum`, `n5_oyun_verisi`, `n5_oyun_kaydet`, `n5_admin_verisi`, `n5_soru_ekle`, `n5_soru_guncelle`, `n5_soru_sil`, `n5_sorulari_degistir`, `n5_ayarlari_guncelle`, `n5_istatistik_sifirla`, `n5_soru_tohumla`, `n5_istatistik_aktar` ve yardımcılar (`n5_soru_json`, `n5_ayarlar_json`, `n5_soru_dogrula`) |
| Erişim | RLS açık, politika yok. `anon`/`authenticated` için yetkiler **yalnızca n5_ nesnelerinde** geri alınır; çalıştırma yetkisi yalnızca `service_role`'dedir |

`test/izolasyon.test.mjs` ortak projeyi taklit eder. Önceki oyunların nesneleri, yetkileri, politikaları ve
verisi bulunurken migration'ları uygular. Ardından şunları doğrular:

- önceki nesnelerin hiçbirinin değişmediğini,
- eklenen her nesnenin `n5_` önekli olduğunu,
- çakışmada hiçbir şeyin uygulanmadığını.

## 2. İlk kurulum

### 2.1 Veritabanı (ortak Supabase projesi, SQL Editor)

Önceki oyunlarda olduğu gibi migration'lar **Supabase SQL Editor'den elle** uygulanır. Supabase CLI ile
`db push` **kullanmayın**: ortak projenin migration geçmişini değiştirir ya da reddedilir. Migration
dosyalarının her biri kendi `begin`/`commit`'iyle tek işlemdir: ya tamamı uygulanır ya hiçbiri.

1. **Sürüm ve ön kontrol (salt okunur).** SQL Editor'de çalıştırın:
   ```sql
   select version();
   -- Beşinci oyuna ait (n5_) hiçbir nesne olmamalı → 0
   select count(*) from pg_class where relnamespace = 'public'::regnamespace and left(relname, 3) = 'n5_';
   select count(*) from pg_proc  where pronamespace = 'public'::regnamespace and left(proname, 3) = 'n5_';
   ```
   Sonuç 0 değilse **durun** ve inceleyin. Migration bu kontrolü kendisi de yapar ve böyle bir durumda hiçbir
   şey değiştirmeden hata verir.
2. **Şema:** `supabase/migrations/20261127090000_n5_sema.sql` dosyasının **tamamını** SQL Editor'e yapıştırıp
   çalıştırın.
3. **Seed:** `supabase/migrations/20261127090100_n5_seed_sorular.sql` dosyasının **tamamını** yapıştırıp
   çalıştırın (30 soru). Şema uygulanmamışsa hiçbir şey yapmadan hata verir.
4. **Doğrulama:**
   ```sql
   select surum, uygulandi from public.n5_migrations order by 1;                -- 2 satır
   select count(*), count(*) filter (where aktif) from public.n5_questions;     -- 30, 30
   select kategori, count(*) from public.n5_questions group by 1 order by 1;    -- 6 kategori × 5
   select * from public.n5_settings;                                            -- 15 / true / 30 / surum 1
   select * from public.n5_stats_totals;                                        -- 0 / 0 / 0
   select relname, relrowsecurity from pg_class
    where relnamespace = 'public'::regnamespace and relkind = 'r' and left(relname, 3) = 'n5_';  -- 7 satır, hepsi true
   ```
5. **Herkese açık erişimin kapalı olduğunu doğrulayın.** Publishable/anon anahtarla yapılan istek
   reddedilmelidir (401):
   ```bash
   curl -s "https://<project-ref>.supabase.co/rest/v1/n5_questions" -H "apikey: <publishable-anahtar>"
   curl -s -X POST "https://<project-ref>.supabase.co/rest/v1/rpc/n5_oyun_verisi" -H "apikey: <publishable-anahtar>"
   ```
6. **Önceki oyunlar etkilenmedi mi?** Önceki oyunların sayfalarını açıp normal çalıştıklarını kontrol edin.
   Migration onların nesnelerine hiçbir komut çalıştırmaz.

### 2.2 API Worker'ı

```bash
npx wrangler login                                   # ya da CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
npx wrangler secret put ADMIN_PASSWORD       -c worker/wrangler.toml --env=""
npx wrangler secret put SUPABASE_URL         -c worker/wrangler.toml --env=""   # https://<project-ref>.supabase.co
npx wrangler secret put SUPABASE_SERVICE_KEY -c worker/wrangler.toml --env=""   # projenin mevcut backend anahtarı
npm run worker:deploy
```

- `ADMIN_PASSWORD` en az 12 karakter, benzersiz ve güçlü olmalıdır.
- `SUPABASE_SERVICE_KEY` ortak projenin mevcut backend anahtarıdır (service_role ya da `sb_secret_…`).
  Bu anahtar teknik olarak **ortak projedeki tüm oyunların verisine** erişebilir. Worker yalnızca `n5_*`
  fonksiyonlarını çağırır; izolasyon veritabanı yetkisiyle değil, Worker kodunun bu kuralıyla sağlanır
  (kabul edilmiş risk, bkz. §12). Anahtar yalnızca Worker secret'ı olur; tarayıcıya, Pages'e, `VITE_*`
  değişkenlerine ve repoya asla girmez.
- Secret'lardan biri eksik ya da zayıfsa Worker **fail-closed** çalışır: `GET /api/saglik` 503 döner ve
  eksiklerin adını listeler; diğer tüm API istekleri de 503 alır. Secret değerleri hiçbir yanıta ya da
  günlüğe yazılmaz.

### 2.3 Pages

Seçenek A — Cloudflare panelinden Git bağlantısı:

- **Build command:** `npm run build`
- **Build output directory:** `dist`
- **Ortam değişkenleri:** gerekmez. `VITE_VERI_MODU` **tanımlamayın**.
- **Node sürümü:** 22. Gerekirse `NODE_VERSION=22`.
- **Preview deployments:** None (bkz. §1).
- **Bağlama:** Functions → Bindings → Service binding `API` → `nasodren5-api` (yalnızca production).
  Kök `wrangler.toml` bunu tanımlar.

Seçenek B — CLI ya da GitHub Actions (`.github/workflows/deploy.yml`):

```bash
npm run build && npm run scan:bundle
npx wrangler pages deploy dist --project-name nasodren5 --branch main
```

### 2.4 Özel alan adı (isteğe bağlı)

Pages → Custom domains → `<alan-adı>` ekleyin. `/api/*` aynı alan adında Pages Function üzerinden
Worker'a gider; ayrı bir Worker route'u gerekmez. Başka bir origin'den API çağrılacaksa onu
`ALLOWED_ORIGINS` değişkenine tam origin olarak ekleyin. `*` kabul edilmez.

### 2.5 GitHub Actions (otomatik dağıtım)

`.github/workflows/deploy.yml` her push'ta testleri, build'i, paket taramasını ve Worker dry-run'ını
çalıştırır. `main`'e push'ta Worker'ı, Pages'i dağıtır ve canlı sağlık ile sürüm kontrolünü yapar.
**Veritabanı migration'larını uygulamaz.** Yeni bir migration varsa önce §2.1'deki gibi elle uygulayın,
sonra push edin. Gerekli secret'lar yoksa dağıtım adımları atlanır ve uyarı yazılır.

| Tür | Ad |
| --- | --- |
| Secret | `CLOUDFLARE_API_TOKEN` (yetkiler: Workers Scripts:Edit, Pages:Edit, Account Settings:Read) |
| Secret | `CLOUDFLARE_ACCOUNT_ID` |
| Variable | `PRODUCTION_URL` (ör. `https://<proje>.pages.dev`) |

Pages zaten Git bağlantısıyla dağıtılıyorsa iki dağıtım çakışmasın: ya Git bağlantısını ya da workflow'daki
Pages adımını kullanın.

## 3. Yerel geliştirme

- `npm run dev` yerel veritabanını (PGlite), `wrangler dev` ile Worker'ı ve Vite'ı birlikte çalıştırır
  (bkz. README). Migration'lar yerel veritabanına otomatik uygulanır. Bu yerel veritabanı ortak projeden
  tamamen bağımsızdır.
- `worker/.dev.vars` ile yerelde gerçek bir veritabanına bağlanmak mümkündür. Ancak ortak production
  projesine **bağlamayın**: yerel denemeler gerçek istatistiklere karışır.

## 4. Migration'lar

- Yeni migration: `supabase/migrations/<YYYYMMDDHHMMSS>_n5_<ad>.sql`. Uygulanmış bir migration'ı değiştirmeyin.
- **Her nesne `n5_` önekli olmalıdır.** Bu kural indeks ve kısıt adları için de geçerlidir: tablo adı
  `n5_` ile başlarsa PostgreSQL'in türettiği adlar da öneki alır; açık ad veriyorsanız `n5_` ile başlatın.
- Dosya `begin;` ile başlayıp `commit;` ile biter.
- Sonunda `insert into public.n5_migrations (surum) values ('<YYYYMMDDHHMMSS>');` satırı bulunur.
- `if not exists` ve `create or replace` kullanmayın: bir ad çakışırsa sessizce başka bir nesneye uygulanmak
  yerine hata versin. Yalnızca kendi `n5_` nesnenizi bilerek değiştiriyorsanız `create or replace function`
  kullanabilirsiniz.
- Diğer oyunların nesnelerine (`n5_` olmayan her şey) hiçbir komut yazmayın: `drop`, `alter`, `truncate`,
  `grant` / `revoke`, `alter default privileges` yasaktır.
- Yeni bir fonksiyon eklerseniz `revoke execute … from public, anon, authenticated; grant execute … to service_role;`
  satırlarını unutmayın.
- `npm test` uygulamadan önce kuralları denetler: `test/sql.test.mjs` ve `test/izolasyon.test.mjs`.
- Uygulama: §2.1'deki gibi SQL Editor'den, önce salt okunur ön kontrol, sonra dosyanın tamamı.
- Yıkıcı değişiklik (kolon/tablo silme, veri dönüştürme) otomatik uygulanmamalıdır. Önce yedek alın ve
  ekleyerek geçin: yeni kolon → backfill → kod geçişi → eski kolonu sonra kaldırma.

### Seed güncelleme

1. `public/data/varsayilan-sorular.json` dosyasını düzenleyin, kaynakları `docs/SORU_KAYNAKLARI.md`'ye ekleyin.
2. `npm run test:seed`
3. `node scripts/seed-migration.mjs --yeni` (yeni migration üretir), `npm test`, commit.
4. Yeni dosyayı SQL Editor'den uygulayın, sonra push edin.

Seed var olan sorulara (düzenlenmiş, pasif ya da silinmiş) dokunmaz; yalnızca eksik kimlikleri ekler.

## 5. Eski JSON kurulumundan geçiş

Node sunucusu (`server.mjs`) ve `data/*.json` dosyaları kaldırıldı; production artık bunları kullanmaz.
Eski bir kurulumun verisi varsa:

```bash
# 1) Kuru çalıştırma (yalnızca plan yazdırır)
SUPABASE_URL=https://<project-ref>.supabase.co SUPABASE_SERVICE_KEY=<anahtar> npm run db:import -- --kaynak <eski>/data
# 2) Uygula (önce yedek/supabase-<zaman>.json alınır; yalnızca n5_ verisi)
SUPABASE_URL=… SUPABASE_SERVICE_KEY=… npm run db:import -- --kaynak <eski>/data --uygula
```

- Betik yalnızca `n5_*` fonksiyonlarını çağırır; diğer oyunların verisine dokunmaz.
- `questions.json` (yönetici düzenlemeleri) `n5_questions` listesinin yerine geçer. Listede olmayan
  sorular silinmiş işaretlenir. Ayarlar ve istatistik de aktarılır. İstatistik, dosya içeriğinin
  özetiyle bir kez aktarılır.
- Komut sonunda kayıt sayıları ve alanlar kaynakla karşılaştırılır.
- Eski JSON dosyalarını silmeyin; güvenli bir yerde arşivleyin. `data/` ve `yedek/` git dışındadır;
  kullanıcı verisi içerebilecekleri için commit etmeyin.

## 6. Doğrulama ve izleme

- **Sağlık:** `curl https://<alan-adı>/api/saglik`. Beklenen yanıt:
  `{"durum":"ok","ortam":"production","surum":"<commit>","kontroller":{"yapilandirma":"ok","veritabani":"ok"}}`.
  `surum` deploy edilen commit'i gösterir (CI `GIT_COMMIT` olarak verir).
- **Canlı log:** `npm run worker:logs` ya da Cloudflare panelindeki Workers → Observability. Günlüklerde
  parola, anahtar, cookie, istek gövdesi ya da cevap anahtarı yoktur; oturum kimlikleri `:token` olarak
  maskelenir.
- **Duman testi** (canlı adrese karşı):
  ```bash
  node scripts/shot.mjs https://<alan-adı>/ shots          # tek oyunculu, masaüstü + telefon
  node scripts/canli-shot.mjs https://<alan-adı> shots      # 1 host + 4 telefon
  ```
  Bu testler gerçek veritabanına oyun ve istatistik yazar. Gerekirse sonradan panelden istatistiği sıfırlayın;
  bu yalnızca `n5_` istatistiklerini etkiler.

### Hata teşhisi

| Belirti | Olası neden |
| --- | --- |
| `/api/saglik` 503, `yapilandirma: eksik` | Worker secret'ı eksik ya da zayıf. Yanıttaki `eksik` listesine bakın |
| `/api/saglik` 503, `veritabani: hata` | `SUPABASE_URL` ya da anahtar yanlış, proje duraklatılmış ya da `n5_` migration'ları uygulanmamış |
| `/api/*` 503 "Sunucu yapılandırması eksik" ve sağlık bile yok | Pages'te `API` service binding tanımlı değil ya da istek bir preview dağıtımına gidiyor |
| Oyunda "Sunucuya ulaşılamadı" | Pages Function ya da Worker hatası; loglara bakın |
| 429 | Hız sınırı. Ortak NAT arkasındaki büyük gruplar için sınırları yükseltin (bkz. §10) |

## 7. Yedekleme ve geri yükleme

- Yalnızca beşinci oyunun verisini yedekleyin; ortak projenin tamamını dökmeyin. Bağlantı dizesi:
  Supabase → Connect → Session pooler.
  ```bash
  pg_dump "<bağlantı-dizesi>" --data-only --table='public.n5_*' -f yedek/n5-$(date +%F).sql   # yedek/ git dışında
  ```
  Şema repodaki migration'lardadır. Panelden "JSON dışa aktar" da soru listesinin hızlı bir yedeğidir.
- Projenin genel yedekleri (Pro planda günlük yedek / PITR) tüm oyunları birlikte kapsar. Geri yükleme
  tüm oyunları etkileyeceği için yalnızca proje sahibiyle birlikte ve son çare olarak kullanılmalıdır.
- `n5_` verisini geri yükleme: önce yedek dosyasını inceleyin. Yalnızca `n5_` tablolarını hedefleyen
  `psql "<bağlantı>" -f yedek/<dosya>.sql` komutu, gerekirse önce ilgili `n5_` tabloları boşaltılarak
  uygulanır. Bu yıkıcı bir işlemdir; proje sahibinin onayı gerekir.
- Durable Object verisi geçicidir (oturumlar 2 saat, odalar en çok 3 saat). Yedeklenmez.

## 8. Geri alma (rollback)

- **Worker:** `npx wrangler deployments list -c worker/wrangler.toml --env=""`, ardından
  `npx wrangler rollback <deployment-id> -c worker/wrangler.toml --env=""`. Panelden: Workers → Deployments → Rollback.
- **Pages:** Pages → Deployments → önceki dağıtım → "Rollback to this deployment".
- **Veritabanı:** migration'lar geri alınmaz. Gerekirse düzeltici yeni bir `n5_` migration'ı yazın ya da `n5_`
  yedeğinden geri yükleyin. Bu yüzden migration'lar geriye uyumlu (eklemeli) yazılmalıdır.
- Durable Object migration'ları (`[[migrations]]`) geri alınmaz. Sınıf adlarını değiştirmeyin;
  kaldırmak için ayrı bir `deleted_classes` migration'ı gerekir.

## 9. Secret rotation ve yönetici parolası

- **Yönetici parolası:** `npx wrangler secret put ADMIN_PASSWORD -c worker/wrangler.toml --env=""`. Oturum
  cookie'leri parolayla imzalandığı için açık yönetici oturumlarının hepsi geçersiz olur.
- **Supabase anahtarı:** Anahtar ortak projede diğer oyunlarca da kullanılıyor olabilir. Yenileme tüm oyunları
  etkiler; proje sahibiyle planlayın. Yeni anahtar → `wrangler secret put SUPABASE_SERVICE_KEY` → sağlık
  kontrolü → eski anahtarın iptali.
- **Cloudflare API token'ı (CI):** yeni token → GitHub secret güncelle → eskisini iptal et.

## 10. Hız sınırları

Merkezi ve atomiktir: her `kova:IP` çifti tek bir `RateLimiter` Durable Object'idir. Tüm Worker
kopyaları aynı sayacı görür. Sayaç pencere dolunca alarmla silinir, bu yüzden kayıtlar büyümez.
İstemci adresi Cloudflare'in koyduğu `CF-Connecting-IP` başlığından alınır; `X-Forwarded-For` yok sayılır.

| Kova | Varsayılan (IP başına) | Değişkenler |
| --- | --- | --- |
| Başarısız yönetici girişi | 10 / 15 dk (başarılı giriş sıfırlar; sınırda doğru parola da bekler) | `ADMIN_LOGIN_MAX_FAILURES`, `ADMIN_LOGIN_WINDOW_SECONDS` |
| Oda açma | 20 / 15 dk | `ROOM_CREATE_MAX`, `ROOM_CREATE_WINDOW_SECONDS` |
| Tek oyunculu oyun başlatma | 120 / 15 dk | `GAME_START_MAX`, `GAME_START_WINDOW_SECONDS` |
| Bulunamayan PIN | 20 / 10 dk (sınırda tüm oda istekleri engellenir) | `PIN_FAIL_MAX`, `PIN_FAIL_WINDOW_SECONDS` |
| Odaya katılma | 30 / 10 dk | `JOIN_MAX`, `JOIN_WINDOW_SECONDS` |
| Canlı bağlantı açma | 120 / 10 dk | `STREAM_MAX`, `STREAM_WINDOW_SECONDS` |
| Cevap / joker / komut | 600 / 10 dk | `ACTION_MAX`, `ACTION_WINDOW_SECONDS` |

Okul gibi ortak NAT arkasında tek IP'den çok sayıda oyuncu gelebilir. Bu durumda `GAME_START_MAX`,
`JOIN_MAX` ve `STREAM_MAX` değerlerini artırın. Geçersiz değerler varsayılana, aralık dışı değerler
sınıra çekilir.

## 11. Production kontrol listesi

**Dağıtım öncesi**

- [ ] `npm ci && npm run test:seed && npm test && npm run typecheck && npm run build && npm run scan:bundle && npm run worker:check` yeşil
- [ ] SQL Editor: `select version()` not edildi; `n5_` ön kontrolü 0 döndü
- [ ] Şema ve seed migration'ları SQL Editor'den uygulandı; `n5_migrations`'ta 2 satır; 30 soru, 6 kategori
- [ ] Publishable/anon anahtarla `n5_` tablo ve fonksiyon erişimi 401
- [ ] Önceki dört oyun normal çalışıyor
- [ ] Worker secret'ları tanımlı: `ADMIN_PASSWORD` (güçlü), `SUPABASE_URL` (https), `SUPABASE_SERVICE_KEY`
- [ ] Pages'te `API` service binding → `nasodren5-api`; preview dağıtımları kapalı
- [ ] Pages ortamında `VITE_VERI_MODU` tanımlı değil

**Dağıtım sonrası**

- [ ] `GET /api/saglik` → `durum: ok`, `surum` = yeni commit
- [ ] `GET /data/varsayilan-sorular.json` cevap anahtarı döndürmüyor
- [ ] Tek oyunculu: masaüstü ve telefonda tam oyun; Network'te cevap öncesi açıklama ya da doğru şık yok
- [ ] Çok oyunculu: 1 host + en az 4 telefon, en az 2 soru; soru açıkken puan değişmiyor
- [ ] Yönetici paneli: yanlış parola 401, doğru parola giriş, soru düzenleme sayfa yenilenince korunuyor
- [ ] Supabase'de `n5_game_results` ve `n5_stats_totals` yeni oyunla güncellendi
- [ ] `wrangler tail` ve tarayıcı konsolunda beklenmeyen hata yok
- [ ] Geri alma yolu biliniyor (§8)

## 12. Bilinen sınırlar

- **Ortak anahtar:** Worker'ın kullandığı backend anahtarı ortak projedeki tüm oyunların verisine erişebilir.
  Beşinci oyunun izolasyonu veritabanı yetkisiyle değil, Worker'ın yalnızca `n5_*` fonksiyonlarını
  çağırmasıyla sağlanır. Bu, kabul edilmiş bir risktir.
- **Tek oyunculu süre** tarayıcıda tutulur. Sunucu süre dolduğunu ayrıca zorlamaz. Mola ve açıklama
  kartı akışını bozmamak için bilinçli bir tercihtir. Oyuncu cevabı göremez ama düşünme süresini
  uzatabilir.
- **Yönetici oturumu** durumsuzdur: çıkış cookie'yi siler, ama çalınmış bir cookie en fazla 2 saat geçerlidir.
  Tüm oturumları hemen kapatmak için parolayı değiştirin.
- **Çok oyunculu** bağlantı kopması en geç 20 saniyede fark edilir (bağlantı yoklaması). Durable Object
  yeniden başlarsa (deploy) açık SSE bağlantıları kopar ve istemciler otomatik yeniden bağlanır.
- **Oda sayısı** için genel bir üst sınır yoktur; kötüye kullanım IP başına oda açma sınırı ve oda
  süre dolumlarıyla sınırlanır.
- **Hız sınırları** IP başınadır. Çok adresli (dağıtık) bir saldırıya karşı yalnızca kısmi koruma sağlar;
  gerekirse Cloudflare WAF / Rate Limiting kuralları eklenebilir.
- **Preview yok:** değişiklikler canlıya çıkmadan önce yalnızca yerelde denenebilir.
- **Tıbbi içerik** uzman tarafından incelenmemiştir (bkz. `docs/SORU_KAYNAKLARI.md`).
