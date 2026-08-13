'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createGameState } = require('../src/state');
const logic = require('../src/gameLogic');

function fakeRng(seq) {
  let i = 0;
  return () => (i < seq.length ? seq[i++] : 0.5);
}
function diceRng(diceList) {
  const f = fakeRng([0.5]);
  f.diceBag = [...diceList].reverse(); // 预置骰子洗牌袋，pop 顺序即 diceList 顺序
  return f;
}

test('股票初始价 = 地价 ÷ 10 × 2；买入受 6 股/3 城/单城 2 股限制（地价≥15000 单次 1 股）', () => {
  const state = createGameState('TEST01', ['甲', '乙']);
  const p = state.players[0];
  state.phase = 'stock';
  state.pending = { playerId: 'p0', kind: 'go_stock', after: 'end' };
  logic.apply(state, {
    type: 'stock_trade',
    orders: [
      { cityId: '上海', side: 'buy', shares: 1 },
      { cityId: '东京', side: 'buy', shares: 1 },
      { cityId: '新加坡', side: 'buy', shares: 2 },
    ],
  }, fakeRng([0.5]));
  assert.strictEqual(p.stocks['上海'], 1);
  assert.strictEqual(p.stocks['东京'], 1);
  assert.strictEqual(p.cash, 150000 - 4000 - 3400 - 5600);
  const cashBefore = p.cash;
  logic.apply(state, {
    type: 'stock_trade',
    orders: [
      { cityId: '迪拜', side: 'buy', shares: 1 },
      { cityId: '纽约', side: 'buy', shares: 2 },
      { cityId: '开罗', side: 'buy', shares: 2 },
      { cityId: '伦敦', side: 'buy', shares: 2 },
    ],
  }, fakeRng([0.5]));
  // 纽约（地价≥15000）单次 2 股被跳过，其余订单正常执行
  assert.strictEqual(p.cash, cashBefore - 3000 - 2400 - 5600);
  assert.strictEqual(p.stocks['纽约'] || 0, 0);
  assert.strictEqual(p.stocks['迪拜'], 1);
  assert.strictEqual(p.stocks['开罗'], 2);
  assert.strictEqual(p.stocks['伦敦'], 2);
});

test('股价联动：购买城市 +10%，上限为初始的 2 倍', () => {
  const state = createGameState('TEST01', ['甲', '乙']);
  const price0 = state.stocks['开罗'].price;
  state.phase = 'buy';
  state.pending = { playerId: 'p0', cityId: '开罗', context: null };
  logic.apply(state, { type: 'buy', decision: 'buy' }, fakeRng([0.5]));
  assert.strictEqual(state.stocks['开罗'].price, Math.round(price0 * 1.1));
  const cap = price0 * 2;
  state.stocks['开罗'].price = cap;
  state.players[0].position = 5;
  state.phase = 'waiting_roll';
  state.players[0].cash = 1000000;
  logic.apply(state, { type: 'build_house', cityId: '开罗' }, fakeRng([0.5]));
  assert.ok(state.stocks['开罗'].price <= cap);
});

test('股息：所有者过起点时按总价值×10% 派发', () => {
  const state = createGameState('TEST01', ['甲', '乙']);
  state.cities['上海'].ownerId = 'p0';
  state.players[0].cities.push('上海');
  state.stocks['上海'].holders['p1'] = 3;
  state.players[0].position = 40;
  const rng = diceRng([6]); // 6 → 40+6=46 → 4（跨过起点）
  logic.apply(state, { type: 'roll_dice' }, rng);
  assert.strictEqual(state.players[0].cash, 150000 + 5000);
  assert.strictEqual(state.players[1].cash, 150000 + 300); // 3/20 × 2000
});

test('所有者持股上限：获得城市时超持强制卖出', () => {
  const state = createGameState('TEST01', ['甲', '乙']);
  state.stocks['开罗'].holders['p0'] = 6;
  state.players[0].stocks['开罗'] = 6;
  state.phase = 'buy';
  state.pending = { playerId: 'p0', cityId: '开罗', context: null };
  const cashBefore = state.players[0].cash;
  logic.apply(state, { type: 'buy', decision: 'buy' }, fakeRng([0.5]));
  assert.strictEqual(state.stocks['开罗'].holders['p0'], 4); // 城市所有者最多 4 股（20%）
  assert.strictEqual(state.players[0].cash, cashBefore - 6000 + 2 * state.stocks['开罗'].price);
});
