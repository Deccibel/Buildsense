'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Seuls ces canaux sont accessibles depuis les pages (overlay et fenêtre principale).
const SEND = new Set(['overlay:height']);
const INVOKE = new Set([
  'app:getState',
  'config:set',
  'api:test',
  'crawler:toggle',
  'demo:set',
  'overlay:resetPosition',
  'overlay:toggleMove',
  'runes:import',
  'role:set',
  'hotkeys:set',
  'hotkeys:reset',
  'hotkeys:suspend',
  'builds:get',
  'builds:favorite',
  'builds:unfavorite',
  'follow:add',
  'follow:remove',
  'meta:get',
  'update:check',
  'update:download',
  'update:install',
  'update:dismiss',
  'whatsnew:dismiss',
  'champions:list',
  'link:open',
  'link:url',
  'game:setBorderless',
  'game:fixFso',
  'builds:detail',
  'coach:get',
]);
const ON = new Set(['overlay:update', 'overlay:settings', 'overlay:toast', 'state', 'toast']);

contextBridge.exposeInMainWorld('coach', {
  send: (channel, data) => {
    if (SEND.has(channel)) ipcRenderer.send(channel, data);
  },
  invoke: (channel, ...args) =>
    INVOKE.has(channel) ? ipcRenderer.invoke(channel, ...args) : Promise.reject(new Error(`Canal refusé : ${channel}`)),
  on: (channel, cb) => {
    if (!ON.has(channel)) return () => {};
    const listener = (_event, data) => cb(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
