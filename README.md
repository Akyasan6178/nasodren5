# Siklamen Bilgi Oyunu

"Kim Milyoner Olmak İster" tarzında, sinüzit üzerine bir bilgi yarışması: **Kim Nefes Almak İster?** Oyun ekranı **PixiJS 8**
(WebGL) ile çiziliyor, masaüstünde ve mobilde 60 fps hedefleniyor. Soruları **yönetici paneli**
üzerinden istediğiniz zaman ekleyebilir ya da düzenleyebilirsiniz.

## Mimari

```
Tarayıcı ──HTTPS──► Cloudflare Pages ──(statik dosyalar: dist/)
                         │
                         └─ /api/*  → Pages Function (functions/api/[[path]].js)
                                         │  service binding (aynı origin, CORS yok)
                                         ▼
                              API Worker (worker/src/index.mjs)
                               ├─ Durable Object GameSession  (tek oyunculu oturum, oturum başına)
                               ├─ Durable Object Room         (çok oyunculu oda + SSE, PIN başına)
                               ├─ Durable Object RateLimiter  (merkezi hız sınırı, anahtar başına)
                               └─ Supabase PostgreSQL  (ortak proje; yalnızca public.n5_* nesneleri, RPC ile)
```

- **Pages**, sunucu modu Vite build'ini (`dist/`) yayınlar. Seed dosyası ve cevap anahtarı build'e girmez.
- **Worker**, API'nin tamamıdır ve Supabase ile konuşan tek katmandır. Herkese açık bir adresi yoktur
  (`workers_dev = false`); yalnızca Pages üzerinden çağrılır.
- **Supabase**: önceki dört oyunla **ortak** projedir. Beşinci oyunun bütün nesneleri `public` şemasında
  `n5_` önekiyle durur; diğer oyunların nesnelerine dokunulmaz. Tablolar RLS ile kapalıdır. Worker, service-role anahtarıyla yalnızca `public.n5_*`
  fonksiyonlarını çağırır. Tarayıcı Supabase'e hiç bağlanmaz.
- **Durable Objects**: oturum ve oda durumunu tek yetkili koordinatörde tutar. Bu durum kalıcıdır,
  yeniden deploy sonrasında da sürer. Hız sınırı sayaçlarının tüm Worker kopyalarında ortak ve atomik
  olmasını sağlar.

Ayrıntılar, deploy, secret'lar, yedekleme, geri alma ve kontrol listesi: **[docs/OPERASYON.md](docs/OPERASYON.md)**.

## Yerel geliştirme

Node.js **22.6+** gerekir.

```bash
npm install
npm run dev     # oyun http://localhost:5173  (panel: /admin, çok oyunculu: /canli)
```

`npm run dev` üç şeyi birlikte başlatır:

1. **Yerel veritabanı.** PGlite ile WASM üzerinde gerçek PostgreSQL çalışır; Docker gerekmez. Migration'lar
   ve 30 soruluk seed otomatik uygulanır. Veriler `.wrangler/dev-db` içinde kalır. Bu klasör `n5_` öncesi bir
   sürümden kaldıysa bir kez silin (migration ön kontrolü eski nesneleri görünce durur).
2. **API Worker'ı.** `wrangler dev` ile http://127.0.0.1:8787 adresinde çalışır; Durable Object'ler dahildir.
3. **Vite.** `/api` isteklerini Worker'a iletir.

Yönetici parolası `ADMIN_PASSWORD` ortam değişkeniyle verilir. Verilmezse yalnızca yerel geliştirmede
`siklamen` kullanılır; bu değer production'da reddedilir. Başka bir veritabanına bağlanmak için
`worker/.dev.vars` dosyası oluşturulabilir (`worker/.dev.vars.example`); ortak production projesine
**bağlamayın**. Preview ortamı yoktur: değişiklikler yerelde denenir.

Diğer komutlar:

```bash
npm test               # tüm otomatik testler (Worker + Supabase SQL + istemci + seed)
npm run test:seed      # yalnızca varsayılan soru havuzunun denetimi
npm run typecheck
npm run build          # production frontend (sunucu modu) → dist/
npm run scan:bundle    # dist/ içinde cevap anahtarı / seed / secret taraması
npm run worker:check   # Worker'ın deploy dry-run'ı (bundle)
npm run test:visual    # Playwright tek oyunculu duman testi (önce npm run dev)
npm run test:canli     # Playwright çok oyunculu duman testi: 1 host + 4 telefon (önce npm run dev)
```

## Testler

| Dosya | Ne doğrular |
| --- | --- |
| `test/seed.test.mjs` | Soru havuzunun şeması ve içeriği, siklamen sorularında tedavi/marka iddiası olmaması, Supabase seed migration'ının JSON ile senkron olması |
| `test/izolasyon.test.mjs` | Ortak proje izolasyonu: önceki oyunları taklit eden nesneler varken migration'lar uygulanır. Kapsam: o nesnelerin tanım, yetki, policy ve verisinin değişmemesi, anon erişimlerinin bozulmaması, her yeni nesnenin `n5_` önekli olması, çakışmada hiçbir şeyin uygulanmaması |
| `test/sql.test.mjs` | Gerçek PostgreSQL (PGlite) üzerinde migration'lar. Kapsam: RLS ve `anon`/`authenticated` erişimi, fonksiyon güvenliği, kayıpsız veri eşlemesi, idempotent seed, atomik ve tek seferlik istatistik, ayarlarda sürüm çakışması, tek işlemlik içe aktarma |
| `test/motor.test.mjs` | Saf oyun motorları; zaman dışarıdan verildiği için deterministiktir. Kapsam: oturum kuralları, jokerler, süre dolumu, odada soru açıkken puanların gizlenmesi, hız sınırı penceresi |
| `test/worker.test.mjs` | Gerçek workerd üzerinde Worker ve Durable Objects. Kapsam: fail-closed, sağlık kontrolü, açık API sızıntısı, eşzamanlı cevap yarışı, istatistik bütünlüğü, veritabanı hatasından kurtulma, yeniden başlatma, yönetici oturumu, CSRF/CORS, hız sınırları |
| `test/canli.test.mjs` | Gerçek SSE ile 1 host + 4 oyuncu. Kapsam: erken sızıntı, PIN deneme koruması, oda/katılma sınırları, yeniden bağlanma, oda temizliği, yeniden başlatma |
| `test/istemci.test.mjs` | İstemci veri katmanı: API hatalarında yerel moda düşmemesi, parolanın tarayıcıda saklanmaması |
| `test/aktarim.test.mjs` | JSON → Supabase aktarımı: yedek alınması, idempotent çalışma, alan kaybı olmaması |

Supabase SQL'i testlerde PGlite (WASM ile çalışan PostgreSQL) ve küçük bir PostgREST RPC emülatörüyle
(`scripts/lib/supabase-emulator.mjs`) çalışır. Bu emülatör yalnızca test ve yerel geliştirme içindir.

## Yönetici paneli (`/admin`)

- Giriş parolayla yapılır; sonra kısa ömürlü (2 saat) bir oturum cookie'si kullanılır. Cookie
  `HttpOnly; Secure; SameSite=Strict` özelliklerindedir. Parola tarayıcıda saklanmaz. **Çıkış** cookie'yi siler.
- Soru ekleme ve düzenleme. Tüm alanlar zorunludur: soru, kategori, doğru cevap ve neden doğru olduğu (`aciklama`), 3 yanlış cevap ve her birinin neden yanlış olduğu (`yanlisAciklamalar`, yanlış şıklarla aynı sırada), ipucu. Aynı kurallar panelde, Worker'da ve veritabanında uygulanır.
- Soruyu silmeden oyundan çıkarmak için aktif/pasif anahtarı. Silinen soru veritabanında "silindi" olarak işaretlenir; seed yeniden çalışınca geri gelmez.
- Arama ve kategori filtresi.
- Soru bazında oyuncu başarı oranı ve toplam oyun istatistikleri.
- Oyun ayarları: oyun başına soru sayısı (varsayılan 15), soru başına süre (varsayılan 30 sn; 0 = süresiz) ve "yanlış cevapta / süre dolunca oyun bitsin" kuralı. Başka bir oturum ayarları arada değiştirdiyse kayıt reddedilir (409) ve güncel ayarlar yüklenir.
- JSON olarak dışa ve içe aktarma. İçe aktarma tek işlemdir: ya tamamı uygulanır ya hiçbiri.
- Kaydedilemeyen değişiklik başarılı gösterilmez; hata bildirimi çıkar.

## Veri

| Nerede | Ne |
| --- | --- |
| Ortak Supabase projesi: `n5_questions`, `n5_settings`, `n5_stats_totals`, `n5_question_stats`, `n5_game_results`, `n5_data_imports`, `n5_migrations` | **Production verisi.** Paneldeki tüm değişiklikler buraya yazılır |
| `public/data/varsayilan-sorular.json` | **Seed (varsayılan soru havuzu).** 30 doğrulanmış soru, 6 kategori. Kaynakları: [docs/SORU_KAYNAKLARI.md](docs/SORU_KAYNAKLARI.md) |
| `supabase/migrations/*.sql` | Şema ve seed migration'ları. Supabase SQL Editor'den elle, tek işlem olarak uygulanır (docs/OPERASYON.md §2.1). Seed migration'ı JSON'dan üretilir: `npm run db:seed-sql` |
| Durable Object deposu | Geçici oyun oturumları (2 saat) ve çok oyunculu odalar (3 saat / sunucu ekranı kapalıysa 30 dk) |

- **İstatistik** istemciden bildirilmez. Oyun bittiğinde Worker, doğruladığı cevaplardan sonucu oyun
  kimliğiyle bir kez yazar. Aynı oyun ikinci kez sayılmaz.
- **Seed'i güncellemek:** `public/data/varsayilan-sorular.json` dosyasını düzenleyin, kaynakları belgeye ekleyin,
  `npm run test:seed` çalıştırın, sonra `node scripts/seed-migration.mjs --yeni` ile yeni bir seed
  migration'ı üretin. Seed var olan soruları değiştirmez; yalnızca eksik kimlikleri ekler.
- **Eski JSON kurulumundan geçiş** (`data/*.json`): `npm run db:import`. Ayrıntılar: docs/OPERASYON.md.
  Node sunucusu ve `data/*.json` artık production'da kullanılmaz.

### Sunucu modu ve yerel mod

| Mod | Nasıl | Davranış |
| --- | --- | --- |
| **Sunucu** (production, varsayılan) | `npm run build` | Tüm veri API'den gelir. Cevaplar sunucuda değerlendirilir. API hatasında kullanıcıya hata ve **Tekrar dene** gösterilir; yerel veriye **asla** düşülmez |
| **Yerel** (statik demo) | `VITE_VERI_MODU=yerel npm run build` | Sunucusuz barındırma. Cevap anahtarı tarayıcıya iner; yalnızca demo içindir. Çok oyunculu mod çalışmaz. Production'da kullanmayın |

### API (Worker)

| Uç | Açıklama |
| --- | --- |
| `GET /api/saglik` | Sağlık kontrolü: yapılandırma, veritabanı, sürüm (commit) |
| `GET /api/oyun` | Oyun ayarları ve aktif soru sayısı (cevap anahtarı yok) |
| `POST /api/oyun/oturum` | Tek oyunculu oturum: sorular ve karışık şıklar (hangisinin doğru olduğu yok) |
| `POST /api/oyun/oturum/<anahtar>/cevap` | `{ index, secim }` ya da `{ index, sureDoldu: true }`; doğru şık ve açıklamalar yalnızca bu yanıtta |
| `POST /api/oyun/oturum/<anahtar>/joker` | `{ index, tur: 'fifty' \| 'hint' \| 'double' }` |
| `POST /api/admin/oturum` · `DELETE /api/admin/oturum` | Yönetici girişi / çıkışı |
| `GET /api/admin`, `/api/sorular…`, `PUT /api/ayarlar`, `DELETE /api/istatistik` | Yönetici işlemleri (oturum gerekir) |
| `/api/canli/oda…` | Çok oyunculu oda, katılım, SSE akışı, cevap, host komutları |

Kontrollü yanıtlar şunlardır:

- `400` geçersiz alan ya da JSON,
- `401` oturum yok ya da yanlış parola,
- `403` yabancı origin ya da yetkisiz komut,
- `404` bulunamadı,
- `409` sıra/durum çakışması,
- `410` kaldırılmış uç (`/api/sonuc`),
- `429` hız sınırı (`Retry-After` başlığıyla),
- `503` yapılandırma eksik.

Beklenmeyen hatalarda yalnızca genel bir mesaj döner.

## Oyun

- Jokerler: **50:50** (iki yanlış şıkkı eler), **İpucu** (sorunun ipucunu gösterir, ipucu yoksa bir yanlış şıkkı eler), **Çift cevap** (o soruda ilk cevap yanlışsa şık elenir ve bir hak daha verilir; ikinci cevap kesindir). Jokerler sunucuda uygulanır.
- Kontroller: `A`–`D` (ya da `1`–`4`) ile seçim, `Enter` ile onay ve sonraki soru. Dokunmatik ekranda aynı şıkka ikinci kez dokunmak da onaylar.
- Duraklatma: üst çubuktaki ⏸ düğmesi (telefonda başlığın solunda) ya da `P` / `Esc`. Molada süre ve müzik durur, soru ve şıklar gizlenir; **Devam et** ile kaldığı yerden sürer, **Ana menü** oyunu sıfırlayıp "Hazır mısınız?" başlangıç ekranına döner. Sekme ya da uygulama değiştirilince oyun kendiliğinden molaya girer.
- Açılışta "Başla" ekranı gelir; süre ve müzik oyuncu hazır olunca başlar (mobil tarayıcılar sesi ancak bir dokunuştan sonra açar).
- Kronometre biçimli sayaç: 60 parçalı halka kalan süreyle söner, %50 altında sarıya, %25 altında kırmızıya döner. Son 5 saniyede tik sesi ve nabız efekti vardır. Süre dolarsa soru yanlış sayılır. Süre tarayıcıda tutulur (bkz. docs/OPERASYON.md "Bilinen sınırlar").
- Sunucuya ulaşılamazsa oyun durur ve **Tekrar dene / Ana menü** seçenekli bir hata penceresi açılır.
- Gerilim müziği: Edvard Grieg, "Dağ Kralının Salonunda" (1875, kamu malı). Kayıt kullanılmaz; notalar WebAudio ile anlık sentezlenir (`src/game/music.ts`), bu yüzden kayıt telifi de yoktur. Süre azaldıkça tempo hızlanır, timpani ve oktav katmanı eklenir. Ses düğmesi müziği de kapatır.
- Sağdaki yüz için üç stil var: `ten` (ten rengi illüstrasyon, varsayılan), `cizgi` (sade çizgi) ve `neon`. Varsayılan `src/game/render/head.ts` içindeki `FACE_DEFAULT` ile seçilir; adres satırına `?yuz=ten`, `?yuz=cizgi` ya da `?yuz=neon` eklenerek denenebilir. Vektör yüzler `src/game/render/faces.ts` içindedir.
- Ekrandaki tüm neon ışımaların şiddeti `src/game/render/draw.ts` içindeki `GLOW_SCALE` ile ayarlanır (1 = ilk tasarım).
- Neon yüz `oyun-tasarim.jpg` tasarımından kesildi: `public/img/sinus-yuz.png` (iltihaplı, pembe) ve `public/img/sinus-yuz-acik.png` (açılmış, camgöbeği) üst üste durur. Koyu zemin saydamlaştırıldığı için panele kendiliğinden oturur.
- Cevaptan sonra oyun alanı kararır ve ortada bir kart açılır. Yanlış cevapta seçilen şık ile "Neden yanlış?", altında doğru şık ile "Neden doğru?" açıklaması alt alta gösterilir; doğru cevapta ya da süre dolunca yalnızca doğru şık gösterilir. Sinüs paneli karartılmaz.
- Soru, şık ve açıklama yazılarının boyutu soru havuzunun tamamına göre bir kez seçilir; oyun boyunca sorudan soruya değişmez. Açıklamaların ölçümü için sunucu yalnızca harfleri maskelenmiş kopyayı gönderir.
- Sağdaki "Sinüs kanalları" göstergesi doğru cevap oranını gösterir. Her doğru cevapta pembe iltihap kenarlardan içe doğru temizlenir ve yüz kısa bir an parlar; açılma sırası `public/img/sinus-sira.png` haritasından gelir (R = sıra, G = pembe alan).
- Ekran yatayda 1600×900, dikeyde (telefon) 900×(1500–2000) tasarım ölçüsüne göre yerleşir.

## Çok oyunculu mod: "Kim Nefes Almak İster?"

Kahoot tarzı canlı yarışma. Bir büyük ekran (projeksiyon, TV) sunucu olur, oyuncular telefonlarından
kodla katılır.

1. Ana oyunun başlangıç penceresindeki **Çok oyunculu** düğmesi `/katil` sayfasını açar: üstte PIN
   kutusu ve **Katıl** düğmesi, altında **Oyun oluştur** vardır. Büyük ekranda **Oyun oluştur**'a basın
   (ya da doğrudan `/canli` adresini açın). 6 haneli oyun PIN'i, katılma adresi ve QR kod görünür.
2. Oyuncular telefondan `/katil` adresine girip PIN'i ve adlarını yazar ya da QR kodu okutur. Adlar
   lobide belirir; bir adın üstüne tıklayarak o oyuncuyu çıkarabilirsiniz.
3. Soru sayısını ve soru başına süreyi seçip **Yarışmayı başlat**'a basın.

Akış: soru önce tek başına görünür (3,5 sn), sonra şıklar açılır ve süre başlar. Telefonda dört renkli
düğme (A pembe ▲, B mavi ◆, C sarı ●, D yeşil ■) çıkar; ilk dokunuş kesin cevaptır. Herkes cevaplayınca
ya da süre dolunca büyük ekranda cevap dağılımı ve her şıkkın altında neden doğru / neden yanlış olduğu
gösterilir. Telefonda yanlış bilen oyuncu kendi şıkkının neden yanlış olduğunu, altında doğru şıkkı ve
nedenini görür; doğru bilen "Neden doğru?" açıklamasını görür. Ardından skor
tablosu gelir. Son soruda kürsü (ilk üç) açılır. Büyük ekranda `Enter` bir sonraki adıma geçer.
Büyük ekrandaki **← Ana menü** odayı kapatıp tek oyunculu oyuna döner (oyunculara "Oyun kapandı" gider);
telefonda sol üstteki **←** oyuncuyu odadan çıkarır.

- Puanlama: doğru cevap 500–1000 puan, ne kadar hızlı o kadar çok. Art arda doğrularda seri bonusu
  (+100'den başlar, en çok +500). Yanlış ve süre dolması 0 puan, seriyi sıfırlar.
- Sorular yönetici panelindeki aktif sorulardan rastgele seçilir. Cevaplar panelde soru başına başarı
  oranına eklenir (oyun sayısı istatistiğine eklenmez).
- Her oda bir Durable Object'tir ve odanın tek yetkili koordinatörüdür. Eşzamanlı cevaplar sırayla ve
  deterministik işlenir. Doğru şık oyuncuya ancak süre bitince gönderilir; süre ve puan yalnızca sunucuda
  hesaplanır. Soru açıkken hiçbir ekran (büyük ekran dahil) puan, seri ya da sıra değişikliği almaz.
- Oda açma, katılma, canlı bağlantı açma ve **yanlış PIN denemeleri** IP başına hız sınırlıdır.
  Sınır aşılınca o adres pencere dolana kadar hiçbir oda isteği yapamaz.
- Sayfa yenilenirse ya da bağlantı koparsa büyük ekran ve telefon kaldığı yerden devam eder. Oda durumu
  kalıcıdır: yeniden deploy sonrasında istemciler otomatik yeniden bağlanır. Kopan bağlantı en geç
  20 saniyede fark edilir.
- Hiç işlem olmayan oda 3 saat, sunucu ekranı kapalı kalan oda 30 dakika sonra silinir. Oda başına en çok 120 oyuncu.
- Bağlantı Server-Sent Events (`/api/canli/oda/<kod>/akis`) ve POST istekleriyle kurulur.
- Yerel (statik) modda çok oyunculu mod çalışmaz; sayfa bunu bildirir.
- Yerel geliştirmede telefonlarla denemek için büyük ekranı bilgisayarın ağ adresinden açın
  (ör. `http://192.168.1.8:5173/canli`; Vite `--host` ile çalışır). QR kod sayfanın kendi adresini gösterir.
- Aynı tarayıcıda çok sayıda sekmeyle deneme yaparken tarayıcının alan adı başına bağlantı sınırına
  (HTTP/1.1'de 6) takılabilirsiniz. Gerçek kullanımda her telefon ayrı cihaz olduğundan sorun olmaz.

## Performans notları

- Parıltı, gradyan ve blur gibi pahalı efektler kare başına filtre olarak çalışmaz. Canvas2D ile bir kez dokuya
  çizilir ("pişirme", `src/game/render/bake.ts`). Ekran boyutu değişince dokular yeni çözünürlükte
  bir kez yeniden çizilir.
- Karelerde yalnızca sprite konumu, alfa ve doku değişimi yapılır. Metinler yalnızca içerik değişince yeniden çizilir.
- Cihaz piksel oranı 2 ile sınırlıdır. Pixi antialias kapalıdır, çünkü kenarlar dokularda zaten yumuşatılmıştır.
- `?fps` parametresi sol üstte kare hızı göstergesini açar.

## Klasör yapısı

```
index.html, admin.html         giriş sayfaları
canli.html, katil.html         çok oyunculu: sunucu ekranı ve oyuncu (telefon) ekranı
src/                           frontend (Vite): game/ (oyun), admin/ (panel), canli/ (çok oyunculu), shared/ (veri katmanı)
public/                        statik dosyalar; public/_headers = Pages güvenlik başlıkları
public/data/                   seed (yalnızca yerel mod build'ine girer; production build'inden çıkarılır)
functions/api/[[path]].js      Pages Function: /api/* → API Worker (service binding)
worker/wrangler.toml           API Worker yapılandırması (Durable Objects, ortamlar)
worker/src/index.mjs           API Worker giriş noktası ve rotalar
worker/src/do/                 Durable Object'ler: game-session, room, rate-limiter
worker/src/engine/             saf oyun motorları (oturum, oda, hız sınırı, doğrulama)
worker/src/repo.mjs            Supabase veri erişim katmanı (RPC)
wrangler.toml                  Pages projesi yapılandırması
supabase/migrations/           şema + seed migration'ları
scripts/dev.mjs                yerel geliştirme (veritabanı + Worker + Vite)
scripts/lib/supabase-emulator.mjs  PGlite + PostgREST RPC emülatörü (test / yerel geliştirme)
scripts/supabase-import.mjs    JSON → Supabase veri aktarımı
scripts/seed-migration.mjs     seed JSON → migration
scripts/scan-bundle.mjs        dist/ güvenlik taraması
scripts/shot.mjs, canli-shot.mjs  Playwright duman testleri
.github/workflows/deploy.yml   CI + Cloudflare/Supabase dağıtımı
docs/OPERASYON.md              production operasyonu ve kontrol listesi
docs/SORU_KAYNAKLARI.md        soru içeriğinin kaynakları
test/                          otomatik testler (node --test)
```
