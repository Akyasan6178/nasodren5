// Cloudflare Pages Function: /api/* isteklerini service binding ile API Worker'ına iletir.
// Tarayıcı açısından API aynı origin'dedir; CORS gerekmez ve Worker'ın herkese açık adresi yoktur.
// İstek (yöntem, başlıklar, gövde, CF-Connecting-IP) olduğu gibi iletilir; yanıt (SSE akışı dahil)
// olduğu gibi döner.
export async function onRequest({ request, env }) {
  if (!env.API) {
    return new Response(JSON.stringify({ error: 'Sunucu yapılandırması eksik.' }), {
      status: 503,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
  return env.API.fetch(request);
}
