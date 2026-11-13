'use strict';

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, nativeImage, screen, shell, protocol, net, nativeTheme } = require('electron');

const { Config, DEFAULTS } = require('./core/config');
const { DDragon, DD_LANGUAGES, ddLanguage } = require('./core/ddragon');
const { Store } = require('./core/store');
const { RiotApi, PLATFORMS } = require('./core/riotApi');
const { Crawler } = require('./core/crawler');
const { Recommender } = require('./core/recommender');
const { fetchAllGameData, normalizeLive } = require('./core/liveClient');
const { LcuClient, parseChampSelect } = require('./core/lcu');
const { computeIngame, computeChampSelect, normRole, ROLE_IDS } = require('./core/engine');
const { messageVM, hotkeyLabel } = require('./core/viewModels');
const { ROLE_LABELS } = require('./core/util');
const { IconCache, DEFAULT_REMOTE } = require('./core/iconCache');
const { detectMode, FAMILY_IDS } = require('./core/modes');
const { Updater, compareVersions } = require('./core/updater');
const { buildsView: pageBuilds, metaView: pageMeta, buildDetailView } = require('./core/pageViews');
const { Pros } = require('./core/pros');
const { spawn } = require('child_process');
const gameWindow = require('./core/gameWindow');
const { GameCoach } = require('./core/coach');
const { KeyWatch } = require('./core/keywatch');

const OVERLAY_WIDTH = 340;
const ROOT = path.join(__dirname, '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
// tests de bout en bout : mise à jour simulée (rien n'est lancé)
const UPDATE_DRYRUN = process.env.BUILDSENSE_UPDATE_DRYRUN === '1';
const UPDATE_CHECK_EVERY = 4 * 3600 * 1000;
const LINKS = {
  portal: 'https://developer.riotgames.com/',
  policies: 'https://developer.riotgames.com/policies/general',
};

const S = {
  config: null,
  dd: null,
  ddError: null,
  store: null,
  api: null,
  crawler: null,
  rec: null,
  lcu: null,
  mainWin: null,
  overlayWin: null,
  tray: null,
  quitting: false,
  live: { inGame: false, vm: null, unsupported: null, mode: null, game: null },
  champSelect: { active: false, vm: null, import: null, cs: null },
  // poste choisi pour la partie en cours (raccourci ou accueil) : { champKey, role }
  roleOverride: null,
  // application automatique des runes pendant la sélection
  autoRunes: { key: null, pendingKey: null, applied: null, busy: false, status: null },
  clientPhase: null,
  clientQueue: null,
  clientLocale: null,
  activeFamily: null,
  ddLoading: Promise.resolve(),
  demo: null,
  demoVm: null,
  userHidden: false,
  moveMode: false,
  lastVm: null,
  lastVmJson: '',
  hotkeyErrors: [],
  lastStatePush: 0,
  statePushTimer: null,
  icons: null,
  iconStatus: { done: 0, total: 0 },
  updater: null,
  autoDownloadTried: null,
  whatsNew: null,
};

// Icônes servies par l'appli elle-même (cache disque + téléchargement depuis Data Dragon).
// Doit être déclaré avant que l'appli soit prête.
protocol.registerSchemesAsPrivileged([
  { scheme: 'bsicon', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// ---------------------------------------------------------------- démarrage

// développement : dossier de données séparé (une version installée peut tourner en même temps)
if (process.env.BUILDSENSE_USERDATA) app.setPath('userData', process.env.BUILDSENSE_USERDATA);
const T0 = Date.now();

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showMain());
  app.whenReady().then(init);
  app.on('window-all-closed', () => {
    /* reste dans la zone de notification */
  });
  app.on('before-quit', () => {
    S.quitting = true;
    if (S.store) S.store.saveSeen();
  });
  app.on('will-quit', () => globalShortcut.unregisterAll());
}

async function init() {
  if (process.platform === 'win32') app.setAppUserModelId('BuildSense');
  const userData = app.getPath('userData');
  S.config = new Config(userData);
  S.dd = new DDragon({ cacheDir: path.join(userData, 'cache'), language: effectiveLanguage() });
  // les données (plusieurs dizaines de Mo) se chargent en fond : la fenêtre s'affiche tout de suite
  S.store = new Store(path.join(userData, 'data'));
  S.rec = new Recommender({ store: S.store, dd: S.dd });
  S.api = new RiotApi({
    getKey: () => S.config.get('apiKey'),
    getPlatform: () => S.config.get('platform'),
    limits: S.config.get('rateLimits'),
  });
  S.crawler = new Crawler({
    api: S.api,
    store: S.store,
    dd: S.dd,
    getConfig: () => S.config.get(),
    // le mode auquel tu joues est collecté en priorité
    getActiveFamily: () => S.activeFamily,
  });
  S.crawler.on('status', () => pushStateSoon());
  S.followStatus = {};
  S.crawler.on('followed', ({ id, found }) => {
    S.followStatus[id] = found;
    pushStateSoon();
  });
  S.store.on('change', () => pushStateSoon());
  const lp = gameWindow.detectLeaguePath(S.config.get('leaguePath'));
  if (lp !== S.config.get('leaguePath')) S.config.set({ leaguePath: lp });
  S.lcu = new LcuClient({ getLeaguePath: () => S.config.get('leaguePath') });
  setupIcons(userData);
  setupUpdater(userData);
  S.coach = new GameCoach();
  S.pros = new Pros({ cacheFile: path.join(userData, 'cache', 'pros.json'), fetchImpl: (url, opts) => net.fetch(url, opts) });
  setTimeout(() => S.pros.refresh(), 8000);
  S.lastGameFile = path.join(userData, 'last-game.json');
  try {
    S.lastGame = JSON.parse(fs.readFileSync(S.lastGameFile, 'utf8'));
  } catch {
    S.lastGame = null;
  }
  nativeTheme.themeSource = THEMES[S.config.get('appearance').theme] || 'dark';

  createMainWindow();
  createOverlay();
  createTray();
  setupKeyWatch();
  registerHotkeys();
  registerIpc();

  loadDDragon();
  S.store.loadAsync().then(() => {
    S.rec.profiles.clear();
    startCrawlerIfPossible();
    pushState();
  });
  displayTick();
  liveTick();
  lcuTick();
  overlayOnTopTick();
  // nouveau patch pendant que l'appli tourne : on recharge les données du jeu
  setInterval(refreshDDragon, 6 * 3600 * 1000);
}

// ---------------------------------------------------------------- mises à jour

const REPO_RE = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;

/** Dépôt GitHub des versions : réglage de l'utilisateur, sinon celui de package.json. */
function updateRepo() {
  const r = S.config.get('updateRepo') || (PKG.buildsense && PKG.buildsense.repo) || '';
  return REPO_RE.test(r) ? r : '';
}

/**
 * Adresse du fichier latest.json.
 *  - stable : la dernière version publiée (GitHub "latest", promue chaque jour à 9 h) ;
 *  - bêta : la release "beta" du dépôt, mise à jour dès qu'une bêta est publiée.
 */
function updateFeed(channel = S.config.get('updateChannel')) {
  const custom = S.config.get('updateFeed');
  if (custom) return custom;
  const repo = updateRepo();
  if (!repo) return null;
  return channel === 'beta'
    ? `https://github.com/${repo}/releases/download/beta/latest.json`
    : `https://github.com/${repo}/releases/latest/download/latest.json`;
}

/** Canal bêta : on regarde aussi la version stable (si elle est plus récente, on la prend). */
function extraFeeds() {
  return S.config.get('updateChannel') === 'beta' && !S.config.get('updateFeed') ? [updateFeed('stable')] : [];
}

/** Nom affiché de la version : "PG-AAAAMMJJ-bN" pour une bêta, sinon le numéro. */
function versionLabel() {
  const b = PKG.buildsense || {};
  return b.channel === 'beta' && b.betaName ? `${b.betaName} (${PKG.version})` : PKG.version;
}

function setupUpdater(userData) {
  const current = PKG.version;
  // passage d'une 1.6.x au canal bêta : l'adresse avait été forcée à la main ; le canal la remplace
  const forced = S.config.get('updateFeed');
  const repo = updateRepo();
  if (forced && repo && forced === `https://github.com/${repo}/releases/download/beta/latest.json`) S.config.set({ updateFeed: null, updateChannel: 'beta' });
  else if (forced && repo && forced === `https://github.com/${repo}/releases/latest/download/latest.json`) S.config.set({ updateFeed: null, updateChannel: 'stable' });
  S.updater = new Updater({
    currentVersion: current,
    feedUrl: updateFeed(),
    fetchImpl: (url, opts) => net.fetch(url, opts),
    downloadDir: path.join(userData, 'updates'),
  });
  S.updater.setExtraFeeds(extraFeeds());
  S.updater.cleanup();
  let trayStatus = null;
  S.updater.on('change', (st) => {
    pushStateSoon();
    if (st.status !== trayStatus) {
      trayStatus = st.status;
      buildTrayMenu();
      if (st.status === 'ready') toast(`BuildSense ${st.latest} est prête : redémarre pour l'installer.`, 'ok');
    }
    maybeAutoDownload();
  });

  // première ouverture après une mise à jour : "quoi de neuf"
  const last = S.config.get('lastVersion');
  if (last && compareVersions(current, last) > 0) {
    let notes = [];
    try {
      const saved = JSON.parse(fs.readFileSync(path.join(userData, 'updates', 'notes.json'), 'utf8'));
      if (saved.version === current && Array.isArray(saved.notes)) notes = saved.notes;
    } catch {
      notes = [];
    }
    S.whatsNew = { version: current, previous: last, notes };
  }
  if (last !== current) S.config.set({ lastVersion: current });

  setTimeout(checkUpdates, 15000);
  setInterval(checkUpdates, UPDATE_CHECK_EVERY);
}

async function checkUpdates() {
  if (!S.updater) return null;
  S.autoDownloadTried = null;
  const st = await S.updater.check();
  maybeAutoDownload();
  return st;
}

const playing = () => S.live.inGame || S.champSelect.active;

/** Téléchargement en fond, jamais pendant une sélection ou une partie. */
function maybeAutoDownload() {
  const u = S.updater;
  if (!u || !S.config.get('autoUpdate') || playing()) return;
  const st = u.status();
  if (st.status !== 'available' || S.autoDownloadTried === st.latest) return;
  S.autoDownloadTried = st.latest; // une tentative par vérification (pas de boucle en cas d'erreur)
  u.download();
}

/** Lance l'installeur en silencieux puis quitte : il remplace l'appli et la relance. */
function installUpdate() {
  if (!S.updater) return { ok: false, message: 'Mises à jour indisponibles.' };
  if (playing()) return { ok: false, message: 'La mise à jour s’installera après ta partie.' };
  const cmd = S.updater.installCommand();
  if (!cmd) return { ok: false, message: 'Aucune mise à jour prête.' };
  const st = S.updater.status();
  try {
    fs.writeFileSync(path.join(path.dirname(cmd.file), 'notes.json'), JSON.stringify({ version: st.latest, notes: st.notes }));
  } catch {
    /* facultatif */
  }
  if (UPDATE_DRYRUN || process.platform !== 'win32') {
    const message = UPDATE_DRYRUN ? `Simulation : ${path.basename(cmd.file)} ${cmd.args.join(' ')}` : 'L’installation automatique ne fonctionne que sous Windows.';
    console.log('[update]', message);
    return { ok: UPDATE_DRYRUN, message, dryRun: true };
  }
  if (S.store) S.store.saveSeen();
  const child = spawn(cmd.file, cmd.args, { detached: true, stdio: 'ignore' });
  child.unref();
  S.quitting = true;
  setTimeout(() => app.quit(), 300);
  return { ok: true, message: 'Installation de la mise à jour…' };
}

function setupIcons(userData) {
  S.icons = new IconCache({
    dir: path.join(userData, 'cache', 'icons'),
    // BUILDSENSE_DDRAGON : serveur d'icônes de test (développement uniquement)
    remoteBase: process.env.BUILDSENSE_DDRAGON || DEFAULT_REMOTE,
    fetchImpl: (url) => net.fetch(url),
  });
  S.dd.iconBase = 'bsicon://dd';
  protocol.handle('bsicon', async (request) => {
    let rel = '';
    try {
      const u = new URL(request.url);
      if (u.hostname !== 'dd') return new Response(null, { status: 404 });
      rel = decodeURIComponent(u.pathname);
    } catch {
      return new Response(null, { status: 400 });
    }
    const buf = await S.icons.get(rel);
    if (!buf) return new Response(null, { status: 404 });
    return new Response(buf, { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=604800' } });
  });
}

/** Précharge toutes les icônes du patch (une seule fois par patch), puis nettoie les anciens patchs. */
async function prefetchIcons() {
  if (!S.dd.ready || !S.icons) return;
  const rels = S.dd.allIconPaths();
  S.iconStatus = { done: 0, total: 0, running: true };
  const res = await S.icons.prefetch(rels, {
    onProgress: (done, total) => {
      S.iconStatus = { done, total, running: true };
      pushStateSoon();
    },
  });
  S.iconStatus = { done: res.attempted, total: res.attempted, failed: res.attempted - res.downloaded, running: false };
  S.icons.pruneVersions(2);
  pushStateSoon();
}

/** Langue des noms : réglage manuel, sinon celle du client LoL (dernière connue), sinon français. */
function effectiveLanguage() {
  const lang = S.config.get('language');
  if (lang && lang !== 'auto') return DD_LANGUAGES.includes(lang) ? lang : 'fr_FR';
  const locale = S.clientLocale || S.config.get('detectedLocale');
  return locale ? ddLanguage(locale) : 'fr_FR';
}

/** Les chargements de Data Dragon passent l'un après l'autre (démarrage, patch, langue). */
function ddTask(fn) {
  const p = S.ddLoading.then(fn, fn);
  S.ddLoading = p.catch(() => {});
  return p;
}

function resetCaches() {
  S.rec.profiles.clear();
  S.rec.featCache.clear();
  S.rec.seqCache = new WeakMap();
  S.lastVmJson = '';
  if (S.demo) setDemo(S.demo);
}

async function refreshDDragon() {
  if (!S.dd.ready) return;
  await ddTask(async () => {
    const before = S.dd.version;
    try {
      await S.dd.load();
      if (S.dd.version !== before) {
        resetCaches();
        pushState();
        prefetchIcons();
      }
    } catch {
      /* on garde les données actuelles */
    }
  });
}

/** Change la langue des noms (objets, champions, runes) et recharge les données du jeu. */
async function applyLanguage() {
  const lang = effectiveLanguage();
  if (!S.dd.ready || S.dd.language === lang) return;
  await ddTask(async () => {
    const previous = S.dd.language;
    if (previous === lang) return;
    S.dd.language = lang;
    try {
      await S.dd.load();
      resetCaches();
    } catch {
      S.dd.language = previous; // hors ligne et pas de cache dans cette langue
    }
    pushState();
  });
}

async function loadDDragon() {
  // démarrage instantané depuis le cache ; la vérification du patch en ligne suit en fond
  if (!S.dd.ready) {
    S.dd.language = effectiveLanguage();
    if (S.dd.loadCached()) {
      S.ddError = null;
      startCrawlerIfPossible();
      pushState();
      setTimeout(async () => {
        await refreshDDragon();
        prefetchIcons();
      }, 2500);
      return;
    }
  }
  await ddTask(async () => {
    try {
      S.dd.language = effectiveLanguage();
      await S.dd.load();
      S.ddError = null;
      startCrawlerIfPossible();
      prefetchIcons();
    } catch (e) {
      S.ddError = e.message;
      setTimeout(loadDDragon, 30000);
    }
  });
  pushState();
}

function startCrawlerIfPossible() {
  if (S.dd.ready && S.store.loaded && S.config.get('apiKey') && S.config.get('crawlerEnabled')) S.crawler.start();
}

// ---------------------------------------------------------------- fenêtres

function createMainWindow() {
  S.mainWin = new BrowserWindow({
    width: 980,
    height: 760,
    minWidth: 760,
    minHeight: 560,
    title: 'BuildSense',
    icon: path.join(ROOT, 'assets', 'icon.png'),
    backgroundColor: windowBackground(),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  S.mainWin.loadFile(path.join(__dirname, 'ui', 'dashboard.html'));
  S.mainWin.webContents.once('did-finish-load', () => {
    if (process.env.BUILDSENSE_TIMING) console.log(`[timing] fenêtre affichée en ${Date.now() - T0} ms`);
    if (process.env.BUILDSENSE_SHOTS) devShots(process.env.BUILDSENSE_SHOTS);
  });
  S.mainWin.on('show', () => {
    if (S.stateDirty) pushState(true);
  });
  S.mainWin.on('close', (e) => {
    if (!S.quitting) {
      e.preventDefault();
      S.mainWin.hide();
    }
  });
}

/** Développement : captures des pages principales (BUILDSENSE_SHOTS=dossier). */
async function devShots(dir) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  fs.mkdirSync(dir, { recursive: true });
  const w = S.mainWin;
  const shot = async (name) => {
    const img = await w.webContents.capturePage();
    fs.writeFileSync(path.join(dir, `${name}.png`), img.toPNG());
  };
  const js = (code) => w.webContents.executeJavaScript(code);
  await wait(4000);
  while (!S.store.loaded) await wait(300);
  if (process.env.BUILDSENSE_TIMING) console.log(`[timing] données chargées en ${Date.now() - T0} ms`);
  await shot('home');
  setDemo('ingame');
  await wait(800);
  await js("document.querySelector('[data-page=live]').click()");
  await wait(800);
  await shot('live');
  await js("document.querySelector('main').scrollTop = 99999");
  await wait(300);
  await shot('live-coach');
  await js("document.querySelector('.co-res .btn:last-child') && document.querySelector('.co-res .btn:last-child').click()");
  await wait(300);
  await shot('live-coach-guide');
  setDemo(null);
  await js("document.querySelector('[data-page=builds]').click()");
  await wait(1500);
  await js("(() => { const s = document.querySelector('#bChamp'); s.value = '98'; s.dispatchEvent(new Event('change')); })()");
  await wait(1200);
  await js("document.querySelector('.b-click') && document.querySelector('.b-click').click()");
  await wait(1200);
  await shot('builds-detail');
  await js("document.querySelector('main').scrollTop = 600");
  await wait(300);
  await shot('builds-detail-2');
  await js("document.querySelector('#bMode [data-family=aram]').click()");
  await wait(1200);
  await shot('builds-aram');
  await js("document.querySelector('[data-page=meta]').click()");
  await wait(800);
  await js("document.querySelector('#mTier [data-tier=low]').click()");
  await wait(800);
  await shot('meta-low');
  await js("document.querySelector('[data-page=overlay]').click()");
  await wait(600);
  await shot('overlay');
  await js("document.querySelector('[data-page=settings]').click()");
  await wait(600);
  await js("document.querySelector('#updatesBox').scrollIntoView()");
  await wait(300);
  await shot('settings-updates');
  console.log('[shots] ok');
  S.quitting = true;
  app.quit();
}

function showMain() {
  if (!S.mainWin) return;
  if (S.mainWin.isMinimized()) S.mainWin.restore();
  S.mainWin.show();
  S.mainWin.focus();
}

function overlayScale() {
  return Math.min(1.4, Math.max(0.8, S.config.get('overlay').scale || 1));
}

function insideSomeDisplay(x, y) {
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return x >= a.x - 40 && x < a.x + a.width - 40 && y >= a.y - 40 && y < a.y + a.height - 40;
  });
}

function overlayPosition() {
  const o = S.config.get('overlay');
  if (Number.isFinite(o.x) && Number.isFinite(o.y) && insideSomeDisplay(o.x, o.y)) return { x: o.x, y: o.y };
  const wa = screen.getPrimaryDisplay().workArea;
  return { x: wa.x + wa.width - Math.round(OVERLAY_WIDTH * overlayScale()) - 16, y: wa.y + 150 };
}

function createOverlay() {
  const pos = overlayPosition();
  const win = new BrowserWindow({
    width: Math.round(OVERLAY_WIDTH * overlayScale()),
    height: 120,
    x: pos.x,
    y: pos.y,
    transparent: true,
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    show: false,
    backgroundColor: '#00000000',
    title: 'BuildSense overlay',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true);
  if (win.setVisibleOnAllWorkspaces) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, 'ui', 'overlay.html'));
  win.webContents.on('did-finish-load', () => {
    win.webContents.setZoomFactor(overlayScale());
    pushOverlaySettings();
    if (S.lastVm) win.webContents.send('overlay:update', S.lastVm);
  });
  win.on('closed', () => (S.overlayWin = null));
  S.overlayWin = win;
}

function keepOverlayOnTop() {
  const w = S.overlayWin;
  if (w && w.isVisible()) {
    // niveau le plus haut (au-dessus du jeu en sans bordure et en plein écran optimisé par Windows)
    w.setAlwaysOnTop(true, 'screen-saver', 1);
    w.moveTop();
  }
}

/** En partie, le jeu (fenêtré sans bordure) peut repasser devant : on réaffirme souvent. */
function overlayOnTopTick() {
  const inGame = S.live.inGame || S.champSelect.active || !!S.demo;
  const boost = Date.now() < (S.onTopBoostUntil || 0);
  if (inGame) keepOverlayOnTop();
  // plein écran : le jeu reprend le premier plan plus souvent, on réaffirme plus vite
  const fast = boost || (S.display && S.display.windowMode === 'fullscreen' && S.live.inGame);
  setTimeout(overlayOnTopTick, fast ? 500 : inGame ? 1000 : 4000);
}

function createTray() {
  const img = nativeImage.createFromPath(path.join(ROOT, 'assets', 'tray.png'));
  S.tray = new Tray(img);
  S.tray.setToolTip(`BuildSense ${versionLabel()}`);
  buildTrayMenu();
  S.tray.on('click', showMain);
}

function buildTrayMenu() {
  if (!S.tray) return;
  const hk = S.config.get('hotkeys');
  const u = S.updater ? S.updater.status() : null;
  const items = [
    { label: 'Ouvrir BuildSense', click: showMain },
    { label: `Afficher / masquer l'overlay (${hotkeyLabel(hk.toggle)})`, click: toggleHidden },
    { label: `Déplacer l'overlay (${hotkeyLabel(hk.move)})`, click: () => setMoveMode(!S.moveMode) },
  ];
  if (u && u.status === 'ready') {
    items.push({ type: 'separator' }, { label: `Redémarrer et mettre à jour (${u.latest})`, click: () => { const r = installUpdate(); if (!r.ok) toast(r.message, 'warn'); } });
  }
  items.push({ type: 'separator' }, { label: 'Quitter', click: () => app.quit() });
  S.tray.setContextMenu(Menu.buildFromTemplate(items));
}

// ---------------------------------------------------------------- overlay

function pushOverlaySettings() {
  const w = S.overlayWin;
  if (!w) return;
  const o = S.config.get('overlay');
  const hk = S.config.get('hotkeys');
  w.webContents.send('overlay:settings', {
    opacity: o.opacity,
    compact: !!o.compact,
    moveMode: S.moveMode,
    keys: { move: hotkeyLabel(hk.move), toggle: hotkeyLabel(hk.toggle), compact: hotkeyLabel(hk.compact) },
    accent: S.config.get('appearance').accent,
  });
}

const THEMES = { auto: 'system', light: 'light', dark: 'dark' };
const ACCENTS = ['cyan', 'red', 'green', 'yellow', 'orange', 'purple', 'blue', 'classic'];

/** Thème : Electron applique clair/sombre à toutes les fenêtres (prefers-color-scheme). */
function applyAppearance() {
  const a = S.config.get('appearance');
  nativeTheme.themeSource = THEMES[a.theme] || 'dark';
  if (S.mainWin) S.mainWin.setBackgroundColor(windowBackground());
  pushOverlaySettings();
}

function windowBackground() {
  const a = S.config.get('appearance');
  const light = nativeTheme.shouldUseDarkColors === false;
  if (a.accent === 'classic') return light ? '#efe6d3' : '#010a13';
  return light ? '#f3f5f9' : '#0a0d14';
}

function currentVm() {
  if (S.demo && S.demoVm) return S.demoVm;
  if (S.live.inGame && S.live.vm) return S.live.vm;
  if (S.champSelect.active && S.champSelect.vm) return S.champSelect.vm;
  if (S.moveMode) {
    return messageVM("Position de l'overlay", "Il s'affichera ici pendant la sélection des champions et en partie.");
  }
  return null;
}

function refreshOverlay() {
  const w = S.overlayWin;
  if (!w) return;
  const vm = currentVm();
  if (vm) {
    const json = JSON.stringify(vm);
    if (json !== S.lastVmJson) {
      S.lastVmJson = json;
      S.lastVm = vm;
      w.webContents.send('overlay:update', vm);
    }
  }
  const show = !!vm && (!S.userHidden || S.moveMode);
  if (show && !w.isVisible()) {
    w.showInactive();
    keepOverlayOnTop();
  }
  else if (!show && w.isVisible()) w.hide();
}

function toggleHidden() {
  S.userHidden = !S.userHidden;
  refreshOverlay();
  pushState();
}

function setMoveMode(on) {
  const w = S.overlayWin;
  S.moveMode = on;
  if (w) {
    w.setIgnoreMouseEvents(!on);
    w.setFocusable(on);
    if (!on) {
      const b = w.getBounds();
      S.config.set({ overlay: { x: b.x, y: b.y } });
    }
  }
  pushOverlaySettings();
  refreshOverlay();
  pushState();
}

function resizeOverlay(cssHeight) {
  const w = S.overlayWin;
  if (!w || !Number.isFinite(cssHeight)) return;
  const scale = overlayScale();
  const b = w.getBounds();
  const width = Math.round(OVERLAY_WIDTH * scale);
  const height = Math.max(40, Math.min(1400, Math.ceil(cssHeight * scale)));
  let { x, y } = b;
  if (!S.moveMode) {
    // l'overlay reste entièrement à l'écran (changement de taille, contenu plus long...)
    const wa = screen.getDisplayMatching(b).workArea;
    if (x + width > wa.x + wa.width) x = wa.x + wa.width - width - 8;
    if (x < wa.x) x = wa.x;
    if (y + height > wa.y + wa.height) y = Math.max(wa.y, wa.y + wa.height - height - 8);
  }
  if (b.width !== width || b.height !== height || b.x !== x || b.y !== y) w.setBounds({ x, y, width, height });
}

function toast(text, level = 'info') {
  if (S.overlayWin) S.overlayWin.webContents.send('overlay:toast', { text, level });
  if (S.mainWin) S.mainWin.webContents.send('toast', { text, level });
}

// ---------------------------------------------------------------- mode d'affichage du jeu

/** Plein écran / sans bordure / fenêtré, et optimisations plein écran de Windows (toutes les 20 s). */
async function displayTick() {
  try {
    const d = await gameWindow.displayInfo(S.config.get('leaguePath'));
    if (JSON.stringify(d) !== JSON.stringify(S.display)) {
      S.display = d;
      pushStateSoon();
    }
  } catch {
    /* non bloquant */
  }
  setTimeout(displayTick, 20000);
}

// ---------------------------------------------------------------- boucles

/** Choix de poste : celui de la partie en cours, puis les postes préférés par champion. */
function roleChoice() {
  return { override: S.roleOverride, prefs: S.config.get('rolePrefs') || {} };
}

/** Début de partie : l'overlay revient (même masqué à la partie précédente) et passe au premier plan. */
function onGameStart() {
  // pas de téléchargement de mise à jour pendant une partie (ping)
  if (S.updater && S.updater.status().status === 'downloading') {
    S.updater.cancel();
    S.autoDownloadTried = null;
  }
  S.userHidden = false;
  S.onTopBoostUntil = Date.now() + 60000;
  setTimeout(keepOverlayOnTop, 1500);
}

function computeLive(game, mode) {
  return computeIngame({
    dd: S.dd,
    store: S.store,
    rec: S.rec,
    game,
    hasKey: !!S.config.get('apiKey'),
    mode,
    roleChoice: roleChoice(),
    presets: S.config.get('buildPresets'),
  });
}

function computeCs(cs) {
  return computeChampSelect({
    dd: S.dd,
    store: S.store,
    rec: S.rec,
    cs,
    hasKey: !!S.config.get('apiKey'),
    importHotkey: S.config.get('hotkeys').importRunes,
    roleChoice: roleChoice(),
    presets: S.config.get('buildPresets'),
  });
}

/** Ajoute à la vue de sélection l'état des runes automatiques et le raccourci de changement de poste. */
function decorateChampSelect(vm) {
  if (!vm || vm.mode !== 'champselect') return vm;
  const hk = S.config.get('hotkeys');
  if (vm.roleInfo && vm.roleInfo.roles && hk.role) vm.roleHint = { key: hotkeyLabel(hk.role), text: 'changer de poste' };
  if (vm.page && S.config.get('autoRunes')) {
    vm.runes = S.autoRunes.status || { state: 'waiting', text: 'Runes appliquées automatiquement dès que tu verrouilles ton champion' };
  }
  return vm;
}

/** Recalcule tout de suite les vues (après un changement de poste ou de réglage). */
function recomputeViews() {
  if (S.live.inGame && S.live.game && S.live.mode && S.live.mode.supported) S.live.vm = computeLive(S.live.game, S.live.mode);
  if (S.champSelect.active && S.champSelect.cs) {
    S.champSelect.vm = decorateChampSelect(computeCs(S.champSelect.cs));
    S.champSelect.import = importOf(S.champSelect.vm);
  }
  if (S.demo) setDemo(S.demo, { keepOverride: true });
  refreshOverlay();
  pushState();
}

function importOf(vm) {
  if (!vm || !vm.page) return null;
  return { page: vm.page.importable, champion: vm.header.champion, role: vm.header.role || '', name: `${vm.header.champion} ${vm.header.role || ''}`.trim() };
}

/** Vue de la partie pour la page "En direct" de la fenêtre principale (null si rien en cours). */
function liveView() {
  if (S.demo && S.demoVm) return { source: 'demo', vm: S.demoVm };
  if (S.live.inGame) {
    if (S.live.vm) return { source: 'game', vm: S.live.vm };
    if (S.live.unsupported) return { source: 'game', vm: messageVM(S.live.unsupported, 'Ce mode n’a pas de boutique : rien à conseiller.') };
    return { source: 'game', vm: messageVM('Partie en cours', 'Chargement de la partie…') };
  }
  if (S.champSelect.active && S.champSelect.vm) return { source: 'champselect', vm: S.champSelect.vm };
  return null;
}

/** Vue affichée en ce moment (démo, partie ou sélection) et son poste. */
function currentRoleInfo() {
  const vm = (S.demo && S.demoVm) || (S.live.inGame && S.live.vm) || (S.champSelect.active && S.champSelect.vm) || null;
  return vm && vm.roleInfo ? { ...vm.roleInfo, champion: vm.header ? vm.header.champion : '' } : null;
}

/** Change le poste de la partie en cours ('' = automatique). */
function setRole(role, { announce = true } = {}) {
  const info = currentRoleInfo();
  if (!info) {
    if (announce) toast('Le poste se choisit pendant la sélection ou en partie.', 'warn');
    return { ok: false };
  }
  if (!info.roles) {
    if (announce) toast('Pas de poste dans ce mode : le build est celui du mode.', 'warn');
    return { ok: false };
  }
  const r = normRole(role);
  S.roleOverride = r ? { champKey: info.champKey, role: r } : null;
  recomputeViews();
  if (announce) {
    const now = currentRoleInfo();
    const label = ROLE_LABELS[now && now.role] || 'auto';
    toast(r ? `Poste : ${label} (pour cette partie)` : `Poste automatique : ${label}`, 'info');
  }
  return { ok: true };
}

/** Raccourci : poste suivant (Top → Jungle → Mid → Bot → Support → automatique). */
function cycleRole() {
  const info = currentRoleInfo();
  if (!info || !info.roles) return setRole('');
  if (info.source === 'manual' && info.role === ROLE_IDS[ROLE_IDS.length - 1]) return setRole('');
  const i = ROLE_IDS.indexOf(info.role);
  return setRole(ROLE_IDS[(i + 1) % ROLE_IDS.length]);
}

/**
 * Runes automatiques : une fois le champion verrouillé (et stable 2 lectures de suite),
 * la page recommandée remplace la page active. Si tu modifies la page ensuite,
 * BuildSense n'y touche plus (sauf si tu changes de champion ou de poste).
 */
async function autoApplyRunes(cs, vm) {
  const A = S.autoRunes;
  if (!S.config.get('autoRunes') || !cs || !cs.locked || !vm || !vm.page || A.busy) return;
  const perks = vm.page.importable.selectedPerkIds.join(',');
  const who = `${cs.myChampion ? cs.myChampion.key : 0}|${vm.roleInfo ? vm.roleInfo.role : ''}`;
  const key = `${who}|${perks}`;
  if (key === A.key) return;
  if (A.pendingKey !== key) {
    A.pendingKey = key; // on attend une 2e lecture identique (évite les changements en rafale)
    return;
  }
  A.busy = true;
  try {
    if (A.applied && A.applied.who === who) {
      // même champion et même poste : la page recommandée a changé (adversaire révélé...).
      // Si tu as retouché la page, on la laisse telle quelle.
      const cur = await S.lcu.currentPage();
      const curPerks = cur && Array.isArray(cur.selectedPerkIds) ? cur.selectedPerkIds.join(',') : '';
      if (cur && curPerks !== A.applied.perks) {
        A.key = key;
        A.status = { state: 'kept', text: 'Tu as modifié ta page : BuildSense n’y touche plus' };
        return;
      }
    }
    const imp = importOf(vm);
    const r = await S.lcu.importRunes(imp.page, imp.champion, imp.role);
    A.key = key;
    if (r.ok) {
      A.applied = { who, perks };
      A.status = { state: 'applied', text: `Runes appliquées : ${imp.name}${r.replaced ? ' (page active remplacée)' : ''}` };
      toast(A.status.text, 'ok');
    } else {
      A.status = { state: 'error', text: r.message };
      toast(r.message, 'warn');
    }
  } finally {
    A.busy = false;
  }
}

/** Page d'objets de la boutique : meilleur départ en tête, puis les autres départs, le build et les bottes. */
function itemSetOf(vm) {
  const s = vm.itemSet;
  if (!s || !s.starts.length) return null;
  const group = (ids) => {
    const m = new Map();
    for (const id of ids) m.set(id, (m.get(id) || 0) + 1);
    return [...m].map(([id, count]) => ({ id, count }));
  };
  const pct = (x) => `${Math.round(x * 100)} %`;
  const blocks = s.starts.map((st, i) => ({
    type: i === 0 ? `★ Meilleur départ · ${pct(st.share)} des parties` : `Autre départ · ${pct(st.share)}`,
    items: group(st.ids),
  }));
  if (s.core.length) blocks.push({ type: 'Build conseillé', items: s.core.map((id) => ({ id, count: 1 })) });
  if (s.boots) blocks.push({ type: 'Bottes', items: [{ id: s.boots, count: 1 }] });
  return { title: `BuildSense · ${vm.header.champion}${vm.header.role ? ` ${vm.header.role}` : ''}`, champKey: s.champKey, map: s.map, blocks };
}

/** Une fois le champion verrouillé (stable 2 lectures), écrit la page d'objets dans le client. */
async function autoApplyItemSet(cs, vm) {
  const A = S.autoItems || (S.autoItems = { key: null, pending: null, busy: false });
  if (!S.config.get('autoItemSet') || !cs || !cs.locked || !vm || A.busy) return;
  const set = itemSetOf(vm);
  if (!set) return;
  const key = JSON.stringify([set.title, set.blocks]);
  if (key === A.key) return;
  if (A.pending !== key) {
    A.pending = key;
    return;
  }
  A.busy = true;
  try {
    const r = await S.lcu.writeItemSet(set);
    A.key = key;
    if (!r.ok) console.warn('[items]', r.message);
  } finally {
    A.busy = false;
  }
}

async function liveTick() {
  let delay = 3000;
  try {
    const raw = await fetchAllGameData();
    if (raw && S.dd.ready) {
      const game = normalizeLive(raw, S.dd);
      if (!S.live.inGame) onGameStart();
      S.live.inGame = true;
      delay = 1000;
      if (!game) {
        S.live.vm = null; // chargement ou mode spectateur
      } else {
        // la file d'attente du client précise le mode (Classée, Swiftplay...) si elle correspond à la partie
        const q = S.clientQueue;
        const queueId = q && String(q.gameMode).toUpperCase() === String(game.gameMode).toUpperCase() ? q.id : 0;
        const mode = detectMode({ gameMode: game.gameMode, mapNumber: game.mapNumber, queueId });
        S.live.mode = mode;
        if (!mode.supported) {
          S.live.vm = null; // Swarm... : pas de boutique
          S.live.unsupported = mode.label;
        } else {
          S.live.unsupported = null;
          S.activeFamily = mode.family;
          S.live.game = game;
          S.live.vm = computeLive(game, mode);
          updateCoach(game, mode);
        }
      }
    } else {
      if (S.live.inGame) {
        S.roleOverride = null; // fin de partie : le choix de poste ne vaut que pour elle
        finishCoach();
      }
      S.live.inGame = false;
      S.live.vm = null;
      S.live.unsupported = null;
      S.live.mode = null;
      S.live.game = null;
    }
  } catch (e) {
    console.error('[live]', e);
  }
  S.crawler.setPausedForGame(S.live.inGame && !!S.config.get('pauseCrawlerInGame'));
  if (!S.live.inGame) maybeAutoDownload();
  refreshOverlay();
  pushStateSoon();
  setTimeout(liveTick, delay);
}

// ---------------------------------------------------------------- analyse de la partie (onglet En direct)

function coachContext(game, mode) {
  const vm = S.live.vm;
  const role = vm && vm.roleInfo ? vm.roleInfo.role : '';
  const family = mode ? mode.family : 'sr';
  const champ = game.me.champ;
  return { dd: S.dd, prof: champ ? S.rec.profile(champ.key, role, family) : null, role, champion: champ ? champ.name : '', family };
}

function updateCoach(game, mode) {
  if (!S.coach) return;
  S.coach.update(game, S.dd);
  S.coachMode = mode;
  // le rapport se recalcule toutes les 5 s (il change peu d'une seconde à l'autre)
  if (!S.coachAt || Date.now() - S.coachAt > 5000) {
    S.coachAt = Date.now();
    try {
      S.coachReport = S.coach.report(coachContext(game, mode));
    } catch (e) {
      console.error('[coach]', e);
    }
  }
}

/** Fin de partie : le dernier rapport devient « Ta dernière partie » (gardé sur le disque). */
function finishCoach() {
  if (!S.coach || !S.coach.last) return;
  try {
    const rep = S.coach.report({ ...coachContext(S.coach.last, S.coachMode), final: true });
    if (rep && rep.minutes >= 5) {
      rep.endedAt = Date.now();
      S.lastGame = rep;
      fs.writeFile(S.lastGameFile, JSON.stringify(rep), () => {});
    }
  } catch (e) {
    console.error('[coach]', e);
  }
  S.coach.reset();
  S.coachReport = null;
  S.coachAt = 0;
}

/** Langue du client LoL : lue une fois par session du client. */
async function readClientLocale() {
  if (S.clientLocale) return;
  const locale = await S.lcu.locale();
  if (!locale) return;
  S.clientLocale = locale;
  if (S.config.get('detectedLocale') !== locale) S.config.set({ detectedLocale: locale });
  if (S.config.get('language') === 'auto') applyLanguage();
}

async function lcuTick() {
  let delay = 6000;
  try {
    const phase = S.dd.ready ? await S.lcu.phase() : null;
    S.clientPhase = phase;
    if (!phase) {
      S.clientLocale = null;
      S.clientQueue = null;
    } else {
      await readClientLocale();
      S.clientQueue = phase === 'None' ? null : await S.lcu.queue();
      if (S.clientQueue) {
        const m = detectMode({ queueId: S.clientQueue.id, mapNumber: S.clientQueue.mapId, gameMode: S.clientQueue.gameMode });
        if (m.supported) S.activeFamily = m.family;
      }
    }
    // nouvelle sélection : on oublie le poste choisi et les runes de la partie précédente
    if (phase === 'ChampSelect' && S.prevPhase !== 'ChampSelect') {
      if (S.updater && S.updater.status().status === 'downloading') {
        S.updater.cancel();
        S.autoDownloadTried = null;
      }
      S.roleOverride = null;
      S.autoRunes = { key: null, pendingKey: null, applied: null, busy: false, status: null };
      S.autoItems = { key: null, pending: null, busy: false };
    }
    S.prevPhase = phase;
    if (S.config.get('lcuEnabled') && S.dd.ready) {
      if (phase === 'ChampSelect') {
        const cs = parseChampSelect(await S.lcu.session(), S.dd, S.clientQueue);
        S.champSelect.active = !!cs;
        S.champSelect.cs = cs;
        if (cs) {
          let vm = decorateChampSelect(computeCs(cs));
          await autoApplyRunes(cs, vm);
          await autoApplyItemSet(cs, vm);
          vm = decorateChampSelect(vm); // état des runes à jour
          S.champSelect.vm = vm;
          S.champSelect.import = importOf(vm);
        }
        delay = 1500;
      } else {
        S.champSelect = { active: false, vm: null, import: null, cs: null };
        delay = phase ? 3000 : 6000;
      }
    } else {
      S.champSelect = { active: false, vm: null, import: null, cs: null };
    }
  } catch (e) {
    console.error('[lcu]', e);
  }
  refreshOverlay();
  pushStateSoon();
  setTimeout(lcuTick, delay);
}

// ---------------------------------------------------------------- actions

// Aperçus : parties et sélections de démonstration (dossier demo/)
const DEMOS = {
  ingame: { file: 'allgamedata.json' },
  aram: { file: 'allgamedata-aram.json' },
  champselect: { file: 'champselect.json', queue: { id: 420, mapId: 11, gameMode: 'CLASSIC' } },
};

function setDemo(kind, { keepOverride = false } = {}) {
  if (!keepOverride) S.roleOverride = null;
  S.demo = DEMOS[kind] ? kind : null;
  S.demoVm = null;
  S.demoCoach = null;
  const hasKey = !!S.config.get('apiKey');
  if (S.demo && !S.dd.ready) {
    S.demoVm = messageVM('Démo indisponible', 'Les données du jeu (Data Dragon) ne sont pas encore chargées.');
  } else if (S.demo) {
    const demo = DEMOS[S.demo];
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'demo', demo.file), 'utf8'));
    if (demo.queue) {
      S.demoVm = decorateChampSelect(computeCs(parseChampSelect(raw, S.dd, demo.queue)));
      if (S.demoVm && S.demoVm.runes) S.demoVm.runes = { state: 'waiting', text: 'Démo : en vraie sélection, les runes sont appliquées automatiquement' };
    } else {
      const game = normalizeLive(raw, S.dd);
      S.demoVm = game ? computeLive(game, null) : messageVM('Démo', 'Partie de démo illisible.');
      if (game) {
        const c = new GameCoach();
        c.update(game, S.dd);
        const mode = detectMode({ gameMode: game.gameMode, mapNumber: game.mapNumber });
        const role = S.demoVm && S.demoVm.roleInfo ? S.demoVm.roleInfo.role : '';
        S.demoCoach = c.report({ dd: S.dd, prof: game.me.champ ? S.rec.profile(game.me.champ.key, role, mode.family) : null, role, champion: game.me.champ ? game.me.champ.name : '', family: mode.family });
      }
    }
  }
  if (S.demo) S.userHidden = false;
  refreshOverlay();
  pushState();
}

async function importRunes() {
  if (S.demo === 'champselect') {
    const r = { ok: true, message: 'Démo : import simulé, ta page de runes n’a pas été modifiée.' };
    toast(r.message, 'info');
    return r;
  }
  if (!S.champSelect.active || !S.champSelect.import) {
    const r = { ok: false, message: "Les runes s'importent pendant la sélection des champions." };
    toast(r.message, 'warn');
    return r;
  }
  const imp = S.champSelect.import;
  const r = await S.lcu.importRunes(imp.page, imp.champion, imp.role);
  if (r.ok) {
    // l'import manuel compte comme une application : la détection de retouche part de cette page
    const vm = S.champSelect.vm;
    const who = `${S.champSelect.cs && S.champSelect.cs.myChampion ? S.champSelect.cs.myChampion.key : 0}|${vm && vm.roleInfo ? vm.roleInfo.role : ''}`;
    const perks = imp.page.selectedPerkIds.join(',');
    S.autoRunes.applied = { who, perks };
    S.autoRunes.key = `${who}|${perks}`;
    S.autoRunes.status = { state: 'applied', text: `Runes appliquées : ${imp.name}${r.replaced ? ' (page active remplacée)' : ''}` };
    recomputeViews();
  }
  toast(r.ok ? `Runes appliquées : ${imp.name}` : r.message, r.ok ? 'ok' : 'warn');
  return r;
}

// ---------------------------------------------------------------- raccourcis modifiables

const HOTKEY_NAMES = ['toggle', 'move', 'compact', 'importRunes', 'role'];
const MOD = '(?:CommandOrControl|Alt|Shift|Super)';
const KEY = '(?:[A-Z0-9]|F(?:[1-9]|1\\d|2[0-4])|num[0-9]|numadd|numsub|nummult|numdiv|numdec|Up|Down|Left|Right|Space|Tab|Home|End|PageUp|PageDown|Insert|Delete)';
// au moins un modificateur : une touche seule gênerait le jeu (et le chat)
const ACCEL_RE = new RegExp(`^${MOD}(?:\\+${MOD})*\\+${KEY}$`);

/** Change un raccourci ; renvoie un message d'erreur ou null. */
function setHotkey(name, accel) {
  if (!HOTKEY_NAMES.includes(name)) return 'Raccourci inconnu.';
  const hk = S.config.get('hotkeys');
  if (accel === '') {
    S.config.set({ hotkeys: { [name]: '' } });
    registerHotkeys();
    return null;
  }
  if (typeof accel !== 'string' || !ACCEL_RE.test(accel)) return 'Combinaison non prise en charge : utilise Ctrl, Alt, Maj ou Win + une lettre, un chiffre ou une touche F.';
  const dup = HOTKEY_NAMES.find((n) => n !== name && hk[n] === accel);
  if (dup) return `${hotkeyLabel(accel)} est déjà utilisé par un autre raccourci de BuildSense.`;
  const prev = hk[name];
  S.config.set({ hotkeys: { [name]: accel } });
  registerHotkeys();
  if (S.hotkeyErrors.some((e) => e.includes(hotkeyLabel(accel)))) {
    S.config.set({ hotkeys: { [name]: prev } });
    registerHotkeys();
    return `${hotkeyLabel(accel)} est déjà pris par Windows ou une autre appli.`;
  }
  pushOverlaySettings();
  return null;
}

const HOTKEY_ACTIONS = {
  toggle: () => toggleHidden(),
  move: () => setMoveMode(!S.moveMode),
  compact: () => {
    S.config.set({ overlay: { compact: !S.config.get('overlay').compact } });
    pushOverlaySettings();
    pushState();
  },
  importRunes: () => importRunes(),
  role: () => cycleRole(),
};
const HOTKEY_LABELS = {
  toggle: "Afficher/masquer l'overlay",
  move: "Déplacer l'overlay",
  compact: 'Mode compact',
  importRunes: 'Importer les runes',
  role: 'Changer de poste',
};

/**
 * Un raccourci peut arriver deux fois (raccourci Windows + lecture du clavier par keywatch) :
 * on n'exécute l'action qu'une fois par appui.
 */
function fireHotkey(name) {
  const fn = HOTKEY_ACTIONS[name];
  if (!fn || S.hotkeysSuspended) return;
  const now = Date.now();
  S.lastHotkey = S.lastHotkey || {};
  if (now - (S.lastHotkey[name] || 0) < 350) return;
  S.lastHotkey[name] = now;
  fn();
}

/** Raccourcis actifs même quand le jeu a le focus (il bloque ceux de Windows). */
function setupKeyWatch() {
  const exe = app.isPackaged ? path.join(process.resourcesPath, 'keywatch.exe') : path.join(ROOT, 'native', 'bin', 'keywatch.exe');
  S.keyWatch = new KeyWatch({ exe, onKey: fireHotkey });
  if (S.keyWatch.start()) S.keyWatch.setHotkeys(S.config.get('hotkeys'));
  app.on('will-quit', () => S.keyWatch.stop());
}

function registerHotkeys() {
  globalShortcut.unregisterAll();
  S.hotkeysSuspended = false;
  S.hotkeyErrors = [];
  const hk = S.config.get('hotkeys');
  for (const name of HOTKEY_NAMES) {
    const accel = hk[name];
    if (!accel) continue;
    try {
      if (!globalShortcut.register(accel, () => fireHotkey(name))) S.hotkeyErrors.push(`${HOTKEY_LABELS[name]} (${hotkeyLabel(accel)}) est déjà pris par une autre appli`);
    } catch {
      S.hotkeyErrors.push(`${HOTKEY_LABELS[name]} : raccourci "${accel}" invalide`);
    }
  }
  if (S.keyWatch) S.keyWatch.setHotkeys(hk);
}

// ---------------------------------------------------------------- état pour la fenêtre principale

const BUILD_FAMILIES = ['sr', 'aram', 'mayhem', 'arena'];

function buildsView(champKey, role, family = 'sr') {
  if (!S.dd.ready) return null;
  const fam = BUILD_FAMILIES.includes(family) ? family : 'sr';
  return pageBuilds({ dd: S.dd, rec: S.rec, followed: S.config.get('followed'), presets: S.config.get('buildPresets'), pros: S.pros }, champKey, role, fam);
}

function metaView(tier) {
  return S.dd.ready ? pageMeta({ dd: S.dd, store: S.store }, tier) : null;
}

function fullState() {
  const cfg = S.config.get();
  return {
    config: cfg,
    platforms: PLATFORMS,
    dd: { ready: S.dd.ready, version: S.dd.version, error: S.ddError, language: S.dd.language },
    clientLocale: S.clientLocale,
    display: S.display || null,
    icons: S.iconStatus,
    crawler: S.crawler.status(),
    store: S.store.stats(),
    favorites: (cfg.favorites || []).map((key) => {
      const c = S.dd.ready ? S.dd.champion(key) : null;
      return { key, name: c ? c.name : `#${key}`, icon: c ? S.dd.championIcon(c) : null, ...S.store.countFor(key) };
    }),
    game: {
      clientPhase: S.clientPhase,
      inGame: S.live.inGame,
      unsupported: S.live.unsupported,
      modeLabel: S.live.mode && S.live.mode.supported ? S.live.mode.label : null,
      champSelect: S.champSelect.active,
      role: currentRoleInfo(),
    },
    live: liveView(),
    coach: S.demo && S.demoCoach ? { ...S.demoCoach, demo: true } : S.live.inGame && S.coachReport ? S.coachReport : S.lastGame || null,
    followed: (cfg.followed || []).map((f) => ({ ...f, found: S.followStatus ? S.followStatus[f.id] : undefined })),
    version: PKG.version,
    versionLabel: versionLabel(),
    build: { channel: (PKG.buildsense && PKG.buildsense.channel) || 'stable', betaName: (PKG.buildsense && PKG.buildsense.betaName) || null },
    update: S.updater
      ? {
          ...S.updater.status(),
          auto: S.config.get('autoUpdate') !== false,
          playing: playing(),
          dismissed: !!S.config.get('dismissedUpdate') && S.config.get('dismissedUpdate') === S.updater.status().latest,
          repo: updateRepo(),
        }
      : null,
    whatsNew: S.whatsNew,
    overlay: {
      visible: !!(S.overlayWin && S.overlayWin.isVisible()),
      userHidden: S.userHidden,
      moveMode: S.moveMode,
      demo: S.demo,
    },
    hotkeys: Object.fromEntries(Object.entries(cfg.hotkeys).map(([k, v]) => [k, hotkeyLabel(v)])),
    hotkeyErrors: S.hotkeyErrors,
    importAvailable: !!S.champSelect.import,
  };
}

function pushState(force = false) {
  S.lastStatePush = Date.now();
  if (!S.mainWin || S.mainWin.isDestroyed()) return;
  // fenêtre cachée (zone de notification) : rien à redessiner, l'état est envoyé à la réouverture
  if (!force && !S.mainWin.isVisible()) {
    S.stateDirty = true;
    return;
  }
  const st = fullState();
  const json = JSON.stringify(st);
  if (!force && json === S.lastStateJson) return;
  S.lastStateJson = json;
  S.stateDirty = false;
  S.mainWin.webContents.send('state', st);
}

function pushStateSoon() {
  if (S.statePushTimer) return;
  const wait = Math.max(0, 700 - (Date.now() - S.lastStatePush));
  S.statePushTimer = setTimeout(() => {
    S.statePushTimer = null;
    pushState();
  }, wait);
}

function sanitizeConfig(patch) {
  const out = {};
  if (typeof patch.apiKey === 'string') out.apiKey = patch.apiKey.trim();
  if (PLATFORMS.includes(patch.platform)) out.platform = patch.platform;
  if (Array.isArray(patch.favorites)) out.favorites = [...new Set(patch.favorites.map(Number).filter((n) => n > 0))].slice(0, 20);
  for (const k of ['crawlerEnabled', 'pauseCrawlerInGame', 'lcuEnabled', 'autoRunes', 'autoItemSet', 'autoLivePage', 'autoUpdate', 'metaMultiRegion']) if (typeof patch[k] === 'boolean') out[k] = patch[k];
  if (patch.updateChannel === 'stable' || patch.updateChannel === 'beta') out.updateChannel = patch.updateChannel;
  if (patch.rolePrefs && typeof patch.rolePrefs === 'object') {
    // '' = automatique (la fusion des réglages ne supprime pas les clés)
    out.rolePrefs = {};
    for (const [k, v] of Object.entries(patch.rolePrefs)) if (Number(k) > 0) out.rolePrefs[String(Number(k))] = normRole(v);
  }
  if (typeof patch.leaguePath === 'string' && patch.leaguePath.trim()) out.leaguePath = patch.leaguePath.trim();
  if (patch.language === 'auto' || DD_LANGUAGES.includes(patch.language)) out.language = patch.language;
  if (patch.appearance && typeof patch.appearance === 'object') {
    const a = {};
    if (patch.appearance.theme in THEMES) a.theme = patch.appearance.theme;
    if (ACCENTS.includes(patch.appearance.accent)) a.accent = patch.appearance.accent;
    out.appearance = a;
  }
  if (typeof patch.updateRepo === 'string') {
    const r = patch.updateRepo.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\/+$/, '');
    if (r === '' || REPO_RE.test(r)) out.updateRepo = r;
  }
  if (patch.collectModes && typeof patch.collectModes === 'object') {
    out.collectModes = {};
    for (const f of [...FAMILY_IDS, 'meta']) if (typeof patch.collectModes[f] === 'boolean') out.collectModes[f] = patch.collectModes[f];
  }
  if (patch.overlay && typeof patch.overlay === 'object') {
    const o = {};
    if (Number.isFinite(patch.overlay.opacity)) o.opacity = Math.min(1, Math.max(0.4, patch.overlay.opacity));
    if (Number.isFinite(patch.overlay.scale)) o.scale = Math.min(1.4, Math.max(0.8, patch.overlay.scale));
    if (typeof patch.overlay.compact === 'boolean') o.compact = patch.overlay.compact;
    out.overlay = o;
  }
  return out;
}

function registerIpc() {
  ipcMain.handle('app:getState', () => fullState());

  ipcMain.handle('config:set', (_e, patch) => {
    const p = sanitizeConfig(patch || {});
    S.config.set(p);
    if ('apiKey' in p || 'platform' in p) {
      S.crawler.stop();
      S.crawler.reset();
      startCrawlerIfPossible();
    }
    if ('language' in p) applyLanguage();
    if ('crawlerEnabled' in p) {
      if (p.crawlerEnabled) startCrawlerIfPossible();
      else S.crawler.stop();
    }
    if ('leaguePath' in p) S.lcu.creds = null;
    if (p.overlay) {
      if (S.overlayWin) S.overlayWin.webContents.setZoomFactor(overlayScale());
      pushOverlaySettings();
      S.lastVmJson = '';
      refreshOverlay();
    }
    if (p.appearance) applyAppearance();
    if (('updateRepo' in p || 'updateChannel' in p) && S.updater) {
      S.updater.setFeed(updateFeed());
      S.updater.setExtraFeeds(extraFeeds());
      S.config.set({ dismissedUpdate: null });
      checkUpdates();
    }
    if (('metaMultiRegion' in p || p.collectModes) && S.crawler.running) {
      S.crawler.stopMetaWorkers();
      S.crawler.startMetaWorkers();
    }
    if (p.autoUpdate) maybeAutoDownload();
    if ('rolePrefs' in p || 'autoRunes' in p) recomputeViews();
    else if (S.demo) setDemo(S.demo, { keepOverride: true });
    pushState();
    return fullState();
  });

  ipcMain.handle('api:test', async () => {
    try {
      const league = await S.api.league('challenger');
      if (!league) return { ok: false, message: 'Réponse vide de Riot.' };
      return { ok: true, message: `Clé valide : ${league.entries.length} joueurs Challenger trouvés (${S.config.get('platform').toUpperCase()}).` };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  });

  ipcMain.handle('crawler:toggle', () => {
    if (S.crawler.running) {
      S.crawler.stop();
      S.config.set({ crawlerEnabled: false });
    } else {
      S.config.set({ crawlerEnabled: true });
      startCrawlerIfPossible();
    }
    pushState();
    return fullState();
  });

  ipcMain.handle('demo:set', (_e, kind) => {
    setDemo(DEMOS[kind] ? kind : null);
    return fullState();
  });

  ipcMain.handle('overlay:resetPosition', () => {
    S.config.set({ overlay: { x: null, y: null } });
    const pos = overlayPosition();
    if (S.overlayWin) {
      const b = S.overlayWin.getBounds();
      S.overlayWin.setBounds({ ...b, x: pos.x, y: pos.y });
    }
    return fullState();
  });

  ipcMain.handle('overlay:toggleMove', () => {
    setMoveMode(!S.moveMode);
    return fullState();
  });

  ipcMain.handle('runes:import', () => importRunes());

  ipcMain.handle('hotkeys:set', (_e, { name, accel } = {}) => {
    const error = setHotkey(name, accel);
    return { error, state: fullState() };
  });
  ipcMain.handle('hotkeys:reset', () => {
    S.config.set({ hotkeys: { ...DEFAULTS.hotkeys } });
    registerHotkeys();
    pushOverlaySettings();
    return fullState();
  });
  // pendant l'enregistrement d'une combinaison, les raccourcis actuels ne doivent pas se déclencher
  ipcMain.handle('hotkeys:suspend', (_e, on) => {
    if (on) {
      globalShortcut.unregisterAll();
      S.hotkeysSuspended = true;
      if (S.keyWatch) S.keyWatch.setHotkeys({});
    } else registerHotkeys();
    return true;
  });

  ipcMain.handle('builds:get', (_e, { champKey, role, family } = {}) => buildsView(Number(champKey), normRole(role), String(family || 'sr')));
  ipcMain.handle('builds:detail', (_e, { champKey, role, family, variantId } = {}) => {
    if (!S.dd.ready) return null;
    const fam = BUILD_FAMILIES.includes(family) ? family : 'sr';
    return buildDetailView({ dd: S.dd, rec: S.rec, followed: S.config.get('followed'), pros: S.pros }, Number(champKey), normRole(role), fam, String(variantId || ''));
  });
  ipcMain.handle('builds:favorite', (_e, { champKey, role, items, label } = {}) => {
    const key = `${Number(champKey)}|${normRole(role)}`;
    const ok = Array.isArray(items) && items.length && items.every((x) => Number.isInteger(x) && S.dd.item(x));
    if (Number(champKey) > 0 && ok) S.config.set({ buildPresets: { [key]: { items: items.slice(0, 5), label: String(label || 'ton build').slice(0, 60) } } });
    recomputeViews();
    return buildsView(Number(champKey), normRole(role));
  });
  ipcMain.handle('builds:unfavorite', (_e, { champKey, role } = {}) => {
    const presets = { ...S.config.get('buildPresets') };
    delete presets[`${Number(champKey)}|${normRole(role)}`];
    S.config.data.buildPresets = presets; // remplacement complet (la fusion ne supprime pas)
    S.config.save();
    recomputeViews();
    return buildsView(Number(champKey), normRole(role));
  });
  ipcMain.handle('follow:add', (_e, { name, platform } = {}) => {
    const n = String(name || '').trim();
    if (!/^[^#]{3,16}#[A-Za-z0-9]{2,5}$/.test(n)) return { error: 'Format attendu : pseudo#tag (ex. Hide on bush#KR1)' };
    const pf = PLATFORMS.includes(platform) ? platform : S.config.get('platform');
    const list = S.config.get('followed') || [];
    if (list.some((f) => f.name.toLowerCase() === n.toLowerCase())) return { error: 'Ce joueur est déjà suivi.' };
    if (list.length >= 10) return { error: '10 joueurs suivis au maximum.' };
    S.config.data.followed = [...list, { id: `f${Date.now().toString(36)}`, name: n, platform: pf }];
    S.config.save();
    return { state: fullState() };
  });
  ipcMain.handle('follow:remove', (_e, id) => {
    S.config.data.followed = (S.config.get('followed') || []).filter((f) => f.id !== id);
    S.config.save();
    return { state: fullState() };
  });
  ipcMain.handle('meta:get', (_e, tier) => metaView(String(tier || 'gm')));

  ipcMain.handle('role:set', (_e, role) => {
    setRole(typeof role === 'string' ? role : '', { announce: false });
    return fullState();
  });

  ipcMain.handle('champions:list', () =>
    S.dd.ready
      ? [...S.dd.champions.values()]
          .map((c) => ({
            key: c.key,
            name: c.name,
            icon: S.dd.championIcon(c),
            n: S.store.countFor(c.key).total,
            mainRole: S.store.mainRole(c.key) || '',
          }))
          .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
      : [],
  );

  ipcMain.handle('update:check', async () => {
    await checkUpdates();
    return fullState();
  });
  ipcMain.handle('update:download', async () => {
    if (S.updater && !playing()) S.updater.download();
    return fullState();
  });
  ipcMain.handle('update:install', () => installUpdate());
  ipcMain.handle('update:dismiss', () => {
    const st = S.updater && S.updater.status();
    if (st && st.latest) S.config.set({ dismissedUpdate: st.latest });
    return fullState();
  });
  ipcMain.handle('whatsnew:dismiss', () => {
    S.whatsNew = null;
    return fullState();
  });

  ipcMain.handle('link:open', (_e, which) => {
    if (LINKS[which]) shell.openExternal(LINKS[which]);
  });
  // tutos (onglet En direct) : seulement des adresses https de sites connus
  ipcMain.handle('link:url', (_e, url) => {
    try {
      const u = new URL(String(url));
      const okHost = /(^|\.)(youtube\.com|youtu\.be|leagueoflegends\.com|riotgames\.com)$/i.test(u.hostname);
      if (u.protocol === 'https:' && okHost) shell.openExternal(u.toString());
    } catch {
      /* adresse refusée */
    }
  });
  ipcMain.handle('game:setBorderless', async () => {
    if (S.live.inGame) return { ok: false, message: 'Termine ta partie : le mode d’affichage se change hors partie.' };
    const ok = gameWindow.setWindowMode(S.config.get('leaguePath'), 2);
    S.display = await gameWindow.displayInfo(S.config.get('leaguePath'));
    pushState(true);
    return ok
      ? { ok: true, message: 'LoL passera en Fenêtré sans bordure à ta prochaine partie.' }
      : { ok: false, message: 'Fichiers de réglages de LoL introuvables : vérifie le dossier de LoL dans Réglages.' };
  });
  ipcMain.handle('game:fixFso', async () => {
    const r = await gameWindow.fixFso();
    S.display = await gameWindow.displayInfo(S.config.get('leaguePath'));
    pushState(true);
    return r.fixed ? { ok: true, message: 'Optimisations plein écran réactivées pour LoL.' } : { ok: false, message: 'Rien à corriger.' };
  });

  ipcMain.on('overlay:height', (_e, h) => resizeOverlay(Number(h)));
}
