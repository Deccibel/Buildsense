'use strict';

const { EventEmitter } = require('events');
const { ApiKeyError } = require('./riotApi');
const { extractRecords, extractLite } = require('./extract');
const { FAMILIES, FAMILY_IDS, familyOfQueue } = require('./modes');
const { sleep, shuffle } = require('./util');

const LADDER_TTL = 6 * 3600 * 1000;
const PLAYER_COOLDOWN = 6 * 3600 * 1000;
const MAX_PRIORITY = 200;
const MAX_SNOWBALL = 1500;
const MAX_FAV_PLAYERS = 40;
const EMPTY_LIMIT = 30; // joueurs consécutifs sans partie dans un mode
const BACKOFF_MS = 30 * 60 * 1000; // mode probablement hors rotation : pause de 30 min

// Part du temps de collecte de chaque mode (le mode auquel tu joues compte triple)
const WEIGHTS = { sr: 3, aram: 2, mayhem: 1, arena: 1, meta: 1 };
const DEFAULT_MODES = { sr: true, aram: true, mayhem: true, arena: true, meta: true };
// collecte "meta" : paliers d'élo sous Grand Maître (Grand Maître et plus = collecte des builds)
const META_TIERS = ['low', 'emerald', 'diamond', 'master'];
const LOW_TIERS = ['PLATINUM', 'PLATINUM', 'GOLD', 'GOLD', 'SILVER', 'BRONZE', 'IRON'];
const DIVISIONS = ['I', 'II', 'III', 'IV'];
const ALL_FAMILIES = [...FAMILY_IDS, 'meta'];

/**
 * Collecte en tâche de fond des parties, pour chaque famille de modes :
 *  - Faille : classées solo/duo des joueurs Challenger + Grand Maître de la région ;
 *  - ARAM, ARAM Mayhem, Arena : parties de ces joueurs dans ces modes, puis de proche en proche
 *    les autres joueurs de ces parties (il n'y a pas de classement dans ces modes).
 * Chaque partie récupérée donne une fiche build par joueur.
 * Les champions favoris sont priorisés (maîtrise de champion, joueurs vus avec ces champions).
 */
class Crawler extends EventEmitter {
  constructor({ api, store, dd, getConfig, getActiveFamily = () => null }) {
    super();
    this.api = api;
    this.store = store;
    this.dd = dd;
    this.getConfig = getConfig;
    this.getActiveFamily = getActiveFamily;
    this.running = false;
    this.pausedForGame = false;
    this.ladder = [];
    this.ladderAt = 0;
    this.masteryIdx = 0;
    this.favPlayersFound = 0;
    this.favKey = '';
    this.fam = {};
    for (const f of ALL_FAMILIES) this.fam[f] = this.newFamilyState();
    this.matchesAdded = 0;
    this.recordsAdded = 0;
    this.metaIdx = 0;
    this.metaPools = {}; // palier -> { at, players: [puuid] }
    this.followPuuid = new Map(); // id du joueur suivi -> puuid (résolu à chaque session)
    this.lastError = null;
    this.state = 'stopped';
    this.failures = 0;
    this.lastEmit = 0;
  }

  newFamilyState() {
    return { priority: [], snowball: [], processed: new Map(), ladderIdx: 0, empty: 0, backoffUntil: 0, current: 0, matchesAdded: 0 };
  }

  enabledModes() {
    return { ...DEFAULT_MODES, ...(this.getConfig().collectModes || {}) };
  }

  status() {
    const modes = this.enabledModes();
    const families = {};
    for (const f of ALL_FAMILIES) {
      const s = this.fam[f];
      families[f] = { enabled: !!modes[f], matchesAdded: s.matchesAdded, paused: s.backoffUntil > Date.now() };
    }
    return {
      running: this.running,
      state: this.state,
      lastError: this.lastError,
      requests: this.api.requestCount,
      matchesAdded: this.matchesAdded,
      recordsAdded: this.recordsAdded,
      ladderSize: this.ladder.length,
      priorityQueue: this.fam.sr.priority.length,
      favPlayersFound: this.favPlayersFound,
      families,
    };
  }

  emitStatus(force = false) {
    const now = Date.now();
    if (!force && now - this.lastEmit < 1000) return;
    this.lastEmit = now;
    this.emit('status', this.status());
  }

  setState(state, force = true) {
    this.state = state;
    this.emitStatus(force);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastError = null;
    this.failures = 0;
    this.setState('running');
    this.loop();
  }

  stop() {
    this.running = false;
    this.setState('stopped');
  }

  /** Après un changement de clé ou de serveur : on repart de zéro. */
  reset() {
    this.ladder = [];
    this.ladderAt = 0;
    this.followPuuid = new Map();
    this.metaPools = {};
    for (const f of ALL_FAMILIES) this.fam[f] = this.newFamilyState();
  }

  setPausedForGame(paused) {
    if (this.pausedForGame === paused) return;
    this.pausedForGame = paused;
    if (this.running) this.setState(paused ? 'paused-ingame' : 'running');
  }

  favorites() {
    const favs = (this.getConfig().favorites || []).map(Number);
    const key = favs.slice().sort((a, b) => a - b).join(',');
    if (key !== this.favKey) {
      // nouveaux favoris : on relance la recherche de spécialistes
      this.favKey = key;
      this.masteryIdx = 0;
      this.favPlayersFound = 0;
    }
    return new Set(favs);
  }

  async loop() {
    while (this.running) {
      if (this.pausedForGame) {
        await sleep(3000);
        continue;
      }
      try {
        await this.step();
        this.failures = 0;
        if (this.state !== 'running') this.setState('running');
      } catch (e) {
        if (e instanceof ApiKeyError) {
          this.lastError = e.message;
          this.running = false;
          this.setState('nokey');
          break;
        }
        this.failures++;
        this.lastError = e.message || String(e);
        this.setState('waiting');
        await sleep(Math.min(60000, 5000 * this.failures));
      }
    }
  }

  async ensureLadder() {
    if (this.ladder.length && Date.now() - this.ladderAt < LADDER_TTL) return;
    const entries = [];
    for (const tier of ['challenger', 'grandmaster']) {
      const league = await this.api.league(tier);
      if (league && Array.isArray(league.entries)) entries.push(...league.entries);
    }
    if (entries.length < 100) {
      const master = await this.api.league('master');
      if (master && Array.isArray(master.entries)) {
        entries.push(...master.entries.sort((a, b) => b.leaguePoints - a.leaguePoints).slice(0, 400));
      }
    }
    this.ladder = shuffle(
      entries
        .map((e) => ({ puuid: e.puuid || null, summonerId: e.summonerId || null }))
        .filter((e) => e.puuid || e.summonerId),
    );
    this.ladderAt = Date.now();
    this.masteryIdx = 0;
    this.favPlayersFound = 0;
    for (const f of ALL_FAMILIES) this.fam[f].ladderIdx = 0;
  }

  /** Les anciennes réponses de league-v4 ne donnaient que summonerId. */
  async resolve(entry) {
    if (entry.puuid) return entry.puuid;
    if (!entry.summonerId) return null;
    const s = await this.api.summonerById(entry.summonerId);
    entry.puuid = (s && s.puuid) || null;
    return entry.puuid;
  }

  recentlyProcessed(family, puuid) {
    const t = this.fam[family].processed.get(puuid);
    return t && Date.now() - t < PLAYER_COOLDOWN;
  }

  /** Répartition pondérée (round-robin lissé) entre les modes activés. */
  pickFamily() {
    const modes = this.enabledModes();
    const now = Date.now();
    const active = this.getActiveFamily();
    const list = ALL_FAMILIES.filter((f) => modes[f] && this.fam[f].backoffUntil <= now);
    if (!list.length) return null;
    let total = 0;
    let best = null;
    for (const f of list) {
      const w = (WEIGHTS[f] || 1) * (f === active ? 3 : 1);
      this.fam[f].current += w;
      total += w;
      if (!best || this.fam[f].current > this.fam[best].current) best = f;
    }
    this.fam[best].current -= total;
    return best;
  }

  async nextLadderPlayer(family) {
    const s = this.fam[family];
    for (let i = 0; i < this.ladder.length; i++) {
      const entry = this.ladder[s.ladderIdx++ % this.ladder.length];
      const puuid = await this.resolve(entry);
      if (puuid && !this.recentlyProcessed(family, puuid)) return puuid;
    }
    return null;
  }

  async nextPlayer(family) {
    const s = this.fam[family];
    while (s.priority.length) {
      const puuid = s.priority.shift();
      if (!this.recentlyProcessed(family, puuid)) return { puuid, priority: true };
    }

    if (family === 'sr') {
      // joueurs suivis (onglet Builds), sur leur serveur
      for (const f of this.followed()) {
        const puuid = await this.followedPuuid(f);
        if (puuid && !this.recentlyProcessed('sr', puuid)) return { puuid, priority: true, platform: f.platform, followId: f.id };
      }
      const favs = this.favorites();
      if (favs.size && this.masteryIdx < this.ladder.length && this.favPlayersFound < MAX_FAV_PLAYERS) {
        const entry = this.ladder[this.masteryIdx++];
        const puuid = await this.resolve(entry);
        if (!puuid || this.recentlyProcessed('sr', puuid)) return null;
        const top = await this.api.topMasteries(puuid, 3);
        if ((top || []).some((m) => favs.has(Number(m.championId)))) {
          this.favPlayersFound++;
          return { puuid, priority: true };
        }
        return null; // cette étape a servi au scan de maîtrise
      }
    } else {
      // joueurs rencontrés dans des parties de ce mode
      while (s.snowball.length) {
        const puuid = s.snowball.shift();
        if (!this.recentlyProcessed(family, puuid)) return { puuid, priority: false };
      }
    }
    const puuid = await this.nextLadderPlayer(family);
    return puuid ? { puuid, priority: false } : null;
  }

  followed() {
    return (this.getConfig().followed || []).filter((f) => f && f.id && f.name && f.name.includes('#'));
  }

  async followedPuuid(f) {
    if (this.followPuuid.has(f.id)) return this.followPuuid.get(f.id);
    const i = f.name.lastIndexOf('#');
    const acc = await this.api.accountByRiotId(f.name.slice(0, i), f.name.slice(i + 1), f.platform);
    const puuid = (acc && acc.puuid) || null;
    this.followPuuid.set(f.id, puuid);
    this.emit('followed', { id: f.id, found: !!puuid });
    return puuid;
  }

  followMap() {
    const m = new Map();
    for (const [id, puuid] of this.followPuuid) if (puuid) m.set(puuid, id);
    return m;
  }

  /** Collecte meta : quelques parties récentes de joueurs d'un palier, sans timeline (1 requête par partie). */
  async metaStep() {
    const tier = META_TIERS[this.metaIdx++ % META_TIERS.length];
    let pool = this.metaPools[tier];
    if (!pool || Date.now() - pool.at > LADDER_TTL || !pool.players.length) {
      let entries = [];
      if (tier === 'master') {
        const l = await this.api.league('master');
        entries = (l && l.entries) || [];
      } else {
        const t = tier === 'low' ? LOW_TIERS[Math.floor(Math.random() * LOW_TIERS.length)] : tier.toUpperCase();
        const d = DIVISIONS[Math.floor(Math.random() * DIVISIONS.length)];
        entries = (await this.api.leagueEntries(t, d, 1 + Math.floor(Math.random() * 3))) || [];
      }
      pool = this.metaPools[tier] = { at: Date.now(), players: shuffle(entries.map((e) => e.puuid).filter(Boolean)).slice(0, 60) };
    }
    const puuid = pool.players.shift();
    if (!puuid) return;
    const days = this.getConfig().collectDays || 14;
    const ids = await this.api.matchIds(puuid, { queue: 420, count: 4, startTime: Math.floor(Date.now() / 1000) - days * 86400 });
    for (const id of ids || []) {
      if (!this.running || this.pausedForGame) break;
      if (this.store.hasSeen(id)) continue;
      const match = await this.api.match(id);
      this.store.markSeen(id);
      const recs = extractLite(match, tier);
      if (!recs.length) continue;
      this.store.add(recs);
      this.fam.meta.matchesAdded++;
      this.emitStatus();
    }
  }

  async step() {
    await this.ensureLadder();
    const family = this.pickFamily();
    if (!family) {
      await sleep(5000);
      return;
    }
    if (family === 'meta') return this.metaStep();
    const s = this.fam[family];
    const pl = await this.nextPlayer(family);
    if (!pl) {
      await sleep(this.ladder.length ? 300 : 30000);
      return;
    }
    const days = this.getConfig().collectDays || 14;
    const startTime = Math.floor(Date.now() / 1000) - days * 86400;
    const ids = await this.api.matchIds(pl.puuid, {
      queue: FAMILIES[family].collectQueue,
      count: pl.priority ? 20 : 10,
      startTime,
      platform: pl.platform || null,
    });
    s.processed.set(pl.puuid, Date.now());
    if (!ids || !ids.length) {
      // beaucoup de joueurs d'affilée sans partie dans ce mode : il est sans doute hors rotation
      if (++s.empty >= EMPTY_LIMIT && !s.snowball.length && !s.priority.length) {
        s.empty = 0;
        s.backoffUntil = Date.now() + BACKOFF_MS;
      }
      return;
    }
    s.empty = 0;
    for (const id of ids) {
      if (!this.running || this.pausedForGame) break;
      if (this.store.hasSeen(id)) continue;
      await this.processMatch(id, pl.platform || null);
    }
  }

  async processMatch(id, platform = null) {
    const match = await this.api.match(id, platform);
    this.store.markSeen(id);
    const family = match && match.info ? familyOfQueue(match.info.queueId) : null;
    if (!family || !(match.info.gameDuration >= FAMILIES[family].minDuration)) return;
    // sans timeline (rare), l'ordre d'achat est déduit des objets finaux
    const timeline = await this.api.timeline(id, platform);
    const recs = extractRecords(match, timeline, this.dd, { follow: this.followMap() });
    if (!recs.length) return;
    this.store.add(recs);
    this.matchesAdded++;
    this.recordsAdded += recs.length;
    this.fam[family].matchesAdded++;
    if (this.matchesAdded % 200 === 0) this.store.prune();

    const s = this.fam[family];
    const favs = this.favorites();
    for (const p of match.info.participants) {
      if (!p.puuid || this.recentlyProcessed(family, p.puuid)) continue;
      if (favs.has(p.championId)) {
        if (!s.priority.includes(p.puuid) && s.priority.length < MAX_PRIORITY) s.priority.push(p.puuid);
      } else if (family !== 'sr' && s.snowball.length < MAX_SNOWBALL && !s.snowball.includes(p.puuid)) {
        s.snowball.push(p.puuid);
      }
    }
    this.emitStatus();
  }
}

module.exports = { Crawler, DEFAULT_MODES, META_TIERS };
