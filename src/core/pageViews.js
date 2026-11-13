'use strict';

/** Données des onglets Builds et Meta de la fenêtre principale. */

/** Onglet Builds : variantes du champion à ce poste, et celles des joueurs suivis. */
function buildsView({ dd, rec, followed = [], presets = {}, pros = null }, champKey, role, family = 'sr') {
  if (!champKey) return null;
  const champ = dd.champion(champKey);
  const fl = (followed || []).map((f) => ({ id: f.id, name: f.name.split('#')[0] }));
  const res = rec.buildVariants(champKey, role, { followed: fl, family });
  const used = res.role || role;
  const preset = family === 'sr' ? (presets || {})[`${champKey}|${used}`] || null : null;
  const item = (id) => {
    const it = dd.item(id);
    return it ? { id, name: it.name, icon: dd.itemIcon(id) } : null;
  };
  const same = (a, b) => a && b && a.length === b.length && a.every((x, i) => x === b[i]);
  return {
    champKey,
    champion: champ ? champ.name : '',
    icon: champ ? dd.championIcon(champ) : null,
    role: used,
    mainRole: res.mainRole,
    n: res.n,
    family: res.family,
    dataFamily: res.dataFamily,
    preset,
    variants: res.variants.map((v) => {
      const ks = v.keystone ? dd.rune(v.keystone) : null;
      return {
        id: v.id,
        source: v.source,
        player: v.player || null,
        rank: v.rank || null,
        label: v.source === 'player' ? `Comme ${v.player}` : v.rank === 1 ? 'Le plus joué' : `Variante ${v.rank}`,
        items: v.items.map(item).filter(Boolean),
        boots: v.boots ? item(v.boots) : null,
        keystone: ks ? { name: ks.name, icon: dd.runeIcon(ks) } : null,
        n: v.n,
        share: v.share,
        wr: v.n >= 8 ? v.wr : null,
        favorite: !!preset && same(preset.items, v.items),
        players: (v.players || []).map((p) => playerVM(p, pros)),
      };
    }),
  };
}

const TIER_FR = { C: 'Challenger', G: 'Grand Maître', M: 'Maître' };

/** Joueur d'un build : Riot ID, rang, et pro reconnu le cas échéant. */
function playerVM(p, pros) {
  const pro = pros ? pros.identify(p.name) : null;
  const rank = p.rank ? `${TIER_FR[p.rank[0]] || ''} ${Number(p.rank.slice(1)).toLocaleString('fr-FR')} LP`.trim() : null;
  return { name: p.name.split('#')[0], tag: p.name.split('#')[1] || '', games: p.games, wins: p.wins, rank, pro };
}

/** Détail d'un build (clic sur un build de l'onglet Builds). */
function buildDetailView({ dd, rec, followed = [], pros = null }, champKey, role, family, variantId) {
  const fl = (followed || []).map((f) => ({ id: f.id, name: f.name.split('#')[0] }));
  const d = rec.variantDetail(champKey, role, { family, variantId, followed: fl });
  if (!d) return null;
  let runes = null;
  if (d.runes) {
    const ids = d.runes.ids;
    const rune = (id) => {
      const r = dd.rune(id);
      return r ? { id, name: r.name, icon: dd.runeIcon(r) } : null;
    };
    const style = (id) => {
      const st = dd.style(id);
      return st ? { id, name: st.name, icon: dd.runeIcon(st) } : null;
    };
    runes = {
      share: d.runes.share,
      primary: style(ids[0]),
      keystone: rune(ids[1]),
      main: ids.slice(2, 5).map(rune).filter(Boolean),
      secondary: style(ids[5]),
      sub: ids.slice(6, 8).map(rune).filter(Boolean),
      shards: ids.slice(8, 11).map((id) => dd.shardName(id)),
    };
  }
  const spell = (k) => {
    const sp = dd.spell(k);
    return sp ? { id: k, name: sp.name, icon: dd.spellIcon(sp) } : null;
  };
  const item = (id) => {
    const it = dd.item(id);
    return it ? { id, name: it.name, icon: dd.itemIcon(id) } : null;
  };
  return {
    ...d,
    runes,
    spells: d.spells ? { share: d.spells.share, list: d.spells.ids.map(spell).filter(Boolean) } : null,
    start: d.start ? { share: d.start.share, list: d.start.ids.map(item).filter(Boolean) } : null,
    players: d.players.map((p) => playerVM(p, pros)),
  };
}

/** Onglet Meta : champions par poste pour un palier (le tri et le top 5 se font dans la fenêtre). */
function metaView({ dd, store }, tier) {
  const st = store.metaStats(tier);
  const roles = {};
  for (const [role, list] of Object.entries(st.roles)) {
    roles[role] = list
      .map((c) => {
        const ch = dd.champion(c.key);
        return ch ? { key: c.key, name: ch.name, icon: dd.championIcon(ch), n: c.n, pick: c.pick, win: c.win } : null;
      })
      .filter(Boolean);
  }
  return { tier, matches: st.matches, patch: st.patch, roles };
}

module.exports = { buildsView, metaView, buildDetailView, playerVM };
