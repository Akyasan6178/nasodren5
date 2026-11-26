# Siklamen Bilgi Oyunu

"Kim Milyoner Olmak İster" tarzında, sinüzit üzerine bir bilgi yarışması: **Kim Nefes Almak İster?** Oyun ekranı **PixiJS 8**
(WebGL) ile çiziliyor, masaüstünde ve mobilde 60 fps hedefleniyor. Soruları **yönetici paneli**
üzerinden istediğiniz zaman ekleyebilir ya da düzenleyebilirsiniz.

## Çalıştırma

```bash
npm install
npm run dev            # geliştirme: http://localhost:5173  (panel: /admin, çok oyunculu: /canli)
npm run build          # üretim derlemesi -> dist/
npm start              # üretim sunucusu: http://localhost:8080 (ADMIN_PASSWORD zorunlu, bkz. "Production")
npm test               # birim + entegrasyon testleri (Node'un yerleşik test çalıştırıcısı)
```

Node.js 22.6 ya da üstü gerekir (testler Node'un yerleşik TypeScript tip silme desteğini kullanır).

Taze bir clone'da ek dosya gerekmez: ilk API isteğinde `data/questions.json`, repodaki
varsayılan soru havuzundan otomatik oluşturulur (bkz. "Veri").

## Production

`npm start` (`server.mjs`) her zaman **production** modudur. `npm run dev` (Vite) **development** modudur.

### Ortam değişkenleri

Değişken adları ve açıklamaları `.env.example` dosyasındadır. Sunucu `.env` dosyası okumaz; değerleri
barındırma platformunun ortam değişkeni / gizli değer (secret) ayarıyla verin. Gerçek değerleri repoya koymayın.

| Değişken | Zorunlu | Varsayılan | Açıklama |
| --- | --- | --- | --- |
| `ADMIN_PASSWORD` | **Production'da evet** | — | Yönetici paneli parolası |
| `PORT` | Hayır | `8080` | Sunucu portu |
| `TRUST_PROXY` | Hayır | `0` | Önündeki güvenilir ters vekil (nginx, yük dengeleyici) sayısı, `0`–`5` |
| `ADMIN_LOGIN_MAX_FAILURES` / `ADMIN_LOGIN_WINDOW_SECONDS` | Hayır | `10` / `900` | Bir IP'nin pencere içindeki başarısız yönetici girişi sınırı |
| `ROOM_CREATE_MAX` / `ROOM_CREATE_WINDOW_SECONDS` | Hayır | `20` / `900` | Bir IP'nin pencere içinde açabileceği çok oyunculu oda sayısı |
| `GAME_START_MAX` / `GAME_START_WINDOW_SECONDS` | Hayır | `120` / `900` | Bir IP'nin pencere içinde başlatabileceği tek oyunculu oyun sayısı |

### Yönetici parolası (fail-fast)

Production sunucusu güvenli bir parola olmadan **başlamaz** ve 1 koduyla çıkar. Reddedilen değerler:

- eksik ya da boş değer,
- 12 karakterden kısa değer,
- geliştirme varsayılanı ve bilinen zayıf değerler (`admin`, `password`, `123456…` vb.),
- yalnızca birkaç farklı karakterden oluşan değer.

Hata mesajı hangi değişkenin neden geçersiz olduğunu söyler; parolanın kendisi hiçbir zaman yazdırılmaz
ya da günlüğe alınmaz. Parola karşılaştırması zamanlama saldırılarına karşı güvenli biçimde
(SHA-256 + `timingSafeEqual`) yapılır ve yanlış parolada her zaman aynı genel yanıt döner.

Development modunda `ADMIN_PASSWORD` verilmezse yalnızca yerel geliştirme için bilinen bir varsayılan
parola kullanılır ve konsola uyarı yazılır. Bu varsayılan production'da reddedilir.

### Hız sınırları

Bellek içi, sabit pencereli sınırlar. Ek bağımlılık yoktur. Sınırlar ortam değişkenleriyle ayarlanır;
geçersiz değerler varsayılana, aralık dışı değerler en yakın sınıra çekilir ve uyarı yazılır.

- **Yönetici girişi:** Yalnızca başarısız denemeler sayılır; başarılı giriş o IP'nin sayacını sıfırlar.
  Sınır aşılınca, pencere dolana kadar o IP'den gelen tüm yönetici istekleri (doğru parolayla bile) `429` alır.
- **Oda açma ve oyun başlatma:** Her istek sayılır.
- Sınır aşılınca `429` ve `Retry-After` (saniye) başlığı döner. Yanıtta genel bir mesaj vardır.
- Süresi dolan kayıtlar düzenli olarak temizlenir. Tablo dolarsa (50.000 adres) yeni adresler sınırlanır,
  bellek sınırsız büyümez.

### Ters vekil (reverse proxy)

`TRUST_PROXY=0` (varsayılan) iken istemci adresi doğrudan TCP bağlantısından alınır ve `X-Forwarded-For`
yok sayılır; böylece sahte başlıkla sınır atlatılamaz. Sunucu bir ters vekil arkasındaysa, aradaki vekil
sayısını `TRUST_PROXY=1` (ya da 2…) olarak verin. Bu durumda `X-Forwarded-For` listesinin sağından o kadar
adres güvenilir sayılır. Vekil yoksa bu ayarı açmayın.

### Ölçekleme sınırları

Hız sınırı sayaçları, oyun oturumları, çok oyunculu odalar ve JSON yazma kuyruğu **tek bir Node sürecinin
belleğindedir**. Birden fazla süreç ya da replica çalıştırılırsa:

- her süreç kendi hız sınırını uygular (toplam sınır süreç sayısıyla katlanır),
- bir süreçte başlayan oyun ya da oda diğerinde bulunamaz (yapışkan oturum gerekir),
- aynı `data/` klasörüne yazan süreçler birbirinin yazmasını ezebilir.

Bu yüzden tek süreç çalıştırın. Ölçeklemek gerekirse merkezi bir veri deposu ve merkezi hız sınırı
(ör. veritabanı + Redis) gerekir.

### Başlatma ve doğrulama

```bash
npm ci && npm run build
ADMIN_PASSWORD='<güçlü parola>' npm start   # ya da platformun secret ayarıyla
```

1. Konsolda `Oyun: http://localhost:<port>/` görünmeli; `Başlatma durduruldu` görünüyorsa parolayı düzeltin.
2. `/admin` ile giriş yapın.
3. `/` adresinde bir oyun başlatın ve `/canli` adresinde bir oda açın.
4. `data/` klasörünün kalıcı diskte olduğundan ve yedeklendiğinden emin olun.

## Yönetici paneli (`/admin`)

- Soru ekleme ve düzenleme. Tüm alanlar zorunludur: soru, kategori, doğru cevap ve neden doğru olduğu (`aciklama`), 3 yanlış cevap ve her birinin neden yanlış olduğu (`yanlisAciklamalar`, yanlış şıklarla aynı sırada), ipucu. Aynı kurallar hem panelde hem sunucuda (`server/api.mjs`) uygulanır; eksik alanlı sorular JSON içe aktarmada da reddedilir.
- Soruyu silmeden oyundan çıkarmak için aktif/pasif anahtarı.
- Arama ve kategori filtresi.
- Soru bazında oyuncu başarı oranı ve toplam oyun istatistikleri.
- Oyun ayarları: oyun başına soru sayısı (varsayılan 15), soru başına süre (varsayılan 30 sn; 0 = süresiz) ve "yanlış cevapta / süre dolunca oyun bitsin" kuralı.
- JSON olarak dışa ve içe aktarma (yedekleme ya da başka kuruluma taşıma).

## Veri

İki ayrı soru kaynağı vardır:

| Dosya | Ne | Git'te mi? |
| --- | --- | --- |
| `public/data/varsayilan-sorular.json` | **Seed (varsayılan soru havuzu).** 30 doğrulanmış soru, 6 kategori. Yalnızca ilk kurulumda okunur. Build sırasında `dist/data/` altına kopyalanır | Evet |
| `data/questions.json` | **Çalışma verisi.** Oyunun ve yönetici panelinin kullandığı gerçek soru listesi. Paneldeki tüm ekleme, düzenleme, silme ve içe aktarmalar buraya yazılır | Hayır (`/data/` git dışı) |
| `data/settings.json`, `data/stats.json` | Oyun ayarları ve istatistikler (panelden) | Hayır |

- **Taze kurulum:** Sunucu ilk API isteğinde `data/` klasörünü oluşturur. `data/questions.json` yoksa seed'i
  oraya kopyalar. Var olan bir `data/questions.json` asla seed ile değiştirilmez.
- **Başlatma hatası:** Seed okunamazsa ya da bozuksa istek genel bir 500 hatası alır, ayrıntı sunucu
  günlüğüne yazılır ve boş soru dosyası oluşturulmaz. Sorun giderilince sonraki istek, sunucu yeniden
  başlatılmadan başarılı olur.
- **Bozuk veri dosyası:** `data/*.json` bozuksa sunucu onu sessizce boş listeyle değiştirmez; ilgili
  istekler hata verir ve dosya olduğu gibi korunur. Dosyayı yedekten geri yükleyin.
- **Eşzamanlı yazma:** Aynı dosyayı değiştiren istekler dosya başına tek kuyrukta sırayla çalışır.
  Her işlem en güncel içeriği okur, değiştirir ve geçici dosya + `rename` ile atomik yazar.
- **Yedekleme:** `data/` klasörü git'te değildir ve paneldeki tüm değişiklikler yalnızca orada durur.
  Üretimde bu klasör kalıcı bir diskte olmalı ve düzenli yedeklenmelidir. Gerekirse panelden "JSON dışa aktar" da kullanılabilir.
- **Soru havuzunu güncellemek:** Çalışan bir kurulumda soruları panelden yönetin. Yeni kurulumların
  varsayılan havuzunu değiştirmek için `public/data/varsayilan-sorular.json` dosyasını düzenleyin,
  kaynakları `docs/SORU_KAYNAKLARI.md` belgesine ekleyin ve `npm run test:seed` çalıştırın. Seed
  değişikliği var olan kurulumların `data/questions.json` dosyasını etkilemez; oraya aktarmak için
  paneldeki "JSON içe aktar" kullanılır (seed ile aynı biçim: soru dizisi).
- **Hata yanıtları:** API, kullanıcıya yalnızca doğrulama ve yetki gibi anlamlı mesajları döndürür.
  Beklenmeyen hatalarda dosya yolu ya da sistem mesajı göndermez; ayrıntı sunucu günlüğüne yazılır.

Soru içeriğinin kaynakları ve hangi sorunun hangi kaynağa dayandığı `docs/SORU_KAYNAKLARI.md` içindedir.

### Sunucu modu ve yerel mod

Veri modu **derleme sırasında** seçilir; çalışma anında tahmin edilmez.

| Mod | Nasıl | Davranış |
| --- | --- | --- |
| **Sunucu** (varsayılan) | `npm run build` | Tüm veri API'den gelir. Cevaplar sunucuda değerlendirilir. API hatasında (ağ, zaman aşımı, `5xx`, bozuk yanıt) kullanıcıya hata ve **Tekrar dene** gösterilir. Yerel veriye **asla** düşülmez ve yerel veriye yazılmaz |
| **Yerel** (statik) | `VITE_VERI_MODU=yerel npm run build` | Sunucusuz barındırma (Netlify, GitHub Pages vb.). Sorular `data/varsayilan-sorular.json` dosyasından yüklenir ve o tarayıcının localStorage'ında tutulur. Panel bunu bir uyarı bandıyla gösterir. Çok oyunculu mod çalışmaz |

Yerel modda cevap anahtarı tarayıcıya iner; bu mod yalnızca güvenliğin önemli olmadığı demolar içindir.
Sunucu modunda seed dosyası (`/data/varsayilan-sorular.json`) üretim sunucusu ve geliştirme sunucusu
tarafından **sunulmaz** (404). Yerel moddan sunucu moduna geçişte yerel veriler otomatik aktarılmaz.

### Tek oyunculu oyun ve istatistik

- `POST /api/oyun/oturum` sunucuda bir oyun oturumu açar: sorular ve karışık şıklar gönderilir. Hangi
  şıkkın doğru olduğu, açıklamalar ve ipuçları gönderilmez. Yazı boyutu seçimi için açıklamaların yalnızca
  harfleri maskelenmiş kopyası gelir.
- `POST /api/oyun/oturum/<anahtar>/cevap` `{ index, secim }` ya da `{ index, sureDoldu: true }`: sunucu
  cevabı değerlendirir. Doğru şık ve dört şıkkın açıklaması yalnızca bu yanıtta, o soru için döner.
  Aynı cevabın yeniden gönderimi aynı sonucu verir; farklı cevap `409`, sırası gelmemiş soru `409`,
  geçersiz alan ya da değer `400`, bilinmeyen ya da süresi dolmuş oturum `404` alır.
- `POST /api/oyun/oturum/<anahtar>/joker` `{ index, tur: 'fifty' | 'hint' | 'double' }`: jokerler de
  sunucuda uygulanır.
- İstatistik istemciden bildirilmez: oyun bittiğinde sunucu, doğruladığı cevaplardan bir kez yazar.
  Eski `POST /api/sonuc` ucu `410` döner. Oturumlar 2 saat işlem görmezse silinir.
- `GET /api/oyun` yalnızca oyun ayarlarını ve aktif soru sayısını döndürür.

## Testler

```bash
npm test               # tüm testler (test/*.test.mjs, Node 22.6+)
npm run test:seed      # yalnızca varsayılan soru havuzunun şema / içerik denetimi
npm run test:visual    # Playwright görsel duman testi (önce npm run dev)
npm run test:canli     # Playwright çok oyunculu duman testi (önce npm run dev)
```

- `test/seed.test.mjs`: her sorunun zorunlu alanları, benzersiz kimlik ve şıklar, üç yanlış şık + üç
  açıklama, uzunluk sınırları ve sunucu doğrulamasından kırpılmadan geçmesi.
- `test/api.test.mjs`: geçici dizinde gerçek HTTP sunucusuyla taze kurulum, başlatma hatasının
  önbellekte kalmaması, bozuk JSON'un korunması, 30 paralel oyun ile karışık paralel yazmalar,
  hata yanıtlarında ve günlükte iç ayrıntı / oturum anahtarı sızmaması.
- `test/oyun.test.mjs`: açık API'de cevap anahtarı sızmaması, sunucu taraflı cevap doğrulama, geçersiz
  değerler (negatif, aşırı büyük, NaN/sonsuz, metin, bilinmeyen alan), yeniden gönderim, jokerler,
  istatistiğin yalnızca biten oyunlardan bir kez yazılması, oyun başlatma hız sınırı.
- `test/canli.test.mjs`: gerçek SSE bağlantılarıyla (1 host + 4 oyuncu) soru açıkken puan, seri ve doğru
  şıkkın hiçbir ekrana sızmaması; oda açma hız sınırı ve kapasite (503) davranışı.
- `test/guvenlik.test.mjs`: production fail-fast (gerçek `server.mjs` süreci), parolanın çıktıda yer
  almaması, ayar doğrulama, yönetici girişi hız sınırı ve `Retry-After`, proxy başlığı güveni, seed'in
  statik olarak sunulmaması, bozuk URL'de çökmeme.
- `test/istemci.test.mjs`: istemci veri katmanı. API `5xx`, ağ hatası, zaman aşımı ve bozuk yanıtta yerel
  moda düşülmemesi ve yerel depoya yazılmaması; yeniden denemenin çalışması; açık yerel modun çalışması.

## Oyun

- Jokerler: **50:50** (iki yanlış şıkkı eler), **İpucu** (sorunun ipucunu gösterir, ipucu yoksa bir yanlış şıkkı eler), **Çift cevap** (o soruda ilk cevap yanlışsa şık elenir ve bir hak daha verilir; ikinci cevap kesindir).
- Kontroller: `A`–`D` (ya da `1`–`4`) ile seçim, `Enter` ile onay ve sonraki soru. Dokunmatik ekranda aynı şıkka ikinci kez dokunmak da onaylar.
- Duraklatma: üst çubuktaki ⏸ düğmesi (telefonda başlığın solunda) ya da `P` / `Esc`. Molada süre ve müzik durur, soru ve şıklar gizlenir; **Devam et** ile kaldığı yerden sürer, **Ana menü** oyunu sıfırlayıp "Hazır mısınız?" başlangıç ekranına döner. Sekme ya da uygulama değiştirilince oyun kendiliğinden molaya girer.
- Açılışta "Başla" ekranı gelir; süre ve müzik oyuncu hazır olunca başlar (mobil tarayıcılar sesi ancak bir dokunuştan sonra açar).
- Kronometre biçimli sayaç: 60 parçalı halka kalan süreyle söner, %50 altında sarıya, %25 altında kırmızıya döner. Son 5 saniyede tik sesi ve nabız efekti vardır. Süre dolarsa soru yanlış sayılır.
- Gerilim müziği: Edvard Grieg, "Dağ Kralının Salonunda" (1875, kamu malı). Kayıt kullanılmaz; notalar WebAudio ile anlık sentezlenir (`src/game/music.ts`), bu yüzden kayıt telifi de yoktur. Süre azaldıkça tempo hızlanır, timpani ve oktav katmanı eklenir. Ses düğmesi müziği de kapatır.
- Sağdaki yüz için üç stil var: `ten` (ten rengi illüstrasyon, varsayılan), `cizgi` (sade çizgi) ve `neon`. Varsayılan `src/game/render/head.ts` içindeki `FACE_DEFAULT` ile seçilir; adres satırına `?yuz=ten`, `?yuz=cizgi` ya da `?yuz=neon` eklenerek denenebilir. Vektör yüzler `src/game/render/faces.ts` içindedir.
- Ekrandaki tüm neon ışımaların şiddeti `src/game/render/draw.ts` içindeki `GLOW_SCALE` ile ayarlanır (1 = ilk tasarım).
- Neon yüz `oyun-tasarim.jpg` tasarımından kesildi: `public/img/sinus-yuz.png` (iltihaplı, pembe) ve `public/img/sinus-yuz-acik.png` (açılmış, camgöbeği) üst üste durur. Koyu zemin saydamlaştırıldığı için panele kendiliğinden oturur.
- Cevaptan sonra oyun alanı kararır ve ortada bir kart açılır. Yanlış cevapta seçilen şık ile "Neden yanlış?", altında doğru şık ile "Neden doğru?" açıklaması alt alta gösterilir; doğru cevapta ya da süre dolunca yalnızca doğru şık gösterilir. Sinüs paneli karartılmaz.
- Soru, şık ve açıklama yazılarının boyutu soru havuzunun tamamına göre bir kez seçilir; oyun boyunca sorudan soruya değişmez. Çok uzun bir şık/soru eklenirse tüm yazılar biraz küçülür.
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
- Doğru şık oyuncuya ancak süre bitince gönderilir; süre ve puan yalnızca sunucuda hesaplanır.
  Soru açıkken hiçbir ekran (büyük ekran dahil) puan, seri ya da sıra değişikliği almaz; bir oyuncunun
  doğru bilip bilmediği açıklama anına kadar görünmez.
- Oda açma IP başına hız sınırlıdır (bkz. "Production").
- Sayfa yenilenirse ya da bağlantı koparsa hem büyük ekran hem telefon kaldığı yerden devam eder.
- Odalar sunucu belleğinde tutulur: sunucu yeniden başlarsa açık oyunlar kapanır. Hiç kullanılmayan
  oda 3 saat, sunucu ekranı kapalı kalan oda 30 dakika sonra silinir. Oda başına en çok 120 oyuncu.
- Sunucu ekranı `localhost` üzerinden açıldıysa katılma adresi ve QR kod bilgisayarın yerel ağ
  adresiyle (ör. `192.168.1.8:5173`) gösterilir; telefonlar aynı Wi-Fi ağında olmalıdır.
  Geliştirmede `npm run dev` zaten `--host` ile çalışır.
- Bağlantı Server-Sent Events (`/api/canli/oda/<kod>/akis`) ve POST istekleriyle kurulur; ek paket
  gerekmez. Nginx gibi bir ters vekil arkasındaysanız bu yol için tamponlamayı kapatın
  (sunucu `X-Accel-Buffering: no` başlığını zaten gönderir).
- Statik barındırmada (sunucusuz) çok oyunculu mod çalışmaz; sayfa bunu bildirir.
- Aynı tarayıcıda çok sayıda sekmeyle deneme yaparken tarayıcının alan adı başına bağlantı sınırına
  (HTTP/1.1'de 6) takılabilirsiniz. Gerçek kullanımda her telefon ayrı cihaz olduğundan sorun olmaz.
- `node scripts/canli-shot.mjs http://localhost:5173 shots` bir sunucu ekranı ve dört telefonla iki
  soruluk bir yarışmayı baştan sona oynar ve ekran görüntüsü alır.

## Performans notları

- Parıltı, gradyan ve blur gibi pahalı efektler kare başına filtre olarak çalışmaz. Canvas2D ile bir kez dokuya
  çizilir ("pişirme", `src/game/render/bake.ts`). Ekran boyutu değişince dokular yeni çözünürlükte
  bir kez yeniden çizilir.
- Karelerde yalnızca sprite konumu, alfa ve doku değişimi yapılır. Metinler yalnızca içerik değişince yeniden çizilir.
- Cihaz piksel oranı 2 ile sınırlıdır. Pixi antialias kapalıdır, çünkü kenarlar dokularda zaten yumuşatılmıştır.
- `?fps` parametresi sol üstte kare hızı göstergesini açar.

## Klasör yapısı

```
index.html, admin.html     giriş sayfaları
canli.html, katil.html     çok oyunculu: sunucu ekranı ve oyuncu (telefon) ekranı
server.mjs                 üretim sunucusu (bağımlılıksız)
server/api.mjs             soru API'si (dev ve üretimde ortak)
server/canli.mjs           çok oyunculu oda motoru (oda, süre, puan, SSE akışı)
src/shared/store.ts        veri katmanı (API ya da localStorage)
src/game/                  oyun: quiz.ts (kurallar), game.ts (akış), render/ (Pixi sahnesi)
src/admin/                 yönetici paneli
src/canli/                 çok oyunculu arayüz: host.ts (büyük ekran), player.ts (telefon), net.ts (ortak)
public/data/               varsayılan soru havuzu (seed)
data/                      çalışma verisi (git dışı, sunucu oluşturur)
docs/SORU_KAYNAKLARI.md    soru içeriğinin kaynakları
test/                      birim + entegrasyon testleri (node --test)
scripts/shot.mjs           Playwright ile görsel duman testi
scripts/canli-shot.mjs     çok oyunculu uçtan uca duman testi
```
