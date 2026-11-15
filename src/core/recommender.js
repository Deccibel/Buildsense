'use strict';

const { compFeatures, similarity, guessClass, itemMatches } = require('./analyzer');
const { argmax } = require('./util');
const { FAMILIES } = require('./modes');

const mapOfRecord = (r) => (FAMILIES[r.q || 'sr'] || FAMILIES.sr).map;

// ARAM et ARAM Mayhem : jamais de bottes conseillées, 6 objets à la place
const NO_BOOTS = new Set(['aram', 'mayhem']);
const isBootsItem = (dd, id) => {
  const it = dd.item(id);
  return !!it && (it.isBoots || id === 1001);
};

const MIN_ROLE = 15; // parties minimum à un poste pour n'utiliser que celles-là
const ROLE_BOOST = 4; // poids des parties jouées au poste demandé quand on mélange les postes

/**
 * Plan d'achat : avec l'or actuel et l'inventaire, que peut-on acheter pour avancer vers l'objet visé ?
 * Les composants déjà possédés sont déduits (comme dans la boutique).
 */
function planPurchase(dd, targetId, inventory, gold) {
  const inv = new Map();
  for (const id of inventory) inv.set(Number(id), (inv.get(Number(id)) || 0) + 1);
  const take = (id) => {
    const c = inv.get(id) || 0;
    if (c > 0) {
      inv.set(id, c - 1);
      return true;
    }
    return false;
  };
  const build = (id, isRoot) => {
    const it = dd.item(id);
    if (!it) return { id, owned: false, remaining: 0, children: [] };
    if (!isRoot && take(id)) return { id, owned: true, remaining: 0, children: [] };
    const children = it.from.map((c) => build(c, false));
    const remaining = it.gold.base + children.reduce((s, c) => s + c.remaining, 0);
    return { id, owned: false, remaining, children };
  };
  const root = build(Number(targetId), true);
  if (gold >= root.remaining) {
    return { target: root.id, total: root.remaining, complete: true, buy: [{ id: root.id, cost: root.remaining }], spent: root.remaining, afterBuy: 0 };
  }
  let budget = gold;
  const buy = [];
  const visit = (node) => {
    if (node.owned) return;
    if (node !== root && node.remaining > 0 && node.remaining <= budget) {
      buy.push({ id: node.id, cost: node.remaining });
      budget -= node.remaining;
      return;
    }
    [...node.children].sort((a, b) => b.remaining - a.remaining).forEach(visit);
  };
  visit(root);
  const spent = gold - budget;
  return { target: root.id, total: root.remaining, complete: false, buy, spent, afterBuy: root.remaining - spent };
}

function addTo(map, key, w, win) {
  let v = map.get(key);
  if (!v) map.set(key, (v = { w: 0, win: 0, n: 0 }));
  v.w += w;
  v.win += win ? w : 0;
  v.n++;
}

const smoothWr = (v, k = 2) => (v.win + 0.5 * k) / (v.w + k);

const median = (a) => {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

/** "C1240" -> valeur comparable (Challenger > Grand Maître > Maître, puis LP). */
const rankValue = (r) => {
  if (!r) return -1;
  const tier = { C: 3, G: 2, M: 1 }[r[0]] || 0;
  return tier * 100000 + (Number(r.slice(1)) || 0);
};

const STAT_FR = {
  ad: 'dégâts d’attaque',
  ap: 'puissance',
  armor: 'armure',
  mr: 'résistance magique',
  hp: 'PV',
  as: 'vitesse d’attaque',
  crit: 'coups critiques',
  lethality: 'létalité',
  armorPen: 'pénétration d’armure',
  magicPen: 'pénétration magique',
  lifesteal: 'vol de vie',
  omnivamp: 'omnivampirisme',
  haste: 'accélération de compétence',
  ms: 'vitesse de déplacement',
  hsp: 'soins et boucliers renforcés',
  mana: 'mana',
  tenacity: 'ténacité',
};
const FLAG_FR = {
  antiHeal: 'Applique des blessures graves : réduit les soins adverses.',
  shieldReaver: 'Perce les boucliers adverses.',
  critReduction: 'Réduit les dégâts des coups critiques subis.',
  cleanse: 'Permet de se libérer des contrôles.',
  stasis: 'Stase : devient invulnérable un court instant.',
  spellShield: 'Bouclier anti-sort : bloque une compétence.',
  revive: 'Permet de revenir à la vie.',
  pctHpDmg: 'Dégâts en % des PV : efficace contre les cibles résistantes.',
  armorShred: 'Réduit l’armure des cibles.',
};


/** Ajoute une raison sans doublon (les boosts fusionnés contiennent "A · B"). */
function addReason(o, reason) {
  for (const part of String(reason).split(' · ')) if (part && !o.reasons.includes(part)) o.reasons.push(part);
}

class Recommender {
  constructor({ store, dd }) {
    this.store = store;
    this.dd = dd;
    this.profiles = new Map();
    this.featCache = new Map();
    this.seqCache = new WeakMap();
  }

  featuresFor(keys) {
    const k = keys.slice().sort((a, b) => a - b).join(',');
    let f = this.featCache.get(k);
    if (!f) {
      f = compFeatures(keys.map((x) => this.dd.champion(x)));
      if (this.featCache.size > 50000) this.featCache.clear();
      this.featCache.set(k, f);
    }
    return f;
  }

  patchWeight(v) {
    const latest = this.store.latestPatch();
    if (!latest || v === latest) return 1;
    return v === this.store.previousPatch() ? 0.6 : 0.3;
  }

  /**
   * Données d'un champion (dans un rôle, pour une famille de modes) + sa "classe" de build.
   * ARAM Mayhem se replie sur les données ARAM tant qu'il y a trop peu de parties Mayhem.
   */
  profile(champKey, role, family = 'sr') {
    champKey = Number(champKey);
    const ck = `${champKey}|${role || ''}|${family}|${this.store.version}`;
    const cached = this.profiles.get(ck);
    if (cached) return cached;

    const F = FAMILIES[family] || FAMILIES.sr;
    let dataFamily = F.id;
    let all = this.store.byChampion(champKey, dataFamily);
    if (F.fallback && all.length < 15) {
      const alt = this.store.byChampion(champKey, F.fallback);
      if (alt.length > all.length) {
        dataFamily = F.fallback;
        all = alt;
      }
    }
    const map = F.map;
    const roleCounts = new Map();
    if (F.roles) for (const r of all) if (r.r) roleCounts.set(r.r, (roleCounts.get(r.r) || 0) + 1);
    const mainRole = argmax(roleCounts);
    const wanted = F.roles ? role || mainRole : '';
    const roleRecs = wanted ? all.filter((r) => r.r === wanted) : all;
    // Trop peu de parties à ce poste : on reprend toutes les parties du champion,
    // en donnant plus de poids à celles jouées à ce poste.
    const blend = !!wanted && roleRecs.length < MIN_ROLE && all.length > roleRecs.length;
    const recs = blend ? all : roleRecs;
    // Poste inhabituel (ex. Akali support) : objets du champion, mais départ et sorts propres au poste
    const offRole = blend && wanted !== mainRole;

    const itemSet = new Set();
    const itemFreq = new Map();
    const classCount = {};
    let legTotal = 0;
    for (const r of recs) {
      for (const id of [...(r.fi || []), ...(r.co || []).map((x) => x[0])]) itemSet.add(id);
      for (const id of r.fi || []) {
        const it = this.dd.item(id);
        if (!it || !this.dd.isLegendary(id, mapOfRecord(r))) continue;
        itemFreq.set(id, (itemFreq.get(id) || 0) + 1);
        classCount[it.cls] = (classCount[it.cls] || 0) + 1;
        legTotal++;
      }
    }
    const share = (c) => (legTotal ? (classCount[c] || 0) / legTotal : 0);
    const shares = {
      AD: share('AD') + share('HYBRID') / 2,
      AP: share('AP') + share('HYBRID') / 2,
      TANK: share('TANK'),
      SUPPORT: share('SUPPORT'),
    };
    const mainClass = legTotal >= 10 ? argmax(new Map(Object.entries(shares))) : guessClass(this.dd.champion(champKey));

    const prof = {
      champKey,
      family: F.id,
      dataFamily,
      fallback: dataFamily !== F.id,
      map,
      role: wanted || '',
      mainRole,
      blend,
      offRole,
      nRole: roleRecs.length,
      n: recs.length,
      nAll: all.length,
      recs,
      itemSet,
      itemFreq,
      mainClass,
      tankShare: shares.TANK,
      apShare: shares.AP,
      // build de support : l'objet de support occupe une case (objet de support + bottes + 4 objets)
      supportBuild: F.id === 'sr' && wanted === 'UTILITY' && !!this.dd.support,
    };
    if (this.profiles.size > 300) this.profiles.clear();
    this.profiles.set(ck, prof);
    return prof;
  }

  recordWeight(r, liveFeat, oppKey, prof = null, preset = null) {
    let w = this.patchWeight(r.v) * (r.nt ? 0.5 : 1);
    if (preset && preset.size) {
      // build favori : les parties qui lui ressemblent comptent davantage (point de départ, la partie ajuste ensuite)
      const seq = this.legendarySeq(r);
      let o = 0;
      for (const id of seq) if (preset.has(id)) o++;
      w *= 1 + (1.5 * o) / preset.size;
    }
    if (prof && prof.blend && r.r === prof.role) w *= ROLE_BOOST;
    if (liveFeat && r.e && r.e.length) w *= Math.max(0.12, similarity(this.featuresFor(r.e), liveFeat));
    if (oppKey && r.o === oppKey && (!prof || !prof.blend || r.r === prof.role)) w *= 1.6;
    return w;
  }

  legendarySeq(r) {
    let s = this.seqCache.get(r);
    if (!s) {
      const map = mapOfRecord(r);
      s = (r.co || []).map((x) => x[0]).filter((id) => this.dd.isLegendary(id, map));
      this.seqCache.set(r, s);
    }
    return s;
  }

  compatible(it, prof) {
    if (prof.itemSet.has(it.id)) return true;
    switch (prof.mainClass) {
      case 'AD':
        return it.cls === 'AD' || (it.cls === 'TANK' && prof.tankShare >= 0.2);
      case 'AP':
        return it.cls === 'AP' || (it.cls === 'TANK' && prof.tankShare >= 0.2);
      case 'TANK':
        return it.cls === 'TANK';
      case 'SUPPORT':
        return it.cls === 'SUPPORT' || (it.cls === 'TANK' && prof.tankShare >= 0.2) || (it.cls === 'AP' && prof.apShare >= 0.25);
      default:
        return false;
    }
  }

  situationalItem(boost, prof, blocked, map = prof.map) {
    const list = this.dd
      .legendaryItems(map)
      .filter((it) => !blocked(it.id) && itemMatches(it, boost) && this.compatible(it, prof));
    if (!list.length) return null;
    list.sort((a, b) => (prof.itemFreq.get(b.id) || 0) - (prof.itemFreq.get(a.id) || 0) || a.gold.total - b.gold.total);
    return list[0].id;
  }

  bootsChoice(prof, liveFeat, oppKey, bootBoosts, map = prof.map) {
    const dd = this.dd;
    const counts = new Map();
    let total = 0;
    for (const r of prof.recs) {
      const b = (r.co || []).map((x) => x[0]).find((id) => {
        const it = dd.item(id);
        return it && it.isBoots;
      });
      if (!b) continue;
      const w = this.recordWeight(r, liveFeat, oppKey, prof);
      counts.set(b, (counts.get(b) || 0) + w);
      total += w;
    }
    const list = [...counts].map(([id, w]) => ({ id, share: w / (total || 1), score: w / (total || 1), reasons: [], situational: false }));
    for (const b of bootBoosts) {
      let matched = false;
      for (const o of list) {
        if (itemMatches(dd.item(o.id), b)) {
          o.score += b.w * 0.35;
          addReason(o, b.reason);
          matched = true;
        }
      }
      if (!matched && b.w >= 0.5) {
        const s = [...dd.items.values()]
          .filter((it) => it.isBoots && it.purchasable && it.maps.includes(map) && it.from.includes(1001) && itemMatches(it, b))
          .sort((x, y) => x.gold.total - y.gold.total)[0];
        if (s && !list.some((o) => o.id === s.id)) {
          const o = { id: s.id, share: 0, score: b.w * 0.3, reasons: [], situational: true };
          addReason(o, b.reason);
          list.push(o);
        }
      }
    }
    list.sort((x, y) => y.score - x.score);
    return list[0] || null;
  }

  /** Nombre d'objets du "coeur" de build : 3, ou 2 pour les supports (ils finissent rarement un 3e objet). */
  coreSize(prof) {
    return prof.supportBuild ? 2 : 3;
  }

  coreBuild(prof, liveFeat, oppKey, preset = null) {
    const want = this.coreSize(prof);
    const by3 = new Map();
    const by2 = new Map();
    for (const r of prof.recs) {
      const s = this.legendarySeq(r).slice(0, want);
      if (s.length < 2) continue;
      const w = this.recordWeight(r, liveFeat, oppKey, prof, preset);
      addTo(s.length === want ? by3 : by2, s.join(','), w, r.w);
    }
    const pick = (m) => {
      let best = null;
      for (const [k, v] of m) if (!best || v.w > best.v.w) best = { k, v };
      return best;
    };
    const best = by3.size ? pick(by3) : pick(by2);
    if (!best) return null;
    return { ids: best.k.split(',').map(Number), n: best.v.n, wr: smoothWr(best.v) };
  }

  /**
   * Évolution de l'objet de support à privilégier (choix gratuit en fin de quête) :
   * celle que prennent les meilleurs joueurs de ce champion en support, dans des parties similaires.
   * Champion rarement joué support : on s'appuie aussi sur les supports du même style (mage, tank, AD, enchanteur).
   * @returns {{ options: {id:number, share:number, wr:number, n:number}[], n:number, generic:boolean } | null}
   */
  supportChoice(prof, liveFeat = null, oppKey = 0) {
    const sup = this.dd.support;
    if (!sup || !prof.supportBuild) return null;
    const leaves = new Set(sup.upgrades);
    const leafOf = (r) => (r.fi || []).find((id) => leaves.has(id)) || 0;
    const counts = new Map();
    let total = 0;
    let n = 0;
    for (const r of prof.recs) {
      if (r.r !== 'UTILITY') continue;
      const id = leafOf(r);
      if (!id) continue;
      const w = this.recordWeight(r, liveFeat, oppKey, prof);
      addTo(counts, id, w, r.w);
      total += w;
      n++;
    }
    let generic = false;
    if (n < 12) {
      // peu de parties de ce champion en support : supports du même style, ses propres parties comptant davantage
      const near = this.supportSimilarity(prof);
      const all = this.store.byRole('UTILITY');
      const step = Math.max(1, Math.floor(all.length / 6000));
      const own = [...counts.entries()];
      counts.clear();
      let gTotal = 0;
      let gN = 0;
      for (let i = 0; i < all.length; i += step) {
        const r = all[i];
        const sim = near(r.c);
        if (sim < 0.1) continue;
        const id = leafOf(r);
        if (!id) continue;
        const w = this.patchWeight(r.v) * sim * sim;
        addTo(counts, id, w, r.w);
        gTotal += w;
        gN++;
      }
      if (gN >= 8) {
        generic = true;
        // les parties du champion lui-même pèsent d'autant plus qu'elles sont nombreuses (la moitié du total vers 12 parties)
        const boost = total ? (gTotal * (n / 12)) / total : 0;
        for (const [id, v] of own) {
          const c = counts.get(id) || { w: 0, win: 0, n: 0 };
          c.w += v.w * boost;
          c.win += v.win * boost;
          c.n += v.n;
          counts.set(id, c);
        }
        total = gTotal + total * boost;
        n += gN;
      } else {
        counts.clear();
        for (const [id, v] of own) counts.set(id, v);
      }
    }
    if (!counts.size) return null;
    const options = [...counts.entries()]
      .map(([id, v]) => ({ id, share: v.w / (total || 1), wr: smoothWr(v, 3), n: v.n }))
      .sort((a, b) => b.share - a.share)
      .slice(0, 3);
    return { options, n, generic };
  }

  /**
   * Objets construits par chaque champion joué en support (fréquences), et son style (AD, AP, TANK, SUPPORT).
   * Sert à trouver les supports « qui se construisent comme » un champion rarement joué à ce poste :
   * un mage support n'a pas le même objet de support qu'un tank ou un enchanteur.
   */
  supportProfiles() {
    if (this.supProfiles && this.supProfiles.version === this.store.version) return this.supProfiles.map;
    const map = new Map();
    for (const r of this.store.byRole('UTILITY')) {
      let a = map.get(r.c);
      if (!a) map.set(r.c, (a = { items: new Map(), AD: 0, AP: 0, TANK: 0, SUPPORT: 0, n: 0, cls: null }));
      for (const id of r.fi || []) {
        const it = this.dd.item(id);
        if (!it || !it.isLegendary) continue;
        a.items.set(id, (a.items.get(id) || 0) + 1);
        if (it.cls === 'HYBRID') {
          a.AD += 0.5;
          a.AP += 0.5;
        } else if (a[it.cls] !== undefined) a[it.cls]++;
        a.n++;
      }
    }
    for (const [c, a] of map) a.cls = a.n >= 10 ? ['AD', 'AP', 'TANK', 'SUPPORT'].sort((x, y) => a[y] - a[x])[0] : guessClass(this.dd.champion(c));
    this.supProfiles = { version: this.store.version, map };
    return map;
  }

  /**
   * Ressemblance (0 à 1) entre le build habituel d'un champion et celui de chaque champion joué en support.
   * Sans données sur le champion : même style (classe) ou non.
   */
  supportSimilarity(prof) {
    const profiles = this.supportProfiles();
    const mine = prof.itemFreq;
    let norm = 0;
    for (const v of mine.values()) norm += v * v;
    const cache = new Map();
    return (champKey) => {
      if (cache.has(champKey)) return cache.get(champKey);
      const other = profiles.get(champKey);
      let sim = 0;
      if (other) {
        if (mine.size >= 3 && other.items.size >= 3) {
          let dot = 0;
          let on = 0;
          for (const [id, v] of other.items) {
            on += v * v;
            dot += v * (mine.get(id) || 0);
          }
          sim = norm && on ? dot / Math.sqrt(norm * on) : 0;
        } else sim = other.cls === prof.mainClass ? 0.5 : 0;
      }
      cache.set(champKey, sim);
      return sim;
    };
  }

  /** Profil moyen des compos adverses d'un groupe de parties (pour dire "quand" un choix est préféré). */
  compAverage(recs) {
    const acc = { ap: 0, heal: 0, tank: 0, cc: 0, n: 0 };
    for (const r of recs) {
      if (!r.e || r.e.length < 3) continue;
      const f = this.featuresFor(r.e);
      acc.ap += f.ap;
      acc.heal += f.heal;
      acc.tank += f.tank;
      acc.cc += f.cc;
      acc.n++;
    }
    if (!acc.n) return null;
    return { ap: acc.ap / acc.n, heal: acc.heal / acc.n, tank: acc.tank / acc.n, cc: acc.cc / acc.n, n: acc.n };
  }

  /** Dans quelles parties ce choix est préféré, par rapport au choix principal. */
  compContext(alt, base) {
    if (!alt || !base || alt.n < 5) return [];
    const out = [];
    const d = (k) => alt[k] - base[k];
    if (d('ap') > 0.07) out.push('contre plus de dégâts magiques');
    if (d('ap') < -0.07) out.push('contre plus de dégâts physiques');
    if (d('heal') > 0.35) out.push('contre beaucoup de soins');
    if (d('tank') > 0.35) out.push('contre des équipes plus résistantes (tanks)');
    if (d('cc') > 0.4) out.push('contre beaucoup de contrôles');
    return out;
  }

  skillOrder(prof) {
    const orders = new Map();
    const firsts = new Map();
    let n = 0;
    for (const r of prof.recs) {
      if (!r.sk || r.sk.length < 9) continue;
      const counts = { 1: 0, 2: 0, 3: 0 };
      const done = [];
      for (const ch of r.sk) {
        const s = Number(ch);
        if (s >= 1 && s <= 3) {
          counts[s]++;
          if (counts[s] === 5) done.push(s);
        }
      }
      const rest = [1, 2, 3].filter((s) => !done.includes(s)).sort((a, b) => counts[b] - counts[a]);
      const order = [...done, ...rest].map((s) => 'QWE'[s - 1]).join(' > ');
      orders.set(order, (orders.get(order) || 0) + 1);
      const first = r.sk
        .slice(0, 3)
        .split('')
        .map((s) => 'QWER'[Number(s) - 1] || '?')
        .join(' ');
      firsts.set(first, (firsts.get(first) || 0) + 1);
      n++;
    }
    if (!n) return null;
    return { order: argmax(orders), first: argmax(firsts), n };
  }

  /**
   * Options pour le prochain objet complété, pondérées par la ressemblance
   * entre la partie en cours et les parties de la base (compo adverse, adversaire direct, patch).
   */
  /**
   * Build complet (5 objets légendaires) : les objets possédés d'abord, puis, case par case,
   * l'objet que les meilleurs joueurs ont pris ensuite dans des parties similaires,
   * avec les besoins de la partie (anti-soins, armure...) et le build favori éventuel.
   */
  completeBuild({ prof, ownedLeg, available, liveFeat, oppKey, boosts = [], preset = null, map, slots = 5 }) {
    const dd = this.dd;
    const chosen = ownedLeg.slice(0, slots);
    const out = chosen.map((id) => ({ id, owned: true, situational: false, reasons: [] }));
    let pending = boosts.filter((b) => !chosen.some((id) => itemMatches(dd.item(id), b)));
    const free = (id) => {
      const it = dd.item(id);
      if (!it || chosen.includes(id) || !available(id)) return false;
      return !(it.group && chosen.some((c) => (dd.item(c) || {}).group === it.group));
    };
    while (chosen.length < slots) {
      const cand = new Map();
      let total = 0;
      for (const r of prof.recs) {
        const seq = this.legendarySeq(r);
        const next = seq.find(free);
        if (!next) continue;
        const overlap = seq.filter((id) => chosen.includes(id)).length;
        const missing = chosen.filter((id) => !seq.includes(id)).length;
        const w = this.recordWeight(r, liveFeat, oppKey, prof, preset) * (1 + 0.6 * overlap) * Math.pow(0.6, missing);
        let c = cand.get(next);
        if (!c) cand.set(next, (c = { id: next, w: 0, win: 0, n: 0 }));
        c.w += w;
        c.win += r.w ? w : 0;
        c.n++;
        total += w;
      }
      const opts = [...cand.values()].map((c) => ({
        id: c.id,
        score: (c.w / (total || 1)) * (1 + (smoothWr(c, 3) - 0.5)) + (preset && preset.has(c.id) ? 0.15 : 0),
        reasons: [],
        situational: false,
      }));
      for (const b of pending) {
        const hit = opts.filter((o) => itemMatches(dd.item(o.id), b));
        if (hit.length) {
          for (const o of hit) {
            o.score += b.w * 0.3;
            addReason(o, b.reason);
          }
        } else if (b.w >= 0.45) {
          const sid = this.situationalItem(b, prof, (id) => !free(id), map);
          if (sid && !opts.some((o) => o.id === sid)) {
            const o = { id: sid, score: b.w * 0.3, reasons: [], situational: true };
            addReason(o, b.reason);
            opts.push(o);
          }
        }
      }
      opts.sort((a, b) => b.score - a.score);
      let pick = opts[0];
      if (!pick) {
        // peu de données : les objets les plus construits sur ce champion,
        // sinon un objet du mode qui va avec son style (mêmes statistiques que ses objets habituels)
        const id = [...prof.itemFreq.entries()].sort((a, b) => b[1] - a[1]).map(([i]) => i).find(free) || this.fillerItem(prof, chosen, free, map);
        if (!id) break;
        pick = { id, reasons: [], situational: false };
      }
      chosen.push(pick.id);
      out.push({ id: pick.id, owned: false, situational: pick.situational, reasons: pick.reasons });
      pending = pending.filter((b) => !itemMatches(dd.item(pick.id), b));
    }
    return out;
  }

  /** Objet légendaire du mode le plus proche du style du champion (statistiques de ses objets habituels). */
  fillerItem(prof, chosen, free, map) {
    const dd = this.dd;
    const weight = new Map();
    const base = [...prof.itemFreq.keys(), ...chosen];
    for (const id of base) {
      const it = dd.item(id);
      if (!it) continue;
      for (const t of it.tags || []) weight.set(t, (weight.get(t) || 0) + 1);
    }
    if (!weight.size) return null;
    let best = null;
    let bestScore = 0;
    for (const it of dd.legendaryItems(map || prof.map)) {
      if (!free(it.id)) continue;
      const score = (it.tags || []).reduce((sum, t) => sum + (weight.get(t) || 0), 0) / Math.sqrt((it.tags || []).length || 1);
      if (score > bestScore) {
        bestScore = score;
        best = it.id;
      }
    }
    return best;
  }

  nextItems({ champKey, role, family = 'sr', map = null, myItems = [], enemyKeys = [], oppKey = 0, needs = { boosts: [], bootBoosts: [] }, gold = 0, preset = null }) {
    const dd = this.dd;
    const prof = this.profile(champKey, role, family);
    const itemMap = map || prof.map;
    // objets absents de la carte jouée (si Data Dragon connaît cette carte) : jamais proposés
    const noBoots = NO_BOOTS.has(family);
    const available = (id) => (!dd.hasMap(itemMap) || dd.onMap(id, itemMap)) && !(noBoots && isBootsItem(dd, id));
    const owned = new Set(myItems.map(Number));
    const ownedLeg = [...owned].filter((id) => dd.isLegendary(id, itemMap) || dd.isLegendary(id, prof.map));
    const ownedGroups = new Set(ownedLeg.map((id) => dd.item(id).group).filter(Boolean));
    const blocked = (id) => {
      const it = dd.item(id);
      return !it || owned.has(id) || !available(id) || (it.group && ownedGroups.has(it.group));
    };
    const liveFeat = enemyKeys.length ? this.featuresFor(enemyKeys) : null;
    // build de support : au poste de support, ou dès qu'un objet de support est dans l'inventaire
    const sup = dd.support;
    const ownedSupport = sup && !noBoots ? [...owned].find((id) => sup.all.has(id)) || 0 : 0;
    const supportBuild = !noBoots && (prof.supportBuild || !!ownedSupport);
    const slots = noBoots ? 6 : supportBuild ? 4 : 5;

    const cand = new Map();
    let totalW = 0;
    let count = 0;
    for (const r of prof.recs) {
      const seq = this.legendarySeq(r);
      if (!seq.length) continue;
      const next = seq.find((id) => !blocked(id));
      if (!next) continue;
      const overlap = seq.filter((id) => owned.has(id)).length;
      const missing = ownedLeg.filter((id) => !seq.includes(id)).length;
      const w = this.recordWeight(r, liveFeat, oppKey, prof, preset) * (1 + 0.6 * overlap) * Math.pow(0.6, missing);
      let c = cand.get(next);
      if (!c) cand.set(next, (c = { id: next, w: 0, win: 0, n: 0, vsOpp: 0 }));
      c.w += w;
      c.win += r.w ? w : 0;
      c.n++;
      if (oppKey && r.o === oppKey) c.vsOpp++;
      totalW += w;
      count++;
    }

    const meanW = count ? totalW / count : 1;
    let options = [...cand.values()]
      .filter((c) => c.n >= 2 || prof.n < 30)
      .map((c) => {
        const share = totalW ? c.w / totalW : 0;
        const wr = smoothWr(c, 3 * meanW);
        return { id: c.id, share, wr, n: c.n, vsOpp: c.vsOpp, score: share * (1 + (wr - 0.5)) + (preset && preset.has(c.id) ? 0.12 : 0), reasons: [], situational: false };
      });

    for (const b of needs.boosts || []) {
      let matched = false;
      for (const o of options) {
        if (itemMatches(dd.item(o.id), b)) {
          o.score += b.w * 0.3;
          addReason(o, b.reason);
          matched = true;
        }
      }
      if (!matched && b.w >= 0.45) {
        const s = this.situationalItem(b, prof, blocked, dd.hasMap(itemMap) ? itemMap : prof.map);
        if (s && !options.some((o) => o.id === s)) {
          const o = { id: s, share: 0, wr: null, n: 0, vsOpp: 0, score: b.w * 0.3, reasons: [], situational: true };
          addReason(o, b.reason);
          options.push(o);
        }
      }
    }
    options.sort((x, y) => y.score - x.score);
    options = options.slice(0, 3);

    const ownsBoots = [...owned].some((id) => {
      const it = dd.item(id);
      return it && it.isBoots;
    });
    const boots = ownsBoots || noBoots ? null : this.bootsChoice(prof, liveFeat, oppKey, needs.bootBoosts || [], dd.hasMap(itemMap) ? itemMap : prof.map);
    const plan = options[0] ? planPurchase(dd, options[0].id, myItems, gold) : null;
    const core = this.coreBuild(prof, liveFeat, oppKey, preset);
    if (core) core.ids = core.ids.filter(available);
    const ownedBoots = [...owned].find((id) => {
      const it = dd.item(id);
      return it && it.isBoots;
    });
    const full = prof.n
      ? this.completeBuild({ prof, ownedLeg, available, liveFeat, oppKey, boosts: needs.boosts || [], preset, map: dd.hasMap(itemMap) ? itemMap : prof.map, slots })
      : [];
    let support = null;
    if (supportBuild) {
      const sprof = prof.supportBuild ? prof : this.profile(champKey, 'UTILITY', 'sr');
      const choice = this.supportChoice(sprof, liveFeat, oppKey);
      support = {
        stage: ownedSupport ? dd.supportStage(ownedSupport) : 'none',
        owned: ownedSupport,
        options: choice ? choice.options : [],
        generic: !!(choice && choice.generic),
      };
    }

    return {
      family: prof.family,
      dataFamily: prof.dataFamily,
      fallback: prof.fallback,
      options,
      boots,
      plan,
      core: core && core.ids.length ? core : null,
      full: full.length ? { items: full, boots: noBoots ? null : ownedBoots ? { id: ownedBoots, owned: true } : boots ? { id: boots.id, owned: false } : null } : null,
      support,
      skills: this.skillOrder(prof),
      n: prof.n,
      nAll: prof.nAll,
      role: prof.role,
      offRole: prof.offRole,
      nRole: prof.nRole,
      mainClass: prof.mainClass,
      fullInventory: ownedLeg.length >= (supportBuild ? 4 : 5),
    };
  }

  /** Résumé d'un groupe de parties : 5 légendaires, bottes, rune principale, victoires. */
  summarize(recs, core = [], slots = 5) {
    const dd = this.dd;
    const pos = [new Map(), new Map(), new Map(), new Map(), new Map()];
    const boots = new Map();
    const keys = new Map();
    let wins = 0;
    for (const r of recs) {
      const seq = this.legendarySeq(r);
      seq.slice(0, 5).forEach((id, i) => pos[i].set(id, (pos[i].get(id) || 0) + 1));
      const b = (r.co || []).map((x) => x[0]).find((id) => (dd.item(id) || {}).isBoots);
      if (b) boots.set(b, (boots.get(b) || 0) + 1);
      if (r.ru && r.ru[1]) keys.set(r.ru[1], (keys.get(r.ru[1]) || 0) + 1);
      wins += r.w ? 1 : 0;
    }
    const items = core.slice(0, slots);
    for (let i = items.length; i < slots; i++) {
      const best = [...pos[i].entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id).find((id) => !items.includes(id));
      // repli : objet fréquent à une autre position
      const any = best || [...pos.flatMap((m) => [...m.entries()])].sort((a, b) => b[1] - a[1]).map(([id]) => id).find((id) => !items.includes(id));
      if (!any) break;
      items.push(any);
    }
    const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)[0] || 0;
    return { items, boots: top(boots), keystone: top(keys), n: recs.length, wr: smoothWr({ win: wins, w: recs.length }) };
  }

  /**
   * Builds possibles pour un champion et un poste (onglet Builds) : les chemins d'objets les plus joués,
   * et ceux des joueurs suivis (ex. "Comme Hide on bush").
   */
  buildVariants(champKey, role, { followed = [], family = 'sr' } = {}) {
    const prof = this.profile(champKey, family === 'sr' ? role : '', family);
    const groups = this.variantGroups(prof);
    const total = [...groups.values()].reduce((s, g) => s + g.length, 0) || 1;
    const noBoots = NO_BOOTS.has(family);
    const slots = prof.supportBuild ? 4 : 5;
    const out = [...groups.entries()]
      .filter(([, g]) => g.length >= 3)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 5)
      .map(([k, g], i) => {
        const sum = this.summarize(g, k.split(',').map(Number), slots);
        if (noBoots) sum.boots = 0;
        return { id: `core:${k}`, source: 'data', rank: i + 1, share: g.length / total, players: this.topPlayers(g, 2), support: this.topSupport(prof, g), ...sum };
      });
    if (family === 'sr') {
      const all = this.store.byChampion(Number(champKey), 'sr');
      for (const f of followed) {
        const g = this.followedRecs(all, f.id, prof.role);
        if (!g.length) continue;
        out.push({ id: `player:${f.id}`, source: 'player', player: f.name, share: null, players: [], support: this.topSupport(prof, g), ...this.summarize(g, [], slots) });
      }
    }
    return { role: prof.role, mainRole: prof.mainRole, n: prof.n, family: prof.family, dataFamily: prof.dataFamily, supportBuild: prof.supportBuild, variants: out };
  }

  /** Évolution de l'objet de support la plus prise dans un groupe de parties (0 si ce n'est pas un build de support). */
  topSupport(prof, recs) {
    const sup = this.dd.support;
    if (!sup || !prof.supportBuild) return 0;
    const counts = new Map();
    for (const r of recs) {
      const id = (r.fi || []).find((x) => sup.upgrades.includes(x));
      if (id) counts.set(id, (counts.get(id) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)[0] || 0;
  }

  /** Parties regroupées par chemin d'objets (3 premiers objets légendaires, 2 pour les supports). */
  variantGroups(prof) {
    const groups = new Map();
    const size = this.coreSize(prof);
    for (const r of prof.recs) {
      const seq = this.legendarySeq(r);
      if (seq.length < size) continue;
      const k = seq.slice(0, size).join(',');
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }
    return groups;
  }

  followedRecs(all, followId, role) {
    const mine = all.filter((r) => r.fp === followId);
    return mine.filter((r) => !role || r.r === role || mine.every((x) => x.r !== role));
  }

  /** Joueurs les plus représentés dans un groupe de parties (Riot ID + meilleur rang connu). */
  topPlayers(recs, n = 5) {
    const m = new Map();
    for (const r of recs) {
      if (!r.pn) continue;
      const p = m.get(r.pn) || { name: r.pn, games: 0, wins: 0, rank: null };
      p.games++;
      p.wins += r.w ? 1 : 0;
      if (r.pl && (!p.rank || rankValue(r.pl) > rankValue(p.rank))) p.rank = r.pl;
      m.set(r.pn, p);
    }
    return [...m.values()].sort((a, b) => b.games - a.games || rankValue(b.rank) - rankValue(a.rank)).slice(0, n);
  }

  /**
   * Détail d'un build (clic dans l'onglet Builds) : pour chaque case, l'objet, sa popularité, son taux
   * de victoire et son timing, les alternatives et dans quelles parties elles sont préférées ;
   * runes, sorts, départ, ordre des compétences et joueurs qui jouent ce build.
   */
  variantDetail(champKey, role, { family = 'sr', variantId = '', followed = [] } = {}) {
    const prof = this.profile(champKey, family === 'sr' ? role : '', family);
    let g = [];
    let core = [];
    if (variantId.startsWith('core:')) {
      core = variantId.slice(5).split(',').map(Number);
      g = this.variantGroups(prof).get(core.join(',')) || [];
    } else if (variantId.startsWith('player:')) {
      const f = followed.find((x) => `player:${x.id}` === variantId);
      if (f) g = this.followedRecs(this.store.byChampion(Number(champKey), 'sr'), f.id, prof.role);
    }
    if (!g.length) return null;
    const dd = this.dd;
    const slotCount = prof.supportBuild ? 4 : 5;
    const sum = this.summarize(g, core, slotCount);
    const noBoots = NO_BOOTS.has(family);
    const minuteOf = (r, id) => {
      const x = (r.co || []).find((c) => c[0] === id);
      return x && x[1] > 0 ? x[1] : null;
    };
    const feats = (recs) => this.compAverage(recs);
    const contextOf = (alt, base) => this.compContext(alt, base);
    // case par case : objet du build et alternatives (parties du champion avec les mêmes objets avant)
    const slots = [];
    for (let i = 0; i < Math.min(slotCount, sum.items.length); i++) {
      const id = sum.items[i];
      const has = g.filter((r) => this.legendarySeq(r).includes(id));
      const mins = has.map((r) => minuteOf(r, id)).filter((x) => x !== null);
      const allAt = new Map();
      for (const r of prof.recs) {
        const seq = this.legendarySeq(r);
        if (seq.length <= i || !sum.items.slice(0, i).every((x, j) => seq[j] === x)) continue;
        const list = allAt.get(seq[i]) || [];
        list.push(r);
        allAt.set(seq[i], list);
      }
      const totalAt = [...allAt.values()].reduce((s, l) => s + l.length, 0) || 1;
      const mainRecs = allAt.get(id) || [];
      const base = feats(mainRecs.length ? mainRecs : has);
      const alternatives = [...allAt.entries()]
        .filter(([alt, l]) => alt !== id && l.length >= 3)
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 3)
        .map(([alt, l]) => ({
          ...this.itemBrief(alt),
          share: l.length / totalAt,
          wr: smoothWr({ win: l.filter((r) => r.w).length, w: l.length }),
          n: l.length,
          when: contextOf(feats(l), base),
        }));
      const share = mainRecs.length / totalAt;
      slots.push({
        ...this.itemBrief(id),
        share,
        inBuild: has.length / g.length,
        wr: smoothWr({ win: has.filter((r) => r.w).length, w: has.length || 1 }),
        minute: median(mins),
        why: this.itemWhy(id, { share, alternatives }),
        alternatives,
      });
    }
    const counts = (key) => {
      const m = new Map();
      for (const r of g) {
        const k = key(r);
        if (k) m.set(k, (m.get(k) || 0) + 1);
      }
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };
    const page = counts((r) => (r.ru && r.ru.length === 11 ? r.ru.join(',') : ''))[0];
    const spells = counts((r) => (r.s && r.s.length === 2 ? r.s.slice().sort((a, b) => a - b).join(',') : ''))[0];
    const start = counts((r) => (r.st && r.st.length ? r.st.slice().sort((a, b) => a - b).join(',') : ''))[0];
    const boots = noBoots
      ? []
      : counts((r) => (r.co || []).map((x) => x[0]).find((id) => isBootsItem(dd, id)) || 0)
          .slice(0, 3)
          .map(([id, n]) => ({ ...this.itemBrief(Number(id)), share: n / g.length }));
    // objet de support : évolutions prises avec ce build, et dans quelles parties
    let support = null;
    const sup = dd.support;
    if (sup && prof.supportBuild) {
      const by = new Map();
      for (const r of g) {
        const id = (r.fi || []).find((x) => sup.upgrades.includes(x));
        if (!id) continue;
        const l = by.get(id) || [];
        l.push(r);
        by.set(id, l);
      }
      let list = [...by.entries()].sort((x, y) => y[1].length - x[1].length);
      const withLeaf = list.reduce((t, [, l]) => t + l.length, 0);
      let generic = false;
      if (withLeaf < 8) {
        // trop peu de parties pour ce build précis : choix du champion à ce poste
        const choice = this.supportChoice(prof);
        list = choice ? choice.options.map((o) => [o.id, null, o]) : [];
        generic = !!(choice && choice.generic);
      }
      const base = list[0] && list[0][1] ? feats(list[0][1]) : null;
      const options = list.filter(([, l, o], i) => i === 0 || (l ? l.length / (withLeaf || 1) : o.share) >= 0.05).slice(0, 4).map(([id, l, o], i) => ({
        ...this.itemBrief(id),
        share: l ? l.length / (withLeaf || 1) : o.share,
        wr: l ? smoothWr({ win: l.filter((r) => r.w).length, w: l.length }) : o.wr,
        n: l ? l.length : o.n,
        when: l && i > 0 ? contextOf(feats(l), base) : [],
        passive: (dd.item(id) || {}).passive || null,
      }));
      if (options.length) support = { options, generic };
    }
    return {
      n: g.length,
      wr: smoothWr({ win: g.filter((r) => r.w).length, w: g.length }),
      duration: median(g.map((r) => r.d).filter(Boolean)),
      slots,
      support,
      boots,
      runes: page ? { ids: page[0].split(',').map(Number), share: page[1] / g.length } : null,
      spells: spells ? { ids: spells[0].split(',').map(Number), share: spells[1] / g.length } : null,
      start: start ? { ids: start[0].split(',').map(Number), share: start[1] / g.length } : null,
      skills: this.skillOrder({ recs: g }),
      players: this.topPlayers(g, 6),
      family: prof.family,
      role: prof.role,
    };
  }

  itemBrief(id) {
    const it = this.dd.item(id);
    return { id, name: it ? it.name : `#${id}`, icon: this.dd.itemIcon(id) };
  }

  /** Pourquoi cet objet : ce qu'il apporte (statistiques, effets) et sa place chez les meilleurs joueurs. */
  itemWhy(id, { share = 0, alternatives = [] } = {}) {
    const it = this.dd.item(id);
    if (!it) return [];
    const out = [];
    const st = Object.keys(it.stats || {}).filter((k) => STAT_FR[k]).map((k) => STAT_FR[k]);
    if (st.length) out.push(`Apporte : ${st.slice(0, 4).join(', ')}.`);
    const f = it.flags || {};
    for (const [k, txt] of Object.entries(FLAG_FR)) if (f[k]) out.push(txt);
    if (share >= 0.5) out.push(`Choix très majoritaire à ce moment du build (${Math.round(share * 100)} % des parties).`);
    else if (share > 0) out.push(`Choisi dans ${Math.round(share * 100)} % des parties à ce moment du build.`);
    const sit = alternatives.filter((a) => a.when.length);
    if (sit.length) out.push(`À remplacer selon la partie : ${sit.map((a) => `${a.name} ${a.when[0]}`).join(' ; ')}.`);
    return out;
  }

  /** Départs sans bottes (ARAM) : les bottes sont retirées et les départs identiques regroupés. */
  startsWithoutBoots(starts, total) {
    const merged = new Map();
    for (const [key, v] of starts) {
      const ids = key.split(',').map(Number).filter((id) => !isBootsItem(this.dd, id));
      if (!ids.length) continue;
      const k = ids.join(',');
      const m = merged.get(k) || { w: 0, win: 0, n: 0 };
      m.w += v.w;
      m.win += v.win;
      m.n += v.n;
      merged.set(k, m);
    }
    return [...merged.entries()]
      .map(([key, v]) => ({ key, ids: key.split(',').map(Number), share: v.w / (total || 1), wr: smoothWr(v), n: v.n }))
      .sort((a, b) => b.share - a.share)
      .slice(0, 3);
  }

  /** Recommandations pour la sélection des champions (runes, sorts, départ, ordre des compétences). */
  champSelect({ champKey, role, family = 'sr', oppKey = 0, enemyKeys = [], preset = null }) {
    const prof = this.profile(champKey, role, family);
    const liveFeat = enemyKeys.length >= 2 ? this.featuresFor(enemyKeys) : null;
    const pages = new Map();
    const keystones = new Map();
    const spells = new Map();
    const starts = new Map();
    let total = 0;
    // Runes, sorts et départ dépendent surtout du face-à-face :
    // dès qu'on a assez de parties contre cet adversaire, on ne garde qu'elles.
    // (si on mélange les postes, seules les parties jouées à ce poste ont le bon adversaire direct)
    const oppRecs = oppKey ? prof.recs.filter((r) => r.o === oppKey && (!prof.blend || r.r === prof.role)) : [];
    const matchupBased = oppRecs.length >= 8;
    let kitTotal = 0;
    for (const r of matchupBased ? oppRecs : prof.recs) {
      const w = this.recordWeight(r, liveFeat, oppKey, prof);
      total += w;
      if (r.ru && r.ru.length === 11) {
        addTo(pages, r.ru.join(','), w, r.w);
        addTo(keystones, String(r.ru[1]), w, r.w);
      }
      if (prof.offRole) continue;
      kitTotal += w;
      if (r.s && r.s.length === 2) addTo(spells, r.s.slice().sort((a, b) => a - b).join(','), w, r.w);
      if (r.st && r.st.length) addTo(starts, r.st.slice().sort((a, b) => a - b).join(','), w, r.w);
    }
    if (prof.offRole) {
      // poste inhabituel : départ et sorts des joueurs de ce poste (support item, Châtiment...),
      // en privilégiant les quelques parties du champion à ce poste
      const own = prof.recs.filter((r) => r.r === prof.role);
      const generic = this.store.byRole(prof.role);
      const step = Math.max(1, Math.floor(generic.length / 4000)); // échantillon si la base est énorme
      const kit = (r, w) => {
        kitTotal += w;
        if (r.s && r.s.length === 2) addTo(spells, r.s.slice().sort((a, b) => a - b).join(','), w, r.w);
        if (r.st && r.st.length) addTo(starts, r.st.slice().sort((a, b) => a - b).join(','), w, r.w);
      };
      for (let i = 0; i < generic.length; i += step) kit(generic[i], this.patchWeight(generic[i].v) * step);
      const ownW = Math.max(1, generic.length / Math.max(1, MIN_ROLE * 2));
      for (const r of own) kit(r, this.patchWeight(r.v) * ownW);
    }
    const top = (m, n, sum = total) =>
      [...m.entries()]
        .map(([key, v]) => ({ key, share: v.w / (sum || 1), wr: smoothWr(v), n: v.n }))
        .sort((a, b) => b.share - a.share)
        .slice(0, n);

    return {
      family: prof.family,
      dataFamily: prof.dataFamily,
      fallback: prof.fallback,
      n: prof.n,
      role: prof.role,
      offRole: prof.offRole,
      nRole: prof.nRole,
      mainClass: prof.mainClass,
      vsOpp: oppRecs.length,
      matchupBased,
      pages: top(pages, 2).map((p) => ({ ...p, ru: p.key.split(',').map(Number) })),
      keystones: top(keystones, 3).map((k) => ({ ...k, id: Number(k.key) })),
      spells: top(spells, 2, kitTotal).map((s) => ({ ...s, ids: s.key.split(',').map(Number) })),
      starts: NO_BOOTS.has(family) ? this.startsWithoutBoots(starts, kitTotal) : top(starts, 3, kitTotal).map((s) => ({ ...s, ids: s.key.split(',').map(Number) })),
      skills: this.skillOrder(prof),
      core: this.coreBuild(prof, liveFeat, oppKey, preset),
      boots: NO_BOOTS.has(family) ? null : this.bootsChoice(prof, liveFeat, oppKey, []),
      support: this.supportChoice(prof, liveFeat, oppKey),
    };
  }
}

module.exports = { Recommender, planPurchase };
