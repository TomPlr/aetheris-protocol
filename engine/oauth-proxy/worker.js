// AETHERIS // PROTOCOL — Cloudflare Worker (OAuth proxy + tick driver)
//
// Deux responsabilites :
// 1. fetch() : proxy CORS pour le device flow GitHub
//    (github.com/login/device/code et /login/oauth/access_token).
// 2. scheduled() : trigger le workflow aetheris-tick toutes les 15 min via
//    workflow_dispatch — contournement du cron unreliable de GitHub Actions.
//
// Variables Cloudflare requises pour le tick driver :
//   REPO    : "owner/repo" (ex: meffysto/aetheris-protocol)        [Variable]
//   GH_PAT  : fine-grained PAT avec "Actions: Read & write" sur ce repo  [Secret]
//
// Cron trigger a configurer dans Settings > Triggers : `*/15 * * * *`
//
// Deploy : copier-coller dans le dashboard Cloudflare (Workers > Edit code).

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

  async scheduled(_event, env) {
    if (!env.REPO || !env.GH_PAT) {
      console.error('tick driver : REPO ou GH_PAT manquant dans les Variables');
      return;
    }
    const r = await fetch(`https://api.github.com/repos/${env.REPO}/actions/workflows/tick.yml/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.GH_PAT}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'aetheris-tick-driver',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: 'main' }),
    });
    if (!r.ok) {
      console.error(`tick dispatch failed : HTTP ${r.status} ${await r.text()}`);
    } else {
      console.log(`tick dispatched on ${env.REPO} @ ${new Date().toISOString()}`);
    }
  },
};
