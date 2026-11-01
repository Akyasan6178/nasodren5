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

- Soru ekleme ve düzenleme: soru, doğru cevap ve 3 yanlış cevap. İsterseniz kategori, ipucu ve açıklama da ekleyebilirsiniz.
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

- Jokerler: **50:50** (iki yanlış şıkkı eler), **İpucu** (sorunun ipucunu gösterir, ipucu yoksa bir yanlış şıkkı eler), **Soruyu geç** (soruyu yedekteki bir soruyla değiştirir).
- Kontroller: `A`–`D` (ya da `1`–`4`) ile seçim, `Enter` ile onay ve sonraki soru. Dokunmatik ekranda aynı şıkka ikinci kez dokunmak da onaylar.
- Açılışta "Başla" ekranı gelir; süre ve müzik oyuncu hazır olunca başlar (mobil tarayıcılar sesi ancak bir dokunuştan sonra açar).
- Kronometre biçimli sayaç: 60 parçalı halka kalan süreyle söner, %50 altında sarıya, %25 altında kırmızıya döner. Son 5 saniyede tik sesi ve nabız efekti vardır. Süre dolarsa soru yanlış sayılır.
- Gerilim müziği: Edvard Grieg, "Dağ Kralının Salonunda" (1875, kamu malı). Kayıt kullanılmaz; notalar WebAudio ile anlık sentezlenir (`src/game/music.ts`), bu yüzden kayıt telifi de yoktur. Süre azaldıkça tempo hızlanır, timpani ve oktav katmanı eklenir. Ses düğmesi müziği de kapatır.
- Sinüs çizimleri `public/img` altındaki görsellerden üretildi: `frontal_sol/sag.png` ve `maxillary_sol/sag.png` şekilleri, `etmoid sinus.png` ise yerleşim ve etmoid sinüslerin şekli için kullanıldı (`sol` izleyicinin solu).
- Sağdaki "Sinüs kanalları" göstergesi doğru cevap oranını gösterir. Oran arttıkça pembe iltihap söner, sinüsler camgöbeği renge döner.
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
