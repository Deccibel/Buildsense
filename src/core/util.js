'use strict';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** "16.21.712.4398" -> "16.21" */
function patchKey(version) {
  const [a, b] = String(version || '').split('.');
  if (!a || !b || Number.isNaN(Number(a)) || Number.isNaN(Number(b))) return null;
  return `${parseInt(a, 10)}.${parseInt(b, 10)}`;
}

function comparePatch(x, y) {
  const [a1, b1] = String(x).split('.').map(Number);
  const [a2, b2] = String(y).split('.').map(Number);
  return (a1 - a2) || (b1 - b2);
}

/** Compare full versions like "16.21.1" numerically. */
function compareVersion(x, y) {
  const a = String(x).split('.').map((n) => parseInt(n, 10) || 0);
  const b = String(y).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return d;
  }
  return 0;
}

/** Lowercase, no accents, alphanumerics only — for name matching. */
function norm(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function countBy(arr, fn) {
  const m = new Map();
  for (const x of arr) {
    const k = fn(x);
    if (k === undefined || k === null || k === '') continue;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

function argmax(map) {
  let best = null;
  let bestV = -Infinity;
  for (const [k, v] of map) {
    if (v > bestV) {
      best = k;
      bestV = v;
    }
  }
  return best;
}

function fmtGold(n) {
  return Math.round(n || 0).toLocaleString('fr-FR');
}

function pct(v) {
  return `${Math.round((v || 0) * 100)} %`;
}

function fmtClock(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "A, B et C" */
function listFr(names, max = 3) {
  const uniq = [...new Set(names)].slice(0, max);
  if (uniq.length <= 1) return uniq.join('');
  return `${uniq.slice(0, -1).join(', ')} et ${uniq[uniq.length - 1]}`;
}

/** Deterministic PRNG (tests, shuffles). */
function lcg(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function shuffle(arr, rnd = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const ROLE_LABELS = {
  TOP: 'Top',
  JUNGLE: 'Jungle',
  MIDDLE: 'Mid',
  BOTTOM: 'ADC',
  UTILITY: 'Support',
};

module.exports = {
  sleep,
  clamp,
  patchKey,
  comparePatch,
  compareVersion,
  norm,
  countBy,
  argmax,
  fmtGold,
  pct,
  fmtClock,
  listFr,
  lcg,
  shuffle,
  ROLE_LABELS,
};
