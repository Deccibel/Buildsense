'use strict';

/**
 * Fiches build FACTICES (déterministes) pour tester le moteur de recommandation.
 * Ahri mid : Luden -> (Zhonya surtout contre Zed / compos physiques) -> Rabadon,
 * Morello plus fréquent face aux soigneurs, Void Staff face aux tanks.
 */

const { lcg } = require('../../src/core/util');

const K = {
  Ahri: 103, Zed: 238, Syndra: 134, Orianna: 61, Yasuo: 157, Aatrox: 266, Darius: 122, Ornn: 516,
  Sejuani: 113, LeeSin: 64, Viego: 234, Jinx: 222, Kaisa: 145, Ezreal: 81, Soraka: 16, Leona: 89,
  Lulu: 117, Thresh: 412,
};
const AD_HEAVY = new Set([K.Zed, K.Yasuo, K.Aatrox, K.Darius, K.LeeSin, K.Viego, K.Jinx, K.Kaisa]);

const PAGES = {
  electrocute: [8100, 8112, 8139, 8140, 8106, 8200, 8210, 8236, 5008, 5008, 5001],
  comet: [8200, 8229, 8226, 8210, 8237, 8100, 8139, 8106, 5008, 5008, 5001],
  phase: [8200, 8230, 8275, 8210, 8236, 8100, 8139, 8106, 5008, 5008, 5011],
};
const SK_QWE = '123114121242233433';
const SK_QEW = '132114131343322422';

function pick(rnd, entries) {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let x = rnd() * total;
  for (const [v, w] of entries) {
    if ((x -= w) <= 0) return v;
  }
  return entries[entries.length - 1][0];
}

function ahriRecords(n = 180, seed = 7) {
  const rnd = lcg(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    const opp = pick(rnd, [[K.Zed, 35], [K.Syndra, 25], [K.Orianna, 25], [K.Yasuo, 15]]);
    const top = pick(rnd, [[K.Aatrox, 40], [K.Darius, 30], [K.Ornn, 30]]);
    const jg = pick(rnd, [[K.Sejuani, 35], [K.LeeSin, 35], [K.Viego, 30]]);
    const bot = pick(rnd, [[K.Jinx, 40], [K.Kaisa, 30], [K.Ezreal, 30]]);
    const sup = pick(rnd, [[K.Soraka, 25], [K.Leona, 30], [K.Lulu, 25], [K.Thresh, 20]]);
    const enemies = [top, jg, opp, bot, sup];
    const adHeavy = enemies.filter((k) => AD_HEAVY.has(k)).length >= 4;
    const healers = enemies.includes(K.Soraka) && enemies.includes(K.Aatrox);
    const tanks = enemies.includes(K.Ornn) && enemies.includes(K.Sejuani);

    const first = pick(rnd, [[6655, 85], [3118, 15]]);
    const boots = pick(rnd, [[3020, enemies.includes(K.Leona) || enemies.includes(K.Sejuani) ? 60 : 85], [3111, enemies.includes(K.Leona) || enemies.includes(K.Sejuani) ? 40 : 15]]);
    const second =
      opp === K.Zed || adHeavy
        ? pick(rnd, [[3157, 62], [4645, 28], [3089, 10]])
        : pick(rnd, [[4645, 55], [3089, 25], [3157, 20]]);
    const thirdChoices = [[3089, 55], [3135, tanks ? 45 : 15], [3102, 12], [3165, healers ? 40 : 6]].filter(([id]) => id !== second);
    const third = pick(rnd, thirdChoices);

    let win = rnd() < 0.5;
    if (second === 3157 && opp === K.Zed) win = rnd() < 0.6;
    if (third === 3165 && healers) win = rnd() < 0.58;

    const shortGame = rnd() < 0.18;
    const co = [[first, 11], [boots, 13], [second, 19]];
    if (!shortGame) co.push([third, 26]);

    const page = opp === K.Zed
      ? pick(rnd, [['electrocute', 30], ['comet', 20], ['phase', 50]])
      : pick(rnd, [['electrocute', 55], ['comet', 35], ['phase', 10]]);

    out.push({
      m: `EUW1_${1000 + i}`,
      v: rnd() < 0.7 ? '16.21' : '16.20',
      c: K.Ahri,
      r: 'MIDDLE',
      w: win ? 1 : 0,
      d: shortGame ? 22 : 31,
      s: pick(rnd, [[[4, 14], 70], [[4, 12], 25], [[21, 4], 5]]),
      ru: PAGES[page],
      st: rnd() < 0.9 ? [1056, 2003, 2003] : [1052, 2003, 2003],
      co,
      fi: co.map((x) => x[0]),
      sk: rnd() < 0.8 ? SK_QWE : SK_QEW,
      e: enemies,
      o: opp,
      a: [K.Ornn, K.Viego, K.Kaisa, K.Thresh],
    });
  }
  return out;
}

/**
 * Ahri en ARAM : Comète arcanique + Flash/Marque, départ Tome + Bottes,
 * Morellonomicon fréquent face aux soigneurs, sinon Shadowflame.
 */
function aramAhriRecords(n = 120, seed = 11) {
  const rnd = lcg(seed);
  const pool = [K.Zed, K.Syndra, K.Orianna, K.Yasuo, K.Aatrox, K.Darius, K.Ornn, K.Sejuani, K.Jinx, K.Kaisa, K.Ezreal, K.Soraka, K.Leona, K.Lulu, K.Thresh];
  const out = [];
  for (let i = 0; i < n; i++) {
    const enemies = [];
    while (enemies.length < 5) {
      const c = pool[Math.floor(rnd() * pool.length)];
      if (!enemies.includes(c)) enemies.push(c);
    }
    const healers = enemies.includes(K.Soraka) || enemies.includes(K.Aatrox);
    const first = pick(rnd, [[6655, 90], [3118, 10]]);
    const second = healers ? pick(rnd, [[3165, 60], [4645, 30], [3089, 10]]) : pick(rnd, [[4645, 60], [3089, 30], [3165, 10]]);
    const third = pick(rnd, [[3089, 60], [3135, 40]].filter(([id]) => id !== second));
    const co = [[first, 7], [3020, 9], [second, 13], [third, 18]];
    out.push({
      m: `EUW1_A${2000 + i}`,
      v: '16.21',
      q: 'aram',
      c: K.Ahri,
      r: '',
      w: rnd() < (second === 3165 && healers ? 0.6 : 0.5) ? 1 : 0,
      d: 19,
      s: rnd() < 0.8 ? [4, 32] : [4, 14],
      ru: rnd() < 0.7 ? PAGES.comet : PAGES.electrocute,
      st: [1052, 1001, 2003],
      co,
      fi: co.map((x) => x[0]),
      sk: SK_QWE,
      e: enemies,
      o: 0,
      a: [K.Lulu, K.Ornn, K.Kaisa, K.Sejuani],
    });
  }
  return out;
}

/** Ahri en Arena : objets Arena (achetés d'un coup), pas de runes. */
function arenaAhriRecords(n = 60, seed = 5) {
  const rnd = lcg(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    const second = pick(rnd, [[223157, 65], [224645, 35]]);
    const co = [[226655, 3], [second, 8], [223089, 13]];
    out.push({
      m: `EUW1_C${3000 + i}`,
      v: '16.21',
      q: 'arena',
      c: K.Ahri,
      r: '',
      w: rnd() < 0.5 ? 1 : 0,
      d: 24,
      s: [4, 21],
      ru: [],
      st: [],
      co,
      fi: co.map((x) => x[0]),
      sk: SK_QWE,
      e: [],
      o: 0,
      a: [K.Leona],
    });
  }
  return out;
}

/**
 * Supports classiques (tous champions) : départ objet de support + potions, Flash + Embrasement/Fatigue.
 * Sert de référence "poste" quand on joue un champion hors de son poste habituel.
 */
function supportRecords(n = 80, seed = 13) {
  const rnd = lcg(seed);
  const champs = [K.Soraka, K.Leona, K.Lulu, K.Thresh];
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      m: `EUW1_S${4000 + i}`,
      v: '16.21',
      c: champs[i % champs.length],
      r: 'UTILITY',
      w: rnd() < 0.5 ? 1 : 0,
      d: 30,
      s: rnd() < 0.6 ? [4, 14] : [4, 3],
      ru: [],
      st: rnd() < 0.85 ? [3865, 2003, 2003] : [3865, 2003, 3340],
      co: [],
      fi: [],
      sk: '',
      e: [],
      o: 0,
      a: [],
    });
  }
  return out;
}

/** Quelques parties d'Ahri jouée support (poste inhabituel). */
function ahriSupportRecords(n = 4, seed = 17) {
  const rnd = lcg(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      m: `EUW1_AS${5000 + i}`,
      v: '16.21',
      c: K.Ahri,
      r: 'UTILITY',
      w: rnd() < 0.5 ? 1 : 0,
      d: 28,
      s: [4, 14],
      ru: PAGES.electrocute,
      st: [3865, 2003, 2003],
      co: [[6655, 14], [3020, 16], [4645, 22]],
      fi: [6655, 3020, 4645],
      sk: SK_QWE,
      e: [K.Aatrox, K.Sejuani, K.Syndra, K.Jinx, K.Leona],
      o: K.Leona,
      a: [K.Ornn, K.Viego, K.Zed, K.Kaisa],
    });
  }
  return out;
}

/** Fiches minimales pour d'autres champions (sert à connaître leur rôle habituel). */
function roleRecords(seed = 3) {
  const rnd = lcg(seed);
  const spec = [
    [K.Zed, 'MIDDLE', 40], [K.Syndra, 'MIDDLE', 30], [K.Orianna, 'MIDDLE', 30], [K.Yasuo, 'MIDDLE', 14],
    [K.Yasuo, 'TOP', 6], [K.Jinx, 'BOTTOM', 30], [K.Soraka, 'UTILITY', 20], [K.Aatrox, 'TOP', 25],
    [K.Sejuani, 'JUNGLE', 20], [K.Kaisa, 'BOTTOM', 20], [K.Thresh, 'UTILITY', 20],
  ];
  const out = [];
  let i = 0;
  for (const [c, r, n] of spec) {
    for (let j = 0; j < n; j++) {
      out.push({ m: `EUW1_9${i++}`, v: '16.21', c, r, w: rnd() < 0.5 ? 1 : 0, d: 30, s: [4, 14], ru: [], st: [], co: [], fi: [], sk: '', e: [], o: 0, a: [] });
    }
  }
  return out;
}

module.exports = { ahriRecords, aramAhriRecords, arenaAhriRecords, supportRecords, ahriSupportRecords, roleRecords, K, PAGES };
