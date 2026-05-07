// AETHERIS // PROTOCOL — Cloudflare Worker proxy pour le device flow GitHub.
//
// GitHub ne sert pas d'en-tetes CORS sur /login/device/code et /login/oauth/access_token.
// Ce Worker forward exactement ces deux endpoints et ajoute les CORS headers.
// Stateless, public, ~20 lignes — l'URL deployee va dans CONFIG.oauthProxy de join.html.
//
// Deploy : `wrangler deploy worker.js` (ou copier-coller dans le dashboard Cloudflare).

const ALLOWED = new Set(['/login/device/code', '/login/oauth/access_token']);
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
};

export default {
  async fetch(req) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const { pathname } = new URL(req.url);
    if (!ALLOWED.has(pathname)) return new Response('forbidden', { status: 403, headers: CORS });
    if (req.method !== 'POST') return new Response('method', { status: 405, headers: CORS });

    const upstream = await fetch(`https://github.com${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: await req.text(),
    });
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: { ...CORS, 'Content-Type': upstream.headers.get('Content-Type') || 'application/json' },
    });
  },
};
