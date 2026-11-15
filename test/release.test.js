'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { choose, cmp } = require('../scripts/promote');

// situation réelle au moment du changement de nom : 1.8.0 en bêta (à promouvoir), puis le nouveau design retenu
const betas = [
  { tag: 'PG-20261115-b2', version: '2.0.0', hold: true, day: '2026-11-15' },
  { tag: 'PG-20261115-b1', version: '1.8.0', hold: false, day: '2026-11-15' },
  { tag: 'PG-20261113-b2', version: '1.7.1', hold: false, day: '2026-11-13' },
  { tag: 'PG-20261113-b1', version: '1.7.0', hold: false, day: '2026-11-13' },
];

test('Promotion : une bêta retenue ne passe jamais en stable toute seule, et ne bloque pas la précédente', () => {
  // le jour même : rien (une nuit de recul)
  let r = choose(betas, '1.7.1', '2026-11-15');
  assert.equal(r.pick, null);
  assert.match(r.why, /demain/);
  // le lendemain : la 1.8.0 passe, pas le nouveau design
  r = choose(betas, '1.7.1', '2026-11-16');
  assert.equal(r.pick.tag, 'PG-20261115-b1');
  assert.match(r.why, /PG-20261115-b2 retenue/);
  // ensuite : plus rien à promouvoir tant que la bêta est retenue, même en forçant
  r = choose(betas, '1.8.0', '2026-11-20');
  assert.equal(r.pick, null);
  assert.match(r.why, /retenue/);
  assert.equal(choose(betas, '1.8.0', '2026-11-20', { force: true }).pick, null);
  // des semaines plus tard, avec d'autres bêtas retenues : toujours rien
  const more = [{ tag: 'PG-20261201-b1', version: '2.1.0', hold: true, day: '2026-12-01' }, ...betas];
  assert.equal(choose(more, '1.8.0', '2026-12-25').pick, null);
});

test('Promotion : décision explicite (--tag), forçage et cas courants', () => {
  // sortie du nouveau design sur demande
  let r = choose(betas, '1.8.0', '2026-11-20', { tag: 'PG-20261115-b2' });
  assert.equal(r.pick.version, '2.0.0');
  assert.match(r.why, /retenue/);
  assert.equal(choose(betas, '1.8.0', '2026-11-20', { tag: 'PG-00000000-b1' }).pick, null);
  assert.equal(choose(betas, '1.8.0', '2026-11-20', { tag: 'PG-20261113-b2' }).pick, null, 'jamais de retour en arrière');
  // --force : sans attendre le lendemain, mais sans lever la retenue
  assert.equal(choose(betas, '1.7.1', '2026-11-15', { force: true }).pick.tag, 'PG-20261115-b1');
  // sans retenue : la plus récente, publiée la veille ou avant
  const free = betas.map((b) => ({ ...b, hold: false }));
  assert.equal(choose(free, '1.7.1', '2026-11-16').pick.version, '2.0.0');
  // deux bêtas le même jour : la plus haute version
  assert.equal(choose(free.slice(2), '1.6.0', '2026-11-14').pick.tag, 'PG-20261113-b2');
  // rien de plus récent que la stable
  assert.equal(choose(free.slice(2), '1.7.1', '2026-11-20').pick, null);
  // dépôt sans version stable
  assert.equal(choose(free.slice(3), '', '2026-11-20').pick.version, '1.7.0');
  assert.equal(cmp('1.10.0', '1.9.3'), 1);
  assert.equal(cmp('2.0.0', '2.0.0'), 0);
});
