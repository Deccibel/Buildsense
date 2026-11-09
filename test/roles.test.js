'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { DDragon } = require('../src/core/ddragon');
const { Recommender } = require('../src/core/recommender');
const { normalizeLive } = require('../src/core/liveClient');
const { Store } = require('../src/core/store');
const { LcuClient, parseChampSelect, pageName } = require('../src/core/lcu');
const { computeIngame, computeChampSelect, resolveRole, normRole } = require('../src/core/engine');

const { raw } = require('./fixtures/ddragon');
const { ahriRecords, supportRecords, ahriSupportRecords, roleRecords, K } = require('./fixtures/records');
const demoGame = require('../demo/allgamedata.json');
const demoCs = require('../demo/champselect.json');
const csAram = require('./fixtures/champselect-aram.json');

const dd = new DDragon().ingest(raw);
const clone = (o) => JSON.parse(JSON.stringify(o));
const RANKED = { id: 420, mapId: 11, gameMode: 'CLASSIC' };
const BLIND = { id: 430, mapId: 11, gameMode: 'CLASSIC' };

function makeStore(extra = []) {
  const store = new Store(null);
  store.add([...ahriRecords(), ...roleRecords(), ...supportRecords(), ...extra]);
  return store;
}

test('Poste : choix de la partie > client > poste préféré > le plus joué', () => {
  const store = makeStore();
  const base = { champKey: K.Ahri, store };
  assert.deepEqual(resolveRole({ ...base }), { role: 'MIDDLE', source: 'data' });
  assert.deepEqual(resolveRole({ ...base, choice: { prefs: { [K.Ahri]: 'UTILITY' } } }), { role: 'UTILITY', source: 'pref' });
  // le poste attribué par le client passe avant le poste préféré
  assert.deepEqual(resolveRole({ ...base, assigned: 'TOP', choice: { prefs: { [K.Ahri]: 'UTILITY' } } }), { role: 'TOP', source: 'client' });
  // ... mais le choix fait pendant la partie passe avant tout
  const choice = { override: { champKey: K.Ahri, role: 'JUNGLE' }, prefs: { [K.Ahri]: 'UTILITY' } };
  assert.deepEqual(resolveRole({ ...base, assigned: 'TOP', choice }), { role: 'JUNGLE', source: 'manual' });
  // un choix fait pour un autre champion (changement de pick) est ignoré
  assert.deepEqual(resolveRole({ ...base, choice: { override: { champKey: K.Zed, role: 'JUNGLE' } } }).source, 'data');
  // valeurs du client à ignorer ou à traduire
  assert.equal(normRole('NONE'), '');
  assert.equal(normRole('support'), 'UTILITY');
  assert.equal(normRole('Invalid'), '');
});

test('Hors poste (Ahri support, peu de parties) : objets du champion, départ et sorts de support', () => {
  const store = makeStore(ahriSupportRecords(4));
  const rec = new Recommender({ store, dd });
  const prof = rec.profile(K.Ahri, 'UTILITY');
  assert.equal(prof.offRole, true);
  assert.equal(prof.nRole, 4);

  const cs = rec.champSelect({ champKey: K.Ahri, role: 'UTILITY' });
  assert.equal(cs.offRole, true);
  assert.ok(cs.starts[0].ids.includes(3865), `départ de support attendu, obtenu ${cs.starts[0].ids}`);
  assert.ok(!cs.starts.some((s) => s.ids.includes(1056)), "pas d'Anneau de Doran (départ mid)");
  assert.deepEqual(cs.spells[0].ids, [4, 14]);
  // le build reste celui d'Ahri (dégâts)
  assert.equal(cs.core.ids[0], 6655);
  assert.ok(cs.pages.length > 0);

  const g = clone(demoGame);
  const vm = computeChampSelect({
    dd,
    store,
    rec,
    cs: parseChampSelect(clone(demoCs), dd, BLIND),
    hasKey: true,
    importHotkey: 'CommandOrControl+Shift+R',
    roleChoice: { override: null, prefs: { [K.Ahri]: 'UTILITY' } },
  });
  // partie à l'aveugle : le client ne donne pas de poste... sauf ici où la démo en donne un (mid)
  assert.equal(vm.roleInfo.source, 'client');
  const manual = computeChampSelect({
    dd,
    store,
    rec,
    cs: parseChampSelect(clone(demoCs), dd, RANKED),
    hasKey: true,
    importHotkey: 'CommandOrControl+Shift+R',
    roleChoice: { override: { champKey: K.Ahri, role: 'UTILITY' }, prefs: {} },
  });
  assert.equal(manual.header.role, 'Support');
  assert.equal(manual.header.roleTag, 'choisi');
  assert.ok(manual.start.some((it) => it.id === 3865));
  assert.match(manual.sample.text, /en Support : peu de parties \(4\)/);
  assert.equal(manual.sample.warn, true);

  // en partie : le choix de poste change l'adversaire direct et garde les objets d'Ahri
  const ingame = computeIngame({ dd, store, rec, game: normalizeLive(g, dd), hasKey: true, roleChoice: { override: { champKey: K.Ahri, role: 'UTILITY' } } });
  assert.equal(ingame.header.role, 'Support');
  assert.equal(ingame.header.roleTag, 'choisi');
  assert.equal(ingame.roleInfo.role, 'UTILITY');
  assert.ok(ingame.options.length > 0);
});

test('Poste préféré utilisé quand le client ne donne pas de poste', () => {
  const store = makeStore(ahriSupportRecords(20));
  const rec = new Recommender({ store, dd });
  const session = clone(demoCs);
  for (const p of session.myTeam) p.assignedPosition = '';
  const vm = computeChampSelect({
    dd,
    store,
    rec,
    cs: parseChampSelect(session, dd, BLIND),
    hasKey: true,
    importHotkey: 'CommandOrControl+Shift+R',
    roleChoice: { prefs: { [K.Ahri]: 'UTILITY' } },
  });
  assert.equal(vm.roleInfo.source, 'pref');
  assert.equal(vm.header.roleTag, 'préféré');
  // 20 parties d'Ahri support : assez pour n'utiliser qu'elles
  assert.doesNotMatch(vm.sample.text, /peu de parties/);
  assert.ok(vm.start.some((it) => it.id === 3865));
});

test('ARAM : pas de poste, le choix est ignoré', () => {
  const store = makeStore();
  const rec = new Recommender({ store, dd });
  const vm = computeChampSelect({
    dd,
    store,
    rec,
    cs: parseChampSelect(clone(csAram), dd, { id: 450, mapId: 12, gameMode: 'ARAM' }),
    hasKey: true,
    importHotkey: 'CommandOrControl+Shift+R',
    roleChoice: { override: { champKey: K.Ahri, role: 'UTILITY' } },
  });
  assert.equal(vm.roleInfo.roles, false);
  assert.equal(vm.header.roleTag, null);
  assert.equal(vm.modeLabel, 'ARAM');
});

test('Sélection : champion verrouillé seulement quand le choix est validé', () => {
  const s = clone(demoCs);
  s.actions = [[{ actorCellId: 2, type: 'pick', completed: false, championId: 103 }]];
  assert.equal(parseChampSelect(s, dd, RANKED).locked, false);
  s.actions[0][0].completed = true;
  assert.equal(parseChampSelect(s, dd, RANKED).locked, true);
  // ARAM : pas d'actions, champion attribué d'office
  assert.equal(parseChampSelect(clone(csAram), dd, null).locked, true);
});

function fakeLcu(pages, { putFails = false } = {}) {
  const lcu = new LcuClient({ getLeaguePath: () => '/nulle-part' });
  const calls = [];
  lcu.request = async (method, url, body) => {
    calls.push([method, url, body]);
    if (method === 'GET' && url === '/lol-perks/v1/pages') return { ok: true, status: 200, data: pages };
    if (method === 'GET' && url === '/lol-perks/v1/currentpage') return { ok: true, status: 200, data: pages.find((p) => p.current) || null };
    if (method === 'PUT' && url.startsWith('/lol-perks/v1/pages/')) return putFails ? { ok: false, status: 400, data: null } : { ok: true, status: 201, data: body };
    if (method === 'DELETE') return { ok: true, status: 204, data: null };
    if (method === 'POST') return { ok: true, status: 200, data: { id: 99 } };
    return { ok: true, status: 204, data: null };
  };
  return { lcu, calls };
}

const PAGE = { primaryStyleId: 8100, subStyleId: 8200, selectedPerkIds: [8112, 8139, 8140, 8106, 8210, 8236, 5008, 5008, 5001] };

test('Runes : la page active est remplacée (pas de nouvelle page)', async () => {
  const { lcu, calls } = fakeLcu([
    { id: 1, name: 'Ma page', current: true, isEditable: true, isDeletable: true },
    { id: 2, name: 'Autre', current: false, isEditable: true, isDeletable: true },
  ]);
  const r = await lcu.importRunes(PAGE, 'Ahri', 'Support');
  assert.equal(r.ok, true);
  assert.equal(r.replaced, true);
  const put = calls.find((c) => c[0] === 'PUT');
  assert.equal(put[1], '/lol-perks/v1/pages/1');
  assert.deepEqual(put[2].selectedPerkIds, PAGE.selectedPerkIds);
  assert.equal(put[2].name, 'BuildSense · Ahri Support');
  assert.ok(!calls.some((c) => c[0] === 'POST' || c[0] === 'DELETE'));
});

test('Runes : page active non modifiable -> page BuildSense réutilisée, sinon nouvelle page', async () => {
  const preset = { id: 50, name: 'Page prédéfinie', current: true, isEditable: false, isDeletable: false };
  let f = fakeLcu([preset, { id: 7, name: 'BuildSense · Zed Mid', current: false, isEditable: true }]);
  let r = await f.lcu.importRunes(PAGE, 'Ahri', 'Mid');
  assert.equal(r.ok, true);
  assert.ok(f.calls.some((c) => c[0] === 'PUT' && c[1] === '/lol-perks/v1/pages/7'));
  assert.ok(f.calls.some((c) => c[0] === 'PUT' && c[1] === '/lol-perks/v1/currentpage' && c[2] === 7));

  f = fakeLcu([preset]);
  r = await f.lcu.importRunes(PAGE, 'Ahri', 'Mid');
  assert.equal(r.ok, true);
  assert.ok(f.calls.some((c) => c[0] === 'POST'));
  assert.ok(!f.calls.some((c) => c[0] === 'DELETE'), 'aucune page supprimée');

  // client qui refuse la modification : on recrée la page à la place de l'active
  f = fakeLcu([{ id: 1, name: 'Ma page', current: true, isEditable: true }], { putFails: true });
  r = await f.lcu.importRunes(PAGE, 'Ahri', 'Mid');
  assert.equal(r.ok, true);
  assert.deepEqual(
    f.calls.filter((c) => c[0] !== 'GET').map((c) => `${c[0]} ${c[1]}`),
    ['PUT /lol-perks/v1/pages/1', 'DELETE /lol-perks/v1/pages/1', 'POST /lol-perks/v1/pages'],
  );
});

test('Nom de page : toujours dans la limite du client, poste conservé', () => {
  assert.equal(pageName('Ahri', 'Mid'), 'BuildSense · Ahri Mid');
  assert.equal(pageName('Miss Fortune', 'Support'), 'BS · Miss Fortune Support');
  assert.equal(pageName('Nunu et Willump', 'Support'), 'BS · Nunu et Wil… Support');
  const long = pageName('Unendlichkeitsschwertverzauberung', 'Support');
  assert.ok(long.length <= 25, long);
  assert.ok(long.endsWith('… Support'), long);
  assert.ok(pageName('Ahri', '').length <= 25);
});

test('Début de partie : meilleur départ en tête, avec ses alternatives', () => {
  const store = makeStore();
  const rec = new Recommender({ store, dd });
  const g = clone(demoGame);
  g.gameData.gameTime = 15;
  for (const p of g.allPlayers) p.items = [];
  const vm = computeIngame({ dd, store, rec, game: normalizeLive(g, dd), hasKey: true });
  assert.ok(vm.starters && vm.starters.length >= 2, 'plusieurs départs proposés');
  assert.equal(vm.starters[0].best, true);
  assert.ok(vm.starters.slice(1).every((s) => !s.best));
  assert.ok(vm.starters[0].items.some((it) => it.id === 1056), "Anneau de Doran en meilleur départ d'Ahri mid");
  assert.ok(vm.starters[0].items.some((it) => it.id === 2003 && it.count === 2), 'potions regroupées (×2)');

  // une fois le départ acheté (ou plus tard dans la partie), le bloc disparaît
  g.allPlayers.find((p) => p.summonerName === g.activePlayer.summonerName || p.riotId === g.activePlayer.riotId).items = [{ itemID: 1056 }];
  assert.equal(computeIngame({ dd, store, rec, game: normalizeLive(g, dd), hasKey: true }).starters, undefined);
  assert.equal(computeIngame({ dd, store, rec, game: normalizeLive(clone(demoGame), dd), hasKey: true }).starters, undefined);
});

test('Boutique : page d’objets BuildSense ajoutée sans toucher aux pages du joueur', async () => {
  const lcu = new LcuClient({ getLeaguePath: () => '/nulle-part' });
  const calls = [];
  const mine = { uid: 'perso-1', title: 'Ma page', associatedChampions: [103], blocks: [] };
  const old = { uid: 'buildsense-103', title: 'BuildSense · ancienne', blocks: [] };
  lcu.request = async (method, url, body) => {
    calls.push([method, url, body]);
    if (url === '/lol-summoner/v1/current-summoner') return { ok: true, status: 200, data: { summonerId: 42, accountId: 7 } };
    if (method === 'GET') return { ok: true, status: 200, data: { accountId: 7, itemSets: [mine, old], timestamp: 1 } };
    return { ok: true, status: 201, data: body };
  };
  const r = await lcu.writeItemSet({
    title: 'BuildSense · Ahri Mid',
    champKey: 103,
    map: 11,
    blocks: [{ type: '★ Meilleur départ · 70 % des parties', items: [{ id: 1056, count: 1 }, { id: 2003, count: 2 }] }],
  });
  assert.equal(r.ok, true);
  const put = calls.find((c) => c[0] === 'PUT');
  assert.equal(put[1], '/lol-item-sets/v1/item-sets/42/sets');
  const sets = put[2].itemSets;
  assert.equal(sets.length, 2, 'ancienne page BuildSense remplacée, page du joueur gardée');
  assert.equal(sets[0].uid, 'buildsense-103');
  assert.deepEqual(sets[0].blocks[0].items, [{ id: '1056', count: 1 }, { id: '2003', count: 2 }]);
  assert.ok(sets.some((s) => s.uid === 'perso-1'));
});

test('Build complet : 6 cases, objets possédés en tête, adapté à la partie et au build favori', () => {
  const store = makeStore();
  const rec = new Recommender({ store, dd });
  const g = clone(demoGame);
  const vm = computeIngame({ dd, store, rec, game: normalizeLive(g, dd), hasKey: true });
  assert.equal(vm.full.length, 6, 'bottes + 5 objets');
  const ids = vm.full.map((it) => it.id);
  assert.equal(new Set(ids).size, 6, 'pas de doublon');
  const me = normalizeLive(clone(demoGame), dd).me;
  for (const id of me.items) if (dd.isLegendary(id)) assert.ok(ids.includes(id), `objet possédé ${id} dans le build`);
  assert.ok(vm.full.filter((it) => it.owned).length >= 1);

  // build favori : il oriente le build (point de départ), sans retirer l'adaptation à la partie
  const presets = { [`${K.Ahri}|MIDDLE`]: { items: [6655, 3135, 3102], label: 'Comme Faker' } };
  const vp = computeIngame({ dd, store, rec, game: normalizeLive(clone(demoGame), dd), hasKey: true, presets });
  assert.equal(vp.fullTitle, 'Ton build : Comme Faker');
  assert.ok(vp.full.some((it) => it.id === 3135), 'Bâton du Vide du build favori repris');
});

test('Onglet Builds : variantes d’un champion, et builds d’un joueur suivi', () => {
  const extra = ahriRecords(30, 99).map((r) => ({ ...r, m: `P_${r.m}`, fp: 'faker' }));
  const store = makeStore(extra);
  const rec = new Recommender({ store, dd });
  const res = rec.buildVariants(K.Ahri, 'MIDDLE', { followed: [{ id: 'faker', name: 'Hide on bush' }] });
  const data = res.variants.filter((v) => v.source === 'data');
  assert.ok(data.length >= 2 && data.length <= 5);
  assert.ok(data[0].share >= data[1].share, 'triées par popularité');
  for (const v of data) assert.ok(v.items.length >= 3 && v.items.length <= 5 && new Set(v.items).size === v.items.length);
  const p = res.variants.find((v) => v.source === 'player');
  assert.equal(p.player, 'Hide on bush');
  assert.equal(p.n, 30);
});
