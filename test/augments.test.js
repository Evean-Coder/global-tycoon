'use strict';

const test = require('node:test');
const assert = require('node:assert');
const AUG = require('../src/augments');
const { createGameState } = require('../src/state');
const logic = require('../src/gameLogic');
const { createRng } = require('../src/random');

function fakeRng(seq) {
  let i = 0;
  return () => (i < seq.length ? seq[i++] : 0.5);
}

function diceRng(diceList) {
  const f = fakeRng([0.5]);
  f.diceBag = [...diceList].reverse();
  return f;
}

function twoPlayerState() {
  return createGameState('AUG', ['甲', '乙']);
}

function addAug(state, id) {
  const def = AUG.AUGMENTS[id];
  state.players[0].augments.push({ id: def.id, name: def.name, desc: def.desc, tier: def.tier, acquiredAtLap: 10 });
}

test('getAugmentChoices：按第 1/6/10 圈锁定品质且 3 张互不重复', () => {
  const rng = createRng(7);
  const silver = AUG.getAugmentChoices(1, rng);
  assert.strictEqual(silver.length, 3);
  assert.ok(silver.every((c) => c.tier === 'silver'));
  assert.strictEqual(new Set(silver.map((c) => c.id)).size, 3);

  const gold = AUG.getAugmentChoices(6, rng);
  assert.ok(gold.every((c) => c.tier === 'gold'));

  const prismatic = AUG.getAugmentChoices(10, rng);
  assert.ok(prismatic.every((c) => c.tier === 'prismatic'));

  assert.deepStrictEqual(AUG.getAugmentChoices(2, rng), []);
  assert.deepStrictEqual(AUG.getAugmentChoices(5, rng), []);
  assert.deepStrictEqual(AUG.getAugmentChoices(11, rng), []);
});

test('圈数触发：完成第 1 圈进入白银三选一', () => {
  const state = twoPlayerState();
  state.players[0].position = 40;
  logic.apply(state, { type: 'roll_dice' }, diceRng([5])); // 40+5 跨过起点
  assert.strictEqual(state.players[0].lapCount, 1);
  assert.strictEqual(state.phase, 'augment_choice');
  assert.strictEqual(state.pending.tier, 'silver');
  assert.strictEqual(state.pending.choices.length, 3);
});

test('海克斯选择与刷新：选牌入库、刷新同品质重抽', () => {
  const state = twoPlayerState();
  state.players[0].position = 40;
  logic.apply(state, { type: 'roll_dice' }, diceRng([5]));
  assert.strictEqual(state.phase, 'augment_choice');
  const before = state.pending.choices.map((c) => c.id);
  const picked = before[0];
  const rng = fakeRng([0.5]);
  logic.apply(state, { type: 'augment_choose', augId: picked }, rng);
  assert.ok(state.players[0].augments.some((a) => a.id === picked));
  assert.strictEqual(state.phase, 'stock'); // 跨过起点后进入股票窗口

  // 刷新：从同品质池重抽，且不包含旧选项
  const state2 = twoPlayerState();
  state2.players[0].position = 40;
  logic.apply(state2, { type: 'roll_dice' }, diceRng([5]));
  logic.apply(state2, { type: 'augment_reroll' }, fakeRng([0.5]));
  assert.strictEqual(state2.pending.rerollUsed, true);
  assert.strictEqual(state2.pending.choices.length, 3);
});

test('技能：开工补贴（购买未开发空地 35% 折扣）', () => {
  const state = twoPlayerState();
  state.firstRoundDone = true;
  addAug(state, 'AUG_SILVER_01');
  logic.apply(state, { type: 'roll_dice' }, diceRng([1])); // 0+1 → 内罗毕（3600）
  assert.strictEqual(state.phase, 'buy');
  logic.apply(state, { type: 'buy', decision: 'buy' }, fakeRng([0.5]));
  assert.strictEqual(state.cities['内罗毕'].ownerId, 'p0');
  assert.strictEqual(state.players[0].cash, 150000 - Math.round(3600 * 0.65));
});

test('技能：双速引擎（奇数点数 +2 步）', () => {
  const state = twoPlayerState();
  state.firstRoundDone = true;
  addAug(state, 'AUG_SILVER_02');
  logic.apply(state, { type: 'roll_dice' }, diceRng([3]));
  assert.strictEqual(state.dice, 3);
  assert.strictEqual(state.players[0].position, 5);
});

test('技能：空间折跃（两骰选择相加/相减/相乘）', () => {
  const state = twoPlayerState();
  state.firstRoundDone = true;
  addAug(state, 'AUG_PRISMATIC_05');
  logic.apply(state, { type: 'roll_dice' }, fakeRng([0.5]));
  assert.strictEqual(state.phase, 'augment_dice_choice');
  const a = state.pending.diceA;
  const b = state.pending.diceB;
  logic.apply(state, { type: 'augment_dice_choice', method: 'sum' }, fakeRng([0.5]));
  assert.strictEqual(state.players[0].position, a + b);
});

test('技能：末日对冲（破产免除一次，保留最高级地产并重置现金）', () => {
  const state = twoPlayerState();
  addAug(state, 'AUG_PRISMATIC_04');
  state.cities['开罗'].ownerId = 'p0';
  state.players[0].cities.push('开罗');
  state.cities['东京'].ownerId = 'p0';
  state.players[0].cities.push('东京');
  state.cities['东京'].houseLevel = 2;
  state.phase = 'self_rescue';
  state.pending = { playerId: 'p0', kind: 'self_rescue', due: 50000, reason: '租金', resume: false };
  state.players[0].cash = -50000;
  logic.apply(state, { type: 'rescue_done' }, fakeRng([0.5]));
  assert.strictEqual(state.status, 'playing');
  assert.strictEqual(state.players[0].alive, true);
  assert.strictEqual(state.players[0].cash, 2000);
  assert.deepStrictEqual(state.players[0].cities, ['东京']);
  assert.strictEqual(state.cities['开罗'].ownerId, null);
  assert.strictEqual(state.cities['东京'].ownerId, 'p0');
});

test('技能：恶意收购放弃买断后正常付租，不重复触发买断', () => {
  const state = twoPlayerState();
  state.firstRoundDone = true;
  addAug(state, 'AUG_PRISMATIC_01');
  state.cities['开罗'].ownerId = 'p1';
  state.players[1].cities.push('开罗');
  state.cities['开罗'].houseLevel = 1; // p1 的最高级地产
  state.players[0].position = 4;
  logic.apply(state, { type: 'roll_dice' }, diceRng([1])); // 4+1 → 5 号开罗
  assert.strictEqual(state.phase, 'augment_buyout');
  // 放弃买断：应进入普通收租并结束回合，而不是再次弹出买断
  logic.apply(state, { type: 'augment_buyout', decision: 'pass' }, fakeRng([0.5]));
  assert.notStrictEqual(state.phase, 'augment_buyout');
  assert.strictEqual(state.players[0].cash, 150000 - 3600);
  assert.strictEqual(state.players[1].cash, 150000 + 3600);
});
