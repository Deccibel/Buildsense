'use strict';

/**
 * Scénarios de rendu (overlay et fenêtre principale) construits à partir des données FACTICES des tests,
 * en français, en anglais et avec des noms "extrêmes". Utilisé par scripts/preview.js
 * (captures et vérification qu'aucun texte n'est coupé).
 */

const fs = require('fs');
const path = require('path');

const { DDragon } = require('../../src/core/ddragon');
const { Store } = require('../../src/core/store');
const { Recommender } = require('../../src/core/recommender');
const { normalizeLive } = require('../../src/core/liveClient');
const { parseChampSelect } = require('../../src/core/lcu');
const { computeIngame, computeChampSelect } = require('../../src/core/engine');
const { messageVM, hotkeyLabel } = require('../../src/core/viewModels');
const { detectMode } = require('../../src/core/modes');
const { DEFAULTS, deepMerge } = require('../../src/core/config');
const { raw } = require('../../test/fixtures/ddragon');
const { localize } = require('../../test/fixtures/names');
const R = require('../../test/fixtures/records');

const ROOT = path.join(__dirname, '..', '..');
const readJson = (...p) => JSON.parse(fs.readFileSync(path.join(ROOT, ...p), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));

const HOTKEYS = DEFAULTS.hotkeys;
const KEYS = { move: hotkeyLabel(HOTKEYS.move), toggle: hotkeyLabel(HOTKEYS.toggle), compact: hotkeyLabel(HOTKEYS.compact) };
const RANKED = { id: 420, mapId: 11, gameMode: 'CLASSIC' };

/** Variantes de langue testées. */
const LANGS = [
  { id: 'fr', lang: 'fr', extreme: false },
  { id: 'en', lang: 'en', extreme: false },
  { id: 'xl', lang: 'fr', extreme: true },
];

function makeData({ lang = 'fr', extreme = false } = {}) {
  const dd = new DDragon().ingest(localize(raw, lang, { extreme }));
  dd.iconBase = 'bsicon://dd';
  const store = new Store(null);
  store.add([
    ...R.ahriRecords(),
    ...R.aramAhriRecords(),
    ...R.arenaAhriRecords(),
    ...R.roleRecords(),
    ...R.supportRecords(),
    ...R.ahriSupportRecords(4),
  ]);
  return { dd, store, rec: new Recommender({ store, dd }) };
}

/** Ce que main.js ajoute à la vue de sélection (runes automatiques, raccourci de poste). */
function decorate(vm, runes) {
  if (!vm || vm.mode !== 'champselect') return vm;
  if (vm.roleInfo && vm.roleInfo.roles) vm.roleHint = { key: hotkeyLabel(HOTKEYS.role), text: 'changer de poste' };
  if (vm.page) vm.runes = runes || { state: 'waiting', text: 'Runes appliquées automatiquement dès que tu verrouilles ton champion' };
  return vm;
}

/** Toutes les vues de l'overlay à vérifier. */
function overlayVms({ dd, store, rec }) {
  const hasKey = true;
  const importHotkey = HOTKEYS.importRunes;
  const live = (file, patch = {}, extra = {}) => {
    const g = typeof file === 'string' ? readJson(...file.split('/')) : clone(file);
    Object.assign(g.gameData, patch);
    const game = normalizeLive(g, dd);
    return computeIngame({ dd, store, rec, game, hasKey, ...extra });
  };
  const cs = (session, queue, extra = {}) =>
    computeChampSelect({ dd, store, rec, cs: parseChampSelect(clone(session), dd, queue), hasKey, importHotkey, ...extra });
  const demoCs = readJson('demo', 'champselect.json');
  const aramCs = readJson('test', 'fixtures', 'champselect-aram.json');
  const offRole = { override: { champKey: R.K.Ahri, role: 'UTILITY' }, prefs: {} };
  const emptyStore = new Store(null);

  const out = {
    'partie-faille': live('demo/allgamedata.json'),
    'partie-hors-poste': live('demo/allgamedata.json', {}, { roleChoice: offRole }),
    'partie-aram': live('demo/allgamedata-aram.json'),
    'partie-mayhem': live('demo/allgamedata-aram.json', { gameMode: 'KIWI' }),
    'partie-arena': live('test/fixtures/allgamedata-arena.json'),
    'partie-urf': live('demo/allgamedata.json', { gameMode: 'URF' }),
    'partie-sans-donnees': computeIngame({
      dd,
      store: emptyStore,
      rec: new Recommender({ store: emptyStore, dd }),
      game: normalizeLive(readJson('demo', 'allgamedata.json'), dd),
      hasKey: false,
    }),
    'selection-faille': decorate(cs(demoCs, RANKED)),
    'selection-appliquee': decorate(cs(demoCs, RANKED), {
      state: 'applied',
      text: `Runes appliquées : ${dd.champion(R.K.Ahri).name} Mid (page active remplacée)`,
    }),
    'selection-hors-poste': decorate(cs(demoCs, RANKED, { roleChoice: offRole }), {
      state: 'kept',
      text: 'Tu as modifié ta page : BuildSense n’y touche plus',
    }),
    'selection-aram': decorate(cs(aramCs, { id: 450, mapId: 12, gameMode: 'ARAM' })),
    'selection-mayhem': decorate(cs(aramCs, { id: 2400, mapId: 12, gameMode: 'KIWI' })),
    'message-swarm': (() => {
      const m = detectMode({ gameMode: 'STRAWBERRY', mapNumber: 33 });
      return messageVM(m.label, m.message);
    })(),
  };
  return out;
}

/** Réglages envoyés à l'overlay. */
function overlaySettings(extra = {}) {
  return { opacity: 0.96, compact: false, moveMode: false, keys: KEYS, ...extra };
}

/** État de la fenêtre principale (même forme que fullState() dans main.js). */
const UPDATE_NOTES = [
  'Mises à jour automatiques : BuildSense détecte les nouvelles versions, les télécharge en fond (jamais pendant une partie) et s’installe en un clic.',
  'Une carte « Quoi de neuf » s’affiche après chaque mise à jour.',
];

/** État des mises à jour pour les aperçus. */
function updateState(status = 'up-to-date') {
  const base = { current: '1.3.0', latest: '1.4.0', notes: UPDATE_NOTES, date: '2026-11-20', size: 115891915, received: 0, error: null, checkedAt: 0, auto: true, playing: false, dismissed: false, repo: 'Deccibel/buildsense' };
  if (status === 'downloading') return { ...base, status, received: 48234496 };
  if (status === 'ready') return { ...base, status, received: base.size };
  if (status === 'available-error') return { ...base, status: 'available', error: 'fichier corrompu (empreinte différente) : supprimé' };
  return { ...base, status, latest: status === 'up-to-date' ? '1.3.0' : base.latest, notes: status === 'up-to-date' ? [] : UPDATE_NOTES };
}

function dashboardState({ dd, store }, { live = null, rolePrefs = {}, phase = 'Lobby', update = 'up-to-date', whatsNew = false, appearance = null } = {}) {
  const config = deepMerge(DEFAULTS, {
    ...(appearance ? { appearance } : {}),
    apiKey: 'RGAPI-00000000-0000-0000-0000-000000000000',
    favorites: [R.K.Ahri, R.K.Zed, R.K.Syndra, R.K.Thresh],
    rolePrefs,
    detectedLocale: 'fr_FR',
  });
  const stats = store.stats();
  const favorites = config.favorites.map((key) => {
    const c = dd.champion(key);
    return { key, name: c.name, icon: dd.championIcon(c), ...store.countFor(key) };
  });
  const vm = live && live.vm;
  return {
    config,
    platforms: ['euw1', 'eun1', 'na1', 'kr'],
    dd: { ready: true, version: '16.21.1', error: null, language: dd.language },
    clientLocale: 'fr_FR',
    icons: { done: 0, total: 0, running: false },
    crawler: {
      running: true,
      state: 'running',
      lastError: null,
      requests: 81234,
      matchesAdded: 6402,
      recordsAdded: 64020,
      favPlayersFound: 7,
      families: {
        sr: { enabled: true, matchesAdded: 5000, paused: false },
        aram: { enabled: true, matchesAdded: 1200, paused: false },
        mayhem: { enabled: true, matchesAdded: 0, paused: true },
        arena: { enabled: false, matchesAdded: 0, paused: false },
      },
    },
    store: stats,
    favorites,
    game: {
      clientPhase: phase,
      inGame: !!vm && vm.mode === 'ingame',
      unsupported: null,
      modeLabel: vm && vm.modeLabel,
      champSelect: !!vm && vm.mode === 'champselect',
      role: vm && vm.roleInfo ? { ...vm.roleInfo, champion: vm.header.champion } : null,
    },
    live,
    overlay: { visible: !!vm, userHidden: false, moveMode: false, demo: live && live.source === 'demo' ? 'ingame' : null },
    hotkeys: Object.fromEntries(Object.entries(config.hotkeys).map(([k, v]) => [k, hotkeyLabel(v)])),
    hotkeyErrors: [],
    importAvailable: !!vm && vm.mode === 'champselect',
    version: '1.3.0',
    update: updateState(update),
    whatsNew: whatsNew ? { version: '1.3.0', previous: '1.2.0', notes: UPDATE_NOTES } : null,
  };
}

function championsList({ dd, store }) {
  return [...dd.champions.values()]
    .map((c) => ({ key: c.key, name: c.name, icon: dd.championIcon(c), n: store.countFor(c.key).total, mainRole: store.mainRole(c.key) || '' }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

module.exports = { LANGS, makeData, overlayVms, overlaySettings, dashboardState, championsList, decorate, KEYS };
