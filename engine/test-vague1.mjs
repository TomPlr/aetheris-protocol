#!/usr/bin/env node
// Test global Vague 1 :
//  1. Ordre construction (vaisseaux + défenses) dans le tick
//  2. Combat avec défenses du côté défenseur
//
// Usage : node engine/test-vague1.mjs

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { resolveCombat, computeDebris, computePillage } from './combat.mjs';

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
    const out = []; let depth = 0, start = 0;
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
        out[k] = parseScalar(part.slice(colon + 1).trim());
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

const fmt = n => Math.round(n).toLocaleString('fr-FR');

const rules = yparse(rd('engine/rules.yaml'));
const manifest = yparse(rd('world/manifest.yaml'));
const kael = yparse(rd('joueurs/kael/empire.yaml'));
const vexor = yparse(rd('joueurs/vexor/empire.yaml'));

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  TEST 1 — Construction de vaisseaux (KAEL @ aetheris-prima)');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const prima = kael.planetes.find(p => p.nom === 'aetheris-prima');
console.log(`Stock initial   : ferrum=${fmt(prima.ressources.ferrum.stock)} lumen=${fmt(prima.ressources.lumen.stock)}`);
console.log(`Chantier_spatial: ${prima.batiments.chantier_spatial} | Usine_robotique: ${prima.batiments.usine_robotique}`);
const vitesse = 1 + 0.10 * prima.batiments.chantier_spatial + 0.10 * prima.batiments.usine_robotique;
console.log(`→ vitesse de construction : ×${vitesse.toFixed(1)}\n`);

// Test : 100 chasseurs lourds
const qty = 100;
const def = rules.vaisseaux.chasseur_lourd;
const cout = { ferrum: def.cout.ferrum * qty, lumen: def.cout.lumen * qty };
const dureeUTJ = Math.ceil(def.duree_utj * qty / vitesse);
console.log(`Ordre : construction ${qty}× chasseur_lourd`);
console.log(`  coût  : ${fmt(cout.ferrum)} ferrum + ${fmt(cout.lumen)} lumen`);
console.log(`  durée : ${dureeUTJ} UTJ ≈ ${Math.ceil(dureeUTJ / 6)} ticks ≈ ${Math.ceil(dureeUTJ / 6 * 15)} min IRL`);
console.log(`  ✓ stock après paiement : ferrum=${fmt(prima.ressources.ferrum.stock - cout.ferrum)} lumen=${fmt(prima.ressources.lumen.stock - cout.lumen)}\n`);

// Test : 50 canon_gauss
const qtyDef = 50;
const defGauss = rules.defenses.canon_gauss;
const coutGauss = {
  ferrum: defGauss.cout.ferrum * qtyDef,
  lumen: defGauss.cout.lumen * qtyDef,
  plasmide: defGauss.cout.plasmide * qtyDef,
};
const dureeGauss = Math.ceil(defGauss.duree_utj * qtyDef / vitesse);
console.log(`Ordre : construction ${qtyDef}× canon_gauss`);
console.log(`  coût  : ${fmt(coutGauss.ferrum)} ferrum + ${fmt(coutGauss.lumen)} lumen + ${fmt(coutGauss.plasmide)} plasmide`);
console.log(`  durée : ${dureeGauss} UTJ ≈ ${Math.ceil(dureeGauss / 6)} ticks\n`);

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  TEST 2 — Combat avec défenses sur Pyra II');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// On simule que vexor a construit des défenses depuis le tick 142
const pyra2 = vexor.planetes.find(p => p.nom === 'pyra-ii');
const defensesPyra2 = {
  canon_laser_lourd: 200,
  canon_gauss: 80,
  canon_ionique: 40,
  canon_plasma: 12,
  petit_bouclier_planetaire: 1,
  grand_bouclier_planetaire: 1,
};
console.log(`▸ Défenses fortifiées sur Pyra II :`);
for (const [t, n] of Object.entries(defensesPyra2)) console.log(`  · ${t.padEnd(28)} ${n}`);

// On reprend la même flotte d'attaque que test-combat — mais cette fois VEXOR a des défenses
const attaquantFlotte = {
  chasseur_leger: 4631,
  chasseur_lourd: 682,
  croiseur: 86,
  cuirasse: 46,
};
const defenseurShips = { ...pyra2.flotte_au_sol, ...defensesPyra2 };

console.log(`\n▸ Combat KAEL (solo) → VEXOR (flotte + défenses)\n`);

const rng = rngFromSeed(`${manifest.seed}:144:bataille-pyra-ii-fortifiee`);
const result = resolveCombat({
  attacker: { ships: attaquantFlotte, tech: kael.recherche },
  defender: { ships: defenseurShips, tech: vexor.recherche },
  rules,
  rng,
});

console.log(`  ${result.rondes.length} rondes · issue : ${result.issue.toUpperCase()}\n`);

console.log('▸ Pertes attaquant');
for (const [t, n0] of Object.entries(attaquantFlotte)) {
  const n1 = result.attaquant_restant[t] || 0;
  console.log(`  · ${t.padEnd(20)} ${fmt(n1).padStart(5)}/${fmt(n0).padStart(5)} (perte ${fmt(n0 - n1)})`);
}

console.log('\n▸ Pertes défenseur (séparées flotte/défenses)');
const defKeys = new Set(Object.keys(defensesPyra2));
console.log('  Flotte :');
for (const [t, n0] of Object.entries(pyra2.flotte_au_sol)) {
  if (defKeys.has(t)) continue;
  const n1 = result.defenseur_restant[t] || 0;
  console.log(`    · ${t.padEnd(18)} ${fmt(n1).padStart(5)}/${fmt(n0).padStart(5)} (perte ${fmt(n0 - n1)})`);
}
console.log('  Défenses :');
for (const [t, n0] of Object.entries(defensesPyra2)) {
  const n1 = result.defenseur_restant[t] || 0;
  console.log(`    · ${t.padEnd(28)} ${fmt(n1).padStart(3)}/${fmt(n0).padStart(3)} (perte ${fmt(n0 - n1)})`);
}

const debrisAtt = computeDebris(attaquantFlotte, result.attaquant_restant, rules);
const debrisDef = computeDebris(pyra2.flotte_au_sol, result.defenseur_restant, rules);
console.log(`\n▸ Champ de débris (vaisseaux uniquement, pas les défenses)`);
console.log(`  ferrum=${fmt(debrisAtt.ferrum + debrisDef.ferrum)} lumen=${fmt(debrisAtt.lumen + debrisDef.lumen)}`);

console.log('\n');
