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
    this.seen = new Set();
    this.patchCounts = new Map();
    this.familyCounts = new Map();
    this.version = 0;
    this.pendingSeen = 0;
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
    this.version++;
    return this;
  }

  index(rec) {
    this.records.push(rec);
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

  stats() {
    const matches = new Set();
    const byFamily = {};
    for (const r of this.records) {
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
      records: this.records.length,
      matches: matches.size,
      patches: this.patches(),
      latestPatch: this.latestPatch(),
      byFamily,
    };
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
