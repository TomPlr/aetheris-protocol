#!/usr/bin/env node
// Test E2E de l'espionnage : KAEL envoie des sondes sur Pyra II.
// Simule trois scénarios : 1 sonde (peu d'intel), 30 sondes (intel partiel), 700 sondes (intel max).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve('.');
const rd = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

function yparse(text) {
  const lines = text.split('\n')
    .filter(l => !/^\s*#/.test(l))
    .map(l => l.replace(/\s+#.*$/, ''));
  let i = 0;
  function readBlock(indent) {
    const out = {};
    let firstKey = true;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      const ind = line.match(/^ */)[0].length;
      if (ind < indent) return out;
      if (ind > indent && firstKey) return readBlock(ind);
      const m = line.slice(ind).match(/^([\w-]+)\s*:\s*(.*)$/);
      if (!m) { i++; continue; }
      const [, k, rest] = m;
      i++;
      if (rest === '') {
        if (i < lines.length && /^\s*-\s/.test(lines[i])) out[k] = readList(ind + 2);
        else out[k] = readBlock(ind + 2);
      } else if (rest.startsWith('[') || rest.startsWith('{')) {
        out[k] = readInline(rest);
      } else { out[k] = parseScalar(rest); }
      firstKey = false;
    }
    return out;
  }
  function readList(indent) {
    const out = [];
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      const ind = line.match(/^ */)[0].length;
      if (ind < indent) return out;
      if (!line.slice(ind).startsWith('- ')) return out;
      const rest = line.slice(ind + 2);
      i++;
      if (rest.includes(':')) {
        const m = rest.match(/^([\w-]+)\s*:\s*(.*)$/);
        const item = {};
        if (m[2] === '') item[m[1]] = readBlock(ind + 4);
        else item[m[1]] = parseScalar(m[2]);
        Object.assign(item, readBlock(ind + 2));
        out.push(item);
      } else { out.push(parseScalar(rest)); }
    }
    return out;
  }
  function splitTopLevel(s, sep) {
    const out = [];
    let depth = 0, start = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') depth--;
      else if (c === sep && depth === 0) { out.push(s.slice(start, i).trim()); start = i + 1; }
    }
    const last = s.slice(start).trim();
    if (last) out.push(last);
    return out;
  }
  function readInline(s) {
    s = s.trim();
    if (s.startsWith('[') && s.endsWith(']')) {
      const inner = s.slice(1, -1).trim();
      if (!inner) return [];
      return splitTopLevel(inner, ',').map(t => parseScalar(t));
    }
    if (s.startsWith('{') && s.endsWith('}')) {
      const inner = s.slice(1, -1).trim();
      if (!inner) return {};
      const out = {};
      for (const part of splitTopLevel(inner, ',')) {
        const colon = part.indexOf(':');
        if (colon < 0) continue;
        const k = part.slice(0, colon).trim().replace(/^["']|["']$/g, '');
        const v = part.slice(colon + 1).trim();
        out[k] = parseScalar(v);
      }
      return out;
    }
    return s;
  }
  function parseScalar(s) {
    s = s.trim();
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (/^-?\d+$/.test(s)) return parseInt(s, 10);
    if (/^-?\d*\.\d+$/.test(s)) return parseFloat(s);
    if (s.startsWith('[') || s.startsWith('{')) return readInline(s);
    return s;
  }
  return readBlock(0);
}

function rngFromSeed(seedStr) {
  const h = crypto.createHash('sha256').update(seedStr).digest();
  let s0 = h.readUInt32LE(0), s1 = h.readUInt32LE(4),
      s2 = h.readUInt32LE(8), s3 = h.readUInt32LE(12);
  function rotl(x, k) { return ((x << k) | (x >>> (32 - k))) >>> 0; }
  return function rng() {
    const result = (rotl(Math.imul(s1, 5), 7) * 9) >>> 0;
    const t = (s1 << 9) >>> 0;
    s2 ^= s0; s3 ^= s1; s1 ^= s2; s0 ^= s3;
    s2 ^= t; s3 = rotl(s3, 11);
    return result / 0x100000000;
  };
}

const rules = yparse(rd('engine/rules.yaml'));
const manifest = yparse(rd('world/manifest.yaml'));
const vexor = yparse(rd('joueurs/vexor/empire.yaml'));

function simulerEspionnage(nbSondes, techDef, label) {
  const rng = rngFromSeed(`${manifest.seed}:${manifest.tick + 1}:spy:${label}`);
  const probaKill = rules.espionnage.proba_destruction_par_niveau;
  let detruites = 0;
  for (let i = 0; i < techDef; i++) if (rng() < probaKill) detruites++;
  detruites = Math.min(detruites, nbSondes);
  const survivantes = nbSondes - detruites;
  const diff = survivantes - techDef * 4;
  const paliers = rules.espionnage.paliers;
  let niveau = 0;
  for (const seuil of paliers) {
    if (diff >= seuil) niveau++;
    else break;
  }
  return { nbSondes, detruites, survivantes, niveau, diff };
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  TEST ESPIONNAGE — KAEL → VEXOR/Pyra II');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const techVexor = vexor.recherche.espionnage_profond || 0;
console.log(`Tech espionnage VEXOR (défenseur) : niveau ${techVexor}`);
console.log(`Paliers : ${rules.espionnage.paliers.join(', ')}\n`);

const labels = {
  0: '—', 1: 'ressources', 2: '+ flotte', 3: '+ défenses', 4: '+ bâtiments', 5: '+ recherches',
};

for (const n of [1, 5, 30, 100, 700, 5000]) {
  const r = simulerEspionnage(n, techVexor, `n${n}`);
  const niv = `niv ${r.niveau}/5`;
  console.log(`  ${String(n).padStart(5)} sondes → ${String(r.detruites).padStart(2)} interceptées · ${String(r.survivantes).padStart(5)} survivantes · diff=${String(r.diff).padStart(5)} · ${niv} (${labels[r.niveau]})`);
}

console.log('\n');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  Test ordre via tick.mjs');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// Patch temporaire de l'ordre kael pour ajouter un espionnage rapide
const ordresPath = path.join(ROOT, 'joueurs/kael/ordres.yaml');
const backup = fs.readFileSync(ordresPath, 'utf8');
const ordre = `version: 1
joueur: kael
tick_cible: 143
nonce: spy001

ordres:
  - type: espionnage
    depuis: aetheris-prima
    cible: { joueur: vexor, planete: pyra-ii }
    nombre_sondes: 100

signature: ed25519:STUB
`;
fs.writeFileSync(ordresPath, ordre);

// Patcher temporairement la sonde count (il en a 124)
const empPath = path.join(ROOT, 'joueurs/kael/empire.yaml');
const empBackup = fs.readFileSync(empPath, 'utf8');

// Ajuster aussi l'ordres-scelles.yaml pour éviter que les ordres scellés interfèrent
const scellesPath = path.join(ROOT, 'joueurs/kael/ordres-scelles.yaml');
const scellesBackup = fs.readFileSync(scellesPath, 'utf8');

try {
  // Lance tick.mjs en dry-run pour voir le queueing
  const { execSync } = await import('node:child_process');
  const out = execSync('node engine/tick.mjs --dry-run', { encoding: 'utf8', cwd: ROOT });
  // Afficher uniquement les lignes pertinentes
  for (const line of out.split('\n')) {
    if (line.includes('espionnage') || line.includes('👁') || line.includes('Phase') || line.includes('kael')) {
      console.log(line);
    }
  }
} finally {
  fs.writeFileSync(ordresPath, backup);
  fs.writeFileSync(empPath, empBackup);
  fs.writeFileSync(scellesPath, scellesBackup);
}

console.log('\n');
