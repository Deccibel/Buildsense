'use strict';

/**
 * Publication d'une version (à lancer après `npm run dist:win`, normalement par GitHub Actions) :
 *   npm run release            prépare dist/latest.json et publie sur GitHub (si `gh` est connecté)
 *   npm run release -- --dry   prépare seulement dist/latest.json
 *
 * Deux canaux :
 *  - bêta   (package.json "stonks.channel": "beta") : publiée tout de suite.
 *           Release "PG-AAAAMMJJ-bN" (pré-version) + mise à jour de la release fixe "beta"
 *           (latest.json + Stonks-Setup-beta.exe), que lisent les applis réglées sur Bêta.
 *  - stable : release "vX.Y.Z" marquée "latest". Normalement créée chaque jour à 9 h par
 *           scripts/promote.js à partir de la dernière bêta promouvable (même installeur).
 *
 * "stonks.promote": false dans package.json = bêta retenue : elle ne passe JAMAIS en stable toute seule
 * (latest.json porte "hold": true). Pour la sortir en stable : `node scripts/promote.js --tag=PG-...`,
 * ou retirer "promote": false et publier une nouvelle bêta.
 *
 * L'appli installée lit latest.json, télécharge l'installeur indiqué, vérifie sa taille et son
 * empreinte, puis l'installe sur ton clic. Les nouveautés viennent de la section "## <version>" de CHANGELOG.md.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const version = pkg.version;
const app = pkg.productName || 'Stonks';
const cfg = pkg.stonks || {};
const repo = cfg.repo || '';
const beta = cfg.channel === 'beta';
const hold = beta && cfg.promote === false;
const DRY = process.argv.includes('--dry');

function fail(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

/** Lignes "- ..." de la section "## <version>" du CHANGELOG. */
function notesFor(v) {
  let txt = '';
  try {
    txt = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  } catch {
    return [];
  }
  const lines = txt.split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^##\\s+${v.replace(/\./g, '\\.')}(\\s|$)`).test(l));
  if (start < 0) return [];
  const out = [];
  for (const l of lines.slice(start + 1)) {
    if (/^##\s/.test(l)) break;
    const m = /^\s*[-*]\s+(.+)$/.exec(l);
    if (m) out.push(m[1].trim());
  }
  return out;
}

if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) fail('Renseigne le dépôt GitHub dans package.json : "stonks": { "repo": "pseudo/depot" }');
if (beta && !/^PG-\d{8}-b\d+$/.test(cfg.betaName || '')) fail('Bêta : "stonks.betaName" doit ressembler à PG-20261113-b1 (lance "npm run beta").');
const tag = beta ? cfg.betaName : `v${version}`;
const exeName = `${app}-Setup-${version}.exe`;
const exe = path.join(ROOT, 'dist', exeName);
if (!fs.existsSync(exe)) fail(`${exeName} introuvable : lance d'abord "npm run dist:win".`);

const buf = fs.readFileSync(exe);
const notes = notesFor(version);
if (!notes.length) console.warn(`! Aucune nouveauté pour ${version} dans CHANGELOG.md (section "## ${version}").`);
const manifest = {
  version,
  channel: beta ? 'beta' : 'stable',
  name: beta ? cfg.betaName : version,
  app,
  date: new Date().toISOString().slice(0, 10),
  publishedAt: new Date().toISOString(),
  ...(hold ? { hold: true } : {}),
  notes,
  installer: {
    url: `https://github.com/${repo}/releases/download/${tag}/${exeName}`,
    sha256: crypto.createHash('sha256').update(buf).digest('hex'),
    size: buf.length,
  },
};
const manifestFile = path.join(ROOT, 'dist', 'latest.json');
fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`✓ dist/latest.json prêt (${manifest.name}, ${(buf.length / 1048576).toFixed(1)} Mo${hold ? ', bêta retenue : pas de passage automatique en stable' : ''})`);

const ghOk = !DRY && spawnSync('gh', ['auth', 'status'], { stdio: 'ignore' }).status === 0;
if (!ghOk) {
  console.log(`\nPublication non faite (--dry ou gh non connecté). Tag prévu : ${tag}${beta ? ' (pré-version) + release "beta"' : ''}.`);
  process.exit(0);
}

const gh = (args) => execFileSync('gh', [...args, '--repo', repo], { stdio: 'inherit' });
const ghOut = (args) => spawnSync('gh', [...args, '--repo', repo], { encoding: 'utf8' });
const body = notes.length ? notes.map((n) => `- ${n}`).join('\n') : `${app} ${manifest.name}`;

if (!beta) {
  gh(['release', 'create', tag, exe, manifestFile, '--title', `${app} ${version}`, '--notes', body, '--latest']);
  console.log(`✓ Version stable ${version} publiée : https://github.com/${repo}/releases/tag/${tag}`);
  process.exit(0);
}

const fate = hold
  ? 'Bêta uniquement : cette version ne passera en stable que sur décision (elle n’est pas promue automatiquement).'
  : `Bêta : deviendra la version stable ${version} le lendemain à 9 h (heure de Paris).`;

// 1. la bêta elle-même (pré-version : jamais "latest", les applis en Stable ne la voient pas)
gh(['release', 'create', tag, exe, manifestFile, '--title', `${app} ${tag} (bêta ${version})`, '--notes', `${body}\n\n${fate}`, '--prerelease', '--latest=false']);

// 2. la release fixe "beta" : toujours la dernière bêta (adresse stable pour l'appli et pour le README)
const betaExeName = `${app}-Setup-beta.exe`;
const betaBody = [
  `**Dernière bêta : ${tag}** (version ${version}, publiée le ${manifest.date}).`,
  '',
  body,
  '',
  fate,
  '',
  `Installer : télécharge **${betaExeName}** ci-dessous. Dans l'appli : Réglages › Mises à jour › **Bêta**.`,
  `Version stable : https://github.com/${repo}/releases/latest`,
].join('\n');
const title = `${app} bêta (dernière)`;
if (ghOut(['release', 'view', 'beta']).status !== 0) {
  gh(['release', 'create', 'beta', '--title', title, '--notes', betaBody, '--prerelease', '--latest=false']);
} else {
  gh(['release', 'edit', 'beta', '--title', title, '--notes', betaBody, '--prerelease', '--latest=false']);
}
const betaExe = path.join(ROOT, 'dist', betaExeName);
fs.copyFileSync(exe, betaExe);
gh(['release', 'upload', 'beta', manifestFile, betaExe, '--clobber']);
// ancien nom de l'installeur direct (avant le changement de nom de l'appli) : retiré pour ne pas laisser un fichier périmé
if (betaExeName !== 'BuildSense-Setup-beta.exe') ghOut(['release', 'delete-asset', 'beta', 'BuildSense-Setup-beta.exe', '--yes']);
console.log(`✓ Bêta ${tag} publiée : https://github.com/${repo}/releases/tag/${tag}`);
