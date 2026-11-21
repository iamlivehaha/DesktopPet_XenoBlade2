'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('voiceHost',{
 readConfig:()=>ipcRenderer.invoke('voice:config-read'),
 saveConfig:patch=>ipcRenderer.invoke('voice:config-save',patch),
 testConnection:patch=>ipcRenderer.invoke('voice:test',patch),
 testSearch:(provider,key)=>ipcRenderer.invoke('voice:test-search',provider,key),
 requestPersonaSync:value=>ipcRenderer.invoke('motion:save-persona',value),
 chat:(text,history)=>ipcRenderer.invoke('voice:chat',text,history),
 transcribe:(buffer,mime)=>ipcRenderer.invoke('voice:transcribe',buffer,mime),
 close:()=>ipcRenderer.send('voice:panel-close'),
 onCommand:fn=>ipcRenderer.on('voice:command',(_e,value)=>fn(value)),
});
