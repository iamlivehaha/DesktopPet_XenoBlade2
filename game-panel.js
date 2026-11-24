'use strict';
const $=id=>document.getElementById(id);
const SLOT_KEYS=['weapon','armor','accessory'];
let state=null,currentTab='dungeons',busy=false,notice='选择副本开始练级，赚取金币与装备。',timer=null;
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rarityTag=r=>`<span class="rarity-label r-${escapeHtml(r)}">${escapeHtml(state?.rarities?.[r]?.name||r)}</span>`;
const thumb=it=>{
 const slot=it?.slot||'weapon',rarity=it?.rarity||'common';
 const src=`assets/item-icons/${slot}-${rarity}.png`;
 return `<span class="item-thumb r-${escapeHtml(rarity)}${it?'':' empty'}"><img src="${src}" alt=""></span>`;
};
const statsText=it=>['atk:'+it.atk,'def:'+it.def,'luck:'+it.luck].filter(x=>!x.endsWith(':0')).map(x=>({atk:'攻击 +',def:'防御 +',luck:'幸运 +'})[x.split(':')[0]]+x.split(':')[1]).join(' · ')||'无属性加成';
function setNotice(text){notice=text;$('game-feedback').textContent=text;}
let battle=null,battleFrames=null;
const personaAsset=a=>String(a||'').replace('/mythra/',`/${battleFrames?.persona||'mythra'}/`);
function stopBattle(){
 if(battle){clearTimeout(battle.timer);clearTimeout(battle.encounter);clearInterval(battle.progressTimer);battle=null;}
 $('battle-stage').hidden=true;$('battle-enemy').hidden=true;
}
function showDamage(value){
 const el=$('battle-damage');el.textContent='-'+value;el.classList.remove('show');void el.offsetWidth;el.classList.add('show');
}
function updateHp(enemy){$('enemy-hp-bar').style.width=Math.max(0,enemy.hp/enemy.maxHp*100)+'%';}
function runFrames(){
 if(!battle||battle.mode!=='run')return;
 const frames=battleFrames?.run||[],f=frames[battle.frame++%frames.length];
 if(f)$('battle-actor-img').src=personaAsset(f.asset);
 if(f)battle.timer=setTimeout(runFrames,f.ms);
}
function slashFrames(enemy){
 if(!battle||battle.mode!=='slash')return;
 const frames=battleFrames?.slash||[],f=frames[battle.slashIndex++%frames.length];
 if(f)$('battle-actor-img').src=personaAsset(f.asset);
 if(battle.slashIndex%3===0&&f){
  const damage=Math.max(1,Math.round(battle.atk*(0.8+Math.random()*0.5)));
  enemy.hp=Math.max(0,enemy.hp-damage);updateHp(enemy);showDamage(damage);
  const body=$('enemy-body');body.classList.add('hit');setTimeout(()=>body.classList.remove('hit'),120);
  if(enemy.hp<=0){killEnemy(enemy);return;}
 }
 if(f)battle.timer=setTimeout(()=>slashFrames(enemy),f.ms);
}
function killEnemy(enemy){
 if(!battle)return;
 const boss=Boolean(enemy.isBoss);battle.index++;battle.slashIndex=0;
 $('battle-enemy').hidden=true;
 if(boss)window.gameHost.reportBossDefeated().catch(()=>{});
 const dungeon=state?.dungeons?.find(d=>d.id===battle.id);
 $('battle-hud-text').textContent=`${dungeon?.name||'副本'} · ${battle.index}/${battle.enemies.length}`;
 battle.mode='run';runFrames();scheduleEncounter(1500);
}
function scheduleEncounter(ms){
 if(!battle)return;
 battle.encounter=setTimeout(()=>{
  if(!battle)return;
  if(battle.index>=battle.enemies.length){scheduleEncounter(1600);return;}
  const enemy=battle.enemies[battle.index];
  $('battle-enemy').hidden=false;
  $('enemy-body').classList.toggle('boss',Boolean(enemy.isBoss));
  $('enemy-name').textContent=enemy.name+(enemy.isBoss?' · BOSS':'');
  updateHp(enemy);battle.mode='slash';battle.slashIndex=0;slashFrames(enemy);
 },ms);
}
async function startBattle(game){
 const config=game.activeRun?.battle;if(!config)return;
 stopBattle();
 if(!battleFrames)battleFrames=await window.gameHost.getBattleFrames().catch(()=>null);
 if(!battleFrames)return;
 battle={...config,id:game.activeRun.id,mode:'run',frame:0,slashIndex:0,
  start:Date.now(),end:game.activeRun.endsAt,timer:null,encounter:null,progressTimer:null};
 $('battle-stage').hidden=false;$('battle-enemy').hidden=true;
 const dungeon=state?.dungeons?.find(d=>d.id===battle.id);
 $('battle-hud-text').textContent=`${dungeon?.name||'副本'} · 0/${config.enemies.length}`;
 runFrames();scheduleEncounter(1200);
 battle.progressTimer=setInterval(()=>{
  if(!battle)return;
  const total=Math.max(1,battle.end-battle.start);
  $('battle-progress').style.width=Math.min(100,Math.max(0,(Date.now()-battle.start)/total*100))+'%';
 },120);
}
function paintHero(){
 if(!state)return;
 $('hero-name').textContent=`Lv.${state.level} · ${state.power} 战力`;
 $('hero-gold').textContent=`${state.gold} 金`;
 $('exp-bar').style.width=Math.min(100,state.exp/state.expToNext*100)+'%';
 $('exp-text').textContent=`${state.exp} / ${state.expToNext} EXP`;
 $('power-text').textContent=`战力 ${state.power} · 通关 ${state.totalRuns} 次`;
 $('bag-count').textContent=`${state.inventory.length}/${state.maxBag}`;
}
function renderDungeons(){
 const run=state.activeRun;
 const activeHtml=run?`<div class="active-run"><b>正在挑战：${escapeHtml(state.dungeons.find(d=>d.id===run.id)?.name||run.id)}</b><span id="run-countdown">剩余 ${Math.ceil(run.remaining/1000)} 秒</span></div>`:'';
 const cards=state.dungeons.map(d=>{
  const locked=!d.unlocked,disabled=locked||Boolean(run)||busy||state.gold<d.fee;
  const label=locked?`需要 Lv.${d.minLevel}`:run?'副本进行中':state.gold<d.fee?'金币不足':'开始挑战';
  return `<div class="card" data-id="${d.id}"><div class="card-head"><b>${escapeHtml(d.name)}</b><em>Lv.${d.minLevel}+ · ${Math.round(d.duration/1000)} 秒</em></div>
   <p>${escapeHtml(d.desc)} · 入场 ${d.fee} 金</p>
   <div class="meta-row"><span>经验 ${d.exp[0]}-${d.exp[1]}</span><span>金币 ${d.gold[0]}-${d.gold[1]}</span><span>掉落率 ${Math.round(d.drop*100)}%</span><span>已通关 ${state.runs[d.id]?.clears||0} 次</span></div>
   <button data-action="start" data-id="${d.id}" ${disabled?'disabled':''}>${label}</button></div>`;
 }).join('');
 $('dungeon-cards').innerHTML=activeHtml+`<div class="section-title">可挑战副本</div>`+cards;
 if(timer)clearInterval(timer);
 if(run)timer=setInterval(()=>{
  const el=$('run-countdown');if(!el){clearInterval(timer);return;}
  const left=Math.max(0,Math.ceil((run.endsAt-Date.now())/1000));
  el.textContent=`剩余 ${left} 秒`;
 },1000);
}
function renderInventory(){
 const eq=SLOT_KEYS.map(slot=>{
  const it=state.equipment[slot];
  return `<div class="equip-slot">${thumb(it||{slot,rarity:'common'})}<span>${escapeHtml(state.slots[slot])}</span><b>${it?escapeHtml(it.name):'未装备'}</b>${it?`<button data-action="unequip" data-slot="${slot}">卸下</button>`:''}</div>`;
 }).join('');
 const bag=state.inventory.length?state.inventory.map(it=>{
  const worn=Object.values(state.equipment).some(e=>e?.uid===it.uid);
  return `<div class="card with-thumb">${thumb(it)}<div class="card-body"><div class="card-head"><b>${escapeHtml(it.name)}</b>${rarityTag(it.rarity)}</div>
   <div class="meta-row"><span>${escapeHtml(state.slots[it.slot])}</span><span>需要 Lv.${it.levelReq}</span><span>${escapeHtml(statsText(it))}</span></div>
   <button class="tiny ${worn?'ghost':''}" data-action="${worn?'unequip-slot':'equip'}" data-uid="${it.uid}" data-slot="${it.slot}" ${!worn&&state.level<it.levelReq?'disabled':''}>${worn?'已装备':'装备'}</button>
   <button class="tiny danger" data-action="sell" data-uid="${it.uid}">出售 ${it.price} 金</button></div></div>`;
 }).join(''):`<div class="empty-bag">背包空空如也，去副本或商店获取装备吧。</div>`;
 $('tab-inventory').innerHTML=`<div class="section-title">当前装备</div><div class="equip-slots">${eq}</div><div class="section-title">背包</div>${bag}`;
}
function renderShop(){
 const cards=state.shop.map(it=>{
  const locked=state.level<it.levelReq,poor=state.gold<it.price;
  return `<div class="card with-thumb">${thumb(it)}<div class="card-body"><div class="card-head"><b>${escapeHtml(it.name)}</b>${rarityTag(it.rarity)}</div>
   <div class="meta-row"><span>${escapeHtml(state.slots[it.slot])}</span><span>Lv.${it.levelReq}+</span><span>${escapeHtml(statsText(it))}</span></div>
   <button data-action="buy" data-uid="${it.uid}" ${locked||poor?'disabled':''}>${locked?`需要 Lv.${it.levelReq}`:poor?'金币不足':`购买 ${it.price} 金`}</button></div></div>`;
 }).join('');
 $('tab-shop').innerHTML=`<div class="section-title">装备商店 · 出售价约为原价四成</div>${cards}`;
}
function paint(){
 if(!state)return;
 paintHero();renderDungeons();renderInventory();renderShop();$('game-feedback').textContent=notice;
}
async function run(action,message){
 if(busy)return;
 busy=true;paint();
 try{
  const res=await action();
  if(res?.game)state=res.game;
  setNotice(typeof message==='function'?message(res):message);
 }catch(error){setNotice('操作失败：'+(error?.message||String(error)));}
 finally{busy=false;if(state){try{state=await window.gameHost.read();}catch{}}paint();}
}
$('tabs').addEventListener('click',e=>{
 const btn=e.target.closest('button[data-tab]');if(!btn)return;
 currentTab=btn.dataset.tab;
 for(const b of $('tabs').querySelectorAll('button'))b.classList.toggle('active',b===btn);
 for(const p of document.querySelectorAll('.tab-panel'))p.classList.toggle('active',p.id===`tab-${currentTab}`);
});
$('game-main').addEventListener('click',e=>{
 const b=e.target.closest('button[data-action]');if(!b)return;
 const {action,uid,id,slot}=b.dataset;
 if(action==='start')run(()=>window.gameHost.startRun(id),res=>{startBattle(res);return '副本开始，奔跑遇敌中…';});
 if(action==='buy')run(()=>window.gameHost.buy(uid),res=>`购买成功：${res.item.name} 已放入背包。`);
 if(action==='sell')run(()=>window.gameHost.sell(uid),res=>`出售成功：+${res.item.price} 金。`);
 if(action==='equip')run(()=>window.gameHost.equip(uid),'装备成功，战力已更新。');
 if(action==='unequip')run(()=>window.gameHost.unequip(slot),'已卸下装备。');
 if(action==='unequip-slot')run(()=>window.gameHost.unequip(slot),'已卸下装备。');
});
$('close').addEventListener('click',()=>window.gameHost.close());
window.gameHost.onChange(next=>{state=next;if(!next?.activeRun&&battle)stopBattle();paint();});
window.gameHost.onEvent(value=>{
 if(value.type==='game:reward'){stopBattle();setNotice(value.say||'副本结算完成！');}
 if(value.type==='game:level-up')setNotice(value.say||'等级提升了！');
});
function paintStats(st){
 if(!st)return;
 for(const k of ['satiety','mood','energy']){
  const v=Number(st[k])||0,bar=$(`status-${k}`),val=$(`status-${k}-val`);
  if(bar)bar.style.width=v+'%';
  if(val)val.textContent=v;
 }
}
window.gameHost.onPetState(paintStats);
window.gameHost.getPetState().then(paintStats).catch(()=>{});
window.gameHost.read().then(next=>{state=next;paint();}).catch(()=>setNotice('读取冒险数据失败，请重新打开。'));
const header=document.querySelector('header');let dragging=false;
header.addEventListener('mousedown',e=>{
 if(e.button!==0||e.target.closest('button'))return;
 dragging=true;window.gameHost.dragStart(e.clientX,e.clientY);e.preventDefault();
});
window.addEventListener('mousemove',e=>{if(dragging)window.gameHost.dragMove(e.clientX,e.clientY);});
window.addEventListener('mouseup',()=>{if(dragging){dragging=false;window.gameHost.dragEnd();}});
