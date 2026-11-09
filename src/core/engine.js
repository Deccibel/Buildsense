'use strict';

const { analyzeEnemies, buildNeeds } = require('./analyzer');
const { ingameVM, champSelectVM, messageVM, startersVM } = require('./viewModels');
const { detectMode } = require('./modes');

const ROLE_IDS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
const ROLE_ALIASES = { SUPPORT: 'UTILITY', SUP: 'UTILITY', SUPP: 'UTILITY', MID: 'MIDDLE', BOT: 'BOTTOM', ADC: 'BOTTOM', JUNGLER: 'JUNGLE' };

/** Poste normalisé ('' si inconnu : "NONE", vide, valeur inattendue). */
function normRole(p) {
  const v = String(p || '').trim().toUpperCase();
  const r = ROLE_ALIASES[v] || v;
  return ROLE_IDS.includes(r) ? r : '';
}

/**
 * Poste joué, par ordre de priorité :
 *  1. choisi pour cette partie (raccourci / accueil) ;
 *  2. donné par le client (poste attribué en draft, classée, Swiftplay) ;
 *  3. poste préféré enregistré pour ce champion (ex. Shen -> Support) ;
 *  4. poste le plus joué par ce champion dans la base.
 * `choice` = { override: { champKey, role } | null, prefs: { [champKey]: role } }
 */
function resolveRole({ choice = null, champKey, assigned = '', store }) {
  const c = choice || {};
  const o = c.override;
  const manual = o && (!o.champKey || Number(o.champKey) === Number(champKey)) ? normRole(o.role) : '';
  if (manual) return { role: manual, source: 'manual' };
  const client = normRole(assigned);
  if (client) return { role: client, source: 'client' };
  const pref = normRole((c.prefs || {})[champKey]);
  if (pref) return { role: pref, source: 'pref' };
  return { role: normRole(store.mainRole(champKey)), source: 'data' };
}

/** Adversaire direct en jeu : même poste, sinon l'ennemi dont le rôle habituel correspond. */
function findOpponent(game, role, store) {
  if (role) {
    const same = game.enemies.find((e) => e.position === role);
    if (same) return same;
  }
  let best = null;
  let bestShare = 0.3;
  for (const e of game.enemies) {
    if (!e.champ || !role) continue;
    const s = store.roleShare(e.champ.key)[role] || 0;
    if (s > bestShare) {
      best = e;
      bestShare = s;
    }
  }
  return best;
}

/**
 * Vue "en partie". `mode` vient de detectMode() ; s'il manque, il est déduit de la partie.
 */
// balises (achetées gratuitement) : ne comptent pas comme un départ
const TRINKETS = new Set([3340, 3363, 3364, 3330]);
const STARTER_WINDOW = 150; // secondes : on montre le départ tant que rien n'est acheté

/** Build favori (onglet Builds) pour ce champion et ce poste. */
function presetFor(presets, champKey, role) {
  const p = presets && (presets[`${champKey}|${role || ''}`] || presets[`${champKey}|`]);
  return p && Array.isArray(p.items) && p.items.length ? { set: new Set(p.items.map(Number)), label: p.label || 'ton build' } : null;
}

function computeIngame({ dd, store, rec, game, hasKey, mode = null, roleChoice = null, presets = null }) {
  mode = mode || detectMode({ gameMode: game.gameMode, mapNumber: game.mapNumber, queueId: game.queueId });
  if (!mode.supported) return messageVM(mode.label || 'Mode non pris en charge', mode.message || 'Ce mode n’est pas pris en charge.');
  const champ = game.me.champ;
  if (!champ) return messageVM('Champion inconnu', "Données du jeu pas encore à jour : relance BuildSense après la mise à jour du patch.");
  const picked = mode.roles ? resolveRole({ choice: roleChoice, champKey: champ.key, assigned: game.me.position, store }) : { role: '', source: '' };
  const role = picked.role;
  const opponent = mode.roles ? findOpponent(game, role, store) : null;
  const prof = rec.profile(champ.key, role, mode.family);
  const preset = mode.family === 'sr' ? presetFor(presets, champ.key, role) : null;
  // Arena : les adversaires changent à chaque manche, pas d'analyse de compo
  const enemies = mode.teams ? game.enemies : [];
  const analysis = analyzeEnemies(enemies, dd);
  const needs = mode.teams ? buildNeeds(analysis, prof.mainClass) : { boosts: [], bootBoosts: [], alerts: [] };
  const result = rec.nextItems({
    champKey: champ.key,
    role,
    family: mode.family,
    map: mode.map,
    myItems: game.me.items,
    enemyKeys: enemies.map((e) => e.champ && e.champ.key).filter(Boolean),
    oppKey: opponent && opponent.champ ? opponent.champ.key : 0,
    needs,
    gold: game.me.gold,
    preset: preset && preset.set,
  });
  result.presetLabel = preset ? preset.label : null;
  const vm = ingameVM({ dd, game, analysis, needs, rec: result, opponent, latestPatch: store.latestPatch(), hasKey, mode, roleSource: picked.source });
  // Début de partie, rien d'acheté : meilleur départ parmi les choix courants
  const bought = game.me.items.filter((id) => !TRINKETS.has(id));
  if (game.gameTime < STARTER_WINDOW && !bought.length && mode.family !== 'arena') {
    const cs = rec.champSelect({
      champKey: champ.key,
      role,
      family: mode.family,
      oppKey: opponent && opponent.champ ? opponent.champ.key : 0,
      enemyKeys: enemies.map((e) => e.champ && e.champ.key).filter(Boolean),
    });
    const starters = startersVM(dd, cs.starts);
    if (starters.length) vm.starters = starters;
  }
  vm.roleInfo = { role, source: picked.source, champKey: champ.key, roles: !!mode.roles };
  vm.modeLabel = mode.label;
  return vm;
}

/** En sélection, les rôles adverses sont inconnus : on devine l'adversaire direct via les données. */
function guessChampSelectOpponent(cs, store) {
  if (!cs.role) return null;
  let best = null;
  let bestShare = 0.3;
  for (const c of cs.enemies) {
    const s = store.roleShare(c.key)[cs.role] || 0;
    if (s > bestShare) {
      best = c;
      bestShare = s;
    }
  }
  return best;
}

function computeChampSelect({ dd, store, rec, cs, hasKey, importHotkey, mode = null, roleChoice = null, presets = null }) {
  if (!cs) return null;
  mode = mode || detectMode({ queueId: cs.queueId, mapNumber: cs.mapId, gameMode: cs.gameMode });
  if (!mode.supported) return messageVM(mode.label || 'Mode non pris en charge', mode.message || 'Ce mode n’est pas pris en charge.');
  if (!cs.myChampion) {
    const what = mode.runes ? 'ses runes, sorts et build' : 'son build';
    return messageVM(`Sélection des champions · ${mode.label}`, `Choisis ton champion : ${what} apparaîtront ici.`);
  }
  const picked = mode.roles ? resolveRole({ choice: roleChoice, champKey: cs.myChampion.key, assigned: cs.role, store }) : { role: '', source: '' };
  const role = picked.role;
  const opponent = mode.roles ? guessChampSelectOpponent({ ...cs, role }, store) : null;
  const result = rec.champSelect({
    champKey: cs.myChampion.key,
    role,
    family: mode.family,
    oppKey: opponent ? opponent.key : 0,
    enemyKeys: mode.teams ? cs.enemies.map((c) => c.key) : [],
    preset: mode.family === 'sr' ? (presetFor(presets, cs.myChampion.key, role) || {}).set : null,
  });
  const csPreset = mode.family === 'sr' ? presetFor(presets, cs.myChampion.key, role) : null;
  result.presetLabel = csPreset ? csPreset.label : null;
  const vm = champSelectVM({ dd, cs, rec: result, opponent, latestPatch: store.latestPatch(), hasKey, importHotkey, mode, roleSource: picked.source });
  vm.roleInfo = { role, source: picked.source, champKey: cs.myChampion.key, roles: !!mode.roles };
  // de quoi écrire la page d'objets de la boutique (client LoL)
  vm.itemSet = {
    champKey: cs.myChampion.key,
    map: mode.map,
    starts: result.starts.map((s) => ({ ids: s.ids, share: s.share })),
    core: result.core ? result.core.ids : [],
    boots: result.boots ? result.boots.id : 0,
  };
  vm.modeLabel = mode.label;
  return vm;
}

module.exports = { presetFor, computeIngame, computeChampSelect, findOpponent, guessChampSelectOpponent, resolveRole, normRole, ROLE_IDS };
