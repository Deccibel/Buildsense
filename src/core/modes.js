'use strict';

/**
 * Modes de jeu.
 *
 * Chaque "famille" a sa propre base de builds :
 *  - sr      Faille de l'invocateur (données : classée solo/duo Challenger + Grand Maître)
 *  - aram    ARAM (Abîme hurlant)
 *  - mayhem  ARAM Mayhem (augments à la place des runes ; repli sur les données ARAM si besoin)
 *  - arena   Arena 2v2v2v2 (pas de runes, pas de couloirs)
 *
 * Les autres modes de la Faille (normales, Swiftplay, Clash, URF, Un pour tous...) utilisent
 * les builds de la Faille.
 */
const FAMILIES = {
  sr: {
    id: 'sr',
    label: 'Faille',
    map: 11,
    queues: [420, 440, 700, 710],
    collectQueue: 420,
    roles: true,
    teams: true,
    runes: true,
    minDuration: 15 * 60,
    sampleNoun: 'parties Challenger/GM',
  },
  aram: {
    id: 'aram',
    label: 'ARAM',
    map: 12,
    queues: [450, 720],
    collectQueue: 450,
    roles: false,
    teams: true,
    runes: true,
    minDuration: 8 * 60,
    sampleNoun: 'parties ARAM',
  },
  mayhem: {
    id: 'mayhem',
    label: 'ARAM Mayhem',
    map: 12,
    queues: [2400],
    collectQueue: 2400,
    roles: false,
    teams: true,
    runes: false,
    minDuration: 8 * 60,
    fallback: 'aram',
    sampleNoun: 'parties ARAM Mayhem',
  },
  arena: {
    id: 'arena',
    label: 'Arena',
    map: 30,
    queues: [1700, 1710],
    collectQueue: 1700,
    roles: false,
    teams: false,
    runes: false,
    minDuration: 5 * 60,
    sampleNoun: 'parties Arena',
  },
};

const FAMILY_IDS = Object.keys(FAMILIES);

const QUEUE_LABELS = {
  400: 'Normale',
  420: 'Classée solo',
  430: 'Aveugle',
  440: 'Classée flexible',
  450: 'ARAM',
  480: 'Swiftplay',
  490: 'Partie rapide',
  700: 'Clash',
  710: 'Classée 5v5',
  720: 'Clash ARAM',
  900: 'ARURF',
  1020: 'Un pour tous',
  1300: 'Nexus Blitz',
  1400: 'Grimoire ultime',
  1700: 'Arena',
  1710: 'Arena',
  1900: 'URF',
  2400: 'ARAM Mayhem',
};

const GAMEMODE_LABELS = {
  CLASSIC: 'Faille',
  SWIFTPLAY: 'Swiftplay',
  ARAM: 'ARAM',
  KIWI: 'ARAM Mayhem',
  CHERRY: 'Arena',
  URF: 'URF',
  ARURF: 'ARURF',
  ONEFORALL: 'Un pour tous',
  ULTBOOK: 'Grimoire ultime',
  NEXUSBLITZ: 'Nexus Blitz',
  GAMEMODEX: 'Nexus Blitz',
  PRACTICETOOL: 'Entraînement',
  TUTORIAL: 'Tutoriel',
  BRAWL: 'Brawl',
  DOOMBOTSTEEMO: 'Bots du Destin',
  ARSR: 'Faille aléatoire',
};

// Modes de la Faille où les builds classés s'appliquent tels quels
const STANDARD_SR = new Set(['CLASSIC', 'SWIFTPLAY', 'PRACTICETOOL', 'TUTORIAL']);
// Sans boutique ni builds : rien à afficher
const UNSUPPORTED = {
  STRAWBERRY: 'Swarm est un mode JcE sans boutique : rien à conseiller.',
  TFT: 'Teamfight Tactics n’est pas pris en charge.',
};

function familyOfQueue(queueId) {
  const q = Number(queueId);
  return FAMILY_IDS.find((f) => FAMILIES[f].queues.includes(q)) || null;
}

function prettyMode(gameMode) {
  const g = String(gameMode || '');
  if (!g) return '';
  return g.charAt(0) + g.slice(1).toLowerCase();
}

/**
 * Mode d'une partie à partir de ce que donnent la Live Client Data API (gameMode, mapNumber)
 * ou le client (file d'attente).
 * @returns {{ supported:boolean, family:string, map:number, label:string, roles:boolean, teams:boolean, runes:boolean, special:boolean, message?:string }}
 */
function detectMode({ gameMode = '', mapNumber = 0, queueId = 0 } = {}) {
  const gm = String(gameMode || '').toUpperCase();
  const tutorial = gm.startsWith('TUTORIAL');
  if (UNSUPPORTED[gm] || Number(mapNumber) === 33) {
    return { supported: false, family: null, label: GAMEMODE_LABELS[gm] || 'Swarm', message: UNSUPPORTED[gm] || UNSUPPORTED.STRAWBERRY };
  }

  let family = familyOfQueue(queueId);
  if (!family) {
    if (gm === 'CHERRY' || Number(mapNumber) === 30) family = 'arena';
    else if (gm === 'KIWI' || Number(queueId) === 2400) family = 'mayhem';
    else if (gm === 'ARAM' || Number(mapNumber) === 12) family = 'aram';
    else family = 'sr';
  }
  const F = FAMILIES[family];
  const label =
    QUEUE_LABELS[Number(queueId)] || GAMEMODE_LABELS[gm] || (tutorial ? 'Tutoriel' : '') || prettyMode(gm) || F.label;
  // Mode spécial de la Faille (URF, Un pour tous, Nexus Blitz...) : builds classés à titre indicatif
  const special = family === 'sr' && !!gm && !STANDARD_SR.has(gm) && !tutorial;
  // carte des objets : celle du mode, sauf modes de la Faille joués sur une autre carte (Nexus Blitz...)
  const map = family === 'sr' && Number(mapNumber) && Number(mapNumber) !== 11 ? Number(mapNumber) : F.map;
  return {
    supported: true,
    family,
    map,
    label,
    roles: F.roles,
    teams: F.teams,
    runes: F.runes,
    special,
  };
}

module.exports = { FAMILIES, FAMILY_IDS, familyOfQueue, detectMode, QUEUE_LABELS };
