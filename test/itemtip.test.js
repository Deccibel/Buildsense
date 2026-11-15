'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { tipOf } = require('../src/core/itemInfo');

test('infobulle : statistiques et effets lus dans la description Data Dragon', () => {
  const desc =
    '<mainText><stats><attention>+105</attention> puissance<br><attention>+50</attention> armure</stats><br><br>' +
    '<passive>Écho</passive><br>Les compétences tirent des échos.<br><br><active>Pause temporelle</active><br>Vous entrez en <keyword>stase</keyword> pendant 2.5 sec.</mainText>';
  const t = tipOf(desc);
  assert.deepStrictEqual(t.stats, ['+105 puissance', '+50 armure']);
  assert.deepStrictEqual(t.effects, [
    { kind: 'passive', name: 'Écho', text: 'Les compétences tirent des échos.' },
    { kind: 'active', name: 'Pause temporelle', text: 'Vous entrez en stase pendant 2.5 sec.' },
  ]);
});

test('infobulle : description vide', () => {
  assert.deepStrictEqual(tipOf(''), { stats: [], effects: [] });
});
