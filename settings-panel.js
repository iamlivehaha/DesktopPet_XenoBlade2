'use strict';
const keys=['autoIdle','roam'];
const copy={autoIdle:'随机待机',roam:'全屏随机漫游'};
const $=id=>document.getElementById(id);
let ready=false,pending=false;
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
window.petSettings.read().then(paint).catch(()=>{$('feedback').textContent='未能读取设置，请重新打开。';});
const personaBtns=['mythra','pyra'].map(k=>$(`persona-${k}`));
const PERSONA_META={
 mythra:{name:'光',kicker:'MYTHRA',portrait:'assets/mythra/headpat-C1.png',title:'光桌宠 · 快捷设置'},
 pyra:{name:'焰',kicker:'PYRA',portrait:'assets/pyra/headpat-C1.png',title:'焰桌宠 · 快捷设置'}
};
function paintPersona(p){
 const key=p in PERSONA_META?p:'mythra',meta=PERSONA_META[key];
 for(const b of personaBtns)b.classList.toggle('active',b.dataset.persona===key);
 document.documentElement.dataset.persona=key;
 document.title=meta.title;
 $('persona-kicker').textContent=meta.kicker;
 $('persona-title').textContent=`${meta.name} · 快捷设置`;
 $('portrait-img').src=meta.portrait;
}
for(const b of personaBtns)b.addEventListener('click',async()=>{
 if(pending)return;
 const target=b.dataset.persona;
 try{
  await window.petSettings.setPersona(target);
  paintPersona(target);
  $('feedback').textContent=`已切换为${PERSONA_META[target].name}的形态`;
 }catch{$('feedback').textContent='形态切换失败，请重试。';}
});
window.petSettings.getPersona().then(paintPersona).catch(()=>{});
for(const key of ['close','preview','voice','quit'])$(key).addEventListener('click',()=>window.petSettings.act(key));
window.addEventListener('keydown',e=>{if(e.key==='Escape')window.petSettings.act('close');});
