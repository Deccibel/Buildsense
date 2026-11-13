'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { DDragon } = require('../src/core/ddragon');
const { Store } = require('../src/core/store');
const { Recommender } = require('../src/core/recommender');
const { GameCoach } = require('../src/core/coach');
const { buildDetailView, buildsView } = require('../src/core/pageViews');
const { Pros } = require('../src/core/pros');
const gw = require('../src/core/gameWindow');
const { Updater } = require('../src/core/updater');
const { extractRecords } = require('../src/core/extract');
const { raw } = require('./fixtures/ddragon');
const { ahriRecords, aramAhriRecords } = require('./fixtures/records');
const { match, timeline } = require('./fixtures/match');

const dd = new DDragon().ingest(raw);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bs-v17-'));

test('Store : chargement en fond par morceaux, identique au chargement direct', async () => {
  const dir = tmp();
  const recs = ahriRecords(120);
  fs.writeFileSync(path.join(dir, 'records.jsonl'), recs.map((r) => JSON.stringify(r)).join('\n') + '\n{corrompu\n');
  const a = new Store(dir).load();
  const b = new Store(dir);
  assert.equal(b.loaded, false);
  let changed = 0;
  b.on('change', () => changed++);
  await b.loadAsync({ chunkLines: 7 });
  assert.equal(b.loaded, true);
  assert.equal(changed, 1);
  assert.equal(b.records.length, a.records.length);
  assert.equal(b.stats().records, a.stats().records);
  assert.equal(b.stats(), b.stats(), 'statistiques en cache');
});

test('Data Dragon : démarrage depuis le cache sans réseau', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, `ddragon-${raw.version}-fr_FR.json`), JSON.stringify(raw));
  const d = new DDragon({ cacheDir: dir, language: 'fr_FR', fetchImpl: () => { throw new Error('pas de réseau au démarrage'); } });
  assert.equal(d.loadCached(), true);
  assert.equal(d.ready, true);
  assert.equal(new DDragon({ cacheDir: tmp() }).loadCached(), false);
});

test('Mode d’affichage de LoL : lecture et passage en sans bordure (game.cfg + PersistedSettings)', () => {
  const lol = tmp();
  fs.mkdirSync(path.join(lol, 'Config'));
  fs.writeFileSync(path.join(lol, 'Config', 'game.cfg'), '[General]\r\nWindowMode=0\r\nHeight=1080\r\n[HUD]\r\nWindowMode=9\r\n');
  fs.writeFileSync(
    path.join(lol, 'Config', 'PersistedSettings.json'),
    JSON.stringify({ files: [{ name: 'Game.cfg', sections: [{ name: 'General', settings: [{ name: 'WindowMode', value: '0' }] }] }] }),
  );
  assert.equal(gw.readWindowMode(lol), 0);
  assert.equal(gw.setWindowMode(lol, 2), true);
  assert.equal(gw.readWindowMode(lol), 2);
  const cfg = fs.readFileSync(path.join(lol, 'Config', 'game.cfg'), 'utf8');
  assert.match(cfg, /\[General\]\r\nWindowMode=2\r\n/);
  assert.match(cfg, /\[HUD\]\r\nWindowMode=9/, 'les autres sections ne bougent pas');
  assert.ok(fs.existsSync(path.join(lol, 'Config', 'game.cfg.buildsense.bak')), 'sauvegarde');
  assert.equal(gw.parseWindowMode(gw.withWindowMode('[General]\nHeight=1', 1)), 1);
  assert.equal(gw.detectLeaguePath(lol), lol);
});

test('Analyse de partie : points forts, points faibles et tutos', () => {
  const champ = dd.champion(103);
  const mk = (t, s, extra = {}) => ({
    gameTime: t,
    me: { champ, position: 'MIDDLE', level: 9, gold: 300, items: [], isDead: false, scores: s, ...extra },
    allies: [{ scores: { kills: 2 } }, { scores: { kills: 3 } }],
    enemies: [{ position: 'MIDDLE', level: 12, championName: 'Zed', scores: {} }],
  });
  const c = new GameCoach();
  c.update(mk(60, { kills: 0, deaths: 0, assists: 0, creepScore: 5, wardScore: 1 }), dd);
  for (let t = 70; t <= 300; t += 10) c.update(mk(t, { kills: 0, deaths: 0, assists: 0, creepScore: 20, wardScore: 2 }, { gold: 2000 }), dd);
  c.update(mk(1200, { kills: 1, deaths: 7, assists: 1, creepScore: 90, wardScore: 4 }), dd);
  const r = c.report({ dd, role: 'MIDDLE', champion: champ.name, family: 'sr', final: true });
  const ids = r.improve.map((x) => x.id);
  assert.ok(ids.includes('deaths') && ids.includes('cs') && ids.includes('gold') && ids.includes('level') && ids.includes('vision'), ids.join(','));
  assert.equal(r.improve[0].severity, 3, 'les plus importants en premier');
  const video = r.improve[0].resources.find((x) => x.kind === 'video');
  assert.match(video.url, /^https:\/\/www\.youtube\.com\/results\?search_query=/);
  assert.ok(r.improve[0].how.length >= 3, 'fiche écrite');
  assert.equal(r.stats.find((s) => s.id === 'cs').grade, 'bad');
});

test('Builds : mode de jeu, détail d’un build et pourquoi chaque objet', () => {
  const store = new Store(null);
  store.add([...ahriRecords(200), ...aramAhriRecords(120)].map((r, i) => (r.q === 'aram' ? r : { ...r, pn: `Joueur${i % 3}#EUW`, pl: i % 3 ? 'G900' : 'C1500' })));
  const rec = new Recommender({ store, dd });
  const pros = new Pros();
  const sr = buildsView({ dd, rec, pros }, 103, 'MIDDLE', 'sr');
  assert.ok(sr.variants.length >= 1);
  const det = buildDetailView({ dd, rec, pros }, 103, 'MIDDLE', 'sr', sr.variants[0].id);
  assert.ok(det.slots.length >= 3);
  assert.ok(det.slots[0].why.length >= 1);
  assert.ok(det.players.length >= 1 && det.players[0].rank);
  const aram = buildsView({ dd, rec, pros }, 103, '', 'aram');
  assert.equal(aram.family, 'aram');
  assert.ok(aram.variants.every((v) => !v.boots), 'ARAM : pas de bottes');
});

test('Pros : liste du dépôt et tag d’équipe', () => {
  const p = new Pros();
  p.ingest({ players: { 'Hide on bush#KR1': { name: 'Faker', team: 'T1', role: 'MID' } } });
  assert.deepEqual(p.identify('hide on bush#kr1'), { name: 'Faker', team: 'T1', role: 'MID', sure: true });
  assert.equal(p.identify('G2 Caps#1323').team, 'G2 Esports');
  assert.equal(p.identify('G2 Caps#1323').sure, false);
  assert.equal(p.identify('Toto#EUW'), null);
  assert.equal(p.identify('go Flash#EUW'), null, 'minuscules : pas un tag');
});

test('Extraction : Riot ID et rang des joueurs Challenger/GM', () => {
  const ranks = new Map([[match.info.participants[0].puuid, 'C1234']]);
  const m = JSON.parse(JSON.stringify(match));
  m.info.participants[0].riotIdGameName = 'Caps';
  m.info.participants[0].riotIdTagline = 'G2';
  const recs = extractRecords(m, timeline, dd, { ranks });
  assert.equal(recs[0].pn, 'Caps#G2');
  assert.equal(recs[0].pl, 'C1234');
});

test('Mises à jour : canal bêta = la plus récente entre bêta et stable', async () => {
  const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
  const BETA = 'https://github.com/x/bs/releases/download/beta/latest.json';
  const STABLE = 'https://github.com/x/bs/releases/latest/download/latest.json';
  const pay = Buffer.from('installeur');
  const man = (v) => ({ version: v, notes: [], installer: { url: `https://github.com/x/bs/releases/download/v${v}/BuildSense-Setup-${v}.exe`, sha256: sha(pay), size: pay.length } });
  const feeds = { [BETA]: man('1.7.0'), [STABLE]: man('1.6.0') };
  const fetchImpl = async (url) => {
    const f = Object.keys(feeds).find((k) => url.startsWith(k));
    return f ? new Response(JSON.stringify(feeds[f])) : new Response('x', { status: 404 });
  };
  const u = new Updater({ currentVersion: '1.6.0', feedUrl: BETA, fetchImpl, downloadDir: tmp() });
  u.setExtraFeeds([STABLE]);
  assert.equal((await u.check()).latest, '1.7.0');
  feeds[STABLE] = man('1.7.1');
  assert.equal((await u.check()).latest, '1.7.1', 'stable plus récente que la bêta');
  delete feeds[BETA];
  assert.equal((await u.check()).latest, '1.7.1', 'pas encore de bêta : la stable suffit');
});

test('Raccourcis en jeu : combinaisons lues par keywatch', () => {
  const { comboOf } = require('../src/core/keywatch');
  assert.deepEqual(comboOf('CommandOrControl+Shift+H'), { ctrl: true, shift: true, alt: false, win: false, vk: 72 });
  assert.equal(comboOf('Alt+F12').vk, 123);
  assert.equal(comboOf('Super+num0').vk, 96);
  assert.equal(comboOf('Shift+PageDown').vk, 34);
  assert.equal(comboOf(''), null);
  assert.equal(comboOf('Shift+?'), null);
});
