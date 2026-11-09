'use strict';

const fs = require('fs');
const path = require('path');
const { classifyItem } = require('./itemInfo');
const { norm, compareVersion } = require('./util');

const BASE = 'https://ddragon.leagueoflegends.com';

// Icônes des fragments (dossier StatMods de Data Dragon)
const SHARD_ICONS = {
  5008: 'StatModsAdaptiveForceIcon.png',
  5005: 'StatModsAttackSpeedIcon.png',
  5007: 'StatModsCDRScalingIcon.png',
  5010: 'StatModsMovementSpeedIcon.png',
  5001: 'StatModsHealthScalingIcon.png',
  5011: 'StatModsHealthPlusIcon.png',
  5013: 'StatModsTenacityIcon.png',
  5002: 'StatModsArmorIcon.png',
  5003: 'StatModsMagicResIcon.MagicResist_Fix.png',
};

// Les fragments de stats ne sont pas dans runesReforged.json.
const SHARDS_FR = {
  5008: 'Force adaptative',
  5005: "Vitesse d'attaque",
  5007: 'Accélération de compétence',
  5010: 'Vitesse de déplacement',
  5001: 'PV (selon le niveau)',
  5011: 'PV',
  5013: 'Ténacité et résist. aux ralentissements',
  5002: 'Armure',
  5003: 'Résistance magique',
};
const SHARDS_EN = {
  5008: 'Adaptive Force',
  5005: 'Attack Speed',
  5007: 'Ability Haste',
  5010: 'Move Speed',
  5001: 'Health Scaling',
  5011: 'Health',
  5013: 'Tenacity and Slow Resist',
  5002: 'Armor',
  5003: 'Magic Resist',
};
const SHARDS = SHARDS_FR;

// Langues proposées par Data Dragon (pour suivre la langue du client LoL)
const DD_LANGUAGES = [
  'en_US', 'en_GB', 'en_AU', 'en_PH', 'en_SG', 'fr_FR', 'de_DE', 'es_ES', 'es_MX', 'es_AR', 'it_IT', 'pl_PL',
  'pt_BR', 'ro_RO', 'el_GR', 'hu_HU', 'cs_CZ', 'tr_TR', 'ru_RU', 'ja_JP', 'ko_KR', 'zh_CN', 'zh_TW', 'zh_MY',
  'vi_VN', 'th_TH', 'id_ID',
];

/** Langue Data Dragon la plus proche d'une locale du client ("fr_FR", "en-US"...). */
function ddLanguage(locale) {
  const l = String(locale || '').replace('-', '_');
  if (DD_LANGUAGES.includes(l)) return l;
  const prefix = l.slice(0, 2).toLowerCase();
  return DD_LANGUAGES.find((x) => x.startsWith(`${prefix}_`)) || 'en_US';
}

/**
 * Données statiques du jeu (objets, champions, runes, sorts) via Data Dragon,
 * avec cache disque pour fonctionner hors ligne.
 */
class DDragon {
  constructor({ cacheDir = null, language = 'fr_FR', fetchImpl = null } = {}) {
    this.cacheDir = cacheDir;
    this.language = language;
    this.fetch = fetchImpl || globalThis.fetch;
    this.ready = false;
    this.version = null;
    // Base des URL d'icônes. Dans l'appli : "bsicon://dd" (servies depuis le cache disque).
    this.iconBase = BASE;
  }

  async getJson(url, timeoutMs = 30000) {
    const res = await this.fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`Data Dragon ${res.status} sur ${url}`);
    return res.json();
  }

  async load() {
    let version = null;
    try {
      version = (await this.getJson(`${BASE}/api/versions.json`, 10000))[0];
    } catch {
      version = null; // hors ligne : on tente le cache
    }
    const cached = this.readCache(version);
    if (cached) return this.ingest(cached);
    if (!version) throw new Error('Data Dragon injoignable et aucun cache local.');

    const lang = this.language;
    const cdn = `${BASE}/cdn/${version}/data`;
    const [items, itemsEn, champions, runes, summoners] = await Promise.all([
      this.getJson(`${cdn}/${lang}/item.json`),
      lang === 'en_US' ? null : this.getJson(`${cdn}/en_US/item.json`),
      this.getJson(`${cdn}/${lang}/champion.json`),
      this.getJson(`${cdn}/${lang}/runesReforged.json`),
      this.getJson(`${cdn}/${lang}/summoner.json`),
    ]);
    const raw = {
      version,
      language: lang,
      items: items.data,
      itemsEn: (itemsEn || items).data,
      champions: champions.data,
      runes,
      summoners: summoners.data,
    };
    this.writeCache(raw);
    return this.ingest(raw);
  }

  cacheFile(version) {
    return path.join(this.cacheDir, `ddragon-${version}-${this.language}.json`);
  }

  readCache(version) {
    if (!this.cacheDir) return null;
    try {
      const suffix = `-${this.language}.json`;
      const files = fs.readdirSync(this.cacheDir).filter((f) => f.startsWith('ddragon-') && f.endsWith(suffix));
      let file;
      if (version) file = path.basename(this.cacheFile(version));
      else {
        files.sort((a, b) => compareVersion(a.slice(8, -suffix.length), b.slice(8, -suffix.length)));
        file = files[files.length - 1];
      }
      if (!file || !files.includes(file)) return null;
      return JSON.parse(fs.readFileSync(path.join(this.cacheDir, file), 'utf8'));
    } catch {
      return null;
    }
  }

  writeCache(raw) {
    if (!this.cacheDir) return;
    try {
      fs.mkdirSync(this.cacheDir, { recursive: true });
      fs.writeFileSync(this.cacheFile(raw.version), JSON.stringify(raw));
    } catch {
      /* cache facultatif */
    }
  }

  /** Construit les index à partir des JSON bruts (utilisé aussi par les tests). */
  ingest(raw) {
    this.version = raw.version;
    this.language = raw.language || this.language;

    this.items = new Map();
    for (const [id, it] of Object.entries(raw.items || {})) {
      const en = (raw.itemsEn && raw.itemsEn[id]) || it;
      this.items.set(Number(id), classifyItem(Number(id), it, en));
    }
    // Objet complété ("légendaire") sur une carte = achetable, assez cher, et rien d'achetable
    // au-dessus sur cette carte (ex. Manamune -> Muramana est une transformation).
    this.maps = new Set();
    for (const it of this.items.values()) for (const m of it.maps) this.maps.add(m);
    for (const it of this.items.values()) {
      it.legendaryOn = new Set();
      if (!it.purchasable || it.isBoots || it.isConsumable || it.isTrinket || it.gold.total < 2000) continue;
      for (const m of it.maps) {
        const terminal = it.into.every((i) => {
          const up = this.items.get(i);
          return !up || !up.purchasable || !up.maps.includes(m);
        });
        if (terminal) it.legendaryOn.add(m);
      }
    }
    for (const it of this.items.values()) it.isLegendary = it.legendaryOn.has(11);

    this.champions = new Map();
    this.championsById = new Map();
    this.championsByName = new Map();
    for (const c of Object.values(raw.champions || {})) {
      const champ = {
        id: c.id,
        key: Number(c.key),
        name: c.name,
        tags: c.tags || [],
        info: c.info || {},
        image: (c.image && c.image.full) || `${c.id}.png`,
      };
      this.champions.set(champ.key, champ);
      this.championsById.set(c.id.toLowerCase(), champ);
      this.championsByName.set(norm(c.name), champ);
    }

    this.styles = new Map();
    this.runes = new Map();
    for (const st of raw.runes || []) {
      this.styles.set(st.id, { id: st.id, key: st.key, name: st.name, icon: st.icon });
      (st.slots || []).forEach((slot, row) =>
        (slot.runes || []).forEach((r) =>
          this.runes.set(r.id, { id: r.id, key: r.key, name: r.name, icon: r.icon, styleId: st.id, row }),
        ),
      );
    }

    this.spells = new Map();
    for (const s of Object.values(raw.summoners || {})) {
      this.spells.set(Number(s.key), {
        id: s.id,
        key: Number(s.key),
        name: s.name,
        image: (s.image && s.image.full) || `${s.id}.png`,
      });
    }
    this.ready = true;
    return this;
  }

  champion(key) {
    return this.champions.get(Number(key)) || null;
  }

  championById(id) {
    return this.championsById.get(String(id || '').toLowerCase()) || null;
  }

  /** Joueur de la Live Client Data API -> champion Data Dragon. */
  championFromLive(p) {
    const raw = String(p.rawChampionName || '').replace(/^game_character_displayname_/i, '');
    return (raw && this.championById(raw)) || this.championsByName.get(norm(p.championName)) || null;
  }

  championByName(name) {
    return this.championsByName.get(norm(name)) || null;
  }

  item(id) {
    return this.items.get(Number(id)) || null;
  }

  rune(id) {
    return this.runes.get(Number(id)) || null;
  }

  style(id) {
    return this.styles.get(Number(id)) || null;
  }

  spell(key) {
    return this.spells.get(Number(key)) || null;
  }

  shardName(id) {
    const names = String(this.language).startsWith('fr') ? SHARDS_FR : SHARDS_EN;
    return names[id] || `${String(this.language).startsWith('fr') ? 'Fragment' : 'Shard'} ${id}`;
  }

  /** Objet complété sur cette carte (11 Faille, 12 ARAM, 30 Arena). */
  isLegendary(id, map = 11) {
    const it = this.items.get(Number(id));
    return !!it && it.legendaryOn.has(Number(map));
  }

  onMap(id, map = 11) {
    const it = this.items.get(Number(id));
    return !!it && it.maps.includes(Number(map));
  }

  hasMap(map) {
    return !!this.maps && this.maps.has(Number(map));
  }

  legendaryItems(map = 11) {
    return [...this.items.values()].filter((it) => it.legendaryOn.has(Number(map)));
  }

  // --- Icônes (chemins relatifs à la racine Data Dragon) ---
  itemIconPath(id) {
    return `cdn/${this.version}/img/item/${id}.png`;
  }

  championIconPath(champ) {
    return `cdn/${this.version}/img/champion/${champ.image}`;
  }

  spellIconPath(spell) {
    return `cdn/${this.version}/img/spell/${spell.image}`;
  }

  runeIconPath(rune) {
    return `cdn/img/${rune.icon}`;
  }

  shardIconPath(id) {
    return SHARD_ICONS[id] ? `cdn/img/perk-images/StatMods/${SHARD_ICONS[id]}` : null;
  }

  /** Toutes les icônes utiles pour ce patch (préchargement). */
  allIconPaths() {
    const out = new Set();
    for (const c of this.champions.values()) out.add(this.championIconPath(c));
    const maps = [11, 12, 30];
    for (const it of this.items.values()) {
      if (maps.some((m) => it.maps.includes(m)) && (it.purchasable || it.legendaryOn.size)) out.add(this.itemIconPath(it.id));
    }
    for (const s of this.spells.values()) out.add(this.spellIconPath(s));
    for (const st of this.styles.values()) if (st.icon) out.add(this.runeIconPath(st));
    for (const r of this.runes.values()) if (r.icon) out.add(this.runeIconPath(r));
    for (const id of Object.keys(SHARD_ICONS)) out.add(this.shardIconPath(id));
    return [...out];
  }

  // --- URL complètes ---
  iconUrl(rel) {
    return rel ? `${this.iconBase}/${rel}` : null;
  }

  itemIcon(id) {
    return this.iconUrl(this.itemIconPath(id));
  }

  championIcon(champ) {
    return champ ? this.iconUrl(this.championIconPath(champ)) : null;
  }

  spellIcon(spell) {
    return spell ? this.iconUrl(this.spellIconPath(spell)) : null;
  }

  runeIcon(rune) {
    return rune && rune.icon ? this.iconUrl(this.runeIconPath(rune)) : null;
  }

  shardIcon(id) {
    return this.iconUrl(this.shardIconPath(id));
  }
}

module.exports = { DDragon, SHARDS, SHARD_ICONS, BASE, DD_LANGUAGES, ddLanguage };
