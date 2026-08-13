'use strict';

// 可注入随机源：生产用 Math.random；测试注入固定序列。
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

function createRng(seed) {
  if (seed !== undefined) return mulberry32(seed);
  return Math.random;
}

// 掷两个骰子：各 1–6（36 种组合，总和 2–12，双数概率 1/6）
function rollDice(rng) {
  return [1 + Math.floor(rng() * 6), 1 + Math.floor(rng() * 6)];
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
