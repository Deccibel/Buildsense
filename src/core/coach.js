'use strict';

/**
 * Analyse de ta partie (onglet En direct) : ce que tu as fait, ce qui est améliorable et comment,
 * avec des tutos (vidéos YouTube et fiches écrites) pour tes points faibles.
 *
 * Source : Live Client Data API (ce qui est visible dans le jeu, tableau des scores compris),
 * échantillonnée pendant la partie. Les repères de timing d'objets viennent de la base de builds.
 * Les objectifs chiffrés sont des repères généraux (élo intermédiaire), pas des règles absolues.
 */

const { ROLE_LABELS } = require('./util');

const yt = (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;

// Repères par poste : farm (CS/min), vision (score/min), participation aux kills, morts / 10 min
const TARGETS = {
  TOP: { cs: 7, vision: 0.6, kp: 0.4, deaths10: 2.2 },
  JUNGLE: { cs: 5.5, vision: 0.8, kp: 0.55, deaths10: 2.2 },
  MIDDLE: { cs: 7.5, vision: 0.6, kp: 0.5, deaths10: 2.2 },
  BOTTOM: { cs: 7.5, vision: 0.55, kp: 0.5, deaths10: 2.2 },
  UTILITY: { cs: 0, vision: 1.6, kp: 0.55, deaths10: 2.5 },
  '': { cs: 0, vision: 0, kp: 0.5, deaths10: 3 },
};

// Fiches de progression : explication, conseils concrets, vidéos (recherches YouTube ciblées)
const LESSONS = {
  cs: {
    title: 'Farm : tu laisses trop de sbires',
    how: [
      'Concentre-toi d’abord sur le dernier coup : n’attaque un sbire que quand ton coup l’achève.',
      'Sous ta tour : 2 coups de tour + 1 de toi pour un sbire de mêlée, 1 coup de toi avant la tour pour un sbire à distance.',
      'Entre deux combats ou après un retour en base, va récupérer une vague sur une autre ligne plutôt que d’attendre.',
      'Entraîne-toi 10 min en mode Entraînement : objectif 80 sbires à 10 min sans objets.',
    ],
    videos: ['comment mieux farmer league of legends', 'last hit tuto lol sous la tour'],
  },
  csJungle: {
    title: 'Jungle : ton farm de camps est trop bas',
    how: [
      'Suis un chemin de camps complet (full clear) au début et enchaîne sans attendre les réapparitions.',
      'Après un gank raté ou réussi, reprends tes camps proches au lieu de rester en ligne.',
      'Note l’heure de réapparition des camps (2 min 15) pour planifier ton chemin.',
    ],
    videos: ['jungle pathing tuto league of legends', 'full clear jungle rapide lol'],
  },
  deaths: {
    title: 'Trop de morts',
    how: [
      'Avant d’avancer, compte les ennemis visibles sur la carte : si le jungler et le mid adverses sont absents, joue prudemment.',
      'Garde un sort de fuite (Saut éclair, compétence de mobilité) quand tu pousses ta ligne.',
      'Ne poursuis pas un ennemi bas en vie sous sa tour ou dans le brouillard.',
      'Regarde la mini-carte toutes les 3 à 5 secondes.',
    ],
    videos: ['comment moins mourir league of legends', 'positionnement team fight lol tuto'],
  },
  vision: {
    title: 'Vision insuffisante',
    how: [
      'Achète une balise de contrôle à presque chaque retour en base (75 or).',
      'Utilise ta balise jaune dès qu’elle est rechargée, aux entrées de ta ligne ou de la rivière.',
      'Passe à l’Objectif de l’oracle (balise rouge) en milieu de partie pour nettoyer la vision adverse.',
      'Avant un dragon ou un Nashor, pose la vision 1 minute avant.',
    ],
    videos: ['guide vision ward league of legends', 'ou placer ses wards lol'],
  },
  kp: {
    title: 'Peu présent dans les combats',
    how: [
      'Quand un objectif (dragon, héraut, Nashor) arrive, pousse ta vague et rejoins ton équipe.',
      'Après avoir détruit la tour de ta ligne, va aider la ligne la plus proche.',
      'Utilise le ping « En route » et la téléportation (top) pour rejoindre les combats.',
    ],
    videos: ['macro game tuto league of legends', 'comment roam league of legends'],
  },
  gold: {
    title: 'Tu gardes ton or trop longtemps',
    how: [
      'Rentre en base quand tu peux finir un composant important (souvent 1 100 à 1 300 or).',
      'Pousse ta vague avant de rentrer pour ne pas perdre de sbires.',
      'Évite de rester en ligne avec plus de 1 500 or : chaque minute sans objet est une minute plus faible.',
    ],
    videos: ['quand rentrer en base league of legends recall timing', 'back timing lol tuto'],
  },
  itemTiming: {
    title: 'Premier objet en retard',
    how: [
      'Ton premier objet complet est la plus grosse hausse de puissance de la partie : vise le timing des meilleurs joueurs.',
      'Farm plus régulièrement et rentre en base au bon moment (voir « or gardé »).',
      'Suis le build conseillé par l’overlay : il est construit à partir des parties des meilleurs joueurs.',
    ],
    videos: [],
  },
  offBuild: {
    title: 'Objet peu utilisé sur ton champion',
    how: [
      'Un objet rarement pris par les meilleurs joueurs sur ce champion est souvent un piège.',
      'Regarde l’onglet Builds de BuildSense : clique sur un build pour voir pourquoi chaque objet est choisi.',
    ],
    videos: [],
  },
  level: {
    title: 'Retard d’expérience sur ton adversaire',
    how: [
      'Reste à portée d’expérience de ta vague même si tu ne peux pas la farmer.',
      'Apprends à geler ou pousser ta vague selon la situation (gestion de vague).',
      'Évite les retours en base qui te font rater deux vagues.',
    ],
    videos: ['gestion de vague tuto league of legends', 'wave management lol explication'],
  },
};

const median = (a) => {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

class GameCoach {
  constructor() {
    this.reset();
  }

  reset() {
    this.samples = 0;
    this.lastT = null;
    this.hoardSec = 0;
    this.itemsAt = new Map(); // objet légendaire -> minute de première apparition
    this.deathTimes = [];
    this.lastDeaths = 0;
    this.champKey = 0;
    this.last = null;
  }

  /** Échantillon de la partie (appelé à chaque lecture de la Live Client API). */
  update(game, dd) {
    if (!game || !game.me || !game.me.champ) return;
    if (this.champKey && this.champKey !== game.me.champ.key) this.reset();
    this.champKey = game.me.champ.key;
    const t = game.gameTime || 0;
    const dt = this.lastT === null ? 0 : Math.max(0, Math.min(10, t - this.lastT));
    this.lastT = t;
    this.samples++;
    const me = game.me;
    if (!me.isDead && me.gold >= 1500 && t > 120) this.hoardSec += dt;
    const deaths = (me.scores && me.scores.deaths) || 0;
    if (deaths > this.lastDeaths) for (let i = this.lastDeaths; i < deaths; i++) this.deathTimes.push(t);
    this.lastDeaths = deaths;
    for (const id of me.items || []) {
      if (this.itemsAt.has(id)) continue;
      // déjà possédé à la première lecture (BuildSense lancé en cours de partie) : heure d'achat inconnue
      if (dd && dd.isLegendary(id, 11)) this.itemsAt.set(id, this.samples === 1 && t > 90 ? null : t / 60);
    }
    this.last = game;
  }

  /**
   * Rapport : { final, minutes, stats, done, improve, items }.
   * ctx : { dd, prof (profil du champion, base de builds), role, champion, family }
   */
  report({ dd, prof = null, role = '', champion = '', family = 'sr', final = false } = {}) {
    const g = this.last;
    if (!g || !g.me) return null;
    const minutes = Math.max(1, (g.gameTime || 0) / 60);
    const sc = g.me.scores || {};
    const k = sc.kills || 0;
    const d = sc.deaths || 0;
    const a = sc.assists || 0;
    const cs = sc.creepScore || 0;
    const vision = sc.wardScore || 0;
    const teamKills = k + g.allies.reduce((s, p) => s + ((p.scores && p.scores.kills) || 0), 0);
    const kp = teamKills ? (k + a) / teamKills : null;
    const sr = family === 'sr';
    const T = TARGETS[sr ? role : ''] || TARGETS[''];
    const csMin = cs / minutes;
    const visMin = vision / minutes;
    const deaths10 = (d / minutes) * 10;
    const early = minutes < 8; // trop tôt pour juger farm / vision
    const grade = (v, target, higherIsBetter = true) => {
      if (!target) return 'neutral';
      const r = higherIsBetter ? v / target : target / Math.max(0.01, v);
      return r >= 1 ? 'good' : r >= 0.8 ? 'ok' : 'bad';
    };

    const stats = [
      { id: 'kda', label: 'K / D / A', value: `${k} / ${d} / ${a}`, sub: `KDA ${((k + a) / Math.max(1, d)).toFixed(1).replace('.', ',')}`, grade: grade(deaths10, T.deaths10, false) },
    ];
    if (sr && T.cs) stats.push({ id: 'cs', label: 'Farm', value: `${cs}`, sub: `${csMin.toFixed(1).replace('.', ',')} /min · repère ${String(T.cs).replace('.', ',')}`, grade: early ? 'neutral' : grade(csMin, T.cs) });
    else stats.push({ id: 'cs', label: 'Farm', value: `${cs}`, sub: `${csMin.toFixed(1).replace('.', ',')} /min`, grade: 'neutral' });
    if (sr) stats.push({ id: 'vision', label: 'Vision', value: vision.toFixed(0), sub: `${visMin.toFixed(2).replace('.', ',')} /min · repère ${String(T.vision).replace('.', ',')}`, grade: early ? 'neutral' : grade(visMin, T.vision) });
    if (kp !== null) stats.push({ id: 'kp', label: 'Participation', value: `${Math.round(kp * 100)} %`, sub: `des kills de ton équipe · repère ${Math.round(T.kp * 100)} %`, grade: teamKills < 5 ? 'neutral' : grade(kp, T.kp) });
    stats.push({ id: 'gold', label: 'Or gardé', value: `${Math.round(this.hoardSec / 60)} min`, sub: 'avec plus de 1 500 or en poche', grade: this.hoardSec > 150 ? 'bad' : this.hoardSec > 75 ? 'ok' : 'good' });

    const done = [];
    const improve = [];
    const lesson = (id, detail, extra = {}) => {
      const L = LESSONS[id];
      const videos = [...(L.videos || []), ...(extra.videos || [])];
      improve.push({
        id,
        title: L.title,
        detail,
        how: L.how,
        resources: [
          ...videos.map((q) => ({ kind: 'video', label: q, url: yt(q) })),
          { kind: 'guide', label: 'Fiche écrite', id },
        ],
        severity: extra.severity || 1,
      });
    };

    // morts
    if (!early || d >= 3) {
      if (deaths10 > T.deaths10 * 1.25 && d >= 3) lesson('deaths', `${d} morts en ${Math.round(minutes)} min (repère : moins de ${Math.round((T.deaths10 * minutes) / 10)}).`, { severity: 3 });
      else if (d <= Math.max(1, Math.round((T.deaths10 * minutes) / 20))) done.push(`Peu de morts (${d}) : tu joues en sécurité.`);
    }
    // farm
    if (sr && T.cs && !early) {
      const r = csMin / T.cs;
      if (r < 0.8) lesson(role === 'JUNGLE' ? 'csJungle' : 'cs', `${csMin.toFixed(1).replace('.', ',')} sbires/min, repère ${String(T.cs).replace('.', ',')} : environ ${Math.round((T.cs - csMin) * minutes * 21)} or perdus.`, { severity: r < 0.6 ? 3 : 2 });
      else if (r >= 1) done.push(`Bon farm : ${csMin.toFixed(1).replace('.', ',')} sbires/min.`);
    }
    // vision
    if (sr && T.vision && minutes >= 12) {
      const r = visMin / T.vision;
      if (r < 0.7) lesson('vision', `Score de vision ${vision.toFixed(0)} (${visMin.toFixed(2).replace('.', ',')}/min, repère ${String(T.vision).replace('.', ',')}).`, { severity: role === 'UTILITY' || role === 'JUNGLE' ? 3 : 1 });
      else if (r >= 1) done.push(`Bonne vision : score de ${vision.toFixed(0)}.`);
    }
    // participation
    if (kp !== null && teamKills >= 8 && T.kp) {
      if (kp < T.kp * 0.75) lesson('kp', `${Math.round(kp * 100)} % de participation aux kills (repère ${Math.round(T.kp * 100)} %).`, { severity: 2 });
      else if (kp >= T.kp) done.push(`Très présent dans les combats : ${Math.round(kp * 100)} % des kills de ton équipe.`);
    }
    // or gardé
    if (this.hoardSec > 120) lesson('gold', `${Math.round(this.hoardSec / 60)} min passées avec plus de 1 500 or sans le dépenser.`, { severity: 2 });

    // objets : timing du 1er objet et objets hors meta
    const items = [...this.itemsAt.entries()].map(([id, minute]) => {
      const it = dd && dd.item(id);
      return { id, name: it ? it.name : `#${id}`, icon: dd ? dd.itemIcon(id) : null, minute: minute === null ? null : Math.round(minute) };
    });
    if (prof && prof.recs && prof.recs.length >= 20 && dd) {
      const firstTimes = [];
      // part des parties où l'objet a été acheté
      const games = new Map();
      for (const r of prof.recs) {
        for (const id of new Set([...(r.fi || []), ...(r.co || []).map((x) => x[0])])) games.set(id, (games.get(id) || 0) + 1);
      }
      for (const r of prof.recs) {
        const first = (r.co || []).find((x) => dd.isLegendary(x[0], 11) && x[1] > 0);
        if (first) firstTimes.push(first[1]);
      }
      const typical = median(firstTimes);
      const timed = items.filter((x) => x.minute !== null);
      const first = items.length === timed.length ? timed.sort((x, y) => x.minute - y.minute)[0] : null;
      if (typical && first) {
        first.typical = typical;
        if (first.minute > typical + 3) {
          lesson('itemTiming', `1er objet (${first.name}) à ${first.minute} min, contre ${typical} min en moyenne chez les meilleurs joueurs de ${champion}.`, {
            severity: 2,
            videos: [`${champion} guide ${ROLE_LABELS[role] || ''} fr`.trim()],
          });
        } else if (first.minute <= typical + 1) done.push(`1er objet dans les temps (${first.name} à ${first.minute} min, repère ${typical} min).`);
      } else if (!items.length && typical && minutes > typical + 4) {
        lesson('itemTiming', `Pas encore d’objet complet à ${Math.round(minutes)} min (repère : ${typical} min).`, { severity: 2, videos: [`${champion} guide fr`] });
      }
      const rare = prof.recs.length >= 40 ? items.filter((x) => (games.get(x.id) || 0) / prof.recs.length < 0.03) : [];
      if (rare.length) {
        lesson('offBuild', `${rare.map((x) => x.name).join(', ')} : presque jamais pris par les meilleurs joueurs de ${champion}.`, { severity: 1, videos: [`${champion} build guide`] });
      }
    }
    // expérience face à l'adversaire direct
    const opp = sr && role ? g.enemies.find((e) => e.position === role) : null;
    if (opp && minutes >= 10) {
      const diff = (g.me.level || 1) - (opp.level || 1);
      if (diff <= -2) lesson('level', `Niveau ${g.me.level} contre ${opp.level} pour ${opp.championName || 'ton adversaire'}.`, { severity: 2 });
      else if (diff >= 2) done.push(`Avance d’expérience : niveau ${g.me.level} contre ${opp.level} pour ton adversaire.`);
    }

    improve.sort((x, y) => y.severity - x.severity);
    if (!done.length && !improve.length) done.push(early ? 'Début de partie : l’analyse se précise après 8 minutes.' : 'Partie équilibrée : rien de marquant à signaler.');
    return {
      final,
      minutes: Math.round(minutes),
      champion,
      champKey: this.champKey,
      role,
      family,
      stats,
      done,
      improve,
      items,
      championVideo: champion ? { kind: 'video', label: `Guides vidéo ${champion}`, url: yt(`${champion} ${ROLE_LABELS[role] || ''} guide fr`.trim()) } : null,
    };
  }
}

module.exports = { GameCoach, LESSONS, TARGETS };
