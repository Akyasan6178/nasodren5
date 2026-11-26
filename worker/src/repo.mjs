// Tipli veri erişim fonksiyonları. Uç nokta kodu Supabase ayrıntılarını bilmez; yalnızca bunları çağırır.
// Dönen veri biçimleri seed JSON'u ile aynıdır (Question: id, soru, dogru, yanlislar, kategori, ipucu,
// aciklama, yanlisAciklamalar, aktif, olusturma).
import { createSupabase } from './supabase.mjs';

/** @param {{ url: string, key: string }} supabase */
export function createRepo(supabase, opts = {}) {
  const db = createSupabase({ ...supabase, ...opts });
  const read = (fn, args) => db.rpc(fn, args, { idempotent: true });
  return {
    /** Herkese açık özet: { ayarlar, aktifSoru } (cevap anahtarı yok). */
    genelDurum: () => read('n5_genel_durum'),
    /** Oturum / oda kurmak için aktif sorular (tam veri) ve ayarlar. Yalnızca sunucu tarafında kullanılır. */
    oyunVerisi: () => read('n5_oyun_verisi'),
    /** Yönetici paneli: tüm (silinmemiş) sorular, ayarlar (surum dahil) ve istatistikler. */
    adminVerisi: () => read('n5_admin_verisi'),
    soruEkle: (q) => db.rpc('n5_soru_ekle', { p_soru: q }),
    soruGuncelle: (id, q) => db.rpc('n5_soru_guncelle', { p_id: id, p_soru: q }),
    soruSil: (id) => db.rpc('n5_soru_sil', { p_id: id }),
    sorulariDegistir: (list) => db.rpc('n5_sorulari_degistir', { p_sorular: list }),
    /** surum: okunan ayarların sürümü; arada değiştiyse 409 (HttpError). */
    ayarlariGuncelle: (settings, surum) => db.rpc('n5_ayarlari_guncelle', { p_ayarlar: settings, p_surum: surum }),
    istatistikSifirla: () => db.rpc('n5_istatistik_sifirla'),
    /**
     * Biten oyunu kaydeder. Aynı oyunId ikinci kez gelirse veritabanı hiçbir şeyi değiştirmez;
     * bu yüzden ağ hatasından sonra güvenle yeniden denenebilir.
     */
    oyunKaydet: (oyunId, tur, cevaplar, bitti) =>
      db.rpc('n5_oyun_kaydet', { p_oyun_id: oyunId, p_tur: tur, p_cevaplar: cevaplar, p_bitti: bitti }, { idempotent: true }),
  };
}
