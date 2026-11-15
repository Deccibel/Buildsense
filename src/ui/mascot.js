'use strict';

/*
 * Mascotte de Stonks (voir mascot.css).
 *
 *   const m = StonksMascot.create({ size: 44 });
 *   parent.append(m.el);
 *   m.setMood('focus');          humeur de fond : idle | happy | sleepy | focus | worried | surprised
 *   m.react('happy', 1800);      humeur passagère, puis retour à l'humeur de fond
 *   m.play('hop');               geste : hop | wiggle | roll | pop | nod | shake
 *   m.setAlive(false);           fenêtre inactive ou partie en cours : elle reste calme (clignements seulement)
 *
 * Au repos, elle s'occupe toute seule : clignements, coups d'œil, petits sauts, et elle s'endort
 * quand rien ne bouge. Elle suit le curseur du regard.
 */

(function () {
  const SVG = 'http://www.w3.org/2000/svg';
  const MOODS = ['happy', 'sleepy', 'focus', 'worried', 'surprised'];
  const MOVES = ['hop', 'wiggle', 'roll', 'pop', 'nod', 'shake'];
  const rand = (a, b) => a + Math.random() * (b - a);
  const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /*
   * Accessoires (désactivés par défaut), dessinés dans le même repère 100×100 que les yeux.
   * « face » : bougent avec le regard (lunettes) ; « body » : suivent la bille (chapeau, nœud, cravate).
   */
  const ACCESSORIES = {
    glasses: {
      layer: 'face',
      svg: '<g class="a-frame"><circle cx="37" cy="50" r="12.5"/><circle cx="63" cy="50" r="12.5"/><path d="M49.5 48 Q50 45.5 50.5 48"/><path d="M24.5 49 L13 45.5"/><path d="M75.5 49 L87 45.5"/></g>',
    },
    readers: {
      layer: 'face',
      svg: '<g class="a-frame"><path d="M24 52 H50 A13 13 0 0 1 24 52 Z"/><path d="M50 52 H76 A13 13 0 0 1 50 52 Z"/><path d="M24 52 L13 47"/><path d="M76 52 L87 47"/></g>',
    },
    bowtie: {
      layer: 'body',
      svg: '<g class="a-bow"><path d="M50 85 L37 78 Q34 85 37 92 Z"/><path d="M50 85 L63 78 Q66 85 63 92 Z"/><rect x="46.3" y="81.3" width="7.4" height="7.4" rx="2.4"/></g>',
    },
    tie: {
      layer: 'body',
      svg: '<g class="a-tie"><path d="M44.5 72 H55.5 L53 79 H47 Z"/><path d="M47 79 H53 L57.5 99 L50 106 L42.5 99 Z"/><path class="a-stripe" d="M48 85 L55 92 M46.5 92 L56 101"/></g>',
    },
    cap: {
      layer: 'body',
      svg: '<g class="a-cap"><path d="M31 9 V18 Q50 27 69 18 V9 Z"/><path class="a-board" d="M50 -7 L87 6 L50 19 L13 6 Z"/><path class="a-tassel" d="M50 6 L80 11 V25"/><circle class="a-tassel-end" cx="80" cy="27" r="3.2"/></g>',
    },
  };

  function accessoryLayer(names, layer) {
    const parts = names.map((n) => ACCESSORIES[n]).filter((a) => a && a.layer === layer);
    if (!parts.length) return null;
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('class', `m-acc m-acc-${layer}`);
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('aria-hidden', 'true');
    // dessins fixes, écrits ici (aucune donnée extérieure)
    svg.innerHTML = parts.map((a) => a.svg).join('');
    return svg;
  }

  function build(size, accessories = []) {
    const el = document.createElement('div');
    el.className = 'mascot';
    el.style.setProperty('--ms', `${size}px`);
    if (size <= 24) el.classList.add('is-small');
    const ball = document.createElement('div');
    ball.className = 'm-ball';
    const body = document.createElement('div');
    body.className = 'm-body';
    for (const cls of ['m-swirl', 'm-bloom', 'm-shade', 'm-gloss']) {
      const i = document.createElement('i');
      i.className = cls;
      body.append(i);
    }
    const look = document.createElement('div');
    look.className = 'm-look';
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('class', 'm-eyes');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('aria-hidden', 'true');
    for (const side of ['l', 'r']) {
      const p = document.createElementNS(SVG, 'path');
      p.setAttribute('class', `m-eye ${side}`);
      svg.append(p);
    }
    look.append(svg);
    const face = accessoryLayer(accessories, 'face');
    if (face) look.append(face);
    ball.append(body, look);
    const worn = accessoryLayer(accessories, 'body');
    if (worn) ball.append(worn);
    el.append(ball);
    return el;
  }

  /**
   * @param {{ size?: number, idle?: boolean, track?: boolean, clickable?: boolean, sleepAfter?: number }} opts
   *   idle : gestes spontanés ; track : suit le curseur ; sleepAfter : secondes sans activité avant de s'endormir (0 = jamais)
   */
  function create({ size = 44, idle = true, track = true, clickable = false, sleepAfter = 150, accessories = [] } = {}) {
    const el = build(size, accessories);
    let base = 'idle';
    let temp = null;
    let tempTimer = null;
    let idleTimer = null;
    let lookTimer = null;
    let alive = true;
    let asleep = false;
    let lastActivity = Date.now();
    let raf = 0;
    let pointer = null;
    let destroyed = false;

    const applyMood = () => {
      const mood = temp || (asleep ? 'sleepy' : base);
      for (const m of MOODS) el.classList.toggle(`is-${m}`, m === mood);
    };

    const look = (x, y) => {
      el.style.setProperty('--lx', x.toFixed(3));
      el.style.setProperty('--ly', y.toFixed(3));
    };

    const once = (cls, ms) => {
      el.classList.remove(cls);
      // relance l'animation même si elle venait de jouer
      void el.offsetWidth;
      el.classList.add(cls);
      setTimeout(() => el.classList.remove(cls), ms);
    };

    const blink = () => once('do-blink', 260);

    const play = (move) => {
      if (!MOVES.includes(move) || reduced()) return;
      for (const m of MOVES) el.classList.remove(`do-${m}`);
      once(`do-${move}`, 950);
    };

    const glance = () => {
      const a = rand(0, Math.PI * 2);
      look(Math.cos(a) * 0.9, Math.sin(a) * 0.6);
      clearTimeout(lookTimer);
      lookTimer = setTimeout(() => !pointer && look(0, 0), rand(700, 1500));
    };

    // « stonks » : un regard vers le haut à droite, comme une courbe qui monte
    const lookUp = () => {
      look(0.8, -0.9);
      play('pop');
      clearTimeout(lookTimer);
      lookTimer = setTimeout(() => !pointer && look(0, 0), 1100);
    };

    const wake = () => {
      lastActivity = Date.now();
      if (!asleep) return;
      asleep = false;
      applyMood();
      play('pop');
      setTimeout(blink, 220);
    };

    const tick = () => {
      if (destroyed) return;
      const quiet = !alive || reduced() || temp || base === 'focus';
      if (!document.hidden) {
        if (alive && !asleep && sleepAfter && base === 'idle' && Date.now() - lastActivity > sleepAfter * 1000) {
          asleep = true;
          look(0, 0.3);
          applyMood();
        } else if (asleep) {
          /* elle dort : rien */
        } else if (quiet) blink();
        else {
          const r = Math.random();
          if (r < 0.46) blink();
          else if (r < 0.58) {
            blink();
            setTimeout(blink, 330);
          } else if (r < 0.78) glance();
          else if (r < 0.86) play('hop');
          else if (r < 0.92) play('wiggle');
          else if (r < 0.97) lookUp();
          else play('roll');
        }
      }
      idleTimer = setTimeout(tick, alive && !asleep ? rand(2600, 6200) : rand(6000, 11000));
    };

    const onMove = (e) => {
      pointer = { x: e.clientX, y: e.clientY };
      wake();
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (!pointer || temp === 'happy') return;
        const r = el.getBoundingClientRect();
        const dx = pointer.x - (r.left + r.width / 2);
        const dy = pointer.y - (r.top + r.height / 2);
        const d = Math.hypot(dx, dy) || 1;
        const k = Math.min(1, d / 240);
        look((dx / d) * k, (dy / d) * k);
      });
    };
    const onLeave = () => {
      pointer = null;
      look(0, 0);
    };

    if (track) {
      window.addEventListener('pointermove', onMove, { passive: true });
      document.addEventListener('pointerleave', onLeave);
    }
    if (clickable) {
      el.classList.add('clickable');
      el.addEventListener('click', () => {
        wake();
        const moves = ['hop', 'roll', 'wiggle'];
        play(moves[Math.floor(Math.random() * moves.length)]);
        api.react('happy', 1400);
      });
    }
    if (idle) idleTimer = setTimeout(tick, rand(1200, 2600));

    const api = {
      el,
      /** Humeur de fond. */
      setMood(mood) {
        const next = MOODS.includes(mood) ? mood : 'idle';
        if (next === base) return;
        base = next;
        if (next !== 'idle') {
          asleep = false;
          lastActivity = Date.now();
        }
        applyMood();
      },
      /** Humeur passagère. */
      react(mood, ms = 1800, move = null) {
        if (!MOODS.includes(mood)) return;
        asleep = false;
        lastActivity = Date.now();
        temp = mood;
        applyMood();
        if (move) play(move);
        clearTimeout(tempTimer);
        tempTimer = setTimeout(() => {
          temp = null;
          applyMood();
        }, ms);
      },
      play,
      blink,
      look,
      /** Animations continues (respiration) et gestes spontanés : seulement quand l'appli est au premier plan. */
      setAlive(on) {
        alive = !!on;
        el.classList.toggle('alive', alive && !reduced());
        if (alive) lastActivity = Date.now();
      },
      destroy() {
        destroyed = true;
        clearTimeout(idleTimer);
        clearTimeout(tempTimer);
        clearTimeout(lookTimer);
        window.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerleave', onLeave);
      },
    };
    api.setAlive(true);
    return api;
  }

  window.StonksMascot = { create, MOODS, MOVES, ACCESSORIES: Object.keys(ACCESSORIES) };
})();
