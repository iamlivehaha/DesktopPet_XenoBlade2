'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('petSettings',{
 read:()=>ipcRenderer.invoke('settings:read'),
 set:(key,value)=>ipcRenderer.invoke('settings:set',key,value),
 onChange:fn=>ipcRenderer.on('settings:changed',(_e,s)=>fn(s)),
 act:key=>ipcRenderer.send('settings:act',key),
 getPersona:()=>ipcRenderer.invoke('motion:get-persona'),
 setPersona:value=>ipcRenderer.invoke('motion:save-persona',value),
 getOutfit:()=>ipcRenderer.invoke('motion:get-outfit'),
 setOutfit:value=>ipcRenderer.invoke('motion:save-outfit',value),
 getAppearance:()=>ipcRenderer.invoke('appearance:read'),
 dragStart:(x,y)=>ipcRenderer.send('panel:drag-start',x,y),
 dragMove:(x,y)=>ipcRenderer.send('panel:drag-move',x,y),
 dragEnd:()=>ipcRenderer.send('panel:drag-end'),
 getPetState:()=>ipcRenderer.invoke('pet:state'),
 onPetState:fn=>ipcRenderer.on('voice:command',(_e,v)=>{if(v?.type==='pet:state-changed')fn(v.stats);}),
 onAppearance:fn=>ipcRenderer.on('voice:command',(_e,v)=>{
  if(v?.type==='persona-change'&&v.persona)fn({persona:v.persona});
  if(v?.type==='outfit-change'&&v.outfit)fn({outfit:v.outfit});
 })
});
