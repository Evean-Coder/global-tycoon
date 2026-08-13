'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const { io: Client } = require('socket.io-client');
const { createGameState, resetDeck } = require('../src/state');
const { createRng } = require('../src/random');
const { buildGameRecord, computeStats } = require('../src/record');

const spawnedChildren = [];
const spawnedSockets = [];

function once(sock, ev, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting ${ev}`)), timeout);
    sock.once(ev, (data) => { clearTimeout(t); resolve(data); });
  });
}

test('computeStats：从事件文本统计关键动作', () => {
  const events = [
    { type: 'buy', text: '甲 购买 中国·上海（20000，本圈第 1 座）' },
    { type: 'buy', text: '乙 放弃购买 日本·东京，进入拍卖' },
    { type: 'auction', text: '乙 以 15000 获得 日本·东京（含房产，本圈第 1 座）' },
    { type: 'rent', text: '甲 向 乙 支付 中国·上海 租金 6000（持股抵扣 0）' },
    { type: 'chance', text: '甲 抽到机会卡「环球市长奖」+8000' },
    { type: 'jail', text: '乙 被关押在 11 号监狱（1 回合）' },
    { type: 'bankrupt', text: '乙 破产出局' },
    { type: 'bankrupt', text: '甲 认输，资产直接归银行' },
    { type: 'sale', text: '乙 以 10800 购买 澳大利亚·悉尼（卖家得 80%，本圈第 1 座）' },
    { type: 'sale', text: '甲 本圈已达 4 座房产上限，无法购买' },
    { type: 'buy', text: '甲 第一轮不能购买房产，澳大利亚·悉尼 保持无主' },
  ];
  const stats = computeStats(null, events);
  assert.strictEqual(stats.eventCount, 11);
  assert.strictEqual(stats.cityPurchases['上海'], 1);
  assert.strictEqual(stats.cityPurchases['东京'], 1);
  assert.strictEqual(stats.cityPurchases['悉尼'], 1); // 仅直接出售计入，「不能购买/可选择购买」不计
  assert.strictEqual(stats.cityRentPayments['上海'], 1);
  assert.strictEqual(stats.chanceDraws, 1);
  assert.strictEqual(stats.jailEntries, 1);
  assert.strictEqual(stats.bankruptcies, 1);
  assert.strictEqual(stats.surrenders, 1);
});

test('buildGameRecord：生成完整对局记录', () => {
  const state = createGameState('123456', ['甲', '乙']);
  resetDeck(state, createRng());
  state.players[0].cash = 120000;
  state.players[0].cities = ['上海'];
  state.cities['上海'].ownerId = 'p0';
  state.cities['上海'].houseLevel = 2;
  state.players[0].stocks = { 上海: 2 };
  state.stocks['上海'].holders['p0'] = 2;
  state.players[1].cash = 30000;
  state.rank = ['p1', 'p0'];
  state.winner = 'p1';
  const room = {
    code: '123456',
    state,
    events: [
      { type: 'buy', text: '甲 购买 中国·上海（20000）', id: 0, ts: 123 },
      { type: 'bankrupt', text: '乙 破产出局', id: 1, ts: 124 },
    ],
  };
  const rec = buildGameRecord(room, 'normal');
  assert.strictEqual(rec.schema, 'global-tycoon.game-record.v1');
  assert.strictEqual(rec.endReason, 'normal');
  assert.strictEqual(rec.winner, 'p1');
  assert.strictEqual(rec.players.length, 2);
  const a = rec.players.find((p) => p.id === 'p0');
  assert.strictEqual(a.cities[0].houseLevel, 2);
  assert.strictEqual(a.stocks['上海'], 2);
  assert.ok(a.totalAssets > 0);
  assert.strictEqual(rec.events.length, 2);
  assert.strictEqual(rec.stats.cityPurchases['上海'], 1);
  assert.strictEqual(rec.stats.bankruptcies, 1);
});

test('集成：中途解散房间时广播完整对局记录', async () => {
  const port = 4800 + Math.floor(Math.random() * 500);
  const child = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  spawnedChildren.push(child);
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('服务器启动超时')), 8000);
    child.stdout.on('data', (d) => {
      if (String(d).includes('运行于')) { clearTimeout(t); resolve(); }
    });
    child.on('exit', (code) => reject(new Error('服务器退出 code=' + code)));
  });
  const url = `http://localhost:${port}`;
  const a = Client(url);
  const b = Client(url);
  spawnedSockets.push(a, b);
  await Promise.all([once(a, 'connect'), once(b, 'connect')]);
  const code = await new Promise((resolve) => a.emit('createRoom', { name: '甲' }, (r) => resolve(r.roomCode)));
  assert.ok(code);
  const joined = await new Promise((resolve) => b.emit('joinRoom', { roomCode: code, name: '乙' }, resolve));
  assert.strictEqual(joined.ok, true);
  await new Promise((resolve) => a.emit('startGame', {}, resolve));
  const recP = once(a, 'gameRecord', 8000);
  await new Promise((resolve) => a.emit('action', { type: 'roll_dice' }, resolve));
  await new Promise((resolve) => a.emit('disbandRoom', {}, resolve));
  const rec = await recP;
  assert.ok(rec);
  assert.strictEqual(rec.schema, 'global-tycoon.game-record.v1');
  assert.strictEqual(rec.endReason, 'disband');
  assert.strictEqual(rec.players.length, 2);
  assert.ok(rec.events.length >= 1);
  assert.strictEqual(rec.stats.eventCount, rec.events.length);
}, { timeout: 25000 });

test.afterEach(() => {
  for (const sock of spawnedSockets) { try { sock.close(); } catch (e) {} }
  for (const child of spawnedChildren) { try { child.kill(); } catch (e) {} }
  spawnedSockets.length = 0;
  spawnedChildren.length = 0;
});
