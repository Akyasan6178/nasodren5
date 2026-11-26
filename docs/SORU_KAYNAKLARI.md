# Soru kaynakları

Varsayılan soru havuzu (`public/data/varsayilan-sorular.json`, 30 soru) yalnızca aşağıdaki kurumsal
kaynaklarda okunarak doğrulanan bilgilere dayanır. Kaynak bağlantıları oyun verisine eklenmez; bu
belge soru kimliklerini kaynaklarla eşleştirir.

- **Erişim tarihi:** tüm kaynaklar için 26 Kasım 2026.
- **Yöntem:** Her sorunun doğru cevabı ve açıklaması, kaynak sayfanın metniyle karşılaştırıldı.
  Kaynak sayfada karşılığı bulunamayan ya da kaynakla çelişen iddialar havuza alınmadı (bkz. son bölüm).
- **Kapsam uyarısı:** Sorular genel sağlık okuryazarlığı amaçlıdır; teşhis ya da kişisel tedavi önerisi
  içermez. Yayın öncesinde bir hekim ya da kulak burun boğaz uzmanının içeriği gözden geçirmesi önerilir.

## Kaynaklar

| Kısaltma | Kaynak | Bağlantı | Not |
| --- | --- | --- | --- |
| CDC | U.S. Centers for Disease Control and Prevention — *Sinus Infection Basics* | <https://www.cdc.gov/sinus-infection/about/index.html> | Sayfa güncelleme tarihi: 17 Nisan 2024 |
| CDC-AB | CDC — *Antibiotic Prescribing and Use* | <https://www.cdc.gov/antibiotic-use/> | |
| FDA | U.S. Food and Drug Administration — *Is Rinsing Your Sinuses With Neti Pots Safe?* | <https://www.fda.gov/consumers/consumer-updates/rinsing-your-sinuses-neti-pots-safe> | İçerik tarihi: 28 Nisan 2025 |
| HD | healthdirect Australia (Avustralya hükümeti destekli sağlık bilgi servisi) — *Sinusitis (rhinosinusitis)* | <https://www.healthdirect.gov.au/sinusitis> | Son gözden geçirme: Mayıs 2025 |
| AAO | American Academy of Otolaryngology–Head and Neck Surgery, ENT Health — *Sinusitis* | <https://www.enthealth.org/conditions/sinusitis/> | Son gözden geçirme: Ağustos 2025 |
| ENTUK | ENT UK — *Sinus infection (Sinusitis)* hasta bilgilendirme sayfası | <https://www.entuk.org/patients/conditions/45/sinus_infection_sinusitis_under_review> | Sayfa "gözden geçiriliyor" olarak işaretli (yayın 2021). Kullanılan bilgiler (sinüs çifti sayısı, iç zar, koku kaybı, ameliyat) HD/AAO ile çelişmiyor |
| ASPCA | ASPCA Animal Poison Control — *Cyclamen* | <https://www.aspca.org/pet-care/animal-poison-control/toxic-and-non-toxic-plants/cyclamen> | |
| RHS | Royal Horticultural Society — *Hardy Cyclamen Care* | <https://www.rhs.org.uk/plants/cyclamen> | |
| NCSU | North Carolina State University Extension, Gardener Plant Toolbox — *Cyclamen* | <https://plants.ces.ncsu.edu/plants/cyclamen/> | |
| CS | The Cyclamen Society — *Cyclamen plant species and cultivars* | <https://www.cyclamen.org/plant/> | |

## Soru → kaynak eşleştirmesi

### Sinüsler

| Soru ID | Doğrulanan temel bilgi | Kaynak |
| --- | --- | --- |
| `sinus-01` | Başta dört çift sinüs vardır. | ENTUK |
| `sinus-02` | Sinüsler gözlerin, burnun, alnın ve yanakların arkasındaki boşluklardır. | HD |
| `sinus-03` | Sinüsler burna küçük ve dar kanallarla bağlanır. | AAO |
| `sinus-04` | Sinüslerin içi burnu kaplayan zarla aynı türden bir zarla kaplıdır ve mukus üretir. | ENTUK |
| `sinus-05` | Sinüs zarının şişmesi sinüsleri boşaltan kanalları tıkar. | AAO |

### Belirtiler

| Soru ID | Doğrulanan temel bilgi | Kaynak |
| --- | --- | --- |
| `belirti-01` | Yüzde ağrı ya da baskı bir sinüs enfeksiyonu belirtisidir. Çeldiriciler CDC belirti listesinde yer almaz. | CDC |
| `belirti-02` | Koku alma duyusunda azalma bir belirtidir. | ENTUK |
| `belirti-03` | Dişlerde baskı / diş ağrısı hissedilebilir. | HD, ENTUK |
| `belirti-04` | Mukusun boğaza akması (post-nasal drip, Türkçede "geniz akıntısı") belirtiler arasındadır. | CDC |
| `belirti-05` | Kronik sinüzit tanısı için belirtilerin 12 haftadan uzun sürmesi gerekir. Çeldirici açıklamasındaki 10 gün eşiği CDC'den. | AAO, HD, CDC |

### Korunma

| Soru ID | Doğrulanan temel bilgi | Kaynak |
| --- | --- | --- |
| `korunma-01` | Elleri temizlemek korunma önerileri arasındadır. | CDC |
| `korunma-02` | Sigara içmemek ve dumandan uzak durmak korunma önerisi; sigara ve pasif içicilik risk faktörüdür. | CDC |
| `korunma-03` | Evde havayı nemlendirmek için temiz bir nemlendirici kullanılması önerilir. | CDC |
| `korunma-04` | Önerilen aşılar (örneğin grip ve pnömokok aşıları) korunma önerileri arasındadır. | CDC |
| `korunma-05` | Geçirilmiş soğuk algınlığı, mevsimsel alerjiler ve sigara dumanı risk faktörleridir; el temizliği, temiz nemlendirici ve aşılar korunma önerisidir. | CDC |

### Yanlış bilinenler

| Soru ID | Doğrulanan temel bilgi | Kaynak |
| --- | --- | --- |
| `yanlis-01` | Musluk suyu burun yıkama için güvenli değildir; damıtılmış, steril ya da kaynatılıp soğutulmuş su kullanılmalıdır. | FDA |
| `yanlis-02` | Burun açıcı (dekonjestan) spreyler 3–5 günden uzun kullanılmamalıdır. | HD |
| `yanlis-03` | Ameliyat, belirtiler ilaç ve diğer tedavilerle kontrol altına alınamadığında başvurulan bir seçenektir. | AAO, ENTUK |
| `yanlis-04` | Sinüs enfeksiyonları çoğunlukla virüslerden kaynaklanır ve genellikle antibiyotiksiz düzelir; bazılarına bakteriler yol açar; gerekmediğinde antibiyotik fayda sağlamaz. | CDC |
| `yanlis-05` | Migren ve gerilim tipi baş ağrıları sinüs ağrısı ya da baskısına benzer belirtiler yapabilir. | AAO |

### Sağlık okuryazarlığı

| Soru ID | Doğrulanan temel bilgi | Kaynak |
| --- | --- | --- |
| `okuryazar-01` | Sinüs enfeksiyonlarının çoğuna virüsler, bazılarına bakteriler yol açar. | CDC |
| `okuryazar-02` | Akut sinüzit genellikle soğuk algınlığının ardından gelişir; geçirilmiş soğuk algınlığı risk faktörüdür. | ENTUK, CDC, HD |
| `okuryazar-03` | Belirtiler 10 günden uzun sürüp düzelmezse, düzeldikten sonra kötüleşirse ya da şiddetliyse doktora başvurulmalıdır. | CDC |
| `okuryazar-04` | Düzeldikten sonra yeniden kötüleşen belirtiler doktora başvurma nedenidir. | CDC |
| `okuryazar-05` | Antibiyotikler her kullanıldığında yan etkilere ve antibiyotik direncine katkıda bulunabilir. | CDC-AB |

### Siklamen

| Soru ID | Doğrulanan temel bilgi | Kaynak |
| --- | --- | --- |
| `siklamen-01` | Siklamen Primulaceae (çuhaçiçeğigiller) ailesindedir. | ASPCA |
| `siklamen-02` | Siklamen yumrulu, çok yıllık bir bitkidir; patates ve yıldız çiçeği (dahlia) de yumru örnekleridir. | RHS |
| `siklamen-03` | Cins Avrupa'dan İran'a uzanan bir alanda doğal yayılış gösterir; türlerin çoğu Akdeniz kökenlidir; Türkiye yayılış alanındadır. | NCSU, CS |
| `siklamen-04` | Yumru ve kökler zehirlidir; bitki kedi, köpek ve atlar için toksiktir. | NCSU, ASPCA |
| `siklamen-05` | Yapraklar kalp ya da böbrek biçimindedir; çoğu zaman gümüşi / mermer desenlidir. | NCSU, RHS |

Siklamen soruları yalnızca botanik ve güvenlik bilgisi içerir. Bitkinin tıbbi etkisine dair hiçbir
soru ya da açıklama yoktur.

Bazı yanlış şık açıklamaları genel bilgiye dayanır ve doğru cevabın gerekçesini değiştirmez. Örnekler:
"mide reflüsü mide içeriğinin yemek borusuna kaçmasıdır" ve "gülgiller ailesine gül ve elma girer".
`yanlis-02` açıklamasındaki "ürün bilgisine ve eczacıya başvurun" ifadesi genel bir güvenlik
yönlendirmesidir.

## Doğrulanamadığı için havuza alınmayan iddialar

| İddia | Neden |
| --- | --- |
| Yeşil / sarı mukus tek başına bakteriyel enfeksiyon göstergesi değildir | Okunabilen kaynaklarda doğrulanamadı; ENT UK aksi yönde bir ifade içeriyor |
| En büyük sinüs maksiller sinüstür; etmoid sinüsler gözlerin arasındadır | Okunabilen kaynaklarda sinüs bazında konum bilgisi bulunamadı |
| Dinlenmek ve bol sıvı almak evde bakım önerisidir | Okunabilen kaynaklarda bulunamadı |
| Burun açıcı spreylerin uzun kullanımı "rebound" tıkanıklık yapar | Süre sınırı doğrulandı (HD), mekanizma bulunamadı; açıklamaya eklenmedi |
| Göz çevresinde şişlik, görme değişikliği, ense sertliği acil belirtileridir | Bu liste okunabilen kaynaklarda bulunamadı |
| Tüm siklamen türleri CITES Ek II'de listelidir | Resmî CITES kaynağına erişilemedi |
| Siklamen çiçeklerinin taç yaprakları geriye kıvrıktır (cins geneli) | Yalnızca tür düzeyinde (*C. persicum*) doğrulandı |

Not: NHS, MedlinePlus, Mayo Clinic ve NCBI StatPearls sayfaları inceleme sırasında erişilemediği için
kullanılmadı. Havuz genişletilirken bu kaynaklarla yeniden çapraz kontrol yapılması önerilir.

## Soru havuzunu güncellerken

1. Yeni bir bilgi eklemeden önce kurumsal bir kaynaktan doğrulayın ve bu belgeye ekleyin.
2. `public/data/varsayilan-sorular.json` dosyasını düzenleyin. Kimlikler kararlı olmalı (`kategori-NN`),
   her soruda üç yanlış şık ve aynı sırada üç yanlış açıklaması bulunmalı.
3. `npm run test:seed` ile şema ve içerik denetimini çalıştırın.
4. `node scripts/seed-migration.mjs --yeni` ile Supabase seed migration'ını üretin ve `npm test` çalıştırın (bkz. `docs/OPERASYON.md`).
