'use strict';

/**
 * Construit la version Windows de BuildSense :
 *   1. dist/BuildSense-win32-x64/BuildSense.exe   (appli prête à lancer)
 *   2. dist/BuildSense-Setup-<version>.exe         (installeur, si NSIS est disponible)
 *
 *   npm run dist:win
 *
 * NSIS : installe-le (https://nsis.sourceforge.io) ou indique son dossier avec NSIS_DIR.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const pkg = require('../package.json');
const isWin = process.platform === 'win32';

function run(cmd, args, env = {}) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { stdio: 'inherit', cwd: ROOT, env: { ...process.env, ...env } });
}

function findMakensis() {
  const candidates = [];
  if (process.env.NSIS_DIR) {
    candidates.push(path.join(process.env.NSIS_DIR, isWin ? 'makensis.exe' : 'linux/makensis'));
    candidates.push(path.join(process.env.NSIS_DIR, 'makensis'));
  }
  if (isWin) {
    candidates.push('C:\\Program Files (x86)\\NSIS\\makensis.exe', 'C:\\Program Files\\NSIS\\makensis.exe');
  } else {
    candidates.push('/usr/bin/makensis', '/usr/local/bin/makensis');
  }
  return candidates.find((c) => fs.existsSync(c)) || null;
}

fs.mkdirSync(DIST, { recursive: true });

// 0. keywatch.exe : raccourcis actifs quand le jeu a le focus (compilé avec le C# fourni avec Windows)
const keywatch = path.join(ROOT, 'native', 'bin', 'keywatch.exe');
if (isWin) {
  const csc = ['Framework64', 'Framework']
    .map((f) => path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', f, 'v4.0.30319', 'csc.exe'))
    .find((p) => fs.existsSync(p));
  if (!csc) throw new Error('csc.exe introuvable : impossible de compiler native/keywatch.cs');
  fs.mkdirSync(path.dirname(keywatch), { recursive: true });
  execFileSync(csc, ['/nologo', '/optimize', '/target:exe', `/out:${keywatch}`, path.join(ROOT, 'native', 'keywatch.cs')], { stdio: 'inherit' });
}

// 1. Appli Windows (BuildSense.exe + fichiers d'Electron)
// L'appli n'a aucune dépendance à l'exécution : node_modules ne contient que les outils de dev.
const ignore = '^/(node_modules|test|scripts|build|dist|preview|data|native|README\\.md|CHANGELOG\\.md|Lancer BuildSense\\.bat|\\.git\\w*|\\.github|package-lock\\.json)($|/)';
// lancé directement avec node (pas de shell : sous Windows, cmd.exe casserait l'expression --ignore)
run(process.execPath, [
  path.join(ROOT, 'node_modules', '@electron', 'packager', 'bin', 'electron-packager.mjs'),
  '.',
  'BuildSense',
  '--platform=win32',
  '--arch=x64',
  `--out=${DIST}`,
  '--icon=assets/icon.ico',
  ...(fs.existsSync(keywatch) ? [`--extra-resource=${keywatch}`] : []),
  '--asar',
  '--overwrite',
  `--ignore=${ignore}`,
  `--app-version=${pkg.version}`,
  `--build-version=${pkg.version}`,
  '--app-copyright=BuildSense',
  '--win32metadata.CompanyName=BuildSense',
  '--win32metadata.ProductName=BuildSense',
  '--win32metadata.FileDescription=BuildSense',
  '--win32metadata.InternalName=BuildSense',
  '--win32metadata.OriginalFilename=BuildSense.exe',
]);
const appDir = path.join(DIST, 'BuildSense-win32-x64');
console.log(`\nAppli prête : ${path.join(appDir, 'BuildSense.exe')}`);

// 2. Installeur
const makensis = findMakensis();
if (!makensis) {
  console.log("\nNSIS introuvable : pas d'installeur. Le dossier ci-dessus suffit pour lancer BuildSense.exe.");
  process.exit(0);
}
const out = path.join(DIST, `BuildSense-Setup-${pkg.version}.exe`);
const nsisDir = process.env.NSIS_DIR || path.dirname(makensis);
run(
  makensis,
  [
    '-V2',
    '-INPUTCHARSET',
    'UTF8',
    `-DVERSION=${pkg.version}`,
    `-DSRC_DIR=${appDir}`,
    `-DOUT_FILE=${out}`,
    `-DICON=${path.join(ROOT, 'assets', 'icon.ico')}`,
    path.join(ROOT, 'build', 'installer.nsi'),
  ],
  isWin ? {} : { NSISDIR: nsisDir },
);
console.log(`\nInstalleur prêt : ${out}`);
