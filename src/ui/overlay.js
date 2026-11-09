'use strict';

/* Overlay : affiche la vue préparée par le processus principal. */

const $ = (s) => document.querySelector(s);
const root = $('#root');
const appEl = $('#app');
let lastVm = null;
let toastTimer = null;

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') Object.assign(el.style, v);
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(4)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const fmt = (n) => Math.round(n || 0).toLocaleString('fr-FR');

function initials(label) {
  return String(label || '?')
    .replace(/['’]s\b/g, '')
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

function hue(label) {
  let x = 0;
  for (const ch of String(label || '')) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  return x % 360;
}

/** Icône avec repli (initiales colorées) si l'image ne peut pas être chargée. */
function icon(src, label, cls = '') {
  const fallback = () => {
    const hh = hue(label);
    return h(
      'div',
      { class: `ic ph ${cls}`, title: label, style: { background: `hsl(${hh} 32% 20%)`, color: `hsl(${hh} 75% 78%)` } },
      initials(label),
    );
  };
  if (!src) return fallback();
  const img = h('img', { class: `ic ${cls}`, src, alt: '', title: label, draggable: 'false' });
  img.addEventListener('error', () => img.replaceWith(fallback()));
  return img;
}

const cost = (n) => h('span', { class: 'cost' }, h('span', { class: 'coin' }), fmt(n));
const label = (text, meta) => h('div', { class: 'label' }, text, meta ? h('span', { class: 'meta' }, meta) : null);

// ------------------------------------------------------------ en partie

function header(hd, right) {
  return h(
    'div',
    { class: 'top' },
    h('div', { class: 'portrait' }, icon(hd.icon, hd.champion), hd.level ? h('span', { class: 'lvl' }, hd.level) : null),
    h(
      'div',
      { class: 'who' },
      h(
        'div',
        { class: 'name' },
        h('span', { class: 'champ' }, hd.champion),
        hd.role ? h('span', { class: `role ${hd.roleTag ? 'picked' : ''}` }, hd.role, hd.roleTag ? h('em', null, hd.roleTag) : null) : null,
      ),
      h(
        'div',
        { class: 'sub' },
        hd.opponent ? h('span', { class: 'vs' }, 'vs', icon(hd.opponentIcon, hd.opponent, 'round'), h('b', null, hd.opponent)) : null,
        hd.phase ? h('span', { class: 'ph-txt' }, hd.phase) : !hd.opponent ? h('span', null, 'Sélection des champions') : null,
      ),
    ),
    right,
  );
}

function enemiesSection(vm) {
  if (!vm.enemies.length) return null;
  return h(
    'div',
    { class: 'sec hide-compact' },
    label('Équipe adverse'),
    h(
      'div',
      { class: 'enemies' },
      vm.enemies.map((e) =>
        h(
          'div',
          { class: `enemy ${e.fed ? 'fed' : ''} ${e.isOpponent ? 'opp' : ''}` },
          h(
            'div',
            { class: 'pic' },
            icon(e.icon, e.name, 'round'),
            e.fed ? h('span', { class: 'fedtag' }, 'FED') : null,
            e.level ? h('span', { class: 'lvl' }, e.level) : null,
          ),
          h('span', { class: 'kda' }, e.kda),
          h('span', { class: `dmgdot ${e.dmg}` }),
        ),
      ),
    ),
    vm.damage
      ? [
          h('div', { class: 'dmgbar' }, h('span', { class: 'ad', style: { width: `${vm.damage.ad}%` } }), h('span', { class: 'ap', style: { width: `${vm.damage.ap}%` } })),
          h(
            'div',
            { class: 'dmglegend' },
            h('span', null, h('span', { class: 'adt' }, `${vm.damage.ad} %`), ' physiques'),
            h('span', null, h('span', { class: 'apt' }, `${vm.damage.ap} %`), ' magiques'),
          ),
        ]
      : null,
  );
}

function optionsSection(vm) {
  if (!vm.options.length) return null;
  const [first, ...alts] = vm.options;
  return h(
    'div',
    { class: 'sec' },
    label(vm.optionsTitle, 'tes options'),
    h(
      'div',
      { class: 'pick' },
      icon(first.icon, first.name),
      h(
        'div',
        { class: 'pick-body' },
        h('div', { class: 'row' }, h('span', { class: 'iname' }, first.name, first.situational ? h('span', { class: 'situ' }, 'SITUATIONNEL') : null), cost(first.cost)),
        first.reasons.length
          ? h(
              'ul',
              { class: 'why' },
              first.reasons.slice(0, 4).map((r, j) => h('li', { class: `${r.boost ? 'boost' : ''} ${j > 0 ? 'hide-compact' : ''}` }, r.text)),
            )
          : null,
      ),
    ),
    alts.length
      ? h(
          'div',
          { class: 'alts hide-compact' },
          alts.map((o) => {
            const r = o.reasons[0];
            return h(
              'div',
              { class: 'alt' },
              icon(o.icon, o.name),
              h(
                'div',
                { class: 'pick-body' },
                h('div', { class: 'row' }, h('span', { class: 'iname' }, o.name, o.situational ? h('span', { class: 'situ' }, 'SITUATIONNEL') : null), cost(o.cost)),
                r ? h('div', { class: `why1 ${r.boost ? 'boost' : ''}` }, r.text) : null,
              ),
            );
          }),
        )
      : null,
  );
}

function buySection(vm) {
  const p = vm.plan;
  if (!p && !vm.boots) return null;
  return h(
    'div',
    { class: `sec buy ${p && p.state === 'ready' ? 'ready' : ''}` },
    p
      ? [
          h('div', { class: 'buy-head' }, h('span', { class: 't' }, p.state === 'ready' ? `✓ ${p.title}` : p.title), h('span', { class: 'g' }, p.goldText)),
          h('div', { class: 'progress' }, h('span', { style: { width: `${Math.round(p.progress * 100)}%` } })),
          p.buy.length
            ? h(
                'div',
                { class: 'tiles' },
                p.buy.map((b) => h('div', { class: 'tile' }, icon(b.icon, b.name), h('span', { class: 'n' }, b.name), cost(b.cost))),
              )
            : null,
          p.after ? h('div', { class: 'after hide-compact' }, p.after) : null,
        ]
      : null,
    vm.boots
      ? h(
          'div',
          { class: 'bootsrow hide-compact' },
          icon(vm.boots.icon, vm.boots.name),
          h('div', null, h('div', { class: 'k' }, 'Bottes conseillées'), h('div', { class: 'v' }, vm.boots.name), vm.boots.reason ? h('div', { class: 'r' }, vm.boots.reason) : null),
        )
      : null,
  );
}

function alertsSection(vm) {
  if (!vm.alerts.length) return null;
  return h(
    'div',
    { class: 'sec hide-compact' },
    label('À surveiller'),
    vm.alerts.map((a) =>
      h(
        'div',
        { class: `alert ${a.level}` },
        h('span', { class: 'txt' }, a.text),
        a.champs.length ? h('div', { class: 'champs' }, a.champs.map((c) => icon(c.icon, c.name, 'round'))) : null,
      ),
    ),
  );
}

function pathRow(items, extra) {
  return h(
    'div',
    { class: 'path' },
    items.map((c, i) => [
      i ? h('span', { class: 'chev' }, '›') : null,
      h('div', { class: `step ${c.owned ? 'owned' : ''}` }, icon(c.icon, c.name), c.owned ? h('span', { class: 'check' }, '✓') : null),
    ]),
    extra ? [h('span', { class: 'chev' }, '+'), h('div', { class: 'step' }, icon(extra.icon, extra.name))] : null,
  );
}

function skillKeys(order, cls = '') {
  return order.map((k, i) => [i ? h('span', { class: 'chev' }, '›') : null, h('span', { class: `kc ${cls}` }, k)]);
}

function footer(vm, extraSkills) {
  return h(
    'div',
    { class: 'foot hide-compact' },
    vm.skills ? h('div', { class: 'skills' }, h('span', { class: 't' }, 'Max'), skillKeys(vm.skills.order), extraSkills) : h('span'),
    h('div', { class: `sample ${vm.sample.warn ? 'warn' : ''}` }, vm.sample.text),
  );
}

function renderIngame(vm) {
  return [
    header(
      vm.header,
      h('div', { class: 'right' }, h('div', { class: 'goldpill' }, h('span', { class: 'coin' }), vm.header.gold), h('div', { class: 'clock' }, vm.header.clock)),
    ),
    enemiesSection(vm),
    optionsSection(vm),
    buySection(vm),
    alertsSection(vm),
    vm.core.length
      ? h('div', { class: 'sec hide-compact' }, label(vm.coreTitle || 'Build type', vm.coreWr ? `${vm.coreWr} de victoires` : null), pathRow(vm.core))
      : null,
    !vm.options.length && !vm.plan && !vm.core.length
      ? h('div', { class: 'sec empty' }, 'Pas encore de build pour ce champion dans ce mode : la collecte continue en fond.')
      : null,
    footer(vm),
  ];
}

// ------------------------------------------------------------ sélection

function renderChampSelect(vm) {
  const hd = vm.header;
  const right = hd.opponent
    ? h('div', { class: 'versus' }, h('span', { class: 'vs' }, 'VS'), icon(hd.opponentIcon, hd.opponent))
    : null;
  const out = [header({ ...hd, opponent: null, phase: null }, right)];
  if (vm.matchupNote) out.push(h('div', { class: 'note' }, vm.matchupNote));
  if (vm.enemies.length) {
    out.push(
      h(
        'div',
        { class: 'sec hide-compact' },
        label('Face à toi'),
        h('div', { class: 'picks' }, vm.enemies.map((c) => h('span', { class: c.isOpponent ? 'opp' : '' }, icon(c.icon, c.name, 'round')))),
      ),
    );
  }
  if (vm.page) {
    const p = vm.page;
    out.push(
      h(
        'div',
        { class: 'sec' },
        label('Runes', `${p.share} des parties${p.wr ? ` · ${p.wr} V` : ''}`),
        h(
          'div',
          { class: 'keystone' },
          icon(p.keystone.icon, p.keystone.name, 'round'),
          h(
            'div',
            null,
            h('div', { class: 'ks-name' }, p.keystone.name),
            h('div', { class: 'tree' }, p.primary ? [icon(p.primary.icon, p.primary.name), p.primary.name] : null, p.secondary ? [' + ', icon(p.secondary.icon, p.secondary.name), p.secondary.name] : null),
          ),
        ),
        h(
          'div',
          { class: 'runes' },
          p.primaryRunes.map((r) => icon(r.icon, r.name, 'round')),
          h('span', { class: 'sep' }),
          p.secondaryRunes.map((r) => icon(r.icon, r.name, 'round')),
          h('span', { class: 'sep' }),
          p.shards.map((s) => h('span', { class: 'shard' }, icon(s.icon, s.name, 'round'))),
        ),
        h(
          'div',
          { class: 'rnames hide-compact' },
          h('b', null, p.primaryRunes.map((r) => r.name).join(' · ')),
          h('br'),
          p.secondaryRunes.map((r) => r.name).join(' · '),
          h('br'),
          `Fragments : ${p.shards.map((s) => s.name).join(' · ')}`,
          vm.altKeystones.length ? [h('br'), `Autres choix : ${vm.altKeystones.map((k) => `${k.name} (${k.share})`).join(', ')}`] : null,
        ),
      ),
    );
  }
  const spells = vm.spells
    ? h('div', null, label('Sorts', vm.spells.share), h('div', { class: 'icons' }, vm.spells.list.map((s) => icon(s.icon, s.name))))
    : h('div');
  const start = vm.start
    ? h(
        'div',
        null,
        label('Départ'),
        h('div', { class: 'icons' }, vm.start.map((it) => [icon(it.icon, it.name), it.count > 1 ? h('span', { class: 'count' }, `×${it.count}`) : null])),
      )
    : h('div');
  if (vm.spells || vm.start) out.push(h('div', { class: 'sec grid2' }, spells, start));
  if (vm.core.length) out.push(h('div', { class: 'sec hide-compact' }, label(vm.coreTitle || 'Build type'), pathRow(vm.core, vm.boots)));
  const first = vm.skills && vm.skills.first.length ? [h('span', { class: 't', style: { marginLeft: '8px' } }, 'Début'), vm.skills.first.map((k) => h('span', { class: 'kc small' }, k))] : null;
  out.push(footer(vm, first));
  if (vm.runes) {
    // runes automatiques : état + raccourci pour (ré)appliquer à la main
    out.push(
      h(
        'div',
        { class: `hint runes ${vm.runes.state}` },
        h('span', { class: 'dot' }),
        h('span', { class: 'txt' }, vm.runes.text),
        vm.hint ? h('span', { class: 'again' }, h('kbd', null, vm.hint.key), vm.runes.state === 'applied' ? 'réappliquer' : 'appliquer') : null,
      ),
    );
  } else if (vm.hint) out.push(h('div', { class: 'hint' }, h('kbd', null, vm.hint.key), h('span', { class: 'txt' }, vm.hint.text)));
  if (vm.roleHint) out.push(h('div', { class: 'hint role-hint hide-compact' }, h('kbd', null, vm.roleHint.key), h('span', { class: 'txt' }, vm.roleHint.text)));
  return out;
}

function renderMessage(vm) {
  return [h('div', { class: 'msg' }, h('div', { class: 'msg-title' }, vm.title), h('div', { class: 'msg-text' }, vm.text))];
}

// ------------------------------------------------------------ cycle de vie

function render() {
  if (!lastVm) return;
  const vm = lastVm;
  const nodes = vm.mode === 'ingame' ? renderIngame(vm) : vm.mode === 'champselect' ? renderChampSelect(vm) : renderMessage(vm);
  appEl.replaceChildren(...nodes.flat().filter(Boolean));
}

function reportHeight() {
  if (window.coach) window.coach.send('overlay:height', Math.ceil(root.getBoundingClientRect().height));
}

function showToast({ text, level }) {
  const t = $('#toast');
  t.textContent = text;
  t.className = level || 'info';
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 4500);
}

function applySettings(s) {
  document.documentElement.style.setProperty('--opacity', String(s.opacity ?? 0.95));
  document.body.classList.toggle('compact', !!s.compact);
  document.documentElement.dataset.accent = s.accent || 'cyan';
  document.body.classList.toggle('move', !!s.moveMode);
  const banner = $('#move-banner');
  banner.hidden = !s.moveMode;
  banner.textContent = s.moveMode ? `Déplacement : glisse le panneau, puis ${s.keys.move} pour valider` : '';
}

if (new URLSearchParams(location.search).has('preview')) document.body.classList.add('preview');

new ResizeObserver(reportHeight).observe(root);

if (window.coach) {
  window.coach.on('overlay:update', (vm) => {
    lastVm = vm;
    render();
  });
  window.coach.on('overlay:settings', applySettings);
  window.coach.on('overlay:toast', showToast);
}
