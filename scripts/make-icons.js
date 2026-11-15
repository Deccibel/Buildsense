'use strict';

/**
 * Génère les icônes de l'appli à partir de la mascotte (src/ui/mascot.css) :
 *   electron scripts/make-icons.js
 *
 *   assets/icon.png        256 px  (fenêtre, barre des tâches)
 *   assets/icon.ico        16 à 256 px (exécutable, installeur, raccourcis)
 *   assets/tray.png        16 px + @1.25x, @1.5x, @2x (zone de notification)
 *   assets/logo.png        512 px  (README)
 *
 * Rendu hors écran (aucune fenêtre affichée). Les petites tailles utilisent une variante aux yeux plus épais.
 * À relancer seulement si le dessin de la mascotte change : les fichiers générés sont dans le dépôt.
 */

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const ROOT = path.join(__dirname, '..');
const ASSETS = path.join(ROOT, 'assets');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.disableHardwareAcceleration();

const windows = [];

/** Rend la mascotte dans un carré de `px` pixels (fond transparent). */
async function render(px, { small = false, ratio = 0.84 } = {}) {
  const win = new BrowserWindow({
    width: px,
    height: px,
    useContentSize: true,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true },
  });
  win.webContents.setFrameRate(30);
  await win.loadFile(path.join(__dirname, 'icon.html'), { query: { size: String(px), ratio: String(ratio), small: small ? '1' : '0' } });
  await wait(500);
  const img = await win.webContents.capturePage();
  // la fenêtre reste ouverte jusqu'à la fin : en détruire une fait échouer le chargement de la suivante
  windows.push(win);
  return img;
}

const resize = (img, px) => img.resize({ width: px, height: px, quality: 'best' });

/** Fichier .ico à partir d'images PNG (une par taille). */
function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

app.whenReady().then(async () => {
  try {
    const big = await render(1024);
    // petites tailles : la bille remplit presque tout le carré, yeux épais
    const small = await render(512, { small: true, ratio: 0.9 });
    const size = big.getSize();
    if (size.width < 1000) throw new Error(`rendu inattendu : ${size.width}×${size.height}`);

    const pick = (px) => resize(px <= 32 ? small : big, px).toPNG();
    fs.writeFileSync(path.join(ASSETS, 'logo.png'), pick(512));
    fs.writeFileSync(path.join(ASSETS, 'icon.png'), pick(256));
    fs.writeFileSync(path.join(ASSETS, 'icon.ico'), ico([16, 24, 32, 48, 64, 128, 256].map((px) => ({ size: px, data: pick(px) }))));
    for (const [name, px] of [
      ['tray.png', 16],
      ['tray@1.25x.png', 20],
      ['tray@1.5x.png', 24],
      ['tray@2x.png', 32],
    ]) {
      fs.writeFileSync(path.join(ASSETS, name), pick(px));
    }
    console.log('Icônes générées dans assets/.');
    app.exit(0);
  } catch (e) {
    console.error(e);
    app.exit(1);
  }
});
