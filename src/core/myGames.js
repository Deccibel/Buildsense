'use strict';

/**
 * Tes parties : bilan complet d'après-partie (API Riot match-v5 + timeline), historique,
 * tendances et objectif de session.
 *
 * Les repères « à ton élo » sont ceux de tes adversaires directs (même poste, même partie) :
 * le matchmaking les place à ton niveau, et ça ne coûte aucune requête de plus.
 */

const fs = require('fs');
const path = require('path');
const { familyOfQueue, QUEUE_LABELS } = require('./modes');

const MAX_GAMES = 200;
const WINDOW = 20; // parties prises en compte dans les tendances
const POSITIONS = new Set(['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']);
// Faille « classique » : les seules parties comparables entre elles (farm, vision, postes)
const TREND_QUEUES = new Set([400, 420, 430, 440, 490]);

const round = (x, d = 1) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);
const avg = (a) => {
  const v = a.filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
};

/** Valeurs d'un joueur à la minute `minute` de la timeline (null si la partie est plus courte). */
function frameAt(timeline, pid, minute) {
  const frames = (timeline && timeline.info && timeline.info.frames) || [];
  const f = frames[minute];
  const pf = f && f.participantFrames && f.participantFrames[String(pid)];
  if (!pf) return null;
  return { cs: (pf.minionsKilled || 0) + (pf.jungleMinionsKilled || 0), gold: pf.totalGold || 0, xp: pf.xp || 0 };
}

/**
 * Résumé d'une de tes parties. `puuid` = le tien (celui de la clé API utilisée).
 * Renvoie null si tu n'es pas dans la partie ou si elle est trop courte (remake).
 */
function analyzeMatch(match, timeline, puuid, dd = null) {
  const info = match && match.info;
  if (!info || !Array.isArray(info.participants)) return null;
  const me = info.participants.find((p) => p.puuid === puuid);
  if (!me || !(info.gameDuration >= 300) || me.gameEndedInEarlySurrender) return null;
  const minutes = info.gameDuration / 60;
  const family = familyOfQueue(info.queueId) || (info.mapId === 11 ? 'sr' : null);
  const role = POSITIONS.has(me.teamPosition) ? me.teamPosition : '';
  const opp = role ? info.participants.find((p) => p.teamId !== me.teamId && p.teamPosition === role) || null : null;
  const teamKills = (p) => info.participants.filter((x) => x.teamId === p.teamId).reduce((s, x) => s + (x.kills || 0), 0);
  const teamDmg = (p) => info.participants.filter((x) => x.teamId === p.teamId).reduce((s, x) => s + (x.totalDamageDealtToChampions || 0), 0);

  const deathsOf = (p) => {
    const out = [];
    for (const f of (timeline && timeline.info && timeline.info.frames) || []) {
      for (const ev of f.events || []) if (ev.type === 'CHAMPION_KILL' && ev.victimId === p.participantId) out.push(round(ev.timestamp / 60000, 1));
    }
    return out;
  };
  const stats = (p) => {
    const cs = (p.totalMinionsKilled || 0) + (p.neutralMinionsKilled || 0);
    const f10 = frameAt(timeline, p.participantId, 10);
    const tk = teamKills(p);
    const td = teamDmg(p);
    const deaths = timeline ? deathsOf(p) : null;
    return {
      k: p.kills || 0,
      de: p.deaths || 0,
      a: p.assists || 0,
      cs,
      csMin: round(cs / minutes),
      cs10: f10 ? f10.cs : null,
      d10: deaths ? deaths.filter((m) => m < 10).length : null,
      vis: p.visionScore || 0,
      visMin: round((p.visionScore || 0) / minutes, 2),
      kp: tk ? round(((p.kills || 0) + (p.assists || 0)) / tk, 2) : null,
      dmg: td ? round((p.totalDamageDealtToChampions || 0) / td, 2) : null,
      deaths,
    };
  };

  const mine = stats(me);
  const f15 = frameAt(timeline, me.participantId, 15);
  const o15 = opp ? frameAt(timeline, opp.participantId, 15) : null;
  // premier objet complet (minute), d'après les achats
  let first = null;
  if (dd) {
    outer: for (const f of (timeline && timeline.info && timeline.info.frames) || []) {
      for (const ev of f.events || []) {
        if (ev.type === 'ITEM_PURCHASED' && ev.participantId === me.participantId && dd.isLegendary(ev.itemId, family === 'aram' || family === 'mayhem' ? 12 : 11)) {
          first = { id: ev.itemId, minute: Math.round(ev.timestamp / 60000) };
          break outer;
        }
      }
    }
  }
  const os = opp ? stats(opp) : null;
  return {
    id: match.metadata ? match.metadata.matchId : '',
    at: info.gameEndTimestamp || (info.gameCreation || 0) + info.gameDuration * 1000,
    queue: info.queueId,
    family,
    c: me.championId,
    r: role,
    w: me.win ? 1 : 0,
    d: Math.round(minutes),
    ...mine,
    wards: me.wardsPlaced || 0,
    cw: me.visionWardsBoughtInGame || 0,
    gd15: f15 && o15 ? f15.gold - o15.gold : null,
    xd15: f15 && o15 ? f15.xp - o15.xp : null,
    first,
    o: opp ? opp.championId : 0,
    // adversaire direct : repère « à ton élo »
    opp: os ? { k: os.k, de: os.de, a: os.a, csMin: os.csMin, cs10: os.cs10, d10: os.d10, visMin: os.visMin, kp: os.kp, dmg: os.dmg } : null,
  };
}

// ---------------------------------------------------------------- stockage

class MyGames {
  constructor(file = null) {
    this.file = file;
    this.games = [];
    this.version = 0;
    if (file) {
      try {
        const j = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (Array.isArray(j)) this.games = j.filter((g) => g && g.id);
      } catch {
        /* pas encore d'historique */
      }
    }
  }

  has(id) {
    return this.games.some((g) => g.id === id);
  }

  /** Ajoute des parties (les plus récentes d'abord dans la liste). Renvoie le nombre de nouvelles. */
  add(list) {
    let n = 0;
    for (const g of list) {
      if (!g || !g.id || this.has(g.id)) continue;
      this.games.push(g);
      n++;
    }
    if (!n) return 0;
    this.games.sort((a, b) => b.at - a.at);
    this.games = this.games.slice(0, MAX_GAMES);
    this.save();
    return n;
  }

  update(id, patch) {
    const g = this.games.find((x) => x.id === id);
    if (!g) return;
    Object.assign(g, patch);
    this.save();
  }

  save() {
    this.version++;
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.games));
    } catch {
      /* non bloquant */
    }
  }

  /** Parties comparables (Faille classique, avec un poste), les plus récentes d'abord. */
  comparable({ champKey = 0, role = '' } = {}) {
    return this.games.filter((g) => TREND_QUEUES.has(g.queue) && g.r && (!champKey || g.c === champKey) && (!role || g.r === role));
  }

  mainRole() {
    const counts = {};
    for (const g of this.comparable().slice(0, 40)) counts[g.r] = (counts[g.r] || 0) + 1;
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || '';
  }
}

// ---------------------------------------------------------------- tendances

// better : 'high' = plus c'est haut mieux c'est ; goal : objectif de session associé
const METRICS = [
  { id: 'cs10', label: 'Sbires à 10 min', better: 'high', digits: 0, goal: 'cs10', skip: ['UTILITY'] },
  { id: 'csMin', label: 'Sbires par minute', better: 'high', digits: 1, goal: 'cs10', skip: ['UTILITY'] },
  { id: 'gd15', label: 'Écart d’or à 15 min', better: 'high', digits: 0, signed: true, bench0: true },
  { id: 'd10', label: 'Morts avant 10 min', better: 'low', digits: 1, goal: 'early' },
  { id: 'de', label: 'Morts par partie', better: 'low', digits: 1, goal: 'deaths' },
  { id: 'visMin', label: 'Vision par minute', better: 'high', digits: 2, goal: 'vision' },
  { id: 'kp', label: 'Participation aux kills', better: 'high', digits: 0, pct: true, goal: 'kp' },
];

/**
 * Tendances sur les 20 dernières parties comparables.
 * Pour chaque indicateur : ta moyenne, celle de tes adversaires directs (repère à ton élo),
 * l'évolution (5 dernières contre les précédentes) et la série pour la courbe.
 */
function trends(games, role = '') {
  const list = games.slice(0, WINDOW);
  const out = [];
  for (const m of METRICS) {
    if (m.skip && m.skip.includes(role)) continue;
    const series = list.map((g) => g[m.id]).filter((x) => Number.isFinite(x));
    if (series.length < 3) continue;
    const mine = avg(series);
    const bench = m.bench0 ? 0 : avg(list.map((g) => (g.opp ? g.opp[m.id] : null)));
    const recent = avg(list.slice(0, 5).map((g) => g[m.id]));
    const before = avg(list.slice(5, 15).map((g) => g[m.id]));
    let trend = 0;
    if (recent !== null && before !== null) {
      const scale = Math.max(Math.abs(before), m.id === 'gd15' ? 300 : 0.5);
      const delta = (recent - before) / scale;
      if (Math.abs(delta) >= 0.08) trend = (delta > 0) === (m.better === 'high') ? 1 : -1;
    }
    // écart au repère, en proportion (positif = en retard)
    let gap = null;
    if (bench !== null && !m.bench0 && bench > 0) gap = m.better === 'high' ? (bench - mine) / bench : (mine - bench) / bench;
    if (m.bench0) gap = mine < -250 ? Math.min(0.5, -mine / 2000) : 0;
    out.push({ id: m.id, label: m.label, better: m.better, digits: m.digits, pct: !!m.pct, signed: !!m.signed, goal: m.goal || null, n: series.length, mine, bench, trend, gap, series: series.slice().reverse() });
  }
  return out;
}

/** Point faible récurrent : l'indicateur le plus en retard sur le repère (au moins 5 parties, 8 % d'écart). */
function weakness(tr) {
  const c = tr.filter((t) => t.n >= 5 && t.gap !== null && t.gap >= 0.08).sort((a, b) => b.gap - a.gap);
  return c[0] || null;
}

// ---------------------------------------------------------------- objectif de session

const ROLE_DEFAULTS = {
  TOP: { cs10: 62, vision: 0.6, kp: 0.4 },
  JUNGLE: { cs10: 52, vision: 0.8, kp: 0.55 },
  MIDDLE: { cs10: 64, vision: 0.6, kp: 0.5 },
  BOTTOM: { cs10: 64, vision: 0.55, kp: 0.5 },
  UTILITY: { cs10: 0, vision: 1.6, kp: 0.55 },
};

const GOALS = {
  cs10: { label: 'Sbires à 10 min', short: 'CS à 10 min' },
  early: { label: 'Aucune mort avant 10 min', short: 'Zéro mort avant 10 min' },
  deaths: { label: 'Limiter les morts', short: 'Morts' },
  vision: { label: 'Score de vision', short: 'Vision' },
  kp: { label: 'Participation aux kills', short: 'Participation' },
};
const GOAL_IDS = Object.keys(GOALS);

/**
 * Objectif de la session : { id, auto, target, label, why }.
 * choice = 'auto' (ton point faible récurrent) ou l'un des GOAL_IDS.
 * La cible est un pas réaliste : à mi-chemin entre ta moyenne et le repère.
 */
function pickGoal(choice, tr, role = '') {
  const defaults = ROLE_DEFAULTS[role] || ROLE_DEFAULTS.MIDDLE;
  const get = (id) => tr.find((t) => t.id === id) || null;
  let id = GOAL_IDS.includes(choice) ? choice : null;
  let why = '';
  if (!id) {
    const w = weakness(tr);
    if (w && w.goal) {
      id = w.goal;
      why = `Ton point faible récurrent : ${w.label.toLowerCase()}.`;
    } else {
      id = role === 'UTILITY' ? 'vision' : 'cs10';
      why = tr.length ? 'Aucun point faible net : on consolide les bases.' : 'Pas encore d’historique : on commence par les bases.';
    }
  }
  if (id === 'cs10' && role === 'UTILITY') id = 'vision';
  const step = (t, def, { min, max, digits, minStep }) => {
    if (!t || t.mine === null) return def;
    const bench = t.bench !== null && t.bench > t.mine ? t.bench : t.mine * 1.1;
    const target = t.mine + Math.max(minStep, (bench - t.mine) / 2);
    return Math.min(max, Math.max(min, round(target, digits)));
  };
  let target;
  let label;
  if (id === 'cs10') {
    target = step(get('cs10'), defaults.cs10 || 60, { min: 30, max: 90, digits: 0, minStep: 3 });
    label = `${target} sbires à 10 min`;
  } else if (id === 'early') {
    target = 0;
    label = 'Aucune mort avant 10 min';
  } else if (id === 'deaths') {
    const t = get('de');
    target = t && t.mine !== null ? Math.max(2, Math.min(8, Math.ceil(t.mine) - 1)) : 5;
    label = `${target} morts au maximum`;
  } else if (id === 'vision') {
    target = step(get('visMin'), defaults.vision, { min: 0.3, max: 3, digits: 2, minStep: 0.05 });
    label = `Vision : ${String(target).replace('.', ',')} par minute`;
  } else {
    target = step(get('kp'), defaults.kp, { min: 0.3, max: 0.8, digits: 2, minStep: 0.03 });
    label = `${Math.round(target * 100)} % de participation aux kills`;
  }
  return { id, auto: !GOAL_IDS.includes(choice), target, label, short: GOALS[id].short, why };
}

/**
 * Suivi en direct (overlay) : { id, text, value, state, progress }.
 * live = { time (s), cs, deaths, kills, assists, teamKills, vision, cs10 (figé à 10 min), d10 }
 * state : 'ahead' | 'behind' | 'done' | 'failed' | 'wait'
 */
function liveGoal(goal, live) {
  if (!goal || !live) return null;
  const t = live.time || 0;
  const base = { id: goal.id, title: goal.short };
  if (goal.id === 'cs10') {
    if (t >= 600) {
      // Stonks lancé après 10 min : la valeur exacte viendra du bilan d'après-partie
      if (live.cs10 === null || live.cs10 === undefined) return { ...base, value: `– / ${goal.target}`, state: 'wait', text: 'résultat dans ton bilan', progress: 0 };
      const v = live.cs10;
      const ok = v >= goal.target;
      return { ...base, value: `${v} / ${goal.target}`, state: ok ? 'done' : 'failed', text: ok ? 'objectif atteint' : 'manqué, à retenter', progress: Math.min(1, v / goal.target) };
    }
    // les premiers sbires arrivent vers 1:30 ; le compteur du jeu avance par paliers
    const expected = Math.round(goal.target * Math.max(0, (t - 90) / 510));
    const ahead = live.cs >= expected - 4;
    return { ...base, value: `${live.cs} / ${goal.target}`, state: t < 100 ? 'wait' : ahead ? 'ahead' : 'behind', text: t < 100 ? 'à 10 min' : ahead ? 'dans les temps' : `en retard (${expected} attendus)`, progress: Math.min(1, live.cs / goal.target) };
  }
  if (goal.id === 'early') {
    const known = live.d10 !== null && live.d10 !== undefined;
    if (t >= 600 && !known) return { ...base, value: '–', state: 'wait', text: 'résultat dans ton bilan', progress: 0 };
    const d = known ? live.d10 : live.deaths;
    if (d > 0) return { ...base, value: `${d} mort${d > 1 ? 's' : ''}`, state: 'failed', text: 'manqué, joue la sécurité', progress: 1 };
    if (t >= 600) return { ...base, value: '0 mort', state: 'done', text: 'objectif atteint', progress: 1 };
    const left = Math.max(0, 600 - t);
    return { ...base, value: '0 mort', state: 'ahead', text: `encore ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`, progress: t / 600 };
  }
  if (goal.id === 'deaths') {
    const ok = live.deaths <= goal.target;
    return { ...base, value: `${live.deaths} / ${goal.target} max`, state: !ok ? 'failed' : live.deaths === goal.target ? 'behind' : 'ahead', text: !ok ? 'dépassé' : live.deaths === goal.target ? 'plus aucune marge' : 'dans les clous', progress: Math.min(1, live.deaths / Math.max(1, goal.target)) };
  }
  if (goal.id === 'vision') {
    const need = Math.ceil((goal.target * t) / 60);
    const v = Math.round(live.vision || 0);
    return { ...base, value: `${v} / ${need}`, state: t < 300 ? 'wait' : v >= need ? 'ahead' : 'behind', text: t < 300 ? `${String(goal.target).replace('.', ',')} par minute` : v >= need ? 'dans les temps' : 'pose des balises', progress: need ? Math.min(1, v / need) : 0 };
  }
  const kp = live.teamKills ? (live.kills + live.assists) / live.teamKills : null;
  if (kp === null || live.teamKills < 4) return { ...base, value: `– / ${Math.round(goal.target * 100)} %`, state: 'wait', text: 'dès les premiers combats', progress: 0 };
  return { ...base, value: `${Math.round(kp * 100)} / ${Math.round(goal.target * 100)} %`, state: kp >= goal.target ? 'ahead' : 'behind', text: kp >= goal.target ? 'dans les temps' : 'rejoins ton équipe', progress: Math.min(1, kp / goal.target) };
}

/** Résultat de l'objectif sur une partie terminée (d'après le bilan complet). */
function goalResult(goal, g) {
  if (!goal || !g) return null;
  let value = null;
  let ok = null;
  if (goal.id === 'cs10') {
    value = g.cs10;
    ok = value === null ? null : value >= goal.target;
  } else if (goal.id === 'early') {
    value = g.d10;
    ok = value === null ? null : value === 0;
  } else if (goal.id === 'deaths') {
    value = g.de;
    ok = value <= goal.target;
  } else if (goal.id === 'vision') {
    value = g.visMin;
    ok = value >= goal.target;
  } else {
    value = g.kp;
    ok = value === null ? null : value >= goal.target;
  }
  return ok === null ? null : { id: goal.id, target: goal.target, label: goal.label, value, ok };
}

const queueLabel = (q) => QUEUE_LABELS[Number(q)] || 'Partie';

module.exports = { analyzeMatch, MyGames, trends, weakness, pickGoal, liveGoal, goalResult, queueLabel, METRICS, GOALS, GOAL_IDS, TREND_QUEUES };
