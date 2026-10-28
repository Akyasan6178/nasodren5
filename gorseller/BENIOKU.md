# Görseller klasörü

Bu klasöre aşağıdaki isimlerle bir görsel bırakırsanız oyun, o öğe için kodla çizilen grafiğin yerine sizin görselinizi kullanır. **Görsel koymadığınız her öğe kodla çizilmeye devam eder**, yani öğeleri tek tek değiştirebilirsiniz.

- Desteklenen formatlar: `.png` (önerilen, şeffaf arka planlı), `.webp`, `.svg`, `.jpg`
- Dosya adları **küçük harfle** ve aşağıdaki gibi yazılmalı (Türkçe karakter yok).
- `npm run dev` açıkken dosya eklediğinizde sayfa kendiliğinden yenilenir.
- Görseller oyun açılırken tek bir texture atlasına paketlenir; performansa ek yük getirmez.

## Oyun içi karakterler ve nesneler

| Dosya adı | Ne için | Önerilen boyut |
|---|---|---|
| `oyuncu.png` | Oyuncu karakteri (Siklamen). **Sağa bakar şekilde** çizin; sola giderken oyun aynalar, yukarı/aşağı giderken Pac-Man gibi 90° döndürür. Şu an `oyuncu-1.png` … `oyuncu-4.png` (Pac-Man ağızlı siklamen) kullanılıyor; bunları `scripts/oyuncu-kareleri.py`, `referans/siclamentpacman.jpeg` dosyasından üretir. | 256×256 |
| `virus-ates.png` | Kırmızı virüs: Akut Enfeksiyon / Ateş | 256×256 |
| `virus-bas-agrisi.png` | Mor virüs: Sinüs Baş Ağrısı | 256×256 |
| `virus-yuz-baskisi.png` | Mavi virüs: Yüz Baskısı | 256×256 |
| `virus-tikaniklik.png` | Turuncu virüs: İnatçı Tıkanıklık | 256×256 |
| `drenaj.png` | Siklamen etkisindeki, sıvılaşmış (yenilebilir) virüs | 256×256 |
| `drenaj-uyari.png` | Siklamen etkisi biterken yanıp sönen hali (opsiyonel; yoksa `drenaj.png`'nin beyazlatılmışı kullanılır) | 256×256 |
| `mukus.png` | Toplanan mukus noktaları | 64×64 |
| `siklamen-ozu.png` | Güç hapı: Siklamen Özü damlası | 256×256 |
| `sprey.png` | Kimyasal dekonjestan tuzağı | 256×256 |
| `sislik.png` | Rebound sırasında yolu tıkayan şişmiş mukoza | 128×128 |

## Animasyon (opsiyonel)

Bir öğeye birden fazla kare vermek için sonuna numara ekleyin:

```
virus-ates-1.png
virus-ates-2.png
virus-ates-3.png
virus-ates-4.png
```

Virüs ve drenaj 4 kare, `mukus` 3 varyasyon kullanır; daha az kare verirseniz eldekiler döngüyle tekrar edilir.

`oyuncu` kareleri **ağız kapalıdan tam açığa** doğru numaralanır (ör. `oyuncu-1` kapalı … `oyuncu-4` tam açık). Kaç kare verirseniz verin oyun bunları yürürken kapalı → açık → kapalı şeklinde ileri-geri oynatır; karakter durunca ağız yarı açık kalır. **Ağzın köşesini görselin tam ortasına koyun:** oyun noktaları karakterin merkezinde yer ve karakteri o noktanın etrafında döndürür. Ölürken oyun ağzı sonuna kadar açar, ardından karakteri döndürüp küçülterek soldurur.

## Arayüz görselleri

| Dosya adı | Ne için |
|---|---|
| `logo.png` | Başlangıç ekranında "Sinüs Labirenti" başlığının yerine geçer (en fazla 110 px yükseklikte gösterilir) |
| `arka-plan.jpg` | Sayfa arka planı (masaüstünde oyunun etrafında görünür). `.png` / `.webp` de olur. |

## Referans görseller

`gorseller/referans/` alt klasörü oyun tarafından **yüklenmez**; tasarım referanslarını (ör. `siclament.png`) burada saklayabilirsiniz.

## İpuçları

- Görseli kenarlara kadar doldurmayın, etrafında biraz şeffaf boşluk kalsın. Oyun görseli kutusuna en-boy oranını koruyarak sığdırır.
- **Virüslerin yüzünü görsele çizin.** Özel virüs görseli kullanıldığında oyun kendi göz sprite'larını üstüne eklemez. Gözler yalnızca virüs "yenip" eve dönerken görünür.
- Karakterler telefonda yaklaşık 25–30 piksel boyutunda görünür. İnce detaylar kaybolur; kalın hatlar ve net silüetler daha iyi okunur.
- Marka adı veya logosu oyun içinde görünmemeli (kampanya kuralı).
