'use strict';

const https = require('https');

/**
 * Live Client Data API : API locale officielle exposée par le jeu pendant une partie
 * (https://127.0.0.1:2999). Lecture seule, aucune interaction avec la mémoire du jeu.
 * Le certificat est auto-signé par Riot : on ne l'accepte que pour 127.0.0.1.
 */
const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });

function getLocalJson({ port, path, headers = {}, timeout = 1500 }) {
  return new Promise((resolve) => {
    const req = https.request(
      { host: '127.0.0.1', port, path, method: 'GET', agent, headers, timeout },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (res.statusCode !== 200) return resolve(null);
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
    req.end();
  });
}

function fetchAllGameData() {
  return getLocalJson({ port: 2999, path: '/liveclientdata/allgamedata' });
}

function samePlayer(p, active) {
  if (p.riotId && active.riotId) return p.riotId === active.riotId;
  if (p.riotIdGameName && active.riotIdGameName) {
    return p.riotIdGameName === active.riotIdGameName && (p.riotIdTagLine || '') === (active.riotIdTagLine || '');
  }
  return !!p.summonerName && p.summonerName === active.summonerName;
}

/** Réduit la réponse brute aux infos utiles (et visibles dans le jeu, tableau des scores inclus). */
function normalizeLive(raw, dd) {
  if (!raw || !Array.isArray(raw.allPlayers) || !raw.activePlayer || raw.activePlayer.error) return null;
  const active = raw.activePlayer;
  const meRaw = raw.allPlayers.find((p) => samePlayer(p, active));
  if (!meRaw) return null; // mode spectateur

  const toPlayer = (p) => ({
    champ: dd.championFromLive(p),
    championName: p.championName,
    team: p.team,
    position: p.position || '',
    level: p.level || 1,
    items: (p.items || []).map((i) => i.itemID).filter(Boolean),
    scores: p.scores || {},
    isDead: !!p.isDead,
    isMe: p === meRaw,
  });
  const players = raw.allPlayers.map(toPlayer);
  const me = players.find((p) => p.isMe);
  return {
    gameMode: (raw.gameData && raw.gameData.gameMode) || '',
    mapNumber: (raw.gameData && raw.gameData.mapNumber) || 0,
    gameTime: (raw.gameData && raw.gameData.gameTime) || 0,
    me: { ...me, gold: active.currentGold || 0, level: active.level || me.level },
    allies: players.filter((p) => p.team === me.team && !p.isMe),
    enemies: players.filter((p) => p.team !== me.team),
  };
}

module.exports = { fetchAllGameData, normalizeLive, getLocalJson, agent };
