'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('petSettings',{
 read:()=>ipcRenderer.invoke('settings:read'),
 set:(key,value)=>ipcRenderer.invoke('settings:set',key,value),
 onChange:fn=>ipcRenderer.on('settings:changed',(_e,s)=>fn(s)),
 act:key=>ipcRenderer.send('settings:act',key),
 getPersona:()=>ipcRenderer.invoke('motion:get-persona'),
 setPersona:value=>ipcRenderer.invoke('motion:save-persona',value)
});
