'use strict';

const { ROLE_LABELS, fmtClock, fmtGold } = require('./util');
const { FAMILIES } = require('./modes');

const pctInt = (v) => `${Math.round((v || 0) * 100)} %`;
const POSITIONS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];

function hotkeyLabel(accel) {
  const mac = process.platform === 'darwin';
  return String(accel || '')
    .replace(/CommandOrControl|CmdOrCtrl/g, mac ? 'Cmd' : 'Ctrl')
    .replace(/Shift/g, 'Maj')
    .replace(/Super/g, mac ? 'Cmd' : 'Win')
    .replace(/\bnum(\d)\b/g, 'Pavé $1')
    .replace(/\bnumadd\b/g, 'Pavé +')
    .replace(/\bnumsub\b/g, 'Pavé -')
    .replace(/\bnummult\b/g, 'Pavé *')
    .replace(/\bnumdiv\b/g, 'Pavé /')
    .replace(/\bSpace\b/g, 'Espace')
    .replace(/\bUp\b/g, '↑')
    .replace(/\bDown\b/g, '↓')
    .replace(/\bLeft\b/g, '←')
    .replace(/\bRight\b/g, '→');
}

function itemVM(dd, id, extra = {}) {
  const it = dd.item(id);
  if (!it) return null;
  return { id: it.id, name: it.name, icon: dd.itemIcon(it.id), cost: it.gold.total, ...extra };
}

function champVM(dd, champ, extra = {}) {
  return champ ? { name: champ.name, icon: dd.championIcon(champ), ...extra } : null;
}

function phaseLabel(t) {
  if (t < 14 * 60) return 'Début de partie';
  if (t < 25 * 60) return 'Milieu de partie';
  return 'Fin de partie';
}

/** "Q > W > E" -> ["Q", "W", "E"] */
function keysOf(str, sep) {
  return String(str || '')
    .split(sep)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Ligne d'information sur les données utilisées (famille de modes, repli, mode spécial). */
function sampleLine({ n, champName, latestPatch, hasKey, rec = {}, mode = null, kit = false }) {
  const fam = FAMILIES[rec.dataFamily || 'sr'] || FAMILIES.sr;
  const asked = FAMILIES[rec.family || 'sr'] || FAMILIES.sr;
  if (!hasKey && n < 10) {
    return { text: 'Ajoute ta clé API Riot dans BuildSense pour récupérer les builds.', warn: true };
  }
  if (n < 10) {
    return {
      text: `Peu de données ${asked.label} sur ${champName} pour l'instant (${n} parties) : la collecte continue en fond.`,
      warn: true,
    };
  }
  if (rec.offRole) {
    // poste inhabituel (ex. Akali support) : build du champion + départ/sorts du poste
    const pos = ROLE_LABELS[rec.role] || rec.role;
    const parts = [`${champName} en ${pos} : peu de parties (${rec.nRole || 0}), build repris de ses autres postes`];
    if (kit) parts.push(`départ et sorts habituels en ${pos}`);
    return { text: parts.join(' · '), warn: true };
  }
  let text = `${n} ${fam.sampleNoun} analysées${latestPatch ? ` · patch ${latestPatch}` : ''}`;
  if (rec.fallback) text = `Peu de parties ${asked.label} : builds ${fam.label} utilisés (${n} parties)`;
  else if (mode && mode.special) text += ` · mode ${mode.label} : builds de la Faille classée`;
  return { text, warn: !!rec.fallback };
}

const WHO = { sr: 'des Chall/GM', aram: 'des joueurs ARAM', mayhem: 'des joueurs Mayhem', arena: 'des joueurs Arena' };
const CORE_TITLE = { sr: 'Build type Chall/GM', aram: 'Build type ARAM', mayhem: 'Build type Mayhem', arena: 'Build type Arena' };
const FULL_TITLE = { sr: 'Build complet Chall/GM', aram: 'Build complet ARAM', mayhem: 'Build complet Mayhem', arena: 'Build complet Arena' };

/** Pastille de l'en-tête : le rôle sur la Faille, sinon le nom du mode. */
function chipOf(mode, role) {
  if (!mode || (mode.family === 'sr' && !mode.special)) return ROLE_LABELS[role] || '';
  return mode.label;
}

/** Précise d'où vient le poste affiché quand ce n'est pas le client qui l'a donné. */
const ROLE_TAGS = { manual: 'choisi', pref: 'préféré' };
function roleTagOf(mode, role, source) {
  if (!role || (mode && (mode.family !== 'sr' || mode.special))) return null;
  return ROLE_TAGS[source] || null;
}

function ingameVM({ dd, game, analysis, needs, rec, opponent, latestPatch, hasKey, mode = null, roleSource = '' }) {
  const me = game.me;
  const champ = me.champ;
  const oppName = opponent && opponent.champ ? opponent.champ.name : null;
  const who = WHO[rec.dataFamily || 'sr'] || WHO.sr;

  const options = rec.options
    .map((o, idx) => {
      // d'abord ce qui est propre à la partie (boosts), puis ce que disent les données
      const boosts = o.reasons.map((text) => ({ text, boost: true }));
      const wr = o.n >= 8 && o.wr !== null ? pctInt(o.wr) : null;
      const vs = oppName && o.vsOpp >= 3 ? `${o.vsOpp} parties contre ${oppName}` : null;
      let reasons;
      if (o.situational) reasons = boosts;
      else if (idx === 0) {
        reasons = [...boosts, { text: `${pctInt(o.share)} ${who} dans une partie similaire`, boost: false }];
        const extra = [wr ? `${wr} de victoires` : null, vs].filter(Boolean).join(' · ');
        if (extra) reasons.push({ text: extra, boost: false });
      } else {
        reasons = [...boosts.slice(0, 1), { text: `${pctInt(o.share)} ${who}${wr ? ` · ${wr} de victoires` : ''}`, boost: false }];
      }
      return itemVM(dd, o.id, { reasons, situational: o.situational });
    })
    .filter(Boolean);

  let plan = null;
  if (rec.plan && options[0]) {
    const p = rec.plan;
    const target = { name: options[0].name, icon: options[0].icon };
    const progress = p.total > 0 ? Math.min(1, Math.max(0, me.gold / p.total)) : 1;
    const goldText = `${fmtGold(Math.min(me.gold, p.total))} / ${fmtGold(p.total)} PO`;
    if (p.complete) {
      plan = { state: 'ready', title: `Tu peux acheter ${target.name}`, target, progress: 1, goldText, buy: [] };
    } else if (p.buy.length) {
      plan = {
        state: 'partial',
        title: 'Achat possible maintenant',
        target,
        progress,
        goldText,
        buy: p.buy.map((b) => itemVM(dd, b.id, { cost: b.cost })).filter(Boolean),
        after: `Il restera ${fmtGold(p.afterBuy)} PO pour finir ${target.name}`,
      };
    } else {
      plan = { state: 'wait', title: "Pas encore assez d'or pour un composant", target, progress, goldText, buy: [] };
    }
  }

  const boots = rec.boots
    ? itemVM(dd, rec.boots.id, {
        reason: rec.boots.reasons.length ? rec.boots.reasons[0] : rec.boots.share ? `${pctInt(rec.boots.share)} ${who}` : '',
      })
    : null;

  const core = rec.core
    ? rec.core.ids.map((id) => itemVM(dd, id, { owned: me.items.includes(id) })).filter(Boolean)
    : [];
  // build complet : bottes + 5 légendaires, adapté à la partie (objets possédés en tête)
  const full = rec.full
    ? [
        ...(rec.full.boots ? [itemVM(dd, rec.full.boots.id, { owned: rec.full.boots.owned })] : []),
        ...rec.full.items.map((x) => itemVM(dd, x.id, { owned: x.owned, situational: x.situational, reason: x.reasons[0] || null })),
      ].filter(Boolean)
    : [];

  // Bandeau de l'équipe adverse : uniquement ce que montre le tableau des scores
  const perByKey = new Map((analysis ? analysis.per : []).map((p) => [p.key, p]));
  const posIdx = (e) => (POSITIONS.indexOf(e.position) + 10) % 10;
  const showTeam = !mode || mode.teams;
  const enemies = (showTeam ? game.enemies : [])
    .filter((e) => e.champ)
    .slice()
    .sort((a, b) => posIdx(a) - posIdx(b))
    .map((e) => {
      const p = perByKey.get(e.champ.key) || {};
      const s = e.scores || {};
      return champVM(dd, e.champ, {
        level: e.level,
        kda: p.kda || `${s.kills || 0}/${s.deaths || 0}/${s.assists || 0}`,
        fed: !!p.fed,
        dmg: p.dmg || 'MIX',
        isOpponent: !!opponent && e === opponent,
      });
    });

  // la compo (barre de dégâts) et les ennemis fed (bandeau) sont déjà visibles ailleurs
  const alerts = needs.alerts
    .filter((a) => !['compo', 'compo-info', 'fed'].includes(a.kind))
    .slice(0, 4)
    .map((a) => ({
      level: a.level,
      text: a.text,
      champs: (a.keys || [])
        .slice(0, 3)
        .map((k) => champVM(dd, dd.champion(k)))
        .filter(Boolean),
    }));

  const ap = analysis ? analysis.apShare : 0.5;

  return {
    mode: 'ingame',
    header: {
      champion: champ ? champ.name : me.championName,
      icon: dd.championIcon(champ),
      level: me.level,
      role: chipOf(mode, rec.role),
      roleTag: roleTagOf(mode, rec.role, roleSource),
      opponent: oppName,
      opponentIcon: opponent && opponent.champ ? dd.championIcon(opponent.champ) : null,
      clock: fmtClock(game.gameTime),
      phase: phaseLabel(game.gameTime),
      gold: fmtGold(me.gold),
    },
    enemies,
    damage: showTeam && analysis && analysis.per.length ? { ad: Math.round((1 - ap) * 100), ap: Math.round(ap * 100) } : null,
    optionsTitle: rec.fullInventory ? 'Inventaire presque complet' : 'Prochain objet',
    options,
    plan,
    boots,
    core,
    coreTitle: CORE_TITLE[rec.dataFamily || 'sr'] || CORE_TITLE.sr,
    coreWr: rec.core && rec.core.n >= 8 ? pctInt(rec.core.wr) : null,
    full,
    fullTitle: rec.presetLabel ? `Ton build : ${rec.presetLabel}` : FULL_TITLE[rec.dataFamily || 'sr'] || FULL_TITLE.sr,
    alerts: showTeam ? alerts : [],
    skills: rec.skills ? { order: keysOf(rec.skills.order, '>') } : null,
    sample: sampleLine({ n: rec.n, champName: champ ? champ.name : '?', latestPatch, hasKey, rec, mode }),
  };
}

/**
 * Choix de départ (début de partie, boutique) : jusqu'à 3 propositions, la meilleure en tête.
 * "Meilleure" = la plus jouée par les meilleurs joueurs dans cette situation (poste, adversaire, compo).
 */
function startersVM(dd, starts) {
  return (starts || [])
    .filter((s) => s.share >= 0.05 || s === starts[0])
    .slice(0, 3)
    .map((s, i) => {
      const counts = new Map();
      for (const id of s.ids) counts.set(id, (counts.get(id) || 0) + 1);
      return {
        best: i === 0,
        items: [...counts].map(([id, count]) => itemVM(dd, id, { count })).filter(Boolean),
        share: pctInt(s.share),
        wr: s.n >= 8 ? pctInt(s.wr) : null,
      };
    })
    .filter((s) => s.items.length);
}

function runePageVM(dd, page) {
  const ru = page.ru;
  const prim = dd.style(ru[0]);
  const sub = dd.style(ru[5]);
  const rune = (id) => {
    const r = dd.rune(id);
    return r ? { id, name: r.name, icon: dd.runeIcon(r) } : { id, name: `Rune ${id}`, icon: null };
  };
  return {
    share: pctInt(page.share),
    wr: page.n >= 8 ? pctInt(page.wr) : null,
    primary: prim ? { name: prim.name, icon: dd.runeIcon(prim) } : null,
    keystone: rune(ru[1]),
    primaryRunes: [ru[2], ru[3], ru[4]].map(rune),
    secondary: sub ? { name: sub.name, icon: dd.runeIcon(sub) } : null,
    secondaryRunes: [ru[6], ru[7]].map(rune),
    shards: [ru[8], ru[9], ru[10]].map((id) => ({ id, name: dd.shardName(id), icon: dd.shardIcon(id) })),
    importable: {
      primaryStyleId: ru[0],
      subStyleId: ru[5],
      selectedPerkIds: [ru[1], ru[2], ru[3], ru[4], ru[6], ru[7], ru[8], ru[9], ru[10]],
    },
  };
}

function champSelectVM({ dd, cs, rec, opponent, latestPatch, hasKey, importHotkey, mode = null, roleSource = '' }) {
  const champ = cs.myChampion;
  const runesOn = !mode || mode.runes;
  const page = runesOn && rec.pages[0] ? runePageVM(dd, rec.pages[0]) : null;
  const altKeystones = rec.keystones
    .filter((k) => !page || k.id !== page.keystone.id)
    .slice(0, 2)
    .map((k) => {
      const r = dd.rune(k.id);
      return r ? { name: r.name, icon: dd.runeIcon(r), share: pctInt(k.share) } : null;
    })
    .filter(Boolean);

  let spells = null;
  if (rec.spells[0]) {
    const ids = rec.spells[0].ids.slice().sort((a, b) => (a === 4 ? -1 : b === 4 ? 1 : 0));
    spells = {
      share: pctInt(rec.spells[0].share),
      list: ids.map((k) => {
        const s = dd.spell(k);
        return s ? { name: s.name, icon: dd.spellIcon(s) } : { name: `Sort ${k}`, icon: null };
      }),
    };
  }

  let start = null;
  if (rec.starts[0]) {
    const counts = new Map();
    for (const id of rec.starts[0].ids) counts.set(id, (counts.get(id) || 0) + 1);
    start = [...counts].map(([id, count]) => itemVM(dd, id, { count })).filter(Boolean);
  }

  let matchupNote = null;
  if (!runesOn) {
    matchupNote = `${mode.label} : pas de runes dans ce mode (augments en partie).`;
  } else if (opponent) {
    matchupNote = rec.matchupBased
      ? `Runes et sorts tirés de ${rec.vsOpp} parties contre ${opponent.name}`
      : `Peu de parties contre ${opponent.name} (${rec.vsOpp}) : runes tous adversaires confondus`;
  }

  return {
    mode: 'champselect',
    header: {
      champion: champ.name,
      icon: dd.championIcon(champ),
      role: chipOf(mode, rec.role),
      roleTag: roleTagOf(mode, rec.role, roleSource),
      opponent: opponent ? opponent.name : null,
      opponentIcon: opponent ? dd.championIcon(opponent) : null,
    },
    coreTitle: CORE_TITLE[rec.dataFamily || 'sr'] || CORE_TITLE.sr,
    enemies: cs.enemies.map((c) => champVM(dd, c, { isOpponent: !!opponent && c.key === opponent.key })),
    matchupNote,
    page,
    altKeystones,
    spells,
    start,
    skills: rec.skills ? { order: keysOf(rec.skills.order, '>'), first: keysOf(rec.skills.first, ' ') } : null,
    core: rec.core ? rec.core.ids.map((id) => itemVM(dd, id)).filter(Boolean) : [],
    boots: rec.boots ? itemVM(dd, rec.boots.id) : null,
    hint: page ? { key: hotkeyLabel(importHotkey), text: 'importer ces runes dans le client' } : null,
    sample: sampleLine({ n: rec.n, champName: champ.name, latestPatch, hasKey, rec, mode, kit: true }),
  };
}

function messageVM(title, text) {
  return { mode: 'message', title, text };
}

module.exports = { ingameVM, champSelectVM, messageVM, runePageVM, hotkeyLabel, phaseLabel, startersVM };
