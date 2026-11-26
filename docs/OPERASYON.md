# Production operasyonu — Cloudflare Pages + Workers + Supabase

Bu belge oyunun production ortamının nasıl kurulduğunu, dağıtıldığını, izlendiğini ve geri alındığını
anlatır. Mimari özeti için [README](../README.md#mimari).

`<...>` ile gösterilen değerler (hesap, proje, alan adı, secret) hesaba özeldir; bunları repoya yazmayın.

---

## 1. Bileşenler

| Bileşen | Ad | Yapılandırma |
| --- | --- | --- |
| Pages projesi (frontend + `/api` köprüsü) | `nasodren5` | `wrangler.toml`, `functions/api/[[path]].js`, `public/_headers` |
| API Worker'ı (production) | `nasodren5-api` | `worker/wrangler.toml` |
| API Worker'ı (preview) | `nasodren5-api-preview` | `worker/wrangler.toml` → `[env.preview]` |
| Durable Objects | `GameSession`, `Room`, `RateLimiter` (SQLite tabanlı) | `worker/wrangler.toml` → `migrations` tag `v1` |
| Veritabanı | Supabase PostgreSQL | `supabase/migrations/` |

- Pages, `/api/*` isteklerini **service binding** (`API`) ile Worker'a iletir. Tarayıcı açısından API aynı
  origin'dedir; CORS gerekmez.
- Worker'ın `workers.dev` adresi kapalıdır (`workers_dev = false`). Doğrudan dışarıdan çağrılamaz.
- Preview dağıtımları (main dışındaki dallar) preview Worker'ına bağlanır. Preview Worker'ı **ayrı bir
  Supabase projesine** bağlanmalıdır; production verisine bağlamayın.
- Durable Objects: tek yetkili koordinatör gerektiren durumlar (çok oyunculu oda, eşzamanlı cevaplar,
  hız sınırı sayaçları) için kullanılır. Nedeni: Worker kopyaları arasında bellek paylaşılmaz.
  Supabase'e yoğun polling yapmadan tutarlılık ancak bu yolla sağlanır. SQLite tabanlı Durable Objects
  Workers Free planında da kullanılabilir; plan sınırlarını Cloudflare panelinden kontrol edin.

## 2. İlk kurulum

### 2.1 Supabase

1. Supabase'de bir proje oluşturun (production için bir, preview için ayrı bir tane önerilir).
2. Yerelde migration'ları uygulayın:
   ```bash
   npx supabase@3.4.0 login                       # tarayıcıda yetkilendirme
   npx supabase@3.4.0 link --project-ref <project-ref>
   npx supabase@3.4.0 db push                     # supabase/migrations/* uygulanır (şema + 30 soru)
   ```
3. Doğrulayın (Supabase SQL Editor):
   ```sql
   select count(*), count(*) filter (where aktif) from public.questions;      -- 30, 30
   select kategori, count(*) from public.questions group by 1 order by 1;     -- 6 kategori × 5
   select * from public.settings;                                             -- 15 / true / 30 / surum 1
   select * from public.stats_totals;                                         -- 0 / 0 / 0
   select relname, relrowsecurity from pg_class
    where relnamespace = 'public'::regnamespace and relkind = 'r';             -- hepsi true
   ```
4. Herkese açık erişimin kapalı olduğunu doğrulayın. Publishable/anon anahtarla yapılan istek reddedilmelidir (401):
   ```bash
   curl -s "https://<project-ref>.supabase.co/rest/v1/questions" -H "apikey: <publishable-anahtar>"
   curl -s -X POST "https://<project-ref>.supabase.co/rest/v1/rpc/n5_oyun_verisi" -H "apikey: <publishable-anahtar>"
   ```
5. Worker için **secret** anahtarı alın: Project Settings → API Keys → `sb_secret_…`. Eski projelerde
   `service_role` anahtarı da çalışır. Bu anahtar yalnızca Worker secret'ı olur; tarayıcıya, Pages'e,
   `VITE_*` değişkenlerine ve repoya asla girmez.

### 2.2 API Worker'ı

```bash
npx wrangler login                                   # ya da CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
npx wrangler secret put ADMIN_PASSWORD       -c worker/wrangler.toml
npx wrangler secret put SUPABASE_URL         -c worker/wrangler.toml   # https://<project-ref>.supabase.co
npx wrangler secret put SUPABASE_SERVICE_KEY -c worker/wrangler.toml
npm run worker:deploy                                # wrangler deploy -c worker/wrangler.toml
```

- Preview için aynı komutları `--env preview` ile çalıştırın: `npm run worker:deploy:preview`.
- `ADMIN_PASSWORD` en az 12 karakter, benzersiz ve güçlü olmalıdır.
- Secret'lardan biri eksik ya da zayıfsa Worker **fail-closed** çalışır: `GET /api/saglik` 503 döner ve
  eksiklerin adını listeler; diğer tüm API istekleri de 503 alır. Secret değerleri hiçbir yanıta ya da
  günlüğe yazılmaz.

### 2.3 Pages

Seçenek A — Cloudflare panelinden Git bağlantısı:

- **Build command:** `npm run build`
- **Build output directory:** `dist`
- **Ortam değişkenleri:** gerekmez. `VITE_VERI_MODU` **tanımlamayın**.
- **Node sürümü:** 22. Gerekirse `NODE_VERSION=22`.
- Functions → **Bindings** → Service binding: `API` → `nasodren5-api` (production) ve `nasodren5-api-preview` (preview).
  Kök dizindeki `wrangler.toml` bu bağlamaları zaten tanımlar.

Seçenek B — CLI ya da GitHub Actions (`.github/workflows/deploy.yml`):

```bash
npm run build && npm run scan:bundle
npx wrangler pages deploy dist --project-name nasodren5 --branch main
```

### 2.4 Özel alan adı (isteğe bağlı)

Pages → Custom domains → `<alan-adı>` ekleyin. `/api/*` aynı alan adında Pages Function üzerinden
Worker'a gider; ayrı bir Worker route'u gerekmez. Başka bir origin'den (ör. ayrı bir yönetim alan adı)
API çağrılacaksa onu `ALLOWED_ORIGINS` değişkenine tam origin olarak ekleyin. `*` kabul edilmez.

### 2.5 GitHub Actions (otomatik dağıtım)

`.github/workflows/deploy.yml` her push'ta testleri, build'i, paket taramasını ve Worker dry-run'ını
çalıştırır. `main`'e push'ta şu sırayla dağıtır: Supabase migration'ları → Worker → Pages → canlı sağlık
ve sürüm kontrolü. Gerekli secret/variable'lar yoksa dağıtım adımları **atlanır** ve uyarı yazılır.

| Tür | Ad |
| --- | --- |
| Secret | `CLOUDFLARE_API_TOKEN` (yetkiler: Workers Scripts:Edit, Pages:Edit, Account Settings:Read) |
| Secret | `CLOUDFLARE_ACCOUNT_ID` |
| Secret | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` |
| Variable | `SUPABASE_PROJECT_REF`, `PRODUCTION_URL` (ör. `https://<proje>.pages.dev`) |

Pages zaten Git bağlantısıyla dağıtılıyorsa iki dağıtım çakışmasın: ya Git bağlantısını ya da
workflow'daki Pages adımını kullanın.

## 3. Yerel geliştirme ve preview

- `npm run dev`: yerel veritabanı (PGlite), `wrangler dev` ile Worker ve Vite birlikte çalışır (README).
- Gerçek bir Supabase'le yerelde denemek için: `worker/.dev.vars` (bkz. `worker/.dev.vars.example`).
  Docker varsa `npx supabase@3.4.0 start` ile tam yerel Supabase da kullanılabilir.
- Preview: `npm run worker:deploy:preview`, ardından ana dal dışındaki bir dala push (Pages preview) ya da
  `npx wrangler pages deploy dist --project-name nasodren5 --branch <dal>`.

## 4. Migration'lar

- Yeni migration: `supabase/migrations/<YYYYMMDDHHMMSS>_<ad>.sql`. Uygulanmış bir migration'ı değiştirmeyin.
- Uygulama: `npx supabase@3.4.0 db push` (CI bunu otomatik yapar).
- Yıkıcı değişiklik (kolon/tablo silme, veri dönüştürme) otomatik uygulanmamalıdır. Önce yedek alın,
  ekleyerek geçin (yeni kolon → backfill → kod geçişi → eski kolonu sonra kaldırma).
- Tablolar ve fonksiyonlar için yetkiler migration'da açıkça verilir. Yeni bir fonksiyon eklerseniz
  `revoke execute … from public, anon, authenticated; grant execute … to service_role;` satırlarını unutmayın.
  `test/sql.test.mjs` bunu denetler.

### Seed güncelleme

1. `public/data/varsayilan-sorular.json` dosyasını düzenleyin, kaynakları `docs/SORU_KAYNAKLARI.md`'ye ekleyin.
2. `npm run test:seed`
3. `node scripts/seed-migration.mjs --yeni` (yeni migration üretir), `npm test`, commit, push.

Seed var olan sorulara (düzenlenmiş, pasif ya da silinmiş) dokunmaz; yalnızca eksik kimlikleri ekler.

## 5. Eski JSON kurulumundan geçiş

Node sunucusu (`server.mjs`) ve `data/*.json` dosyaları kaldırıldı; production artık bunları kullanmaz.
Eski bir kurulumun verisi varsa:

```bash
# 1) Kuru çalıştırma (yalnızca plan yazdırır)
SUPABASE_URL=https://<project-ref>.supabase.co SUPABASE_SERVICE_KEY=<anahtar> npm run db:import -- --kaynak <eski>/data
# 2) Uygula (önce yedek/supabase-<zaman>.json alınır)
SUPABASE_URL=… SUPABASE_SERVICE_KEY=… npm run db:import -- --kaynak <eski>/data --uygula
```

- `questions.json` (yönetici düzenlemeleri) Supabase'deki listenin yerine geçer. Listede olmayan
  sorular silinmiş işaretlenir. Ayarlar ve istatistik de aktarılır. İstatistik, dosya içeriğinin
  özetiyle bir kez aktarılır.
- Komut sonunda kayıt sayıları ve alanlar kaynakla karşılaştırılır.
- Eski JSON dosyalarını silmeyin; güvenli bir yerde arşivleyin. `data/` ve `yedek/` git dışındadır;
  kullanıcı verisi içerebilecekleri için commit etmeyin.

## 6. Doğrulama ve izleme

- **Sağlık:** `curl https://<alan-adı>/api/saglik`. Beklenen yanıt:
  `{"durum":"ok","ortam":"production","surum":"<commit>","kontroller":{"yapilandirma":"ok","veritabani":"ok"}}`.
  `surum` deploy edilen commit'i gösterir (CI `GIT_COMMIT` olarak verir).
- **Canlı log:** `npm run worker:logs` (`wrangler tail -c worker/wrangler.toml`) ya da Cloudflare panelindeki
  Workers → Observability. Günlüklerde parola, anahtar, cookie, istek gövdesi ya da cevap anahtarı yoktur;
  oturum kimlikleri `:token` olarak maskelenir.
- **Duman testi** (canlı adrese karşı):
  ```bash
  node scripts/shot.mjs https://<alan-adı>/ shots          # tek oyunculu, masaüstü + telefon
  node scripts/canli-shot.mjs https://<alan-adı> shots      # 1 host + 4 telefon
  ```

### Hata teşhisi

| Belirti | Olası neden |
| --- | --- |
| `/api/saglik` 503, `yapilandirma: eksik` | Worker secret'ı eksik ya da zayıf. Yanıttaki `eksik` listesine bakın |
| `/api/saglik` 503, `veritabani: hata` | `SUPABASE_URL` ya da anahtar yanlış, Supabase projesi duraklatılmış ya da migration'lar uygulanmamış |
| `/api/*` 503 "Sunucu yapılandırması eksik" ve sağlık bile yok | Pages'te `API` service binding tanımlı değil |
| Oyunda "Sunucuya ulaşılamadı" | Pages Function ya da Worker hatası; loglara bakın |
| 429 | Hız sınırı. Ortak NAT arkasındaki büyük gruplar için sınırları yükseltin (bkz. 9) |
| Çok oyunculu ekran güncellenmiyor | Ara vekil SSE'yi tamponluyor olabilir; Cloudflare'de normalde sorun olmaz |

## 7. Yedekleme ve geri yükleme

- Supabase: Pro planda günlük otomatik yedek ve PITR vardır; Free planda yoktur. Düzenli mantıksal yedek alın:
  ```bash
  npx supabase@3.4.0 db dump --data-only -f yedek/n5-$(date +%F).sql     # yedek/ git dışında
  ```
  Panelden "JSON dışa aktar" da soru listesinin hızlı bir yedeğidir.
- Geri yükleme: Supabase panelinden PITR / yedek ya da `psql "<bağlantı>" -f yedek/<dosya>.sql`. Önce boş
  bir projeye uygulayıp doğrulayın.
- Durable Object verisi geçicidir (oturumlar 2 saat, odalar en çok 3 saat). Yedeklenmez.

## 8. Geri alma (rollback)

- **Worker:** `npx wrangler deployments list -c worker/wrangler.toml`, ardından
  `npx wrangler rollback <deployment-id> -c worker/wrangler.toml`. Panelden: Workers → Deployments → Rollback.
- **Pages:** Pages → Deployments → önceki dağıtım → "Rollback to this deployment".
- **Veritabanı:** migration'lar geri alınmaz. Gerekirse düzeltici yeni bir migration yazın ya da yedekten
  geri yükleyin. Bu yüzden migration'lar geriye uyumlu (eklemeli) yazılmalıdır.
- Durable Object migration'ları (`[[migrations]]`) geri alınmaz. Sınıf adlarını değiştirmeyin;
  kaldırmak için ayrı bir `deleted_classes` migration'ı gerekir.

## 9. Secret rotation ve yönetici parolası

- **Yönetici parolası:** `npx wrangler secret put ADMIN_PASSWORD -c worker/wrangler.toml`. Oturum cookie'leri
  parolayla imzalandığı için açık yönetici oturumlarının hepsi geçersiz olur.
- **Supabase anahtarı:** Supabase'de yeni bir secret anahtar oluşturun, ardından
  `wrangler secret put SUPABASE_SERVICE_KEY`, sonra sağlık kontrolü. Her şey çalışıyorsa eski anahtarı
  Supabase'de iptal edin.
- **Cloudflare API token'ı (CI):** yeni token → GitHub secret güncelle → eskisini iptal et.
- Öneri: anahtarları en az yılda bir ya da personel değişikliğinde yenileyin.

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
- [ ] Supabase migration'ları uygulandı (`db push`); 30 soru, 6 kategori, ayarlar ve istatistik satırları var
- [ ] Publishable/anon anahtarla tablo ve fonksiyon erişimi 401
- [ ] Worker secret'ları tanımlı: `ADMIN_PASSWORD` (güçlü), `SUPABASE_URL` (https), `SUPABASE_SERVICE_KEY`
- [ ] Pages'te `API` service binding production → `nasodren5-api`, preview → `nasodren5-api-preview`
- [ ] Pages ortamında `VITE_VERI_MODU` tanımlı değil

**Dağıtım sonrası**

- [ ] `GET /api/saglik` → `durum: ok`, `surum` = yeni commit
- [ ] `GET /data/varsayilan-sorular.json` cevap anahtarı döndürmüyor
- [ ] Tek oyunculu: masaüstü ve telefonda tam oyun; Network'te cevap öncesi açıklama ya da doğru şık yok
- [ ] Çok oyunculu: 1 host + en az 4 telefon, en az 2 soru; soru açıkken puan değişmiyor
- [ ] Yönetici paneli: yanlış parola 401, doğru parola giriş, soru düzenleme sayfa yenilenince korunuyor
- [ ] Supabase'de `game_results` ve `stats_totals` yeni oyunla güncellendi
- [ ] `wrangler tail` ve tarayıcı konsolunda beklenmeyen hata yok
- [ ] Geri alma yolu biliniyor (bölüm 8)

## 12. Bilinen sınırlar

- **Tek oyunculu süre** tarayıcıda tutulur. Sunucu süre dolduğunu ayrıca zorlamaz. Mola ve açıklama
  kartı akışını bozmamak için bilinçli bir tercihtir. Oyuncu cevabı göremez ama düşünme süresini
  uzatabilir.
- **Yönetici oturumu** durumsuzdur: çıkış cookie'yi siler, ama çalınmış bir cookie en fazla 2 saat geçerlidir.
  Tüm oturumları hemen kapatmak için parolayı değiştirin.
- **Çok oyunculu** bağlantı kopması en geç 20 saniyede fark edilir (bağlantı yoklaması). Durable Object
  yeniden başlarsa (deploy) açık SSE bağlantıları kopar ve istemciler otomatik yeniden bağlanır.
- **Oda sayısı** için genel bir üst sınır yoktur; kötüye kullanım IP başına oda açma sınırı ve oda
  süre dolumlarıyla sınırlanır. Eski Node sunucusundaki 200 oda sınırı kaldırıldı.
- **Hız sınırları** IP başınadır. Çok adresli (dağıtık) bir saldırıya karşı yalnızca kısmi koruma sağlar;
  gerekirse Cloudflare WAF / Rate Limiting kuralları eklenebilir.
- **Tıbbi içerik** uzman tarafından incelenmemiştir (bkz. `docs/SORU_KAYNAKLARI.md`).
