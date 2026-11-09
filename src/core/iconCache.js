'use strict';

const fs = require('fs');
const path = require('path');
const { compareVersion } = require('./util');

const DEFAULT_REMOTE = 'https://ddragon.leagueoflegends.com';
const SAFE_SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9_.\- ]*$/;

/**
 * Cache disque des icônes Data Dragon (objets, champions, runes, sorts).
 * Une icône absente est téléchargée une seule fois, puis servie depuis le disque.
 */
class IconCache {
  constructor({ dir, remoteBase = DEFAULT_REMOTE, fetchImpl = null }) {
    this.dir = dir;
    this.remoteBase = remoteBase.replace(/\/+$/, '');
    this.fetch = fetchImpl || globalThis.fetch;
    this.inflight = new Map();
    this.failed = new Map();
  }

  /** Chemin relatif sûr ("cdn/16.21.1/img/item/3157.png") ou null. */
  safeRel(rel) {
    const clean = String(rel || '').replace(/^\/+/, '');
    const parts = clean.split('/');
    if (!clean || parts.length > 8 || !parts.every((p) => SAFE_SEGMENT.test(p) && p !== '..')) return null;
    if (!/\.(png|jpg|jpeg|webp)$/i.test(clean)) return null;
    return parts.join('/');
  }

  filePath(rel) {
    return path.join(this.dir, ...rel.split('/'));
  }

  has(rel) {
    const r = this.safeRel(rel);
    return !!r && fs.existsSync(this.filePath(r));
  }

  async get(rel) {
    const r = this.safeRel(rel);
    if (!r) return null;
    const file = this.filePath(r);
    try {
      return await fs.promises.readFile(file);
    } catch {
      /* pas encore en cache */
    }
    // évite de re-tenter en boucle une icône introuvable (5 min)
    const failedAt = this.failed.get(r);
    if (failedAt && Date.now() - failedAt < 5 * 60 * 1000) return null;
    if (this.inflight.has(r)) return this.inflight.get(r);
    const p = this.download(r, file).finally(() => this.inflight.delete(r));
    this.inflight.set(r, p);
    return p;
  }

  async download(rel, file) {
    try {
      const res = await this.fetch(`${this.remoteBase}/${rel.split('/').map(encodeURIComponent).join('/')}`);
      if (!res.ok) {
        this.failed.set(rel, Date.now());
        return null;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await fs.promises.writeFile(tmp, buf);
      await fs.promises.rename(tmp, file);
      return buf;
    } catch {
      this.failed.set(rel, Date.now());
      return null;
    }
  }

  /** Télécharge en fond les icônes manquantes (quelques-unes à la fois). */
  async prefetch(rels, { concurrency = 6, onProgress = null } = {}) {
    const todo = rels.map((r) => this.safeRel(r)).filter((r) => r && !fs.existsSync(this.filePath(r)));
    let done = 0;
    let ok = 0;
    const worker = async () => {
      while (todo.length) {
        const r = todo.shift();
        if (await this.get(r)) ok++;
        done++;
        if (onProgress) onProgress(done, done + todo.length);
      }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
    return { downloaded: ok, attempted: done };
  }

  /** Supprime les icônes des anciens patchs (garde les `keep` plus récents). */
  pruneVersions(keep = 2) {
    const cdn = path.join(this.dir, 'cdn');
    let versions;
    try {
      versions = fs.readdirSync(cdn).filter((d) => /^\d+\.\d+\.\d+$/.test(d));
    } catch {
      return;
    }
    versions.sort(compareVersion);
    for (const v of versions.slice(0, Math.max(0, versions.length - keep))) {
      fs.rmSync(path.join(cdn, v), { recursive: true, force: true });
    }
  }
}

module.exports = { IconCache, DEFAULT_REMOTE };
