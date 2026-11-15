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
  assert.ok(fs.existsSync(path.join(lol, 'Config', 'game.cfg.stonks.bak')), 'sauvegarde');
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
  const man = (v) => ({ version: v, notes: [], installer: { url: `https://github.com/x/bs/releases/download/v${v}/Stonks-Setup-${v}.exe`, sha256: sha(pay), size: pay.length } });
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

test('Tes parties : bilan complet depuis match + timeline', () => {
  const mg = require('../src/core/myGames');
  const m = JSON.parse(JSON.stringify(match));
  m.info.participants.forEach((p, i) => Object.assign(p, { kills: i === 2 ? 6 : 2, deaths: i === 2 ? 3 : 4, assists: 5, totalMinionsKilled: 180, neutralMinionsKilled: 8, visionScore: 20, wardsPlaced: 9, visionWardsBoughtInGame: 2, totalDamageDealtToChampions: 15000 }));
  const frame = (min) => ({
    timestamp: min * 60000,
    participantFrames: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(i + 1), { minionsKilled: (i === 2 ? 7 : 6) * min, jungleMinionsKilled: 0, totalGold: (i === 2 ? 420 : 400) * min, xp: 400 * min }])),
    events: min === 4 ? [{ type: 'CHAMPION_KILL', victimId: 3, timestamp: 4.5 * 60000 }] : min === 12 ? [{ type: 'CHAMPION_KILL', victimId: 3, timestamp: 12 * 60000 }, { type: 'CHAMPION_KILL', victimId: 8, timestamp: 12.2 * 60000 }] : [],
  });
  const tl = { info: { frames: Array.from({ length: 20 }, (_, i) => frame(i)) } };
  const g = mg.analyzeMatch(m, tl, 'puuid-3', dd);
  assert.equal(g.r, 'MIDDLE');
  assert.equal(g.cs10, 70);
  assert.equal(g.opp.cs10, 60);
  assert.equal(g.gd15, 300);
  assert.deepEqual(g.deaths, [4.5, 12]);
  assert.equal(g.d10, 1);
  assert.equal(g.opp.d10, 0);
  assert.equal(g.kp, round2(11 / 14));
  assert.equal(mg.analyzeMatch(m, tl, 'inconnu', dd), null);
  m.info.gameDuration = 200;
  assert.equal(mg.analyzeMatch(m, tl, 'puuid-3', dd), null, 'remake ignoré');
});
function round2(x) {
  return Math.round(x * 100) / 100;
}

test('Tes parties : tendances, point faible et objectif de session', () => {
  const mg = require('../src/core/myGames');
  const game = (i, over = {}) => ({ id: `G${i}`, at: 1000 - i, queue: 420, family: 'sr', c: 103, r: 'MIDDLE', w: i % 2, d: 30, k: 5, de: 5, a: 5, cs: 180, csMin: 6, cs10: 50, d10: 1, visMin: 0.6, kp: 0.5, gd15: -100, opp: { csMin: 7, cs10: 68, d10: 1, de: 5, visMin: 0.6, kp: 0.5 }, ...over });
  const store = new mg.MyGames(null);
  assert.equal(store.add(Array.from({ length: 12 }, (_, i) => game(i))), 12);
  assert.equal(store.add([game(0)]), 0, 'pas de doublon');
  store.add([{ ...game(99), queue: 450, r: '' }]);
  assert.equal(store.comparable().length, 12, 'ARAM hors tendances');
  assert.equal(store.mainRole(), 'MIDDLE');
  const tr = mg.trends(store.comparable({ role: 'MIDDLE' }), 'MIDDLE');
  const cs10 = tr.find((t) => t.id === 'cs10');
  assert.equal(cs10.mine, 50);
  assert.equal(cs10.bench, 68);
  assert.equal(mg.weakness(tr).id, 'cs10');
  const goal = mg.pickGoal('auto', tr, 'MIDDLE');
  assert.equal(goal.id, 'cs10');
  assert.equal(goal.target, 59, 'à mi-chemin entre ta moyenne et tes adversaires');
  assert.equal(mg.pickGoal('deaths', tr, 'MIDDLE').target, 4);
  assert.equal(mg.pickGoal('cs10', [], 'UTILITY').id, 'vision', 'support : pas d’objectif de farm');
  assert.equal(mg.pickGoal('auto', [], 'TOP').target, 62, 'sans historique : repère du poste');
  // suivi en direct
  const live = (o) => ({ time: 300, cs: 20, deaths: 0, kills: 0, assists: 0, teamKills: 0, vision: 0, cs10: null, d10: 0, ...o });
  assert.equal(mg.liveGoal(goal, live({ cs: 30 })).state, 'ahead');
  assert.equal(mg.liveGoal(goal, live({ cs: 10 })).state, 'behind');
  assert.equal(mg.liveGoal(goal, live({ time: 700, cs: 90, cs10: 61 })).state, 'done');
  assert.equal(mg.liveGoal(goal, live({ time: 700, cs: 90, cs10: 40 })).state, 'failed');
  assert.equal(mg.liveGoal(goal, live({ time: 700, cs: 90, cs10: null })).state, 'wait', 'Stonks lancé après 10 min');
  const early = mg.pickGoal('early', tr, 'MIDDLE');
  assert.equal(mg.liveGoal(early, live({ deaths: 1, d10: 1 })).state, 'failed');
  assert.equal(mg.liveGoal(early, live({ time: 900, deaths: 3, d10: 0 })).state, 'done');
  // résultat sur la partie terminée
  assert.equal(mg.goalResult(goal, game(1, { cs10: 60 })).ok, true);
  assert.equal(mg.goalResult(goal, game(1, { cs10: 58 })).ok, false);
  assert.equal(mg.goalResult(goal, game(1, { cs10: null })), null);
});
