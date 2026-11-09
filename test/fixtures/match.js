'use strict';

/** Match-v5 + timeline FACTICES, au format de l'API Riot (champs utiles seulement). */

const positions = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
const blue = [516, 234, 103, 145, 412];
const red = [266, 113, 238, 222, 16];

function participant(i) {
  const team = i < 5 ? 100 : 200;
  const idx = i % 5;
  return {
    participantId: i + 1,
    puuid: `puuid-${i + 1}`,
    championId: (team === 100 ? blue : red)[idx],
    teamId: team,
    teamPosition: positions[idx],
    win: team === 100,
    summoner1Id: 4,
    summoner2Id: 14,
    item0: i === 2 ? 6655 : 0,
    item1: i === 2 ? 3020 : 0,
    item2: i === 2 ? 3157 : 0,
    item3: i === 2 ? 3089 : 0,
    item4: 0,
    item5: 0,
    item6: 3340,
    perks: {
      statPerks: { offense: 5008, flex: 5008, defense: 5001 },
      styles: [
        { description: 'primaryStyle', style: 8100, selections: [{ perk: 8112 }, { perk: 8139 }, { perk: 8140 }, { perk: 8106 }] },
        { description: 'subStyle', style: 8200, selections: [{ perk: 8210 }, { perk: 8236 }] },
      ],
    },
  };
}

const match = {
  metadata: { matchId: 'EUW1_7000000001' },
  info: {
    queueId: 420,
    gameDuration: 1880,
    gameVersion: '16.21.712.4398',
    participants: Array.from({ length: 10 }, (_, i) => participant(i)),
  },
};

const ev = (type, participantId, timestamp, extra = {}) => ({ type, participantId, timestamp, ...extra });
const skillSeq = '123114121242233433'.split('').map(Number);

const timeline = {
  info: {
    frames: [
      {
        events: [
          ev('ITEM_PURCHASED', 3, 2000, { itemId: 3340 }),
          ev('ITEM_PURCHASED', 3, 5000, { itemId: 1056 }),
          ev('ITEM_PURCHASED', 3, 6000, { itemId: 2003 }),
          ev('ITEM_PURCHASED', 3, 7000, { itemId: 2003 }),
          ev('ITEM_PURCHASED', 1, 5000, { itemId: 1054 }),
        ],
      },
      {
        events: [
          ...skillSeq.slice(0, 6).map((s, i) => ev('SKILL_LEVEL_UP', 3, 60000 * (i + 1), { skillSlot: s, levelUpType: 'NORMAL' })),
          ev('SKILL_LEVEL_UP', 3, 400000, { skillSlot: 2, levelUpType: 'EVOLVE' }),
          ev('ITEM_PURCHASED', 3, 400000, { itemId: 1052 }),
          ev('ITEM_UNDO', 3, 401000, { beforeId: 1052, afterId: 0, goldGain: 400 }),
          ev('ITEM_PURCHASED', 3, 402000, { itemId: 1026 }),
          ev('ITEM_PURCHASED', 3, 500000, { itemId: 3802 }),
          ev('ITEM_PURCHASED', 3, 660000, { itemId: 6655 }),
          ev('ITEM_PURCHASED', 3, 780000, { itemId: 3020 }),
        ],
      },
      {
        events: [
          ...skillSeq.slice(6).map((s, i) => ev('SKILL_LEVEL_UP', 3, 800000 + 60000 * i, { skillSlot: s, levelUpType: 'NORMAL' })),
          ev('ITEM_PURCHASED', 3, 1140000, { itemId: 3157 }),
          ev('ITEM_PURCHASED', 3, 1560000, { itemId: 3089 }),
        ],
      },
    ],
  },
};

module.exports = { match, timeline };
