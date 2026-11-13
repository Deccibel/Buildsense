'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { comparePatch } = require('./util');

const KEEP_PATCHES = 3;
const fam = (r) => r.q || 'sr';
const keyOf = (family, championKey) => `${family}|${Number(championKey)}`;
const MAX_SEEN = 80000;

/**
 * Base locale des fiches build (fichier JSON Lines) + index par champion.
 * Pas de base de données à installer : tout tient dans un dossier.
 */
class Store extends EventEmitter {
  constructor(dir) {
    super();
    this.dir = dir;
    this.recordsFile = dir ? path.join(dir, 'records.jsonl') : null;
    this.seenFile = dir ? path.join(dir, 'seen-matches.json') : null;
    this.records = [];
    this.byChamp = new Map();
    this.byPosition = new Map();
    this.meta = []; // fiches légères de l'onglet Meta (autres paliers d'élo)
    this.metaCache = null;
    this.seen = new Set();
    this.patchCounts = new Map();
    this.familyCounts = new Map();
    this.version = 0;
    this.pendingSeen = 0;
    this.loaded = false;
    this.statsCache = null;
  }

  /**
   * Chargement sans bloquer l'appli : le fichier est lu par morceaux et le processus principal
   * reprend la main régulièrement (fenêtres, overlay et raccourcis restent réactifs).
   */
  async loadAsync({ chunkLines = 15000 } = {}) {
    if (!this.dir) {
      this.loaded = true;
      return this;
    }
    fs.mkdirSync(this.dir, { recursive: true });
    const yieldNow = () => new Promise((r) => setImmediate(r));
    try {
      const fd = await fs.promises.open(this.recordsFile, 'r');
      try {
        const buf = Buffer.allocUnsafe(4 * 1024 * 1024);
        let rest = '';
        let n = 0;
        for (;;) {
          const { bytesRead } = await fd.read(buf, 0, buf.length, null);
          if (!bytesRead) break;
          const text = rest + buf.toString('utf8', 0, bytesRead);
          const lines = text.split('\n');
          rest = lines.pop();
          for (const line of lines) {
            if (!line) continue;
            try {
              this.index(JSON.parse(line));
            } catch {
              /* ligne corrompue ignorée */
            }
            if (++n % chunkLines === 0) await yieldNow();
          }
        }
        if (rest.trim()) {
          try {
            this.index(JSON.parse(rest));
          } catch {
            /* fin de fichier tronquée */
          }
        }
      } finally {
        await fd.close();
      }
    } catch {
      /* pas encore de données */
    }
    try {
      for (const id of JSON.parse(await fs.promises.readFile(this.seenFile, 'utf8'))) this.seen.add(id);
    } catch {
      /* rien */
    }
    await yieldNow();
    this.prune();
    this.loaded = true;
    this.version++;
    this.emit('change');
    return this;
  }

  load() {
    if (!this.dir) return this;
    fs.mkdirSync(this.dir, { recursive: true });
    try {
      const text = fs.readFileSync(this.recordsFile, 'utf8');
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          this.index(JSON.parse(line));
        } catch {
          /* ligne corrompue ignorée */
        }
      }
    } catch {
      /* pas encore de données */
    }
    try {
      for (const id of JSON.parse(fs.readFileSync(this.seenFile, 'utf8'))) this.seen.add(id);
    } catch {
      /* rien */
    }
    this.prune();
    this.loaded = true;
    this.version++;
    return this;
  }

  index(rec) {
    this.records.push(rec);
    if (rec.lt) {
      this.meta.push(rec);
      return;
    }
    const k = keyOf(fam(rec), rec.c);
    let list = this.byChamp.get(k);
    if (!list) this.byChamp.set(k, (list = []));
    list.push(rec);
    if (rec.r && fam(rec) === 'sr') {
      let pl = this.byPosition.get(rec.r);
      if (!pl) this.byPosition.set(rec.r, (pl = []));
      pl.push(rec);
    }
    this.patchCounts.set(rec.v, (this.patchCounts.get(rec.v) || 0) + 1);
    this.familyCounts.set(fam(rec), (this.familyCounts.get(fam(rec)) || 0) + 1);
  }

  add(recs) {
    if (!recs.length) return;
    for (const r of recs) this.index(r);
    if (this.recordsFile) fs.appendFileSync(this.recordsFile, recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
    this.version++;
    this.emit('change');
  }

  hasSeen(matchId) {
    return this.seen.has(matchId);
  }

  markSeen(matchId) {
    this.seen.add(matchId);
    if (++this.pendingSeen >= 25) this.saveSeen();
  }

  saveSeen() {
    this.pendingSeen = 0;
    if (!this.seenFile) return;
    let ids = [...this.seen];
    if (ids.length > MAX_SEEN) {
      ids = ids.slice(ids.length - MAX_SEEN);
      this.seen = new Set(ids);
    }
    try {
      fs.writeFileSync(this.seenFile, JSON.stringify(ids));
    } catch {
      /* non bloquant */
    }
  }

  patches() {
    return [...this.patchCounts.keys()].sort(comparePatch);
  }

  latestPatch() {
    const p = this.patches();
    return p[p.length - 1] || null;
  }

  previousPatch() {
    const p = this.patches();
    return p[p.length - 2] || null;
  }

  /** Ne garde que les KEEP_PATCHES derniers patchs. */
  prune() {
    const patches = this.patches();
    if (patches.length <= KEEP_PATCHES) return;
    const keep = new Set(patches.slice(-KEEP_PATCHES));
    const kept = this.records.filter((r) => keep.has(r.v));
    this.records = [];
    this.byChamp = new Map();
    this.byPosition = new Map();
    this.meta = [];
    this.patchCounts = new Map();
    this.familyCounts = new Map();
    for (const r of kept) this.index(r);
    if (this.recordsFile) {
      const tmp = `${this.recordsFile}.tmp`;
      fs.writeFileSync(tmp, kept.map((r) => JSON.stringify(r)).join('\n') + (kept.length ? '\n' : ''));
      fs.renameSync(tmp, this.recordsFile);
    }
  }

  /** Fiches d'un champion pour une famille de modes ('sr', 'aram', 'mayhem', 'arena'). */
  byChampion(championKey, family = 'sr') {
    return this.byChamp.get(keyOf(family, championKey)) || [];
  }

  /** Fiches de la Faille pour un poste, tous champions confondus. */
  byRole(role) {
    return this.byPosition.get(role) || [];
  }

  /** Rôle le plus joué par ce champion sur la Faille (ou null). */
  roleShare(championKey) {
    const counts = {};
    const list = this.byChampion(championKey, 'sr');
    for (const r of list) if (r.r) counts[r.r] = (counts[r.r] || 0) + 1;
    const total = list.length || 1;
    return Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v / total]));
  }

  mainRole(championKey) {
    const share = this.roleShare(championKey);
    let best = null;
    for (const [k, v] of Object.entries(share)) if (!best || v > share[best]) best = k;
    return best;
  }

  /** Statistiques de la base (mises en cache : recalculées seulement quand la base change). */
  stats() {
    const c = this.statsCache;
    // pendant la collecte la base change sans arrêt : au plus un recalcul toutes les 4 s
    if (c && (c.version === this.version || (c.loaded === this.loaded && Date.now() - c.at < 4000))) return c.value;
    const value = this.computeStats();
    this.statsCache = { version: this.version, value, at: Date.now(), loaded: this.loaded };
    return value;
  }

  computeStats() {
    const matches = new Set();
    const byFamily = {};
    for (const r of this.records) {
      if (r.lt) continue;
      if (!matches.has(r.m)) {
        matches.add(r.m);
        byFamily[fam(r)] = byFamily[fam(r)] || { records: 0, matches: 0 };
        byFamily[fam(r)].matches++;
      }
    }
    for (const [f, n] of this.familyCounts) {
      byFamily[f] = byFamily[f] || { records: 0, matches: 0 };
      byFamily[f].records = n;
    }
    return {
      records: this.records.length - this.meta.length,
      metaRecords: this.meta.length,
      metaMatches: new Set(this.meta.map((r) => r.m)).size,
      matches: matches.size,
      patches: this.patches(),
      latestPatch: this.latestPatch(),
      byFamily,
      loaded: this.loaded,
    };
  }

  /**
   * Meta d'un palier : par poste, pour chaque champion, parties, % de pick et % de victoire.
   * tier : 'low' (Platine et moins), 'emerald', 'diamond', 'master', 'gm' (Grand Maître et plus).
   * Le palier "gm" reprend les parties de la collecte des builds (Challenger / Grand Maître).
   */
  metaStats(tier) {
    if (!this.metaCache || this.metaCache.version !== this.version) this.metaCache = { version: this.version, byTier: new Map() };
    const hit = this.metaCache.byTier.get(tier);
    if (hit) return hit;
    const patch = this.latestPatch();
    const src = tier === 'gm' ? this.byPositionAll() : this.meta.filter((r) => r.t === tier);
    // dernier patch si assez de parties, sinon les patchs gardés
    let recs = src.filter((r) => r.v === patch);
    if (new Set(recs.map((r) => r.m)).size < 150) recs = src;
    const matches = new Set(recs.map((r) => r.m)).size;
    const roles = {};
    for (const r of recs) {
      if (!r.r) continue;
      const byChamp = (roles[r.r] = roles[r.r] || new Map());
      const c = byChamp.get(r.c) || { key: r.c, n: 0, wins: 0 };
      c.n++;
      c.wins += r.w ? 1 : 0;
      byChamp.set(r.c, c);
    }
    const out = { tier, matches, patch: recs.length && recs.every((r) => r.v === patch) ? patch : null, roles: {} };
    for (const [role, m] of Object.entries(roles)) {
      out.roles[role] = [...m.values()].map((c) => ({ key: c.key, n: c.n, pick: matches ? c.n / matches : 0, win: c.n ? c.wins / c.n : 0 }));
    }
    this.metaCache.byTier.set(tier, out);
    return out;
  }

  byPositionAll() {
    const out = [];
    for (const list of this.byPosition.values()) out.push(...list);
    return out;
  }

  /** Nombre de fiches d'un champion, par famille. */
  countFor(championKey, families = ['sr', 'aram', 'mayhem', 'arena']) {
    const latest = this.latestPatch();
    const out = { total: 0, latest: 0, byFamily: {} };
    for (const f of families) {
      const list = this.byChampion(championKey, f);
      const l = list.filter((r) => r.v === latest).length;
      out.byFamily[f] = { total: list.length, latest: l };
      out.total += list.length;
      out.latest += l;
    }
    return out;
  }
}

module.exports = { Store };
