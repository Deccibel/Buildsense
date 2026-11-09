'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { DDragon, ddLanguage } = require('../src/core/ddragon');
const { extractRecords } = require('../src/core/extract');
const { Recommender } = require('../src/core/recommender');
const { normalizeLive } = require('../src/core/liveClient');
const { Store } = require('../src/core/store');
const { parseChampSelect } = require('../src/core/lcu');
const { computeIngame, computeChampSelect } = require('../src/core/engine');
const { Crawler } = require('../src/core/crawler');
const { detectMode, familyOfQueue } = require('../src/core/modes');

const { raw } = require('./fixtures/ddragon');
const { match, timeline } = require('./fixtures/match');
const { ahriRecords, aramAhriRecords, arenaAhriRecords, roleRecords, K } = require('./fixtures/records');
const aramGame = require('../demo/allgamedata-aram.json');
const arenaGame = require('./fixtures/allgamedata-arena.json');
const csAram = require('./fixtures/champselect-aram.json');

const dd = new DDragon().ingest(raw);
const clone = (o) => JSON.parse(JSON.stringify(o));

function fullStore() {
  const store = new Store(null);
  store.add([...ahriRecords(), ...aramAhriRecords(), ...arenaAhriRecords(), ...roleRecords()]);
  return store;
}

test('Détection du mode de jeu', () => {
  const aram = detectMode({ gameMode: 'ARAM', mapNumber: 12 });
  assert.equal(aram.family, 'aram');
  assert.equal(aram.roles, false);
  assert.equal(aram.runes, true);
  assert.equal(aram.label, 'ARAM');

  const mayhem = detectMode({ gameMode: 'KIWI', mapNumber: 12 });
  assert.equal(mayhem.family, 'mayhem');
  assert.equal(mayhem.runes, false);
  assert.equal(detectMode({ queueId: 2400, mapNumber: 12, gameMode: 'ARAM' }).family, 'mayhem', 'la file prime');

  const arena = detectMode({ gameMode: 'CHERRY', mapNumber: 30 });
  assert.equal(arena.family, 'arena');
  assert.equal(arena.teams, false);
  assert.equal(arena.map, 30);

  const swift = detectMode({ gameMode: 'SWIFTPLAY', mapNumber: 11, queueId: 480 });
  assert.equal(swift.family, 'sr');
  assert.equal(swift.label, 'Swiftplay');
  assert.equal(swift.special, false);

  const ranked = detectMode({ gameMode: 'CLASSIC', mapNumber: 11, queueId: 420 });
  assert.equal(ranked.label, 'Classée solo');
  assert.equal(ranked.special, false);

  const urf = detectMode({ gameMode: 'URF', mapNumber: 11 });
  assert.equal(urf.family, 'sr');
  assert.equal(urf.special, true);
  assert.equal(urf.label, 'URF');

  assert.equal(detectMode({ gameMode: 'PRACTICETOOL', mapNumber: 11 }).label, 'Entraînement');
  assert.equal(detectMode({ gameMode: 'NEXUSBLITZ', mapNumber: 21 }).map, 21);
  assert.equal(detectMode({ gameMode: 'STRAWBERRY', mapNumber: 33 }).supported, false);
  assert.equal(detectMode({ gameMode: 'SOMETHINGNEW', mapNumber: 11 }).family, 'sr', 'mode inconnu : builds de la Faille');

  assert.equal(familyOfQueue(420), 'sr');
  assert.equal(familyOfQueue(450), 'aram');
  assert.equal(familyOfQueue(2400), 'mayhem');
  assert.equal(familyOfQueue(1700), 'arena');
  assert.equal(familyOfQueue(430), null, 'les parties normales ne sont pas collectées');
});

test('Objets disponibles selon la carte', () => {
  assert.equal(dd.isLegendary(3157, 11), true);
  assert.equal(dd.isLegendary(3157, 12), true);
  assert.equal(dd.isLegendary(3157, 30), false);
  assert.equal(dd.isLegendary(2065, 11), true);
  assert.equal(dd.isLegendary(2065, 12), false, 'désactivé en ARAM');
  assert.equal(dd.isLegendary(223157, 30), true);
  assert.equal(dd.isLegendary(223157, 11), false);
  assert.ok(dd.legendaryItems(30).every((it) => it.id >= 220000));
  assert.ok(dd.hasMap(30));
  assert.equal(dd.hasMap(21), false);
});

test('Extraction : parties ARAM et Arena', () => {
  const aramMatch = clone(match);
  aramMatch.info.queueId = 450;
  aramMatch.metadata.matchId = 'EUW1_ARAM';
  for (const p of aramMatch.info.participants) {
    p.teamPosition = '';
    p.individualPosition = 'Invalid';
  }
  const recs = extractRecords(aramMatch, timeline, dd);
  assert.equal(recs.length, 10);
  const ahri = recs.find((r) => r.c === 103);
  assert.equal(ahri.q, 'aram');
  assert.equal(ahri.r, '');
  assert.equal(ahri.o, 0);
  assert.equal(ahri.e.length, 5);
  assert.deepEqual(ahri.co.map((x) => x[0]), [6655, 3020, 3157, 3089]);
  assert.equal(ahri.ru.length, 11);

  // Arena : 4 joueurs (2 équipes de 2), pas de timeline, classement à la place de la victoire
  const arena = { metadata: { matchId: 'EUW1_ARENA' }, info: { queueId: 1700, gameDuration: 1300, gameVersion: '16.21.1.1', participants: [] } };
  const mk = (id, champ, sub, placement, items) => ({
    participantId: id, puuid: `a${id}`, championId: champ, teamId: 0, playerSubteamId: sub, placement, win: false,
    summoner1Id: 4, summoner2Id: 21, perks: { styles: [], statPerks: {} },
    ...Object.fromEntries([0, 1, 2, 3, 4, 5].map((i) => [`item${i}`, items[i] || 0])),
  });
  arena.info.participants = [
    mk(1, 103, 1, 2, [226655, 223157, 3340]),
    mk(2, 89, 1, 2, [223031]),
    mk(3, 238, 2, 6, [223031]),
    mk(4, 222, 2, 6, []),
  ];
  const ar = extractRecords(arena, null, dd);
  assert.equal(ar.length, 4);
  const a1 = ar.find((r) => r.c === 103);
  assert.equal(a1.q, 'arena');
  assert.equal(a1.w, 1, 'top 4 = victoire');
  assert.equal(ar.find((r) => r.c === 238).w, 0);
  assert.deepEqual(a1.a, [89], 'partenaire');
  assert.deepEqual(a1.e, []);
  assert.deepEqual(a1.ru, []);
  assert.equal(a1.nt, 1);
  assert.deepEqual(a1.co.map((x) => x[0]), [226655, 223157]);
});

test('Store : données séparées par mode', () => {
  const store = fullStore();
  assert.equal(store.byChampion(K.Ahri).length, 180, 'Faille par défaut');
  assert.equal(store.byChampion(K.Ahri, 'aram').length, 120);
  assert.equal(store.byChampion(K.Ahri, 'arena').length, 60);
  assert.equal(store.byChampion(K.Ahri, 'mayhem').length, 0);
  const c = store.countFor(K.Ahri);
  assert.equal(c.total, 360);
  assert.equal(c.byFamily.aram.total, 120);
  const st = store.stats();
  assert.equal(st.byFamily.aram.records, 120);
  assert.equal(st.byFamily.aram.matches, 120);
  assert.equal(store.mainRole(K.Ahri), 'MIDDLE', 'le rôle ne vient que de la Faille');
});

test('ARAM en partie : builds ARAM, pas de rôle ni d’adversaire direct', () => {
  const store = fullStore();
  const rec = new Recommender({ store, dd });
  const game = normalizeLive(aramGame, dd);
  const vm = computeIngame({ dd, store, rec, game, hasKey: true });
  assert.equal(vm.mode, 'ingame');
  assert.equal(vm.header.role, 'ARAM');
  assert.equal(vm.header.opponent, null);
  assert.equal(vm.enemies.length, 5);
  assert.ok(vm.enemies.every((e) => !e.isOpponent));
  assert.equal(vm.options[0].id, 3165, `Morellonomicon attendu contre Soraka + Aatrox, obtenu ${vm.options.map((o) => o.id)}`);
  assert.ok(vm.options.every((o) => o.id !== 2065), 'jamais un objet absent de l’ARAM');
  assert.match(vm.options[0].reasons.map((r) => r.text).join(' '), /joueurs ARAM/);
  assert.equal(vm.coreTitle, 'Build type ARAM');
  assert.match(vm.sample.text, /120 parties ARAM analysées/);
  assert.ok(vm.damage && vm.damage.ad > 0);
});

test('ARAM en sélection : runes et sorts ARAM (Marque)', () => {
  const store = fullStore();
  const rec = new Recommender({ store, dd });
  const cs = parseChampSelect(csAram, dd, { id: 450, mapId: 12, gameMode: 'ARAM' });
  assert.equal(cs.queueId, 450);
  assert.equal(cs.enemies.length, 0, 'équipe adverse cachée en ARAM');
  const vm = computeChampSelect({ dd, store, rec, cs, hasKey: true, importHotkey: 'CommandOrControl+Shift+R' });
  assert.equal(vm.header.role, 'ARAM');
  assert.equal(vm.header.opponent, null);
  assert.equal(vm.page.keystone.name, 'Arcane Comet');
  assert.deepEqual(vm.spells.list.map((x) => x.name), ['Flash', 'Mark']);
  assert.deepEqual(vm.start.map((x) => x.name).sort(), ['Amplifying Tome', 'Health Potion']);
  assert.ok(vm.hint, 'import des runes possible');
});

test('ARAM Mayhem : pas de runes, repli sur les données ARAM', () => {
  const store = fullStore();
  const rec = new Recommender({ store, dd });
  const cs = parseChampSelect(csAram, dd, { id: 2400, mapId: 12, gameMode: 'KIWI' });
  const vm = computeChampSelect({ dd, store, rec, cs, hasKey: true, importHotkey: 'CommandOrControl+Shift+R' });
  assert.equal(vm.header.role, 'ARAM Mayhem');
  assert.equal(vm.page, null);
  assert.equal(vm.hint, null);
  assert.match(vm.matchupNote, /pas de runes/);
  assert.match(vm.sample.text, /builds ARAM utilisés/);
  assert.equal(vm.sample.warn, true);
  assert.ok(vm.core.length >= 2, 'build ARAM proposé');

  const game = normalizeLive({ ...aramGame, gameData: { ...aramGame.gameData, gameMode: 'KIWI' } }, dd);
  const ig = computeIngame({ dd, store, rec, game, hasKey: true });
  assert.equal(ig.header.role, 'ARAM Mayhem');
  assert.ok(ig.options.length >= 1);
});

test('Arena en partie : objets Arena, pas d’analyse d’équipe', () => {
  const store = fullStore();
  const rec = new Recommender({ store, dd });
  const game = normalizeLive(arenaGame, dd);
  const vm = computeIngame({ dd, store, rec, game, hasKey: true });
  assert.equal(vm.header.role, 'Arena');
  assert.deepEqual(vm.enemies, []);
  assert.deepEqual(vm.alerts, []);
  assert.equal(vm.damage, null);
  assert.equal(vm.options[0].id, 223157, `Zhonya (Arena) attendu, obtenu ${vm.options.map((o) => o.id)}`);
  assert.equal(vm.plan.state, 'ready', '3 400 PO suffisent');
  assert.match(vm.sample.text, /parties Arena/);
});

test('Modes spéciaux et non pris en charge', () => {
  const store = fullStore();
  const rec = new Recommender({ store, dd });
  const live = require('../demo/allgamedata.json');
  const urf = computeIngame({ dd, store, rec, game: normalizeLive({ ...live, gameData: { ...live.gameData, gameMode: 'URF' } }, dd), hasKey: true });
  assert.equal(urf.header.role, 'URF');
  assert.match(urf.sample.text, /mode URF : builds de la Faille classée/);
  const swarm = computeIngame({
    dd, store, rec, hasKey: true,
    game: normalizeLive({ ...live, gameData: { ...live.gameData, gameMode: 'STRAWBERRY', mapNumber: 33 } }, dd),
  });
  assert.equal(swarm.mode, 'message');
});

test('Collecte ARAM : de proche en proche à partir des joueurs du classement', async () => {
  const store = new Store(null);
  const aramMatch = (id, prefix) => {
    const m = clone(match);
    m.metadata.matchId = id;
    m.info.queueId = 450;
    m.info.participants.forEach((p, i) => {
      p.puuid = `${prefix}${i}`;
      p.teamPosition = '';
    });
    return m;
  };
  const queues = [];
  const api = {
    requestCount: 0,
    async league(tier) {
      return tier === 'challenger' ? { entries: [{ puuid: 'p1' }] } : { entries: [] };
    },
    async matchIds(puuid, { queue }) {
      queues.push(queue);
      if (puuid === 'p1') return ['ARAM_1'];
      if (puuid === 'x3') return ['ARAM_2'];
      return [];
    },
    async match(id) {
      return id === 'ARAM_1' ? aramMatch(id, 'x') : aramMatch(id, 'y');
    },
    async timeline() {
      return timeline;
    },
    async topMasteries() {
      return [];
    },
  };
  const crawler = new Crawler({ api, store, dd, getConfig: () => ({ favorites: [], collectModes: { sr: false, aram: true, mayhem: false, arena: false, meta: false } }) });
  crawler.running = true;
  for (let i = 0; i < 8; i++) await crawler.step();
  assert.ok(queues.every((q) => q === 450), 'seulement la file ARAM');
  assert.equal(store.byChampion(103, 'aram').length, 2, 'deux parties ARAM trouvées via les autres joueurs');
  assert.equal(crawler.status().families.aram.matchesAdded, 2);
});

test('Collecte : un mode hors rotation est mis en pause', async () => {
  const store = new Store(null);
  const entries = Array.from({ length: 40 }, (_, i) => ({ puuid: `p${i}` }));
  const api = {
    requestCount: 0,
    async league(tier) {
      return tier === 'challenger' ? { entries } : { entries: [] };
    },
    async matchIds() {
      return [];
    },
  };
  const crawler = new Crawler({ api, store, dd, getConfig: () => ({ favorites: [], collectModes: { sr: false, aram: false, mayhem: true, arena: false, meta: false } }) });
  crawler.running = true;
  for (let i = 0; i < 31; i++) await crawler.step();
  assert.equal(crawler.status().families.mayhem.paused, true);
});

test('Langue : choix de la langue Data Dragon et fragments traduits', () => {
  assert.equal(ddLanguage('fr_FR'), 'fr_FR');
  assert.equal(ddLanguage('en-US'), 'en_US');
  assert.equal(ddLanguage('fr_CA'), 'fr_FR');
  assert.equal(ddLanguage('xx_YY'), 'en_US');
  const en = new DDragon().ingest({ ...raw, language: 'en_US' });
  assert.equal(en.shardName(5008), 'Adaptive Force');
  const fr = new DDragon().ingest({ ...raw, language: 'fr_FR' });
  assert.equal(fr.shardName(5008), 'Force adaptative');
});

test('ARAM et ARAM Mayhem : jamais de bottes, 6 objets dans le build complet', () => {
  for (const gameMode of ['ARAM', 'KIWI']) {
    const g = JSON.parse(JSON.stringify(require('../demo/allgamedata-aram.json')));
    g.gameData.gameMode = gameMode;
    for (const p of g.allPlayers) if (p.items) p.items = p.items.filter((x) => x.itemID !== 3020);
    const store = new Store(null);
    store.add([...aramAhriRecords(), ...roleRecords()]);
    const rec = new Recommender({ store, dd });
    const vm = computeIngame({ dd, store, rec, game: normalizeLive(g, dd), hasKey: true });
    const isBoots = (id) => id === 1001 || (dd.item(id) || {}).isBoots;
    assert.equal(vm.boots, null, `${gameMode} : pas de bottes conseillées`);
    assert.ok(!vm.options.some((o) => isBoots(o.id)));
    assert.equal(vm.full.length, 6, `${gameMode} : 6 objets`);
    assert.ok(!vm.full.some((it) => isBoots(it.id)), 'aucune botte dans le build complet');
    assert.equal(new Set(vm.full.map((it) => it.id)).size, 6);
    const cs = rec.champSelect({ champKey: 103, role: '', family: gameMode === 'ARAM' ? 'aram' : 'mayhem' });
    assert.equal(cs.boots, null);
    assert.ok(cs.starts.length && cs.starts.every((s) => !s.ids.some(isBoots)), 'départs sans bottes');
  }
});
