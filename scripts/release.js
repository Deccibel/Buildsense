'use strict';

/**
 * Publication d'une nouvelle version (à lancer après `npm run dist:win`) :
 *   npm run release            prépare dist/latest.json et publie la version sur GitHub (si `gh` est connecté)
 *   npm run release -- --dry   prépare seulement dist/latest.json
 *
 * L'appli installée lit https://github.com/<dépôt>/releases/latest/download/latest.json,
 * télécharge l'installeur indiqué, vérifie sa taille et son empreinte, puis l'installe sur ton clic.
 * Les nouveautés affichées dans l'appli viennent de la section "## <version>" de CHANGELOG.md.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const version = pkg.version;
const repo = (pkg.buildsense && pkg.buildsense.repo) || '';
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

if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) fail('Renseigne le dépôt GitHub dans package.json : "buildsense": { "repo": "pseudo/buildsense" }');
const exeName = `BuildSense-Setup-${version}.exe`;
const exe = path.join(ROOT, 'dist', exeName);
if (!fs.existsSync(exe)) fail(`${exeName} introuvable : lance d'abord "npm run dist:win".`);

const buf = fs.readFileSync(exe);
const notes = notesFor(version);
if (!notes.length) console.warn(`! Aucune nouveauté pour ${version} dans CHANGELOG.md (section "## ${version}").`);
const manifest = {
  version,
  date: new Date().toISOString().slice(0, 10),
  notes,
  installer: {
    url: `https://github.com/${repo}/releases/download/v${version}/${exeName}`,
    sha256: crypto.createHash('sha256').update(buf).digest('hex'),
    size: buf.length,
  },
};
const manifestFile = path.join(ROOT, 'dist', 'latest.json');
fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`✓ dist/latest.json prêt (version ${version}, ${(buf.length / 1048576).toFixed(1)} Mo)`);

const ghOk = !DRY && spawnSync('gh', ['auth', 'status'], { stdio: 'ignore' }).status === 0;
if (!ghOk) {
  console.log(`
Publication manuelle sur GitHub :
  1. Ouvre https://github.com/${repo}/releases/new
  2. Tag : v${version}   ·   Titre : BuildSense ${version}
  3. Glisse ces 2 fichiers dans la zone "Attach binaries" :
       dist/${exeName}
       dist/latest.json
  4. Clique sur "Publish release" (laisse "Set as the latest release" coché).
Les appli BuildSense installées verront la mise à jour à leur prochaine vérification (au lancement, puis toutes les 4 h).
`);
  process.exit(0);
}

const body = notes.length ? notes.map((n) => `- ${n}`).join('\n') : `BuildSense ${version}`;
execFileSync('gh', ['release', 'create', `v${version}`, exe, manifestFile, '--repo', repo, '--title', `BuildSense ${version}`, '--notes', body, '--latest'], {
  stdio: 'inherit',
});
console.log(`✓ Version ${version} publiée : https://github.com/${repo}/releases/tag/v${version}`);
