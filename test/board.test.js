'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { buildBoard, buildChanceDeck } = require('../src/board');
const { createGameState } = require('../src/state');

test('棋盘共 42 格，构成符合 spec', () => {
  const board = buildBoard();
  assert.strictEqual(board.length, 42);
  const cities = board.filter((s) => s.type === 'city');
  const chances = board.filter((s) => s.type === 'chance');
  const airports = board.filter((s) => s.type === 'airport');
  const jails = board.filter((s) => s.type === 'jail');
  const poles = board.filter((s) => s.type === 'pole');
  assert.strictEqual(cities.length, 20);
  assert.strictEqual(chances.length, 8);
  assert.strictEqual(airports.length, 4);
  assert.strictEqual(jails.length, 3);
  assert.strictEqual(poles.length, 2);
  assert.deepStrictEqual(jails.map((s) => s.id).sort((a, b) => a - b), [11, 21, 32]);
  assert.deepStrictEqual(poles.map((s) => s.id).sort((a, b) => a - b), [14, 34]);
});

test('机会卡组 40 张：奖励 15、罚款 15、位移 9、入狱 1', () => {
  const deck = buildChanceDeck();
  assert.strictEqual(deck.length, 40);
  assert.strictEqual(deck.filter((c) => c.type === 'reward').length, 15);
  assert.strictEqual(deck.filter((c) => c.type === 'fine').length, 15);
  assert.strictEqual(deck.filter((c) => c.type === 'move').length, 9);
  assert.strictEqual(deck.filter((c) => c.type === 'jail').length, 1);
  // 罚款最高 8000
  assert.strictEqual(Math.max(...deck.filter((c) => c.type === 'fine').map((c) => c.amount)), 8000);
});

test('初始对局状态：2 名玩家、资金 100000、位置 0', () => {
  const state = createGameState('ABC123', ['甲', '乙']);
  assert.strictEqual(state.status, 'playing');
  assert.strictEqual(state.players.length, 2);
  assert.strictEqual(state.players[0].cash, 100000);
  assert.strictEqual(state.players[0].position, 0);
  assert.strictEqual(state.cities['上海'].price, 20000);
  assert.strictEqual(state.stocks['上海'].price, 2000);
});
