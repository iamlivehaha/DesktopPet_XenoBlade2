'use strict';
const $=id=>document.getElementById(id);
const log=$('log'),status=$('status'),input=$('input'),mic=$('mic'),banner=$('banner'),modal=$('settings-modal');
let config=null,history=[],busy=false,recognition=null,listening=false,mediaRecorder=null,chunks=[],wakeArmed=false;
const ACTION_LABEL={idle:'呼吸待机',headpat:'摸头',cheer:'开心招呼',lookAround:'四处张望',stretch:'伸懒腰',drag:'提起放下',run:'小跑漫游',sofa:'沙发游戏',book:'看书',tea:'喝热饮'};
const CONTROL_LABEL={'open-preview':'动作预览','open-floating':'显示桌宠',quit:'退出',toggle:'开关'};
const PRESET_ARK={baseURL:'https://ark.cn-beijing.volces.com/api/plan/v3',model:'ark-code-latest',stt:'browser',voice:'zh-CN'};
const PRESET_OPENAI={baseURL:'https://api.openai.com/v1',model:'gpt-4o-mini',stt:'browser',voice:'zh-CN'};

function setStatus(text,error=false){status.textContent=text;status.classList.toggle('error',Boolean(error));}
function addMsg(role,text,extra){
 const welcome=log.querySelector('.welcome');if(welcome&&role==='user')welcome.remove();
 const div=document.createElement('div');div.className='msg '+(role==='user'?'you':'guang');
 const who=document.createElement('span');who.className='who';who.textContent=role==='user'?'你':'光';
 const body=document.createElement('div');body.textContent=text;div.append(who,body);
 if(extra){const tag=document.createElement('span');tag.className='act';tag.textContent=extra;div.append(tag);}
 log.append(div);log.scrollTop=log.scrollHeight;return div;
}
function speak(text){
 if(!config||!config.ttsEnabled||!text)return;
 try{
  speechSynthesis.cancel();
  const u=new SpeechSynthesisUtterance(text);
  u.lang=config.voice||'zh-CN';u.rate=Number(config.ttsRate)||1;u.pitch=Number(config.ttsPitch)||1;
  speechSynthesis.speak(u);
 }catch{}
}
async function send(text){
 text=String(text||'').trim();if(!text||busy)return;
 busy=true;input.disabled=true;mic.disabled=true;setStatus('正在思考…');
 addMsg('user',text);
 try{
  const result=await window.voiceHost.chat(text,history);
  const say=result.command.say||result.reply||'（没有回应）';
  const bits=[];
  if(result.command.action)bits.push(ACTION_LABEL[result.command.action]||result.command.action);
  if(result.command.control)bits.push(CONTROL_LABEL[result.command.control]||result.command.control);
  if(result.searched)bits.push('联网 '+result.provider);
  else if(result.searchError)bits.push('联网失败');
  addMsg('guang',say,bits.join(' · '));
  history.push({role:'user',content:text},{role:'assistant',content:result.reply||say});
  if(history.length>24)history.splice(0,history.length-24);
  speak(say);setStatus('完成');
 }catch(error){addMsg('guang','抱歉，我没连上模型：'+(error.message||error));setStatus('请求失败',true);}
 finally{busy=false;input.disabled=false;mic.disabled=false;input.value='';input.focus();}
}
function renderSuggest(){
 const wrap=$('suggest');wrap.replaceChildren();
 const items=['摸摸头','开心一点','伸个懒腰','去看书吧','全屏漫游','打开动作预览'];
 for(const item of items){const b=document.createElement('button');b.textContent=item;b.onclick=()=>send(item);wrap.append(b);}
}
function setFeedback(text,error=false){const f=$('cfg-feedback');f.textContent=text;f.classList.toggle('error',Boolean(error));}
function paintPersona(key){for(const b of document.querySelectorAll('.persona'))b.classList.toggle('active',b.dataset.persona===key);}
function fillConfig(cfg){
 config=cfg;
 $('cfg-baseURL').value=cfg.baseURL||'';$('cfg-model').value=cfg.model||'';
 $('cfg-apiKey').value='';$('cfg-stt').value=cfg.stt||'browser';
 $('cfg-voice').value=cfg.voice||'zh-CN';$('cfg-ttsEnabled').checked=cfg.ttsEnabled!==false;$('cfg-ttsRate').value=cfg.ttsRate||1;
 $('cfg-searchProvider').value=cfg.searchProvider||'none';
 $('cfg-tavilyKey').value='';$('cfg-serperKey').value='';
 paintPersona(cfg.persona||'mythra');
 if(cfg.persona==='pyra')document.querySelector('.heading h1').textContent='和焰说话';
 else document.querySelector('.heading h1').textContent='和光说话';
 if(!cfg.hasKey){banner.hidden=false;banner.textContent='尚未配置 API Key：点「语音设置」填写后即可对话。';}
 else banner.hidden=true;
}
function applyPreset(preset){
 $('cfg-baseURL').value=preset.baseURL;$('cfg-model').value=preset.model;
 $('cfg-stt').value=preset.stt||'browser';$('cfg-voice').value=preset.voice||'zh-CN';
 setFeedback('已填入预设，请核对并保存');
}
function collectConfig(){
 const patch={
  baseURL:$('cfg-baseURL').value.trim(),model:$('cfg-model').value.trim(),
  stt:$('cfg-stt').value,voice:$('cfg-voice').value.trim(),
  ttsEnabled:$('cfg-ttsEnabled').checked,ttsRate:Number($('cfg-ttsRate').value)||1,
  persona:(document.querySelector('.persona.active')||{}).dataset?.persona||'mythra',
  searchProvider:$('cfg-searchProvider').value,
 };
 const key=$('cfg-apiKey').value.trim();if(key)patch.apiKey=key;
 const tv=$('cfg-tavilyKey').value.trim();if(tv)patch.tavilyKey=tv;
 const sp=$('cfg-serperKey').value.trim();if(sp)patch.serperKey=sp;
 return patch;
}
function openModal(){modal.hidden=false;setFeedback('');$('cfg-apiKey').value='';$('cfg-baseURL').focus();}
function closeModal(){modal.hidden=true;}
function browserSTT(){
 const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
 if(!SR){setStatus('当前浏览器不支持语音识别，可改用打字或 Whisper 云转写',true);return null;}
 const r=new SR();r.lang=config.voice||'zh-CN';r.interimResults=false;r.continuous=false;
 r.onresult=e=>{const t=e.results[0][0].transcript;if(t)send(t);};
 r.onerror=e=>setStatus('语音识别失败：'+e.error,true);
 r.onend=()=>{listening=false;mic.classList.remove('listening');mic.textContent='🎤';setStatus('准备就绪');};
 return r;
}
async function startListening(){
 if(config.stt==='browser'){
  recognition=recognition||browserSTT();if(!recognition)return;
  listening=true;mic.classList.add('listening');mic.textContent='■';setStatus('正在聆听…');
  try{recognition.start();}catch{setStatus('语音识别已在运行',true);}
  return;
 }
 if(!config.hasKey){setStatus('请先配置 API Key',true);return;}
 try{
  const stream=await navigator.mediaDevices.getUserMedia({audio:true});
  chunks=[];mediaRecorder=new MediaRecorder(stream);
  mediaRecorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
  mediaRecorder.onstop=async()=>{
   stream.getTracks().forEach(t=>t.stop());
   const blob=new Blob(chunks,{type:mediaRecorder.mimeType||'audio/webm'});
   setStatus('正在转写…');
   try{
    const buf=await blob.arrayBuffer();
    const text=await window.voiceHost.transcribe([...new Uint8Array(buf)],blob.type);
    if(text){input.value=text;send(text);}else setStatus('没有识别到语音',true);
   }catch(error){setStatus('转写失败：'+(error.message||error),true);}
  };
  mediaRecorder.start();listening=true;mic.classList.add('listening');mic.textContent='■';setStatus('录音中，再次点击结束');
 }catch(error){setStatus('无法访问麦克风：'+(error.message||error),true);}
}
function stopListening(){
 if(config.stt==='browser'&&recognition&&listening){recognition.stop();listening=false;return;}
 if(mediaRecorder&&mediaRecorder.state!=='inactive'){mediaRecorder.stop();listening=false;mic.classList.remove('listening');mic.textContent='🎤';}
}
mic.addEventListener('click',()=>listening?stopListening():startListening());
$('send').addEventListener('click',()=>send(input.value));
input.addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey))send(input.value);});
$('close').addEventListener('click',()=>window.voiceHost.close());
window.addEventListener('keydown',e=>{if(e.key==='Escape'){if(!modal.hidden)closeModal();else $('close').click();}});
$('settings-toggle').addEventListener('click',openModal);
$('cfg-close').addEventListener('click',closeModal);
$('modal-backdrop').addEventListener('click',closeModal);
$('preset-ark').addEventListener('click',()=>applyPreset(PRESET_ARK));
$('preset-openai').addEventListener('click',()=>applyPreset(PRESET_OPENAI));
for(const b of document.querySelectorAll('.persona'))b.addEventListener('click',()=>{paintPersona(b.dataset.persona);setFeedback('人格已选，记得保存');});
$('cfg-test').addEventListener('click',async()=>{
 const btn=$('cfg-test');btn.disabled=true;setFeedback('测试中…');
 try{
  const r=await window.voiceHost.testConnection(collectConfig());
  setFeedback('连接成功 · '+r.ms+'ms · '+r.model+(r.reply?' · '+r.reply:''));
 }catch(error){setFeedback('连接失败：'+(error.message||error),true);}
 finally{btn.disabled=false;}
});
async function testSearchBtn(provider,key,btn){
 btn.disabled=true;setFeedback('测试 '+provider+' 中…');
 try{
  const r=await window.voiceHost.testSearch(provider,key);
  setFeedback(provider+' 搜索成功 · '+r.ms+'ms · '+r.count+' 条结果');
 }catch(error){setFeedback(provider+' 测试失败：'+(error.message||error),true);}
 finally{btn.disabled=false;}
}
$('test-tavily').addEventListener('click',()=>testSearchBtn('tavily',$('cfg-tavilyKey').value.trim(),$('test-tavily')));
$('test-serper').addEventListener('click',()=>testSearchBtn('serper',$('cfg-serperKey').value.trim(),$('test-serper')));
$('cfg-save').addEventListener('click',async()=>{
 try{
  const before=config?.persona;
  config=await window.voiceHost.saveConfig(collectConfig());
  if(config.persona!==before)window.voiceHost.requestPersonaSync?.(config.persona);
  fillConfig(config);setStatus('设置已保存');closeModal();
 }catch(error){setFeedback('保存失败：'+(error.message||error),true);}
});
window.voiceHost.onCommand(value=>{
 if(value?.type==='voice-panel'&&value.open===false)window.voiceHost.close();
});
window.voiceHost.readConfig().then(c=>{fillConfig(c);const w=log.querySelector('.welcome strong');if(w)w.textContent=c.persona==='pyra'?'焰':'光';}).catch(error=>{setStatus('读取配置失败：'+error.message,true);});
renderSuggest();input.focus();
