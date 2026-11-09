'use strict';

/** Données des onglets Builds et Meta de la fenêtre principale. */

/** Onglet Builds : variantes du champion à ce poste, et celles des joueurs suivis. */
function buildsView({ dd, rec, followed = [], presets = {} }, champKey, role) {
  if (!champKey) return null;
  const champ = dd.champion(champKey);
  const fl = (followed || []).map((f) => ({ id: f.id, name: f.name.split('#')[0] }));
  const res = rec.buildVariants(champKey, role, { followed: fl });
  const used = res.role || role;
  const preset = (presets || {})[`${champKey}|${used}`] || null;
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
      };
    }),
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

module.exports = { buildsView, metaView };
