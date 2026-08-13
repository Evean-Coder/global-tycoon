'use strict';

const crypto = require('crypto');

// 可注入随机源：生产用 crypto 无偏随机；测试注入固定序列。
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 基于 crypto 的均匀随机小数（0 ≤ x < 1），无偏且不依赖引擎实现
function cryptoUnit() {
  return crypto.randomInt(0, 4294967296) / 4294967296;
}

function createRng(seed) {
  if (seed !== undefined) return mulberry32(seed);
  return cryptoUnit;
}

// 掷骰（洗牌袋）：1–10 各一张洗乱入袋，掷骰时抽取、抽完重洗。
// 长期概率严格均匀（每 10 次各点数恰好一次），短期避免连出重复点数。
function rollDice(state, rng) {
  // 测试注入：rng 自带骰袋时（diceRng 预置序列），优先使用该骰袋；
  // 生产环境 rng 无该属性，统一使用 state.diceBag。
  const injected = rng && Array.isArray(rng.diceBag) ? rng.diceBag : null;
  let bag = injected || state.diceBag;
  if (!bag || bag.length === 0) {
    bag = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], rng);
    if (injected) rng.diceBag = bag;
    else state.diceBag = bag;
  }
  return bag.pop();
}

// Fisher–Yates 洗牌
function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

module.exports = { createRng, rollDice, shuffle };
