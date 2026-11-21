'use strict';
(async()=>{
 const {manifest,nativeUrlGroups,testing,floating,autoIdle,roam,persona:initialPersona}=await window.motionHost.getManifest();
 const $=id=>document.getElementById(id);
 $('asset-badge').textContent=`${Object.keys(manifest.actions).length} 类动作 · ${manifest.assets.length} 张实际姿势`;
 if(floating){document.body.classList.add('floating');document.documentElement.classList.add('floating-root');}
 const images=new Map(),references=new Map(),legacy=new Map(),referenceFailures=[];
 const pyraImages=new Map(),transitionImages=new Map();
 let currentPersona=initialPersona==='pyra'?'pyra':'mythra';
 let personaTransition=null;
 const records=new Map(manifest.assets.map(r=>[r.file,r]));
 const decode=async url=>{
  const i=new Image();
  await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('Image load timeout')),12000);
   i.onload=()=>{clearTimeout(timer);resolve();};i.onerror=()=>{clearTimeout(timer);reject(new Error('Image load event failed'));};i.src=url;
  });
  // Wait for load BEFORE requesting decode. Issuing decode while the file/data
  // request is still being installed produced intermittent EncodingError here.
  await i.decode();if(!i.naturalWidth)throw new Error('Empty decoded image');return i;
 };
 await Promise.all(manifest.assets.map(async r=>images.set(r.file,await decode(r.file))));
 // 焰（pyra）色调变体：同名文件，路径前缀替换为 assets/pyra/
 await Promise.all(manifest.assets.map(async r=>{
  const alt=r.file.replace(/^assets\/mythra\//,'assets/pyra/');
  try{pyraImages.set(r.file,await decode(alt));}catch(e){referenceFailures.push({kind:'pyra',url:alt,error:String(e)});}
 }));
 // 人格切换特效帧
 for(const dir of ['to-pyra','to-mythra'])for(let i=0;i<12;i++){
  try{transitionImages.set(`${dir}-${i}`,await decode(`assets/transition/${dir}-${String(i).padStart(2,'0')}.png`));}catch{}
 }
 document.documentElement.dataset.persona=currentPersona;
 // Inventory contains 6181 original files; the runtime never preloads that
 // inventory. Only this pack's actual active references are optionally decoded.
 if(!floating){
  await Promise.all([...new Set(Object.values(nativeUrlGroups).flat().filter(Boolean))].map(async u=>{
   try{references.set(u,await decode(u));}catch(e){referenceFailures.push({kind:'native',url:u,error:String(e)});}
  }));
  // Reuse panel = the actual six full-res source crops, already decoded above.
  // Do not load a redundant large source-board texture: that caused flaky
  // secondary Image.decode failures although all 18 motion cels were valid.
  for(const r of manifest.reuse){
   const board=document.createElement('canvas');board.width=768;board.height=512;
   const ctx=board.getContext('2d');ctx.fillStyle='#f8fbfd';ctx.fillRect(0,0,768,512);
   for(let i=0;i<6;i++){const im=images.get(`assets/mythra/reused-${r.action}-${i}.png`);ctx.drawImage(im,i%3*256,Math.floor(i/3)*256,256,256);}
   legacy.set(r.action,board);
  }
 }
 let controller=new window.NativeMotionController(manifest);
 const scheduler=new window.IdleScheduler(manifest.idleScheduler,{enabled:autoIdle!==false});
 $('auto-idle').checked=autoIdle!==false;
 scheduler.interact(performance.now(),controller);
 let frozen=false,displayed=null,drop=null,lastRender=null,hovered=false,dragging=false,press=null;
 let hoverTimer=null,leaveTimer=null,demoTimer=null,hold=false,suppressHover=0,qaNoHover=false;
 let roamEnabled=floating&&roam,roaming=null,requestingRoute=false,roamDir=1,nextRoam=Infinity,panelOpen=false;
 const planNextRoam=(now)=>nextRoam=now+5000+Math.random()*6500;
 planNextRoam(performance.now());
 let previous=performance.now(),fpsAt=previous,renderCount=0;
 const canvases=[$('original'),$('pet')],contexts=canvases.map(c=>c.getContext('2d',{willReadFrequently:true}));
 const names={dynamic:'D · 悬空动态',start:'A · 进入',loop:'B · 循环',end:'C · 收尾'};
 for(const [key,d] of Object.entries(manifest.actions)){const o=document.createElement('option');o.value=key;o.textContent=d.label;$('action').append(o);}
 $('action').value='headpat';
 function clearHover(){clearTimeout(hoverTimer);clearTimeout(leaveTimer);}
 function interact(){scheduler.interact(performance.now(),controller);}
 function updateTiming(action=$('action').value){
  if(typeof action!=='string')action=$('action').value;
  const d=manifest.actions[action];$('timing').replaceChildren();
  for(const key of (d.kind==='drag'?['dynamic','start','loop','end']:['start','loop','end'])){
   const e=document.createElement('span'),b=document.createElement('b');e.textContent=names[key]+(key==='loop'&&d.loopPasses?' ×'+d.loopPasses:'');
   b.textContent=d[key].frames.reduce((n,f)=>n+f.ms,0)*(key==='end'?(d.releaseTimeScale||1):key==='loop'?(d.loopPasses||1):1)+' ms';e.append(b);$('timing').append(e);
  }
 }
 $('action').addEventListener('change',updateTiming);updateTiming();
 function render(s,diagnostic=false){
  const prev=displayed;displayed=s;
  const set=currentPersona==='pyra'?pyraImages:images;
  const im=set.get(s.asset)||images.get(s.asset);if(!im)throw new Error('No decoded cel '+s.asset);
  if(prev?.action!==s.action)updateTiming(s.action);
  const rec=records.get(s.asset),d=manifest.actions[s.action];let ox=0,oy=0;
  if(!diagnostic&&s.action==='drag'&&s.phase==='end'){
   if(!drop||prev?.action!=='drag'||prev.phase!=='end'){
    const from=lastRender?.crown||manifest.actions.drag.grabAnchor;
    const to=rec.crownPoint;drop={x:from[0]-to[0],y:from[1]-to[1]};
   }
   // Root motion is only the physical landing arc, not fabricated pose frames.
   // Preserve the grab/head position at release and ease down to the drawn C.
   const q=Math.min(1,(s.phaseTime||0)/(d.landingEaseMs||280)),weight=1-q*q*(3-2*q);ox=drop.x*weight;oy=drop.y*weight;
  }else if(!diagnostic)drop=null;
  const right=canvases[1],ctx=contexts[1];ctx.clearRect(0,0,right.width,right.height);
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
  ctx.save();
  if(s.action==='run'&&roamDir<0&&s.asset!==manifest.neutralAsset){ctx.translate(right.width,0);ctx.scale(-1,1);}
  // 人格切换时，新旧形态交叉淡化
  if(personaTransition&&!diagnostic){
   const otherSet=currentPersona==='pyra'?images:pyraImages;
   const otherIm=otherSet.get(s.asset);
   const t=personaTransition.progress;
   if(otherIm){
    ctx.globalAlpha=1-t;ctx.drawImage(otherIm,ox*right.width/500,oy*right.height/500,right.width,right.height);
    ctx.globalAlpha=t;
   }
  }
  ctx.drawImage(im,ox*right.width/500,oy*right.height/500,right.width,right.height);
  ctx.globalAlpha=1;
  // 光晕特效帧叠加在角色之上
  if(personaTransition&&!diagnostic){
   const fx=transitionImages.get(`${personaTransition.dir}-${Math.min(11,Math.floor(personaTransition.progress*12))}`);
   if(fx)ctx.drawImage(fx,0,0,right.width,right.height);
  }
  ctx.restore();
  lastRender={asset:s.asset,crown:[(rec.crownPoint?.[0]??250)+ox,(rec.crownPoint?.[1]??120)+oy],offset:[ox,oy]};
  if(!floating){
   const c=canvases[0],rctx=contexts[0];rctx.clearRect(0,0,c.width,c.height);
   const source=nativeUrlGroups[s.action]?.[s.nativeIndex??0];const ref=references.get(source);
   const old=legacy.get(d.legacySourceKey);const picture=ref||old;
   if(picture){const ratio=Math.min(c.width/picture.width,c.height/picture.height);
    const w=picture.width*ratio,h=picture.height*ratio;rctx.drawImage(picture,(c.width-w)/2,(c.height-h)/2,w,h);}
   $('original-state').textContent=ref?'原版 Core · 同步帧序':old?'复用旧稿 · 高分辨率原图':'无本机原版参考';
  }
  $('phase').textContent=d.label+' · '+names[s.phase];
  const count=manifest.nativeTimelines[s.action]?.length;
  $('frame').textContent=`${d.label} · ${names[s.phase]} · ${s.nativeIndex!==null?'原版帧 '+(s.nativeIndex+1)+'/'+count:'重绘姿势 '+(s.index+1)} · ${s.frameMs} ms`;
  $('position').style.width=count&&s.nativeIndex!==null?((s.nativeIndex+1)/count*100)+'%':((s.index+1)/d[s.phase].frames.length*100)+'%';
 }
 function resize(){for(const c of canvases){const r=c.getBoundingClientRect();c.width=Math.max(1,Math.round(r.width*devicePixelRatio));c.height=Math.max(1,Math.round(r.height*devicePixelRatio));}render(displayed||controller.snapshot());}
 function interruptRoam(){
  if(roaming){window.motionHost.stopRoam(roaming.id);roaming=null;controller.release('roam');}
  planNextRoam(performance.now());
 }
 async function maybeRoam(now,diagnostic=false){
  const blocked=()=>!roamEnabled||panelOpen||(!diagnostic&&(qaNoHover||hovered||press||dragging||frozen))||controller.action!=='idle';
  if(!floating||roaming||requestingRoute||now<nextRoam||blocked())return false;
  requestingRoute=true;planNextRoam(now);
  try{
   const plan=await window.motionHost.planRoam();
   if(!plan)return false;
   if(blocked()){window.motionHost.stopRoam(plan.id);return false;}
   roaming=plan;roamDir=plan.direction;
   controller.request('roam','run',20,{hold:true});window.motionHost.startRoam(plan.id);
   return true;
  }finally{requestingRoute=false;}
 }
 function animate(now){const delta=now-previous;previous=now;
  if(personaTransition){
   personaTransition.progress=Math.min(1,(now-personaTransition.start)/personaTransition.duration);
   if(personaTransition.progress>=1)personaTransition=null;
  }
  if(!frozen){
   if(roamEnabled&&!panelOpen&&now>=nextRoam&&!hovered&&!press&&!dragging&&controller.action==='idle'&&!requestingRoute){
    maybeRoam(now).catch(e=>window.motionHost.reportError(String(e)));
   }
   scheduler.tick(now,controller,panelOpen||dragging||hovered||requestingRoute||Boolean(roaming));render(controller.tick(delta));
  }
  renderCount++;if(now-fpsAt>=1200){$('fps').textContent=`渲染 ${Math.round(renderCount*1000/(now-fpsAt))} fps · 姿势使用实帧时长`;renderCount=0;fpsAt=now;}
  requestAnimationFrame(animate);
 }
 function scheduleHover(){
  if(qaNoHover||panelOpen||dragging||press||controller.action==='drag'||performance.now()<suppressHover)return;
  clearHover();hoverTimer=setTimeout(()=>{if(hovered&&!panelOpen&&!dragging&&!press){interact();controller.request('hover','headpat',60,{hold:true});}},90);
 }
 const stage=$('pet-stage');
 stage.addEventListener('pointerenter',()=>{hovered=true;if(!qaNoHover)interruptRoam();scheduleHover();});
 stage.addEventListener('pointerleave',()=>{hovered=false;clearHover();if(!dragging)leaveTimer=setTimeout(()=>controller.release('hover'),100);});
 function beginDrag(){
  if(dragging||!press)return;clearHover();clearTimeout(demoTimer);hold=false;$('hold').setAttribute('aria-pressed','false');interact();
  ['manual','hold','hover','autonomy'].forEach(o=>controller.release(o));
  controller.request('drag','drag',100,{hold:true});dragging=true;
  window.motionHost.beginDrag().catch(e=>window.motionHost.reportError(String(e)));
 }
 stage.addEventListener('pointerdown',e=>{
  if(e.button!==0)return;e.preventDefault();interruptRoam();clearHover();interact();
  press={id:e.pointerId,x:e.screenX,y:e.screenY,lastX:e.screenX,lastY:e.screenY,timer:setTimeout(beginDrag,160)};
  stage.setPointerCapture(e.pointerId);
 });
 stage.addEventListener('pointermove',e=>{
  if(!press)return;
  if(!dragging&&Math.hypot(e.screenX-press.x,e.screenY-press.y)>4)beginDrag();
  if(dragging&&Math.abs(e.screenX-press.lastX)+Math.abs(e.screenY-press.lastY)>5)controller.notifyDragMotion();
  press.lastX=e.screenX;press.lastY=e.screenY;
 });
 function finishPress(cancelled=false){
  if(!press&&!dragging)return;const p=press;press=null;if(p)clearTimeout(p.timer);
  if(dragging){dragging=false;controller.release('drag');window.motionHost.endDrag();suppressHover=performance.now()+700;}
  else if(!cancelled)controller.request('manual','headpat',40);
  if(p&&stage.hasPointerCapture(p.id))stage.releasePointerCapture(p.id);interact();
 }
 stage.addEventListener('pointerup',()=>finishPress());stage.addEventListener('pointercancel',()=>finishPress(true));
 stage.addEventListener('lostpointercapture',()=>finishPress(true));
 stage.addEventListener('contextmenu',e=>{e.preventDefault();interruptRoam();window.motionHost.popupMenu();});
 function stop(){interruptRoam();clearHover();clearTimeout(demoTimer);finishPress(true);hold=false;$('hold').setAttribute('aria-pressed','false');
  ['manual','hold','hover','autonomy','drag'].forEach(o=>controller.release(o));interact();}
 $('play').addEventListener('click',()=>{stop();const action=$('action').value;
  controller.request('manual',action,40,{hold:action==='drag'});
  if(action==='drag')demoTimer=setTimeout(()=>controller.release('manual'),2200);
 });
 $('hold').addEventListener('click',()=>{hold=!hold;$('hold').setAttribute('aria-pressed',String(hold));interact();
  if(hold)controller.request('hold',$('action').value,$('action').value==='drag'?100:50,{hold:true});else controller.release('hold');});
 $('stop').addEventListener('click',stop);
 const saveAutonomy=()=>{scheduler.setEnabled($('auto-idle').checked,performance.now(),controller);window.motionHost.saveAutoIdle($('auto-idle').checked);};
 $('auto-idle').addEventListener('change',saveAutonomy);
 $('desktop').addEventListener('click',()=>window.motionHost.openFloating());
 function performVoiceAction(action){
 if(!action||!manifest.actions[action])return false;
 interact();interruptRoam();clearHover();
 ['manual','hold','hover','autonomy','voice'].forEach(o=>controller.release(o));
 controller.request('voice',action,70,{hold:action==='drag'||action==='run'});
 if(action==='drag')setTimeout(()=>controller.release('voice'),2200);
 if(action==='run'&&floating&&!roamEnabled){roamEnabled=true;planNextRoam(performance.now());}
 return true;
}
function switchPersona(target){
 target=target==='pyra'?'pyra':'mythra';
 if(target===currentPersona)return false;
 const dir=target==='pyra'?'to-pyra':'to-mythra';
 currentPersona=target;
 document.documentElement.dataset.persona=target;
 personaTransition={dir,progress:0,start:performance.now(),duration:520};
 interact();
 window.motionHost.savePersona(target).catch(()=>{});
 return true;
}
window.motionHost.onVoice(value=>{
 if(value?.type==='voice-reply'){
  if(value.action)performVoiceAction(value.action);
  if(value.control==='switch-persona')switchPersona(value.persona||(currentPersona==='pyra'?'mythra':'pyra'));
 }
 if(value?.type==='persona-change'&&value.persona)switchPersona(value.persona);
});
window.motionHost.onMenu(value=>{
  if(value?.type==='set-autonomy'){$('auto-idle').checked=value.enabled;scheduler.setEnabled(value.enabled,performance.now(),controller);}
  else if(value?.type==='set-roam'){roamEnabled=floating&&value.enabled;interruptRoam();}
  else if(value?.type==='roam-ended'&&roaming?.id===value.id){roaming=null;controller.release('roam');planNextRoam(performance.now());}
  else if(value?.type==='panel-open'){panelOpen=value.enabled;clearHover();controller.release('hover');interact();interruptRoam();}
 });
 window.addEventListener('blur',()=>{clearHover();controller.release('hover');finishPress(true);});window.addEventListener('resize',resize);
 resize();requestAnimationFrame(animate);

 window.motionQA={
  startupInfo(){return{decodedImages:images.size,actions:Object.keys(manifest.actions),floating,initialAction:controller.action,originalReferenceImages:references.size,assetPathsRelative:manifest.assets.every(r=>!r.file.includes(':')&&!r.file.startsWith('..'))};},
  show(index,action='headpat'){
   frozen=true;let s=controller.snapshot();
   if(index===null){s={...s,action:'idle',phase:'loop',index:0,asset:manifest.neutralAsset,nativeIndex:null,phaseTime:1000};}
   else if(manifest.nativeTimelines[action]){const f=manifest.nativeTimelines[action][index];s={...s,action,phase:({D:'dynamic',A:'start',B:'loop',C:'end',S:'loop'})[f.phase],index:0,asset:f.asset,nativeIndex:index,frameMs:f.ms,phaseTime:1000};}
   else{const d=manifest.actions[action],all=['start','loop','end'].flatMap(p=>d[p].frames.map(f=>({...f,phase:p})));const f=all[index];s={...s,action,phase:f.phase,index:0,asset:f.asset,nativeIndex:null,frameMs:f.ms,phaseTime:1000};}
   render(s,true);return true;
  },
  getState(){const s=controller.snapshot();const set=currentPersona==='pyra'?pyraImages:images;const im=displayed?set.get(displayed.asset):null;return{action:s.action,phase:s.phase,index:s.index,dragging,pressing:Boolean(press),intents:controller.intents.size,persona:currentPersona,asset:displayed?.asset,imgW:im?.naturalWidth,pyraCount:pyraImages.size,mythraCount:images.size,referenceFailures:referenceFailures.slice(0,3)};},
  async startRoamTest(){
   if(!testing||!floating)return false;
   window.motionQA.prepareInputTest();roamEnabled=true;nextRoam=0;
   return maybeRoam(performance.now(),true);
  },
  stopRoamTest(){if(testing){roamEnabled=false;interruptRoam();}},
  prepareInputTest(){frozen=false;qaNoHover=true;hovered=false;stop();scheduler.enabled=false;controller=new window.NativeMotionController(manifest);drop=null;render(controller.snapshot());return stage.getBoundingClientRect().toJSON();},
  async run(){
   if(!testing)throw new Error('Diagnostic mode requires --self-test');frozen=true;qaNoHover=true;clearHover();scheduler.enabled=false;
   const checks=[];const check=(name,passed,detail)=>{checks.push({name,passed,detail});if(!passed)throw new Error(name+': '+JSON.stringify(detail));};
   check('all real PNGs predecoded, fixed finite cache',images.size===manifest.assets.length,images.size);
   const geometry=[];
   for(const a of manifest.assets){const s={...controller.snapshot(),action:'idle',phase:'loop',asset:a.file,nativeIndex:null,index:0};render(s,true);
    const c=canvases[1],px=contexts[1].getImageData(0,0,c.width,c.height).data;let count=0,minX=c.width,maxX=-1,minY=c.height,maxY=-1;
    for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++)if(px[(y*c.width+x)*4+3]>128){count++;minX=Math.min(x,minX);maxX=Math.max(x,maxX);minY=Math.min(y,minY);maxY=Math.max(y,maxY);}
    const valid=count>c.width*c.height*.09&&minX>0&&minY>0&&maxX<c.width-1&&maxY<c.height-1;
    check('actual render: '+a.name,valid,{count,minX,maxX,minY,maxY});geometry.push({asset:a.file,count,minX,maxX,minY,maxY});
   }
   const pump=ms=>{for(let t=0;t<ms;t+=5)render(controller.tick(Math.min(5,ms-t)));};
   for(const action of ['headpat','run',...manifest.idleScheduler.actions.map(r=>r.action)]){
    controller=new window.NativeMotionController(manifest);controller.request('manual',action,40);
    const d=manifest.actions[action];
    const ms=['start','loop','end'].reduce((n,p)=>n+d[p].frames.reduce((v,f)=>v+f.ms,0)*(p==='loop'?(d.loopPasses||1):1),0);
    pump(ms-1);check(action+' remains active until its full one-shot duration',controller.action===action,controller.snapshot());
    pump(1);
    check(action+' actual renderer enters/loops/ends/returns',controller.action==='idle',controller.history.filter(r=>r.event==='enter').map(r=>r.action+'/'+r.phase));
   }
   controller=new window.NativeMotionController(manifest);controller.request('hover','headpat',60,{hold:true});pump(600);
   const before=JSON.stringify(controller.snapshot());for(let i=0;i<10000;i++)controller.request('hover','headpat',60,{hold:true});
   check('hover flood does not reset decoded cels',JSON.stringify(controller.snapshot())===before,controller.intents.size);
   controller.release('hover');pump(900);check('hover releases naturally',controller.action==='idle',controller.snapshot());
   controller.request('drag','drag',100,{hold:true});pump(300);const grabbed=lastRender.crown;
   controller.release('drag');render(controller.snapshot());const dropStart=lastRender.crown;
   check('landing keeps head root continuous at release',Math.hypot(grabbed[0]-dropStart[0],grabbed[1]-dropStart[1])<1.5,{grabbed,dropStart});
   const recovery=manifest.actions.drag.end.frames.reduce((n,f)=>n+f.ms,0)*(manifest.actions.drag.releaseTimeScale||1);
   pump(recovery-1);check('release plays full slower recovery',controller.action==='drag',controller.snapshot());
   pump(1);check('drawn release/get-up returns to breathing',controller.action==='idle',controller.snapshot());
   const {IdleScheduler}=window;let seed=41;const rnd=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);
   const sch=new IdleScheduler(manifest.idleScheduler,{random:rnd});const chosen=[];
   for(let now=0;now<600000;now+=50){controller.tick(50);const a=sch.tick(now,controller);if(a)chosen.push(a);}
   const roundSize=manifest.idleScheduler.actions.length;
   const rounds=Array.from({length:Math.floor(chosen.length/roundSize)},(_,i)=>chosen.slice(i*roundSize,(i+1)*roundSize));
   check('all idle motions appear exactly once in each complete shuffled round',
    rounds.length>=4&&rounds.every(round=>new Set(round).size===roundSize)&&chosen.every((v,i)=>!i||v!==chosen[i-1]),rounds);
   frozen=false;let n=0;const t0=performance.now();await new Promise(resolve=>{const sample=t=>{n++;if(t-t0>=1500)resolve();else requestAnimationFrame(sample);};requestAnimationFrame(sample);});frozen=true;
   const fps=n*1000/(performance.now()-t0);check('real visible renderer rAF active',n>=15,{n,fps});
   return{success:true,checks,geometry,ownImages:images.size,referenceImages:references.size,legacySheets:legacy.size,referenceFailures,rafFPS:fps,
    redrawnDrawings:manifest.redraw?.drawings||0,dragDrawings:34,dragFrameEntries:40,actions:Object.keys(manifest.actions),noProceduralInbetweenArt:true};
  }
 };
})().catch(error=>{window.motionHost.reportError(error.stack||String(error));const e=document.getElementById('error');e.hidden=false;e.textContent=String(error.stack||error);});
