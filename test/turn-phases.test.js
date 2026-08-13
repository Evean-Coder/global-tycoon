'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createGameState } = require('../src/state');
const logic = require('../src/gameLogic');

const rng = () => 0.5;

function setup() {
  const state = createGameState('T', ['甲', '乙']);
  return state;
}

test('经过自己城市进入 build_decide，可建房', () => {
  const s = setup();
  s.rounds = 2; // 第二轮起才可购买
  const p = s.players[0];
  // 甲拥有罗马（12 号格，地价 12000）
  s.cities['罗马'].ownerId = p.id;
  p.cities.push('罗马');
  p.position = 10;
  // 掷骰落 12：单骰 1–10，rng=0.15 → 掷出 2 → 12
  logic.apply(s, { type: 'roll_dice' }, () => 0.15);
  assert.strictEqual(p.position, 12);
  assert.strictEqual(s.phase, 'build_decide');
  assert.strictEqual(s.pending.cityId, '罗马');
  // 建房 1 级，费用 7200
  const cashBefore = p.cash;
  logic.apply(s, { type: 'respond_build', decision: 'build' }, rng);
  assert.strictEqual(s.cities['罗马'].houseLevel, 1);
  assert.strictEqual(p.cash, cashBefore - 7200);
  // 建房后回合推进到乙
  assert.strictEqual(s.turnIndex, 1);
});

test('build_decide 可拆房并返还 36%', () => {
  const s = setup();
  s.rounds = 2; // 第二轮起才可购买
  const p = s.players[0];
  s.cities['罗马'].ownerId = p.id;
  s.cities['罗马'].houseLevel = 2;
  p.cities.push('罗马');
  p.position = 10;
  logic.apply(s, { type: 'roll_dice' }, () => 0.15);
  assert.strictEqual(s.phase, 'build_decide');
  const cashBefore = p.cash;
  logic.apply(s, { type: 'respond_build', decision: 'demolish' }, rng);
  assert.strictEqual(s.cities['罗马'].houseLevel, 1);
  assert.strictEqual(p.cash, cashBefore + Math.round(12000 * 0.36));
});

test('build_decide 放弃则直接结束回合', () => {
  const s = setup();
  s.rounds = 2; // 第二轮起才可购买
  const p = s.players[0];
  s.cities['罗马'].ownerId = p.id;
  p.cities.push('罗马');
  p.position = 10;
  logic.apply(s, { type: 'roll_dice' }, () => 0.15);
  assert.strictEqual(s.phase, 'build_decide');
  logic.apply(s, { type: 'respond_build', decision: 'pass' }, rng);
  assert.strictEqual(s.cities['罗马'].houseLevel, 0);
  assert.strictEqual(s.turnIndex, 1);
});

test('空地皮且现金不足建房时经过自己城市直接结束（无弹窗阶段）', () => {
  const s = setup();
  s.rounds = 2; // 第二轮起才可购买
  const p = s.players[0];
  s.cities['罗马'].ownerId = p.id;
  p.cities.push('罗马');
  p.cash = 1000; // 不足 7200 建房费
  p.position = 10;
  logic.apply(s, { type: 'roll_dice' }, () => 0.15);
  assert.strictEqual(s.turnIndex, 1, '应直接轮到乙');
});

test('抵押中的自己城市经过时不进入 build_decide', () => {
  const s = setup();
  s.rounds = 2; // 第二轮起才可购买
  const p = s.players[0];
  s.cities['罗马'].ownerId = p.id;
  s.cities['罗马'].mortgaged = true;
  s.cities['罗马'].houseLevel = 1;
  p.cities.push('罗马');
  p.position = 10;
  logic.apply(s, { type: 'roll_dice' }, () => 0.15);
  assert.strictEqual(s.turnIndex, 1, '抵押中不能建/拆，直接轮到乙');
});

test('购买资金不足 → 募集资金 → 抵押凑够 → 完成购买', () => {
  const s = setup();
  s.rounds = 2; // 第二轮起才可购买
  const p = s.players[0];
  // 甲已有巴黎（抵押可筹资 13000/2=6500）
  s.cities['巴黎'].ownerId = p.id;
  p.cities.push('巴黎');
  p.cash = 8000; // 罗马 12000 差 4000
  p.position = 10;
  logic.apply(s, { type: 'roll_dice' }, () => 0.15); // 落 12 罗马（无主）
  assert.strictEqual(s.phase, 'buy');
  // 直接点购买（资金不足）→ 自动转募资
  logic.apply(s, { type: 'buy', decision: 'buy' }, rng);
  assert.strictEqual(s.phase, 'buy_fundraise');
  assert.strictEqual(s.pending.target.cityId, '罗马');
  // 抵押巴黎 +6500 → 14500 足够
  logic.apply(s, { type: 'rescue_mortgage', cityId: '巴黎' }, rng);
  assert.strictEqual(p.cash, 8000 + 6500);
  // 确认购买
  logic.apply(s, { type: 'buy_fundraise', decision: 'confirm' }, rng);
  assert.strictEqual(s.cities['罗马'].ownerId, p.id);
  assert.strictEqual(p.cash, 14500 - 12000);
  assert.strictEqual(s.turnIndex, 1);
});

test('募资后仍不足则无法确认购买，可取消（城市进入拍卖）', () => {
  const s = setup();
  s.rounds = 2; // 第二轮起才可购买
  const p = s.players[0];
  p.cash = 5000;
  p.position = 10;
  logic.apply(s, { type: 'roll_dice' }, () => 0.15); // 落 12 罗马
  assert.strictEqual(s.phase, 'buy');
  logic.apply(s, { type: 'buy_fundraise', decision: 'start' }, rng);
  assert.strictEqual(s.phase, 'buy_fundraise');
  // 无可抵押资产，确认购买应无效
  logic.apply(s, { type: 'buy_fundraise', decision: 'confirm' }, rng);
  assert.strictEqual(s.phase, 'buy_fundraise', '资金不足仍停留募资阶段');
  assert.strictEqual(s.cities['罗马'].ownerId, null);
  // 取消购买 → 进入拍卖
  logic.apply(s, { type: 'buy_fundraise', decision: 'cancel' }, rng);
  assert.strictEqual(s.phase, 'auction_bid');
});

test('机场购买资金不足 → 募集资金/取消购买', () => {
  const s = setup();
  s.rounds = 2; // 第二轮起才可购买
  const p = s.players[0];
  p.cash = 10000;
  p.position = 4;
  logic.apply(s, { type: 'roll_dice' }, () => 0.15); // 掷出 2 → 落 6 开罗国际机场
  assert.strictEqual(s.phase, 'buy_airport');
  logic.apply(s, { type: 'buy_airport', decision: 'buy' }, rng);
  assert.strictEqual(s.phase, 'buy_fundraise');
  logic.apply(s, { type: 'buy_fundraise', decision: 'cancel' }, rng);
  assert.strictEqual(s.airports['开罗国际机场'].ownerId, null);
  assert.strictEqual(s.turnIndex, 1, '机场取消购买不进拍卖，直接结束');
});

test('冰冻支付资金不足时按跳过处理', () => {
  const s = setup();
  s.rounds = 2; // 第二轮起才可购买
  const p = s.players[0];
  p.frozen = true;
  p.cash = 3000;
  s.turnIndex = 1; // 模拟乙刚结束
  const evs = [];
  logic.advanceTurn(s, evs, rng);
  assert.strictEqual(s.phase, 'frozen_turn');
  logic.apply(s, { type: 'respond_frozen', decision: 'pay' }, rng);
  assert.strictEqual(p.cash, 3000, '资金不足不应扣款');
  assert.strictEqual(p.frozen, false);
  assert.strictEqual(s.turnIndex, 1, '跳过回合后轮到乙');
});

test('冰冻支付资金充足时正常解除', () => {
  const s = setup();
  s.rounds = 2; // 第二轮起才可购买
  const p = s.players[0];
  p.frozen = true;
  s.turnIndex = 1;
  logic.advanceTurn(s, [], rng);
  assert.strictEqual(s.phase, 'frozen_turn');
  logic.apply(s, { type: 'respond_frozen', decision: 'pay' }, rng);
  assert.strictEqual(p.cash, 150000 - 5000);
  assert.strictEqual(s.phase, 'waiting_roll');
});
