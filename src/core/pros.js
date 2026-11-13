'use strict';

/**
 * Reconnaissance des joueurs pros dans les parties collectées (Challenger / Grand Maître).
 *
 * Deux sources :
 *  1. la liste data/pros.json du dépôt GitHub (Riot ID -> nom, équipe, poste), téléchargée au démarrage
 *     et mise en cache : elle peut être complétée sans publier de nouvelle version de l'appli ;
 *  2. le préfixe d'équipe du pseudo (ex. "G2 Caps", "T1 Faker") : beaucoup de pros jouent sous le tag
 *     de leur équipe. Signalé comme "pro probable".
 */

const fs = require('fs');
const path = require('path');

const TEAM_TAGS = {
  // LEC / Europe
  G2: 'G2 Esports', FNC: 'Fnatic', KC: 'Karmine Corp', KCB: 'Karmine Corp Blue', MKOI: 'Movistar KOI', KOI: 'Movistar KOI',
  TH: 'Team Heretics', VIT: 'Team Vitality', VITB: 'Vitality.Bee', SK: 'SK Gaming', GX: 'GIANTX', BDS: 'Team BDS',
  NAVI: 'Natus Vincere', LR: 'Los Ratones', SLY: 'Solary', GW: 'Gentle Mates', M8: 'Gentle Mates', IJC: 'Ici Japon Corp',
  // LCK
  T1: 'T1', GEN: 'Gen.G', HLE: 'Hanwha Life Esports', DK: 'Dplus KIA', KT: 'KT Rolster', DRX: 'DRX', NS: 'Nongshim RedForce',
  BRO: 'OKSavingsBank BRION', BFX: 'BNK FearX', FOX: 'BNK FearX', KRX: 'DN Freecs',
  // LPL
  BLG: 'Bilibili Gaming', JDG: 'JD Gaming', TES: 'Top Esports', WBG: 'Weibo Gaming', AL: "Anyone's Legend", IG: 'Invictus Gaming',
  LNG: 'LNG Esports', NIP: 'Ninjas in Pyjamas', EDG: 'EDward Gaming', RNG: 'Royal Never Give Up',
  // Amériques
  C9: 'Cloud9', TL: 'Team Liquid', FLY: 'FlyQuest', DIG: 'Dignitas', SR: 'Shopify Rebellion', LYON: 'LYON', LOUD: 'LOUD',
  FUR: 'FURIA', PAIN: 'paiN Gaming', RED: 'RED Canids', VKS: 'Vivo Keyd Stars', '100T': '100 Thieves',
  // autres
  PSG: 'PSG Talon', GAM: 'GAM Esports', CFO: 'CTBC Flying Oyster', SHG: 'Fukuoka SoftBank HAWKS gaming',
};

const REMOTE = 'https://raw.githubusercontent.com/Deccibel/buildsense/main/data/pros.json';

class Pros {
  constructor({ cacheFile = null, fetchImpl = null } = {}) {
    this.cacheFile = cacheFile;
    this.fetch = fetchImpl || globalThis.fetch;
    this.list = new Map(); // riot id en minuscules -> { name, team, role }
    if (cacheFile) {
      try {
        this.ingest(JSON.parse(fs.readFileSync(cacheFile, 'utf8')));
      } catch {
        /* pas encore de cache */
      }
    }
  }

  ingest(json) {
    const players = (json && json.players) || {};
    const m = new Map();
    for (const [id, p] of Object.entries(players)) if (p && p.name) m.set(id.toLowerCase(), { name: String(p.name), team: p.team ? String(p.team) : '', role: p.role ? String(p.role) : '' });
    this.list = m;
  }

  async refresh() {
    try {
      const res = await this.fetch(REMOTE, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return;
      const json = await res.json();
      this.ingest(json);
      if (this.cacheFile) {
        fs.mkdirSync(path.dirname(this.cacheFile), { recursive: true });
        fs.writeFileSync(this.cacheFile, JSON.stringify(json));
      }
    } catch {
      /* hors ligne : on garde le cache */
    }
  }

  /** { name, team, role, sure } ou null. riotId = "pseudo#tag". */
  identify(riotId) {
    if (!riotId) return null;
    const known = this.list.get(String(riotId).toLowerCase());
    if (known) return { ...known, sure: true };
    const game = String(riotId).split('#')[0].trim();
    const m = /^([A-Za-z0-9]{2,4})[ ._-]+(\S.*)$/.exec(game);
    if (m && TEAM_TAGS[m[1].toUpperCase()] && m[1] === m[1].toUpperCase()) return { name: m[2], team: TEAM_TAGS[m[1].toUpperCase()], role: '', sure: false };
    return null;
  }
}

module.exports = { Pros, TEAM_TAGS };
