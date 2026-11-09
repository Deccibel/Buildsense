'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { Updater, compareVersions, manifestError, allowedUrl } = require('../src/core/updater');

const FEED = 'https://github.com/pacome/buildsense/releases/latest/download/latest.json';
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bs-upd-'));

function manifest(version, payload, patch = {}) {
  return {
    version,
    date: '2026-11-08',
    notes: ['Mises à jour automatiques', '  ', 42],
    installer: { url: `https://github.com/pacome/buildsense/releases/download/v${version}/BuildSense-Setup-${version}.exe`, sha256: sha(payload), size: payload.length },
    ...patch,
  };
}

/** Faux réseau : latest.json + installeur. */
function fakeFetch(m, payload, { corrupt = false, status = 200 } = {}) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    if (url.startsWith(FEED)) return status === 200 ? new Response(JSON.stringify(m)) : new Response('not found', { status });
    const body = corrupt ? Buffer.from(payload).fill(7) : payload;
    return new Response(body);
  };
  fn.calls = calls;
  return fn;
}

test('Comparaison de versions', () => {
  assert.equal(compareVersions('1.3.0', '1.2.0'), 1);
  assert.equal(compareVersions('1.2.10', '1.2.9'), 1);
  assert.equal(compareVersions('1.2.0', '1.2.0'), 0);
  assert.equal(compareVersions('0.9.9', '1.0.0'), -1);
  assert.equal(compareVersions('bidon', '1.0.0'), 0);
});

test('Manifeste : adresses et contrôles obligatoires', () => {
  const payload = Buffer.from('installeur');
  assert.equal(manifestError(manifest('1.3.0', payload), FEED), null);
  assert.match(manifestError(manifest('1.3', payload), FEED), /version/);
  assert.match(manifestError(manifest('1.3.0', payload, { installer: { url: 'http://github.com/x.exe', sha256: sha(payload), size: 3 } }), FEED), /refusée/);
  assert.match(manifestError(manifest('1.3.0', payload, { installer: { url: 'https://evil.example/x.exe', sha256: sha(payload), size: 3 } }), FEED), /refusée/);
  assert.match(manifestError(manifest('1.3.0', payload, { installer: { url: 'https://github.com/x.exe', sha256: 'abc', size: 3 } }), FEED), /SHA-256/);
  assert.ok(allowedUrl('https://objects.githubusercontent.com/abc', FEED));
  assert.ok(!allowedUrl('https://githubusercontent.com.evil.io/abc', FEED));
});

test('Nouvelle version : détectée, téléchargée, vérifiée, prête à installer', async () => {
  const dir = tmp();
  const payload = crypto.randomBytes(300 * 1024);
  const fetchImpl = fakeFetch(manifest('1.3.0', payload), payload);
  const up = new Updater({ currentVersion: '1.2.0', feedUrl: FEED, fetchImpl, downloadDir: dir });
  const seen = [];
  up.on('change', (s) => seen.push(s.status));

  let s = await up.check();
  assert.equal(s.status, 'available');
  assert.equal(s.latest, '1.3.0');
  assert.deepEqual(s.notes, ['Mises à jour automatiques']);
  assert.equal(up.installCommand(), null);

  s = await up.download();
  assert.equal(s.status, 'ready');
  assert.equal(s.received, payload.length);
  const cmd = up.installCommand();
  assert.deepEqual(cmd.args, ['/S', '--relaunch']);
  assert.deepEqual(fs.readFileSync(cmd.file), payload);
  assert.ok(seen.includes('checking') && seen.includes('downloading'));

  // relance de l'appli : l'installeur déjà vérifié est réutilisé, sans nouveau téléchargement
  const again = new Updater({ currentVersion: '1.2.0', feedUrl: FEED, fetchImpl, downloadDir: dir });
  const before = fetchImpl.calls.length;
  assert.equal((await again.check()).status, 'ready');
  assert.equal(fetchImpl.calls.length, before + 1, 'seul latest.json est relu');

  // après la mise à jour : l'ancien installeur est supprimé
  const after = new Updater({ currentVersion: '1.3.0', feedUrl: FEED, fetchImpl, downloadDir: dir });
  after.cleanup();
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('Fichier corrompu : refusé et supprimé, rien à installer', async () => {
  const dir = tmp();
  const payload = crypto.randomBytes(64 * 1024);
  const up = new Updater({ currentVersion: '1.2.0', feedUrl: FEED, fetchImpl: fakeFetch(manifest('1.3.0', payload), payload, { corrupt: true }), downloadDir: dir });
  await up.check();
  const s = await up.download();
  assert.equal(s.status, 'available');
  assert.match(s.error, /corrompu/);
  assert.equal(up.installCommand(), null);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('Déjà à jour, aucune version publiée, adresse non configurée', async () => {
  const payload = Buffer.from('x');
  let up = new Updater({ currentVersion: '1.3.0', feedUrl: FEED, fetchImpl: fakeFetch(manifest('1.3.0', payload), payload), downloadDir: tmp() });
  assert.equal((await up.check()).status, 'up-to-date');

  // dépôt sans aucune version publiée : considéré à jour, sans message d'erreur
  up = new Updater({ currentVersion: '1.3.0', feedUrl: FEED, fetchImpl: fakeFetch(null, payload, { status: 404 }), downloadDir: tmp() });
  const s = await up.check();
  assert.equal(s.status, 'up-to-date');
  assert.equal(s.error, null);

  up = new Updater({ currentVersion: '1.3.0', feedUrl: FEED, fetchImpl: fakeFetch(null, payload, { status: 500 }), downloadDir: tmp() });
  assert.equal((await up.check()).status, 'error');

  up = new Updater({ currentVersion: '1.3.0', feedUrl: null, fetchImpl: fakeFetch(null, payload), downloadDir: tmp() });
  assert.equal((await up.check()).status, 'disabled');
});

test('Téléchargement interrompu (partie lancée) : sans erreur, reprendra plus tard', async () => {
  const dir = tmp();
  const payload = crypto.randomBytes(256 * 1024);
  const m = manifest('1.3.0', payload);
  const fetchImpl = async (url, opts = {}) => {
    if (url.startsWith(FEED)) return new Response(JSON.stringify(m));
    // flux lent qui respecte l'annulation
    const stream = new ReadableStream({
      async pull(ctrl) {
        await new Promise((r) => setTimeout(r, 20));
        if (opts.signal && opts.signal.aborted) return ctrl.error(new Error('aborted'));
        ctrl.enqueue(payload.subarray(0, 1024));
      },
    });
    return new Response(stream);
  };
  const up = new Updater({ currentVersion: '1.2.0', feedUrl: FEED, fetchImpl, downloadDir: dir });
  await up.check();
  const p = up.download();
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(up.status().status, 'downloading');
  up.cancel();
  const s = await p;
  assert.equal(s.status, 'available');
  assert.equal(s.error, null);
  assert.deepEqual(fs.readdirSync(dir), []);
});
