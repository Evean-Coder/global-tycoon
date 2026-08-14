'use strict';

// 规则平衡模拟器：用当前规则引擎驱动多局 AI 对局，输出平衡性报告
// 用法：node scripts/simulate-balance.js [--games N] [--seed S] [--players 2-4]

const { createGameState, resetDeck } = require('../src/state');
const logic = require('../src/gameLogic');
const { createRng } = require('../src/random');
const { computeStats, totalAssetsOf } = require('../src/record');
const { CITIES } = require('../src/board');

const MAX_TURNS = 2000;
const NAMES = ['甲', '乙', '丙', '丁'];

function parseArgs(argv) {
  const args = { games: 20, seed: null, players: 4 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--games') args.games = parseInt(argv[i + 1], 10) || 20;
    if (argv[i] === '--seed') args.seed = parseInt(argv[i + 1], 10);
    if (argv[i] === '--players') args.players = Math.min(4, Math.max(2, parseInt(argv[i + 1], 10) || 4));
  }
  return args;
}

function cityKeyOf(text) {
  for (const name of Object.keys(CITIES)) {
    if (text.indexOf(CITIES[name].country + '·' + name) !== -1) return name;
  }
  return null;
}

function minBid(state) {
  const pend = state.pending;
  const city = state.cities[pend.cityId];
  return pend.currentBid ? pend.currentBid + 1000 : Math.round(logic.cityTotalValue(city) * 0.75);
}

function decideAction(state) {
  const p = state.players[state.turnIndex];
  switch (state.phase) {
    case 'waiting_roll':
      return { type: 'roll_dice' };
    case 'frozen_turn':
      return { type: 'respond_frozen', decision: p.cash >= 5000 ? 'pay' : 'pass' };
    case 'jail_turn':
      return { type: 'respond_jail', decision: p.cash >= 15000 ? 'pay' : 'roll' };
    case 'buy': {
      const city = state.cities[state.pending.cityId];
      const ok = (p.lapBuys || 0) < 4 && p.cash >= city.price;
      return { type: 'buy', decision: ok ? 'buy' : 'pass' };
    }
    case 'buy_airport':
      return { type: 'buy_airport', decision: p.cash >= 15000 ? 'buy' : 'pass' };
    case 'build_decide': {
      const city = state.cities[state.pending.cityId];
      const cost = Math.round(city.price * 0.6);
      return { type: 'respond_build', decision: city.houseLevel < 4 && p.cash >= cost ? 'build' : 'pass' };
    }
    case 'stock':
      return { type: 'stock_done' };
    case 'flight':
      return { type: 'flight', target: null };
    case 'auction_bid': {
      const pend = state.pending;
      if (pend.currentBidder === p.id) return { type: 'auction_respond', decision: 'end' };
      const min = minBid(state);
      const ok = (p.lapBuys || 0) < 4 && p.cash >= min;
      return ok ? { type: 'auction_respond', decision: 'bid', amount: min } : { type: 'auction_respond', decision: 'pass' };
    }
    case 'direct_sale_ask': {
      const city = state.cities[state.pending.cityId];
      const total = logic.cityTotalValue(city);
      const ok = (p.lapBuys || 0) < 4 && p.cash >= total;
      return { type: 'direct_sale_respond', decision: ok ? 'buy' : 'pass' };
    }
    case 'self_rescue': {
      const mortgagedCount = p.cities.filter((id) => state.cities[id].mortgaged).length;
      const owned = p.cities.filter((id) => !state.cities[id].mortgaged);
      if (mortgagedCount < 2 && owned.length) return { type: 'rescue_mortgage', cityId: owned[0] };
      return { type: 'rescue_done' };
    }
    case 'buy_fundraise':
      return { type: 'buy_fundraise', decision: 'cancel' };
    default:
      return null;
  }
}

function playGame(seed, playerCount) {
  const rng = seed != null ? createRng(seed) : createRng();
  const state = createGameState('SIM', NAMES.slice(0, playerCount));
  resetDeck(state, rng);
  const events = [];
  let turns = 0;
  while (state.phase !== 'game_over' && turns < MAX_TURNS) {
    const act = decideAction(state);
    if (!act) break;
    const res = logic.apply(state, act, rng);
    turns++;
    for (const e of res.events || []) events.push(e);
    if (res.rejected) break; // 兜底：异常局面不再推进，避免死循环
  }
  return { state, events, turns };
}

function money(n) {
  return '￥' + Math.round(n).toLocaleString('zh-CN');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = {
    wins: {},
    rounds: [],
    finalAssets: [],
    bankruptRounds: [],
    byType: {},
    cityPurchases: {},
    rentByCity: {},
  };
  for (let i = 0; i < args.games; i++) {
    const seed = args.seed != null ? args.seed + i : null;
    const { state, events } = playGame(seed, args.players);
    report.rounds.push(state.rounds || 0);
    for (const p of state.players) report.finalAssets.push(totalAssetsOf(state, p));
    const winner = state.players.find((p) => p.id === state.winner);
    if (winner) report.wins[winner.name] = (report.wins[winner.name] || 0) + 1;
    let round = 0;
    for (const e of events) {
      const text = e.text || '';
      if (text.indexOf('轮到 ') === 0) {
        round++;
      } else if (e.type === 'bankrupt' && (text.indexOf('破产出局') !== -1 || text.indexOf('认输') !== -1)) {
        report.bankruptRounds.push(Math.ceil(round / Math.max(1, args.players)));
      } else if (e.type === 'rent') {
        const ck = cityKeyOf(text);
        const m = text.match(/租金\s*(\d+)/);
        if (ck) {
          report.rentByCity[ck] = report.rentByCity[ck] || { count: 0, total: 0 };
          report.rentByCity[ck].count++;
          if (m) report.rentByCity[ck].total += parseInt(m[1], 10);
        }
      }
    }
    const stats = computeStats(state, events);
    for (const t of Object.keys(stats.byType)) report.byType[t] = (report.byType[t] || 0) + stats.byType[t];
    for (const cid of Object.keys(stats.cityPurchases)) report.cityPurchases[cid] = (report.cityPurchases[cid] || 0) + stats.cityPurchases[cid];
  }
  const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);
  console.log('========== 规则平衡模拟报告 ==========');
  console.log('局数：' + args.games + ' | 玩家：' + args.players + ' | 种子：' + (args.seed == null ? '随机' : args.seed));
  console.log('平均回合数：' + avg(report.rounds) + ' 轮');
  console.log('平均最终资产：' + money(avg(report.finalAssets)));
  console.log('');
  console.log('各玩家胜场：');
  for (const name of NAMES.slice(0, args.players)) {
    console.log('  ' + name + ': ' + (report.wins[name] || 0) + ' 局');
  }
  console.log('');
  if (report.bankruptRounds.length) {
    const byRound = {};
    for (const r of report.bankruptRounds) byRound[r] = (byRound[r] || 0) + 1;
    console.log('破产轮次分布：');
    for (const k of Object.keys(byRound).sort((a, b) => a - b)) console.log('  第 ' + k + ' 轮 x ' + byRound[k] + ' 次');
  } else {
    console.log('破产轮次分布：（无破产记录）');
  }
  console.log('');
  const buyTop = Object.keys(report.cityPurchases).sort((a, b) => report.cityPurchases[b] - report.cityPurchases[a]);
  console.log('城市成交 Top：');
  if (buyTop.length) {
    buyTop.slice(0, 5).forEach((cid) => {
      const c = CITIES[cid] || {};
      console.log('  ' + (c.country || '') + '·' + cid + ' x ' + report.cityPurchases[cid]);
    });
  } else {
    console.log('  （暂无成交）');
  }
  const rentTop = Object.keys(report.rentByCity).sort((a, b) => report.rentByCity[b].total - report.rentByCity[a].total);
  console.log('城市租金收入 Top：');
  if (rentTop.length) {
    rentTop.slice(0, 5).forEach((cid) => {
      const c = CITIES[cid] || {};
      console.log('  ' + (c.country || '') + '·' + cid + ' x ' + report.rentByCity[cid].count + ' 次，合计 ' + money(report.rentByCity[cid].total));
    });
  } else {
    console.log('  （暂无租金记录）');
  }
  console.log('');
  console.log('事件类型分布：');
  for (const t of Object.keys(report.byType).sort((a, b) => report.byType[b] - report.byType[a])) {
    console.log('  ' + t + ': ' + report.byType[t]);
  }
}

if (require.main === module) main();
module.exports = { playGame, decideAction, parseArgs };