'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFile } = require('child_process');
const { agent } = require('./liveClient');

const ROLE_MAP = { top: 'TOP', jungle: 'JUNGLE', middle: 'MIDDLE', bottom: 'BOTTOM', utility: 'UTILITY' };
const PAGE_PREFIX = 'BuildSense';
const SHORT_PREFIX = 'BS';
const PAGE_NAME_MAX = 25; // longueur maximale d'un nom de page dans le client

/**
 * Nom de page lisible dans la limite du client : "BuildSense · Ahri Mid", sinon "BS · Nunu et Willump Support",
 * sinon le nom du champion est raccourci pour garder le poste ("BS · Nunu et Will… Support").
 */
function pageName(champion, role = '') {
  const label = `${champion}${role ? ` ${role}` : ''}`.trim();
  for (const prefix of [PAGE_PREFIX, SHORT_PREFIX]) {
    const full = `${prefix} · ${label}`;
    if (full.length <= PAGE_NAME_MAX) return full;
  }
  const room = PAGE_NAME_MAX - `${SHORT_PREFIX} · `.length - (role ? role.length + 2 : 1);
  return `${SHORT_PREFIX} · ${champion.slice(0, Math.max(1, room)).trim()}…${role ? ` ${role}` : ''}`;
}

const isOurPage = (p) => typeof p.name === 'string' && (p.name.startsWith(PAGE_PREFIX) || p.name.startsWith(`${SHORT_PREFIX} · `));

/**
 * Client du League Client (LCU) : sert uniquement à lire la sélection des champions
 * (ton champion, ton rôle, les champions adverses révélés) et à appliquer
 * la page de runes recommandée (automatiquement ou sur ton raccourci). Aucune recherche de joueurs.
 */
class LcuClient {
  constructor({ getLeaguePath }) {
    this.getLeaguePath = getLeaguePath;
    this.creds = null;
    this.lastScan = 0;
  }

  readLockfile() {
    try {
      const txt = fs.readFileSync(path.join(this.getLeaguePath(), 'lockfile'), 'utf8');
      const [, , port, password, protocol] = txt.trim().split(':');
      if (port && password && (protocol || 'https') === 'https') return { port: Number(port), password };
    } catch {
      /* client fermé ou autre dossier d'installation */
    }
    return null;
  }

  scanProcess() {
    return new Promise((resolve) => {
      const parse = (out) => {
        const port = /--app-port=(\d+)/.exec(out || '');
        const token = /--remoting-auth-token=([\w-]+)/.exec(out || '');
        resolve(port && token ? { port: Number(port[1]), password: token[1] } : null);
      };
      if (process.platform === 'win32') {
        execFile(
          'powershell.exe',
          [
            '-NoProfile',
            '-Command',
            "Get-CimInstance Win32_Process -Filter \"name='LeagueClientUx.exe'\" | Select-Object -ExpandProperty CommandLine",
          ],
          { windowsHide: true, timeout: 5000 },
          (err, out) => parse(err ? '' : out),
        );
      } else {
        execFile('ps', ['-A', '-o', 'args'], { timeout: 4000 }, (err, out) => {
          const line = (out || '').split('\n').find((l) => l.includes('LeagueClientUx'));
          parse(err ? '' : line);
        });
      }
    });
  }

  async credentials() {
    if (this.creds) return this.creds;
    const lock = this.readLockfile();
    if (lock) return (this.creds = lock);
    // repli : lire les arguments du processus (au plus toutes les 15 s)
    if (Date.now() - this.lastScan < 15000) return null;
    this.lastScan = Date.now();
    this.creds = await this.scanProcess();
    return this.creds;
  }

  async request(method, urlPath, body) {
    const c = await this.credentials();
    if (!c) return { ok: false, status: 0, data: null };
    const payload = body === undefined ? null : JSON.stringify(body);
    return new Promise((resolve) => {
      const req = https.request(
        {
          host: '127.0.0.1',
          port: c.port,
          path: urlPath,
          method,
          agent,
          timeout: 3000,
          headers: {
            Authorization: `Basic ${Buffer.from(`riot:${c.password}`).toString('base64')}`,
            Accept: 'application/json',
            ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          },
        },
        (res) => {
          let txt = '';
          res.setEncoding('utf8');
          res.on('data', (d) => (txt += d));
          res.on('end', () => {
            let data = null;
            try {
              data = txt ? JSON.parse(txt) : null;
            } catch {
              data = txt;
            }
            resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data });
          });
        },
      );
      req.on('timeout', () => req.destroy());
      req.on('error', () => {
        this.creds = null; // client fermé ou redémarré
        resolve({ ok: false, status: 0, data: null });
      });
      if (payload) req.write(payload);
      req.end();
    });
  }

  async phase() {
    const r = await this.request('GET', '/lol-gameflow/v1/gameflow-phase');
    return r.ok ? r.data : null;
  }

  async session() {
    const r = await this.request('GET', '/lol-champ-select/v1/session');
    return r.ok ? r.data : null;
  }

  /** File d'attente en cours (mode de jeu) : { id, mapId, gameMode } ou null. */
  async queue() {
    const r = await this.request('GET', '/lol-gameflow/v1/session');
    const q = r.ok && r.data && r.data.gameData && r.data.gameData.queue;
    if (!q) return null;
    return { id: Number(q.id) || 0, mapId: Number(q.mapId) || 0, gameMode: q.gameMode || '' };
  }

  /** Langue du client LoL ("fr_FR", "en_US"...) ou null. */
  async locale() {
    const r = await this.request('GET', '/riotclient/region-locale');
    return r.ok && r.data && r.data.locale ? String(r.data.locale) : null;
  }

  /**
   * Page d'objets dans la boutique du jeu (onglet "Recommandés" : liste déroulante des pages d'objets).
   * Une seule page BuildSense par champion ; les pages créées par le joueur ne sont jamais touchées.
   * @param {{ title: string, champKey: number, map: number, blocks: { type: string, items: { id: number, count: number }[] }[] }} set
   */
  async writeItemSet(set) {
    const me = await this.request('GET', '/lol-summoner/v1/current-summoner');
    if (!me.ok || !me.data || !me.data.summonerId) return { ok: false, message: 'Client LoL introuvable.' };
    const path = `/lol-item-sets/v1/item-sets/${me.data.summonerId}/sets`;
    const cur = await this.request('GET', path);
    if (!cur.ok) return { ok: false, message: 'Pages d’objets illisibles.' };
    const data = cur.data && typeof cur.data === 'object' ? cur.data : {};
    const others = (Array.isArray(data.itemSets) ? data.itemSets : []).filter((s) => !String(s.uid || '').startsWith('buildsense-'));
    const ours = {
      uid: `buildsense-${set.champKey}`,
      title: set.title.slice(0, 75),
      type: 'custom',
      map: 'any',
      mode: 'any',
      priority: true,
      sortrank: 0,
      startedFrom: 'blank',
      associatedChampions: [set.champKey],
      associatedMaps: set.map ? [set.map] : [],
      preferredItemSlots: [],
      blocks: set.blocks.map((b) => ({ type: b.type, hideIfSummonerSpell: '', showIfSummonerSpell: '', items: b.items.map((i) => ({ id: String(i.id), count: i.count || 1 })) })),
    };
    const body = { accountId: data.accountId || me.data.accountId, itemSets: [ours, ...others], timestamp: Date.now() };
    const put = await this.request('PUT', path, body);
    return put.ok ? { ok: true } : { ok: false, message: `Page d’objets refusée par le client (${put.status}).` };
  }

  /** Page de runes active (null si le client ne répond pas). */
  async currentPage() {
    const res = await this.request('GET', '/lol-perks/v1/currentpage');
    return res.ok && res.data && res.data.id ? res.data : null;
  }

  /**
   * Applique une page de runes en REMPLAÇANT la page active (si elle est modifiable),
   * sinon une page BuildSense existante, sinon une nouvelle page.
   * Aucune page n'est jamais supprimée en plus de celle qu'on remplace.
   * @param {{ primaryStyleId:number, subStyleId:number, selectedPerkIds:number[] }} page
   */
  async importRunes(page, name, role = '') {
    const pagesRes = await this.request('GET', '/lol-perks/v1/pages');
    if (!pagesRes.ok) return { ok: false, message: 'Client LoL introuvable.' };
    const pages = Array.isArray(pagesRes.data) ? pagesRes.data : [];
    const body = {
      name: pageName(name, role),
      primaryStyleId: page.primaryStyleId,
      subStyleId: page.subStyleId,
      selectedPerkIds: page.selectedPerkIds,
      current: true,
    };
    const current = pages.find((p) => p.current) || (await this.currentPage());
    const ours = pages.find((p) => p.isEditable !== false && isOurPage(p));
    const target = current && current.isEditable ? current : ours;

    if (target) {
      const put = await this.request('PUT', `/lol-perks/v1/pages/${target.id}`, { ...target, ...body, id: target.id });
      if (put.ok) {
        if (!target.current) await this.request('PUT', '/lol-perks/v1/currentpage', target.id);
        return { ok: true, replaced: true, id: target.id, message: 'Runes appliquées sur ta page active.' };
      }
      // anciens clients : modifier une page échoue parfois, on la recrée à la même place
      await this.request('DELETE', `/lol-perks/v1/pages/${target.id}`);
    }
    const res = await this.request('POST', '/lol-perks/v1/pages', body);
    if (res.ok) return { ok: true, replaced: !!target, id: res.data && res.data.id, message: 'Runes appliquées.' };
    const msg = res.data && res.data.message ? String(res.data.message) : '';
    if (/max|limit/i.test(msg)) {
      return {
        ok: false,
        message: 'Aucune page de runes modifiable : sélectionne une de tes pages dans le client, puis réessaie.',
      };
    }
    return { ok: false, message: `Import refusé par le client (${res.status}${msg ? ` : ${msg}` : ''}).` };
  }
}

/**
 * Extrait de la session de sélection ce qui nous intéresse.
 * `queue` (facultatif) : file d'attente renvoyée par LcuClient.queue(), pour connaître le mode.
 */
function parseChampSelect(session, dd, queue = null) {
  if (!session || !Array.isArray(session.myTeam)) return null;
  const me = session.myTeam.find((p) => p.cellId === session.localPlayerCellId);
  if (!me) return null;
  const myKey = me.championId || me.championPickIntent || 0;
  // verrouillé : action de choix terminée ; sans actions (ARAM), dès que le champion est attribué
  const picks = (Array.isArray(session.actions) ? session.actions : [])
    .flat()
    .filter((a) => a && a.actorCellId === session.localPlayerCellId && a.type === 'pick');
  const locked = picks.length ? picks.some((a) => a.completed) && !!myKey : !!me.championId;
  return {
    myChampion: myKey ? dd.champion(myKey) : null,
    role: ROLE_MAP[me.assignedPosition] || '',
    allies: session.myTeam
      .filter((p) => p !== me)
      .map((p) => dd.champion(p.championId || p.championPickIntent))
      .filter(Boolean),
    enemies: (session.theirTeam || []).map((p) => dd.champion(p.championId)).filter(Boolean),
    phase: (session.timer && session.timer.phase) || '',
    locked,
    queueId: queue ? queue.id : 0,
    mapId: queue ? queue.mapId : 0,
    gameMode: queue ? queue.gameMode : '',
  };
}

module.exports = { LcuClient, parseChampSelect, pageName, PAGE_PREFIX };
