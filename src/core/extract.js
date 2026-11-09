'use strict';

const { patchKey } = require('./util');
const { FAMILIES, familyOfQueue } = require('./modes');

const START_WINDOW_MS = 90 * 1000; // achats de départ
const POSITIONS = new Set(['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']);

/**
 * Transforme un match (match-v5) + sa timeline en "fiches build" compactes, une par joueur.
 * Gère la Faille, l'ARAM, ARAM Mayhem et Arena (voir modes.js).
 *
 * Fiche :
 *  m  id du match          v  patch ("16.21")     c  championKey     q  famille (sr/aram/mayhem/arena)
 *  r  rôle (TOP/JUNGLE/MIDDLE/BOTTOM/UTILITY, vide hors Faille)
 *  w  1 = victoire (Arena : top 4)                 d  durée (min)          s  [sort1, sort2]
 *  ru [stylePrinc, 4 runes, styleSec, 2 runes, 3 fragments] (vide sans runes)
 *  st achats de départ     co [[itemId, minute]...] objets complétés et bottes, dans l'ordre d'achat
 *  fi objets finaux        sk ordre des compétences ("1213...")
 *  e  championKeys adverses   o  adversaire direct (même rôle)   a  alliés
 *  nt 1 = pas de timeline (ordre d'achat déduit des objets finaux)
 */
function extractRecords(match, timeline, dd, { follow = null } = {}) {
  const info = match && match.info;
  if (!info || !Array.isArray(info.participants)) return [];
  const family = familyOfQueue(info.queueId);
  if (!family) return [];
  const F = FAMILIES[family];
  if (!(info.gameDuration >= F.minDuration)) return [];
  const patch = patchKey(info.gameVersion);
  if (!patch) return [];
  const map = F.map;
  const isCore = (id) => !!dd && (dd.isLegendary(id, map) || (dd.item(id) && dd.item(id).isBoots));

  const purchases = new Map();
  const skills = new Map();
  for (const p of info.participants) {
    purchases.set(p.participantId, []);
    skills.set(p.participantId, []);
  }

  const frames = (timeline && timeline.info && timeline.info.frames) || [];
  const hasTimeline = frames.length > 0;
  for (const frame of frames) {
    for (const ev of frame.events || []) {
      const list = purchases.get(ev.participantId);
      if (!list) continue;
      if (ev.type === 'ITEM_PURCHASED') {
        list.push({ id: ev.itemId, t: ev.timestamp });
      } else if (ev.type === 'ITEM_UNDO' && ev.beforeId) {
        // annulation d'un achat : on retire le dernier achat de cet objet
        for (let i = list.length - 1; i >= 0; i--) {
          if (list[i].id === ev.beforeId) {
            list.splice(i, 1);
            break;
          }
        }
      } else if (ev.type === 'SKILL_LEVEL_UP' && (ev.levelUpType || 'NORMAL') === 'NORMAL') {
        skills.get(ev.participantId).push(ev.skillSlot);
      }
    }
  }

  const position = (p) => {
    const pos = p.teamPosition || p.individualPosition || '';
    return POSITIONS.has(pos) ? pos : '';
  };

  const records = [];
  for (const p of info.participants) {
    const role = F.roles ? position(p) : '';
    let enemies = [];
    let allies = [];
    let opp = null;
    if (F.teams) {
      enemies = info.participants.filter((x) => x.teamId !== p.teamId);
      allies = info.participants.filter((x) => x.teamId === p.teamId && x.participantId !== p.participantId);
      opp = role ? enemies.find((e) => position(e) === role) || null : null;
    } else {
      // Arena : on garde seulement le partenaire (les adversaires changent à chaque manche)
      const sub = p.playerSubteamId;
      allies = sub ? info.participants.filter((x) => x.playerSubteamId === sub && x.participantId !== p.participantId) : [];
    }

    const finals = [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5].filter((x) => x);
    const buys = purchases.get(p.participantId) || [];

    let start = [];
    const core = [];
    const seen = new Set();
    if (hasTimeline) {
      start = buys
        .filter((b) => b.t < START_WINDOW_MS)
        .map((b) => b.id)
        .filter((id) => {
          const it = dd && dd.item(id);
          return !it || !it.isTrinket;
        });
      for (const b of buys) {
        if (seen.has(b.id) || !isCore(b.id)) continue;
        seen.add(b.id);
        core.push([b.id, Math.round(b.t / 60000)]);
      }
    } else {
      for (const id of finals) {
        if (seen.has(id) || !isCore(id)) continue;
        seen.add(id);
        core.push([id, 0]);
      }
    }

    let win = p.win ? 1 : 0;
    if (family === 'arena' && Number.isFinite(p.placement) && p.placement > 0) win = p.placement <= 4 ? 1 : 0;

    const rec = {
      m: match.metadata ? match.metadata.matchId : '',
      v: patch,
      q: family,
      c: p.championId,
      r: role,
      w: win,
      d: Math.round(info.gameDuration / 60),
      s: [p.summoner1Id, p.summoner2Id].filter((x) => Number.isFinite(x) && x > 0),
      ru: F.runes ? runesOf(p) : [],
      st: start,
      co: core,
      fi: finals,
      sk: (skills.get(p.participantId) || []).slice(0, 18).join(''),
      e: enemies.map((e) => e.championId),
      o: opp ? opp.championId : 0,
      a: allies.map((a) => a.championId),
    };
    if (!hasTimeline) rec.nt = 1;
    // joueur suivi (onglet Builds) : identifiant interne, jamais le puuid
    if (follow && p.puuid && follow.has(p.puuid)) rec.fp = follow.get(p.puuid);
    records.push(rec);
  }
  return records;
}

function runesOf(p) {
  const perks = p.perks || {};
  const styles = perks.styles || [];
  const prim = styles.find((s) => s.description === 'primaryStyle') || styles[0];
  const sub = styles.find((s) => s.description === 'subStyle') || styles[1];
  const sp = perks.statPerks || {};
  if (!prim || !sub) return [];
  const out = [
    prim.style,
    ...(prim.selections || []).map((s) => s.perk),
    sub.style,
    ...(sub.selections || []).map((s) => s.perk),
    sp.offense,
    sp.flex,
    sp.defense,
  ];
  return out.length === 11 && out.every((x) => Number.isFinite(x) && x > 0) ? out : [];
}


/**
 * Fiches "meta" légères (onglet Meta) : champion, poste, victoire et palier d'élo, sans le build.
 * Classées solo/duo de la Faille uniquement.
 */
function extractLite(match, tier) {
  const info = match && match.info;
  if (!info || info.queueId !== 420 || !Array.isArray(info.participants) || !(info.gameDuration >= 900)) return [];
  const patch = patchKey(info.gameVersion);
  if (!patch) return [];
  const m = match.metadata ? match.metadata.matchId : '';
  return info.participants
    .filter((p) => POSITIONS.has(p.teamPosition))
    .map((p) => ({ m, v: patch, q: 'sr', t: tier, c: p.championId, r: p.teamPosition, w: p.win ? 1 : 0, lt: 1 }));
}

module.exports = { extractRecords, extractLite };
