'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('gameHost', {
  read: () => ipcRenderer.invoke('game:read'),
  startRun: id => ipcRenderer.invoke('game:start-run', id),
  getBattleFrames: () => ipcRenderer.invoke('game:battle-frames'),
  reportBossDefeated: () => ipcRenderer.invoke('game:boss-defeated'),
  buy: uid => ipcRenderer.invoke('game:buy', uid),
  sell: uid => ipcRenderer.invoke('game:sell', uid),
  equip: uid => ipcRenderer.invoke('game:equip', uid),
  unequip: slot => ipcRenderer.invoke('game:unequip', slot),
  forceComplete: () => ipcRenderer.invoke('game:force-complete'),
  grantExp: n => ipcRenderer.invoke('game:qa-grant-exp', n),
  grantGold: n => ipcRenderer.invoke('game:qa-grant-gold', n),
  onChange: fn => ipcRenderer.on('game:changed', (_e, state) => fn(state)),
  onEvent: fn => ipcRenderer.on('voice:command', (_e, value) => {
    if (typeof value?.type === 'string' && value.type.startsWith('game:')) fn(value);
  }),
  getPetState: () => ipcRenderer.invoke('pet:state'),
  onPetState: fn => ipcRenderer.on('voice:command', (_e, value) => {
    if (value?.type === 'pet:state-changed') fn(value.stats);
  }),
  close: () => ipcRenderer.send('game:close'),
  dragStart: (x,y) => ipcRenderer.send('panel:drag-start',x,y),
  dragMove: (x,y) => ipcRenderer.send('panel:drag-move',x,y),
  dragEnd: () => ipcRenderer.send('panel:drag-end'),
});
