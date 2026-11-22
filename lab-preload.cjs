'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('motionHost',{
 getManifest:()=>ipcRenderer.invoke('motion:manifest'),
 reportError:message=>ipcRenderer.send('motion:renderer-error',String(message)),
 openFloating:()=>ipcRenderer.invoke('motion:open-floating'),
 beginDrag:()=>ipcRenderer.invoke('motion:drag-start'),
 endDrag:()=>ipcRenderer.send('motion:drag-end'),
 popupMenu:()=>ipcRenderer.send('motion:menu'),
 saveAutoIdle:value=>ipcRenderer.send('motion:save-autonomy',Boolean(value)),
 planRoam:()=>ipcRenderer.invoke('motion:roam-plan'),
 startRoam:id=>ipcRenderer.send('motion:roam-start',id),
 stopRoam:id=>ipcRenderer.send('motion:roam-stop',id),
 onMenu:fn=>ipcRenderer.on('motion:menu-event',(_e,value)=>fn(value)),
 onVoice:fn=>ipcRenderer.on('voice:command',(_e,value)=>fn(value)),
 openVoice:()=>ipcRenderer.invoke('voice:open-panel'),
 savePersona:value=>ipcRenderer.invoke('motion:save-persona',value),
 saveOutfit:value=>ipcRenderer.invoke('motion:save-outfit',value),
 getPetState:()=>ipcRenderer.invoke('pet:state'),
 reportAction:action=>ipcRenderer.send('pet:action',action)
});
