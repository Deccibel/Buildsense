'use strict';

/**
 * Prépare une nouvelle bêta dans package.json :
 *   npm run beta            version suivante (1.7.0 -> 1.7.1), nom PG-<date du jour>-b<n>
 *   npm run beta -- minor   1.7.3 -> 1.8.0
 *   npm run beta -- same    garde le numéro (nouvelle bêta d'une version pas encore promue)
 * n = numéro de la bêta du jour (b1, b2...). Pousser package.json sur main publie la bêta (GitHub Actions).
 */

const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
const kind = process.argv[2] || 'patch';
const [maj, min, pat] = pkg.version.split('.').map(Number);
const bs = (pkg.buildsense = pkg.buildsense || {});

if (kind === 'minor') pkg.version = `${maj}.${min + 1}.0`;
else if (kind === 'major') pkg.version = `${maj + 1}.0.0`;
else if (kind !== 'same') pkg.version = `${maj}.${min}.${pat + 1}`;

const d = new Date();
const day = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' })
  .formatToParts(d)
  .reduce((o, p) => ({ ...o, [p.type]: p.value }), {});
const date = `${day.year}${day.month}${day.day}`;
const prev = /^PG-(\d{8})-b(\d+)$/.exec(bs.betaName || '');
const n = prev && prev[1] === date ? Number(prev[2]) + 1 : 1;
bs.channel = 'beta';
bs.betaName = `PG-${date}-b${n}`;
fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`Bêta ${bs.betaName} (version ${pkg.version}) prête : ajoute la section "## ${pkg.version}" au CHANGELOG puis pousse sur main.`);
