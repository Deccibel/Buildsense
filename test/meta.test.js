'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { DDragon } = require('../src/core/ddragon');
const { Store } = require('../src/core/store');
const { Recommender } = require('../src/core/recommender');
const { Crawler } = require('../src/core/crawler');
const { raw } = require('./fixtures/ddragon');
const { ahriRecords, roleRecords } = require('./fixtures/records');
const { match, timeline } = require('./fixtures/match');

const dd = new DDragon().ingest(raw);
const clone = (o) => JSON.parse(JSON.stringify(o));
const OFF = { sr: false, aram: false, mayhem: false, arena: false, meta: false };

test('Collecte meta : parties de joueurs de chaque palier, fiches légères sans build', async () => {
  const store = new Store(null);
  let n = 0;
  const calls = [];
  const api = {
    requestCount: 0,
    async league(tier) {
      calls.push(`league:${tier}`);
      return tier === 'master' ? { entries: [{ puuid: 'm1' }] } : tier === 'challenger' ? { entries: [{ puuid: 'c1' }] } : { entries: [] };
    },
    async leagueEntries(tier, div) {
      calls.push(`entries:${tier}`);
      return [{ puuid: `${tier}-${div}` }];
    },
    async matchIds() {
      return [`META_${n++}`];
    },
    async match(id) {
      const m = clone(match);
      m.metadata.matchId = id;
      return m;
    },
    async timeline() {
      throw new Error('pas de timeline pour la meta');
    },
  };
  const crawler = new Crawler({ api, store, dd, getConfig: () => ({ favorites: [], collectModes: { ...OFF, meta: true } }) });
  crawler.running = true;
  for (let i = 0; i < 4; i++) await crawler.step();
  const tiers = new Set(store.meta.map((r) => r.t));
  assert.deepEqual([...tiers].sort(), ['diamond', 'emerald', 'low', 'master']);
  assert.ok(calls.some((c) => /entries:(PLATINUM|GOLD|SILVER|BRONZE|IRON)/.test(c)), 'Plat et moins : paliers bas');
  assert.ok(store.meta.every((r) => r.lt && !r.co), 'fiches légères');
  // les fiches meta ne servent jamais aux builds
  assert.equal(store.byChampion(match.info.participants[0].championId).length, 0);
  assert.equal(crawler.status().families.meta.matchesAdded, 4);
});

test('Meta : % de pick et % de victoire par poste et par palier', () => {
  const store = new Store(null);
  const recs = [];
  for (let i = 0; i < 20; i++) {
    recs.push({ m: `E${i}`, v: '16.21', q: 'sr', t: 'emerald', c: 103, r: 'MIDDLE', w: i < 12 ? 1 : 0, lt: 1 });
    if (i < 5) recs.push({ m: `E${i}`, v: '16.21', q: 'sr', t: 'emerald', c: 238, r: 'MIDDLE', w: 0, lt: 1 });
  }
  store.add(recs);
  store.add([...ahriRecords(40), ...roleRecords()]);
  const em = store.metaStats('emerald');
  assert.equal(em.matches, 20);
  const ahri = em.roles.MIDDLE.find((c) => c.key === 103);
  assert.equal(ahri.pick, 1);
  assert.equal(ahri.win, 0.6);
  // Grand Maître et plus : parties de la collecte des builds
  const gm = store.metaStats('gm');
  assert.ok(gm.roles.MIDDLE.some((c) => c.key === 103 && c.n > 0));
  assert.equal(store.metaStats('diamond').matches, 0);
});

test('Joueur suivi : ses parties sont collectées sur son serveur et marquées', async () => {
  const store = new Store(null);
  const seen = [];
  const m = clone(match);
  m.metadata.matchId = 'KR_1';
  const target = m.info.participants[2];
  target.puuid = 'faker-puuid';
  const api = {
    requestCount: 0,
    async league(tier) {
      return tier === 'challenger' ? { entries: [{ puuid: 'c1' }] } : { entries: [] };
    },
    async accountByRiotId(name, tag, platform) {
      seen.push(`account:${name}#${tag}@${platform}`);
      return { puuid: 'faker-puuid' };
    },
    async matchIds(puuid, { platform }) {
      seen.push(`ids:${puuid}@${platform}`);
      return puuid === 'faker-puuid' ? ['KR_1'] : [];
    },
    async match(id, platform) {
      seen.push(`match:${id}@${platform}`);
      return m;
    },
    async timeline() {
      return timeline;
    },
    async topMasteries() {
      return [];
    },
  };
  const cfg = { favorites: [], collectModes: { ...OFF, sr: true }, followed: [{ id: 'f1', name: 'Hide on bush#KR1', platform: 'kr' }] };
  const crawler = new Crawler({ api, store, dd, getConfig: () => cfg });
  crawler.running = true;
  await crawler.step();
  assert.deepEqual(seen.slice(0, 3), ['account:Hide on bush#KR1@kr', 'ids:faker-puuid@kr', 'match:KR_1@kr']);
  const mine = store.byChampion(target.championId).filter((r) => r.fp === 'f1');
  assert.equal(mine.length, 1);
  assert.ok(!JSON.stringify(store.records).includes('faker-puuid'), 'le puuid n’est jamais stocké');
  const rec = new Recommender({ store, dd });
  const v = rec.buildVariants(target.championId, mine[0].r, { followed: [{ id: 'f1', name: 'Hide on bush' }] });
  assert.ok(v.variants.some((x) => x.source === 'player' && x.player === 'Hide on bush'));
});
