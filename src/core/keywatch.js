'use strict';

/**
 * Raccourcis qui marchent aussi quand le jeu est au premier plan.
 *
 * League of Legends bloque les raccourcis globaux de Windows (RegisterHotKey, utilisé par Electron)
 * tant que la fenêtre du jeu a le focus. Le petit programme native/keywatch.exe lit seulement l'état
 * des touches (GetAsyncKeyState) et signale les combinaisons de BuildSense. Aucun hook, aucune
 * injection, rien n'est envoyé au jeu.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const NAMED = {
  Up: 38, Down: 40, Left: 37, Right: 39, Space: 32, Tab: 9, Home: 36, End: 35, PageUp: 33, PageDown: 34, Insert: 45, Delete: 46,
  numadd: 107, numsub: 109, nummult: 106, numdiv: 111, numdec: 110,
};

/** "CommandOrControl+Shift+H" -> { ctrl, shift, alt, win, vk } (null si non pris en charge). */
function comboOf(accel) {
  if (!accel) return null;
  const parts = String(accel).split('+');
  const key = parts.pop();
  const c = { ctrl: false, shift: false, alt: false, win: false, vk: 0 };
  for (const m of parts) {
    if (m === 'CommandOrControl' || m === 'Control' || m === 'Ctrl') c.ctrl = true;
    else if (m === 'Shift') c.shift = true;
    else if (m === 'Alt') c.alt = true;
    else if (m === 'Super' || m === 'Meta') c.win = true;
    else return null;
  }
  let m;
  if (/^[A-Z0-9]$/.test(key)) c.vk = key.charCodeAt(0);
  else if ((m = /^F([1-9]|1\d|2[0-4])$/.exec(key))) c.vk = 111 + Number(m[1]);
  else if ((m = /^num([0-9])$/.exec(key))) c.vk = 96 + Number(m[1]);
  else if (NAMED[key]) c.vk = NAMED[key];
  else return null;
  return c;
}

class KeyWatch {
  /** exe : chemin de keywatch.exe ; onKey(name) appelé à chaque appui. */
  constructor({ exe, onKey }) {
    this.exe = exe;
    this.onKey = onKey;
    this.child = null;
    this.lines = '';
    this.combos = '';
    this.stopped = false;
    this.restarts = 0;
  }

  available() {
    return process.platform === 'win32' && !!this.exe && fs.existsSync(this.exe);
  }

  start() {
    if (!this.available() || this.child) return false;
    this.stopped = false;
    const child = spawn(this.exe, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    this.child = child;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      this.lines += chunk;
      const parts = this.lines.split(/\r?\n/);
      this.lines = parts.pop();
      for (const name of parts) if (name.trim()) this.onKey(name.trim());
    });
    child.stdin.on('error', () => {});
    child.on('exit', () => {
      if (this.child === child) this.child = null;
      // arrêt inattendu : on relance (au plus 5 fois)
      if (!this.stopped && this.restarts++ < 5) setTimeout(() => this.start(), 2000);
    });
    child.on('error', () => {});
    if (this.combos) this.write(this.combos);
    return true;
  }

  write(text) {
    try {
      if (this.child && this.child.stdin.writable) this.child.stdin.write(text);
    } catch {
      /* programme arrêté */
    }
  }

  /** hotkeys : { nom: accélérateur } ; {} pour suspendre. */
  setHotkeys(hotkeys) {
    const lines = [];
    for (const [name, accel] of Object.entries(hotkeys || {})) {
      const c = comboOf(accel);
      if (c) lines.push(`${name} ${+c.ctrl} ${+c.shift} ${+c.alt} ${+c.win} ${c.vk}`);
    }
    this.combos = `${lines.join('\n')}${lines.length ? '\n' : ''}END\n`;
    this.write(this.combos);
  }

  stop() {
    this.stopped = true;
    if (this.child) {
      try {
        this.child.kill();
      } catch {
        /* déjà arrêté */
      }
      this.child = null;
    }
  }
}

module.exports = { KeyWatch, comboOf };
