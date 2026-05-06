#!/usr/bin/env node
// Test E2E de la signature Ed25519 :
//   1. Vérifie la signature de testpilot (créé + signé en amont)
//   2. Tamper detection : modifie 1 byte → vérification doit échouer
//   3. Régénère kael, signe ses ordres, vérifie via tick.mjs
//   4. Mode --strict : tick.mjs rejette les ordres non signés

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

const ROOT = path.resolve('.');

function verify(playerName) {
  const id = fs.readFileSync(path.join(ROOT, `joueurs/${playerName}/identite.yaml`), 'utf8');
  const ordres = fs.readFileSync(path.join(ROOT, `joueurs/${playerName}/ordres.yaml`), 'utf8');
  const pubMatch = id.match(/cle_publique:\s*ed25519:(.+)$/m);
  const sigMatch = ordres.match(/^signature:\s*ed25519:(.+)$/m);
  if (!pubMatch || !sigMatch) return false;
  const pubKey = crypto.createPublicKey({
    key: Buffer.from(pubMatch[1].trim(), 'base64'),
    format: 'der',
    type: 'spki',
  });
  const sig = Buffer.from(sigMatch[1].trim(), 'base64');
  const canonical = ordres.split('\n').filter(l => !/^signature:\s*/.test(l)).join('\n').trimEnd() + '\n';
  return crypto.verify(null, Buffer.from(canonical, 'utf8'), pubKey, sig);
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  TEST 1 — Vérification signature testpilot');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

console.log(`  testpilot signature valide ? ${verify('testpilot') ? '✓ OUI' : '✗ NON'}\n`);

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  TEST 2 — Tamper detection');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const ordresPath = path.join(ROOT, 'joueurs/testpilot/ordres.yaml');
const original = fs.readFileSync(ordresPath, 'utf8');
const tampered = original.replace('nonce: 000000', 'nonce: badbad');
fs.writeFileSync(ordresPath, tampered);
console.log(`  fichier modifié (nonce 000000 → badbad)`);
console.log(`  signature toujours valide ? ${verify('testpilot') ? '⚠ OUI (BUG !)' : '✓ NON (détection OK)'}\n`);
fs.writeFileSync(ordresPath, original);

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  TEST 3 — Re-keying kael + signature de ses ordres existants');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

execSync('node engine/join.mjs --name kael --regenerate', { cwd: ROOT, stdio: 'inherit' });
execSync('node engine/sign.mjs joueurs/kael/ordres.yaml', { cwd: ROOT, stdio: 'inherit' });
console.log(`\n  kael signature valide ? ${verify('kael') ? '✓ OUI' : '✗ NON'}\n`);

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  TEST 4 — tick.mjs voit la différence');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const outA = execSync('node engine/tick.mjs --dry-run', { cwd: ROOT, encoding: 'utf8' });
for (const line of outA.split('\n')) {
  if (line.includes('signature') || line.includes('⚠') || line.includes('✗') || line.includes('Phase 3')) {
    console.log('  ' + line);
  }
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  TEST 5 — tick.mjs détecte un fichier modifié après signature');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const kaelOrdresPath = path.join(ROOT, 'joueurs/kael/ordres.yaml');
const orig = fs.readFileSync(kaelOrdresPath, 'utf8');
const corrupted = orig.replace(/nonce:\s*\S+/, 'nonce: hacked');
fs.writeFileSync(kaelOrdresPath, corrupted);
console.log('  → kael/ordres.yaml modifié (nonce remplacé) sans re-signer\n');

console.log('  Mode tolérant (par défaut) :');
const outB = execSync('node engine/tick.mjs --dry-run', { cwd: ROOT, encoding: 'utf8' });
for (const line of outB.split('\n')) {
  if (/signature|⚠|✗|Phase 3/.test(line)) console.log('    ' + line);
}

console.log('\n  Mode --strict (signature invalide → ordres rejetés) :');
const out2 = execSync('node engine/tick.mjs --dry-run --strict', { cwd: ROOT, encoding: 'utf8' });
for (const line of out2.split('\n')) {
  if (/signature|⚠|✗|rejet|Phase 3|chantier|recherche/i.test(line)) console.log('    ' + line);
}

fs.writeFileSync(kaelOrdresPath, orig);
console.log('\n  ✓ kael/ordres.yaml restauré\n');
