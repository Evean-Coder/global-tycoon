'use strict';
const fs = require('fs');
let t = fs.readFileSync('C:/Users/Yifan/Desktop/game/src/gameLogic.js', 'utf8');
const rep = [
// 常量
["const BANKRUPT_RELIEF = 15000; // 破产时发放的救济金总额（分给资产未达最高的存活玩家）",
 "const BANKRUPT_RELIEF = 15000; // 破产时发放的救济金总额（分给资产未达最高的存活玩家）\nconst TYCOON_TAX_RATE = 0.02; // 豪强税：资产最高者每 10 轮缴纳总资产的比例\nconst TYCOON_TAX_CAP = 5000; // 豪强税单次上限\nconst TYCOON_TAX_PERIOD = 10; // 豪强税征收周期（轮）"],
// 每轮开始时征收豪强税
["  if (state.turnIndex === 0) state.rounds++;\n  for (const p of state.players) {\n    if (!p.alive) continue;\n    p.transferDone = false; // 每回合重置：股票转让每回合至多一笔",
 "  if (state.turnIndex === 0) {\n    state.rounds++;\n    if (state.rounds % TYCOON_TAX_PERIOD === 0) applyTycoonTax(state, events);\n  }\n  for (const p of state.players) {\n    if (!p.alive) continue;\n    p.transferDone = false; // 每回合重置：股票转让每回合至多一笔"],
// 豪强税实现（放在 totalAssetsOf 之后）
["function totalAssetsOf(state, p) {\n  let v = p.cash;\n  for (const id of p.cities) v += cityTotalValue(state.cities[id]);\n  v += (p.airports || []).length * AIRPORT_PRICE;\n  for (const cid of Object.keys(p.stocks || {})) v += (p.stocks[cid] || 0) * state.stocks[cid].price;\n  return v;\n}",
 "function totalAssetsOf(state, p) {\n  let v = p.cash;\n  for (const id of p.cities) v += cityTotalValue(state.cities[id]);\n  v += (p.airports || []).length * AIRPORT_PRICE;\n  for (const cid of Object.keys(p.stocks || {})) v += (p.stocks[cid] || 0) * state.stocks[cid].price;\n  return v;\n}\n\n// 豪强税：资产最高的玩家缴纳总资产×比例（上限封顶），转给资产最低的玩家；平局或单人不征收\nfunction applyTycoonTax(state, events) {\n  const alive = state.players.filter((p) => p.alive);\n  if (alive.length < 2) return;\n  const withAssets = alive.map((p) => ({ p, v: totalAssetsOf(state, p) }));\n  const maxV = Math.max(...withAssets.map((a) => a.v));\n  const minV = Math.min(...withAssets.map((a) => a.v));\n  if (maxV === minV) return;\n  const leaders = withAssets.filter((a) => a.v === maxV);\n  const laggards = withAssets.filter((a) => a.v === minV);\n  if (leaders.length !== 1 || laggards.length !== 1) return;\n  const leader = leaders[0].p;\n  const laggard = laggards[0].p;\n  const tax = Math.min(Math.round(maxV * TYCOON_TAX_RATE), TYCOON_TAX_CAP, leader.cash);\n  if (tax <= 0) return;\n  leader.cash -= tax;\n  laggard.cash += tax;\n  log(events, `${leader.name}（资产最高）缴纳豪强税 ${tax}，转给落后的 ${laggard.name}`, 'tax');\n}"]
];
for (const [o, n] of rep) { if (t.indexOf(o) < 0) { console.error('pattern not found: ' + o.slice(0, 60)); process.exit(1); } t = t.split(o).join(n); }
fs.writeFileSync('C:/Users/Yifan/Desktop/game/src/gameLogic.js', t, 'utf8');
console.log('patched');