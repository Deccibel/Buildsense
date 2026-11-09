'use strict';

/**
 * Outil de dev : rend l'overlay et la fenêtre principale avec les données FACTICES des tests.
 *   electron scripts/preview.js --out=dossier [--icons=dossier]   captures PNG (en français)
 *   electron scripts/preview.js --check [--icons=dossier]         vérifie qu'aucun texte n'est coupé,
 *                                                                  ne déborde ni ne se superpose
 *                                                                  (français, anglais, noms extrêmes ;
 *                                                                  plusieurs tailles de fenêtre)
 * --icons : dossier qui reproduit l'arborescence Data Dragon (cdn/<version>/img/...),
 *           sinon les icônes sont remplacées par des initiales.
 */

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain, protocol, nativeTheme } = require('electron');
const { messageVM } = require('../src/core/viewModels');
const S = require('./lib/scenarios');

const ROOT = path.join(__dirname, '..');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const arg = (name) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : null;
};
const OUT = arg('out');
const ICONS = arg('icons');
const CHECK = process.argv.includes('--check');

protocol.registerSchemesAsPrivileged([{ scheme: 'bsicon', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
app.disableHardwareAcceleration();

// ------------------------------------------------------------------ détection des textes coupés

/**
 * Exécuté dans la page : pour chaque texte visible, vérifie
 *  - qu'il reste dans tous ses conteneurs qui coupent (overflow hidden/clip, ou défilement horizontal) ;
 *  - qu'il ne sort pas de la fenêtre et ne crée pas de défilement horizontal ;
 *  - qu'il n'est pas tronqué par des points de suspension ;
 *  - qu'il ne chevauche pas un autre texte.
 */
const CHECK_FN = `(() => {
  const issues = [];
  const vw = document.documentElement.clientWidth;
  const desc = (e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\\s+/).join('.') : '');
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  const texts = [];
  let n;
  while ((n = walker.nextNode())) {
    const el = n.parentElement;
    if (!el || el.closest('[hidden], script, style, option, select')) continue;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden') continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
    if (!rects.length) continue;
    const label = n.textContent.trim().replace(/\\s+/g, ' ').slice(0, 70);
    // valeur technique affichée par erreur ("null", "undefined", "NaN"...)
    if (/(^|\\s)(null|undefined|NaN)(\\s|$)|\\[object Object\\]/.test(n.textContent)) issues.push({ type: 'texte technique', text: label, by: desc(el) });
    let yScrolls = false;
    for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
      const as = getComputedStyle(a);
      const clipX = as.overflowX !== 'visible';
      const clipY = !yScrolls && (as.overflowY === 'hidden' || as.overflowY === 'clip');
      if (clipX || clipY) {
        const ar = a.getBoundingClientRect();
        const left = ar.left + a.clientLeft;
        const top = ar.top + a.clientTop;
        const right = left + a.clientWidth;
        const bottom = top + a.clientHeight;
        for (const r of rects) {
          if (clipX && (r.left < left - 0.5 || r.right > right + 0.5)) {
            issues.push({ type: 'coupé (largeur)', text: label, by: desc(a), px: Math.round(Math.max(left - r.left, r.right - right)) });
            break;
          }
          if (clipY && (r.top < top - 0.5 || r.bottom > bottom + 0.5)) {
            issues.push({ type: 'coupé (hauteur)', text: label, by: desc(a), px: Math.round(Math.max(top - r.top, r.bottom - bottom)) });
            break;
          }
        }
      }
      if (as.overflowY === 'auto' || as.overflowY === 'scroll') yScrolls = true;
    }
    for (const r of rects) {
      if (r.right > vw + 0.5 || r.left < -0.5) {
        issues.push({ type: 'hors fenêtre', text: label, by: desc(el), px: Math.round(Math.max(r.right - vw, -r.left)) });
        break;
      }
    }
    if (st.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) issues.push({ type: 'points de suspension', text: label, by: desc(el) });
    // mot court coupé en plein milieu (ex. "F/E/D" sur 3 lignes) : seul un mot très long peut l'être
    const re = /\\S+/g;
    let m;
    while ((m = re.exec(n.textContent))) {
      if (m[0].length > 16) continue;
      const wr = document.createRange();
      wr.setStart(n, m.index);
      wr.setEnd(n, m.index + m[0].length);
      const tops = [...wr.getClientRects()].filter((r) => r.width > 0.5).map((r) => Math.round(r.top));
      if (new Set(tops).size > 1) {
        issues.push({ type: 'mot coupé', text: m[0] + ' (' + label + ')', by: desc(el) });
        break;
      }
    }
    for (const r of rects) texts.push({ r, el, label });
  }
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i];
      const b = texts[j];
      if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const ix = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const iy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (ix > 2 && iy > 3) issues.push({ type: 'chevauchement', text: a.label + ' ⟷ ' + b.label, by: desc(a.el) + ' / ' + desc(b.el) });
    }
  }
  if (document.documentElement.scrollWidth > vw + 1) issues.push({ type: 'défilement horizontal', text: '', by: 'document', px: document.documentElement.scrollWidth - vw });
  const seen = new Set();
  const unique = issues.filter((x) => {
    const k = x.type + x.text + x.by;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { issues: unique, count: texts.length };
})()`;

/** Nombre de textes vérifiés par rendu : un rendu vide est une erreur (page cassée). */
async function runCheckFn(win) {
  const r = await win.webContents.executeJavaScript(CHECK_FN);
  if (!r.count) r.issues.push({ type: 'rendu vide', text: '', by: 'page' });
  return r.issues;
}

const report = [];
function record(scenario, issues) {
  report.push({ scenario, issues });
  const tag = issues.length ? `✗ ${issues.length} problème(s)` : '✓';
  console.log(`${tag}  ${scenario}`);
  for (const i of issues.slice(0, 12)) console.log(`     - ${i.type}${i.px ? ` (${i.px}px)` : ''} : "${i.text}"  [${i.by}]`);
}

// ------------------------------------------------------------------ overlay

const heights = new Map();
// Détruire puis recréer une fenêtre fait échouer le chargement suivant sous un affichage virtuel :
// on garde les fenêtres ouvertes jusqu'à la fin.
const windows = [];
ipcMain.on('overlay:height', (e, h) => heights.set(e.sender.id, h));

let overlayWin = null;
async function overlayWindow() {
  if (overlayWin) return overlayWin;
  overlayWin = new BrowserWindow({
    width: 368,
    height: 1500,
    show: false,
    webPreferences: { preload: path.join(ROOT, 'src', 'preload.js'), contextIsolation: true, sandbox: true },
  });
  windows.push(overlayWin);
  await overlayWin.loadFile(path.join(ROOT, 'src', 'ui', 'overlay.html'), { query: { preview: '1' } });
  return overlayWin;
}

async function renderOverlay(vm, settings) {
  const win = await overlayWindow();
  win.webContents.send('overlay:settings', settings);
  win.webContents.send('overlay:update', vm);
  await wait(350);
  return win;
}

async function shootOverlay(name, vm, settings) {
  const win = await renderOverlay(vm, settings);
  const h = heights.get(win.webContents.id) || 700;
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 368, height: Math.min(1500, Math.ceil(h) + 28) });
  fs.writeFileSync(path.join(OUT, `${name}.png`), img.toPNG());
}

// ------------------------------------------------------------------ fenêtre principale

let dashState = null;
let dashChamps = [];
ipcMain.handle('app:getState', () => dashState);
ipcMain.handle('config:set', () => dashState);
ipcMain.handle('role:set', () => dashState);
ipcMain.handle('demo:set', () => dashState);
ipcMain.handle('runes:import', () => ({ ok: true, message: 'Aperçu : rien à importer.' }));
for (const ch of ['update:check', 'update:download', 'update:dismiss', 'whatsnew:dismiss']) ipcMain.handle(ch, () => dashState);
ipcMain.handle('update:install', () => ({ ok: true, message: 'Aperçu : rien à installer.' }));
ipcMain.handle('champions:list', () => dashChamps);

let dashWin = null;
async function dashboardWindow() {
  if (dashWin) return dashWin;
  // fenêtre visible (sur l'affichage virtuel) : une fenêtre cachée n'est pas repeinte après un clic
  dashWin = new BrowserWindow({
    width: 1180,
    height: 860,
    show: true,
    backgroundColor: '#0a0d14',
    webPreferences: { preload: path.join(ROOT, 'src', 'preload.js'), contextIsolation: true, sandbox: true },
  });
  windows.push(dashWin);
  return dashWin;
}

async function renderDashboard(state, champs, page, size) {
  dashState = state;
  dashChamps = champs;
  const win = await dashboardWindow();
  win.setContentSize(size[0], size[1]);
  await win.loadFile(path.join(ROOT, 'src', 'ui', 'dashboard.html'));
  await wait(450);
  await win.webContents.executeJavaScript(`document.querySelector('[data-page=${page}]').click()`);
  await wait(450);
  return win;
}

async function checkDashboardPage(win, name) {
  // on vérifie la page entière : chaque "écran" de défilement de la zone principale
  const total = await win.webContents.executeJavaScript('document.querySelector("main").scrollHeight');
  const view = await win.webContents.executeJavaScript('document.querySelector("main").clientHeight');
  const all = [];
  for (let y = 0; y < total; y += Math.max(200, view - 40)) {
    await win.webContents.executeJavaScript(`document.querySelector("main").scrollTop = ${y}`);
    await wait(60);
    all.push(...(await runCheckFn(win)));
  }
  await win.webContents.executeJavaScript('document.querySelector("main").scrollTop = 0');
  const seen = new Set();
  record(
    name,
    all.filter((x) => {
      const k = x.type + x.text + x.by;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }),
  );
}

// ------------------------------------------------------------------ scénarios

function dashboardScenarios(data) {
  const vms = S.overlayVms(data);
  const pref = { [String(103)]: 'UTILITY', [String(238)]: 'JUNGLE' };
  return {
    accueil: { page: 'home', state: S.dashboardState(data, { rolePrefs: pref }) },
    'accueil-maj-telechargement': { page: 'home', state: S.dashboardState(data, { update: 'downloading', whatsNew: true }) },
    'accueil-maj-prete': { page: 'home', state: S.dashboardState(data, { update: 'ready' }) },
    'accueil-maj-erreur': { page: 'home', state: S.dashboardState(data, { update: 'available-error' }) },
    'reglages-maj-prete': { page: 'settings', state: S.dashboardState(data, { update: 'ready' }) },
    'accueil-en-partie': { page: 'home', state: S.dashboardState(data, { live: { source: 'game', vm: vms['partie-faille'] }, phase: 'InProgress' }) },
    'direct-partie': { page: 'live', state: S.dashboardState(data, { live: { source: 'game', vm: vms['partie-faille'] }, phase: 'InProgress' }) },
    'direct-hors-poste': { page: 'live', state: S.dashboardState(data, { live: { source: 'game', vm: vms['partie-hors-poste'] }, phase: 'InProgress' }) },
    'direct-aram': { page: 'live', state: S.dashboardState(data, { live: { source: 'game', vm: vms['partie-aram'] }, phase: 'InProgress' }) },
    'direct-arena': { page: 'live', state: S.dashboardState(data, { live: { source: 'game', vm: vms['partie-arena'] }, phase: 'InProgress' }) },
    'direct-selection': { page: 'live', state: S.dashboardState(data, { live: { source: 'champselect', vm: vms['selection-appliquee'] }, phase: 'ChampSelect' }) },
    'direct-selection-aram': { page: 'live', state: S.dashboardState(data, { live: { source: 'champselect', vm: vms['selection-aram'] }, phase: 'ChampSelect' }) },
    'direct-vide': { page: 'live', state: S.dashboardState(data, {}) },
    champions: { page: 'champs', state: S.dashboardState(data, { rolePrefs: pref }) },
    overlay: { page: 'overlay', state: S.dashboardState(data, {}) },
    reglages: { page: 'settings', state: S.dashboardState(data, {}) },
  };
}

/** Le détecteur doit repérer un texte tronqué volontairement (sinon il ne vérifie rien). */
async function selfTest() {
  const data = S.makeData({ lang: 'fr', extreme: true });
  const win = await renderOverlay(S.overlayVms(data)['partie-faille'], S.overlaySettings());
  const css = await win.webContents.insertCSS(
    '.iname, .champ { white-space: nowrap !important; overflow: hidden !important; text-overflow: ellipsis !important; }' +
      '.fedtag { white-space: normal !important; overflow-wrap: anywhere !important; width: 9px !important; }',
  );
  await win.webContents.executeJavaScript("document.querySelector('.sec').append(document.createTextNode('null'))");
  await wait(150);
  const issues = await runCheckFn(win);
  await win.webContents.removeInsertedCSS(css);
  if (!issues.some((i) => i.type === 'texte technique')) throw new Error('Auto-test du détecteur échoué : un « null » affiché n’a pas été détecté.');
  if (!issues.some((i) => i.type === 'points de suspension' || i.type.startsWith('coupé'))) {
    throw new Error('Auto-test du détecteur échoué : un texte tronqué exprès n’a pas été détecté.');
  }
  if (!issues.some((i) => i.type === 'mot coupé')) throw new Error('Auto-test du détecteur échoué : un mot coupé exprès n’a pas été détecté.');
  console.log(`Auto-test du détecteur : OK (${issues.length} problème(s) volontaires repérés)\n`);
}

const APPEARANCES = [
  ['light', 'cyan'],
  ['dark', 'classic'],
  ['light', 'classic'],
  ['dark', 'purple'],
];

function themedScenarios(data, appearance) {
  const vms = S.overlayVms(data);
  return {
    accueil: { page: 'home', state: S.dashboardState(data, { appearance, update: 'ready' }) },
    direct: { page: 'live', state: S.dashboardState(data, { appearance, live: { source: 'game', vm: vms['partie-faille'] }, phase: 'InProgress' }) },
    reglages: { page: 'settings', state: S.dashboardState(data, { appearance }) },
  };
}

async function runCheck() {
  await selfTest();
  for (const L of S.LANGS) {
    const data = S.makeData(L);
    const vms = S.overlayVms(data);
    for (const [name, vm] of Object.entries(vms)) {
      for (const compact of [false, true]) {
        const win = await renderOverlay(vm, S.overlaySettings({ compact }));
        record(`overlay ${L.id} ${name}${compact ? ' (compact)' : ''}`, await runCheckFn(win));
      }
    }
    const move = messageVM("Position de l'overlay", "Il s'affichera ici pendant la sélection des champions et en partie.");
    const win = await renderOverlay(move, S.overlaySettings({ moveMode: true }));
    record(`overlay ${L.id} déplacement`, await runCheckFn(win));

    const champs = S.championsList(data);
    for (const [name, sc] of Object.entries(dashboardScenarios(data))) {
      for (const size of [
        [760, 560],
        [1180, 860],
      ]) {
        const w = await renderDashboard(sc.state, champs, sc.page, size);
        await checkDashboardPage(w, `fenêtre ${L.id} ${name} ${size.join('×')}`);
      }
    }
  }
  // thèmes : clair, classique sombre et clair (mise en page identique attendue)
  const data = S.makeData({ lang: 'fr' });
  const vms = S.overlayVms(data);
  const champs = S.championsList(data);
  for (const [theme, accent] of APPEARANCES) {
    nativeTheme.themeSource = theme;
    for (const name of ['partie-faille', 'selection-appliquee']) {
      const win = await renderOverlay(vms[name], S.overlaySettings({ accent }));
      record(`overlay ${theme}/${accent} ${name}`, await runCheckFn(win));
    }
    for (const [name, sc] of Object.entries(themedScenarios(data, { theme, accent }))) {
      const w = await renderDashboard(sc.state, champs, sc.page, [1180, 860]);
      await checkDashboardPage(w, `fenêtre ${theme}/${accent} ${name}`);
    }
  }
  nativeTheme.themeSource = 'dark';
  const bad = report.filter((r) => r.issues.length);
  console.log(`\n${report.length} rendus vérifiés, ${bad.length} avec des problèmes.`);
  if (OUT) fs.writeFileSync(path.join(OUT, 'layout-report.json'), JSON.stringify(report, null, 2));
  if (bad.length) process.exitCode = 1;
}

async function runShots() {
  const data = S.makeData({ lang: 'fr' });
  const vms = S.overlayVms(data);
  const base = S.overlaySettings();
  const shots = {
    'overlay-partie': ['partie-faille', base],
    'overlay-compact': ['partie-faille', { ...base, compact: true }],
    'overlay-hors-poste': ['partie-hors-poste', base],
    'overlay-aram': ['partie-aram', base],
    'overlay-arena': ['partie-arena', base],
    'overlay-selection': ['selection-faille', base],
    'overlay-selection-runes': ['selection-appliquee', base],
    'overlay-selection-aram': ['selection-aram', base],
    'overlay-sans-donnees': ['partie-sans-donnees', base],
  };
  for (const [file, [name, settings]] of Object.entries(shots)) await shootOverlay(file, vms[name], settings);
  const en = S.makeData({ lang: 'en' });
  await shootOverlay('overlay-partie-en', S.overlayVms(en)['partie-faille'], base);
  const xl = S.makeData({ lang: 'fr', extreme: true });
  await shootOverlay('overlay-noms-extremes', S.overlayVms(xl)['partie-faille'], base);

  const champs = S.championsList(data);
  const scen = dashboardScenarios(data);
  for (const name of ['accueil-en-partie', 'accueil-maj-prete', 'accueil-maj-telechargement', 'direct-partie', 'direct-selection', 'direct-aram', 'champions', 'reglages']) {
    const w = await renderDashboard(scen[name].state, champs, scen[name].page, [1180, 860]);
    fs.writeFileSync(path.join(OUT, `fenetre-${name}.png`), (await w.webContents.capturePage()).toPNG());
  }
  for (const [theme, accent] of APPEARANCES) {
    nativeTheme.themeSource = theme;
    const t = themedScenarios(data, { theme, accent });
    for (const name of ['direct', 'reglages']) {
      const w = await renderDashboard(t[name].state, champs, t[name].page, [1180, 860]);
      fs.writeFileSync(path.join(OUT, `theme-${theme}-${accent}-${name}.png`), (await w.webContents.capturePage()).toPNG());
    }
    await shootOverlay(`theme-${theme}-${accent}-overlay`, vms['partie-faille'], { ...base, accent });
  }
  nativeTheme.themeSource = 'dark';
  const w = await renderDashboard(scen['direct-partie'].state, champs, 'live', [760, 560]);
  fs.writeFileSync(path.join(OUT, 'fenetre-direct-petite.png'), (await w.webContents.capturePage()).toPNG());
  console.log(`Captures dans ${OUT}`);
}

app.whenReady().then(async () => {
  try {
    protocol.handle('bsicon', async (request) => {
      if (!ICONS) return new Response(null, { status: 404 });
      const rel = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '');
      try {
        const buf = fs.readFileSync(path.join(ICONS, ...rel.split('/')));
        return new Response(buf, { headers: { 'content-type': 'image/png' } });
      } catch {
        return new Response(null, { status: 404 });
      }
    });
    if (OUT) fs.mkdirSync(OUT, { recursive: true });
    if (CHECK) await runCheck();
    if (OUT && !CHECK) await runShots();
    if (!CHECK && !OUT) console.log('Préciser --check et/ou --out=dossier');
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  }
  app.exit(process.exitCode || 0);
});
