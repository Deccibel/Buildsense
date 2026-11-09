'use strict';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const api = window.coach;

let state = null;
let champions = [];
let champFilter = 'all';
let initialized = false;
let toastTimer = null;
let lastFavKey = '';
let lastLiveKey = '';
let hadLive = false;
let lastPrefKey = '';

const PHASES = {
  None: 'accueil',
  Lobby: 'salon',
  Matchmaking: 'recherche',
  ReadyCheck: 'partie trouvée',
  ChampSelect: 'sélection',
  GameStart: 'lancement',
  InProgress: 'en partie',
  Reconnect: 'reconnexion',
  WaitingForStats: 'fin de partie',
  PreEndOfGame: 'fin de partie',
  EndOfGame: 'fin de partie',
};

const PLATFORM_LABELS = {
  euw1: 'EUW (Europe Ouest)',
  eun1: 'EUNE (Europe Nord & Est)',
  tr1: 'TR (Turquie)',
  ru: 'RU (Russie)',
  me1: 'ME (Moyen-Orient)',
  na1: 'NA (Amérique du Nord)',
  br1: 'BR (Brésil)',
  la1: 'LAN (Amérique latine Nord)',
  la2: 'LAS (Amérique latine Sud)',
  kr: 'KR (Corée)',
  jp1: 'JP (Japon)',
  oc1: 'OCE (Océanie)',
  ph2: 'PH (Philippines)',
  sg2: 'SG (Singapour)',
  th2: 'TH (Thaïlande)',
  tw2: 'TW (Taïwan)',
  vn2: 'VN (Vietnam)',
};

const ROLES = [
  ['TOP', 'Top'],
  ['JUNGLE', 'Jungle'],
  ['MIDDLE', 'Mid'],
  ['BOTTOM', 'Bot'],
  ['UTILITY', 'Support'],
];
const ROLE_LABEL = Object.fromEntries(ROLES);
const MODES = [
  ['sr', 'Faille de l’invocateur', 'Classées solo/duo des joueurs Challenger et Grand Maître'],
  ['aram', 'ARAM', 'Parties ARAM de ces joueurs et de leurs adversaires'],
  ['mayhem', 'ARAM Mayhem', 'Quand le mode est disponible (sinon données ARAM)'],
  ['arena', 'Arena', 'Quand le mode est disponible'],
];
const LANGS = [
  ['fr_FR', 'Français'],
  ['en_US', 'English'],
];
const LANG_NAMES = { fr: 'français', en: 'anglais', de: 'allemand', es: 'espagnol', it: 'italien', pt: 'portugais', pl: 'polonais', tr: 'turc', ko: 'coréen', ja: 'japonais', zh: 'chinois', ru: 'russe' };

const STAR = '<svg viewBox="0 0 24 24"><path d="m12 3 2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/></svg>';
const GOOD_SAMPLE = 150;

const fmt = (n) => Number(n || 0).toLocaleString('fr-FR');
const norm = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/** h('div', { class: 'x' }, enfant, [enfants], texte) */
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style') Object.assign(e.style, v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  const add = (c) => {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  kids.forEach(add);
  return e;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

function hue(label) {
  let x = 0;
  for (const ch of String(label || '')) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  return x % 360;
}

/** Portrait avec repli sur les initiales si l'icône ne charge pas. */
function portrait(src, name, cls) {
  const fallback = () => {
    const d = el('div', `${cls} ph`, String(name || '?').slice(0, 2));
    const hh = hue(name);
    d.style.background = `hsl(${hh} 32% 20%)`;
    d.style.color = `hsl(${hh} 75% 78%)`;
    return d;
  };
  if (!src) return fallback();
  const img = el('img', cls);
  img.src = src;
  img.alt = '';
  img.draggable = false;
  img.addEventListener('error', () => img.replaceWith(fallback()));
  return img;
}

function setMsg(id, text, kind = '') {
  const m = $(id);
  m.textContent = text || '';
  m.className = `msg ${kind}`;
}

function showToast({ text, level }) {
  const t = $('#toast');
  t.textContent = text;
  t.className = level || 'info';
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 4500);
}

function goto(page) {
  for (const b of $$('.nav')) b.classList.toggle('active', b.dataset.page === page);
  for (const p of $$('.page')) p.hidden = p.id !== `page-${page}`;
  $('main').scrollTop = 0;
  if (page === 'champs') loadChampions();
  if (page === 'live') renderLive(state, true);
}

// ---------------------------------------------------------------- rendu

function statusRow(label, value, kind) {
  const r = el('div', 'st');
  r.append(el('span', `dot ${kind || ''}`), el('span', 'k', label), el('span', 'v', value));
  return r;
}

function crawlerInfo(s, hasKey) {
  const c = s.crawler;
  if (!hasKey) return { title: 'Clé API manquante', sub: 'Ajoute ta clé dans Réglages pour lancer la collecte.', dot: '', chip: ['clé manquante', 'warn'] };
  switch (c.state) {
    case 'running':
      return {
        title: 'Collecte en cours',
        sub: `${fmt(c.matchesAdded)} parties ajoutées cette session${c.favPlayersFound ? ` · ${c.favPlayersFound} spécialistes de tes champions trouvés` : ''}`,
        dot: 'on',
        chip: ['active', 'ok'],
      };
    case 'paused-ingame':
      return { title: 'En pause pendant ta partie', sub: 'Elle reprendra à la fin de la partie.', dot: '', chip: ['pause (partie)', 'warn'] };
    case 'waiting':
      return { title: 'Connexion à Riot impossible', sub: c.lastError || 'Nouvelle tentative dans quelques secondes.', dot: 'err', subErr: true, chip: ['en attente', 'err'] };
    case 'nokey':
      return { title: 'Clé API refusée', sub: c.lastError || 'Recolle une clé valide dans Réglages.', dot: 'err', subErr: true, chip: ['clé refusée', 'err'] };
    default:
      return { title: 'Collecte en pause', sub: 'Relance-la pour continuer à enrichir les builds.', dot: '', chip: ['en pause', 'warn'] };
  }
}

function updateRow(u) {
  if (!u) return null;
  const map = {
    'up-to-date': ['à jour', 'ok'],
    available: [`${u.latest} dispo`, 'warn'],
    downloading: [`${Math.floor((u.received / (u.size || 1)) * 100)} %`, 'warn'],
    ready: [`${u.latest} prête`, 'warn'],
    error: ['hors ligne', ''],
    disabled: ['manuelle', ''],
  };
  const [v, k] = map[u.status] || [u.current, ''];
  return statusRow('Version', `${u.current} · ${v}`, k);
}

function renderStatus(s, ci) {
  const icons = s.icons || {};
  let iconVal = 'prêtes';
  let iconKind = 'ok';
  if (!s.dd.ready) [iconVal, iconKind] = ['en attente', ''];
  else if (icons.running) [iconVal, iconKind] = [`${fmt(icons.done)} / ${fmt(icons.total)}`, 'warn'];
  else if (icons.failed) [iconVal, iconKind] = [`${fmt(icons.failed)} manquantes`, 'warn'];

  $('#status').replaceChildren(
    s.dd.ready
      ? statusRow('Données', `patch ${s.dd.version}`, 'ok')
      : statusRow('Données', s.dd.error ? 'hors ligne' : 'chargement…', s.dd.error ? 'err' : 'warn'),
    statusRow('Icônes', iconVal, iconKind),
    statusRow('Client LoL', s.game.clientPhase ? PHASES[s.game.clientPhase] || s.game.clientPhase : 'fermé', s.game.clientPhase ? 'ok' : ''),
    statusRow(
      'Partie',
      s.game.inGame ? (s.game.unsupported ? `${s.game.unsupported} (non géré)` : `en cours${s.game.modeLabel ? ` · ${s.game.modeLabel}` : ''}`) : 'aucune',
      s.game.inGame ? (s.game.unsupported ? 'warn' : 'ok') : '',
    ),
    statusRow('Collecte', ci.chip[0], ci.chip[1]),
    ...[updateRow(s.update)].filter(Boolean),
  );
}

function renderSetup(s, hasKey) {
  let windowed = false;
  try {
    windowed = localStorage.getItem('bs-windowed') === '1';
  } catch {
    windowed = false;
  }
  const keyOk = hasKey && s.crawler.state !== 'nokey';
  const steps = [
    { done: keyOk, title: 'Ajoute ta clé API Riot', sub: 'Gratuite sur developer.riotgames.com', action: ['Réglages', () => goto('settings')] },
    { done: s.favorites.length > 0, title: 'Choisis tes champions', sub: 'Leurs builds sont collectés en priorité', action: ['Choisir', () => goto('champs')] },
    {
      done: windowed,
      title: 'Passe LoL en « Fenêtré sans bordure »',
      sub: 'Options › Vidéo › Mode fenêtre, sinon l’overlay reste invisible',
      action: [
        "C'est fait",
        () => {
          try {
            localStorage.setItem('bs-windowed', '1');
          } catch {
            /* rien */
          }
          render();
        },
      ],
    },
    {
      done: s.store.records >= 3000,
      title: 'Laisse la collecte tourner',
      sub: `${fmt(s.store.records)} builds pour l'instant — compte environ 1 h pour une bonne base`,
    },
  ];
  const card = $('#setup');
  card.hidden = steps.every((x) => x.done);
  if (card.hidden) return;
  card.replaceChildren(
    el('h3', '', 'Pour bien démarrer'),
    ...steps.map((st, i) => {
      const row = el('div', `step ${st.done ? 'done' : ''}`);
      row.append(el('span', 'n', st.done ? '✓' : String(i + 1)));
      const txt = el('div', 'txt');
      txt.append(el('b', '', st.title), el('small', '', st.sub));
      row.append(txt);
      if (!st.done && st.action) {
        const b = el('button', 'btn ghost small', st.action[0]);
        b.addEventListener('click', st.action[1]);
        row.append(b);
      }
      return row;
    }),
  );
}

function renderFavorites(s) {
  const grid = $('#favTiles');
  const tiles = s.favorites.map((f) => {
    const t = el('div', 'fav');
    t.append(portrait(f.icon, f.name, 'pic'));
    const info = el('div', 'info');
    const pref = (s.config.rolePrefs || {})[f.key];
    const nm = el('div', 'nm');
    nm.append(el('span', '', f.name));
    if (pref) nm.append(el('span', 'tag', ROLE_LABEL[pref] || pref));
    info.append(nm, el('div', 'cnt', `${fmt(f.total)} builds · ${fmt(f.latest)} sur le dernier patch`));
    const bar = el('div', `bar ${f.latest < 50 ? 'low' : ''}`);
    const fill = el('span');
    fill.style.width = `${Math.min(100, Math.round((f.latest / GOOD_SAMPLE) * 100))}%`;
    bar.append(fill);
    info.append(bar);
    t.append(info);
    return t;
  });
  const add = el('div', 'fav add', '+ Ajouter un champion');
  add.addEventListener('click', () => goto('champs'));
  grid.replaceChildren(...tiles, add);
}

function renderChampGrid() {
  const grid = $('#champGrid');
  if (!state) return;
  const favs = new Set(state.config.favorites);
  const q = norm($('#champSearch').value);
  const list = champions.filter((c) => (!q || norm(c.name).includes(q)) && (champFilter === 'all' || favs.has(c.key)));
  if (!champions.length) {
    grid.replaceChildren(el('div', 'empty', 'Liste des champions indisponible (données du jeu pas encore chargées).'));
    return;
  }
  if (!list.length) {
    grid.replaceChildren(el('div', 'empty', champFilter === 'fav' ? 'Aucun favori pour le moment.' : 'Aucun champion trouvé.'));
    return;
  }
  grid.replaceChildren(
    ...list.map((c) => {
      const b = el('button', `champ ${favs.has(c.key) ? 'on' : ''}`);
      b.title = favs.has(c.key) ? 'Retirer des favoris' : 'Ajouter aux favoris';
      const star = el('span', 'star');
      star.innerHTML = STAR;
      const pref = (state.config.rolePrefs || {})[c.key];
      b.append(star, portrait(c.icon, c.name, ''), el('span', 'cn', c.name), el('span', 'cc', c.n ? `${fmt(c.n)} builds` : '—'));
      if (pref) b.append(el('span', 'ptag', ROLE_LABEL[pref] || pref));
      b.addEventListener('click', () => toggleFavorite(c.key));
      return b;
    }),
  );
}


// ---------------------------------------------------------------- modes, langue, postes

function renderModeStats(s) {
  const by = (s.store && s.store.byFamily) || {};
  const fams = (s.crawler && s.crawler.families) || {};
  $('#modeStats').replaceChildren(
    ...MODES.map(([id, name]) => {
      const f = fams[id] || {};
      const on = (s.config.collectModes || {})[id] !== false;
      const chip = el('div', `mchip ${on ? '' : 'off'}`);
      chip.append(el('span', 'mn', name), el('b', '', fmt((by[id] || {}).matches || 0)), el('span', 'mu', 'parties'));
      if (!on) chip.append(el('span', 'ms', 'désactivé'));
      else if (f.paused) chip.append(el('span', 'ms', 'hors rotation ?'));
      return chip;
    }),
  );
}

function renderSettingsExtras(s) {
  const cfg = s.config;
  const box = $('#collectModes');
  if (!box.childElementCount) {
    box.append(
      ...MODES.map(([id, name, sub]) => {
        const row = el('label', 'switch-row');
        const txt = el('span');
        txt.append(el('b', '', name), el('small', '', sub));
        const sw = el('span', 'switch');
        const input = el('input');
        input.type = 'checkbox';
        input.dataset.mode = id;
        input.addEventListener('change', () => saveConfig({ collectModes: { [id]: input.checked } }));
        sw.append(input, el('i'));
        row.append(txt, sw);
        return row;
      }),
    );
  }
  for (const i of $$('[data-mode]')) i.checked = (cfg.collectModes || {})[i.dataset.mode] !== false;

  // langue : automatique (client LoL), français, anglais (+ la langue actuelle si autre)
  const sel = $('#language');
  const detected = s.clientLocale || cfg.detectedLocale;
  const dName = detected ? LANG_NAMES[detected.slice(0, 2)] || detected : null;
  const opts = [['auto', dName ? `Automatique : langue du client LoL (${dName})` : 'Automatique : langue du client LoL'], ...LANGS];
  if (cfg.language !== 'auto' && !LANGS.some(([v]) => v === cfg.language)) opts.push([cfg.language, cfg.language]);
  const key = JSON.stringify(opts);
  if (sel.dataset.key !== key) {
    sel.dataset.key = key;
    sel.replaceChildren(
      ...opts.map(([v, t]) => {
        const o = el('option', '', t);
        o.value = v;
        return o;
      }),
    );
  }
  if (document.activeElement !== sel) sel.value = cfg.language || 'auto';
  $('#autoRunes').checked = cfg.autoRunes !== false;
  $('#autoLivePage').checked = cfg.autoLivePage !== false;
}

function renderRolePrefs() {
  if (!state) return;
  const prefs = state.config.rolePrefs || {};
  const byKey = new Map(champions.map((c) => [String(c.key), c]));
  const champSel = $('#prefChamp');
  const ck = champions.map((c) => c.key).join(',');
  if (champSel.dataset.key !== ck) {
    champSel.dataset.key = ck;
    const first = el('option', '', champions.length ? 'Champion…' : 'Champions en chargement…');
    first.value = '';
    champSel.replaceChildren(
      first,
      ...champions.map((c) => {
        const o = el('option', '', c.name);
        o.value = String(c.key);
        return o;
      }),
    );
  }
  const roleSel = $('#prefRole');
  if (!roleSel.childElementCount) {
    roleSel.append(
      ...ROLES.map(([v, t]) => {
        const o = el('option', '', t);
        o.value = v;
        return o;
      }),
    );
    roleSel.value = 'UTILITY';
  }
  const entries = Object.entries(prefs).filter(([, r]) => r);
  const key = JSON.stringify([entries, ck]);
  if (key === lastPrefKey) return;
  lastPrefKey = key;
  if (!entries.length) {
    $('#prefList').replaceChildren(el('div', 'muted small', 'Aucun poste préféré : BuildSense utilise le poste donné par le client, sinon le plus joué.'));
    return;
  }
  $('#prefList').replaceChildren(
    ...entries.map(([k, r]) => {
      const c = byKey.get(k);
      const row = el('div', 'pref');
      row.append(portrait(c && c.icon, c ? c.name : `#${k}`, 'pic'));
      const name = el('div', 'pn');
      name.append(el('b', '', c ? c.name : `Champion #${k}`));
      if (c && c.mainRole && c.mainRole !== r) name.append(el('small', '', `joué surtout ${ROLE_LABEL[c.mainRole] || c.mainRole} par les Chall/GM`));
      const sel = el('select');
      for (const [v, t] of ROLES) {
        const o = el('option', '', t);
        o.value = v;
        sel.append(o);
      }
      sel.value = r;
      sel.addEventListener('change', () => saveConfig({ rolePrefs: { [k]: sel.value } }));
      const del = el('button', 'btn ghost small', 'Retirer');
      del.addEventListener('click', () => saveConfig({ rolePrefs: { [k]: '' } }));
      row.append(name, sel, del);
      return row;
    }),
  );
}

// ---------------------------------------------------------------- en direct

const ico = (src, name, cls = '') => {
  const p = portrait(src, name, `ic ${cls}`);
  p.title = name || '';
  return p;
};
const coin = (n) => h('span', { class: 'cost' }, h('span', { class: 'coin' }), fmt(n));
const card = (title, meta, ...kids) =>
  h('div', { class: 'card lv-card' }, title ? h('div', { class: 'lv-t' }, h('h3', null, title), meta ? h('span', { class: 'meta' }, meta) : null) : null, ...kids);

function roleSeg(vm) {
  const info = vm.roleInfo;
  if (!info || !info.roles) return null;
  const manual = info.source === 'manual';
  const btn = (val, text) =>
    h(
      'button',
      {
        class: (val === '' && !manual) || (manual && val === info.role) ? 'active' : '',
        onclick: async () => {
          state = await api.invoke('role:set', val);
          render();
        },
      },
      text,
    );
  const src = { client: 'donné par le client', pref: 'ton poste préféré', data: 'le plus joué', manual: 'choisi pour cette partie' }[info.source] || '';
  return h(
    'div',
    { class: 'lv-role' },
    h('div', { class: 'seg' }, btn('', `Auto${!manual && info.role ? ` (${ROLE_LABEL[info.role] || info.role})` : ''}`), ROLES.map(([v, t]) => btn(v, t))),
    h('small', null, `Poste : ${ROLE_LABEL[info.role] || '—'}${src ? ` · ${src}` : ''}`, state.hotkeys.role ? [' · raccourci ', h('kbd', null, state.hotkeys.role)] : null),
  );
}

function liveHead(vm, source) {
  const hd = vm.header;
  const chips = [];
  if (hd.role) chips.push(h('span', { class: `chip ${hd.roleTag ? 'picked' : ''}` }, hd.role, hd.roleTag ? h('em', null, hd.roleTag) : null));
  if (vm.modeLabel && vm.modeLabel !== hd.role) chips.push(h('span', { class: 'chip ghost' }, vm.modeLabel));
  if (source === 'demo') chips.push(h('span', { class: 'chip demo' }, 'aperçu'));
  const sub = [];
  if (hd.opponent) sub.push(h('span', { class: 'vs' }, 'vs ', ico(hd.opponentIcon, hd.opponent, 'round'), h('b', null, hd.opponent)));
  if (vm.mode === 'ingame') {
    sub.push(h('span', null, hd.phase), h('span', { class: 'num' }, hd.clock), h('span', { class: 'gold' }, h('span', { class: 'coin' }), hd.gold));
  } else sub.push(h('span', null, 'Sélection des champions'));
  return h(
    'div',
    { class: 'card lv-head' },
    h('div', { class: 'lv-pic' }, ico(hd.icon, hd.champion), hd.level ? h('span', { class: 'lvl' }, hd.level) : null),
    h('div', { class: 'lv-who' }, h('div', { class: 'lv-name' }, h('span', null, hd.champion), chips), h('div', { class: 'lv-sub' }, sub)),
    roleSeg(vm),
  );
}

function lvPath(items, extra) {
  return h(
    'div',
    { class: 'lv-path' },
    items.map((c, i) => [
      i ? h('span', { class: 'chev' }, '›') : null,
      h('div', { class: `lv-step ${c.owned ? 'owned' : ''}` }, ico(c.icon, c.name), h('span', null, c.name), c.owned ? h('span', { class: 'ok' }, '✓') : null),
    ]),
    extra ? [h('span', { class: 'chev' }, '+'), h('div', { class: 'lv-step' }, ico(extra.icon, extra.name), h('span', null, extra.name))] : null,
  );
}

function lvSkills(sk) {
  if (!sk) return null;
  return card(
    'Compétences',
    null,
    h('div', { class: 'lv-skills' }, h('span', { class: 't' }, 'Max'), sk.order.map((k, i) => [i ? h('span', { class: 'chev' }, '›') : null, h('span', { class: 'kc' }, k)])),
    sk.first && sk.first.length ? h('div', { class: 'lv-skills' }, h('span', { class: 't' }, 'Début'), sk.first.map((k) => h('span', { class: 'kc small' }, k))) : null,
  );
}

function liveIngame(vm) {
  const left = [];
  const right = [];
  if (vm.options.length) {
    left.push(
      card(
        vm.optionsTitle,
        'tes options',
        vm.options.map((o, i) =>
          h(
            'div',
            { class: `lv-opt ${i === 0 ? 'best' : ''}` },
            ico(o.icon, o.name),
            h(
              'div',
              { class: 'body' },
              h('div', { class: 'row' }, h('b', null, o.name, o.situational ? h('span', { class: 'situ' }, 'situationnel') : null), coin(o.cost)),
              o.reasons.length ? h('ul', null, o.reasons.map((r) => h('li', { class: r.boost ? 'boost' : '' }, r.text))) : null,
            ),
          ),
        ),
      ),
    );
  }
  const p = vm.plan;
  if (p || vm.boots) {
    left.push(
      card(
        p ? p.title : 'Bottes',
        p ? p.goldText : null,
        p ? h('div', { class: `progress ${p.state === 'ready' ? 'ready' : ''}` }, h('span', { style: { width: `${Math.round(p.progress * 100)}%` } })) : null,
        p && p.buy.length ? h('div', { class: 'lv-tiles' }, p.buy.map((b) => h('div', { class: 'lv-tile' }, ico(b.icon, b.name), h('span', null, b.name), coin(b.cost)))) : null,
        p && p.after ? h('div', { class: 'muted small' }, p.after) : null,
        vm.boots
          ? h('div', { class: 'lv-boots' }, ico(vm.boots.icon, vm.boots.name), h('div', null, h('small', null, 'Bottes conseillées'), h('b', null, vm.boots.name), vm.boots.reason ? h('div', { class: 'muted small' }, vm.boots.reason) : null))
          : null,
      ),
    );
  }
  if (vm.core.length) left.push(card(vm.coreTitle || 'Build type', vm.coreWr ? `${vm.coreWr} de victoires` : null, lvPath(vm.core)));
  if (!vm.options.length && !p && !vm.core.length) left.push(card(null, null, h('div', { class: 'muted' }, 'Pas encore de build pour ce champion dans ce mode : la collecte continue en fond.')));

  if (vm.enemies.length) {
    right.push(
      card(
        'Équipe adverse',
        null,
        h(
          'div',
          { class: 'lv-enemies' },
          vm.enemies.map((e) =>
            h(
              'div',
              { class: `lv-enemy ${e.fed ? 'fed' : ''} ${e.isOpponent ? 'opp' : ''}` },
              ico(e.icon, e.name, 'round'),
              h('div', { class: 'nm' }, h('b', null, e.name), h('small', null, `niv. ${e.level || '?'}`, e.isOpponent ? ' · ton adversaire' : '')),
              h('span', { class: 'kda' }, e.kda),
              h('span', { class: `dmg ${e.dmg}` }, { AD: 'physique', AP: 'magique', MIX: 'mixte' }[e.dmg] || 'mixte'),
              e.fed ? h('span', { class: 'fedtag' }, 'FED') : null,
            ),
          ),
        ),
        vm.damage
          ? [
              h('div', { class: 'dmgbar' }, h('span', { class: 'ad', style: { width: `${vm.damage.ad}%` } }), h('span', { class: 'ap', style: { width: `${vm.damage.ap}%` } })),
              h('div', { class: 'dmglegend' }, h('span', null, h('b', { class: 'adt' }, `${vm.damage.ad} %`), ' physiques'), h('span', null, h('b', { class: 'apt' }, `${vm.damage.ap} %`), ' magiques')),
            ]
          : null,
      ),
    );
  }
  if (vm.alerts.length) {
    right.push(
      card(
        'À surveiller',
        null,
        vm.alerts.map((a) => h('div', { class: `lv-alert ${a.level}` }, h('span', null, a.text), a.champs.length ? h('div', { class: 'champs' }, a.champs.map((c) => ico(c.icon, c.name, 'round'))) : null)),
      ),
    );
  }
  const sk = lvSkills(vm.skills);
  if (sk) right.push(sk);
  return [h('div', { class: 'lv-grid' }, h('div', { class: 'lv-col' }, left), h('div', { class: 'lv-col' }, right))];
}

function liveChampSelect(vm) {
  const left = [];
  const right = [];
  if (vm.matchupNote) left.push(h('div', { class: 'callout slim' }, vm.matchupNote));
  if (vm.page) {
    const pg = vm.page;
    const runesBox = vm.runes
      ? h(
          'div',
          { class: `lv-runestate ${vm.runes.state}` },
          h('span', { class: 'dot' }),
          h('span', null, vm.runes.text),
          h(
            'button',
            {
              class: 'btn small',
              onclick: async () => {
                const r = await api.invoke('runes:import');
                showToast({ text: r.message, level: r.ok ? 'ok' : 'warn' });
              },
            },
            vm.runes.state === 'applied' ? 'Réappliquer' : 'Appliquer maintenant',
          ),
        )
      : null;
    left.push(
      card(
        'Runes',
        `${pg.share} des parties${pg.wr ? ` · ${pg.wr} de victoires` : ''}`,
        h(
          'div',
          { class: 'lv-keystone' },
          ico(pg.keystone.icon, pg.keystone.name, 'round big'),
          h('div', null, h('b', null, pg.keystone.name), h('div', { class: 'muted' }, [pg.primary && pg.primary.name, pg.secondary && pg.secondary.name].filter(Boolean).join(' + '))),
        ),
        h(
          'div',
          { class: 'lv-runes' },
          [...pg.primaryRunes, ...pg.secondaryRunes].map((r) => h('div', { class: 'lv-rune' }, ico(r.icon, r.name, 'round'), h('span', null, r.name))),
        ),
        h('div', { class: 'lv-shards' }, h('small', null, 'Fragments'), pg.shards.map((x) => h('span', { class: 'lv-shard' }, ico(x.icon, x.name, 'round'), x.name))),
        vm.altKeystones.length ? h('div', { class: 'muted small' }, `Autres choix : ${vm.altKeystones.map((k) => `${k.name} (${k.share})`).join(', ')}`) : null,
        runesBox,
      ),
    );
  }
  const row = (items, withCount) =>
    h(
      'div',
      { class: 'lv-items' },
      items.map((it) => h('div', { class: 'lv-item' }, ico(it.icon, it.name), h('span', null, it.name, withCount && it.count > 1 ? ` ×${it.count}` : ''))),
    );
  if (vm.spells) right.push(card('Sorts d’invocateur', vm.spells.share, row(vm.spells.list)));
  if (vm.start) right.push(card('Départ', null, row(vm.start, true)));
  const sk = lvSkills(vm.skills);
  if (sk) right.push(sk);
  if (vm.core.length) right.push(card(vm.coreTitle || 'Build type', null, lvPath(vm.core, vm.boots)));
  if (vm.enemies.length) {
    right.push(
      card(
        'Face à toi',
        null,
        h('div', { class: 'lv-items' }, vm.enemies.map((c) => h('div', { class: `lv-item ${c.isOpponent ? 'opp' : ''}` }, ico(c.icon, c.name, 'round'), h('span', null, c.name)))),
      ),
    );
  }
  if (!left.length) return [h('div', { class: 'lv-grid one' }, h('div', { class: 'lv-col' }, right))];
  return [h('div', { class: 'lv-grid' }, h('div', { class: 'lv-col' }, left), h('div', { class: 'lv-col' }, right))];
}

function renderLive(s, force = false) {
  if (!s) return;
  const live = s.live;
  // pastille "en direct" et bandeau de l'accueil
  $('#liveDot').hidden = !live || live.source === 'demo';
  const banner = $('#liveBanner');
  const vm = live && live.vm;
  if (live && live.source !== 'demo' && vm && vm.header) {
    banner.hidden = false;
    const what = vm.mode === 'champselect' ? 'Sélection en cours' : 'Partie en cours';
    banner.replaceChildren(
      ico(vm.header.icon, vm.header.champion),
      h('span', { class: 'bt' }, h('b', null, `${what} : ${vm.header.champion}`), h('small', null, [vm.header.role, vm.modeLabel !== vm.header.role ? vm.modeLabel : null].filter(Boolean).join(' · '))),
      h('span', { class: 'go' }, 'Suivre en direct →'),
    );
  } else banner.hidden = true;

  // bascule automatique (sans prendre le focus) au début d'une sélection ou d'une partie
  const real = !!live && live.source !== 'demo';
  if (real && !hadLive && s.config.autoLivePage !== false && $('#page-live').hidden) goto('live');
  hadLive = real;

  if ($('#page-live').hidden && !force) return;
  const key = JSON.stringify(live);
  if (key === lastLiveKey && !force) return;
  lastLiveKey = key;
  const view = $('#liveView');
  if (!live) {
    const phase = s.game.clientPhase ? PHASES[s.game.clientPhase] || s.game.clientPhase : null;
    view.replaceChildren(
      h(
        'div',
        { class: 'card lv-empty' },
        h('h3', null, 'Aucune partie en cours'),
        h('p', { class: 'muted' }, phase ? `Client LoL : ${phase}. Cette page se remplit dès la sélection des champions.` : 'Lance League of Legends : cette page se remplit dès la sélection des champions.'),
        h('div', { class: 'btns' }, [['ingame', 'Aperçu en partie'], ['aram', 'Aperçu ARAM'], ['champselect', 'Aperçu sélection']].map(([d, t]) =>
          h('button', { class: 'btn ghost', onclick: async () => { state = await api.invoke('demo:set', d); render(); } }, t),
        )),
      ),
    );
    return;
  }
  if (vm.mode === 'message') {
    view.replaceChildren(h('div', { class: 'card lv-empty' }, h('h3', null, vm.title), h('p', { class: 'muted' }, vm.text)));
    return;
  }
  view.replaceChildren(
    liveHead(vm, live.source),
    ...(vm.mode === 'ingame' ? liveIngame(vm) : liveChampSelect(vm)),
    h('div', { class: `lv-sample ${vm.sample.warn ? 'warn' : ''}` }, vm.sample.text),
  );
}

// ---------------------------------------------------------------- mises à jour

const mb = (n) => `${(Number(n || 0) / 1048576).toFixed(n >= 104857600 ? 0 : 1).replace('.', ',')} Mo`;

function updateText(u) {
  if (!u) return '';
  switch (u.status) {
    case 'disabled':
      return 'Les mises à jour automatiques ne sont pas configurées sur cette version.';
    case 'checking':
      return 'Recherche d’une nouvelle version…';
    case 'up-to-date':
      return `BuildSense ${u.current} est à jour.`;
    case 'available':
      return u.error ? `Version ${u.latest} disponible. Le téléchargement a échoué : ${u.error}` : `Version ${u.latest} disponible${u.playing ? ' : téléchargement après ta partie' : ''}.`;
    case 'downloading':
      return `Téléchargement de la version ${u.latest} : ${Math.floor((u.received / (u.size || 1)) * 100)} % (${mb(u.received)} / ${mb(u.size)})`;
    case 'ready':
      return u.playing ? `Version ${u.latest} prête : elle s’installera quand ta partie sera finie.` : `Version ${u.latest} prête à être installée (moins d’une minute, BuildSense redémarre tout seul).`;
    case 'error':
      return `Impossible de vérifier les mises à jour : ${u.error}`;
    default:
      return `Version installée : ${u.current}`;
  }
}

async function installUpdate() {
  const r = await api.invoke('update:install');
  showToast({ text: r.message, level: r.ok ? 'ok' : 'warn' });
}

const ACCENT_LIST = [
  ['cyan', 'Cyan', '#2ee6c5'],
  ['red', 'Rouge', '#ff4d5e'],
  ['green', 'Vert', '#3ddc84'],
  ['yellow', 'Jaune', '#f5d142'],
  ['orange', 'Orange', '#ff9a3c'],
  ['purple', 'Mauve', '#b48cff'],
  ['blue', 'Bleu', '#4d9fff'],
  ['classic', 'Classique LoL', 'linear-gradient(135deg, #c8aa6e 0 50%, #0a1428 50% 100%)'],
];

function renderAppearance(s) {
  const a = s.config.appearance || { theme: 'dark', accent: 'cyan' };
  document.documentElement.dataset.accent = a.accent;
  for (const b of $$('#themeSeg button')) b.classList.toggle('active', b.dataset.theme === a.theme);
  const box = $('#accentPick');
  if (!box.childElementCount) {
    box.append(
      ...ACCENT_LIST.map(([id, label, color]) =>
        h(
          'button',
          { class: 'swatch', 'data-accent': id, title: label, onclick: () => saveConfig({ appearance: { accent: id } }) },
          h('span', { class: 'dot', style: { background: color } }),
          h('span', null, label),
        ),
      ),
    );
  }
  for (const b of $$('#accentPick .swatch')) b.classList.toggle('active', b.dataset.accent === a.accent);
}

function renderUpdate(s) {
  const u = s.update;
  $('#version').textContent = `version ${s.version || ''}`.trim();

  // carte de l'accueil
  const cardEl = $('#updateCard');
  const show = u && ['available', 'downloading', 'ready'].includes(u.status) && !u.dismissed;
  cardEl.hidden = !show;
  if (show) {
    const key = JSON.stringify([u.status, u.latest, Math.floor((u.received / (u.size || 1)) * 50), u.playing, u.error, u.notes]);
    if (cardEl.dataset.key !== key) {
      cardEl.dataset.key = key;
      const pct = Math.floor((u.received / (u.size || 1)) * 100);
      const title = u.status === 'ready' ? `BuildSense ${u.latest} est prête` : `BuildSense ${u.latest} est disponible`;
      const actions = [];
      if (u.status === 'ready') {
        actions.push(h('button', { class: 'btn', disabled: u.playing ? 'disabled' : null, onclick: installUpdate }, u.playing ? 'Après ta partie' : 'Redémarrer et mettre à jour'));
      } else if (u.status === 'available') {
        actions.push(h('button', { class: 'btn', disabled: u.playing ? 'disabled' : null, onclick: async () => { state = await api.invoke('update:download'); render(); } }, u.error ? 'Réessayer' : 'Télécharger'));
      }
      actions.push(h('button', { class: 'btn ghost', onclick: async () => { state = await api.invoke('update:dismiss'); render(); } }, 'Plus tard'));
      cardEl.replaceChildren(
        ...[
          h('div', { class: 'upd-head' }, h('span', { class: 'upd-icon' }, '↑'), h('div', null, h('h3', null, title), h('p', { class: 'muted' }, updateText(u)))),
          u.status === 'downloading' ? h('div', { class: 'upd-progress' }, h('span', { style: { width: `${pct}%` } })) : null,
          u.notes.length ? h('ul', { class: 'upd-notes' }, u.notes.map((n) => h('li', null, n))) : null,
          h('div', { class: 'btns' }, actions),
        ].filter(Boolean),
      );
    }
  }

  // nouveautés après une mise à jour
  const wn = $('#whatsNew');
  wn.hidden = !s.whatsNew;
  if (s.whatsNew && wn.dataset.v !== s.whatsNew.version) {
    wn.dataset.v = s.whatsNew.version;
    wn.replaceChildren(
      ...[
        h('div', { class: 'upd-head' }, h('span', { class: 'upd-icon ok' }, '✓'), h('div', null, h('h3', null, `BuildSense est passée en version ${s.whatsNew.version}`), h('p', { class: 'muted' }, s.whatsNew.notes.length ? 'Les nouveautés :' : 'Mise à jour installée.'))),
        s.whatsNew.notes.length ? h('ul', { class: 'upd-notes' }, s.whatsNew.notes.map((n) => h('li', null, n))) : null,
        h('div', { class: 'btns' }, h('button', { class: 'btn ghost', onclick: async () => { state = await api.invoke('whatsnew:dismiss'); render(); } }, 'OK')),
      ].filter(Boolean),
    );
  }

  // réglages
  $('#updStatus').textContent = u ? `Version installée : ${u.current}. ${updateText(u)}` : '';
  const prog = $('#updProgress');
  prog.hidden = !u || u.status !== 'downloading';
  if (u && u.status === 'downloading') prog.firstElementChild.style.width = `${Math.floor((u.received / (u.size || 1)) * 100)}%`;
  $('#updCheck').disabled = !u || u.status === 'disabled' || u.status === 'checking';
  $('#updDownload').hidden = !u || u.status !== 'available';
  $('#updDownload').disabled = !!(u && u.playing);
  $('#updInstall').hidden = !u || u.status !== 'ready';
  $('#updInstall').disabled = !!(u && u.playing);
  $('#autoUpdate').checked = s.config.autoUpdate !== false;
  if (document.activeElement !== $('#updRepo')) $('#updRepo').value = (u && u.repo) || '';
}

function render() {
  const s = state;
  if (!s) return;
  const cfg = s.config;
  const hasKey = !!cfg.apiKey;
  const ci = crawlerInfo(s, hasKey);

  renderStatus(s, ci);
  renderSetup(s, hasKey);
  renderModeStats(s);
  renderSettingsExtras(s);
  renderUpdate(s);
  renderAppearance(s);
  renderLive(s);
  if (!$('#page-champs').hidden) renderRolePrefs();
  $('#roleKey').textContent = s.hotkeys.role || '—';

  // statistiques et collecte
  $('#stMatches').textContent = fmt(s.store.matches);
  $('#stRecords').textContent = fmt(s.store.records);
  $('#stPatch').textContent = s.store.latestPatch || '–';
  $('#stRequests').textContent = fmt(s.crawler.requests);
  $('#collectDot').className = `pulse ${ci.dot}`;
  $('#collectTitle').textContent = ci.title;
  const sub = $('#collectSub');
  sub.textContent = ci.sub;
  sub.className = `collect-sub ${ci.subErr ? 'err' : ''}`;
  const tog = $('#crawlerToggle');
  tog.textContent = s.crawler.running ? 'Mettre en pause' : 'Lancer la collecte';
  tog.className = s.crawler.running ? 'btn ghost' : 'btn';
  tog.disabled = !hasKey || !s.dd.ready;

  // favoris (on ne reconstruit que si quelque chose a changé)
  const favKey = JSON.stringify([s.favorites.map((f) => [f.key, f.total, f.latest, f.icon]), cfg.rolePrefs]);
  if (favKey !== lastFavKey) {
    lastFavKey = favKey;
    renderFavorites(s);
    if (!$('#page-champs').hidden) renderChampGrid();
  }

  // overlay
  if (document.activeElement !== $('#opacity')) $('#opacity').value = cfg.overlay.opacity;
  if (document.activeElement !== $('#scale')) $('#scale').value = cfg.overlay.scale;
  $('#compact').checked = !!cfg.overlay.compact;
  for (const b of $$('[data-demo]')) {
    const d = b.dataset.demo;
    if (d === 'off') b.disabled = !s.overlay.demo;
    else b.classList.toggle('active', s.overlay.demo === d);
  }
  $('#moveBtn').textContent = s.overlay.moveMode ? 'Valider la position' : "Déplacer l'overlay";
  const rows = [
    ["Afficher / masquer l'overlay", s.hotkeys.toggle],
    ["Déplacer l'overlay", s.hotkeys.move],
    ['Mode compact', s.hotkeys.compact],
    ['Appliquer les runes (pendant la sélection)', s.hotkeys.importRunes],
    ['Changer de poste (sélection et partie)', s.hotkeys.role],
  ];
  $('#keys').replaceChildren(
    ...rows.map(([lbl, key]) => {
      const tr = el('tr');
      const td = el('td');
      td.append(el('kbd', '', key));
      tr.append(el('td', '', lbl), td);
      return tr;
    }),
  );
  setMsg('#hotkeyErrors', s.hotkeyErrors.join(' · '), 'warn');

  // réglages
  if (!initialized) {
    $('#platform').replaceChildren(
      ...s.platforms.map((p) => {
        const o = el('option', '', PLATFORM_LABELS[p] || p.toUpperCase());
        o.value = p;
        return o;
      }),
    );
    $('#apiKey').value = cfg.apiKey || '';
    $('#leaguePath').value = cfg.leaguePath || '';
    initialized = true;
  }
  if (document.activeElement !== $('#platform')) $('#platform').value = cfg.platform;
  $('#pauseInGame').checked = !!cfg.pauseCrawlerInGame;
  $('#lcuEnabled').checked = !!cfg.lcuEnabled;
  $('#importRunes').disabled = !s.importAvailable;
  if (!$('#csMsg').dataset.sticky) {
    setMsg('#csMsg', s.game.champSelect ? 'Sélection détectée : les recommandations sont dans l’overlay.' : '', 'ok');
  }
}

// ---------------------------------------------------------------- actions

async function saveConfig(patch) {
  state = await api.invoke('config:set', patch);
  render();
}

async function toggleFavorite(key) {
  const favs = state.config.favorites;
  const next = favs.includes(key) ? favs.filter((k) => k !== key) : [...favs, key];
  await saveConfig({ favorites: next });
  renderChampGrid();
}

async function loadChampions() {
  champions = await api.invoke('champions:list');
  renderChampGrid();
  renderRolePrefs();
}

function bind() {
  for (const b of $$('.nav')) b.addEventListener('click', () => goto(b.dataset.page));
  for (const b of $$('[data-goto]')) b.addEventListener('click', () => goto(b.dataset.goto));
  for (const b of $$('[data-demo]')) {
    b.addEventListener('click', async () => {
      state = await api.invoke('demo:set', b.dataset.demo === 'off' ? null : b.dataset.demo);
      render();
    });
  }

  $('#crawlerToggle').addEventListener('click', async () => {
    state = await api.invoke('crawler:toggle');
    render();
  });

  $('#champSearch').addEventListener('input', renderChampGrid);
  for (const b of $$('[data-filter]')) {
    b.addEventListener('click', () => {
      champFilter = b.dataset.filter;
      for (const x of $$('[data-filter]')) x.classList.toggle('active', x === b);
      renderChampGrid();
    });
  }

  $('#moveBtn').addEventListener('click', async () => {
    state = await api.invoke('overlay:toggleMove');
    render();
  });
  $('#resetPos').addEventListener('click', async () => {
    state = await api.invoke('overlay:resetPosition');
    render();
  });
  $('#opacity').addEventListener('change', (e) => saveConfig({ overlay: { opacity: Number(e.target.value) } }));
  $('#scale').addEventListener('change', (e) => saveConfig({ overlay: { scale: Number(e.target.value) } }));
  $('#compact').addEventListener('change', (e) => saveConfig({ overlay: { compact: e.target.checked } }));

  $('#toggleKey').addEventListener('click', () => {
    const i = $('#apiKey');
    i.type = i.type === 'password' ? 'text' : 'password';
    $('#toggleKey').textContent = i.type === 'password' ? 'Afficher' : 'Masquer';
  });
  $('#saveKey').addEventListener('click', async () => {
    await saveConfig({ apiKey: $('#apiKey').value, platform: $('#platform').value });
    setMsg('#keyMsg', 'Enregistré.', 'ok');
  });
  $('#platform').addEventListener('change', () => saveConfig({ platform: $('#platform').value }));
  $('#testKey').addEventListener('click', async () => {
    setMsg('#keyMsg', 'Test en cours…');
    if ($('#apiKey').value.trim() !== (state.config.apiKey || '')) {
      await saveConfig({ apiKey: $('#apiKey').value, platform: $('#platform').value });
    }
    const r = await api.invoke('api:test');
    setMsg('#keyMsg', r.message, r.ok ? 'ok' : 'err');
  });
  $('#openPortal').addEventListener('click', () => api.invoke('link:open', 'portal'));
  $('#pauseInGame').addEventListener('change', (e) => saveConfig({ pauseCrawlerInGame: e.target.checked }));
  $('#lcuEnabled').addEventListener('change', (e) => saveConfig({ lcuEnabled: e.target.checked }));
  $('#savePath').addEventListener('click', async () => {
    await saveConfig({ leaguePath: $('#leaguePath').value });
    showToast({ text: 'Dossier enregistré.', level: 'ok' });
  });
  $('#language').addEventListener('change', (e) => saveConfig({ language: e.target.value }));
  for (const b of $$('#themeSeg button')) b.addEventListener('click', () => saveConfig({ appearance: { theme: b.dataset.theme } }));
  $('#autoUpdate').addEventListener('change', (e) => saveConfig({ autoUpdate: e.target.checked }));
  $('#updCheck').addEventListener('click', async () => {
    $('#updStatus').textContent = 'Recherche d’une nouvelle version…';
    state = await api.invoke('update:check');
    render();
  });
  $('#updDownload').addEventListener('click', async () => {
    state = await api.invoke('update:download');
    render();
  });
  $('#updInstall').addEventListener('click', installUpdate);
  $('#updRepoSave').addEventListener('click', async () => {
    const v = $('#updRepo').value.trim();
    state = await api.invoke('config:set', { updateRepo: v });
    render();
    const ok = (state.update && state.update.repo) === v.replace(/^https?:\/\/github\.com\//i, '').replace(/\/+$/, '') || v === '';
    showToast({ text: ok ? 'Dépôt des mises à jour enregistré.' : 'Format attendu : pseudo/nom-du-depot', level: ok ? 'ok' : 'warn' });
  });
  $('#autoRunes').addEventListener('change', (e) => saveConfig({ autoRunes: e.target.checked }));
  $('#autoLivePage').addEventListener('change', (e) => saveConfig({ autoLivePage: e.target.checked }));
  $('#prefAdd').addEventListener('click', async () => {
    const k = $('#prefChamp').value;
    if (!k) return showToast({ text: 'Choisis d’abord un champion.', level: 'warn' });
    await saveConfig({ rolePrefs: { [k]: $('#prefRole').value } });
    $('#prefChamp').value = '';
    renderChampGrid();
  });
  $('#importRunes').addEventListener('click', async () => {
    const r = await api.invoke('runes:import');
    const m = $('#csMsg');
    m.dataset.sticky = '1';
    setMsg('#csMsg', r.message, r.ok ? 'ok' : 'warn');
    setTimeout(() => delete m.dataset.sticky, 6000);
  });
}

async function start() {
  bind();
  state = await api.invoke('app:getState');
  render();
  api.on('state', (s) => {
    const wasReady = state && state.dd.ready;
    state = s;
    render();
    if (!wasReady && s.dd.ready && !$('#page-champs').hidden) loadChampions();
  });
  api.on('toast', showToast);
}

start();
