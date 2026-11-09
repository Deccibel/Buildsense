'use strict';

const traits = require('./champTraits');
const { clamp, listFr } = require('./util');

/** Part de dégâts magiques "naturelle" d'un champion (0 = physique, 1 = magique). */
function champApRatio(c) {
  const a = (c.info && c.info.attack) || 5;
  const m = (c.info && c.info.magic) || 5;
  return m / (a + m);
}

function isEnchanter(c) {
  return c.tags[0] === 'Support' && champApRatio(c) >= 0.5 && !c.tags.includes('Tank');
}

function tankness(c) {
  if (c.tags[0] === 'Tank') return 1;
  if (c.tags.includes('Tank')) return 0.6;
  if (c.tags[0] === 'Fighter') return 0.3;
  return 0;
}

/** Classe de build par défaut quand on n'a pas encore de données sur le champion. */
function guessClass(c) {
  if (!c) return 'AD';
  if (isEnchanter(c)) return 'SUPPORT';
  if (c.tags[0] === 'Tank') return 'TANK';
  return champApRatio(c) > 0.5 ? 'AP' : 'AD';
}

/**
 * Profil d'une compo à partir des seuls champions (sert à comparer une partie en cours
 * aux parties de la base, qui n'ont pas les mêmes objets au même moment).
 */
function compFeatures(champs) {
  let apSum = 0;
  let wSum = 0;
  let heal = 0;
  let tank = 0;
  let cc = 0;
  for (const c of champs) {
    if (!c) continue;
    const w = isEnchanter(c) ? 0.55 : 1;
    apSum += w * champApRatio(c);
    wSum += w;
    heal += traits.heal(c.id);
    tank += tankness(c);
    cc += traits.cc(c.id);
  }
  return { ap: wSum ? apSum / wSum : 0.5, heal, tank, cc };
}

function similarity(f1, f2) {
  const d =
    ((f1.ap - f2.ap) / 0.18) ** 2 +
    ((f1.heal - f2.heal) / 1.8) ** 2 +
    ((f1.tank - f2.tank) / 1.6) ** 2 +
    ((f1.cc - f2.cc) / 3) ** 2;
  return Math.exp(-0.5 * d);
}

/** Mélange profil du champion et objets achetés (un Kai'Sa full AP compte comme magique). */
function blendedApRatio(c, items) {
  let ratio = champApRatio(c);
  let itAD = 0;
  let itAP = 0;
  let legendaries = 0;
  for (const it of items) {
    itAD += (it.stats.ad || 0) + (it.stats.crit || 0) * 0.8 + (it.stats.lethality || 0) * 1.5;
    itAP += it.stats.ap || 0;
    if (it.isLegendary) legendaries++;
  }
  if (itAD + itAP > 0) {
    const w = Math.min(0.7, 0.25 + 0.15 * legendaries);
    ratio = ratio * (1 - w) + (itAP / (itAD + itAP)) * w;
  }
  return ratio;
}

/**
 * Analyse de l'équipe adverse en cours de partie.
 * N'utilise que des infos visibles dans le jeu : champions, objets et KDA du tableau des scores.
 */
function analyzeEnemies(enemies, dd) {
  const names = { heal: [], tank: [], cc: [], shield: [], crit: [], supp: [] };
  const keys = { heal: [], tank: [], cc: [], shield: [], crit: [], supp: [] };
  const mark = (kind, c) => {
    names[kind].push(c.name);
    keys[kind].push(c.key);
  };
  const per = [];
  let apW = 0;
  let wSum = 0;
  let heal = 0;
  let tank = 0;
  let cc = 0;
  let shields = 0;
  let critItems = 0;
  let autoAttackers = 0;

  for (const e of enemies) {
    const c = e.champ;
    if (!c) continue;
    const items = (e.items || []).map((id) => dd.item(id)).filter(Boolean);
    const apr = blendedApRatio(c, items);
    const k = (e.scores && e.scores.kills) || 0;
    const d = (e.scores && e.scores.deaths) || 0;
    const a = (e.scores && e.scores.assists) || 0;
    const fedFactor = clamp(1 + 0.12 * (k - d) + 0.03 * a, 0.6, 2.2);
    const w = (isEnchanter(c) ? 0.55 : 1) * fedFactor;
    apW += w * apr;
    wSum += w;

    const sustainItems = items.filter(
      (it) => it.isLegendary && ((it.stats.lifesteal || 0) > 0 || (it.stats.omnivamp || 0) > 0 || (it.stats.hsp || 0) > 0),
    ).length;
    const h = traits.heal(c.id) + 0.3 * sustainItems;
    heal += h;
    if (h >= 0.6) mark('heal', c);

    const tankItems = items.filter((it) => it.isLegendary && it.cls === 'TANK').length;
    const t = tankness(c) + 0.35 * tankItems;
    tank += t;
    if (t >= 0.9) mark('tank', c);

    const ccv = traits.cc(c.id);
    cc += ccv;
    if (ccv >= 2) mark('cc', c);
    if (traits.suppression(c.id)) mark('supp', c);

    const sh = traits.shield(c.id);
    shields += sh;
    if (sh >= 0.7) mark('shield', c);

    const ci = items.filter((it) => it.isLegendary && (it.stats.crit || 0) > 0).length;
    critItems += ci;
    if (ci >= 2) mark('crit', c);

    if (c.tags.includes('Marksman') || traits.autoAttacker(c.id)) autoAttackers++;

    per.push({
      name: c.name,
      key: c.key,
      apRatio: apr,
      kda: `${k}/${d}/${a}`,
      fed: (k >= 5 && k - d >= 3) || k >= 8,
      dmg: apr >= 0.55 ? 'AP' : apr <= 0.45 ? 'AD' : 'MIX',
      assassin: c.tags.includes('Assassin'),
    });
  }

  return {
    apShare: wSum ? apW / wSum : 0.5,
    heal,
    tank,
    cc,
    shields,
    critItems,
    autoAttackers,
    names,
    keys,
    per,
    fed: per.filter((p) => p.fed),
  };
}

/**
 * Transforme l'analyse en besoins concrets :
 *  - boosts : propriétés d'objets à favoriser (anti-soins, RM, stase...)
 *  - bootBoosts : idem pour les bottes
 *  - alerts : lignes affichées dans l'overlay
 */
function buildNeeds(a, myClass) {
  const boosts = [];
  const bootBoosts = [];
  const alerts = [];
  const p = (v) => Math.round(v * 100);
  const ap = a.apShare;
  const ad = 1 - ap;

  if (ap >= 0.62) {
    const w = clamp((ap - 0.55) * 2.5, 0.3, 1);
    boosts.push({ stat: 'mr', w, reason: `Compo très magique (${p(ap)} %)` });
    bootBoosts.push({ stat: 'mr', w, reason: `Compo très magique (${p(ap)} %)` });
    alerts.push({ level: ap >= 0.72 ? 'high' : 'med', text: 'Compo très magique → résistance magique', kind: 'compo' });
  } else if (ad >= 0.62) {
    const w = clamp((ad - 0.55) * 2.5, 0.3, 1);
    boosts.push({ stat: 'armor', w, reason: `Compo très physique (${p(ad)} %)` });
    if (a.autoAttackers >= 2) bootBoosts.push({ stat: 'armor', w, reason: `Beaucoup d'attaques de base (${p(ad)} % physique)` });
    alerts.push({ level: ad >= 0.72 ? 'high' : 'med', text: 'Compo très physique → armure', kind: 'compo' });
  } else {
    alerts.push({ level: 'info', text: `Compo mixte : ${p(ad)} % physique / ${p(ap)} % magique`, kind: 'compo-info' });
  }

  if (a.heal >= 1.6) {
    const w = clamp(a.heal / 3.5, 0.4, 1);
    boosts.push({ flag: 'antiHeal', w, reason: `Anti-soins : ${listFr(a.names.heal)}` });
    alerts.push({ level: a.heal >= 2.6 ? 'high' : 'med', text: 'Gros soins → anti-soins', keys: a.keys.heal });
  }

  if (a.cc >= 7) {
    bootBoosts.push({ stat: 'tenacity', w: clamp((a.cc - 5) / 5, 0.4, 1), reason: `Beaucoup de contrôles (${listFr(a.names.cc)})` });
    alerts.push({ level: 'med', text: 'Beaucoup de contrôles → ténacité', keys: a.keys.cc });
  }

  if (a.names.supp.length && myClass !== 'TANK') {
    boosts.push({ flag: myClass === 'AD' ? 'cleanse' : 'spellShield', w: 0.5, reason: `Suppression : ${listFr(a.names.supp)}` });
    alerts.push({ level: 'med', text: 'Suppression en face', keys: a.keys.supp });
  }

  if (a.tank >= 2.6) {
    const w = clamp((a.tank - 2) / 2.5, 0.35, 0.9);
    const reason = `Ennemis résistants : ${listFr(a.names.tank)}`;
    if (myClass === 'AP') boosts.push({ flag: 'pctMagicPen', w, reason }, { flag: 'pctHpDmg', w: w * 0.8, reason });
    else if (myClass === 'AD') {
      boosts.push({ flag: 'pctArmorPen', w, reason }, { flag: 'armorShred', w: w * 0.8, reason }, { flag: 'pctHpDmg', w: w * 0.7, reason });
    }
    if (myClass === 'AP' || myClass === 'AD') {
      alerts.push({ level: 'med', text: 'Ennemis résistants → pénétration / % PV', keys: a.keys.tank });
    }
  }

  if (a.shields >= 2 && myClass === 'AD') {
    boosts.push({ flag: 'shieldReaver', w: clamp(a.shields / 3.5, 0.35, 0.8), reason: `Boucliers : ${listFr(a.names.shield)}` });
    alerts.push({ level: 'info', text: 'Beaucoup de boucliers → anti-boucliers', keys: a.keys.shield });
  }

  if (a.critItems >= 3 && myClass === 'TANK') {
    boosts.push({ flag: 'critReduction', w: 0.6, reason: `Critiques : ${listFr(a.names.crit)}` });
    alerts.push({ level: 'med', text: 'Gros critiques en face', keys: a.keys.crit });
  }

  for (const f of a.fed) {
    const type = f.dmg === 'AP' ? ' — dégâts magiques' : f.dmg === 'AD' ? ' — dégâts physiques' : '';
    alerts.push({ level: 'high', text: `${f.name} est fed (${f.kda})${type}`, keys: [f.key], kind: 'fed' });
    const reason = `${f.name} est fed (${f.kda})`;
    if (myClass === 'AP') {
      if (f.assassin || f.dmg === 'AD') boosts.push({ flag: 'stasis', w: 0.65, reason });
      else boosts.push({ flag: 'spellShield', w: 0.5, reason });
      boosts.push({ stat: f.dmg === 'AP' ? 'mr' : 'armor', w: 0.35, reason });
    } else if (myClass === 'AD') {
      boosts.push({ flag: 'revive', w: 0.45, reason });
      if (f.dmg === 'AP') boosts.push({ stat: 'mr', w: 0.45, reason });
    } else {
      boosts.push({ stat: f.dmg === 'AP' ? 'mr' : 'armor', w: 0.55, reason });
    }
  }

  const order = { high: 0, med: 1, info: 2 };
  alerts.sort((x, y) => order[x.level] - order[y.level]);
  return { boosts: mergeBoosts(boosts), bootBoosts: mergeBoosts(bootBoosts), alerts };
}

/** Fusionne les boosts portant sur la même propriété (deux ennemis fed ≠ double comptage). */
function mergeBoosts(list) {
  const map = new Map();
  for (const b of list) {
    const k = b.flag ? `f:${b.flag}` : `s:${b.stat}`;
    const cur = map.get(k);
    if (!cur) map.set(k, { ...b, reasons: [b.reason] });
    else {
      cur.w = Math.min(1, Math.max(cur.w, b.w) + 0.25 * Math.min(cur.w, b.w));
      if (!cur.reasons.includes(b.reason)) cur.reasons.push(b.reason);
    }
  }
  return [...map.values()]
    .map((b) => ({ ...b, reason: b.reasons.join(' · ') }))
    .sort((x, y) => y.w - x.w);
}

function itemMatches(item, boost) {
  if (!item) return false;
  if (boost.flag) return !!item.flags[boost.flag];
  return (item.stats[boost.stat] || 0) > 0 || (boost.stat === 'tenacity' && item.flags.tenacity);
}

module.exports = {
  analyzeEnemies,
  buildNeeds,
  compFeatures,
  similarity,
  guessClass,
  champApRatio,
  isEnchanter,
  itemMatches,
};
