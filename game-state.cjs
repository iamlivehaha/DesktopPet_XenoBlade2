'use strict';
// 冒险系统：等级 / 经验 / 金币 / 装备背包 / 商店 / 副本练级掉落。
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const RARITIES = {
  common: { name: '普通', color: '#8b98a5', mult: 1, weight: 60 },
  uncommon: { name: '精良', color: '#4f9a62', mult: 1.45, weight: 25 },
  rare: { name: '稀有', color: '#3f74c8', mult: 2.1, weight: 10 },
  epic: { name: '史诗', color: '#9255bd', mult: 3.1, weight: 4 },
  legendary: { name: '传说', color: '#cf9427', mult: 4.8, weight: 1 },
};
const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
const SLOTS = { weapon: '武器', armor: '护甲', accessory: '饰品' };
const SLOT_KEYS = Object.keys(SLOTS);
const BASE_NAMES = {
  weapon: ['练习短剑', '旅行者之刃', '微光细剑', '银月长剑', '破晓圣剑'],
  armor: ['粗布衣', '皮质护甲', '锁子甲', '秘银铠甲', '星辰战铠'],
  accessory: ['玻璃护符', '幸运硬币', '月光坠饰', '古代指环', '誓约之冠'],
};
const DUNGEONS = [
  { id: 'forest', name: '翠影林道', desc: '新手也敢踏入的林间小径', minLevel: 1, duration: 8000, fee: 5, exp: [20, 34], gold: [14, 26], drop: 0.45, boost: 0 },
  { id: 'cave', name: '晶辉洞窟', desc: '晶石闪烁的幽深洞窟', minLevel: 5, duration: 12000, fee: 18, exp: [55, 85], gold: [42, 68], drop: 0.62, boost: 1 },
  { id: 'ruins', name: '古代遗迹', desc: '尘封于时光中的试炼场', minLevel: 10, duration: 16000, fee: 45, exp: [130, 190], gold: [105, 155], drop: 0.78, boost: 2 },
  { id: 'abyss', name: '禁忌深渊', desc: '只有强者才能生还的地方', minLevel: 18, duration: 22000, fee: 110, exp: [300, 430], gold: [250, 360], drop: 0.92, boost: 3 },
];
const ENEMY_NAMES = ['游荡史莱姆', '暗影小怪', '林间哥布林', '晶簇守卫', '遗迹傀儡'];
const BOSS_NAMES = ['翠影林主', '晶辉晶王', '遗迹守护者', '深渊领主'];
const MAX_BAG = 24;
const DEFAULTS = {
  level: 1, exp: 0, gold: 100, inventory: [],
  equipment: { weapon: null, armor: null, accessory: null },
  runs: {}, totalRuns: 0, nextUid: 1, activeRun: null, lastReward: null,
};
const expToNext = level => 80 + Math.max(1, level) * 40;
const clampInt = n => Math.max(0, Math.floor(Number(n) || 0));
const randInt = (min, max, mult = 1) => Math.max(1, Math.round((min + Math.random() * (max - min + 1)) * mult));
const statePath = () => path.join(app.getPath('userData'), 'game-state.json');
let cache = null;

function load() {
  if (cache) return cache;
  try {
    const raw = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    cache = { ...DEFAULTS, ...raw, equipment: { ...DEFAULTS.equipment, ...(raw.equipment || {}) } };
    cache.inventory = Array.isArray(cache.inventory) ? cache.inventory : [];
    cache.runs = cache.runs && typeof cache.runs === 'object' ? cache.runs : {};
    if (cache.activeRun && !(cache.activeRun.endsAt > 0)) cache.activeRun = null;
  } catch { cache = { ...DEFAULTS, equipment: { ...DEFAULTS.equipment } }; }
  return cache;
}
function save() {
  try {
    fs.mkdirSync(path.dirname(statePath()), { recursive: true });
    fs.writeFileSync(statePath(), JSON.stringify(load(), null, 2));
  } catch {}
}
function atkOf(s = load()) {
  let atk = 8 + s.level * 2;
  for (const uid of Object.values(s.equipment || {})) {
    const item = (s.inventory || []).find(i => i.uid === uid);
    if (item) atk += (item.atk || 0);
  }
  return Math.round(atk);
}
function powerOf(s = load()) {
  let power = 10 + s.level * 6;
  for (const uid of Object.values(s.equipment || {})) {
    const item = (s.inventory || []).find(i => i.uid === uid);
    if (item) power += (item.atk || 0) * 2 + (item.def || 0) * 1.5 + (item.luck || 0);
  }
  return Math.round(power);
}
function equippedDetails(s = load()) {
  const result = {};
  for (const slot of SLOT_KEYS) {
    const uid = s.equipment?.[slot];
    result[slot] = uid ? (s.inventory || []).find(i => i.uid === uid) || null : null;
  }
  return result;
}
function publicGame() {
  const s = load();
  return {
    level: s.level, exp: s.exp, expToNext: expToNext(s.level), gold: s.gold,
    power: powerOf(s), atk: atkOf(s), maxBag: MAX_BAG,
    inventory: (s.inventory || []).slice(),
    equipment: equippedDetails(s),
    activeRun: s.activeRun ? { ...s.activeRun, remaining: Math.max(0, s.activeRun.endsAt - Date.now()) } : null,
    runs: { ...s.runs }, totalRuns: s.totalRuns, lastReward: s.lastReward,
    dungeons: DUNGEONS.map(d => ({ ...d, unlocked: s.level >= d.minLevel })),
    shop: shopItems(), rarities: RARITIES, slots: SLOTS,
  };
}
function shopItems() {
  const items = [];
  for (let r = 0; r < RARITY_ORDER.length; r++) {
    const rarity = RARITY_ORDER[r], mult = RARITIES[rarity].mult, base = 4 + r * 3;
    for (const slot of SLOT_KEYS) {
      const stats = { atk: 0, def: 0, luck: 0 };
      if (slot === 'weapon') { stats.atk = Math.round(base * mult * 2); stats.luck = Math.round(base * mult * 0.5); }
      if (slot === 'armor') { stats.def = Math.round(base * mult * 2); stats.luck = Math.round(base * mult * 0.5); }
      if (slot === 'accessory') { stats.luck = Math.round(base * mult * 2); stats.atk = Math.round(base * mult * 0.6); }
      const price = Math.round((60 + r * 55) * mult / 5) * 5;
      items.push({ uid: `shop-${slot}-${r}`, name: BASE_NAMES[slot][r], slot, rarity, levelReq: 1 + r * 4, ...stats, price });
    }
  }
  return items;
}
function rollRarity(boost = 0) {
  const weights = RARITY_ORDER.map((r, i) => {
    let w = RARITIES[r].weight;
    if (boost > 0) w = i < boost ? Math.max(1, Math.round(w / (boost + 1))) : w * (boost + 1);
    return w;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let pick = Math.random() * total;
  for (let i = 0; i < weights.length; i++) { pick -= weights[i]; if (pick <= 0) return RARITY_ORDER[i]; }
  return 'common';
}
function rollItem(s, boost, tier, forcedRarity = null) {
  const slot = SLOT_KEYS[Math.floor(Math.random() * SLOT_KEYS.length)];
  const rarity = forcedRarity || rollRarity(boost), mult = RARITIES[rarity].mult, base = 4 + tier * 4;
  const stats = { atk: 0, def: 0, luck: 0 };
  if (slot === 'weapon') { stats.atk = Math.round(base * mult * 2); stats.luck = Math.round(base * mult * 0.5); }
  if (slot === 'armor') { stats.def = Math.round(base * mult * 2); stats.luck = Math.round(base * mult * 0.5); }
  if (slot === 'accessory') { stats.luck = Math.round(base * mult * 2); stats.atk = Math.round(base * mult * 0.6); }
  const price = Math.max(5, Math.round((40 + tier * 30) * mult / 5) * 5);
  return { uid: `i${s.nextUid++}`, name: BASE_NAMES[slot][Math.min(4, tier)] + '·' + RARITIES[rarity].name, slot, rarity, levelReq: 1 + tier * 3, ...stats, price };
}
function grantExp(n) {
  const s = load();
  s.exp += clampInt(n);
  let levels = 0;
  while (s.exp >= expToNext(s.level)) { s.exp -= expToNext(s.level); s.level++; levels++; }
  save();
  return levels;
}
function grantGold(n) {
  const s = load();
  s.gold += clampInt(n);
  save();
  return publicGame();
}
function startRun(id) {
  const s = load();
  if (s.activeRun) throw new Error('已有副本进行中');
  const d = DUNGEONS.find(x => x.id === id);
  if (!d) throw new Error('副本不存在');
  if (s.level < d.minLevel) throw new Error(`需要 Lv.${d.minLevel}`);
  if (s.gold < d.fee) throw new Error('金币不足');
  s.gold -= d.fee;
  const tier = DUNGEONS.indexOf(d), atk = atkOf(s), count = 3 + tier;
  const enemies = [];
  for (let i = 0; i < count; i++) {
    const isBoss = i === count - 1;
    const maxHp = Math.round((atk * 2.2 + 18 + tier * 14) * (isBoss ? 3.2 : 1));
    enemies.push({ name: isBoss ? BOSS_NAMES[tier] : ENEMY_NAMES[(tier + i) % ENEMY_NAMES.length], maxHp, hp: maxHp, isBoss });
  }
  s.activeRun = { id, startedAt: Date.now(), endsAt: Date.now() + d.duration,
    battle: { enemies, index: 0, atk, hits: 0, bossDefeated: false } };
  save();
  return publicGame();
}
function completeRun(force = false) {
  const s = load();
  if (!s.activeRun) return null;
  if (!force && Date.now() < s.activeRun.endsAt) return null;
  const d = DUNGEONS.find(x => x.id === s.activeRun.id);
  if (!d) { s.activeRun = null; save(); return null; }
  const tier = DUNGEONS.indexOf(d);
  const multiplier = 1 + Math.min(0.8, powerOf(s) / (s.level * 12 + 40));
  const exp = randInt(d.exp[0], d.exp[1], multiplier);
  const gold = randInt(d.gold[0], d.gold[1], multiplier);
  let item = Math.random() < d.drop ? rollItem(s, d.boost, tier) : null;
  const bossDefeated = Boolean(s.activeRun?.battle?.bossDefeated);
  if (bossDefeated && Math.random() < 0.1) item = rollItem(s, Math.max(2, d.boost), tier + 1, Math.random() < 0.25 ? 'epic' : 'rare');
  const levels = grantExp(exp);
  s.gold += gold;
  s.totalRuns++;
  const prev = s.runs[d.id] || { clears: 0, bestExp: 0, bestGold: 0 };
  s.runs[d.id] = { clears: prev.clears + 1, bestExp: Math.max(prev.bestExp, exp), bestGold: Math.max(prev.bestGold, gold) };
  s.lastReward = { id: d.id, name: d.name, exp, gold, item, levels, bossDefeated, at: Date.now() };
  s.activeRun = null;
  save();
  return { ...s.lastReward, level: s.level, power: powerOf(s), game: publicGame() };
}
function buyItem(templateUid) {
  const s = load();
  const t = shopItems().find(i => i.uid === templateUid);
  if (!t) throw new Error('商品不存在');
  if (s.level < t.levelReq) throw new Error(`需要 Lv.${t.levelReq}`);
  if (s.gold < t.price) throw new Error('金币不足');
  if (s.inventory.length >= MAX_BAG) throw new Error('背包已满');
  s.gold -= t.price;
  const item = { ...t, uid: `i${s.nextUid++}`, name: t.name + '·' + RARITIES[t.rarity].name, price: Math.round(t.price * 0.4) };
  s.inventory.push(item);
  save();
  return { item, game: publicGame() };
}
function sellItem(uid) {
  const s = load();
  const idx = s.inventory.findIndex(i => i.uid === uid);
  if (idx < 0) throw new Error('物品不存在');
  const item = s.inventory[idx];
  s.gold += item.price || 5;
  s.inventory.splice(idx, 1);
  for (const slot of SLOT_KEYS) if (s.equipment?.[slot] === uid) s.equipment[slot] = null;
  save();
  return { item, game: publicGame() };
}
function equipItem(uid) {
  const s = load();
  const item = s.inventory.find(i => i.uid === uid);
  if (!item) throw new Error('物品不存在');
  if (s.level < (item.levelReq || 1)) throw new Error(`需要 Lv.${item.levelReq}`);
  s.equipment[item.slot] = uid;
  save();
  return publicGame();
}
function unequipItem(slot) {
  const s = load();
  if (!SLOT_KEYS.includes(slot)) throw new Error('槽位不存在');
  s.equipment[slot] = null;
  save();
  return publicGame();
}
function resetForQA() {
  cache = { ...DEFAULTS, equipment: { ...DEFAULTS.equipment }, inventory: [], runs: {} };
  save();
  return publicGame();
}
function markBossDefeated() {
  const s = load();
  if (!s.activeRun?.battle) return false;
  s.activeRun.battle.bossDefeated = true;
  save();
  return true;
}
module.exports = {
  RARITIES, RARITY_ORDER, SLOTS, DUNGEONS, MAX_BAG,
  expToNext, powerOf, atkOf, load, save, publicGame, shopItems,
  grantExp, grantGold, startRun, completeRun, buyItem, sellItem, equipItem, unequipItem, markBossDefeated, resetForQA,
};
