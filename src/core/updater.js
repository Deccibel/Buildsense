'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

/**
 * Mises à jour de BuildSense.
 *
 * Chaque version publiée (GitHub Releases) contient l'installeur et un petit fichier latest.json :
 *   { "version": "1.3.0", "date": "2026-11-08", "notes": ["..."],
 *     "installer": { "url": "https://.../BuildSense-Setup-1.3.0.exe", "sha256": "…", "size": 123 } }
 * L'appli lit latest.json, télécharge l'installeur en fond, vérifie sa taille et son empreinte SHA-256,
 * puis le lance en mode silencieux (aucune fenêtre, aucun droit administrateur) et redémarre.
 *
 * Ce module ne dépend pas d'Electron : `fetchImpl` est net.fetch dans l'appli, un faux dans les tests.
 */

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const MAX_SIZE = 600 * 1024 * 1024;

/** -1, 0 ou 1 (versions "1.2.3"). */
function compareVersions(a, b) {
  const pa = SEMVER.exec(String(a || ''));
  const pb = SEMVER.exec(String(b || ''));
  if (!pa || !pb) return 0;
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** Hôtes acceptés pour l'installeur : celui du manifeste, ou GitHub (les fichiers des versions y sont servis). */
function allowedUrl(url, feedUrl) {
  let u;
  let f;
  try {
    u = new URL(url);
    f = new URL(feedUrl);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  return u.host === f.host || u.hostname === 'github.com' || u.hostname.endsWith('.githubusercontent.com');
}

/** Vérifie le manifeste ; renvoie une erreur lisible ou null. */
function manifestError(m, feedUrl) {
  if (!m || typeof m !== 'object') return 'fichier de version illisible';
  if (!SEMVER.test(String(m.version || ''))) return 'numéro de version invalide';
  const ins = m.installer;
  if (!ins || typeof ins !== 'object') return 'installeur manquant';
  if (!allowedUrl(ins.url, feedUrl)) return 'adresse de téléchargement refusée';
  if (!/^[a-f0-9]{64}$/i.test(String(ins.sha256 || ''))) return 'empreinte SHA-256 manquante';
  if (!Number.isInteger(ins.size) || ins.size <= 0 || ins.size > MAX_SIZE) return 'taille invalide';
  return null;
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', (d) => h.update(d))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')));
  });
}

function withTimeout(promise, ms, what) {
  let t;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      t = setTimeout(() => reject(new Error(`${what} : délai dépassé`)), ms);
    }),
  ]).finally(() => clearTimeout(t));
}

class Updater extends EventEmitter {
  /**
   * @param {{ currentVersion: string, feedUrl: string|null, fetchImpl: Function, downloadDir: string }} opts
   */
  constructor({ currentVersion, feedUrl, fetchImpl, downloadDir }) {
    super();
    this.currentVersion = currentVersion;
    this.feedUrl = feedUrl || null;
    this.fetch = fetchImpl;
    this.downloadDir = downloadDir;
    this.manifest = null;
    this.file = null;
    this.busy = null;
    this.controller = null;
    this.state = {
      status: this.feedUrl ? 'idle' : 'disabled', // idle | checking | up-to-date | available | downloading | ready | error | disabled
      current: currentVersion,
      latest: null,
      notes: [],
      date: null,
      size: 0,
      received: 0,
      error: null,
      checkedAt: null,
    };
  }

  set(patch) {
    Object.assign(this.state, patch);
    this.emit('change', this.status());
  }

  status() {
    return { ...this.state, notes: this.state.notes.slice() };
  }

  /** Lit latest.json. Ne télécharge rien. */
  async check() {
    if (!this.feedUrl) return this.status();
    if (this.busy) return this.busy.then(() => this.status());
    const prev = this.state.status;
    if (prev !== 'downloading' && prev !== 'ready') this.set({ status: 'checking', error: null });
    this.busy = (async () => {
      try {
        const m = await this.fetchBest();
        if (!m) {
          // dépôt sans version publiée : rien de plus récent
          this.manifest = null;
          this.set({ status: 'up-to-date', latest: null, notes: [], error: null, checkedAt: Date.now() });
          return;
        }
        const newer = compareVersions(m.version, this.currentVersion) > 0;
        if (!newer) {
          this.manifest = null;
          this.set({ status: 'up-to-date', latest: m.version, notes: [], error: null, checkedAt: Date.now() });
          return;
        }
        const same = this.manifest && this.manifest.version === m.version && this.manifest.installer.sha256 === m.installer.sha256;
        this.manifest = m;
        const notes = (Array.isArray(m.notes) ? m.notes : [m.notes]).filter((n) => typeof n === 'string' && n.trim()).map((n) => n.trim()).slice(0, 12);
        if (same && (prev === 'downloading' || prev === 'ready')) {
          this.set({ status: prev, checkedAt: Date.now() });
          return;
        }
        this.file = null;
        // installeur déjà téléchargé et vérifié lors d'une session précédente ?
        const done = this.targetFile();
        if (fs.existsSync(done) && fs.statSync(done).size === m.installer.size && (await sha256File(done)) === m.installer.sha256.toLowerCase()) {
          this.file = done;
          this.set({ status: 'ready', latest: m.version, notes, date: m.date || null, size: m.installer.size, received: m.installer.size, error: null, checkedAt: Date.now() });
          return;
        }
        this.set({ status: 'available', latest: m.version, notes, date: m.date || null, size: m.installer.size, received: 0, error: null, checkedAt: Date.now() });
      } catch (e) {
        this.set({ status: prev === 'ready' || prev === 'downloading' ? prev : 'error', error: e.message || String(e), checkedAt: Date.now() });
      }
    })();
    try {
      await this.busy;
    } finally {
      this.busy = null;
    }
    return this.status();
  }

  /**
   * Lit le(s) latest.json. Canal bêta : deux sources (bêta et stable), on garde la version la plus récente.
   * Renvoie le manifeste (avec .channel) ou null si rien n'est publié ; lève une erreur si tout a échoué.
   */
  async fetchBest() {
    const feeds = Array.isArray(this.extraFeeds) && this.extraFeeds.length ? [this.feedUrl, ...this.extraFeeds] : [this.feedUrl];
    let best = null;
    let lastErr = null;
    let anyOk = false;
    for (const feed of feeds) {
      try {
        const sep = feed.includes('?') ? '&' : '?';
        const res = await withTimeout(this.fetch(`${feed}${sep}t=${Date.now()}`, { cache: 'no-store' }), 20000, 'Vérification');
        if (res.status === 404) {
          anyOk = true;
          continue;
        }
        if (!res.ok) throw new Error(`serveur de mises à jour : erreur ${res.status}`);
        const m = await res.json();
        const err = manifestError(m, feed);
        if (err) throw new Error(err);
        anyOk = true;
        if (!best || compareVersions(m.version, best.version) > 0) best = m;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!anyOk && lastErr) throw lastErr;
    return best;
  }

  /** Sources supplémentaires (canal bêta : la source stable en plus). */
  setExtraFeeds(list) {
    this.extraFeeds = (list || []).filter(Boolean);
  }

  /** Change la source des mises à jour (réglages). */
  setFeed(feedUrl) {
    if ((feedUrl || null) === this.feedUrl) return;
    this.cancel();
    this.feedUrl = feedUrl || null;
    this.manifest = null;
    this.file = null;
    this.set({ status: this.feedUrl ? 'idle' : 'disabled', latest: null, notes: [], received: 0, size: 0, error: null });
  }

  targetFile() {
    return path.join(this.downloadDir, `BuildSense-Setup-${this.manifest.version}.exe`);
  }

  /** Télécharge l'installeur annoncé, vérifie taille et SHA-256. */
  async download() {
    if (!this.manifest || this.state.status === 'downloading') return this.status();
    if (this.state.status === 'ready' && this.file) return this.status();
    const m = this.manifest;
    const target = this.targetFile();
    const part = `${target}.part`;
    this.set({ status: 'downloading', received: 0, size: m.installer.size, error: null });
    try {
      fs.mkdirSync(this.downloadDir, { recursive: true });
      this.controller = typeof AbortController === 'function' ? new AbortController() : null;
      const res = await withTimeout(this.fetch(m.installer.url, this.controller ? { signal: this.controller.signal } : {}), 30000, 'Téléchargement');
      if (!res.ok || !res.body) throw new Error(`téléchargement refusé (erreur ${res.status})`);
      if (res.url && !String(res.url).startsWith('https:')) throw new Error('téléchargement non sécurisé refusé');
      const hash = crypto.createHash('sha256');
      const out = fs.createWriteStream(part);
      let received = 0;
      let lastEmit = 0;
      try {
        for await (const chunk of res.body) {
          const buf = Buffer.from(chunk);
          received += buf.length;
          if (received > m.installer.size) throw new Error('fichier plus gros qu’annoncé : téléchargement annulé');
          hash.update(buf);
          if (!out.write(buf)) await new Promise((r) => out.once('drain', r));
          const now = Date.now();
          if (now - lastEmit > 250) {
            lastEmit = now;
            this.set({ received });
          }
        }
      } finally {
        await new Promise((r) => out.end(r));
      }
      if (received !== m.installer.size) throw new Error('téléchargement incomplet');
      if (hash.digest('hex') !== m.installer.sha256.toLowerCase()) throw new Error('fichier corrompu (empreinte différente) : supprimé');
      fs.renameSync(part, target);
      this.file = target;
      this.set({ status: 'ready', received });
    } catch (e) {
      try {
        fs.rmSync(part, { force: true });
      } catch {
        /* rien */
      }
      const cancelled = this.controller && this.controller.signal.aborted;
      this.set({ status: 'available', received: 0, error: cancelled ? null : e.message || String(e) });
    } finally {
      this.controller = null;
    }
    return this.status();
  }

  /** Interrompt le téléchargement (ex. une partie commence) ; il pourra reprendre plus tard. */
  cancel() {
    if (this.controller) this.controller.abort();
  }

  /** Commande à lancer pour installer (null si rien de prêt). */
  installCommand() {
    if (this.state.status !== 'ready' || !this.file || !fs.existsSync(this.file)) return null;
    return { file: this.file, args: ['/S', '--relaunch'] };
  }

  /** Supprime les installeurs déjà utilisés (versions ≤ version actuelle). */
  cleanup() {
    try {
      for (const f of fs.readdirSync(this.downloadDir)) {
        const v = /^BuildSense-Setup-(\d+\.\d+\.\d+)\.exe(\.part)?$/.exec(f);
        if (v && (v[2] || compareVersions(v[1], this.currentVersion) <= 0)) fs.rmSync(path.join(this.downloadDir, f), { force: true });
      }
    } catch {
      /* dossier absent */
    }
  }
}

module.exports = { Updater, compareVersions, manifestError, allowedUrl, sha256File };
