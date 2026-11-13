'use strict';

/**
 * Promotion bêta -> stable (GitHub Actions, chaque jour à 9 h heure de Paris) :
 * la dernière bêta devient la version stable si elle a été publiée la veille (ou avant).
 * Le même installeur est republié en "vX.Y.Z" (marqué latest) : les applis en canal Stable le reçoivent.
 *
 *   node scripts/promote.js            (horaire : ne fait rien avant 9 h ni si la bêta date d'aujourd'hui)
 *   node scripts/promote.js --force    (promotion immédiate de la dernière bêta)
 *
 * Mettre la promotion en pause : ajouter "[hold]" dans la description de la release "beta".
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const repo = (pkg.buildsense && pkg.buildsense.repo) || process.env.GITHUB_REPOSITORY;
const FORCE = process.argv.includes('--force');

const gh = (args, opts = {}) => execFileSync('gh', [...args, '--repo', repo], { encoding: 'utf8', ...opts });
const ghTry = (args) => spawnSync('gh', [...args, '--repo', repo], { encoding: 'utf8' });

/** Date (AAAA-MM-JJ) et heure à Paris. */
function paris(d = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

function main() {
  const now = paris();
  if (!FORCE && now.hour < 9) return console.log(`Il est ${now.hour} h à Paris : promotion à partir de 9 h.`);
  const view = ghTry(['release', 'view', 'beta', '--json', 'body']);
  if (view.status !== 0) return console.log('Aucune bêta publiée.');
  if (/\[hold\]/i.test(JSON.parse(view.stdout).body || '') && !FORCE) return console.log('Promotion en pause ([hold] dans la release "beta").');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-promote-'));
  gh(['release', 'download', 'beta', '-p', 'latest.json', '-D', tmp, '--clobber']);
  const beta = JSON.parse(fs.readFileSync(path.join(tmp, 'latest.json'), 'utf8'));
  const version = beta.version;
  const tag = `v${version}`;
  if (ghTry(['release', 'view', tag]).status === 0) return console.log(`${tag} est déjà publiée en stable : rien à faire.`);
  const published = beta.publishedAt ? paris(new Date(beta.publishedAt)).day : beta.date;
  if (!FORCE && published >= now.day) return console.log(`La bêta ${beta.name} date d'aujourd'hui (${published}) : promotion demain à 9 h.`);

  const betaTag = /\/releases\/download\/([^/]+)\//.exec(beta.installer.url)[1];
  const exeName = path.basename(new URL(beta.installer.url).pathname);
  gh(['release', 'download', betaTag, '-p', exeName, '-D', tmp, '--clobber']);
  const exe = path.join(tmp, exeName);
  const buf = fs.readFileSync(exe);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  if (sha !== beta.installer.sha256 || buf.length !== beta.installer.size) throw new Error('Installeur de la bêta corrompu : promotion annulée.');

  const manifest = {
    ...beta,
    channel: 'stable',
    name: version,
    date: now.day,
    publishedAt: new Date().toISOString(),
    promotedFrom: beta.name,
    installer: { url: `https://github.com/${repo}/releases/download/${tag}/${exeName}`, sha256: sha, size: buf.length },
  };
  const manifestFile = path.join(tmp, 'latest.json');
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  const notes = (beta.notes || []).map((n) => `- ${n}`).join('\n') || `BuildSense ${version}`;
  gh(['release', 'create', tag, exe, manifestFile, '--title', `BuildSense ${version}`, '--notes', `${notes}\n\nIssue de la bêta ${beta.name}.`, '--latest'], { stdio: 'inherit' });
  console.log(`✓ ${beta.name} promue en version stable ${version}.`);
}

main();
