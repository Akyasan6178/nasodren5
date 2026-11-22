# Siklamen Bilgi Oyunu

"Kim Milyoner Olmak İster" tarzında, sinüzit üzerine bir bilgi yarışması. Oyun ekranı **PixiJS 8**
(WebGL) ile çiziliyor, masaüstünde ve mobilde 60 fps hedefleniyor. Soruları **yönetici paneli**
üzerinden istediğiniz zaman ekleyebilir ya da düzenleyebilirsiniz.

## Çalıştırma

```bash
npm install
npm run dev            # geliştirme: http://localhost:5173  (panel: /admin)
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
server.mjs                 üretim sunucusu (bağımlılıksız)
server/api.mjs             soru API'si (dev ve üretimde ortak)
src/shared/store.ts        veri katmanı (API ya da localStorage)
src/game/                  oyun: quiz.ts (kurallar), game.ts (akış), render/ (Pixi sahnesi)
src/admin/                 yönetici paneli
public/data/               varsayılan sorular
scripts/shot.mjs           Playwright ile görsel duman testi
```
