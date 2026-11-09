'use strict';

const { sleep } = require('./util');

// Routage régional de match-v5 selon la plateforme
const REGIONAL = {
  euw1: 'europe', eun1: 'europe', tr1: 'europe', ru: 'europe', me1: 'europe',
  na1: 'americas', br1: 'americas', la1: 'americas', la2: 'americas',
  kr: 'asia', jp1: 'asia',
  oc1: 'sea', ph2: 'sea', sg2: 'sea', th2: 'sea', tw2: 'sea', vn2: 'sea',
};

const PLATFORMS = Object.keys(REGIONAL);

class ApiKeyError extends Error {
  constructor(status) {
    super(
      status === 401
        ? 'Clé API Riot manquante ou invalide.'
        : 'Clé API Riot refusée (expirée ? Les clés de développement durent 24 h).',
    );
    this.status = status;
    this.name = 'ApiKeyError';
  }
}

/** Fenêtres glissantes, ex. [[20, 1], [100, 120]] = 20 req/s et 100 req/2 min. */
class RateLimiter {
  constructor(limits) {
    this.setLimits(limits);
    this.chain = Promise.resolve();
    this.pausedUntil = 0;
  }

  setLimits(limits) {
    const old = this.windows || [];
    this.windows = limits.map(([count, seconds]) => {
      const prev = old.find((w) => w.ms === seconds * 1000);
      return { count, ms: seconds * 1000, stamps: prev ? prev.stamps : [] };
    });
    this.signature = JSON.stringify(limits);
  }

  pause(ms) {
    this.pausedUntil = Math.max(this.pausedUntil, Date.now() + ms);
  }

  acquire() {
    const run = async () => {
      for (;;) {
        const now = Date.now();
        let wait = Math.max(0, this.pausedUntil - now);
        for (const w of this.windows) {
          w.stamps = w.stamps.filter((t) => now - t < w.ms);
          if (w.stamps.length >= w.count) wait = Math.max(wait, w.ms - (now - w.stamps[0]) + 30);
        }
        if (wait <= 0) {
          for (const w of this.windows) w.stamps.push(now);
          return;
        }
        await sleep(wait);
      }
    };
    const p = this.chain.then(run);
    this.chain = p.catch(() => {});
    return p;
  }
}

class RiotApi {
  /**
   * @param {{ getKey: () => string, getPlatform: () => string, limits?: number[][], fetchImpl?: Function }} opts
   */
  constructor({ getKey, getPlatform, limits = [[20, 1], [100, 120]], fetchImpl = null }) {
    this.getKey = getKey;
    this.getPlatform = getPlatform;
    this.fetch = fetchImpl || globalThis.fetch;
    this.limiter = new RateLimiter(limits);
    this.requestCount = 0;
  }

  platformHost() {
    return `https://${this.getPlatform()}.api.riotgames.com`;
  }

  /** platform : serveur d'un joueur suivi (ex. 'kr' pour Faker), sinon celui des réglages. */
  regionalHost(platform = null) {
    return `https://${REGIONAL[platform || this.getPlatform()] || 'europe'}.api.riotgames.com`;
  }

  async request(url, { retries = 3 } = {}) {
    const key = (this.getKey() || '').trim();
    if (!key) throw new ApiKeyError(401);
    for (let attempt = 0; ; attempt++) {
      await this.limiter.acquire();
      let res;
      try {
        res = await this.fetch(url, { headers: { 'X-Riot-Token': key }, signal: AbortSignal.timeout(20000) });
      } catch (e) {
        if (attempt < retries) {
          await sleep(2000 * (attempt + 1));
          continue;
        }
        const code = (e && e.cause && e.cause.code) || (e && e.name) || '';
        throw new Error(`Serveurs Riot injoignables${code ? ` (${code})` : ''}. Vérifie ta connexion.`);
      }
      this.requestCount++;
      this.adoptLimits(res.headers);
      if (res.status === 200) return res.json();
      if (res.status === 404) return null;
      if (res.status === 401 || res.status === 403) throw new ApiKeyError(res.status);
      if (res.status === 429) {
        const ra = parseInt((res.headers && res.headers.get && res.headers.get('retry-after')) || '10', 10);
        this.limiter.pause((Number.isFinite(ra) ? ra : 10) * 1000);
        if (attempt < retries + 3) continue;
      }
      if (res.status >= 500 && attempt < retries) {
        await sleep(1500 * (attempt + 1));
        continue;
      }
      throw new Error(`Riot API ${res.status} sur ${url.replace(/\?.*/, '')}`);
    }
  }

  /** Les clés personnelles/production ont des limites plus hautes : on suit l'en-tête renvoyé. */
  adoptLimits(headers) {
    const h = headers && headers.get && headers.get('x-app-rate-limit');
    if (!h) return;
    const limits = h
      .split(',')
      .map((p) => p.split(':').map(Number))
      .filter(([c, s]) => c > 0 && s > 0)
      // marge de sécurité de 10 %
      .map(([c, s]) => [Math.max(1, Math.floor(c * 0.9)), s]);
    if (limits.length && JSON.stringify(limits) !== this.limiter.signature) this.limiter.setLimits(limits);
  }

  // --- Endpoints utilisés ---

  /** tier: 'challenger' | 'grandmaster' | 'master' */
  league(tier) {
    return this.request(`${this.platformHost()}/lol/league/v4/${tier}leagues/by-queue/RANKED_SOLO_5x5`);
  }

  summonerById(summonerId) {
    return this.request(`${this.platformHost()}/lol/summoner/v4/summoners/${encodeURIComponent(summonerId)}`);
  }

  topMasteries(puuid, count = 3) {
    return this.request(
      `${this.platformHost()}/lol/champion-mastery/v4/champion-masteries/by-puuid/${encodeURIComponent(puuid)}/top?count=${count}`,
    );
  }

  /** Compte Riot (pseudo#tag) -> puuid. */
  accountByRiotId(gameName, tagLine, platform = null) {
    return this.request(
      `${this.regionalHost(platform)}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
    );
  }

  /** Joueurs d'un palier classé (IRON..DIAMOND, divisions I à IV), 205 par page. */
  leagueEntries(tier, division, page = 1) {
    return this.request(`${this.platformHost()}/lol/league/v4/entries/RANKED_SOLO_5x5/${tier}/${division}?page=${page}`);
  }

  matchIds(puuid, { count = 20, startTime = null, queue = 420, platform = null } = {}) {
    // pas de filtre "type" : la file suffit (ranked, normal ARAM, Arena...)
    const q = new URLSearchParams({ queue: String(queue), start: '0', count: String(count) });
    if (startTime) q.set('startTime', String(startTime));
    return this.request(`${this.regionalHost(platform)}/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?${q}`);
  }

  match(id, platform = null) {
    return this.request(`${this.regionalHost(platform)}/lol/match/v5/matches/${encodeURIComponent(id)}`);
  }

  timeline(id, platform = null) {
    return this.request(`${this.regionalHost(platform)}/lol/match/v5/matches/${encodeURIComponent(id)}/timeline`);
  }
}

module.exports = { RiotApi, RateLimiter, ApiKeyError, REGIONAL, PLATFORMS };
