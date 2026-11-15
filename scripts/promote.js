'use strict';

/**
 * Promotion bêta -> stable (GitHub Actions, chaque jour à partir de 9 h, heure de Paris).
 *
 * La bêta promue est la plus récente qui :
 *  - n'est pas retenue ("hold": true dans son latest.json : publiée avec "promote": false) ;
 *  - a été publiée la veille ou avant (une nuit de recul, au cas où il y aurait des bugs) ;
 *  - est plus récente que la version stable actuelle.
 * Le même installeur est republié en "vX.Y.Z" (marqué latest) : les applis en canal Stable le reçoivent.
 * Une bêta retenue ne bloque pas les autres : la précédente bêta non retenue est promue normalement.
 *
 *   node scripts/promote.js                    promotion du jour (ne fait rien avant 9 h)
 *   node scripts/promote.js --force            sans attendre 9 h ni le lendemain (les bêtas retenues le restent)
 *   node scripts/promote.js --tag=PG-...-bN    promeut cette bêta précise, même retenue : décision explicite
 *   node scripts/promote.js --dry              dit ce qui serait fait, sans rien publier
 *
 * Tout mettre en pause : ajouter "[hold]" dans la description de la release "beta".
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const repo = (pkg.stonks && pkg.stonks.repo) || process.env.GITHUB_REPOSITORY;
const FORCE = process.argv.includes('--force');
const DRY = process.argv.includes('--dry');
const TAG = (process.argv.find((a) => a.startsWith('--tag=')) || '').slice(6);

const gh = (args, opts = {}) => execFileSync('gh', [...args, '--repo', repo], { encoding: 'utf8', ...opts });
const ghTry = (args) => spawnSync('gh', [...args, '--repo', repo], { encoding: 'utf8' });

/** -1, 0, 1 pour des versions "1.2.3". */
function cmp(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
  return 0;
}

/** Date (AAAA-MM-JJ) et heure à Paris. */
function paris(d = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

/**
 * Choisit la bêta à promouvoir. Fonction pure (testée) :
 * betas = [{ tag, version, hold, day }], stable = version stable actuelle ('' si aucune),
 * today = jour à Paris, opts = { force, tag }.
 * @returns {{ pick: object|null, why: string }}
 */
function choose(betas, stable, today, { force = false, tag = '' } = {}) {
  if (tag) {
    const b = betas.find((x) => x.tag === tag);
    if (!b) return { pick: null, why: `bêta ${tag} introuvable` };
    if (stable && cmp(b.version, stable) <= 0) return { pick: null, why: `${tag} (${b.version}) n'est pas plus récente que la stable ${stable}` };
    return { pick: b, why: `demandée explicitement${b.hold ? ' (elle était retenue)' : ''}` };
  }
  const newer = betas.filter((b) => !stable || cmp(b.version, stable) > 0).sort((a, b) => cmp(b.version, a.version) || (a.tag < b.tag ? 1 : -1));
  if (!newer.length) return { pick: null, why: `aucune bêta plus récente que la stable ${stable || '(aucune)'}` };
  const free = newer.filter((b) => !b.hold);
  if (!free.length) return { pick: null, why: `${newer.map((b) => b.tag).join(', ')} : bêta(s) retenue(s), rien à promouvoir` };
  const ready = free.find((b) => force || b.day < today);
  if (!ready) return { pick: null, why: `${free[0].tag} date d'aujourd'hui (${free[0].day}) : promotion demain à 9 h` };
  const held = newer.filter((b) => b.hold && cmp(b.version, ready.version) > 0);
  return { pick: ready, why: held.length ? `plus récente non retenue (${held.map((b) => b.tag).join(', ')} retenue(s))` : 'dernière bêta' };
}

function main() {
  const now = paris();
  if (!FORCE && !TAG && !DRY && now.hour < 9) return console.log(`Il est ${now.hour} h à Paris : promotion à partir de 9 h.`);
  const view = ghTry(['release', 'view', 'beta', '--json', 'body']);
  if (view.status === 0 && /\[hold\]/i.test(JSON.parse(view.stdout).body || '') && !TAG) return console.log('Promotion en pause ([hold] dans la release "beta").');

  // version stable actuelle
  const latest = ghTry(['release', 'view', '--json', 'tagName']);
  const stable = latest.status === 0 ? String(JSON.parse(latest.stdout).tagName || '').replace(/^v/, '') : '';

  // bêtas publiées (pré-versions "PG-AAAAMMJJ-bN"), avec leur latest.json
  const list = JSON.parse(execFileSync('gh', ['api', `repos/${repo}/releases?per_page=40`], { encoding: 'utf8' }));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stonks-promote-'));
  const betas = [];
  for (const r of list) {
    if (!/^PG-\d{8}-b\d+$/.test(r.tag_name) || !r.prerelease) continue;
    if (!TAG && betas.length >= 8) break; // les plus récentes suffisent
    const asset = (r.assets || []).find((a) => a.name === 'latest.json');
    if (!asset) continue;
    const dir = path.join(tmp, r.tag_name);
    fs.mkdirSync(dir);
    try {
      gh(['release', 'download', r.tag_name, '-p', 'latest.json', '-D', dir, '--clobber']);
      const m = JSON.parse(fs.readFileSync(path.join(dir, 'latest.json'), 'utf8'));
      betas.push({ tag: r.tag_name, version: m.version, hold: m.hold === true, day: m.publishedAt ? paris(new Date(m.publishedAt)).day : m.date, manifest: m, dir });
    } catch (e) {
      console.warn(`! ${r.tag_name} : latest.json illisible (${e.message})`);
    }
  }

  const { pick, why } = choose(betas, stable, now.day, { force: FORCE, tag: TAG });
  if (!pick) return console.log(`Rien à promouvoir : ${why}.`);
  const beta = pick.manifest;
  const version = beta.version;
  const tag = `v${version}`;
  if (ghTry(['release', 'view', tag]).status === 0) return console.log(`${tag} est déjà publiée en stable : rien à faire.`);
  console.log(`À promouvoir : ${pick.tag} -> ${tag} (${why}).`);
  if (DRY) return console.log('Simulation : rien n’a été publié.');

  const exeName = path.basename(new URL(beta.installer.url).pathname);
  gh(['release', 'download', pick.tag, '-p', exeName, '-D', pick.dir, '--clobber']);
  const exe = path.join(pick.dir, exeName);
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
  delete manifest.hold;
  const manifestFile = path.join(pick.dir, 'latest.json');
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  // nom de l'appli à cette version (BuildSense avant le changement de nom, Stonks ensuite)
  const app = beta.app || exeName.split('-Setup-')[0] || 'Stonks';
  const notes = (beta.notes || []).map((n) => `- ${n}`).join('\n') || `${app} ${version}`;
  gh(['release', 'create', tag, exe, manifestFile, '--title', `${app} ${version}`, '--notes', `${notes}\n\nIssue de la bêta ${beta.name}.`, '--latest'], { stdio: 'inherit' });
  console.log(`✓ ${beta.name} promue en version stable ${version}.`);
}

if (require.main === module) main();

module.exports = { choose, cmp };
