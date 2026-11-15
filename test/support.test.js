'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { DDragon } = require('../src/core/ddragon');
const { Store } = require('../src/core/store');
const { Recommender } = require('../src/core/recommender');
const { supportVM } = require('../src/core/viewModels');
const { buildsView, buildDetailView } = require('../src/core/pageViews');
const { computeChampSelect } = require('../src/core/engine');
const { passiveOf } = require('../src/core/itemInfo');
const { raw } = require('./fixtures/ddragon');
const { ahriRecords, roleRecords, supportRecords, ahriSupportRecords, threshSupportRecords, K } = require('./fixtures/records');

const dd = new DDragon().ingest(raw);

function setup(extra = []) {
  const store = new Store(null);
  store.add([...ahriRecords(), ...roleRecords(), ...supportRecords(), ...threshSupportRecords(), ...extra]);
  return { store, rec: new Recommender({ store, dd }) };
}

test('Objet de support : quête et évolutions déduites de Data Dragon', () => {
  assert.deepEqual(dd.support.stages, [3865, 3866, 3867]);
  assert.equal(dd.support.last, 3867);
  assert.deepEqual(dd.support.upgrades, [3869, 3870, 3877]);
  assert.equal(dd.supportStage(3865), 'quest');
  assert.equal(dd.supportStage(3866), 'quest');
  assert.equal(dd.supportStage(3867), 'choose');
  assert.equal(dd.supportStage(3870), 'done');
  assert.equal(dd.supportStage(3143), null);
  assert.ok(dd.isSupportItem(3869) && !dd.isSupportItem(1001));
  assert.ok(!dd.isLegendary(3869), 'jamais compté comme un objet du build');
  // effet propre à chaque évolution, dans la langue des données
  assert.deepEqual(dd.item(3877).passive, { name: 'Spellblade', text: 'After using an Ability, your next attack deals bonus physical damage.' });
  assert.equal(passiveOf('<mainText><stats></stats><br><br><passive>A</passive><br>Texte , avec <b>balises</b> .<br><br><active>B</active></mainText>').text, 'Texte, avec balises.');
  assert.equal(passiveOf('<mainText>rien</mainText>'), null);
});

test('Objet de support : évolution la plus prise sur ce champion en support', () => {
  const { rec } = setup();
  const prof = rec.profile(K.Thresh, 'UTILITY', 'sr');
  assert.equal(prof.supportBuild, true);
  const c = rec.supportChoice(prof);
  assert.equal(c.generic, false);
  assert.equal(c.options[0].id, 3869, 'Opposition céleste en tête');
  assert.equal(c.options[1].id, 3870);
  assert.ok(Math.abs(c.options.reduce((s, o) => s + o.share, 0) - 1) < 1e-9);
  // pas un build de support : rien
  assert.equal(rec.profile(K.Ahri, 'MIDDLE', 'sr').supportBuild, false);
  assert.equal(rec.supportChoice(rec.profile(K.Ahri, 'MIDDLE', 'sr')), null);
});

test('Objet de support : champion rarement joué support -> supports du même style', () => {
  // Syndra (mage) support : aucune partie à ce poste. Les supports qui se construisent comme elle (mages)
  // prennent Mélodie du sang ici ; les tanks (Thresh) prennent Opposition céleste : ils ne comptent pas.
  const mages = [];
  for (let i = 0; i < 40; i++) {
    mages.push({ m: `MG${i}`, v: '16.21', c: i % 2 ? K.Orianna : K.Ahri, r: 'UTILITY', w: i % 2, d: 30, s: [4, 14], ru: [], st: [3865], co: [[6655, 15], [4645, 24]], fi: [i % 5 === 0 ? 3869 : 3877, 6655, 4645], sk: '', e: [], o: 0, a: [] });
  }
  for (let i = 0; i < 20; i++) {
    mages.push({ m: `SY${i}`, v: '16.21', c: K.Syndra, r: 'MIDDLE', w: i % 2, d: 30, s: [4, 14], ru: [], st: [1056], co: [[6655, 12], [4645, 20], [3089, 27]], fi: [6655, 4645, 3089], sk: '', e: [], o: 0, a: [] });
  }
  const { rec } = setup(mages);
  const prof = rec.profile(K.Syndra, 'UTILITY', 'sr');
  assert.equal(prof.supportBuild, true);
  const c = rec.supportChoice(prof);
  assert.equal(c.generic, true);
  assert.equal(c.options[0].id, 3877);
  const vm = supportVM(dd, { stage: 'none', owned: 0, options: c.options, generic: true });
  assert.match(vm.note, /supports du même style/);
});

test('Objet de support en partie : à prévoir, à choisir, puis déjà pris ; build à 4 objets', () => {
  const { rec } = setup();
  const play = (myItems) => rec.nextItems({ champKey: K.Thresh, role: 'UTILITY', myItems, enemyKeys: [K.Zed, K.Jinx, K.Aatrox, K.Sejuani, K.Soraka], gold: 500 });

  const start = play([3865]);
  assert.equal(start.support.stage, 'quest');
  assert.equal(start.full.items.length, 4, 'objet de support + bottes + 4 objets');
  let vm = supportVM(dd, start.support);
  assert.equal(vm.state, 'plan');
  assert.equal(vm.item.id, 3869);
  assert.ok(vm.item.passive && vm.item.passive.text.length > 10);
  assert.match(vm.note, /Chall\/GM sur ce champion/);

  const done = play([3867, 3143]);
  assert.equal(done.support.stage, 'choose');
  vm = supportVM(dd, done.support);
  assert.equal(vm.state, 'choose');
  assert.ok(done.full.items[0].owned && done.full.items[0].id === 3143);

  const taken = play([3870, 3143, 3075]);
  assert.equal(taken.support.stage, 'done');
  vm = supportVM(dd, taken.support);
  assert.equal(vm.state, 'done');
  assert.equal(vm.item.id, 3870, 'on montre celle que tu as prise');

  // avant d'avoir acheté quoi que ce soit, au poste de support : déjà prévu
  assert.equal(play([]).support.stage, 'none');
  // un objet de support dans l'inventaire suffit, même si le poste est mal détecté
  const misread = rec.nextItems({ champKey: K.Thresh, role: 'TOP', myItems: [3866], enemyKeys: [], gold: 0 });
  assert.ok(misread.support && misread.support.stage === 'quest');
  // les autres postes gardent 5 objets et aucune case de support
  const mid = rec.nextItems({ champKey: K.Ahri, role: 'MIDDLE', myItems: [], enemyKeys: [], gold: 0 });
  assert.equal(mid.support, null);
  assert.equal(mid.full.items.length, 5);
});

test('Objet de support : sélection des champions et page d’objets de la boutique', () => {
  const { store, rec } = setup();
  const cs = { myChampion: dd.champion(K.Thresh), role: 'UTILITY', allies: [], enemies: [dd.champion(K.Soraka)], locked: true, queueId: 420, mapId: 11, gameMode: 'CLASSIC' };
  const vm = computeChampSelect({ dd, store, rec, cs, hasKey: true, importHotkey: 'CommandOrControl+Shift+R' });
  assert.equal(vm.support.state, 'plan');
  assert.equal(vm.support.item.id, 3869);
  assert.deepEqual(vm.itemSet.support, [3869, 3870]);
  assert.equal(vm.core.length, 2, 'coeur de build des supports : 2 objets');
});

test('Onglet Builds : variantes de support (2 objets de coeur) avec leur objet de support', () => {
  const { rec } = setup(ahriSupportRecords(4));
  const b = buildsView({ dd, rec }, K.Thresh, 'UTILITY', 'sr');
  assert.equal(b.supportBuild, true);
  assert.ok(b.variants.length >= 2);
  assert.ok(b.variants[0].n >= 20, 'regroupées sur 2 objets : beaucoup plus de parties par variante');
  assert.ok(b.variants[0].items.length <= 4);
  assert.equal(b.variants[0].support.id, 3869);
  const d = buildDetailView({ dd, rec }, K.Thresh, 'UTILITY', 'sr', b.variants[0].id);
  assert.ok(d.slots.length <= 4);
  assert.equal(d.support.options[0].id, 3869);
  assert.ok(d.support.options[0].passive.name);
  assert.ok(d.support.options.every((o) => o.share >= 0.05 || o === d.support.options[0]));
  // hors support : pas de bloc
  const mid = buildsView({ dd, rec }, K.Ahri, 'MIDDLE', 'sr');
  assert.equal(mid.supportBuild, false);
  assert.equal(mid.variants[0].support, null);
  assert.equal(buildDetailView({ dd, rec }, K.Ahri, 'MIDDLE', 'sr', mid.variants[0].id).support, null);
});
