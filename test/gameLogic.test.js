'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createGameState } = require('../src/state');
const logic = require('../src/gameLogic');
const { rollDice } = require('../src/random');

function fakeRng(seq) {
  let i = 0;
  return () => (i < seq.length ? seq[i++] : 0.5);
}
// 按骰子点数生成 rng 序列
function diceRng(diceList) {
  const f = fakeRng([0.5]);
  f.diceBag = [...diceList].reverse(); // 预置骰子洗牌袋，pop 顺序即 diceList 顺序
  return f;
}
function twoPlayerState() {
  return createGameState('TEST01', ['甲', '乙']);
}

test('骰子洗牌袋：每 10 次掷骰 1–10 各出现一次，抽完自动补袋', () => {
  const state = createGameState('DICE', ['甲']);
  const rng = fakeRng([0.5]);
  const first = [];
  for (let i = 0; i < 10; i++) first.push(rollDice(state, rng));
  assert.deepStrictEqual([...first].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const second = [];
  for (let i = 0; i < 10; i++) second.push(rollDice(state, rng));
  assert.deepStrictEqual([...second].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('购买：落在无主城市进入购买阶段，购买后归属与资金正确', () => {
  const state = twoPlayerState();
  state.firstRoundDone = true; // 第一轮结束后才可购买
  const rng = diceRng([2]); // 掷出 2 → 2 号开普敦（无主）
  logic.apply(state, { type: 'roll_dice' }, rng);
  assert.strictEqual(state.phase, 'buy');
  assert.strictEqual(state.pending.cityId, '开普敦');
  logic.apply(state, { type: 'buy', decision: 'buy' }, rng);
  assert.strictEqual(state.cities['开普敦'].ownerId, 'p0');
  assert.strictEqual(state.players[0].cash, 150000 - 7200);
});

test('第一轮（所有玩家回到起点一次）结束前不能购买房产和机场', () => {
  const state = twoPlayerState();
  state.players[0].position = 0;
  state.turnIndex = 0;
  state.phase = 'waiting_roll';
  // 第一轮未结束：落到开普敦（2 号）不进入购买
  let r = logic.apply(state, { type: 'roll_dice' }, diceRng([2]));
  assert.notStrictEqual(state.phase, 'buy'); // 不进入购买
  assert.strictEqual(state.cities['开普敦'].ownerId, null);
  assert.strictEqual(state.turnIndex, 1); // 回合结束，轮到乙
  assert.ok(r.events.some((e) => e.text.includes('第一轮不能购买')));
  // 第一轮未结束：落到机场（6 号开罗国际机场）同样不进入购买
  state.turnIndex = 0;
  state.players[0].position = 5;
  state.phase = 'waiting_roll';
  r = logic.apply(state, { type: 'roll_dice' }, diceRng([1]));
  assert.notStrictEqual(state.phase, 'buy_airport');
  assert.strictEqual(state.airports['开罗国际机场'].ownerId, null);
  assert.ok(r.events.some((e) => e.text.includes('第一轮不能购买机场')));
  // 第一轮结束后可购买
  state.firstRoundDone = true;
  state.turnIndex = 0;
  state.players[0].position = 1;
  state.phase = 'waiting_roll';
  r = logic.apply(state, { type: 'roll_dice' }, diceRng([1]));
  assert.strictEqual(state.phase, 'buy');
  assert.strictEqual(state.pending.cityId, '开普敦');
});

test('第一轮结束：所有玩家回到起点一次后开放购买', () => {
  const state = twoPlayerState();
  state.players[0].position = 41; // 甲：掷 1 跨过起点回到 0
  state.players[0].lapDone = false;
  state.players[1].lapDone = true; // 乙已完成一圈
  state.turnIndex = 0;
  state.phase = 'waiting_roll';
  const r = logic.apply(state, { type: 'roll_dice' }, diceRng([1]));
  assert.strictEqual(state.firstRoundDone, true);
  assert.ok(r.events.some((e) => e.text.includes('第一轮结束')));
});


test('每圈限购 4 座城市：第 5 座被拒绝，跨过起点重置', () => {
  const state = twoPlayerState();
  state.players[0].cash = 1000000;
  state.players[1].cash = 1000000; // 统一每圈 4 座上限，无特殊限制
  const cityIds = ['内罗毕', '开普敦', '卡萨布兰卡', '开罗'];
  for (const cid of cityIds) {
    state.turnIndex = 0;
    state.phase = 'buy';
    state.pending = { playerId: 'p0', cityId: cid, context: null };
    logic.apply(state, { type: 'buy', decision: 'buy' }, fakeRng([0.5]));
  }
  assert.strictEqual(state.players[0].lapBuys, 4);
  // 第 5 座被拒绝
  state.turnIndex = 0;
  state.phase = 'buy';
  state.pending = { playerId: 'p0', cityId: '奥克兰', context: null };
  const cashBefore = state.players[0].cash;
  const res = logic.apply(state, { type: 'buy', decision: 'buy' }, fakeRng([0.5]));
  assert.strictEqual(state.players[0].cash, cashBefore);
  assert.strictEqual(state.cities['奥克兰'].ownerId, null);
  assert.ok(res.events.some((e) => e.text.includes('购买上限')));
  // 跨过起点重置
  state.players[0].position = 40;
  state.turnIndex = 0;
  state.phase = 'waiting_roll';
  logic.apply(state, { type: 'roll_dice' }, diceRng([6])); // 6 → 46 → 4，跨过起点
  assert.strictEqual(state.players[0].lapBuys, 0);
});


test('每圈限购 4 座城市：第 5 座被拒绝，跨过起点重置', () => {
  const state = twoPlayerState();
  state.players[0].cash = 1000000;
  state.players[1].cash = 1000000; // 统一每圈 4 座上限，无特殊限制
  const cityIds = ['内罗毕', '开普敦', '卡萨布兰卡', '开罗'];
  for (const cid of cityIds) {
    state.turnIndex = 0;
    state.phase = 'buy';
    state.pending = { playerId: 'p0', cityId: cid, context: null };
    logic.apply(state, { type: 'buy', decision: 'buy' }, fakeRng([0.5]));
  }
  assert.strictEqual(state.players[0].lapBuys, 4);
  // 第 5 座被拒绝
  state.turnIndex = 0;
  state.phase = 'buy';
  state.pending = { playerId: 'p0', cityId: '奥克兰', context: null };
  const cashBefore = state.players[0].cash;
  const res = logic.apply(state, { type: 'buy', decision: 'buy' }, fakeRng([0.5]));
  assert.strictEqual(state.players[0].cash, cashBefore);
  assert.strictEqual(state.cities['奥克兰'].ownerId, null);
  assert.ok(res.events.some((e) => e.text.includes('购买上限')));
  // 跨过起点重置
  state.players[0].position = 40;
  state.turnIndex = 0;
  state.phase = 'waiting_roll';
  logic.apply(state, { type: 'roll_dice' }, diceRng([6])); // 6 → 46 → 4，跨过起点
  assert.strictEqual(state.players[0].lapBuys, 0);
});


test('高价城满级租金额外加成：地价≥15000 满级 +10%', () => {
  const state = twoPlayerState();
  state.cities['上海'].ownerId = 'p0'; // 地价 20000
  state.cities['上海'].houseLevel = 4;
  state.players[0].cities.push('上海');
  state.turnIndex = 1;
  state.phase = 'waiting_roll';
  state.players[1].position = 34;
  logic.apply(state, { type: 'roll_dice' }, diceRng([2])); // 34+2=36 上海
  // 20000 × 150% × 110% = 33000
  assert.strictEqual(state.players[1].cash, 150000 - 33000);
  assert.strictEqual(state.players[0].cash, 150000 + 33000);
  // 低价城（<15000）满级无加成：3600 × 150% = 5400
  const s2 = twoPlayerState();
  s2.cities['内罗毕'].houseLevel = 4;
  assert.strictEqual(logic.rentFor(s2.cities['内罗毕']), 5400);
});


test('收租：路过他人城市支付租金（整数）', () => {
  const state = twoPlayerState();
  state.cities['开罗'].ownerId = 'p0';
  state.players[0].cities.push('开罗');
  state.turnIndex = 1;
  state.phase = 'waiting_roll';
  state.players[1].position = 3;
  const rng = diceRng([2]); // 3+2=5 号开罗（甲的）
  logic.apply(state, { type: 'roll_dice' }, rng);
  assert.strictEqual(state.players[1].position, 5);
  assert.strictEqual(state.players[1].cash, 150000 - 1800);
  assert.strictEqual(state.players[0].cash, 150000 + 1800);
});

test('股票抵扣：持股阶梯减免租金，银行补足拥有者', () => {
  const mk = (shares) => {
    const state = twoPlayerState();
    state.cities['开罗'].ownerId = 'p0';
    state.players[0].cities.push('开罗');
    state.stocks['开罗'].holders['p1'] = shares;
    state.turnIndex = 1;
    state.phase = 'waiting_roll';
    state.players[1].position = 3;
    logic.apply(state, { type: 'roll_dice' }, diceRng([2])); // 3+2 → 5 号开罗
    return state;
  };
  // 5 股 = 25% → 减 10%
  let s = mk(5);
  assert.strictEqual(s.players[1].cash, 150000 - 1620);
  assert.strictEqual(s.players[0].cash, 150000 + 1800);
  // 8 股 = 40% → 减 30%
  s = mk(8);
  assert.strictEqual(s.players[1].cash, 150000 - 1260);
  // 12 股 = 60% → 减 50%
  s = mk(12);
  assert.strictEqual(s.players[1].cash, 150000 - 900);
});

test('建房与拆房：经过自有城可建 1 级、拆 1 级返还 60%', () => {
  const state = twoPlayerState();
  state.cities['内罗毕'].ownerId = 'p0';
  state.players[0].cities.push('内罗毕');
  state.players[0].position = 1;
  state.phase = 'waiting_roll';
  logic.apply(state, { type: 'build_house', cityId: '内罗毕' }, fakeRng([0.5]));
  assert.strictEqual(state.cities['内罗毕'].houseLevel, 1);
  assert.strictEqual(state.players[0].cash, 150000 - 2160);
  logic.apply(state, { type: 'demolish_house', cityId: '内罗毕' }, fakeRng([0.5]));
  assert.strictEqual(state.cities['内罗毕'].houseLevel, 0);
  assert.strictEqual(state.players[0].cash, 150000 - 2160 + 1296);
});

test('抵押可随时进行（非掷骰阶段也可）', () => {
  const state = twoPlayerState();
  state.cities['开罗'].ownerId = 'p0';
  state.players[0].cities.push('开罗');
  state.phase = 'build_decide'; // 非掷骰阶段
  state.pending = { playerId: 'p0', cityId: '开罗', kind: 'build' };
  logic.apply(state, { type: 'mortgage', cityId: '开罗' }, fakeRng([0.5]));
  assert.strictEqual(state.cities['开罗'].mortgaged, true);
});


test('抵押与赎回：每轮计息 5%；赎回需站在该城市', () => {
  const state = twoPlayerState();
  state.cities['开罗'].ownerId = 'p0';
  state.players[0].cities.push('开罗');
  state.phase = 'waiting_roll';
  logic.apply(state, { type: 'mortgage', cityId: '开罗' }, fakeRng([0.5]));
  assert.strictEqual(state.cities['开罗'].mortgaged, true);
  assert.strictEqual(state.players[0].cash, 150000 + 3000);
  // 推进一轮（乙回合结束回到甲）→ 计息一次
  state.turnIndex = 1;
  logic.advanceTurn(state, [], fakeRng([0.5]));
  assert.strictEqual(state.cities['开罗'].mortgageInterest, 150);
  // 不在城市上时赎回被拒
  state.turnIndex = 0;
  state.phase = 'waiting_roll';
  state.players[0].cash += 3150;
  const cashBefore = state.players[0].cash;
  logic.apply(state, { type: 'redeem', cityId: '开罗' }, fakeRng([0.5]));
  assert.strictEqual(state.cities['开罗'].mortgaged, true);
  assert.strictEqual(state.players[0].cash, cashBefore);
  // 站在开罗（5 号）上可赎回
  state.players[0].position = 5;
  logic.apply(state, { type: 'redeem', cityId: '开罗' }, fakeRng([0.5]));
  assert.strictEqual(state.cities['开罗'].mortgaged, false);
  assert.strictEqual(state.cities['开罗'].mortgageInterest, 0);
  assert.strictEqual(state.players[0].cash, 150000 + 3000);
});

test('机会卡：抽到奖励卡获得金额', () => {
  const state = twoPlayerState();
  state.chanceDeck = [state.chanceDeck.find((c) => c.type === 'reward' && c.amount === 8000)];
  state.players[0].position = 1;
  const rng = diceRng([2]); // 1+2=3 号机会卡
  logic.apply(state, { type: 'roll_dice' }, rng);
  assert.strictEqual(state.players[0].cash, 150000 + 8000);
});

test('拍卖：最高出价者可以结束拍卖（按当前最高价成交）', () => {
  const state = createGameState('TEST03', ['甲', '乙', '丙']);
  state.firstRoundDone = true;
  state.phase = 'buy';
  state.pending = { playerId: 'p0', cityId: '开普敦', context: null };
  logic.apply(state, { type: 'buy', decision: 'pass' }, fakeRng([0.5]));
  // 乙（第一个出价者）出价 5400
  logic.apply(state, { type: 'auction_respond', decision: 'bid', amount: 5400 }, fakeRng([0.5]));
  // 丙放弃
  logic.apply(state, { type: 'auction_respond', decision: 'pass' }, fakeRng([0.5]));
  // 新一轮轮到乙（当前最高出价者）→ 结束拍卖，按当前价成交
  assert.strictEqual(state.pending.awaiting, 'p1');
  const res = logic.apply(state, { type: 'auction_respond', decision: 'end' }, fakeRng([0.5]));
  assert.strictEqual(state.cities['开普敦'].ownerId, 'p1');
  assert.strictEqual(state.players[1].cash, 150000 - 5400);
  assert.ok(res.events.some((e) => e.text.includes('结束拍卖')));
});

test('每圈 4 座上限制：拍卖所得计入 lapBuys', () => {
  const state = twoPlayerState();
  state.firstRoundDone = true;
  state.players[0].lapBuys = 3;
  state.phase = 'buy';
  state.pending = { playerId: 'p0', cityId: '开普敦', context: null };
  const rng = diceRng([1]); // 拍卖定序
  logic.apply(state, { type: 'buy', decision: 'pass' }, rng);
  assert.strictEqual(state.phase, 'auction_bid');
  // 乙出价成交（乙 lapBuys 从 0 → 1）
  logic.apply(state, { type: 'auction_respond', decision: 'bid', amount: 5400 }, rng);
  logic.apply(state, { type: 'auction_respond', decision: 'pass' }, rng);
  assert.strictEqual(state.cities['开普敦'].ownerId, 'p1');
  assert.strictEqual(state.players[1].lapBuys, 1);
});

test('每圈 4 座上限制：已达上限的玩家不能参与拍卖出价', () => {
  const state = twoPlayerState();
  state.firstRoundDone = true;
  state.players[1].lapBuys = 4;
  state.phase = 'buy';
  state.pending = { playerId: 'p0', cityId: '开普敦', context: null };
  const rng = diceRng([1]); // 拍卖定序
  logic.apply(state, { type: 'buy', decision: 'pass' }, rng);
  assert.strictEqual(state.phase, 'auction_bid');
  logic.apply(state, { type: 'auction_respond', decision: 'bid', amount: 5400 }, rng);
  assert.strictEqual(state.cities['开普敦'].ownerId, null); // 无人可出价 → 流拍归银行
  assert.strictEqual(state.players[1].lapBuys, 4);
});

test('每圈 4 座上限制：直接出售所得计入 lapBuys', () => {
  const state = twoPlayerState();
  state.cities['开罗'].ownerId = 'p1';
  state.players[1].cities.push('开罗');
  state.players[0].position = 0;
  state.players[0].lapBuys = 3;
  state.turnIndex = 1; // 卖家为乙（p1）在起点发起直接出售
  state.phase = 'waiting_roll';
  logic.apply(state, { type: 'sell_city', cityId: '开罗', mode: 'direct' }, fakeRng([0.5]));
  assert.strictEqual(state.phase, 'direct_sale_ask');
  logic.apply(state, { type: 'direct_sale_respond', decision: 'buy' }, fakeRng([0.5]));
  assert.strictEqual(state.cities['开罗'].ownerId, 'p0');
  assert.strictEqual(state.players[0].lapBuys, 4);
});


test('建房：购买后需再次到达才能建房', () => {
  const state = twoPlayerState();
  state.players[0].cash = 200000;
  state.phase = 'buy';
  state.pending = { playerId: 'p0', cityId: '开罗', context: null };
  logic.apply(state, { type: 'buy', decision: 'buy' }, fakeRng([0.5]));
  assert.strictEqual(state.cities['开罗'].ownerId, 'p0');
  assert.strictEqual(state.cities['开罗'].buildReady, false);
  // 站在刚买的城市上（回合内），build_house 应被拒绝
  state.turnIndex = 0;
  state.phase = 'waiting_roll';
  state.players[0].position = 5;
  const cashBefore = state.players[0].cash;
  logic.apply(state, { type: 'build_house', cityId: '开罗' }, fakeRng([0.5]));
  assert.strictEqual(state.cities['开罗'].houseLevel, 0);
  assert.strictEqual(state.players[0].cash, cashBefore);
  // 再次到达（落点结算到自己的城市）后可以建房
  state.turnIndex = 0;
  state.phase = 'waiting_roll';
  state.players[0].position = 3;
  logic.apply(state, { type: 'roll_dice' }, diceRng([2])); // 3+2=5 号开罗
  assert.strictEqual(state.cities['开罗'].buildReady, true);
});


test('破产：唯一幸存者获胜', () => {
  const state = twoPlayerState();
  state.turnIndex = 1;
  logic.apply(state, { type: 'surrender' }, fakeRng([0.5]));
  assert.strictEqual(state.status, 'over');
  assert.strictEqual(state.winner, 'p0');
});

test('拍卖：放弃购买进入拍卖，出价最高者获得', () => {
  const state = twoPlayerState();
  state.phase = 'buy';
  state.pending = { playerId: 'p0', cityId: '开普敦', context: null };
  const rng = diceRng([1]); // 拍卖掷骰定序
  logic.apply(state, { type: 'buy', decision: 'pass' }, rng);
  assert.strictEqual(state.phase, 'auction_bid');
  logic.apply(state, { type: 'auction_respond', decision: 'bid', amount: 5400 }, rng);
  logic.apply(state, { type: 'auction_respond', decision: 'pass' }, rng);
  assert.strictEqual(state.cities['开普敦'].ownerId, 'p1');
  assert.strictEqual(state.players[1].cash, 150000 - 5400);
});
test('破产：多城连续拍卖逐座完成，唯一侧存者获胜', () => {
  const state = twoPlayerState();
  for (const cityId of ['开罗', '东京', '上海']) {
    state.cities[cityId].ownerId = 'p0';
    state.players[0].cities.push(cityId);
  }
  // 触发破产（自救失败）：资金不足且放弃自救
  state.phase = 'self_rescue';
  state.pending = { playerId: 'p0', kind: 'self_rescue', due: 50000, reason: '租金', resume: false };
  state.players[0].cash = -50000;
  const rng = fakeRng([0.5]);
  logic.apply(state, { type: 'rescue_done' }, rng);
  assert.strictEqual(state.phase, 'auction_bid');
  let guard = 0;
  while (state.phase === 'auction_bid' && guard++ < 20) {
    logic.apply(state, { type: 'auction_respond', decision: 'pass' }, rng);
  }
  assert.strictEqual(state.status, 'over');
  assert.strictEqual(state.winner, 'p1');
  assert.strictEqual(state.cities['开罗'].ownerId, null);
  assert.strictEqual(state.cities['东京'].ownerId, null);
  assert.strictEqual(state.cities['上海'].ownerId, null);
});

test('破产：拍卖中另一玩家出价获得后结算胜负', () => {
  const state = twoPlayerState();
  state.cities['开罗'].ownerId = 'p0';
  state.players[0].cities.push('开罗');
  state.phase = 'self_rescue';
  state.pending = { playerId: 'p0', kind: 'self_rescue', due: 50000, reason: '租金', resume: false };
  state.players[0].cash = -50000;
  const rng = fakeRng([0.5]);
  logic.apply(state, { type: 'rescue_done' }, rng);
  assert.strictEqual(state.phase, 'auction_bid');
  logic.apply(state, { type: 'auction_respond', decision: 'bid', amount: 4500 }, rng);
  logic.apply(state, { type: 'auction_respond', decision: 'pass' }, rng);
  assert.strictEqual(state.status, 'over');
  assert.strictEqual(state.winner, 'p1');
  assert.strictEqual(state.cities['开罗'].ownerId, 'p1');
  assert.strictEqual(state.players[1].cash, 150000 - 4500); // 2 人局幸存者即资产最高者，无救济金
});

test('破产：押质城市归银行不进拍卖', () => {
  const state = twoPlayerState();
  state.cities['开罗'].ownerId = 'p0';
  state.players[0].cities.push('开罗');
  state.cities['开罗'].mortgaged = true;
  state.cities['开罗'].mortgageInterest = 300;
  state.phase = 'self_rescue';
  state.pending = { playerId: 'p0', kind: 'self_rescue', due: 50000, reason: '租金', resume: false };
  state.players[0].cash = -50000;
  logic.apply(state, { type: 'rescue_done' }, fakeRng([0.5]));
  assert.strictEqual(state.status, 'over');
  assert.strictEqual(state.winner, 'p1');
  assert.strictEqual(state.cities['开罗'].ownerId, null);
  assert.strictEqual(state.cities['开罗'].mortgaged, false);
  assert.strictEqual(state.cities['开罗'].mortgageInterest, 0);
});

test('拍卖出售后卖家破产，已售城市仍归买家（不收回银行）', () => {
  const state = twoPlayerState();
  state.phase = 'waiting_roll';
  state.pending = null;
  state.turnIndex = 0;
  state.players[0].position = 0;
  state.cities['开罗'].ownerId = 'p0';
  state.players[0].cities.push('开罗');

  // 卖家在起点发起拍卖出售，唯一参与者出价即成交
  const rng = diceRng([1]);
  logic.apply(state, { type: 'sell_city', cityId: '开罗', mode: 'auction' }, rng);
  assert.strictEqual(state.phase, 'auction_bid');
  logic.apply(state, { type: 'auction_respond', decision: 'bid', amount: 4500 }, rng);
  assert.strictEqual(state.cities['开罗'].ownerId, 'p1');
  assert.ok(state.players[1].cities.includes('开罗'));
  assert.ok(!state.players[0].cities.includes('开罗'));

  // 卖家随后破产：已售城市应保持归属买家，不能收回银行
  state.turnIndex = 0;
  state.phase = 'self_rescue';
  state.pending = { playerId: 'p0', kind: 'self_rescue', due: 50000, reason: '租金', resume: false };
  state.players[0].cash = -50000;
  logic.apply(state, { type: 'rescue_done' }, fakeRng([0.5]));
  assert.strictEqual(state.status, 'over');
  assert.strictEqual(state.winner, 'p1');
  assert.strictEqual(state.cities['开罗'].ownerId, 'p1');
});

test('超阶段自救动作被拒绝', () => {
  const state = twoPlayerState();
  state.cities['开罗'].ownerId = 'p0';
  state.players[0].cities.push('开罗');
  state.phase = 'auction_bid';
  state.pending = { type: 'auction', cityId: '开罗', sellerId: null, order: ['p1'], index: 0, currentBid: 0, currentBidder: null, roundBidMade: false, awaiting: 'p1' };
  const cashBefore = state.players[0].cash;
  const res = logic.apply(state, { type: 'rescue_mortgage', cityId: '开罗' }, fakeRng([0.5]));
  assert.strictEqual(res.rejected, true);
  assert.strictEqual(state.players[0].cash, cashBefore);
  assert.strictEqual(state.cities['开罗'].mortgaged, false);
});

test('自救：抵押凑够金额自动结束自救，未凑够留在自救界面', () => {
  const state = twoPlayerState();
  state.players[0].cash = -3000;
  state.players[0].cities = ['开罗', '内罗毕'];
  state.cities['开罗'].ownerId = 'p0';
  state.cities['内罗毕'].ownerId = 'p0';
  state.phase = 'self_rescue';
  state.pending = { playerId: 'p0', kind: 'self_rescue', due: 3000, reason: '测试', resume: false };
  // 抵押开罗（价值 6000 → 抵押 3000）：现金归零，凑够 → 自动结束自救
  logic.apply(state, { type: 'rescue_mortgage', cityId: '开罗' }, fakeRng([0.5]));
  assert.strictEqual(state.players[0].cash, 0);
  assert.strictEqual(state.cities['开罗'].mortgaged, true);
  assert.strictEqual(state.phase, 'waiting_roll');
  // 未凑够场景：欠 5000，抵押开罗后仍欠 2000 → 留在自救界面
  const s2 = twoPlayerState();
  s2.players[0].cash = -5000;
  s2.players[0].cities = ['开罗', '内罗毕'];
  s2.cities['开罗'].ownerId = 'p0';
  s2.cities['内罗毕'].ownerId = 'p0';
  s2.phase = 'self_rescue';
  s2.pending = { playerId: 'p0', kind: 'self_rescue', due: 5000, reason: '测试', resume: false };
  logic.apply(s2, { type: 'rescue_mortgage', cityId: '开罗' }, fakeRng([0.5]));
  assert.strictEqual(s2.players[0].cash, -2000);
  assert.strictEqual(s2.phase, 'self_rescue');
  // 再抵押内罗毕（价值 3600 → 抵押 1800）：仍欠 200 → 继续留在自救界面
  logic.apply(s2, { type: 'rescue_mortgage', cityId: '内罗毕' }, fakeRng([0.5]));
  assert.strictEqual(s2.players[0].cash, -200);
  assert.strictEqual(s2.phase, 'self_rescue');
});


test('破产救济金：仅破产时发放，总额 15000 分给资产最高者之外的存活玩家', () => {
  const state = createGameState('TEST03', ['甲', '乙', '丙']);
  state.players[0].cash = -50000;
  state.players[1].cash = 200000;
  state.players[2].cash = 50000;
  state.phase = 'self_rescue';
  state.pending = { playerId: 'p0', kind: 'self_rescue', due: 50000, reason: '租金', resume: false };
  logic.apply(state, { type: 'rescue_done' }, fakeRng([0.5]));
  // 乙资产最高不发放；丙获得全部 15000
  assert.strictEqual(state.players[1].cash, 200000);
  assert.strictEqual(state.players[2].cash, 50000 + 15000);
  assert.ok(state.rank.includes('p0'));
});


test('监狱：80 轮后 21 号监狱满 3 回合缴纳 30% 出狱费', () => {
  const state = twoPlayerState();
  state.rounds = 90;
  state.players[0].jailed = true;
  state.players[0].jailTurns = 3;
  state.players[0].cash = 200000;
  state.players[0].position = 21;
  state.turnIndex = 1;
  state.phase = 'waiting_roll';
  const evs = [];
  logic.advanceTurn(state, evs, fakeRng([0.5]));
  assert.strictEqual(state.players[0].jailed, false);
  assert.strictEqual(state.players[0].cash, 200000 - 4500); // 15000 × 30%
  assert.strictEqual(state.phase, 'waiting_roll');
  assert.ok(evs.some((e) => e.text.includes('30% 出狱费')));
  // 80 轮以内仍免费
  const s2 = twoPlayerState();
  s2.players[0].jailed = true;
  s2.players[0].jailTurns = 3;
  s2.players[0].cash = 200000;
  s2.players[0].position = 21;
  s2.turnIndex = 1;
  logic.advanceTurn(s2, [], fakeRng([0.5]));
  assert.strictEqual(s2.players[0].cash, 200000);
});


test('认输：资产直接归银行，不进入拍卖', () => {
  const state = twoPlayerState();
  for (const cityId of ['开罗', '东京']) {
    state.cities[cityId].ownerId = 'p0';
    state.players[0].cities.push(cityId);
  }
  state.cities['开罗'].mortgaged = true;
  state.cities['开罗'].mortgageInterest = 3000;
  state.players[0].airports.push('开罗国际机场');
  state.airports['开罗国际机场'].ownerId = 'p0';
  state.stocks['开罗'].holders['p0'] = 2;
  state.players[0].stocks['开罗'] = 2;
  state.players[0].cash = 5000;
  logic.apply(state, { type: 'surrender' }, fakeRng([0.5]));
  assert.strictEqual(state.status, 'over');
  assert.strictEqual(state.winner, 'p1');
  assert.strictEqual(state.phase, 'game_over');
  assert.strictEqual(state.cities['开罗'].ownerId, null);
  assert.strictEqual(state.cities['东京'].ownerId, null);
  assert.strictEqual(state.cities['开罗'].mortgaged, false);
  assert.strictEqual(state.cities['开罗'].mortgageInterest, 0);
  assert.strictEqual(state.airports['开罗国际机场'].ownerId, null);
  assert.strictEqual(state.stocks['开罗'].holders['p0'], 0);
  assert.strictEqual(state.players[0].cash, 0);
  assert.deepStrictEqual(state.rank, ['p1', 'p0']);
});

test('抵押：利息按城市累计，赎回一城只付该城本金+利息', () => {
  const state = twoPlayerState();
  state.cities['开罗'].ownerId = 'p0';
  state.players[0].cities.push('开罗');
  state.cities['东京'].ownerId = 'p0';
  state.players[0].cities.push('东京');
  state.players[0].cash = 200000;
  state.phase = 'waiting_roll';
  logic.apply(state, { type: 'mortgage', cityId: '开罗' }, fakeRng([0.5]));
  logic.apply(state, { type: 'mortgage', cityId: '东京' }, fakeRng([0.5]));
  assert.strictEqual(state.players[0].cash, 200000 + 3000 + 8500);
  // 推进两轮计息
  state.turnIndex = 1;
  logic.advanceTurn(state, [], fakeRng([0.5]));
  state.turnIndex = 1;
  logic.advanceTurn(state, [], fakeRng([0.5]));
  assert.strictEqual(state.cities['开罗'].mortgageInterest, Math.round(3000 * 0.05) * 2);
  assert.strictEqual(state.cities['东京'].mortgageInterest, Math.round(8500 * 0.05) * 2);
  // 赎回开罗：只付开罗本金+利息，东京利息保留
  state.turnIndex = 0;
  state.players[0].position = 5;
  logic.apply(state, { type: 'redeem', cityId: '开罗' }, fakeRng([0.5]));
  assert.strictEqual(state.cities['开罗'].mortgaged, false);
  assert.strictEqual(state.cities['开罗'].mortgageInterest, 0);
  assert.strictEqual(state.cities['东京'].mortgaged, true);
  assert.strictEqual(state.cities['东京'].mortgageInterest, Math.round(8500 * 0.05) * 2);
});

test('交易：非起点自愿出售被拒绝，起点允许', () => {
  const state = twoPlayerState();
  state.cities['开罗'].ownerId = 'p0';
  state.players[0].cities.push('开罗');
  state.players[0].position = 5;
  state.phase = 'waiting_roll';
  logic.apply(state, { type: 'sell_city', cityId: '开罗', mode: 'direct' }, fakeRng([0.5]));
  assert.strictEqual(state.phase, 'waiting_roll');
  assert.strictEqual(state.cities['开罗'].ownerId, 'p0');
  state.players[0].position = 0;
  logic.apply(state, { type: 'sell_city', cityId: '开罗', mode: 'direct' }, fakeRng([0.5]));
  assert.strictEqual(state.phase, 'direct_sale_ask');
});

test('交易：竞拍中不可临时押押/出售凑钱', () => {
  const state = twoPlayerState();
  state.cities['开罗'].ownerId = 'p0';
  state.players[0].cities.push('开罗');
  state.phase = 'auction_bid';
  state.pending = { type: 'auction', cityId: '东京', sellerId: null, order: ['p1'], index: 0, currentBid: 0, currentBidder: null, roundBidMade: false, awaiting: 'p1' };
  const r1 = logic.apply(state, { type: 'mortgage', cityId: '开罗' }, fakeRng([0.5]));
  const r2 = logic.apply(state, { type: 'sell_city', cityId: '开罗', mode: 'direct' }, fakeRng([0.5]));
  assert.strictEqual(r1.rejected, true);
  assert.strictEqual(r2.rejected, true);
  assert.strictEqual(state.cities['开罗'].mortgaged, false);
});

test('股票：同笔卖出所得可用于买入', () => {
  const state = twoPlayerState();
  state.cities['开罗'].ownerId = 'p1';
  state.stocks['开罗'].holders['p0'] = 2;
  state.players[0].stocks['开罗'] = 2;
  state.players[0].cash = 0;
  state.phase = 'stock';
  state.pending = { playerId: 'p0', kind: 'go_stock', after: 'end' };
  const price = state.stocks['开罗'].price;
  const res = logic.apply(state, { type: 'stock_trade', orders: [{ cityId: '开罗', side: 'sell', shares: 2 }, { cityId: '开罗', side: 'buy', shares: 1 }] }, fakeRng([0.5]));
  assert.strictEqual(res.rejected, undefined);
  assert.strictEqual(state.players[0].cash, 2 * price - price);
  assert.strictEqual(state.stocks['开罗'].holders['p0'], 1);
});

test('股票：买卖与未交易均有事件记录', () => {
  const state = twoPlayerState();
  state.cities['开罗'].ownerId = 'p1';
  state.stocks['开罗'].price = 600; // 开罗地价 6000/10
  state.players[0].cash = 150000;
  state.phase = 'stock';
  state.pending = { playerId: 'p0', kind: 'go_stock', after: 'end' };
  const res = logic.apply(state, { type: 'stock_trade', orders: [{ cityId: '开罗', side: 'buy', shares: 2 }] }, fakeRng([0.5]));
  assert.strictEqual(res.rejected, undefined);
  assert.ok(res.events.some((e) => e.type === 'stock' && e.text.includes('购买 埃及·开罗 股份 ×2（1200）')));
  // 未交易也有记录
  const s2 = twoPlayerState();
  s2.cities['开罗'].ownerId = 'p1';
  s2.phase = 'stock';
  s2.pending = { playerId: 'p0', kind: 'go_stock', after: 'end' };
  const res2 = logic.apply(s2, { type: 'stock_done' }, fakeRng([0.5]));
  assert.ok(res2.events.some((e) => e.type === 'stock' && e.text.includes('未进行股票交易')));
});





test('股票：现金不足时交易未生效并记录原因', () => {
  const state = twoPlayerState();
  state.cities['开罗'].ownerId = 'p1';
  state.stocks['开罗'].price = 600;
  state.players[0].cash = 100;
  state.phase = 'stock';
  state.pending = { playerId: 'p0', kind: 'go_stock', after: 'end' };
  const res = logic.apply(state, { type: 'stock_trade', orders: [{ cityId: '开罗', side: 'buy', shares: 2 }] }, fakeRng([0.5]));
  assert.strictEqual(state.players[0].cash, 100); // 交易未生效
  assert.strictEqual(state.stocks['开罗'].holders['p0'] || 0, 0);
  assert.ok(res.events.some((e) => e.type === 'stock' && e.text.includes('现金不足')));
});


test('股票转让：发起后对方确认回到股票窗口，每回合限一笔', () => {
  const state = twoPlayerState();
  state.cities['开罗'].ownerId = 'p1';
  state.stocks['开罗'].holders['p0'] = 2;
  state.players[0].stocks['开罗'] = 2;
  state.phase = 'stock';
  state.pending = { playerId: 'p0', kind: 'go_stock', after: 'land' };
  let res = logic.apply(state, { type: 'stock_transfer', targetId: 'p1', items: [{ cityId: '开罗', shares: 1 }], cash: 500 }, fakeRng([0.5]));
  assert.strictEqual(res.rejected, undefined);
  assert.strictEqual(state.phase, 'trade_confirm');

  // 对方确认：股份转移、现金支付、回到股票窗口
  res = logic.apply(state, { type: 'stock_transfer', targetId: 'p1', accept: true }, fakeRng([0.5]));
  assert.strictEqual(res.rejected, undefined);
  assert.strictEqual(state.phase, 'stock');
  assert.strictEqual(state.pending.kind, 'go_stock');
  assert.strictEqual(state.stocks['开罗'].holders['p0'], 1);
  assert.strictEqual(state.stocks['开罗'].holders['p1'], 1);
  assert.strictEqual(state.players[0].cash, 150000 + 500);
  assert.strictEqual(state.players[1].cash, 150000 - 500);
  // 同回合再次发起：无效果（每回合限一笔）
  const h0 = state.stocks['开罗'].holders['p0'];
  const c0 = state.players[0].cash;
  res = logic.apply(state, { type: 'stock_transfer', targetId: 'p1', items: [{ cityId: '开罗', shares: 1 }], cash: 0 }, fakeRng([0.5]));
  assert.strictEqual(state.phase, 'stock');
  assert.strictEqual(state.stocks['开罗'].holders['p0'], h0);
  assert.strictEqual(state.players[0].cash, c0);
});

test('排名：按出局顺序记录，胜利者第一', () => {
  const state = createGameState('RANK', ['甲', '乙', '丙']);
  // 丙先认输，再甲认输，剩乙获胜
  state.turnIndex = 2;
  logic.apply(state, { type: 'surrender' }, fakeRng([0.5]));
  assert.strictEqual(state.phase, 'waiting_roll');
  assert.strictEqual(state.rank.includes('p2'), true);
  state.turnIndex = 0;
  logic.apply(state, { type: 'surrender' }, fakeRng([0.5]));
  assert.strictEqual(state.status, 'over');
  assert.strictEqual(state.winner, 'p1');
  assert.deepStrictEqual(state.rank, ['p1', 'p0', 'p2']);
});


test('购买机场后下一位玩家可正常掷骰（回合切换清空 pending）', () => {
  const state = twoPlayerState();
  state.players[0].position = 6;
  state.phase = 'buy_airport';
  state.pending = { playerId: 'p0', airportId: '开罗国际机场', context: null };
  logic.apply(state, { type: 'buy_airport', decision: 'buy' }, fakeRng([0.5]));
  assert.strictEqual(state.phase, 'waiting_roll');
  assert.strictEqual(state.turnIndex, 1);
  assert.strictEqual(state.pending, null);
  const res = logic.apply(state, { type: 'roll_dice' }, diceRng([1]));
  assert.strictEqual(res.rejected, undefined);
  assert.ok(typeof state.dice === 'number' && state.dice >= 1 && state.dice <= 10);
});


test('监狱：放弃出狱判定跳过回合，第 3 回合自动释放（免费）', () => {
  const state = twoPlayerState();
  state.players[0].jailed = true;
  state.players[0].jailTurns = 0;
  state.players[0].cash = 200000;
  state.players[0].position = 21;
  state.phase = 'jail_turn';
  state.pending = { playerId: 'p0', kind: 'jail' };
  const rng = fakeRng([0.5]);
  logic.apply(state, { type: 'respond_jail', decision: 'pass' }, rng);
  assert.strictEqual(state.players[0].jailTurns, 1);
  assert.strictEqual(state.turnIndex, 1);
  state.turnIndex = 0; state.phase = 'jail_turn'; state.pending = { playerId: 'p0', kind: 'jail' };
  logic.apply(state, { type: 'respond_jail', decision: 'pass' }, rng);
  assert.strictEqual(state.players[0].jailTurns, 2);
  assert.strictEqual(state.turnIndex, 1);
  // 第 3 回合：仍是出狱判定回合（一直放弃则关满 3 回合）
  state.turnIndex = 0; state.phase = 'jail_turn'; state.pending = { playerId: 'p0', kind: 'jail' };
  logic.apply(state, { type: 'respond_jail', decision: 'pass' }, rng);
  assert.strictEqual(state.players[0].jailTurns, 3);
  assert.strictEqual(state.turnIndex, 1);
  // 第 4 回合开始：自动释放（免费，出狱费仅用于提前出狱）
  const evs = [];
  logic.advanceTurn(state, evs, rng);
  assert.strictEqual(state.players[0].jailed, false);
  assert.strictEqual(state.players[0].jailTurns, 0);
  assert.strictEqual(state.phase, 'waiting_roll');
  assert.strictEqual(state.pending, null);
  assert.strictEqual(state.turnIndex, 0);
  assert.strictEqual(state.players[0].cash, 200000); // 免费释放，不扣出狱费
  assert.ok(evs.some((e) => e.text.includes('自动释放')));
});


test('监狱：掷出 1 或 10 出狱事件包含具体点数', () => {
  const state = twoPlayerState();
  state.players[0].jailed = true;
  state.players[0].jailTurns = 0;
  state.players[0].cash = 200000;
  state.players[0].position = 21;
  state.phase = 'jail_turn';
  state.pending = { playerId: 'p0', kind: 'jail' };
  const rng = diceRng([1]); // 掷出 1（幸运点数）
  const res = logic.apply(state, { type: 'respond_jail', decision: 'roll' }, rng);
  assert.strictEqual(state.players[0].jailed, false);
  assert.ok(res.events.some((e) => e.text.includes('1 或 10') && e.text.includes('出狱并移动')));
});


test('监狱：双方先后入狱后，狱中玩家掷骰出狱可继续推进', () => {
  const state = twoPlayerState();
  state.firstRoundDone = true; // 第一轮结束后，出狱落点可正常结算购买
  state.players[0].cash = 200000;
  state.players[1].cash = 200000;
  // 甲在狱中：掷 5 失败，轮到乙
  state.players[0].jailed = true;
  state.players[0].jailTurns = 0;
  state.players[0].position = 21;
  state.phase = 'jail_turn';
  state.pending = { playerId: 'p0', kind: 'jail' };
  let r = logic.apply(state, { type: 'respond_jail', decision: 'roll' }, diceRng([5]));
  assert.strictEqual(state.players[0].jailTurns, 1);
  assert.strictEqual(state.turnIndex, 1);
  assert.strictEqual(state.phase, 'waiting_roll');
  // 乙在 23 号位掷 3 到 26 号机会卡格，卡池第一张为「直接入狱」→ 21 号监狱（3 回合）
  state.players[1].position = 23;
  state.chanceDeck.unshift({ type: 'jail', name: '直接入狱' });
  r = logic.apply(state, { type: 'roll_dice' }, diceRng([3]));
  assert.strictEqual(state.players[1].jailed, true);
  assert.strictEqual(state.phase, 'jail_turn');
  assert.strictEqual(state.pending.playerId, 'p1');
  assert.strictEqual(state.turnIndex, 1);
  assert.ok(r.events.some((e) => e.text.includes('直接入狱')));
  // 乙在狱中掷出 1（幸运点数）出狱并移动，对局继续
  r = logic.apply(state, { type: 'respond_jail', decision: 'roll' }, diceRng([1]));
  assert.strictEqual(state.players[1].jailed, false);
  assert.strictEqual(state.players[1].jailTurns, 0);
  assert.notStrictEqual(state.phase, 'jail_turn');
  assert.ok(r.events.some((e) => e.text.includes('1 或 10') && e.text.includes('出狱并移动')));
});


test('监狱：11/32 号监狱关押 1 回合，下回合自动释放', () => {
  // 落到 11 号监狱：本回合跳过，下回合自动释放（无需缴费）
  const state = twoPlayerState();
  state.players[0].cash = 200000;
  state.players[0].position = 9;
  state.phase = 'waiting_roll';
  const rng = diceRng([2]); // 9 号 + 2 → 11 号监狱
  let r = logic.apply(state, { type: 'roll_dice' }, rng);
  assert.strictEqual(state.players[0].jailed, true);
  assert.strictEqual(state.players[0].position, 11);
  assert.notStrictEqual(state.phase, 'jail_turn'); // 不弹出出狱选择
  assert.strictEqual(state.turnIndex, 1); // 本回合跳过，轮到乙
  assert.ok(r.events.some((e) => e.text.includes('1 回合')));
  // 乙回合结束 → 轮到甲：关押 1 回合，本回合直接跳过
  const evs = [];
  logic.advanceTurn(state, evs, rng);
  assert.strictEqual(state.players[0].jailed, true);
  assert.strictEqual(state.players[0].jailTurns, 1);
  assert.strictEqual(state.turnIndex, 1);
  assert.ok(evs.some((e) => e.text.includes('本回合跳过')));
  // 再次轮到甲：自动释放（免费）
  const evs2 = [];
  logic.advanceTurn(state, evs2, rng);
  assert.strictEqual(state.players[0].jailed, false);
  assert.strictEqual(state.players[0].jailTurns, 0);
  assert.strictEqual(state.phase, 'waiting_roll');
  assert.strictEqual(state.turnIndex, 0);
  assert.strictEqual(state.players[0].cash, 200000); // 无需缴费
  assert.ok(evs2.some((e) => e.text.includes('自动释放')));
  // 入狱卡送到 32 号监狱：同样只关押 1 回合
  const s2 = twoPlayerState();
  s2.players[0].cash = 200000;
  s2.players[0].position = 0;
  s2.chanceDeck.unshift({ type: 'jail', name: '直接入狱' });
  s2.phase = 'waiting_roll';
  r = logic.apply(s2, { type: 'roll_dice' }, diceRng([3])); // 3 号机会卡 → 抽入狱卡 → 32 号
  assert.strictEqual(s2.players[0].jailed, true);
  assert.strictEqual(s2.players[0].position, 32);
  assert.notStrictEqual(s2.phase, 'jail_turn');
  assert.strictEqual(s2.turnIndex, 1);
});

test('监狱：连续两名 1 回合监狱玩家逐个跳过，第三人正常行动', () => {
  const state = createGameState('J3', ['甲', '乙', '丙']);
  state.players[0].jailed = true; state.players[0].jailTurns = 0; state.players[0].position = 11;
  state.players[1].jailed = true; state.players[1].jailTurns = 0; state.players[1].position = 32;
  state.players[2].position = 10;
  state.turnIndex = 2; // 丙刚行动完，按顺序应先轮甲
  state.phase = 'waiting_roll';
  const evs = [];
  logic.advanceTurn(state, evs, fakeRng([0.5]));
  assert.strictEqual(state.players[0].jailTurns, 1); // 甲被跳过
  assert.strictEqual(state.players[1].jailTurns, 1); // 乙也被跳过（不能自动释放）
  assert.strictEqual(state.players[0].jailed, true);
  assert.strictEqual(state.players[1].jailed, true);
  assert.strictEqual(state.turnIndex, 2); // 轮到丙
  assert.strictEqual(state.phase, 'waiting_roll');
});

test('监狱与极地互锁：双方先后受困，放弃/掷骰循环后正常轮转', () => {
  const state = twoPlayerState();
  state.players[0].cash = 200000; state.players[1].cash = 200000;
  // 甲在监狱，乙被冰冻，轮到甲
  state.players[0].jailed = true; state.players[0].jailTurns = 0; state.players[0].position = 21;
  state.players[1].frozen = true; state.players[1].position = 14;
  state.phase = 'jail_turn'; state.pending = { playerId: 'p0', kind: 'jail' }; state.turnIndex = 0;
  // 甲掷骰失败 → 轮到乙（冰冻）
  let r = logic.apply(state, { type: 'respond_jail', decision: 'roll' }, diceRng([5]));
  assert.strictEqual(r.rejected, undefined);
  assert.strictEqual(state.phase, 'frozen_turn');
  assert.strictEqual(state.pending.playerId, 'p1');
  // 乙放弃冰冻 → 轮到甲（监狱）
  r = logic.apply(state, { type: 'respond_frozen', decision: 'pass' }, fakeRng([0.5]));
  assert.strictEqual(r.rejected, undefined);
  assert.strictEqual(state.players[1].frozen, false);
  assert.strictEqual(state.phase, 'jail_turn');
  assert.strictEqual(state.pending.playerId, 'p0');
  // 甲放弃出狱判定 → 轮到乙正常行动
  r = logic.apply(state, { type: 'respond_jail', decision: 'pass' }, fakeRng([0.5]));
  assert.strictEqual(r.rejected, undefined);
  assert.strictEqual(state.players[0].jailTurns, 2);
  assert.strictEqual(state.phase, 'waiting_roll');
  assert.strictEqual(state.turnIndex, 1);
  assert.strictEqual(state.pending, null);
});


test('飞行到无主机场不触发购买，直接结束回合', () => {
  const state = twoPlayerState();
  state.players[0].position = 6;
  state.phase = 'flight';
  state.pending = { playerId: 'p0', kind: 'flight', fromAirportId: '开罗国际机场', free: true, context: null };
  logic.apply(state, { type: 'flight', target: '伦敦希思罗国际机场' }, fakeRng([0.5]));
  assert.strictEqual(state.players[0].position, 16);
  assert.strictEqual(state.phase, 'waiting_roll');
  assert.strictEqual(state.airports['伦敦希思罗国际机场'].ownerId, null);
});
test('监狱：落到 21 号监狱当回合直接结束回合，不弹掷骰出狱窗口', () => {
  const state = twoPlayerState();
  state.players[0].position = 20; // 掷 1 落到 21 号监狱
  state.players[0].cash = 200000;
  state.phase = 'waiting_roll';
  logic.apply(state, { type: 'roll_dice' }, diceRng([1]));
  assert.strictEqual(state.players[0].jailed, true);
  assert.strictEqual(state.players[0].jailTurns, 0);
  assert.notStrictEqual(state.phase, 'jail_turn'); // 当回合不弹窗
  assert.strictEqual(state.phase, 'waiting_roll'); // 直接轮到下一位
  assert.strictEqual(state.turnIndex, 1);
});
