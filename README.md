# Sinüs Labirenti

Siklamen temalı, Pac-Man mekaniğinde web/mobil labirent oyunu (PixiJS v8 + TypeScript + Vite). Oyunda marka adı geçmiyor; CTA'lar UTM parametreleriyle yasasinsaglik.com'a yönlendiriyor.

## Komutlar

```bash
npm install
npm run dev          # geliştirme sunucusu (LAN'dan telefonla test için --host açık)
npm run build        # dist/ → statik dosyalar, herhangi bir alt dizine konabilir (base: './')
npm run preview      # build'i yerelde sun
npm run test:sim     # headless simülasyon testleri (7 lokasyon labirenti, AI invariantları, 8 bölüm, rebound)
npm run test:visual  # Playwright: masaüstü + telefon ekran görüntüleri → shots/, konsol hatası kontrolü
```

`?debug` parametresi FPS/kare süresi göstergesini ve QA kancalarını açar (`window.__game`).

## Kendi görsellerinizi kullanmak

`gorseller/` klasörüne belirli isimlerle görsel bırakırsanız (`oyuncu.png`, `virus-ates.png`, `siklamen-ozu.png`, `logo.png` …) o öğe kodla çizilen grafiğin yerine geçer. Konmayan öğeler prosedürel çizilmeye devam eder. İsim listesi, önerilen boyutlar ve animasyon karesi kuralları `gorseller/BENIOKU.md` dosyasında.

## Mimari

| Katman | Dosya | Not |
|---|---|---|
| Simülasyon | `src/game/game.ts` | Render'dan bağımsız, sabit 120 Hz adım. Klasik scatter/chase, 4 farklı hedefleme AI'si, ev/çıkış mantığı, combo (pozitif döngü), semptom baskısı (negatif döngü), dekonjestan tuzağı + rebound |
| Labirent | `src/game/maze.ts`, `src/game/locations.ts` | Her bölüm sinüs sisteminde farklı bir yer (burun boşlukları, maksiller, etmoid, frontal, sfenoid). Özgün 28x31 ASCII labirentler, sol/sağ çiftler aynalanıyor. Hepsi otomatik doğrulanıyor |
| Sanat | `src/render/art.ts` | Tüm görseller kodla, Canvas2D ile cihaz çözünürlüğünde bir kez çiziliyor. Asset dosyası yok |
| Atlas | `src/render/atlas.ts` | Tek texture → sprite'lar tek draw call'da batch'leniyor |
| Görünüm | `src/render/view.ts` | İnterpolasyon, havuzlu partiküller/halkalar/popup'lar. Frame başına allocation yok. Sinüs boşluğu her durum için (enflamasyon, siklamen, rebound) tek dokuya pişiriliyor; geçişler çapraz geçişle |
| Ses | `src/core/audio.ts` | WebAudio sentezi: tıkalıyken low-pass + yankı, siklamenle filtre açılıyor |
| UI | `src/ui/` | DOM overlay. DOM'a yalnızca değer değişince yazılıyor |
| İçerik | `src/config.ts` | Metinler, CTA linkleri, UTM'ler, zorluk eğrisi |

### 60 FPS önlemleri
- Sabit adımlı simülasyon ve render interpolasyonu: 60/90/120 Hz ekranlarda pürüzsüz, mantık kare hızından bağımsız.
- Tüm vektör çizim açılışta yapılıyor; frame sırasında Graphics yeniden çizimi, filter veya mask yok.
- MSAA kapalı (art zaten yumuşak çizilmiş), çözünürlük en fazla 2x.
- **Kalite ayarlayıcı:** Kare süresi uzun süre 19,5 ms'yi aşarsa önce çözünürlüğü düşürüyor, sonra efektleri azaltıyor.
- Sekme gizlenince ticker ve ses duruyor, oyun otomatik duraklıyor.

## Yayına almadan önce
- `src/config.ts` → `ctaUrl()`: makale URL'leri şu an ana sayfaya + `utm_content` ile gidiyor. Kesin makale yolları (örn. "Siklamen evde kaynatılır mı?") netleşince `path` parametresi doldurulmalı.
- Analytics: sayfada GTM `dataLayer` veya `gtag` varsa `pacman_*` olayları otomatik gönderiliyor (`game_start`, `level_clear`, `game_over`, `cta_click`, `share`).
- Sağlık metinleri plandan alındı. Yayın öncesinde tıbbi/hukuki onaydan geçirilmeli.
