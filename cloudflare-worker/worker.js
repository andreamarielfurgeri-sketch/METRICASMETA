// worker.js — Cloudflare Worker que pausa/activa anuncios de Meta a pedido del
// botón del dashboard. Es el ÚNICO lugar donde vive el token de Meta con permiso
// de escritura (ads_management); el dashboard (GitHub Pages) nunca lo ve.
//
// Variables/secrets a configurar en Cloudflare (ver README para el paso a paso):
//   META_SYSTEM_USER_TOKEN  -> mismo system user token, pero acá necesita el scope
//                              ads_management (no solo ads_read)
//   PANEL_PIN               -> un PIN que elegís vos, ej "8451". Es lo que el
//                              dashboard te va a pedir para poder pausar/activar.
//
// Deploy: ver cloudflare-worker/README.md

const GRAPH_VERSION = 'v21.0';

function withCors(resp, origin) {
  resp.headers.set('Access-Control-Allow-Origin', origin || '*');
  resp.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  resp.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return resp;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '*';

    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }), origin);
    }

    const url = new URL(request.url);
    if (url.pathname !== '/toggle' || request.method !== 'POST') {
      return withCors(new Response(JSON.stringify({ ok: false, error: 'not_found' }), { status: 404 }), origin);
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return withCors(new Response(JSON.stringify({ ok: false, error: 'bad_json' }), { status: 400 }), origin);
    }

    const { pin, ad_id: adId, action } = body || {};

    if (!env.PANEL_PIN || pin !== env.PANEL_PIN) {
      return withCors(new Response(JSON.stringify({ ok: false, error: 'pin_incorrecto' }), { status: 401 }), origin);
    }
    if (!adId || !['pause', 'activate'].includes(action)) {
      return withCors(new Response(JSON.stringify({ ok: false, error: 'parametros_invalidos' }), { status: 400 }), origin);
    }

    const newStatus = action === 'pause' ? 'PAUSED' : 'ACTIVE';
    const graphUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${adId}?status=${newStatus}&access_token=${env.META_SYSTEM_USER_TOKEN}`;

    const metaRes = await fetch(graphUrl, { method: 'POST' });
    const metaJson = await metaRes.json();

    if (metaJson.error) {
      return withCors(
        new Response(JSON.stringify({ ok: false, error: metaJson.error.message || 'meta_error' }), { status: 502 }),
        origin
      );
    }

    return withCors(new Response(JSON.stringify({ ok: true, status: newStatus })), origin);
  },
};
