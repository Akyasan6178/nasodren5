# Siklamen Bilgi Oyunu

"Kim Milyoner Olmak İster" tarzında, sinüzit üzerine bir bilgi yarışması: **Kim Nefes Almak İster?** Oyun ekranı **PixiJS 8**
(WebGL) ile çiziliyor, masaüstünde ve mobilde 60 fps hedefleniyor. Soruları **yönetici paneli**
üzerinden istediğiniz zaman ekleyebilir ya da düzenleyebilirsiniz.

## Çalıştırma

```bash
npm install
npm run dev            # geliştirme: http://localhost:5173  (panel: /admin, çok oyunculu: /canli)
npm run build          # üretim derlemesi -> dist/
npm start              # üretim sunucusu: http://localhost:8080 (panel: /admin)
```

Ortam değişkenleri:

| Değişken         | Varsayılan  | Açıklama                    |
| ---------------- | ----------- | --------------------------- |
| `ADMIN_PASSWORD` | `siklamen`  | Yönetici paneli şifresi     |
| `PORT`           | `8080`      | Üretim sunucusunun portu    |

> Canlıya almadan önce `ADMIN_PASSWORD` değerini mutlaka değiştirin.

## Yönetici paneli (`/admin`)

- Soru ekleme ve düzenleme. Tüm alanlar zorunludur: soru, kategori, doğru cevap ve neden doğru olduğu (`aciklama`), 3 yanlış cevap ve her birinin neden yanlış olduğu (`yanlisAciklamalar`, yanlış şıklarla aynı sırada), ipucu. Aynı kurallar hem panelde hem sunucuda (`server/api.mjs`) uygulanır; eksik alanlı sorular JSON içe aktarmada da reddedilir.
- Soruyu silmeden oyundan çıkarmak için aktif/pasif anahtarı.
- Arama ve kategori filtresi.
- Soru bazında oyuncu başarı oranı ve toplam oyun istatistikleri.
- Oyun ayarları: oyun başına soru sayısı (varsayılan 15), soru başına süre (varsayılan 30 sn; 0 = süresiz) ve "yanlış cevapta / süre dolunca oyun bitsin" kuralı.
- JSON olarak dışa ve içe aktarma (yedekleme ya da başka kuruluma taşıma).

Sorular sunucuda `data/questions.json` dosyasında saklanır. Bu klasör git'e eklenmez. İlk açılışta
`public/data/varsayilan-sorular.json` içindeki 21 örnek soruyla başlatılır.

`dist/` klasörü sunucusuz, statik olarak da barındırılabilir (Netlify, GitHub Pages vb.). Bu
durumda API olmadığı için oyun ve panel tarayıcının localStorage'ını kullanır. Panel bunu bir
uyarı bandıyla gösterir. Sorular yalnızca o tarayıcıda saklanır; ortak kullanım için `npm start` gerekir.

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
public/data/               varsayılan sorular
scripts/shot.mjs           Playwright ile görsel duman testi
scripts/canli-shot.mjs     çok oyunculu uçtan uca duman testi
```
