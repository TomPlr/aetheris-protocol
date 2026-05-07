#!/usr/bin/env node
// AETHERIS // PROTOCOL — Validateur de PR d'ordres.
//
// Lance par .github/workflows/validate-orders.yml sur les PRs `orders/<nom>`.
// Verifie : (a) seul joueurs/<nom>/ordres.yaml est touche, (b) le YAML est
// bien forme, (c) tick_cible == tick_courant + 1, (d) signature Ed25519 valide
// contre la cle publique enregistree dans joueurs/<nom>/identite.yaml.
//
// Usage : node engine/validate-orders.mjs <pr_number>
// Env : GH_TOKEN, PR_HEAD_SHA, PR_BASE_SHA, GITHUB_REPOSITORY

import { execSync } from 'node:child_process';
import crypto from 'node:crypto';

const PR_NUM = process.argv[2];
const { GH_TOKEN, PR_HEAD_SHA, PR_BASE_SHA, GITHUB_REPOSITORY } = process.env;
if (!PR_NUM || !GH_TOKEN || !PR_HEAD_SHA || !PR_BASE_SHA || !GITHUB_REPOSITORY) {
  console.error('manque env : GH_TOKEN, PR_HEAD_SHA, PR_BASE_SHA, GITHUB_REPOSITORY, ou pr_number');
  process.exit(2);
}

const errors = [];
const fail = (msg) => errors.push(msg);
const sh = (cmd) => execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const showAt = (sha, p) => { try { return execSync(`git show ${sha}:${p}`, { encoding: 'utf8' }); } catch { return null; } };

// Mini-yaml (memes regles que validate-join.mjs)
function yparse(text) {
  const lines = text.split('\n').filter(l => !/^\s*#/.test(l)).map(l => l.replace(/\s+#.*$/, ''));
  let i = 0;
  function readBlock(indent) {
    const out = {};
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      const ind = line.match(/^ */)[0].length;
      if (ind < indent) return out;
      const m = line.slice(ind).match(/^([\w-]+)\s*:\s*(.*)$/);
      if (!m) { i++; continue; }
      const [, k, rest] = m; i++;
      if (rest === '') {
        if (i < lines.length && /^\s*-\s/.test(lines[i])) out[k] = readList(ind + 2);
        else out[k] = readBlock(ind + 2);
      } else if (rest.startsWith('[') || rest.startsWith('{')) out[k] = readInline(rest);
      else out[k] = scalar(rest);
    }
    return out;
  }
  function readList(indent) {
    const out = [];
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      const ind = line.match(/^ */)[0].length;
      if (ind < indent || !line.slice(ind).startsWith('- ')) return out;
      const rest = line.slice(ind + 2); i++;
      if (rest.includes(':')) {
        const m = rest.match(/^([\w-]+)\s*:\s*(.*)$/);
        const item = {};
        item[m[1]] = m[2] === '' ? readBlock(ind + 4) : scalar(m[2]);
        Object.assign(item, readBlock(ind + 2));
        out.push(item);
      } else out.push(scalar(rest));
    }
    return out;
  }
  function split(s, sep) {
    const out = []; let d = 0, start = 0;
    for (let j = 0; j < s.length; j++) {
      const c = s[j];
      if (c === '{' || c === '[') d++;
      else if (c === '}' || c === ']') d--;
      else if (c === sep && d === 0) { out.push(s.slice(start, j).trim()); start = j + 1; }
    }
    const last = s.slice(start).trim(); if (last) out.push(last);
    return out;
  }
  function readInline(s) {
    s = s.trim();
    if (s.startsWith('[') && s.endsWith(']')) {
      const inner = s.slice(1, -1).trim();
      return inner ? split(inner, ',').map(scalar) : [];
    }
    if (s.startsWith('{') && s.endsWith('}')) {
      const inner = s.slice(1, -1).trim();
      const out = {};
      for (const part of split(inner, ',')) {
        const c = part.indexOf(':'); if (c < 0) continue;
        out[part.slice(0, c).trim().replace(/^["']|["']$/g, '')] = scalar(part.slice(c + 1).trim());
      }
      return out;
    }
    return s;
  }
  function scalar(s) {
    s = s.trim();
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (s === 'null' || s === '~' || s === '') return null;
    if (/^-?\d+$/.test(s)) return parseInt(s, 10);
    if (/^-?\d*\.\d+$/.test(s)) return parseFloat(s);
    if (/^["'].*["']$/.test(s)) return s.slice(1, -1);
    if (s.startsWith('[') || s.startsWith('{')) return readInline(s);
    return s;
  }
  return readBlock(0);
}

// 1. Liste des fichiers changes — strictement joueurs/<nom>/ordres.yaml
const filesRaw = sh(`git diff --name-status ${PR_BASE_SHA} ${PR_HEAD_SHA}`);
const changes = filesRaw.split('\n').filter(Boolean).map(l => {
  const [status, ...rest] = l.split(/\s+/);
  return { status: status[0], path: rest.join(' ') };
});

// Sortie silencieuse si la PR n'est manifestement pas un ordre (multi-fichiers
// ou path hors-perimetre). validate-join.yml gere les inscriptions ; les autres
// PRs ne nous concernent pas. On ne commente pas — on ne fait rien.
const orderPathRe = /^joueurs\/([a-z][a-z0-9-]{1,15})\/ordres\.yaml$/;
if (changes.length !== 1 || !orderPathRe.test(changes[0].path)) {
  console.log(`PR hors-perimetre (${changes.length} fichier(s)) — skip validate-orders.`);
  process.exit(0);
}

const change = changes[0];
const m = change.path.match(orderPathRe);

const NAME = m ? m[1] : '';

// 2. Le joueur doit deja exister sur la base
let pubB64 = null;
if (NAME) {
  const idTxt = showAt(PR_BASE_SHA, `joueurs/${NAME}/identite.yaml`);
  if (!idTxt) fail(`joueur "${NAME}" inexistant sur base — utilise join.html pour t'inscrire d'abord`);
  else {
    const id = yparse(idTxt);
    const pk = id.cle_publique || '';
    const pm = pk.match(/^ed25519:([A-Za-z0-9+/=]+)$/);
    if (!pm) fail(`identite.cle_publique mal formee : "${pk}"`);
    else pubB64 = pm[1];
  }
}

// 3. Le YAML d'ordres doit etre bien forme + signe
let canonical = null, signatureB64 = null, ordTickCible = null;
if (errors.length === 0) {
  const ordTxt = showAt(PR_HEAD_SHA, `joueurs/${NAME}/ordres.yaml`);
  if (!ordTxt) fail(`joueurs/${NAME}/ordres.yaml introuvable sur HEAD`);
  else {
    // Extraire la signature et reconstruire le canonique (comme engine/sign.mjs)
    const lines = ordTxt.split('\n');
    const sigLineIdx = lines.findIndex(l => /^signature:\s*/.test(l));
    if (sigLineIdx < 0) fail('ordres.yaml ne contient pas de ligne `signature:`');
    else {
      const sigLine = lines[sigLineIdx];
      const sm = sigLine.match(/^signature:\s*ed25519:([A-Za-z0-9+/=]+)\s*$/);
      if (!sm) fail(`signature mal formee : "${sigLine}"`);
      else signatureB64 = sm[1];
      // Canonique = contenu sans la ligne signature, trim, + '\n'
      canonical = lines.filter((_, i) => i !== sigLineIdx).join('\n').trimEnd() + '\n';
    }

    const ord = yparse(ordTxt);
    if (ord.version !== 1) fail('ordres.version != 1');
    if (ord.joueur !== NAME) fail(`ordres.joueur (${ord.joueur}) != ${NAME}`);
    if (typeof ord.tick_cible !== 'number') fail('ordres.tick_cible doit etre un nombre');
    else ordTickCible = ord.tick_cible;
    if (typeof ord.nonce !== 'string' || !/^[a-f0-9]{4,16}$/.test(ord.nonce)) fail(`ordres.nonce invalide : "${ord.nonce}"`);
    if (!Array.isArray(ord.ordres)) fail('ordres.ordres doit etre une liste');
  }
}

// 4. tick_cible doit etre exactement tick_courant + 1
if (ordTickCible !== null) {
  const manTxt = showAt(PR_BASE_SHA, 'world/manifest.yaml') || '';
  const tickCur = parseInt((manTxt.match(/^tick:\s*(\d+)/m) || [, '0'])[1], 10);
  if (ordTickCible !== tickCur + 1)
    fail(`ordres.tick_cible (${ordTickCible}) doit etre tick_courant + 1 (${tickCur + 1}). Re-genere depuis la console.`);
}

// 5. Verification cryptographique de la signature
if (canonical && signatureB64 && pubB64) {
  try {
    const pubKey = crypto.createPublicKey({
      key: Buffer.from(pubB64, 'base64'),
      format: 'der',
      type: 'spki',
    });
    const ok = crypto.verify(null, Buffer.from(canonical, 'utf8'), pubKey, Buffer.from(signatureB64, 'base64'));
    if (!ok) fail('signature Ed25519 INVALIDE — la cle privee utilisee ne correspond pas a la cle publique enregistree');
  } catch (e) {
    fail(`erreur verification signature : ${e.message}`);
  }
}

// 6. Verdict
async function comment(body) {
  await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}/issues/${PR_NUM}/comments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${GH_TOKEN}`, 'Content-Type': 'application/json', Accept: 'application/vnd.github+json' },
    body: JSON.stringify({ body }),
  });
}

if (errors.length > 0) {
  const body = `## ❌ Ordre refuse\n\n${errors.map(e => `- ${e}`).join('\n')}\n\nCorrige et re-pousse.`;
  await comment(body);
  console.error(body);
  process.exit(1);
}

console.log(`✓ Ordre signe pour "${NAME}" valide pour tick ${ordTickCible}.`);
await comment(`## ✓ Ordre valide pour "${NAME}" — tick ${ordTickCible}\n\nSignature verifiee. Auto-merge.`);
