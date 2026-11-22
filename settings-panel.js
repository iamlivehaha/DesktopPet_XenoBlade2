'use strict';
const keys=['autoIdle','roam'];
const copy={autoIdle:'随机待机',roam:'全屏随机漫游'};
const $=id=>document.getElementById(id);
let ready=false,pending=false;
let appearance={persona:'mythra',outfit:'default',actions:0};
function paint(state){
 for(const key of keys){
  const b=$(key),on=state[key]===true;
  b.setAttribute('aria-checked',String(on));
  b.querySelector('.value').textContent=on?'开启':'关闭';
  b.querySelector('.mark').textContent=on?'✓':'−';
  b.disabled=pending;
 }
 ready=true;
}
for(const key of keys)$(key).addEventListener('click',async()=>{
 if(!ready||pending)return;
 pending=true;keys.forEach(k=>$(k).disabled=true);
 try{
  const state=await window.petSettings.set(key,$(key).getAttribute('aria-checked')!=='true');
  $('feedback').textContent=`已${state[key]?'开启':'关闭'}${copy[key]}`;
  pending=false;paint(state);$(key).focus({preventScroll:true});
 }catch{pending=false;keys.forEach(k=>$(k).disabled=false);$('feedback').textContent='设置未保存，请重试。';}
});
window.petSettings.onChange(paint);
function paintStats(st){
 if(!st)return;
 for(const k of ['satiety','mood','energy']){
  const v=Number(st[k])||0;
  const bar=$(`bar-${k}`),val=$(`val-${k}`);
  if(bar)bar.style.width=v+'%';
  if(val)val.textContent=v;
 }
}
window.petSettings.onPetState(paintStats);
window.petSettings.getPetState().then(paintStats).catch(()=>{});
window.petSettings.read().then(paint).catch(()=>{$('feedback').textContent='未能读取设置，请重新打开。';});
const personaBtns=['mythra','pyra'].map(k=>$(`persona-${k}`));
const outfitBtns=['default','new'].map(k=>$(`outfit-${k}`));
const PERSONA_META={
 mythra:{name:'光',kicker:'MYTHRA',title:'光桌宠 · 快捷设置'},
 pyra:{name:'焰',kicker:'PYRA',title:'焰桌宠 · 快捷设置'}
};
const OUTFIT_LABEL={default:'原初',new:'新装'};
function portraitFor(persona,outfit){
 return outfit==='new'?`assets/outfit-new/${persona}/headpat-0.png`:`assets/${persona}/headpat-C1.png`;
}
function paintAppearance(){
 const persona=appearance.persona==='pyra'?'pyra':'mythra';
 const outfit=appearance.outfit==='new'?'new':'default';
 const meta=PERSONA_META[persona];
 for(const b of personaBtns)b.classList.toggle('active',b.dataset.persona===persona);
 for(const b of outfitBtns)b.classList.toggle('active',b.dataset.outfit===outfit);
 document.documentElement.dataset.persona=persona;
 document.documentElement.dataset.outfit=outfit;
 document.title=meta.title;
 $('persona-kicker').textContent=`${meta.kicker} · ${OUTFIT_LABEL[outfit]}`;
 $('persona-title').textContent=`${meta.name} · ${OUTFIT_LABEL[outfit]} · 快捷设置`;
 $('portrait-img').src=portraitFor(persona,outfit);
 const status=$('appearance-status');
 if(status)status.textContent=`当前：${meta.name} · ${OUTFIT_LABEL[outfit]} · ${Number(appearance.actions)||0} 类动作`;
}
let appearanceRefresh=0;
async function refreshAppearance(){
 const ticket=++appearanceRefresh;
 try{const next=await window.petSettings.getAppearance();if(ticket!==appearanceRefresh)return;if(next)appearance={...appearance,...next};paintAppearance();}catch{}
}
for(const b of personaBtns)b.addEventListener('click',async()=>{
 if(pending)return;
 const target=b.dataset.persona;
 try{
  await window.petSettings.setPersona(target);
  appearance.persona=target;paintAppearance();refreshAppearance();
  $('feedback').textContent=`已切换为${PERSONA_META[target].name}的形态`;
 }catch{$('feedback').textContent='形态切换失败，请重试。';}
});
for(const b of outfitBtns)b.addEventListener('click',async()=>{
 if(pending)return;
 const target=b.dataset.outfit;
 try{
  await window.petSettings.setOutfit(target);
  appearance.outfit=target;paintAppearance();refreshAppearance();
  $('feedback').textContent=`已换上${OUTFIT_LABEL[target] === '新装' ? '新装' : '原初服饰'}`;
 }catch{$('feedback').textContent='换装失败，请重试。';}
});
window.petSettings.onAppearance(()=>{refreshAppearance();});
refreshAppearance();
for(const key of ['close','preview','voice','quit'])$(key).addEventListener('click',()=>window.petSettings.act(key));
// header 拖动（不含关闭按钮）
const header=document.querySelector('header');let dragging=false;
header.addEventListener('mousedown',e=>{
 if(e.button!==0||e.target.closest('button'))return;
 dragging=true;window.petSettings.dragStart(e.clientX,e.clientY);e.preventDefault();
});
window.addEventListener('mousemove',e=>{if(dragging)window.petSettings.dragMove(e.clientX,e.clientY);});
window.addEventListener('mouseup',()=>{if(dragging){dragging=false;window.petSettings.dragEnd();}});
window.addEventListener('keydown',e=>{if(e.key==='Escape')window.petSettings.act('close');});
