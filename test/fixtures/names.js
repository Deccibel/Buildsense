'use strict';

/**
 * Noms longs pour tester la mise en page (textes jamais coupés), en français et en anglais.
 * Les champions de test reçoivent les noms les plus longs du jeu ; quelques noms "extrêmes"
 * (mot unique très long) vérifient que rien ne déborde même dans le pire cas.
 */

const CHAMPS = {
  fr: {
    Ahri: 'Nunu et Willump', Zed: 'Aurelion Sol', Syndra: 'Renata Glasc', Orianna: 'Miss Fortune', Yasuo: 'Twisted Fate',
    Aatrox: 'Maître Yi', Darius: 'Jarvan IV', Ornn: 'Tahm Kench', Sejuani: "Bel'Veth", LeeSin: 'Xin Zhao', Viego: "Cho'Gath",
    Jinx: "Kog'Maw", Kaisa: "K'Santé", Ezreal: 'Dr Mundo', Soraka: 'Heimerdinger', Leona: 'Fiddlesticks', Lulu: 'Mordekaiser',
    Thresh: 'Tryndamere', Malzahar: 'Vladimir',
  },
  en: {
    Ahri: 'Nunu & Willump', Zed: 'Aurelion Sol', Syndra: 'Renata Glasc', Orianna: 'Miss Fortune', Yasuo: 'Twisted Fate',
    Aatrox: 'Master Yi', Darius: 'Jarvan IV', Ornn: 'Tahm Kench', Sejuani: "Bel'Veth", LeeSin: 'Xin Zhao', Viego: "Cho'Gath",
    Jinx: "Kog'Maw", Kaisa: "K'Sante", Ezreal: 'Dr. Mundo', Soraka: 'Heimerdinger', Leona: 'Fiddlesticks', Lulu: 'Mordekaiser',
    Thresh: 'Tryndamere', Malzahar: 'Vladimir',
  },
};

const ITEMS_FR = {
  1001: 'Bottes', 1052: "Tome d'amplification", 1026: 'Baguette explosive', 1058: 'Bâton surdimensionné', 1027: 'Cristal de saphir',
  3802: 'Chapitre perdu', 1029: 'Armure de tissu', 1033: 'Cape de nullité', 1036: 'Épée longue', 1037: 'Pioche',
  1018: "Cape d'agilité", 1042: 'Dague', 1056: 'Anneau de Doran', 2003: 'Potion de soin', 3340: 'Balise furtive',
  3916: "Orbe de l'oubli", 3165: 'Morellonomicon', 2420: 'Brassard du chercheur', 3157: 'Sablier de Zhonya',
  3102: 'Voile de la banshee', 3089: 'Coiffe de Rabadon', 3135: 'Bâton du Vide', 6655: 'Compagnon de Luden',
  4645: 'Flamme-ombre', 3118: 'Malignité', 3020: 'Chaussures de sorcier', 3047: "Jambières d'acier plaquées",
  3111: 'Sandales de Mercure', 3006: 'Grèves de berserker', 3123: 'Appel du bourreau', 3033: 'Rappel mortel',
  3036: 'Salutations de Lord Dominik', 3031: "Lame d'infini", 6672: 'Tueur de krakens', 3140: 'Écharpe de vif-argent',
  3139: 'Cimeterre mercuriel', 6695: 'Croc du serpent', 3026: 'Ange gardien', 3156: 'Gueule de Malmortius',
  3143: 'Présage de Randuin', 3075: 'Cotte épineuse', 3065: 'Visage spirituel', 3004: 'Manamune', 3042: 'Muramana',
  223031: "Lame d'infini (Arena)", 223157: 'Sablier de Zhonya (Arena)', 223089: 'Coiffe de Rabadon (Arena)',
  226655: 'Compagnon de Luden (Arena)', 224645: 'Flamme-ombre (Arena)', 2065: 'Hymne guerrier de Shurelya',
};

const RUNES_FR = {
  8100: 'Domination', 8200: 'Sorcellerie', 8000: 'Précision',
  8112: 'Électrocution', 8128: 'Moisson noire', 9923: 'Déluge de lames', 8126: 'Coup bas', 8139: 'Goût du sang',
  8143: 'Impact soudain', 8137: 'Sixième sens', 8140: 'Souvenirs macabres', 8141: 'Pupille profonde',
  8135: 'Chasseur de trésors', 8105: 'Chasseur implacable', 8106: 'Chasseur ultime', 8214: 'Invocation : Aery',
  8229: 'Comète arcanique', 8230: 'Rush phasique', 8224: 'Orbe annulaire', 8226: 'Bande de flux de mana',
  8275: 'Cape de nimbus', 8210: 'Transcendance', 8234: 'Célérité', 8233: 'Concentration absolue', 8237: 'Brûlure',
  8232: "Marche sur l'eau", 8236: 'Tempête menaçante', 8005: 'Attaque soutenue', 8008: 'Rythme meurtrier',
  8021: 'Jeu de jambes', 8010: 'Conquérant', 9101: 'Absorption de vie', 9111: 'Triomphe', 8009: "Présence d'esprit",
  9104: 'Légende : alacrité', 9105: 'Légende : hâte', 9103: 'Légende : lignée', 8014: 'Coup de grâce', 8017: 'Abattage',
  8299: "Baroud d'honneur",
};

const SPELLS_FR = {
  SummonerFlash: 'Saut éclair', SummonerDot: 'Embrasement', SummonerTeleport: 'Téléportation', SummonerBarrier: 'Barrière',
  SummonerHeal: 'Soins', SummonerSmite: 'Châtiment', SummonerExhaust: 'Fatigue', SummonerSnowball: 'Marque', SummonerMana: 'Clarté',
};

// cas extrêmes : un seul mot très long, comme certains noms allemands
const EXTREME = {
  6655: 'Unendlichkeitsschwertverzauberungskompanion',
  3157: 'Sablier de Zhonya de la Chronomancienne Éternelle',
};

/**
 * @param {object} raw  données Data Dragon de test
 * @param {'fr'|'en'} lang
 * @param {{ extreme?: boolean }} opts
 */
function localize(raw, lang = 'fr', { extreme = false } = {}) {
  const out = JSON.parse(JSON.stringify(raw));
  out.language = lang === 'fr' ? 'fr_FR' : 'en_US';
  for (const [id, c] of Object.entries(out.champions)) {
    const name = CHAMPS[lang][id];
    if (name) c.name = name;
  }
  if (lang === 'fr') {
    for (const [id, it] of Object.entries(out.items)) if (ITEMS_FR[id]) it.name = ITEMS_FR[id];
    for (const st of out.runes) {
      if (RUNES_FR[st.id]) st.name = RUNES_FR[st.id];
      for (const slot of st.slots) for (const r of slot.runes) if (RUNES_FR[r.id]) r.name = RUNES_FR[r.id];
    }
    for (const [id, sp] of Object.entries(out.summoners)) if (SPELLS_FR[id]) sp.name = SPELLS_FR[id];
  }
  if (extreme) for (const [id, name] of Object.entries(EXTREME)) out.items[id].name = name;
  return out;
}

module.exports = { localize };
