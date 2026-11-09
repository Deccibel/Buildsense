'use strict';

/**
 * Lecture des objets Data Dragon.
 * Les stats et les effets sont déduits de la description anglaise (en_US),
 * plus stable à analyser ; le nom affiché vient de la langue choisie.
 */

const STAT_PATTERNS = [
  ['ad', /^Attack Damage/i],
  ['ap', /^Ability Power/i],
  ['armorPen', /^Armor Penetration/i],
  ['magicPen', /^Magic Penetration/i],
  ['armor', /^Armor$/i],
  ['mr', /^Magic Resist/i],
  ['hp', /^Health$/i],
  ['as', /^Attack Speed/i],
  ['crit', /^Critical Strike Chance/i],
  ['lethality', /^Lethality/i],
  ['lifesteal', /^Life ?Steal/i],
  ['omnivamp', /^Omnivamp/i],
  ['haste', /^Ability Haste/i],
  ['ms', /^Move(ment)? Speed/i],
  ['hsp', /^Heal and Shield Power/i],
  ['mana', /^Mana$/i],
  ['tenacity', /^Tenacity/i],
  ['hpRegen', /Health Regen/i],
  ['manaRegen', /Mana Regen/i],
];

const STATS_OBJECT_MAP = {
  FlatPhysicalDamageMod: ['ad', 1],
  FlatMagicDamageMod: ['ap', 1],
  FlatArmorMod: ['armor', 1],
  FlatSpellBlockMod: ['mr', 1],
  FlatHPPoolMod: ['hp', 1],
  PercentAttackSpeedMod: ['as', 100],
  FlatCritChanceMod: ['crit', 100],
  PercentLifeStealMod: ['lifesteal', 100],
  FlatMovementSpeedMod: ['ms', 1],
  FlatMPPoolMod: ['mana', 1],
};

function stripTags(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function parseStats(descEn) {
  const out = {};
  const m = /<stats>([\s\S]*?)<\/stats>/i.exec(descEn || '');
  if (!m) return out;
  for (const line of m[1].split(/<br\s*\/?>/i)) {
    const text = line.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const mm = /^([\d.]+)\s*(%?)\s*(.+)$/.exec(text);
    if (!mm) continue;
    const value = parseFloat(mm[1]);
    const name = mm[3].trim();
    for (const [key, re] of STAT_PATTERNS) {
      if (re.test(name)) {
        out[key] = (out[key] || 0) + value;
        if (mm[2] === '%') out[`${key}Pct`] = true;
        break;
      }
    }
  }
  return out;
}

function statsFromObject(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    const map = STATS_OBJECT_MAP[k];
    if (map && v) out[map[0]] = (out[map[0]] || 0) + v * map[1];
  }
  return out;
}

function itemClass(s) {
  const off = (s.ad || 0) > 0 || (s.crit || 0) > 0 || (s.lethality || 0) > 0 || (s.armorPen || 0) > 0;
  const ap = (s.ap || 0) > 0 || (s.magicPen || 0) > 0;
  const def = (s.armor || 0) > 0 || (s.mr || 0) > 0 || (s.hp || 0) > 0;
  if ((s.hsp || 0) > 0) return 'SUPPORT';
  if (ap && off) return 'HYBRID';
  if (ap) return 'AP';
  if (off) return 'AD';
  if ((s.as || 0) > 0) return 'AD';
  if (def) return 'TANK';
  return 'UTILITY';
}

function detectFlags(textEn, stats) {
  const t = textEn;
  return {
    antiHeal: /Grievous Wounds/i.test(t),
    shieldReaver: /Shield Reaver/i.test(t) || /reduc\w*[^.\n]{0,40}\bshields?\b/i.test(t),
    critReduction:
      /critical strikes?[^.\n]{0,60}reduc/i.test(t) || /reduc[^.\n]{0,60}critical strike/i.test(t),
    cleanse: /Quicksilver/i.test(t) || /remove[^.\n]{0,40}(crowd control|disables?|immobiliz)/i.test(t),
    stasis: /\bstasis\b/i.test(t),
    spellShield: /spell ?shield/i.test(t),
    revive: /\bRebirth\b|\brevives?\b/i.test(t),
    pctHpDmg:
      /(maximum|max|current) Health (magic |physical |true )?damage/i.test(t) ||
      /damage equal to [^.\n]{0,40}(maximum|max|current) Health/i.test(t),
    armorShred: /reduc\w*[^.\n]{0,40}\bArmor\b/i.test(t) && !/critical/i.test(t),
    pctArmorPen: (stats.armorPen || 0) > 0,
    lethality: (stats.lethality || 0) > 0,
    pctMagicPen: (stats.magicPen || 0) > 0 && !!stats.magicPenPct,
    flatMagicPen: (stats.magicPen || 0) > 0 && !stats.magicPenPct,
    tenacity: (stats.tenacity || 0) > 0 || /\bTenacity\b/i.test(t),
  };
}

/**
 * @param {number} id
 * @param {object} it  objet dans la langue d'affichage
 * @param {object} en  le même objet en en_US
 */
function classifyItem(id, it, en) {
  en = en || it;
  const descEn = en.description || '';
  const textEn = stripTags(descEn);
  let stats = parseStats(descEn);
  if (!Object.keys(stats).length) stats = statsFromObject(it.stats || en.stats);
  const tags = it.tags || en.tags || [];
  const gold = it.gold || en.gold || {};
  const into = (it.into || []).map(Number);
  const from = (it.from || []).map(Number);
  const onSR = !it.maps || it.maps['11'] !== false;
  // cartes où l'objet existe (11 Faille, 12 Abîme hurlant, 30 Arena...)
  const mapsObj = it.maps || en.maps;
  const maps = mapsObj
    ? Object.keys(mapsObj)
        .filter((k) => mapsObj[k])
        .map(Number)
    : [11, 12];
  const purchasable =
    gold.purchasable !== false && it.inStore !== false && !it.requiredAlly && !it.requiredChampion && !it.hideFromAll;
  const isConsumable = tags.includes('Consumable') || !!it.consumed;
  const isTrinket = tags.includes('Trinket');
  const isBoots = tags.includes('Boots') && id !== 1001 && from.length > 0;
  const group = (/Limited to (?:1|one) ([A-Za-z' -]+?) item/i.exec(textEn) || [])[1] || null;

  return {
    id,
    name: it.name || en.name || `Objet ${id}`,
    nameEn: en.name || it.name,
    plaintext: it.plaintext || '',
    tags,
    gold: { base: gold.base || 0, total: gold.total || 0, sell: gold.sell || 0 },
    from,
    into,
    onSR,
    maps,
    purchasable,
    isConsumable,
    isTrinket,
    isBoots,
    // complété dans DDragon.ingest (dépend des autres objets)
    isLegendary: false,
    stats,
    flags: detectFlags(textEn, stats),
    cls: itemClass(stats),
    group: group ? group.trim().toLowerCase() : null,
  };
}

module.exports = { classifyItem, parseStats, stripTags, itemClass };
