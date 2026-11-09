'use strict';

/**
 * Sous-ensemble FACTICE de Data Dragon (en_US), au même format que le vrai,
 * pour tester la logique sans réseau. Prix et recettes simplifiés.
 */

const desc = (stats, extra = '') =>
  `<mainText><stats>${stats.map(([v, n]) => `<attention>${v}</attention> ${n}`).join('<br>')}</stats><br><br>${extra}</mainText><br>`;

function item(name, o) {
  return {
    name,
    description: desc(o.stats || [], o.extra || ''),
    plaintext: '',
    from: (o.from || []).map(String),
    into: (o.into || []).map(String),
    gold: { base: o.base, total: o.total, sell: Math.round(o.total * 0.7), purchasable: o.purchasable !== false },
    tags: o.tags || [],
    maps: o.maps || { 11: true, 12: true },
    image: { full: 'x.png' },
    ...(o.consumed ? { consumed: true } : {}),
  };
}

const GW = '<passive>Cursed</passive><br>Dealing damage applies <keyword>40% Grievous Wounds</keyword> to champions.';
const LW = '<br><rules>Limited to 1 Last Whisper item.</rules>';

const items = {
  1001: item('Boots', { base: 300, total: 300, stats: [[25, 'Move Speed']], tags: ['Boots'], into: [3020, 3047, 3111, 3006] }),
  1052: item('Amplifying Tome', { base: 400, total: 400, stats: [[20, 'Ability Power']], into: [3916, 2420, 3802] }),
  1026: item('Blasting Wand', { base: 850, total: 850, stats: [[45, 'Ability Power']] }),
  1058: item('Needlessly Large Rod', { base: 1200, total: 1200, stats: [[60, 'Ability Power']] }),
  1027: item('Sapphire Crystal', { base: 300, total: 300, stats: [[250, 'Mana']] }),
  3802: item('Lost Chapter', { base: 500, total: 1200, from: [1052, 1027], stats: [[40, 'Ability Power'], [300, 'Mana'], [10, 'Ability Haste']] }),
  1029: item('Cloth Armor', { base: 300, total: 300, stats: [[15, 'Armor']] }),
  1033: item('Null-Magic Mantle', { base: 450, total: 450, stats: [[25, 'Magic Resist']] }),
  1036: item('Long Sword', { base: 350, total: 350, stats: [[10, 'Attack Damage']] }),
  1037: item('Pickaxe', { base: 875, total: 875, stats: [[25, 'Attack Damage']] }),
  1018: item('Cloak of Agility', { base: 600, total: 600, stats: [['15%', 'Critical Strike Chance']] }),
  1042: item('Dagger', { base: 250, total: 250, stats: [['10%', 'Attack Speed']] }),
  1056: item("Doran's Ring", { base: 400, total: 400, stats: [[18, 'Ability Power'], [90, 'Health']], tags: ['Lane'] }),
  2003: item('Health Potion', { base: 50, total: 50, tags: ['Consumable'], consumed: true }),
  3340: item('Stealth Ward', { base: 0, total: 0, tags: ['Trinket', 'Vision'] }),
  3916: item('Oblivion Orb', { base: 400, total: 800, from: [1052], into: [3165], stats: [[25, 'Ability Power']], extra: GW }),
  3165: item('Morellonomicon', { base: 1200, total: 2850, from: [3916, 1026], stats: [[75, 'Ability Power'], [350, 'Health']], extra: GW }),
  2420: item("Seeker's Armguard", { base: 900, total: 1600, from: [1052, 1029], into: [3157], stats: [[30, 'Ability Power'], [20, 'Armor']] }),
  3157: item("Zhonya's Hourglass", {
    base: 450, total: 3250, from: [2420, 1058],
    stats: [[105, 'Ability Power'], [50, 'Armor']],
    extra: '<active>Time Stop</active><br>Put yourself in <keyword>Stasis</keyword> for 2.5 seconds.',
  }),
  3102: item("Banshee's Veil", {
    base: 1700, total: 3000, from: [1026, 1033],
    stats: [[105, 'Ability Power'], [40, 'Magic Resist']],
    extra: '<passive>Annul</passive><br>Grants a <keyword>Spell Shield</keyword> that blocks the next ability.',
  }),
  3089: item("Rabadon's Deathcap", { base: 1100, total: 3500, from: [1058, 1058], stats: [[130, 'Ability Power']] }),
  3135: item('Void Staff', { base: 1750, total: 3000, from: [1026, 1052], stats: [[95, 'Ability Power'], ['40%', 'Magic Penetration']] }),
  6655: item("Luden's Companion", { base: 850, total: 2900, from: [3802, 1026], stats: [[100, 'Ability Power'], [600, 'Mana'], [20, 'Ability Haste']] }),
  4645: item('Shadowflame', { base: 1150, total: 3200, from: [1058, 1026], stats: [[110, 'Ability Power'], [15, 'Magic Penetration']] }),
  3118: item('Malignance', { base: 650, total: 2700, from: [3802, 1026], stats: [[80, 'Ability Power'], [600, 'Mana'], [20, 'Ability Haste']] }),
  3020: item("Sorcerer's Shoes", { base: 800, total: 1100, from: [1001], stats: [[12, 'Magic Penetration'], [45, 'Move Speed']], tags: ['Boots'] }),
  3047: item('Plated Steelcaps', { base: 600, total: 1200, from: [1001, 1029], stats: [[25, 'Armor'], [45, 'Move Speed']], tags: ['Boots'] }),
  3111: item("Mercury's Treads", { base: 500, total: 1250, from: [1001, 1033], stats: [[25, 'Magic Resist'], [45, 'Move Speed'], ['30%', 'Tenacity']], tags: ['Boots'] }),
  3006: item("Berserker's Greaves", { base: 550, total: 1100, from: [1001, 1042], stats: [['25%', 'Attack Speed'], [45, 'Move Speed']], tags: ['Boots'] }),
  3123: item("Executioner's Calling", { base: 450, total: 800, from: [1036], into: [3033], stats: [[15, 'Attack Damage']], extra: GW }),
  3033: item('Mortal Reminder', { base: 1325, total: 3000, from: [3123, 1037], stats: [[35, 'Attack Damage'], ['35%', 'Armor Penetration']], extra: GW + LW }),
  3036: item("Lord Dominik's Regards", { base: 1525, total: 3000, from: [1037, 1018], stats: [[35, 'Attack Damage'], ['25%', 'Critical Strike Chance'], ['35%', 'Armor Penetration']], extra: LW }),
  3031: item('Infinity Edge', { base: 1100, total: 3450, from: [1037, 1037, 1018], stats: [[65, 'Attack Damage'], ['25%', 'Critical Strike Chance']] }),
  6672: item('Kraken Slayer', { base: 1975, total: 3100, from: [1037, 1042], stats: [[45, 'Attack Damage'], ['40%', 'Attack Speed']] }),
  3140: item('Quicksilver Sash', { base: 850, total: 1300, from: [1033], into: [3139], stats: [[30, 'Magic Resist']], extra: '<active>Quicksilver</active><br>Remove all crowd control debuffs.' }),
  3139: item('Mercurial Scimitar', { base: 1025, total: 3200, from: [3140, 1037], stats: [[40, 'Attack Damage'], [35, 'Magic Resist']], extra: '<active>Quicksilver</active><br>Remove all crowd control debuffs.' }),
  6695: item("Serpent's Fang", { base: 1625, total: 2500, from: [1037], stats: [[55, 'Attack Damage'], [15, 'Lethality']], extra: '<passive>Shield Reaver</passive><br>Dealing damage reduces shields.' }),
  3026: item('Guardian Angel', { base: 2025, total: 3200, from: [1037, 1029], stats: [[55, 'Attack Damage'], [45, 'Armor']], extra: '<passive>Rebirth</passive><br>Upon taking lethal damage, restores Health.' }),
  3156: item('Maw of Malmortius', { base: 1775, total: 3100, from: [1037, 1033], stats: [[60, 'Attack Damage'], [40, 'Magic Resist'], [15, 'Ability Haste']] }),
  3143: item("Randuin's Omen", { base: 2400, total: 2700, from: [1029], stats: [[350, 'Health'], [75, 'Armor']], extra: '<passive>Resilience</passive><br>Reduce incoming damage from critical strikes by 30%.' }),
  3075: item('Thornmail', { base: 2150, total: 2450, from: [1029], stats: [[150, 'Health'], [75, 'Armor']], extra: GW }),
  3065: item('Spirit Visage', { base: 2250, total: 2700, from: [1033], stats: [[400, 'Health'], [50, 'Magic Resist'], [10, 'Ability Haste']] }),
  3004: item('Manamune', { base: 1725, total: 2900, from: [1037, 1027], into: [3042], stats: [[35, 'Attack Damage'], [500, 'Mana']] }),
  3042: item('Muramana', { base: 0, total: 2900, from: [3004], purchasable: false, stats: [[35, 'Attack Damage'], [860, 'Mana']] }),
  223031: item('Infinity Edge (Arena)', { base: 3450, total: 3450, maps: { 11: false, 30: true }, stats: [[65, 'Attack Damage']] }),
  // Arena : copies des objets de la Faille (achetées d'un coup, sans composants)
  223157: item("Zhonya's Hourglass (Arena)", { base: 3250, total: 3250, maps: { 11: false, 12: false, 30: true }, stats: [[105, 'Ability Power'], [50, 'Armor']], extra: '<active>Time Stop</active><br>Put yourself in <keyword>Stasis</keyword>.' }),
  223089: item("Rabadon's Deathcap (Arena)", { base: 3500, total: 3500, maps: { 11: false, 12: false, 30: true }, stats: [[130, 'Ability Power']] }),
  226655: item("Luden's Companion (Arena)", { base: 2900, total: 2900, maps: { 11: false, 12: false, 30: true }, stats: [[100, 'Ability Power'], [600, 'Mana']] }),
  224645: item('Shadowflame (Arena)', { base: 3200, total: 3200, maps: { 11: false, 12: false, 30: true }, stats: [[110, 'Ability Power'], [15, 'Magic Penetration']] }),
  // objet de départ des supports (quête : s'améliore tout seul)
  3865: item('World Atlas', { base: 400, total: 400, tags: ['GoldPer', 'Lane'], into: [] }),
  // objet de la Faille désactivé en ARAM
  2065: item("Shurelya's Battlesong", { base: 2200, total: 2200, maps: { 11: true, 12: false }, stats: [[55, 'Ability Power'], [200, 'Health'], ['5%', 'Heal and Shield Power']] }),
};

const champ = (id, key, name, tags, attack, magic, defense = 5) => ({
  id, key: String(key), name, title: '', tags, info: { attack, defense, magic, difficulty: 5 }, image: { full: `${id}.png` },
});

const champions = {
  Ahri: champ('Ahri', 103, 'Ahri', ['Mage', 'Assassin'], 3, 8, 4),
  Zed: champ('Zed', 238, 'Zed', ['Assassin'], 9, 1, 2),
  Syndra: champ('Syndra', 134, 'Syndra', ['Mage'], 2, 9, 3),
  Orianna: champ('Orianna', 61, 'Orianna', ['Mage'], 4, 9, 3),
  Yasuo: champ('Yasuo', 157, 'Yasuo', ['Fighter', 'Assassin'], 8, 4, 4),
  Aatrox: champ('Aatrox', 266, 'Aatrox', ['Fighter', 'Tank'], 8, 3, 4),
  Darius: champ('Darius', 122, 'Darius', ['Fighter', 'Tank'], 9, 1, 5),
  Ornn: champ('Ornn', 516, 'Ornn', ['Tank', 'Fighter'], 5, 3, 9),
  Sejuani: champ('Sejuani', 113, 'Sejuani', ['Tank', 'Fighter'], 5, 6, 7),
  LeeSin: champ('LeeSin', 64, 'Lee Sin', ['Fighter', 'Assassin'], 8, 3, 5),
  Viego: champ('Viego', 234, 'Viego', ['Assassin', 'Fighter'], 6, 2, 4),
  Jinx: champ('Jinx', 222, 'Jinx', ['Marksman'], 9, 2, 2),
  Kaisa: champ('Kaisa', 145, "Kai'Sa", ['Marksman'], 8, 3, 5),
  Ezreal: champ('Ezreal', 81, 'Ezreal', ['Marksman', 'Mage'], 7, 6, 2),
  Soraka: champ('Soraka', 16, 'Soraka', ['Support', 'Mage'], 2, 7, 5),
  Leona: champ('Leona', 89, 'Leona', ['Tank', 'Support'], 4, 3, 8),
  Lulu: champ('Lulu', 117, 'Lulu', ['Support', 'Mage'], 4, 7, 5),
  Thresh: champ('Thresh', 412, 'Thresh', ['Support', 'Tank'], 5, 6, 6),
  Malzahar: champ('Malzahar', 90, 'Malzahar', ['Mage'], 2, 9, 2),
};

const rune = (id, key, name, path) => ({ id, key, name, icon: `perk-images/Styles/${path}/${key}/${key}.png`, shortDesc: '', longDesc: '' });
const runes = [
  {
    id: 8100, key: 'Domination', name: 'Domination', icon: 'perk-images/Styles/7200_Domination.png',
    slots: [
      { runes: [rune(8112, 'Electrocute', 'Electrocute', 'Domination'), rune(8128, 'DarkHarvest', 'Dark Harvest', 'Domination'), rune(9923, 'HailOfBlades', 'Hail of Blades', 'Domination')] },
      { runes: [rune(8126, 'CheapShot', 'Cheap Shot', 'Domination'), rune(8139, 'TasteOfBlood', 'Taste of Blood', 'Domination'), rune(8143, 'SuddenImpact', 'Sudden Impact', 'Domination')] },
      { runes: [rune(8137, 'SixthSense', 'Sixth Sense', 'Domination'), rune(8140, 'GrislyMementos', 'Grisly Mementos', 'Domination'), rune(8141, 'DeepWard', 'Deep Ward', 'Domination')] },
      { runes: [rune(8135, 'TreasureHunter', 'Treasure Hunter', 'Domination'), rune(8105, 'RelentlessHunter', 'Relentless Hunter', 'Domination'), rune(8106, 'UltimateHunter', 'Ultimate Hunter', 'Domination')] },
    ],
  },
  {
    id: 8200, key: 'Sorcery', name: 'Sorcery', icon: 'perk-images/Styles/7202_Sorcery.png',
    slots: [
      { runes: [rune(8214, 'SummonAery', 'Summon Aery', 'Sorcery'), rune(8229, 'ArcaneComet', 'Arcane Comet', 'Sorcery'), rune(8230, 'PhaseRush', 'Phase Rush', 'Sorcery')] },
      { runes: [rune(8224, 'NullifyingOrb', 'Nullifying Orb', 'Sorcery'), rune(8226, 'ManaflowBand', 'Manaflow Band', 'Sorcery'), rune(8275, 'NimbusCloak', 'Nimbus Cloak', 'Sorcery')] },
      { runes: [rune(8210, 'Transcendence', 'Transcendence', 'Sorcery'), rune(8234, 'Celerity', 'Celerity', 'Sorcery'), rune(8233, 'AbsoluteFocus', 'Absolute Focus', 'Sorcery')] },
      { runes: [rune(8237, 'Scorch', 'Scorch', 'Sorcery'), rune(8232, 'Waterwalking', 'Waterwalking', 'Sorcery'), rune(8236, 'GatheringStorm', 'Gathering Storm', 'Sorcery')] },
    ],
  },
  {
    id: 8000, key: 'Precision', name: 'Precision', icon: 'perk-images/Styles/7201_Precision.png',
    slots: [
      { runes: [rune(8005, 'PressTheAttack', 'Press the Attack', 'Precision'), rune(8008, 'LethalTempo', 'Lethal Tempo', 'Precision'), rune(8021, 'FleetFootwork', 'Fleet Footwork', 'Precision'), rune(8010, 'Conqueror', 'Conqueror', 'Precision')] },
      { runes: [rune(9101, 'AbsorbLife', 'Absorb Life', 'Precision'), rune(9111, 'Triumph', 'Triumph', 'Precision'), rune(8009, 'PresenceOfMind', 'Presence of Mind', 'Precision')] },
      { runes: [rune(9104, 'LegendAlacrity', 'Legend: Alacrity', 'Precision'), rune(9105, 'LegendHaste', 'Legend: Haste', 'Precision'), rune(9103, 'LegendBloodline', 'Legend: Bloodline', 'Precision')] },
      { runes: [rune(8014, 'CoupDeGrace', 'Coup de Grace', 'Precision'), rune(8017, 'CutDown', 'Cut Down', 'Precision'), rune(8299, 'LastStand', 'Last Stand', 'Precision')] },
    ],
  },
];

const spell = (id, key, name) => ({ id, key: String(key), name, image: { full: `${id}.png` } });
const summoners = {
  SummonerFlash: spell('SummonerFlash', 4, 'Flash'),
  SummonerDot: spell('SummonerDot', 14, 'Ignite'),
  SummonerTeleport: spell('SummonerTeleport', 12, 'Teleport'),
  SummonerBarrier: spell('SummonerBarrier', 21, 'Barrier'),
  SummonerHeal: spell('SummonerHeal', 7, 'Heal'),
  SummonerSmite: spell('SummonerSmite', 11, 'Smite'),
  SummonerSnowball: spell('SummonerSnowball', 32, 'Mark'),
  SummonerMana: spell('SummonerMana', 13, 'Clarity'),
  SummonerExhaust: spell('SummonerExhaust', 3, 'Exhaust'),
};

const raw = { version: '16.21.1', language: 'en_US', items, itemsEn: items, champions, runes, summoners };

module.exports = { raw };
