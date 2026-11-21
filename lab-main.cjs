'use strict';
const {app,BrowserWindow,ipcMain,screen,Menu,Tray,nativeImage,dialog}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {startupMode,clampPosition}=require('./startup-policy.cjs');
const {planRoam,positionAt}=require('./roam-route.cjs');
const voice=require('./voice-model.cjs');
const {performance}=require('node:perf_hooks');
const testing=process.argv.includes('--self-test');
const mode=startupMode({packaged:app.isPackaged,args:process.argv});
const startupCheck=mode==='startup-check',probe=process.argv.includes('--probe-startup');
const argument=name=>{const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1];};
const reportFile=argument('--verification-output')||path.join(app.getPath('temp'),'mythra-startup-check.json');
const profile=testing||startupCheck?'MythraDesktopPet-QA':mode==='desktop'||app.isPackaged?'MythraDesktopPet':'MythraCoreMotionPreview';
app.setPath('userData',path.join(app.getPath('appData'),profile));
const gotLock=testing||startupCheck&&!probe?true:app.requestSingleInstanceLock({probe,reportFile});
if(!gotLock)app.quit();
app.commandLine.appendSwitch('disable-renderer-backgrounding');
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'motion-manifest.json'),'utf8'));
const qa=app.isPackaged?path.join(app.getPath('userData'),'qa'):path.join(__dirname,'qa');fs.mkdirSync(qa,{recursive:true});
const settingsPath=path.join(app.getPath('userData'),'desktop-settings.json');
let settings={autoIdle:true,roam:false};try{if(!testing&&!startupCheck)settings={...settings,...JSON.parse(fs.readFileSync(settingsPath,'utf8'))};}catch{}
function saveSettings(){if(testing||startupCheck)return;fs.mkdirSync(path.dirname(settingsPath),{recursive:true});fs.writeFileSync(settingsPath,JSON.stringify(settings,null,2));}
function savePosition(w){if(w&&!w.isDestroyed()&&w.isMotionFloating){const b=w.getBounds();settings.position={x:b.x,y:b.y};saveSettings();}}
let win,petWindow,tray,panel,voicePanel,route,routeId=0;const dragTimers=new Map(),errors=[];
const voiceHistory=[];
function broadcastVoice(event){for(const w of BrowserWindow.getAllWindows())if(!w.isDestroyed())w.webContents.send('voice:command',event);}
const urls=Object.fromEntries(Object.entries(manifest.normalizedReferenceFiles||{}).map(([k,t])=>[k,t.map(f=>fs.existsSync(path.join(__dirname,f))?pathToFileURL(path.join(__dirname,f)).href:null)]));
app.on('second-instance',(_event,_args,_cwd,data)=>{
 if(probe&&data?.probe){
  const r={secondaryReceived:true,primaryPID:process.pid,petWindows:BrowserWindow.getAllWindows().filter(w=>w.isMotionFloating).length,totalWindows:BrowserWindow.getAllWindows().length};
  fs.mkdirSync(path.dirname(data.reportFile),{recursive:true});fs.writeFileSync(data.reportFile,JSON.stringify(r,null,2));
 }else app.whenReady().then(()=>openFloating());
});
function stopDrag(w){if(w){const active=dragTimers.has(w.id);clearInterval(dragTimers.get(w.id));dragTimers.delete(w.id);
 if(active&&w.isMotionFloating&&!w.isDestroyed()){
  const b=w.getBounds(),a=screen.getDisplayNearestPoint({x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)}).workArea;
  const x=Math.round(Math.max(a.x,Math.min(b.x,a.x+a.width-b.width))),y=Math.round(Math.max(a.y,Math.min(b.y,a.y+a.height-b.height)));
  if(Number.isFinite(x)&&Number.isFinite(y))w.setPosition(x,y,false);
  savePosition(w);
 }
}}
function stopRoam(w,notify=true){
 if(!route||route.window!==w)return;
 const active=route;route=null;clearInterval(active.timer);clearTimeout(active.expiry);
 if(!w.isDestroyed()){
  if(active.timer)savePosition(w);
  if(notify)w.webContents.send('motion:menu-event',{type:'roam-ended',id:active.id});
 }
}
const settingsSnapshot=()=>({autoIdle:settings.autoIdle!==false,roam:settings.roam===true});
function broadcast(windows,event){for(const w of windows)if(w!==panel&&!w.isDestroyed())w.webContents.send('motion:menu-event',event);}
function setPreference(key,value){
 if(!['autoIdle','roam'].includes(key)||typeof value!=='boolean')throw new Error('Invalid preference');
 const previous=settings[key];settings[key]=value;
 try{saveSettings();}catch(error){settings[key]=previous;throw error;}
 if(key==='roam'&&!value)stopRoam(petWindow);
 broadcast(BrowserWindow.getAllWindows(),{type:key==='roam'?'set-roam':'set-autonomy',enabled:value});
 const state=settingsSnapshot();
 if(panel&&!panel.isDestroyed())panel.webContents.send('settings:changed',state);
 updateTrayMenu();
 return state;
}
const prefItem=(key,label)=>({label,type:'checkbox',checked:settingsSnapshot()[key],
 click:()=>{try{setPreference(key,!settingsSnapshot()[key]);}catch(error){errors.push(String(error));}}});
function prefs(){return {preload:path.join(__dirname,'lab-preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false};}
function guard(w){
 w.webContents.setWindowOpenHandler(()=>({action:'deny'}));w.webContents.on('will-navigate',e=>e.preventDefault());
 w.on('blur',()=>stopDrag(w));w.on('closed',()=>{stopDrag(w);stopRoam(w,false);});
 w.on('close',()=>savePosition(w));
 w.webContents.on('console-message',(_event,level,message)=>{if(level>=3)errors.push(message);});
}
async function openFloating(){
 if(petWindow&&!petWindow.isDestroyed()){petWindow.show();return true;}
 const size=220,saved=settings.position;let a=screen.getPrimaryDisplay().workArea;
 if(Number.isFinite(saved?.x)&&Number.isFinite(saved?.y))a=screen.getDisplayNearestPoint({x:Math.round(saved.x),y:Math.round(saved.y)}).workArea;
 const location=clampPosition({x:Number.isFinite(saved?.x)?saved.x:a.x+a.width-size-60,y:Number.isFinite(saved?.y)?saved.y:a.y+a.height-size-30,width:size,height:size},a);
 petWindow=new BrowserWindow({width:size,height:size,...location,
  frame:false,transparent:true,backgroundColor:'#00000000',alwaysOnTop:true,skipTaskbar:true,resizable:false,
  hasShadow:false,show:false,title:'光 · 动作重制预览版',icon:path.join(__dirname,'assets/mythra/headpat-C1.png'),webPreferences:prefs()});
 petWindow.isMotionFloating=true;guard(petWindow);await petWindow.loadFile(path.join(__dirname,'motion-preview.html'));
 await waitReady(petWindow);if(!startupCheck)petWindow.showInactive();return true;
}
async function openSettings(from){
 if(from.isDestroyed()||panel===from)return;
 if(panel&&!panel.isDestroyed()){if(panel.isVisible())panel.focus();return;}
 stopRoam(petWindow);
 const {x,y}=screen.getCursorScreenPoint(),a=screen.getDisplayNearestPoint({x,y}).workArea;
 const width=326,height=470;
 const pos=clampPosition({x:x-20,y:y-a.y>=height+8?y-height-8:y+10,width,height},a);
 const current=new BrowserWindow({...pos,width,height,show:false,frame:false,backgroundColor:'#f5f6ef',
  title:'光桌宠 · 快捷设置',resizable:false,skipTaskbar:true,alwaysOnTop:true,
  webPreferences:{...prefs(),preload:path.join(__dirname,'settings-panel-preload.cjs')}});
 panel=current;guard(current);
 broadcast(BrowserWindow.getAllWindows(),{type:'panel-open',enabled:true});
 current.on('blur',()=>{if(!current.isDestroyed())current.close();});
 current.on('closed',()=>{
  if(panel===current){panel=null;broadcast(BrowserWindow.getAllWindows(),{type:'panel-open',enabled:false});}
 });
 try{
  await current.loadFile(path.join(__dirname,'settings-panel.html'));
  if(!current.isDestroyed()){current.show();current.focus();}
 }catch(error){if(!current.isDestroyed())current.close();throw error;}
}
async function createVoicePanel(){
 if(voicePanel&&!voicePanel.isDestroyed()){voicePanel.show();voicePanel.focus();return voicePanel;}
 const {x,y}=screen.getCursorScreenPoint(),a=screen.getDisplayNearestPoint({x,y}).workArea;
 const width=420,height=560;
 const pos=clampPosition({x:x-60,y:Math.max(a.y,y-height+40),width,height},a);
 voicePanel=new BrowserWindow({...pos,width,height,show:false,frame:false,backgroundColor:'#f7f6f2',
  title:'光桌宠 · 语音对话',resizable:false,alwaysOnTop:true,skipTaskbar:false,
  webPreferences:{...prefs(),preload:path.join(__dirname,'voice-preload.cjs')}});
 guard(voicePanel);
 voicePanel.on('closed',()=>{voicePanel=null;broadcastVoice({type:'voice-panel',open:false});});
 voicePanel.on('blur',()=>{if(voicePanel&&!voicePanel.isDestroyed())voicePanel.hide();});
 try{
  await voicePanel.loadFile(path.join(__dirname,'voice-panel.html'));
  voicePanel.show();voicePanel.focus();
  broadcastVoice({type:'voice-panel',open:true});
  return voicePanel;
 }catch(error){voicePanel.close();throw error;}
}
async function createPreview(){
 if(win&&!win.isDestroyed()){win.show();win.focus();return win;}
 const work=screen.getPrimaryDisplay().workArea;
 win=new BrowserWindow({width:1080,height:Math.min(900,work.height-20),minWidth:880,minHeight:720,
  show:true,backgroundColor:'#eef3f7',title:'光 · 动作预览',webPreferences:prefs()});
 win.setMenuBarVisibility(false);guard(win);await win.loadFile(path.join(__dirname,'motion-preview.html'));return win;
}
function ensureTray(){
 if(tray||testing||startupCheck)return;
 const image=nativeImage.createFromPath(path.join(__dirname,'assets/mythra/headpat-C1.png')).resize({width:24,height:24});
 tray=new Tray(image);tray.setToolTip('光桌宠 · 动作重制预览版');
 updateTrayMenu();
 tray.on('double-click',()=>openFloating());
}
function updateTrayMenu(){
 tray?.setContextMenu(Menu.buildFromTemplate([{label:'显示光桌宠',click:()=>openFloating()},{label:'打开动作预览',click:()=>createPreview()},
  {label:'语音对话',click:()=>createVoicePanel().catch(e=>errors.push(String(e)))},
  prefItem('autoIdle','随机待机'),prefItem('roam','全屏随机漫游'),{type:'separator'},{label:'退出光桌宠',click:()=>app.quit()}]));
}
ipcMain.handle('motion:manifest',event=>({manifest,nativeUrlGroups:urls,testing,autoIdle:settings.autoIdle!==false,
 roam:settings.roam===true,persona:voice.load().persona,
 floating:Boolean(BrowserWindow.fromWebContents(event.sender)?.isMotionFloating)}));
ipcMain.handle('motion:save-persona',(_event,value)=>{const p=value==='pyra'?'pyra':'mythra';voice.save({persona:p});broadcastVoice({type:'persona-change',persona:p});return true;});
ipcMain.handle('motion:get-persona',()=>voice.load().persona);
ipcMain.on('motion:renderer-error',(_e,msg)=>errors.push(String(msg)));
ipcMain.handle('motion:open-floating',()=>openFloating());
ipcMain.on('motion:save-autonomy',(event,value)=>{
 if(event.sender===win?.webContents||event.sender===petWindow?.webContents)
  try{setPreference('autoIdle',Boolean(value));}catch(error){errors.push(String(error));}
});
ipcMain.handle('motion:drag-start',event=>{
 const w=BrowserWindow.fromWebContents(event.sender);if(!w?.isMotionFloating)return false;
 stopRoam(w);stopDrag(w);const size=w.getContentBounds().width,anchor=manifest.actions.drag.grabAnchor;
 const ox=Math.round(anchor[0]*size/500),oy=Math.round(anchor[1]*size/500);
 const move=()=>{if(w.isDestroyed())return stopDrag(w);const p=screen.getCursorScreenPoint();
  const x=Math.round(p.x-ox),y=Math.round(p.y-oy);if(Number.isFinite(x)&&Number.isFinite(y))w.setPosition(x,y,false);};
 move();dragTimers.set(w.id,setInterval(move,8));return true;
});
ipcMain.on('motion:drag-end',event=>stopDrag(BrowserWindow.fromWebContents(event.sender)));
ipcMain.handle('motion:roam-plan',event=>{
 const w=BrowserWindow.fromWebContents(event.sender);
 if(!w?.isMotionFloating||panel||(!settings.roam&&!testing)||route||dragTimers.has(w.id)||!manifest.actions.run)return null;
 const b=w.getBounds(),work=screen.getDisplayMatching(b).workArea;
 const path=planRoam(b,work);if(!path)return null;
 route={window:w,id:++routeId,path};
 route.expiry=setTimeout(()=>stopRoam(w),1500);
 return {id:route.id,direction:path.direction};
});
ipcMain.on('motion:roam-start',(event,id)=>{
 const w=BrowserWindow.fromWebContents(event.sender),active=route;
 if(!active||active.window!==w||id!==active.id||active.timer)return;
 clearTimeout(active.expiry);const t0=performance.now();
 active.timer=setInterval(()=>{
  if(w.isDestroyed()||!w.isVisible()||dragTimers.has(w.id))return stopRoam(w);
  const b=w.getBounds(),work=screen.getDisplayMatching(b).workArea;
  const point=positionAt(active.path,performance.now()-t0),accepted=clampPosition({...b,...point},work);
  if(accepted.x!==point.x||accepted.y!==point.y)return stopRoam(w);
  if(b.x!==point.x||b.y!==point.y)w.setPosition(point.x,point.y,false);
  if(point.done)stopRoam(w);
 },16);
});
ipcMain.on('motion:roam-stop',(event,id)=>{
 const w=BrowserWindow.fromWebContents(event.sender);
 if(route?.id===id)stopRoam(w);
});
ipcMain.on('motion:menu',event=>{
 const w=BrowserWindow.fromWebContents(event.sender);if(!w)return;
 openSettings(w).catch(error=>errors.push(String(error)));
});
const fromPanel=event=>panel&&!panel.isDestroyed()&&event.sender===panel.webContents;
ipcMain.handle('settings:read',event=>{if(!fromPanel(event))throw new Error('Settings window required');return settingsSnapshot();});
ipcMain.handle('settings:set',(event,key,value)=>{if(!fromPanel(event))throw new Error('Settings window required');return setPreference(key,value);});
ipcMain.on('settings:act',(event,key)=>{
 if(!fromPanel(event))return;
 if(key==='close')panel.close();
 if(key==='preview'){panel.close();createPreview().catch(error=>errors.push(String(error)));}
 if(key==='voice'){panel.close();createVoicePanel().catch(error=>errors.push(String(error)));}
 if(key==='quit')app.quit();
});
/* ---------- 语音对话 IPC ---------- */
const fromVoice=event=>voicePanel&&!voicePanel.isDestroyed()&&event.sender===voicePanel.webContents;
ipcMain.handle('voice:config-read',()=>voice.publicConfig());
ipcMain.handle('voice:config-save',(event,patch)=>{
 if(!fromVoice(event))throw new Error('Voice panel required');
 return voice.save(patch||{});
});
ipcMain.handle('voice:test',(event,patch)=>{
 if(!fromVoice(event))throw new Error('Voice panel required');
 return voice.testConnection(patch||{});
});
ipcMain.handle('voice:test-search',(event,provider,apiKey)=>{
 if(!fromVoice(event))throw new Error('Voice panel required');
 return voice.testSearch(provider,apiKey);
});
ipcMain.handle('voice:chat',async(event,text,history)=>{
 if(!fromVoice(event))throw new Error('Voice panel required');
 const userText=String(text||'').trim();if(!userText)throw new Error('空消息');
 const result=await voice.chat(userText,history);
 voiceHistory.push({role:'user',content:userText},{role:'assistant',content:result.reply||JSON.stringify(result.command)});
 if(voiceHistory.length>24)voiceHistory.splice(0,voiceHistory.length-24);
 broadcastVoice({type:'voice-reply',...result.command,say:result.command.say||result.reply});
 switch(result.command.control){
  case 'open-preview':createPreview().catch(e=>errors.push(String(e)));break;
  case 'open-floating':openFloating().catch(e=>errors.push(String(e)));break;
  case 'quit':app.quit();break;
  case 'toggle-idle':setPreference('autoIdle',!settingsSnapshot().autoIdle);break;
  case 'toggle-roam':setPreference('roam',!settingsSnapshot().roam);break;
  case 'switch-persona':
   if(result.command.persona){voice.save({persona:result.command.persona});broadcastVoice({type:'persona-change',persona:result.command.persona});}
   break;
 }
 return {...result,history:{user:userText,assistant:result.reply}};
});
ipcMain.handle('voice:transcribe',async(event,buffer,mime)=>{
 if(!fromVoice(event))throw new Error('Voice panel required');
 return voice.transcribe(Buffer.from(buffer),mime);
});
ipcMain.handle('voice:open-panel',()=>createVoicePanel().then(w=>Boolean(w)));
ipcMain.on('voice:panel-close',()=>{if(voicePanel&&!voicePanel.isDestroyed())voicePanel.close();});
async function waitReady(w){const end=Date.now()+20000;while(!await w.webContents.executeJavaScript('Boolean(window.motionQA)')){
 if(Date.now()>end)throw new Error('Renderer assets did not decode');await new Promise(r=>setTimeout(r,70));}}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 if(!gotLock)return;
 if(startupCheck){
  await openFloating();const info=await petWindow.webContents.executeJavaScript('window.motionQA.startupInfo()');
  const r={packaged:app.isPackaged,appPath:app.getAppPath(),pid:process.pid,mode:'desktop-only',petWindows:1,previewWindows:0,gotSingleInstanceLock:probe?gotLock:null,...info};
  fs.mkdirSync(path.dirname(reportFile),{recursive:true});fs.writeFileSync(reportFile,JSON.stringify(r,null,2));
  if(probe)setTimeout(()=>app.exit(0),Number(argument('--probe-ms'))||10000);else app.exit(info.decodedImages===manifest.assets.length?0:1);
  return;
 }
 ensureTray();
 if(mode==='desktop'){
  await openFloating();
  if(process.argv.includes('--voice'))await createVoicePanel().catch(e=>errors.push(String(e)));
  return;
 }
 await createPreview();
 if(process.argv.includes('--open-floating'))await openFloating();
 if(process.argv.includes('--voice'))await createVoicePanel().catch(e=>errors.push(String(e)));
 if(!testing)return;
 try{
  win.show();await waitReady(win);const result=await win.webContents.executeJavaScript('window.motionQA.run()');
  for(const [name,action,index] of [['look','lookAround',2],['suspended','drag',0],['recovery','drag',24]]){
   await win.webContents.executeJavaScript(`window.motionQA.show(${index},${JSON.stringify(action)})`);await sleep(60);
   fs.writeFileSync(path.join(qa,`lab-runtime-${name}.png`),(await win.webContents.capturePage()).toPNG());
  }
  for(const action of ['sofa','book','tea']){
   if(!manifest.actions[action])continue;
   const index=manifest.actions[action].start.frames.length+1;
   await win.webContents.executeJavaScript(`window.motionQA.show(${index},${JSON.stringify(action)})`);
   await sleep(60);
   fs.writeFileSync(path.join(qa,`lab-runtime-${action}.png`),(await win.webContents.capturePage()).toPNG());
  }
  win.focus();await sleep(100);
  const rect=await win.webContents.executeJavaScript('window.motionQA.prepareInputTest()');
  const x=Math.round(rect.x+rect.width*.45),y=Math.round(rect.y+rect.height*.35);
  win.webContents.sendInputEvent({type:'mouseMove',x,y});win.webContents.sendInputEvent({type:'mouseDown',x,y,button:'left',clickCount:1,modifiers:['leftButtonDown']});
  await sleep(220);win.webContents.sendInputEvent({type:'mouseMove',x:x+20,y:y+10,button:'left',modifiers:['leftButtonDown'],movementX:20,movementY:10});await sleep(160);
  const held=await win.webContents.executeJavaScript('window.motionQA.getState()');
  win.webContents.sendInputEvent({type:'mouseUp',x:x+20,y:y+10,button:'left',clickCount:1});await sleep(80);
  const released=await win.webContents.executeJavaScript('window.motionQA.getState()');
  win.webContents.sendInputEvent({type:'mouseDown',x:x+20,y:y+10,button:'left',clickCount:1,modifiers:['leftButtonDown']});await sleep(230);
  const regrabbed=await win.webContents.executeJavaScript('window.motionQA.getState()');
  win.webContents.sendInputEvent({type:'mouseUp',x:x+20,y:y+10,button:'left',clickCount:1});
  const domEndFrames=manifest.actions.drag.endVariants?.[0]?.frames||manifest.actions.drag.end.frames;
  await sleep(300+domEndFrames.reduce((n,f)=>n+f.ms,0)*(manifest.actions.drag.releaseTimeScale||1));
  const recovered=await win.webContents.executeJavaScript('window.motionQA.getState()');
  result.actualDOMDrag={held,released,regrabbed,recovered,passed:held.dragging&&held.action==='drag'&&released.phase==='end'&&regrabbed.dragging&&regrabbed.phase==='dynamic'&&recovered.action==='idle'};
  await openFloating();petWindow.show();petWindow.focus();await waitReady(petWindow);
  const floatingResult=await petWindow.webContents.executeJavaScript('window.motionQA.run()');
  await petWindow.webContents.executeJavaScript('window.motionQA.show(0,"drag")');await sleep(70);
  const picture=await petWindow.webContents.capturePage();fs.writeFileSync(path.join(qa,'lab-floating-suspended.png'),picture.toPNG());
  const bitmap=picture.toBitmap();const transparentCorners=bitmap[3]===0&&bitmap[bitmap.length-1]===0;
  await petWindow.webContents.executeJavaScript('window.motionHost.beginDrag()');await sleep(100);
  const bounds=petWindow.getBounds(),cursor=screen.getCursorScreenPoint(),size=petWindow.getContentBounds().width;
  const anchor=manifest.actions.drag.grabAnchor;
  const follows=Number.isInteger(bounds.x)&&Number.isInteger(bounds.y)&&bounds.x===Math.round(cursor.x-anchor[0]*size/500)&&bounds.y===Math.round(cursor.y-anchor[1]*size/500);
  await petWindow.webContents.executeJavaScript('window.motionHost.endDrag()');
  await sleep(40);const landed=petWindow.getBounds(),area=screen.getDisplayNearestPoint({x:landed.x+110,y:landed.y+110}).workArea;
  const onScreen=landed.x>=area.x&&landed.y>=area.y&&landed.x+landed.width<=area.x+area.width&&landed.y+landed.height<=area.y+area.height;
  result.floating={success:floatingResult.success,checks:floatingResult.checks.length,transparentCorners,followsActualCursorAtPickup:follows,releaseClampedToWorkArea:onScreen,bounds};
  const beforeRoam=petWindow.getBounds();
  const roamStarted=await petWindow.webContents.executeJavaScript('window.motionQA.startRoamTest()');
  await sleep(720);
  const roamingState=await petWindow.webContents.executeJavaScript('window.motionQA.getState()');
  const duringRoam=petWindow.getBounds();
  // The same host entry used by held pointer-down cancels an active route.
  await petWindow.webContents.executeJavaScript('window.motionHost.beginDrag()');await sleep(90);
  const routeClearedOnGrab=!route;
  await petWindow.webContents.executeJavaScript('window.motionHost.endDrag()');
  await petWindow.webContents.executeJavaScript('window.motionQA.stopRoamTest()');
  await sleep(800);
  const afterRoam=await petWindow.webContents.executeJavaScript('window.motionQA.getState()');
  const roamArea=screen.getDisplayMatching(duringRoam).workArea;
  result.roam={started:roamStarted,before:beforeRoam,during:duringRoam,roamingState,routeClearedOnGrab,afterRoam,
    passed:roamStarted&&roamingState.action==='run'&&Math.hypot(duringRoam.x-beforeRoam.x,duringRoam.y-beforeRoam.y)>15
     &&routeClearedOnGrab&&afterRoam.action==='idle'&&duringRoam.x>=roamArea.x&&duringRoam.y>=roamArea.y
     &&duringRoam.x+duringRoam.width<=roamArea.x+roamArea.width&&duringRoam.y+duringRoam.height<=roamArea.y+roamArea.height};
  const openFromRightClick=async()=>{
   await petWindow.webContents.executeJavaScript(
    'document.getElementById("pet-stage").dispatchEvent(new MouseEvent("contextmenu",{button:2,bubbles:true,cancelable:true}))');
   for(let i=0;i<100;i++){if(panel&&panel.isVisible()&&await panel.webContents.executeJavaScript('!document.getElementById("roam").disabled'))return panel;await sleep(40);}
   throw new Error('Settings did not open from contextmenu');
  };
  const panelState=w=>w.webContents.executeJavaScript(`(()=>{
   const buttons=Object.fromEntries([...document.querySelectorAll('[role=switch]')].map(b=>[b.id,{checked:b.getAttribute('aria-checked'),value:b.querySelector('.value').textContent}]));
   return {buttons,feedback:document.getElementById('feedback').textContent,
    fits:document.querySelector('footer').getBoundingClientRect().bottom<=innerHeight,hasFocus:document.hasFocus()};
  })()`);
  const clickPanel=async(w,key)=>{
   const rect=await w.webContents.executeJavaScript(`document.getElementById(${JSON.stringify(key)}).getBoundingClientRect().toJSON()`);
   const x=Math.round(rect.x+rect.width*.5),y=Math.round(rect.y+rect.height*.5);
   w.webContents.sendInputEvent({type:'mouseDown',x,y,button:'left',clickCount:1,modifiers:['leftButtonDown']});
   w.webContents.sendInputEvent({type:'mouseUp',x,y,button:'left',clickCount:1});await sleep(130);
  };
  const settingsWindow=await openFromRightClick(),initial=await panelState(settingsWindow);
  const routeBlocked=await petWindow.webContents.executeJavaScript('window.motionHost.planRoam().then(p=>p===null)');
  await clickPanel(settingsWindow,'roam');
  const switched=await panelState(settingsWindow);
  await clickPanel(settingsWindow,'autoIdle');
  const switchedIdle=await panelState(settingsWindow);
  fs.writeFileSync(path.join(qa,'lab-runtime-settings.png'),(await settingsWindow.webContents.capturePage()).toPNG());
  await clickPanel(settingsWindow,'close');const closedByButton=settingsWindow.isDestroyed();
  const reopenedWindow=await openFromRightClick(),reopened=await panelState(reopenedWindow);
  reopenedWindow.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});await sleep(150);
  const closedByEscape=reopenedWindow.isDestroyed();
  result.settingsPanel={initial,switched,switchedIdle,reopened,closedByButton,closedByEscape,routeBlocked,
   passed:initial.buttons.autoIdle.value==='开启'&&initial.buttons.roam.value==='关闭'&&initial.fits
    &&switched.buttons.roam.checked==='true'&&switched.feedback==='已开启全屏随机漫游'
    &&switchedIdle.buttons.autoIdle.value==='关闭'&&switchedIdle.feedback==='已关闭随机待机'
    &&reopened.buttons.roam.value==='开启'&&reopened.buttons.autoIdle.value==='关闭'
    &&closedByButton&&closedByEscape&&routeBlocked};
  result.rendererErrors=errors;result.success=result.success&&result.actualDOMDrag.passed&&errors.length===0&&result.referenceFailures.length===0&&floatingResult.success&&transparentCorners&&follows&&onScreen&&result.roam.passed&&result.settingsPanel.passed;
  fs.writeFileSync(path.join(qa,'lab-runtime-test.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));app.exit(result.success?0:1);
 }catch(error){fs.writeFileSync(path.join(qa,'lab-runtime-test.json'),JSON.stringify({success:false,error:String(error),errors},null,2));console.error(error);app.exit(1);}
}).catch(error=>{fs.writeFileSync(path.join(app.getPath('userData'),'startup-error.log'),String(error.stack||error));if(!testing&&!startupCheck)dialog.showErrorBox('光桌宠无法启动','启动失败，详情已写入用户数据目录的 startup-error.log。');app.exit(1);});
app.on('before-quit',()=>{stopRoam(petWindow,false);savePosition(petWindow);for(const w of BrowserWindow.getAllWindows())stopDrag(w);tray?.destroy();});
app.on('window-all-closed',()=>app.quit());
