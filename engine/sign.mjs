#!/usr/bin/env node
// AETHERIS // PROTOCOL — Signature d'un fichier d'ordres
//
// Usage : node engine/sign.mjs joueurs/<name>/ordres.yaml
//
// Calcule la signature Ed25519 sur le contenu canonique du fichier
// (= contenu sans la ligne `signature:`), puis remplace ou ajoute la
// signature à la fin du fichier.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const target = process.argv[2];
if (!target) {
  console.error('Usage: sign.mjs <path/to/orders.yaml>');
  process.exit(2);
}

const fullPath = path.resolve(target);
if (!fs.existsSync(fullPath)) {
  console.error(`✗ Fichier introuvable : ${fullPath}`);
  process.exit(1);
}

// Trouver le dossier joueur (joueurs/<name>/...)
const segs = fullPath.split(path.sep);
const idx = segs.lastIndexOf('joueurs');
if (idx < 0 || !segs[idx + 1]) {
  console.error('✗ Le fichier doit être dans joueurs/<name>/');
  process.exit(1);
}
const playerName = segs[idx + 1];
const playerDir = segs.slice(0, idx + 2).join(path.sep);
const keyPath = path.join(playerDir, '.key.pem');

if (!fs.existsSync(keyPath)) {
  console.error(`✗ Clé privée introuvable : ${path.relative(process.cwd(), keyPath)}`);
  console.error(`  Lance d'abord : node engine/join.mjs --name ${playerName}`);
  process.exit(1);
}

const privKey = crypto.createPrivateKey(fs.readFileSync(keyPath));
const content = fs.readFileSync(fullPath, 'utf8');

// Canonique : strip la ligne signature, normaliser les fins de ligne
const canonical = stripSignature(content).trimEnd() + '\n';
const sig = crypto.sign(null, Buffer.from(canonical, 'utf8'), privKey).toString('base64');

const newContent = canonical + `signature: ed25519:${sig}\n`;
fs.writeFileSync(fullPath, newContent);

console.log(`✓ ${path.relative(process.cwd(), fullPath)} signé pour ${playerName}`);
console.log(`  signature: ed25519:${sig.slice(0, 32)}…`);

function stripSignature(text) {
  // Retire toute ligne commençant par "signature:" (et les blancs en fin de fichier)
  return text
    .split('\n')
    .filter(l => !/^signature:\s*/.test(l))
    .join('\n');
}
