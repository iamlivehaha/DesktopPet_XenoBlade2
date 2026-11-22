'use strict';
// 桌宠状态与人格智能体：饱食度 / 心情 / 精力，随时间变化，人格决定行为模式。
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = {
  satiety: 72,
  mood: 80,
  energy: 85,
  lastTick: 0,
  totalInteractions: 0,
  lastAction: null,
};
// 人格行为模型：衰减速率 / 索求阈值 / 偏好动作 / 索求台词
const PERSONA_MODEL = {
  mythra: {
    name: '光',
    decay: { satiety: 1.0, mood: 1.35, energy: 1.0 },
    thresholds: { satiety: 34, mood: 42, energy: 30 },
    prefers: { hungry: 'tea', bored: 'cheer', tired: 'sofa' },
    requestLines: {
      hungry: ['哼……有点饿了呢，给我点吃的吧？', '肚子在叫了啦，去泡杯茶好不好～'],
      bored: ['陪我玩嘛，别老是坐着！', '哼，才不是想让你陪我玩呢……'],
      tired: ['呼……让我歇一会儿，就一会儿哦。', '有点累了，靠着沙发躲一下～'],
    },
    actionLines: {
      fed: '嘿嘿，吃饱了就有精神啦～',
      happy: '开心！和你在一起最棒了！',
      rested: '充好电啦，接下来也一起加油吧！',
    },
  },
  pyra: {
    name: '焰',
    decay: { satiety: 1.3, mood: 0.9, energy: 0.95 },
    thresholds: { satiety: 40, mood: 38, energy: 28 },
    prefers: { hungry: 'tea', bored: 'idleShy', tired: 'sofa' },
    requestLines: {
      hungry: ['……有点饿了，能陪我喝杯热茶吗？', '要是有点点心就好了呢。'],
      bored: ['能陪我说说话吗……只是这样就好。', '今天的风，让人想出去走走呢。'],
      tired: ['请让我稍微休息一下……好吗。', '有点累了，安静地待一会儿吧。'],
    },
    actionLines: {
      fed: '谢谢你……心里暖暖的呢。',
      happy: '能这样陪着你，真好。',
      rested: '休息好了，感觉又能打起精神了。',
    },
  },
};
// 动作对属性的影响（缺失则中性）
const ACTION_EFFECTS = {
  tea: { satiety: 16, mood: 4 },
  idle: { energy: 0.4 },
  headpat: { mood: 9 },
  cheer: { mood: 12, energy: -3 },
  lookAround: { mood: 3, energy: -1 },
  stretch: { mood: 4, energy: 2 },
  drag: { mood: -2, energy: -4 },
  run: { mood: 5, energy: -9 },
  sofa: { energy: 14, mood: 3 },
  book: { mood: 5, energy: -1 },
  idleSword: { mood: 3, energy: -2 },
  idleStretch: { energy: 3 },
  idleSpark: { mood: 6 },
  idleQuestion: { mood: 2 },
  idleTsundere: { mood: 4 },
  idleSmile: { mood: 7 },
  idleConfident: { mood: 5 },
  idleScold: { mood: -1 },
  idleShy: { mood: 6 },
  idleCoverEars: { mood: 1 },
  idleComfort: { mood: 10 },
  idleShock: { mood: -3 },
  idleSeason: { mood: 6, satiety: 2 },
  outfitChange: { mood: 8 },
  outfitRevert: { mood: 5 },
  cook: { satiety: 14, mood: 4 },
  eatCake: { satiety: 18, mood: 6 },
  eatDessert: { satiety: 18, mood: 6 },
  fallDizzy: { mood: -4, energy: -3 },
  music: { mood: 9 },
  sleep: { energy: 22, satiety: -3 },
  walk: { energy: -6, mood: 4 },
  angryStomp: { mood: -6, energy: -4 },
  transformToPyra: { mood: 5 },
  transformToMythra: { mood: 5 },
};

const clamp = n => Math.max(0, Math.min(100, Math.round(n)));
const statePath = () => path.join(app.getPath('userData'), 'pet-state.json');
let cache = null;

function load() {
  if (cache) return cache;
  try { cache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(statePath(), 'utf8')) }; }
  catch { cache = { ...DEFAULTS }; }
  return cache;
}
function save() {
  try {
    fs.mkdirSync(path.dirname(statePath()), { recursive: true });
    fs.writeFileSync(statePath(), JSON.stringify(load(), null, 2));
  } catch {}
}
function publicState() {
  const s = load();
  return { satiety: clamp(s.satiety), mood: clamp(s.mood), energy: clamp(s.energy),
    totalInteractions: s.totalInteractions, lastAction: s.lastAction };
}
// 按经过的分钟衰减属性（由主进程定时器调用）
function decay(minutes, persona) {
  const s = load();
  const model = PERSONA_MODEL[persona] || PERSONA_MODEL.mythra;
  s.satiety = clamp(s.satiety - 1.3 * model.decay.satiety * minutes);
  s.mood = clamp(s.mood - 0.8 * model.decay.mood * minutes);
  s.energy = clamp(s.energy - 0.9 * model.decay.energy * minutes);
  s.lastTick = Date.now();
  save();
  return publicState();
}
// 动作执行后的属性变化
function applyAction(action, persona) {
  const s = load();
  const eff = ACTION_EFFECTS[action] || {};
  s.satiety = clamp(s.satiety + (eff.satiety || 0));
  s.mood = clamp(s.mood + (eff.mood || 0));
  s.energy = clamp(s.energy + (eff.energy || 0));
  s.totalInteractions = (s.totalInteractions || 0) + 1;
  s.lastAction = action;
  save();
  return publicState();
}
// 智能体评估：返回最需要处理的索求（或 null）
function evaluate(persona, outfit) {
  const s = load();
  const model = PERSONA_MODEL[persona] || PERSONA_MODEL.mythra;
  const th = model.thresholds;
  let need = null, score = -Infinity;
  for (const [kind, key] of [['hungry', 'satiety'], ['bored', 'mood'], ['tired', 'energy']]) {
    const deficit = th[key] - s[key];
    if (deficit > 0 && deficit > score) { score = deficit; need = kind; }
  }
  if (!need) return null;
  const lines = model.requestLines[need];
  const line = lines[Math.floor(Math.random() * lines.length)];
  return { kind: need, action: model.prefers[need], say: line, persona, outfit,
    stats: publicState() };
}
function personaModel(persona) {
  return PERSONA_MODEL[persona] || PERSONA_MODEL.mythra;
}

module.exports = { DEFAULTS, PERSONA_MODEL, ACTION_EFFECTS, load, save, publicState, decay, applyAction, evaluate, personaModel };
