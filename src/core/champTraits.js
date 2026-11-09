'use strict';

/**
 * Traits de champions que Data Dragon ne fournit pas.
 * Clés = identifiants Data Dragon (insensibles à la casse).
 * Valeurs indicatives, à ajuster si le jeu évolue : elles servent seulement
 * à pondérer l'analyse de la composition adverse.
 */

// Soins / régénération (0 à 1.5)
const HEAL = {
  Soraka: 1.5, Yuumi: 1.1, Sona: 1, Nami: 1, Milio: 1, Taric: 0.7, Seraphine: 0.6, Janna: 0.4, Lulu: 0.3,
  Aatrox: 1.5, Vladimir: 1.5, Sylas: 1.2, DrMundo: 1.5, Warwick: 1.3, Fiddlesticks: 1, Swain: 1.2,
  Briar: 1.5, Illaoi: 1.2, Olaf: 1, Trundle: 1, Volibear: 0.8, Gwen: 0.8, Fiora: 0.8, Irelia: 0.6,
  Samira: 0.7, Senna: 0.6, Maokai: 0.8, Zac: 1, Nasus: 0.8, Darius: 0.6, Nidalee: 0.8, Kindred: 0.5,
  RekSai: 0.6, Viego: 0.8, Renekton: 0.6, Udyr: 0.6, Kayn: 0.6, Ivern: 0.5, Rakan: 0.5, Alistar: 0.7,
  Yorick: 0.6, Belveth: 0.6, Hecarim: 0.5, Shyvana: 0.4, Ambessa: 0.8, Sett: 0.3, Mordekaiser: 0.5,
};

// Contrôles durs (0 à 3)
const CC = {
  Leona: 3, Nautilus: 3, Sejuani: 3, Amumu: 3, Rell: 3, Alistar: 3, Skarner: 3, Malphite: 2.5, Maokai: 2.5,
  Rammus: 2.5, Thresh: 2.5, Malzahar: 2.5, Ornn: 2.5, Zac: 2.5, Lissandra: 2, Morgana: 2, Lux: 2,
  Blitzcrank: 2, Annie: 2, Braum: 2, Galio: 2, JarvanIV: 2, Kennen: 2, Nami: 2, Neeko: 2, Poppy: 2,
  Rakan: 2, Sion: 2, Veigar: 2, Vi: 2, Warwick: 2, MonkeyKing: 2, Seraphine: 2, Fiddlesticks: 2,
  Hecarim: 2, KSante: 2, Gnar: 2, Urgot: 2, Pyke: 1.5, Ashe: 1.5, Cassiopeia: 1.5, Gragas: 1.5,
  Nunu: 1.5, Renata: 1.5, Riven: 1.5, Sona: 1.5, Swain: 1.5, Syndra: 1.5, Taric: 1.5, TwistedFate: 1.5,
  XinZhao: 1.5, Zyra: 1.5, Varus: 1.5, Pantheon: 1.5, Diana: 1.5, Shen: 1.5, Sett: 1.5, Yasuo: 1.5,
  Yone: 1.5, Hwei: 1.5, Janna: 1.5, Orianna: 1.5, Camille: 1.5, Nocturne: 1.5, Taliyah: 1.5, Zoe: 1.5,
  Bard: 1.5, Lulu: 1.5, Volibear: 1.5, Singed: 1.5, Jax: 1, LeeSin: 1, Zilean: 1, Mordekaiser: 1,
  Rengar: 1, Aurora: 1, Briar: 1, Kalista: 1, Darius: 1, Ahri: 1, Leblanc: 1, Elise: 1, Xerath: 1,
  Velkoz: 1, Soraka: 1, Yuumi: 1, Kled: 1, Udyr: 1, Trundle: 1, Milio: 0.5, Karma: 0.5, Rumble: 0.5,
};

// Suppressions (nettoyables seulement par certains objets)
const SUPPRESSION = new Set(['malzahar', 'skarner', 'warwick', 'urgot']);

// Boucliers significatifs (0 à 1)
const SHIELD = {
  Lulu: 1, Janna: 1, Karma: 1, Seraphine: 0.8, Orianna: 0.8, Lux: 0.6, Ivern: 0.7, Rakan: 0.7,
  Taric: 0.7, Yuumi: 0.7, Milio: 1, Sona: 0.5, Braum: 0.5, Shen: 0.6, Sett: 1, Mordekaiser: 1,
  Riven: 0.5, Yasuo: 0.6, Yone: 0.6, Diana: 0.5, Malphite: 0.6, Nautilus: 0.6, Sion: 0.6, Thresh: 0.6,
  Vi: 0.5, Garen: 0.5, Rumble: 0.6, Annie: 0.5, Renata: 0.6, Camille: 0.4, Poppy: 0.5, Skarner: 0.5,
};

// Gros "auto-attaqueurs" non tireurs (pour le choix des bottes d'armure)
const AUTO_ATTACKERS = new Set([
  'yasuo', 'yone', 'tryndamere', 'masteryi', 'jax', 'fiora', 'irelia', 'kayle', 'gwen', 'belveth',
  'xinzhao', 'warwick', 'trundle', 'udyr', 'shyvana', 'nilah', 'viego', 'kindred', 'graves',
]);

function lower(obj) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v]));
}
const HEAL_L = lower(HEAL);
const CC_L = lower(CC);
const SHIELD_L = lower(SHIELD);

const key = (id) => String(id || '').toLowerCase();

module.exports = {
  heal: (id) => HEAL_L[key(id)] || 0,
  cc: (id) => CC_L[key(id)] || 0,
  shield: (id) => SHIELD_L[key(id)] || 0,
  suppression: (id) => SUPPRESSION.has(key(id)),
  autoAttacker: (id) => AUTO_ATTACKERS.has(key(id)),
};
