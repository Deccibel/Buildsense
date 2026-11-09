'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { DDragon } = require('../src/core/ddragon');
const { extractRecords } = require('../src/core/extract');
const { planPurchase, Recommender } = require('../src/core/recommender');
const { normalizeLive } = require('../src/core/liveClient');
const { analyzeEnemies, buildNeeds } = require('../src/core/analyzer');
const { Store } = require('../src/core/store');
const { RateLimiter } = require('../src/core/riotApi');
const { parseChampSelect } = require('../src/core/lcu');
const { computeIngame, computeChampSelect } = require('../src/core/engine');
const { Crawler } = require('../src/core/crawler');

const { raw } = require('./fixtures/ddragon');
const { match, timeline } = require('./fixtures/match');
const { ahriRecords, roleRecords, K } = require('./fixtures/records');
const liveSample = require('../demo/allgamedata.json');
const csSample = require('../demo/champselect.json');

const dd = new DDragon().ingest(raw);

function makeStore() {
  const store = new Store(null);
  store.add([...ahriRecords(), ...roleRecords()]);
  return store;
}

test('Data Dragon : stats, effets et objets complétés', () => {
  const zhonya = dd.item(3157);
  assert.equal(zhonya.isLegendary, true);
  assert.equal(zhonya.cls, 'AP');
  assert.equal(zhonya.flags.stasis, true);
  assert.equal(zhonya.stats.armor, 50);

  assert.equal(dd.item(3135).flags.pctMagicPen, true, 'Void Staff = pénétration en %');
  assert.equal(dd.item(3020).flags.flatMagicPen, true);
  assert.equal(dd.item(3020).isBoots, true);
  assert.equal(dd.item(1001).isBoots, false, 'les bottes de base ne comptent pas');
  assert.equal(dd.item(3165).flags.antiHeal, true);
  assert.equal(dd.item(3916).isLegendary, false, 'composant');
  assert.equal(dd.item(3143).flags.critReduction, true);
  assert.equal(dd.item(3139).flags.cleanse, true);
  assert.equal(dd.item(6695).flags.shieldReaver, true);
  assert.equal(dd.item(3026).flags.revive, true);
  assert.equal(dd.item(3102).flags.spellShield, true);
  assert.equal(dd.item(3036).group, 'last whisper');
  assert.equal(dd.item(3004).isLegendary, true, 'Manamune : sa transformation ne compte pas');
  assert.equal(dd.item(3042).isLegendary, false);
  assert.equal(dd.item(223031).isLegendary, false, 'objet Arena exclu');
  assert.equal(dd.item(2003).isLegendary, false);
  assert.equal(dd.championFromLive({ rawChampionName: 'game_character_displayname_Kaisa' }).name, "Kai'Sa");
  assert.equal(dd.championFromLive({ championName: 'Lee Sin' }).key, 64);
});

test('Extraction des fiches build depuis match + timeline', () => {
  const recs = extractRecords(match, timeline, dd);
  assert.equal(recs.length, 10);
  const ahri = recs.find((r) => r.c === 103);
  assert.equal(ahri.v, '16.21');
  assert.equal(ahri.r, 'MIDDLE');
  assert.equal(ahri.w, 1);
  assert.deepEqual(ahri.st, [1056, 2003, 2003], 'balise exclue du départ');
  assert.deepEqual(ahri.co.map((x) => x[0]), [6655, 3020, 3157, 3089], "l'achat annulé n'apparaît pas");
  assert.equal(ahri.co[0][1], 11);
  assert.equal(ahri.sk, '123114121242233433', 'évolutions ignorées');
  assert.deepEqual(ahri.ru, [8100, 8112, 8139, 8140, 8106, 8200, 8210, 8236, 5008, 5008, 5001]);
  assert.equal(ahri.o, 238);
  assert.deepEqual(ahri.e, [266, 113, 238, 222, 16]);
  assert.deepEqual(ahri.fi, [6655, 3020, 3157, 3089]);

  const remake = { ...match, info: { ...match.info, gameDuration: 200 } };
  assert.equal(extractRecords(remake, timeline, dd).length, 0);
  const normal = { ...match, info: { ...match.info, queueId: 430 } };
  assert.equal(extractRecords(normal, timeline, dd).length, 0, 'parties normales ignorées');
  assert.equal(ahri.q, 'sr');
});

test("Plan d'achat avec composants déjà possédés", () => {
  // Zhonya = Brassard (Tome + Armure) + Bâton ; le Tome est déjà dans l'inventaire
  const p = planPurchase(dd, 3157, [6655, 3020, 1052, 1056, 2003], 1450);
  assert.equal(p.complete, false);
  assert.equal(p.total, 3250 - 400);
  assert.deepEqual(p.buy, [{ id: 2420, cost: 1200 }]);
  assert.equal(p.afterBuy, 2850 - 1200);

  const rich = planPurchase(dd, 3157, [1052], 4000);
  assert.equal(rich.complete, true);
  assert.equal(rich.spent, 2850);

  const poor = planPurchase(dd, 3157, [], 250);
  assert.deepEqual(poor.buy, []);
});

test('Analyse de la compo adverse (partie de démo)', () => {
  const game = normalizeLive(liveSample, dd);
  assert.equal(game.me.champ.name, 'Ahri');
  assert.equal(game.me.gold, 1450.5);
  assert.equal(game.enemies.length, 5);
  assert.equal(game.allies.length, 4);

  const a = analyzeEnemies(game.enemies, dd);
  assert.ok(a.apShare < 0.38, `compo physique attendue (ap=${a.apShare.toFixed(2)})`);
  assert.deepEqual(a.names.heal.sort(), ['Aatrox', 'Soraka']);
  assert.deepEqual(a.fed.map((f) => f.name), ['Zed']);

  const needs = buildNeeds(a, 'AP');
  const keys = needs.boosts.map((b) => b.flag || b.stat);
  assert.ok(keys.includes('antiHeal'));
  assert.ok(keys.includes('stasis'));
  assert.ok(keys.includes('armor'));
  assert.equal(needs.alerts[0].level, 'high');
  assert.ok(needs.alerts.some((x) => x.text.startsWith('Zed est fed (7/1/2)')));
});

test('Recommandations en jeu : adaptées à Zed fed + soins adverses', () => {
  const store = makeStore();
  const rec = new Recommender({ store, dd });
  const game = normalizeLive(liveSample, dd);
  const a = analyzeEnemies(game.enemies, dd);
  const prof = rec.profile(K.Ahri, 'MIDDLE');
  assert.equal(prof.mainClass, 'AP');
  const needs = buildNeeds(a, prof.mainClass);
  const r = rec.nextItems({
    champKey: K.Ahri,
    role: 'MIDDLE',
    myItems: game.me.items,
    enemyKeys: game.enemies.map((e) => e.champ.key),
    oppKey: K.Zed,
    needs,
    gold: game.me.gold,
  });
  assert.equal(r.options[0].id, 3157, `Zhonya attendu en tête, obtenu ${r.options.map((o) => o.id)}`);
  assert.ok(r.options.length >= 2);
  assert.ok(r.options[0].reasons.some((x) => x.includes('Zed')));
  assert.ok(r.options.some((o) => o.id === 3165), 'Morellonomicon proposé contre les soins');
  assert.equal(r.boots, null, 'déjà des bottes');
  assert.deepEqual(r.plan.buy, [{ id: 2420, cost: 1200 }]);
  assert.equal(r.skills.order, 'Q > W > E');
  assert.deepEqual(r.core.ids.slice(0, 2), [6655, 3157]);

  // sans Zed fed et contre une compo magique, Zhonya ne doit plus dominer
  const calm = rec.nextItems({
    champKey: K.Ahri,
    role: 'MIDDLE',
    myItems: [6655, 3020],
    enemyKeys: [K.Ornn, K.Sejuani, K.Syndra, K.Ezreal, K.Lulu],
    oppKey: K.Syndra,
    needs: { boosts: [], bootBoosts: [] },
    gold: 500,
  });
  assert.equal(calm.options[0].id, 4645, `Shadowflame attendu, obtenu ${calm.options.map((o) => o.id)}`);
});

test('Recommandations en sélection : runes selon l’adversaire', () => {
  const store = makeStore();
  const rec = new Recommender({ store, dd });
  const vsZed = rec.champSelect({ champKey: K.Ahri, role: 'MIDDLE', oppKey: K.Zed, enemyKeys: [K.Zed, K.Aatrox] });
  assert.equal(vsZed.pages[0].ru[1], 8230, 'Phase Rush contre Zed');
  const vsSyndra = rec.champSelect({ champKey: K.Ahri, role: 'MIDDLE', oppKey: K.Syndra, enemyKeys: [K.Syndra] });
  assert.equal(vsSyndra.pages[0].ru[1], 8112, 'Électrocution sinon');
  assert.deepEqual(vsSyndra.spells[0].ids, [4, 14]);
  assert.deepEqual(vsSyndra.starts[0].ids, [1056, 2003, 2003]);
  assert.equal(vsSyndra.skills.first, 'Q W E');
});

test('Vues de l’overlay (moteur complet)', () => {
  const store = makeStore();
  const rec = new Recommender({ store, dd });
  const game = normalizeLive(liveSample, dd);
  const vm = computeIngame({ dd, store, rec, game, hasKey: true });
  assert.equal(vm.mode, 'ingame');
  assert.equal(vm.header.role, 'Mid');
  assert.equal(vm.header.opponent, 'Zed');
  assert.equal(vm.header.clock, '18:42');
  assert.equal(vm.options[0].name, "Zhonya's Hourglass");
  assert.equal(vm.plan.buy[0].name, "Seeker's Armguard");
  assert.equal(vm.plan.state, 'partial');
  assert.ok(vm.plan.progress > 0.4 && vm.plan.progress < 0.6);
  assert.ok(vm.alerts.length >= 1);
  assert.ok(vm.alerts.every((x) => !x.text.includes('est fed')), 'les ennemis fed sont dans le bandeau, pas en double');
  assert.match(vm.sample.text, /parties Challenger\/GM/);
  // bandeau adverse : ordre des postes, adversaire direct, fed
  assert.deepEqual(vm.enemies.map((e) => e.name), ['Aatrox', 'Sejuani', 'Zed', 'Jinx', 'Soraka']);
  const zed = vm.enemies.find((e) => e.name === 'Zed');
  assert.equal(zed.fed, true);
  assert.equal(zed.isOpponent, true);
  assert.equal(zed.dmg, 'AD');
  assert.match(zed.icon, /img\/champion\/Zed\.png$/);
  assert.ok(vm.damage.ad >= 60);
  const heal = vm.alerts.find((x) => x.text.startsWith('Gros soins'));
  assert.deepEqual(heal.champs.map((c) => c.name).sort(), ['Aatrox', 'Soraka']);
  assert.deepEqual(vm.skills.order, ['Q', 'W', 'E']);
  assert.match(vm.options[0].icon, /img\/item\/3157\.png$/);
  assert.match(vm.header.opponentIcon, /Zed\.png$/);

  const cs = parseChampSelect(csSample, dd);
  assert.equal(cs.myChampion.name, 'Ahri');
  assert.equal(cs.role, 'MIDDLE');
  assert.equal(cs.enemies.length, 3);
  const csVm = computeChampSelect({ dd, store, rec, cs, hasKey: true, importHotkey: 'CommandOrControl+Shift+R' });
  assert.equal(csVm.mode, 'champselect');
  assert.equal(csVm.header.opponent, 'Zed', 'adversaire deviné grâce aux rôles habituels');
  assert.equal(csVm.page.keystone.name, 'Phase Rush');
  assert.deepEqual(csVm.page.importable.selectedPerkIds.length, 9);
  assert.equal(csVm.spells.list[0].name, 'Flash');
  assert.match(csVm.hint.key, /Maj\+R/);
  assert.match(csVm.page.shards[0].icon, /StatMods\/StatModsAdaptiveForceIcon\.png$/);
  assert.match(csVm.page.keystone.icon, /perk-images\/Styles\/Sorcery\/PhaseRush\/PhaseRush\.png$/);
  assert.equal(csVm.enemies.length, 3);
  assert.equal(csVm.enemies.find((e) => e.name === 'Zed').isOpponent, true);
  assert.deepEqual(csVm.skills.first, ['Q', 'W', 'E']);
});

test('Sans données : options situationnelles seulement', () => {
  const store = new Store(null);
  const rec = new Recommender({ store, dd });
  const game = normalizeLive(liveSample, dd);
  const vm = computeIngame({ dd, store, rec, game, hasKey: false });
  assert.ok(vm.options.length >= 1);
  assert.ok(vm.options.every((o) => o.situational));
  assert.equal(vm.sample.warn, true);
});

test('Store : index, patchs et nettoyage', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-'));
  const store = new Store(dir).load();
  const mk = (v, i) => ({ m: `M${v}${i}`, v, c: 1, r: 'TOP', w: 1, co: [], e: [] });
  store.add([mk('16.18', 1), mk('16.19', 1), mk('16.20', 1), mk('16.21', 1), mk('16.21', 2)]);
  assert.equal(store.latestPatch(), '16.21');
  assert.equal(store.previousPatch(), '16.20');
  store.prune();
  assert.deepEqual(store.patches(), ['16.19', '16.20', '16.21']);
  const again = new Store(dir).load();
  assert.equal(again.records.length, 4);
  assert.equal(again.mainRole(1), 'TOP');
});

test('Limiteur de débit : respecte les fenêtres', async () => {
  const lim = new RateLimiter([[3, 0.3]]);
  const t0 = Date.now();
  for (let i = 0; i < 6; i++) await lim.acquire();
  const elapsed = Date.now() - t0;
  assert.ok(elapsed >= 290, `6 appels à 3/0,3 s doivent prendre ≥ 0,3 s (${elapsed} ms)`);
});

test('Collecte : parcours de l’échelle et priorité aux favoris (API simulée)', async () => {
  const store = new Store(null);
  let calls = 0;
  const api = {
    requestCount: 0,
    async league(tier) {
      calls++;
      return tier === 'challenger' ? { entries: [{ puuid: 'p1' }, { puuid: 'p2' }] } : { entries: [] };
    },
    async topMasteries(puuid) {
      return puuid === 'p2' ? [{ championId: 103 }] : [{ championId: 1 }];
    },
    async matchIds(puuid) {
      return puuid === 'p2' ? ['EUW1_7000000001'] : [];
    },
    async match() {
      return match;
    },
    async timeline() {
      return timeline;
    },
    async summonerById() {
      return null;
    },
  };
  const crawler = new Crawler({
    api,
    store,
    dd,
    getConfig: () => ({ favorites: [103], collectDays: 14, collectModes: { sr: true, aram: false, mayhem: false, arena: false, meta: false } }),
  });
  crawler.running = true;
  for (let i = 0; i < 6 && store.records.length === 0; i++) await crawler.step();
  assert.equal(store.records.length, 10);
  assert.ok(store.hasSeen('EUW1_7000000001'));
  assert.ok(calls >= 1);
  assert.equal(crawler.favPlayersFound, 1);
});

test('Cache d’icônes : téléchargement unique, chemins sûrs, ménage des vieux patchs', async () => {
  const { IconCache } = require('../src/core/iconCache');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-icons-'));
  let calls = 0;
  const fakeFetch = async (url) => {
    calls++;
    if (url.includes('missing')) return { ok: false, status: 404 };
    return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer };
  };
  const cache = new IconCache({ dir, remoteBase: 'https://example.test', fetchImpl: fakeFetch });
  assert.equal(cache.safeRel('../etc/passwd.png'), null);
  assert.equal(cache.safeRel('cdn/16.21.1/img/item/../../x.png'), null);
  assert.equal(cache.safeRel('cdn/16.21.1/img/item/3157.exe'), null);
  assert.equal(cache.safeRel('/cdn/16.21.1/img/item/3157.png'), 'cdn/16.21.1/img/item/3157.png');

  const [a, b] = await Promise.all([cache.get('cdn/16.21.1/img/item/3157.png'), cache.get('cdn/16.21.1/img/item/3157.png')]);
  assert.equal(calls, 1, 'une seule requête pour deux demandes simultanées');
  assert.ok(a && b);
  assert.ok(fs.existsSync(path.join(dir, 'cdn', '16.21.1', 'img', 'item', '3157.png')));
  await cache.get('cdn/16.21.1/img/item/3157.png');
  assert.equal(calls, 1, 'servi depuis le disque ensuite');

  assert.equal(await cache.get('cdn/16.21.1/img/item/missing.png'), null);
  assert.equal(await cache.get('cdn/16.21.1/img/item/missing.png'), null);
  assert.equal(calls, 2, 'pas de nouvelle tentative immédiate sur une icône introuvable');

  const res = await cache.prefetch(['cdn/16.20.1/img/item/1001.png', 'cdn/16.21.1/img/item/3157.png', 'cdn/16.19.1/img/item/1001.png']);
  assert.equal(res.attempted, 2);
  cache.pruneVersions(2);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'cdn')).sort(), ['16.20.1', '16.21.1']);

  const dd2 = new DDragon().ingest(raw);
  const rels = dd2.allIconPaths();
  assert.ok(rels.includes('cdn/16.21.1/img/champion/Ahri.png'));
  assert.ok(rels.includes('cdn/16.21.1/img/item/3157.png'));
  assert.ok(rels.includes('cdn/16.21.1/img/spell/SummonerFlash.png'));
  assert.ok(rels.includes('cdn/img/perk-images/Styles/Domination/Electrocute/Electrocute.png'));
  assert.ok(rels.includes('cdn/16.21.1/img/item/223157.png'), 'objets Arena inclus');
  assert.ok(rels.every((r) => cache.safeRel(r)), 'tous les chemins passent la validation');
});
