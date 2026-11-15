'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_LEAGUE_PATH =
  process.platform === 'darwin'
    ? '/Applications/League of Legends.app/Contents/LoL'
    : 'C:\\Riot Games\\League of Legends';

const DEFAULTS = {
  configVersion: 4,
  apiKey: '',
  platform: 'euw1',
  // langue des noms (objets, champions, runes) : 'auto' = celle du client LoL
  language: 'auto',
  detectedLocale: null,
  // modes dont on collecte les builds
  collectModes: { sr: true, aram: true, mayhem: true, arena: true, meta: true },
  // meta Platine et moins : collecteurs en parallèle sur d'autres régions (quotas Riot séparés)
  metaMultiRegion: true,
  // objectif de session (onglet En direct) : 'auto' = ton point faible récurrent, sinon cs10/early/deaths/vision/kp
  goal: 'auto',
  // ton compte (Riot ID lu dans le client) : sert à récupérer tes parties pour le bilan et l'historique
  me: null,
  // mises à jour : 'stable' (publiée chaque jour à 9 h) ou 'beta' (dès qu'elle est prête)
  updateChannel: 'stable',
  favorites: [], // championKeys (nombres) à collecter en priorité
  // poste préféré par champion, ex. { "98": "UTILITY" } pour Shen support ('' = automatique)
  rolePrefs: {},
  // builds favoris (onglet Builds) : { "103|MIDDLE": { items: [ids], label } }
  buildPresets: {},
  // joueurs suivis (onglet Builds) : [{ id, name: 'pseudo#tag', platform }]
  followed: [],
  // en sélection : applique la page de runes recommandée (remplace la page active)
  autoRunes: true,
  // en sélection : met aussi les sorts d'invocateur conseillés (Flash garde sa touche D ou F)
  autoSpells: true,
  // en sélection : écrit une page d'objets Stonks dans la boutique (meilleur départ en premier)
  autoItemSet: true,
  // fenêtre principale : bascule sur la page "En direct" au début de chaque sélection/partie
  autoLivePage: true,
  // apparence : thème 'auto' (comme Windows) | 'light' | 'dark', accent ou 'classic' (DA de LoL)
  appearance: { theme: 'dark', accent: 'orange' },
  // mises à jour : téléchargées en fond (jamais pendant une partie), installées sur ton clic
  autoUpdate: true,
  updateRepo: '', // dépôt GitHub des versions, "pseudo/nom" ('' = celui de package.json)
  updateFeed: null, // adresse directe de latest.json (tests)
  dismissedUpdate: null,
  lastVersion: null,
  crawlerEnabled: true,
  pauseCrawlerInGame: true,
  collectDays: 14,
  rateLimits: [
    [20, 1],
    [100, 120],
  ],
  leaguePath: DEFAULT_LEAGUE_PATH,
  lcuEnabled: true,
  overlay: {
    x: null,
    y: null,
    opacity: 0.94,
    scale: 1,
    compact: false,
  },
  hotkeys: {
    toggle: 'CommandOrControl+Shift+O',
    move: 'CommandOrControl+Shift+M',
    compact: 'CommandOrControl+Shift+H',
    importRunes: 'CommandOrControl+Shift+R',
    role: 'CommandOrControl+Shift+P',
  },
};

function isPlainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, patch) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    if (isPlainObject(v) && isPlainObject(base[k])) out[k] = deepMerge(base[k], v);
    else if (v !== undefined) out[k] = v;
  }
  return out;
}

class Config {
  constructor(dir) {
    this.file = path.join(dir, 'config.json');
    let saved = {};
    try {
      saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      saved = {};
    }
    // v1 enregistrait toujours fr_FR : on passe en automatique (langue du client LoL)
    if (saved && Object.keys(saved).length && !saved.configVersion) {
      if (saved.language === 'fr_FR') saved.language = 'auto';
      saved.configVersion = 2;
    }
    // v3 : BuildSense devient Stonks. La nouvelle identité arrive avec sa couleur (le dégradé « Stonks ») ;
    // l'ancienne couleur reste disponible dans Réglages › Apparence. Fait une seule fois.
    if (saved && Object.keys(saved).length && saved.configVersion < 3) {
      if (isPlainObject(saved.appearance)) saved.appearance = { ...saved.appearance, accent: 'stonks' };
      saved.configVersion = 3;
    }
    // v4 : l'orange devient la couleur principale de Stonks (appli, overlay et icône). Fait une seule fois.
    if (saved && Object.keys(saved).length && saved.configVersion < 4) {
      if (isPlainObject(saved.appearance)) saved.appearance = { ...saved.appearance, accent: 'orange' };
      saved.configVersion = 4;
    }
    this.data = deepMerge(DEFAULTS, saved);
    if (!this.data.apiKey && process.env.RIOT_API_KEY) this.data.apiKey = process.env.RIOT_API_KEY.trim();
  }

  get(key) {
    return key ? this.data[key] : this.data;
  }

  set(patch) {
    this.data = deepMerge(this.data, patch);
    this.save();
    return this.data;
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { Config, DEFAULTS, deepMerge };
