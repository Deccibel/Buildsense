'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { spellSlots } = require('../src/core/lcu');

const FLASH = 4;
const TP = 12;
const IGNITE = 14;

test('sorts : Flash garde sa touche (D ou F), le second sort prend l’autre case', () => {
  assert.deepStrictEqual(spellSlots([FLASH, IGNITE], [TP, FLASH]), [IGNITE, FLASH]);
  assert.deepStrictEqual(spellSlots([FLASH, IGNITE], [FLASH, TP]), [FLASH, IGNITE]);
});

test('sorts : rien à changer si les bons sorts sont déjà en place, même inversés', () => {
  assert.strictEqual(spellSlots([FLASH, IGNITE], [IGNITE, FLASH]), null);
});

test('sorts : cases vides ou conseil incomplet', () => {
  assert.deepStrictEqual(spellSlots([FLASH, 32], [0, 0]), [FLASH, 32]);
  assert.strictEqual(spellSlots([FLASH], [1, 2]), null);
  assert.strictEqual(spellSlots([FLASH, FLASH], [1, 2]), null);
});
