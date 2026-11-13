'use strict';

/**
 * Mode d'affichage du jeu (Plein écran / Fenêtré / Sans bordure) et optimisations plein écran de Windows.
 *
 * L'overlay est une fenêtre Windows "toujours au premier plan" : il ne s'injecte jamais dans le jeu
 * (interdit par Vanguard). Il s'affiche donc :
 *  - en Sans bordure : toujours ;
 *  - en Plein écran : grâce aux "optimisations plein écran" de Windows 10/11, qui font composer le jeu
 *    par le bureau (comme la Game Bar). Si elles sont désactivées pour LoL, le plein écran devient
 *    exclusif et aucune fenêtre ne peut passer devant : BuildSense le détecte et propose de corriger.
 *
 * Fichiers lus : <dossier LoL>/Config/game.cfg et PersistedSettings.json (le client réécrit game.cfg
 * à partir de ce dernier au lancement d'une partie : les deux sont mis à jour ensemble).
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const MODES = { 0: 'fullscreen', 1: 'windowed', 2: 'borderless' };
const LAYERS_KEY = 'HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers';
const FSO_FLAG = 'DISABLEDXMAXIMIZEDWINDOWEDMODE';

function cfgPaths(leaguePath) {
  const dir = path.join(leaguePath || '', 'Config');
  return { dir, gameCfg: path.join(dir, 'game.cfg'), persisted: path.join(dir, 'PersistedSettings.json') };
}

/** WindowMode de la section [General] d'un game.cfg (texte) : 0, 1, 2 ou null. */
function parseWindowMode(text) {
  let section = '';
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    const sec = /^\[(.+)\]$/.exec(line);
    if (sec) {
      section = sec[1].toLowerCase();
      continue;
    }
    const m = /^WindowMode\s*=\s*(\d)/i.exec(line);
    if (m && section === 'general') return Number(m[1]);
  }
  return null;
}

/** Remplace (ou ajoute) WindowMode dans [General]. */
function withWindowMode(text, mode) {
  const lines = String(text || '').split(/\r?\n/);
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  let section = '';
  let generalAt = -1;
  let done = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const sec = /^\[(.+)\]$/.exec(line);
    if (sec) {
      section = sec[1].toLowerCase();
      if (section === 'general') generalAt = i;
      continue;
    }
    if (section === 'general' && /^WindowMode\s*=/i.test(line)) {
      lines[i] = `WindowMode=${mode}`;
      done = true;
    }
  }
  if (!done) {
    if (generalAt >= 0) lines.splice(generalAt + 1, 0, `WindowMode=${mode}`);
    else lines.unshift('[General]', `WindowMode=${mode}`);
  }
  return lines.join(eol);
}

/** WindowMode dans PersistedSettings.json (objet), modifié sur place ; renvoie true si trouvé. */
function patchPersisted(json, mode) {
  let found = false;
  for (const f of (json && json.files) || []) {
    if (String(f.name).toLowerCase() !== 'game.cfg') continue;
    for (const s of f.sections || []) {
      if (String(s.name).toLowerCase() !== 'general') continue;
      for (const st of s.settings || []) {
        if (st.name === 'WindowMode') {
          st.value = String(mode);
          found = true;
        }
      }
      if (!found) {
        s.settings = s.settings || [];
        s.settings.push({ name: 'WindowMode', value: String(mode) });
        found = true;
      }
    }
  }
  return found;
}

function readWindowMode(leaguePath) {
  const { gameCfg, persisted } = cfgPaths(leaguePath);
  try {
    const j = JSON.parse(fs.readFileSync(persisted, 'utf8'));
    for (const f of j.files || []) {
      if (String(f.name).toLowerCase() !== 'game.cfg') continue;
      for (const s of f.sections || []) {
        if (String(s.name).toLowerCase() !== 'general') continue;
        const st = (s.settings || []).find((x) => x.name === 'WindowMode');
        if (st && /^\d$/.test(String(st.value))) return Number(st.value);
      }
    }
  } catch {
    /* pas de fichier synchronisé */
  }
  try {
    return parseWindowMode(fs.readFileSync(gameCfg, 'utf8'));
  } catch {
    return null;
  }
}

/** Passe le jeu en Sans bordure (pris en compte au prochain lancement d'une partie). */
function setWindowMode(leaguePath, mode = 2) {
  const { gameCfg, persisted } = cfgPaths(leaguePath);
  let touched = 0;
  try {
    const text = fs.readFileSync(gameCfg, 'utf8');
    if (!fs.existsSync(`${gameCfg}.buildsense.bak`)) fs.writeFileSync(`${gameCfg}.buildsense.bak`, text);
    fs.writeFileSync(gameCfg, withWindowMode(text, mode));
    touched++;
  } catch {
    /* pas de game.cfg (jamais lancé) */
  }
  try {
    const raw = fs.readFileSync(persisted, 'utf8');
    const j = JSON.parse(raw);
    if (patchPersisted(j, mode)) {
      if (!fs.existsSync(`${persisted}.buildsense.bak`)) fs.writeFileSync(`${persisted}.buildsense.bak`, raw);
      fs.writeFileSync(persisted, JSON.stringify(j, null, 4));
      touched++;
    }
  } catch {
    /* facultatif */
  }
  return touched > 0;
}

function reg(args) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve({ ok: false, out: '' });
    execFile('reg', args, { windowsHide: true, timeout: 5000 }, (err, stdout) => resolve({ ok: !err, out: String(stdout || '') }));
  });
}

/** Entrées de compatibilité Windows qui désactivent les optimisations plein écran pour LoL. */
async function fsoBlockers() {
  const r = await reg(['query', LAYERS_KEY]);
  if (!r.ok) return [];
  const out = [];
  for (const line of r.out.split(/\r?\n/)) {
    const m = /^\s*(.+?\.exe)\s+REG_SZ\s+(.*)$/i.exec(line);
    if (!m) continue;
    const exe = m[1];
    if (!/league of legends\.exe$/i.test(exe)) continue;
    if (m[2].toUpperCase().includes(FSO_FLAG)) out.push({ exe, value: m[2].trim() });
  }
  return out;
}

/** Réactive les optimisations plein écran (retire seulement le drapeau concerné). */
async function fixFso() {
  const list = await fsoBlockers();
  let fixed = 0;
  for (const { exe, value } of list) {
    const rest = value
      .split(/\s+/)
      .filter((t) => t && t.toUpperCase() !== FSO_FLAG);
    const meaningful = rest.filter((t) => t !== '~');
    const r = meaningful.length
      ? await reg(['add', LAYERS_KEY, '/v', exe, '/t', 'REG_SZ', '/d', rest.join(' '), '/f'])
      : await reg(['delete', LAYERS_KEY, '/v', exe, '/f']);
    if (r.ok) fixed++;
  }
  return { found: list.length, fixed };
}

/** État complet pour l'appli. */
async function displayInfo(leaguePath) {
  const code = readWindowMode(leaguePath);
  const blockers = await fsoBlockers();
  return { windowMode: code === null ? null : MODES[code] || null, fsoDisabled: blockers.length > 0 };
}

module.exports = { parseWindowMode, withWindowMode, patchPersisted, readWindowMode, setWindowMode, fsoBlockers, fixFso, displayInfo, MODES };

/** Dossier de LoL : celui des réglages s'il existe, sinon celui déclaré par le Riot Client. */
function detectLeaguePath(current) {
  const ok = (p) => {
    try {
      return !!p && (fs.existsSync(path.join(p, 'LeagueClient.exe')) || fs.existsSync(path.join(p, 'Config')));
    } catch {
      return false;
    }
  };
  if (ok(current)) return current;
  const candidates = [];
  try {
    const base = process.env.ProgramData || 'C:\\ProgramData';
    const j = JSON.parse(fs.readFileSync(path.join(base, 'Riot Games', 'RiotClientInstalls.json'), 'utf8'));
    for (const k of Object.keys(j.associated_client || {})) if (/league of legends/i.test(k)) candidates.push(path.normalize(k.replace(/[\\/]+$/, '')));
  } catch {
    /* Riot Client absent */
  }
  for (const d of ['C', 'D', 'E', 'F', 'G']) candidates.push(`${d}:\\Riot Games\\League of Legends`);
  return candidates.find(ok) || current;
}

module.exports.detectLeaguePath = detectLeaguePath;
