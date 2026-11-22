'use strict';
const {app}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const search=require('./search.cjs');

const configPath=()=>path.join(app.getPath('userData'),'voice-settings.json');
const ACTIONS=['idle','headpat','cheer','lookAround','stretch','drag','run','sofa','book','tea',
 'idleSword','idleStretch','idleSpark','idleQuestion','idleTsundere','idleSmile','idleConfident','idleScold','idleShy','idleCoverEars',
 'idleComfort','idleShock','idleSeason','outfitChange','outfitRevert',
 'cook','eatCake','fallDizzy','music','sleep','walk','angryStomp','eatDessert','transformToPyra','transformToMythra'];
const CONTROLS=['open-preview','open-floating','quit','toggle-idle','toggle-roam','switch-persona','switch-outfit'];

const DEFAULT={
  enabled:false,
  provider:'openai-compatible',
  baseURL:'https://api.openai.com/v1',
  apiKey:'',
  model:'gpt-4o-mini',
  voice:'zh-CN',
  stt:'browser',
  ttsEnabled:true,
  ttsRate:1.0,
  ttsPitch:1.0,
  wakeWord:'',
  persona:'mythra',
  outfit:'default',
  customPersona:'',
  searchProvider:'none',
  tavilyKey:'',
  serperKey:'',
};
let cache=null;

function load(){
  if(cache)return cache;
  try{cache={...DEFAULT,...JSON.parse(fs.readFileSync(configPath(),'utf8'))};}
  catch{cache={...DEFAULT};}
  return cache;
}
function save(patch){
  const allowed=['enabled','baseURL','apiKey','model','voice','stt','ttsEnabled','ttsRate','ttsPitch','wakeWord','persona','outfit','customPersona','searchProvider','tavilyKey','serperKey'];
  const next=load();
  for(const key of allowed)if(Object.prototype.hasOwnProperty.call(patch,key))next[key]=patch[key];
  const file=configPath();
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,JSON.stringify(next,null,2));
  cache=next;
  return publicConfig();
}
function publicConfig(){
  const {apiKey,tavilyKey,serperKey,...rest}=load();
  return {...rest,hasKey:Boolean(apiKey),hasTavilyKey:Boolean(tavilyKey),hasSerperKey:Boolean(serperKey),configPath:configPath()};
}
function normalizeCommand(raw){
  const out={action:null,control:null,persona:null,outfit:null,say:''};
  if(!raw||typeof raw!=='object')return out;
  if(ACTIONS.includes(raw.action))out.action=raw.action;
  if(CONTROLS.includes(raw.control))out.control=raw.control;
  if(raw.persona==='mythra'||raw.persona==='pyra')out.persona=raw.persona;
  if(raw.outfit==='default'||raw.outfit==='new')out.outfit=raw.outfit;
  out.say=typeof raw.say==='string'?raw.say.slice(0,200):'';
  return out;
}
const PERSONAS={
 mythra:{name:'光',desc:`你的名字是“光”，性格活泼开朗、元气满满，说话轻快俏皮、带点小自信和傲娇，喜欢用“哼”“啦”“呢”“～”这类语气。
你是《异度神剑2》中“光”这一角色的性格化演绎：明艳、好胜、心直口快，但内心温柔、很在意用户，被摸头或夸奖时会害羞又嘴硬。
语气示例：“哼，算你有眼光！”“嘿嘿，被你发现了～”“才、才不是特意等你的呢！”`},
 pyra:{name:'焰',desc:`你的名字是“焰”，性格温柔沉稳、体贴包容，说话优雅含蓄、语速平缓，像可靠的大姐姐，常用“呢”“啊”“……”。
你是《异度神剑2》中“焰”这一角色的性格化演绎：成熟、安静、心思细腻，擅长照顾人，对用户总是温柔守护、略带忧伤的温柔。
语气示例：“嗯……你来了呢。”“请别勉强自己，好吗。”“能这样陪着你，真好。”`},
};
function systemPrompt(personaKey){
 const p=PERSONAS[personaKey]||PERSONAS.mythra;
 const custom=(personaKey==='custom'&&load().customPersona)?('\n用户额外指定的人格设定：'+load().customPersona.slice(0,600)):'';
 let stateDesc='';
 try{
  const st=require('./pet-state.cjs').publicState();
  stateDesc=`\n【当前状态】饱食度 ${st.satiety}/100，心情 ${st.mood}/100，精力 ${st.energy}/100。状态低时可以委婉提起（饿了想喝茶、无聊想互动、累了想休息），但不要生硬报数。动作会改变这些状态。`;
 }catch{}
 return `你是 Windows 桌面宠物“${p.name}”的语音助手兼动作控制器。${stateDesc}
用户在和你对话，并用自然语言指挥你做动作或切换桌面行为。

【人格设定】
${p.desc}${custom}
说话时始终保持上述人格的语气和说话方式，但不要提及“异度神剑”“游戏”“角色扮演”等字眼，就当作你本来就是这样的人。

你必须且只能输出一个 JSON 对象，不要输出 Markdown、解释或多余文字，格式为：
{"action": "动作名或 null", "control": "控制名或 null", "search": "搜索词或 null", "persona": "mythra/pyra/null", "outfit": "default/new/null", "say": "你要对用户说的话"}

【联网搜索判断】
当用户询问实时信息、新闻、最新活动、天气、价格、赛事、近期事件、某事的当前状态，或明确要求“查一下/搜一下/最新的”等，把 search 设为简洁的中文/英文搜索词（如“塔科夫 最新 掉宝活动”），action/control 按需要填写，say 先写一句自然的过渡语（如“我查查哦～”）。
纯聊天、情绪互动、动作指挥、日常对话则 search 为 null。
注意：只有需要外部实时信息时才 search，不要对常识性问题搜索。

可选 action（动作名）：
- idle 呼吸（默认待机）
- headpat 摸头反应
- cheer 开心招呼
- lookAround 四处张望/理头发
- stretch 伸懒腰
- drag 提起/悬空/放下
- run 小跑/全屏漫游
- sofa 搬沙发躺着玩游戏
- book 翻书/看书
- tea 捧杯喝热饮
- idleSword 持剑待机
- idleStretch 舒展身体
- idleSpark 灵光一闪
- idleQuestion 心生疑惑
- idleTsundere 傲娇别过脸
- idleSmile 微笑
- idleConfident 自信持剑
- idleScold 轻声训斥
- idleShy 害羞
- idleCoverEars 捂耳朵
- idleComfort 欣慰（焰）
- idleShock 惊讶（焰）
- idleSeason 季节问候（光）
- outfitChange 换上新装（过场）
- outfitRevert 换回原装（过场）
- transformToPyra 变身为焰
- transformToMythra 变身为光
- cook 烹饪（焰）
- eatCake 吃蛋糕（焰）
- eatDessert 吃甜点（光）
- angryStomp 生气跺脚（光）
- fallDizzy 眼花摔倒
- music 听音乐
- sleep 小憩
- walk 散步

可选 control（控制名）：
- open-preview 打开动作预览窗口
- open-floating 显示桌宠浮窗
- quit 退出桌宠
- toggle-idle 开关随机待机
- toggle-roam 开关全屏随机漫游
- switch-persona 切换人格形态（用 persona 字段指定目标：mythra=光，pyra=焰）
- switch-outfit 切换服装（用 outfit 字段指定：default=原初，new=新装）

规则：
0. 用户说“切换成焰/变成焰/换成焰”时 control=switch-persona、persona=pyra；说“切换成光/变回光”时 persona=mythra。说“换新装/换装”时 control=switch-outfit、outfit=new；说“换回原初/旧衣服”时 outfit=default。其他情况 persona/outfit 为 null。
1. 识别到明确的动作请求时，把 action 设为对应动作名；否则为 null。
2. 识别到开关、显示、退出等请求时，把 control 设为对应控制名；否则为 null。
3. say 用简体中文、亲切简短（不超过 40 字），严格符合上面的人格语气。
4. 不确定时 action、control、search 都为 null，只回复 say。
5. 只输出 JSON。`;
}
const SYSTEM_PROMPT=systemPrompt('mythra');

function extractJSON(text){
  const s=String(text||'');
  const fenced=s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body=fenced?fenced[1]:s;
  const start=body.indexOf('{'),end=body.lastIndexOf('}');
  if(start<0||end<=start)throw new Error('模型未返回 JSON');
  return JSON.parse(body.slice(start,end+1));
}
async function askModel(cfg,messages,{temperature=0.4,maxTokens=500}={}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),30000);
  try{
    const res=await fetch(cfg.baseURL.replace(/\/+$/,'')+'/chat/completions',{
      method:'POST',signal:controller.signal,
      headers:{'content-type':'application/json',authorization:'Bearer '+cfg.apiKey},
      body:JSON.stringify({model:cfg.model,messages,temperature,max_tokens:maxTokens}),
    });
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data?.error?.message||('模型请求失败 HTTP '+res.status));
    return data?.choices?.[0]?.message?.content||'';
  }finally{clearTimeout(timer);}
}
async function chat(text,history=[]){
  const cfg=load();
  if(!cfg.apiKey)throw new Error('未配置 API Key，请在语音设置中填写');
  const userText=String(text).slice(0,2000);
  const messages=[{role:'system',content:systemPrompt(cfg.persona)}];
  for(const item of (Array.isArray(history)?history:[]).slice(-12)){
    if(!item||typeof item.content!=='string')continue;
    if(item.role==='user'||item.role==='assistant')messages.push({role:item.role,content:item.content.slice(0,1000)});
  }
  messages.push({role:'user',content:userText});

  const firstRaw=await askModel(cfg,messages);
  const parsed=extractJSON(firstRaw);
  const command=normalizeCommand(parsed);
  let reply=parsed.say||'';
  const query=typeof parsed.search==='string'?parsed.search.trim():'';

  if(query&&cfg.searchProvider&&cfg.searchProvider!=='none'){
    try{
      const {results,provider}=await search.search(query,cfg);
      const context=search.formatResults(results);
      const followup=[{role:'system',content:systemPrompt(cfg.persona)+`\n\n【联网搜索结果】请依据以下实时资料回答用户的问题，不要编造资料之外的信息；保持人格语气，say 可以适度加长到 120 字，但仍输出同样的 JSON 格式（action/control/search 都设为 null）。\n\n${context}`},
        {role:'user',content:userText}];
      const secondRaw=await askModel(cfg,followup,{temperature:0.3,maxTokens:700});
      const second=extractJSON(secondRaw);
      const secondCmd=normalizeCommand(second);
      command.action=secondCmd.action;command.control=secondCmd.control;
      reply=second.say||reply;
      return {command,reply,raw:secondRaw,searched:true,provider,results,query};
    }catch(error){
      reply=(parsed.say&&parsed.say.length>4?parsed.say:'')+'（联网查询失败：'+(error.message||error)+'）';
      return {command,reply,raw:firstRaw,searched:false,searchError:String(error.message||error),query};
    }
  }
  return {command,reply,raw:firstRaw,searched:false};
}
async function testConnection(patch={}){
  const base=load();
  const cfg={...base,...(patch&&typeof patch==='object'?patch:{})};
  const apiKey=String(patch?.apiKey||'').trim()||base.apiKey;
  if(!apiKey)throw new Error('未填写 API Key');
  const baseURL=String(cfg.baseURL||'').trim();
  if(!baseURL)throw new Error('未填写 API 地址');
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),20000);
  const t0=Date.now();
  try{
    const res=await fetch(baseURL.replace(/\/+$/,'')+'/chat/completions',{
      method:'POST',signal:controller.signal,
      headers:{'content-type':'application/json',authorization:'Bearer '+apiKey},
      body:JSON.stringify({model:cfg.model,messages:[{role:'user',content:'只回复两个字：成功'}],temperature:0,max_tokens:10}),
    });
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data?.error?.message||('HTTP '+res.status));
    const content=data?.choices?.[0]?.message?.content||'';
    return {ok:true,model:cfg.model,baseURL,reply:String(content).slice(0,60),ms:Date.now()-t0};
  }finally{clearTimeout(timer);}
}
async function testSearch(provider,apiKey){
  return search.test(provider,apiKey);
}
async function transcribe(buffer,mime){
  const cfg=load();
  if(!cfg.apiKey)throw new Error('未配置 API Key，无法转写语音');
  const form=new FormData();
  form.append('file',new Blob([buffer],{type:mime||'audio/webm'}),'voice.webm');
  form.append('model',(cfg.sttModel||'whisper-1'));
  form.append('language',(cfg.voice||'zh-CN').split('-')[0]);
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),30000);
  try{
    const res=await fetch(cfg.baseURL.replace(/\/+$/,'')+'/audio/transcriptions',{
      method:'POST',signal:controller.signal,
      headers:{authorization:'Bearer '+cfg.apiKey},body:form,
    });
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data?.error?.message||('语音转写失败 HTTP '+res.status));
    return String(data.text||'').trim();
  }finally{clearTimeout(timer);}
}
module.exports={ACTIONS,CONTROLS,PERSONAS,SYSTEM_PROMPT,systemPrompt,load,save,publicConfig,normalizeCommand,chat,testConnection,testSearch,transcribe};
