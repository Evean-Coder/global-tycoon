'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const { io: Client } = require('socket.io-client');

const spawnedChildren = [];
const spawnedSockets = [];

function once(sock, ev, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting ${ev}`)), timeout);
    sock.once(ev, (data) => { clearTimeout(t); resolve(data); });
  });
}

test('端到端：创建/加入/开始/首个操作回合可运行', async () => {
  const port = 4200 + Math.floor(Math.random() * 500);
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

  const gsP = once(a, 'gameState');
  await new Promise((resolve) => a.emit('startGame', {}, resolve));
  const gs = await gsP;
  assert.strictEqual(gs.status, 'playing');
  assert.strictEqual(gs.players.length, 2);
  assert.strictEqual(gs.board.length, 42);
  assert.strictEqual(gs.phase, 'waiting_roll');

  const gs2P = once(a, 'gameState');
  a.emit('action', { type: 'roll_dice' });
  const s2 = await gs2P;
  assert.ok(s2.dice && s2.dice.length === 2);

  a.close();
  b.close();
  child.kill();
}, { timeout: 20000 });

test('子流程顺序：拍卖轮到非当前回合玩家时可正常出价', async () => {
  const port = 4700 + Math.floor(Math.random() * 500);
  const child = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  spawnedChildren.push(child);
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('服务器启动超时')), 8000);
    child.stdout.on('data', (d) => { if (String(d).includes('运行于')) { clearTimeout(t); resolve(); } });
    child.on('exit', (code) => reject(new Error('服务器退出 code=' + code)));
  });
  const url = `http://localhost:${port}`;
  const a = Client(url);
  const b = Client(url);
  spawnedSockets.push(a, b);
  await Promise.all([once(a, 'connect'), once(b, 'connect')]);
  const code = await new Promise((resolve) => a.emit('createRoom', { name: '甲' }, (r) => resolve(r.roomCode)));
  const joinRsP = once(b, 'roomState');
  await new Promise((resolve) => b.emit('joinRoom', { roomCode: code, name: '乙' }, resolve));
  await joinRsP; // 消费加入时的 roomState，避免与断线广播竞争
  let lastA = null;
  let lastB = null;
  a.on('gameState', (s) => { lastA = s; });
  b.on('gameState', (s) => { lastB = s; });
  const waitFor = async (fn, timeout = 6000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (fn()) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('等待状态超时');
  };
  const gsP = once(a, 'gameState');
  await new Promise((resolve) => a.emit('startGame', {}, resolve));
  await gsP;
  await waitFor(() => lastA && lastA.phase === 'waiting_roll');

  const auto = (state) => {
    if (state.phase === 'waiting_roll') return { type: 'roll_dice' };
    if (state.phase === 'frozen_turn') return { type: 'respond_frozen', decision: 'pass' };
    if (state.phase === 'jail_turn') return { type: 'respond_jail', decision: 'roll' };
    if (state.phase === 'buy_airport') return { type: 'buy_airport', decision: 'pass' };
    if (state.phase === 'stock') return { type: 'stock_done' };
    if (state.phase === 'flight') return { type: 'flight', target: null };
    if (state.phase === 'self_rescue') return { type: 'rescue_done' };
    return null;
  };
  let guard = 0;
  while (!(lastA && lastA.phase === 'buy') && guard++ < 120) {
    const state = lastA;
    const cur = state.players[state.turnIndex];
    const sock = cur.name === '甲' ? a : b;
    const act = auto(state);
    if (!act) break;
    const preJson = JSON.stringify(state);
    sock.emit('action', act);
    await waitFor(() => JSON.stringify(lastA) !== preJson);
  }
  assert.strictEqual(lastA.phase, 'buy', '应到达购买阶段');
  const buyerId = lastA.pending.playerId; // p0 或 p1
  const buyerSock = buyerId === 'p0' ? a : b;
  const otherSock = buyerId === 'p0' ? b : a;
  const otherId = buyerId === 'p0' ? 'p1' : 'p0';
  const cityId = lastA.pending.cityId;

  // 当前回合玩家放弃购买 → 进入拍卖，等待对方出价
  buyerSock.emit('action', { type: 'buy', decision: 'pass' });
  await waitFor(() => lastA && lastA.phase === 'auction_bid');
  assert.strictEqual(lastA.pending.awaiting, otherId);

  // 当前回合玩家（买家）越权出价：应被拒绝
  const errP = once(buyerSock, 'error');
  buyerSock.emit('action', { type: 'auction_respond', decision: 'pass' });
  const err = await errP;
  assert.ok(String(err.message || '').includes('还没轮到你行动'));

  // 对方出价：唯一参与者出价后立即成交
  const otherIdx = otherId === 'p1' ? 1 : 0;
  const cashBeforeBid = lastA.players[otherIdx].cash;
  otherSock.emit('action', { type: 'auction_respond', decision: 'bid', amount: 90000 });
  await waitFor(() => lastA && lastA.cities[cityId].ownerId === otherId && ['waiting_roll', 'frozen_turn', 'jail_turn'].includes(lastA.phase));
  assert.strictEqual(lastA.players[otherIdx].cash, cashBeforeBid - 90000);

  a.close();
  b.close();
  child.kill();
}, { timeout: 30000 });

test('对局结束后房主可重新开始新对局', async () => {
  const port = 5200 + Math.floor(Math.random() * 500);
  const child = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  spawnedChildren.push(child);
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('服务器启动超时')), 8000);
    child.stdout.on('data', (d) => { if (String(d).includes('运行于')) { clearTimeout(t); resolve(); } });
    child.on('exit', (code) => reject(new Error('服务器退出 code=' + code)));
  });
  const url = `http://localhost:${port}`;
  const a = Client(url);
  const b = Client(url);
  spawnedSockets.push(a, b);
  await Promise.all([once(a, 'connect'), once(b, 'connect')]);
  const code = await new Promise((resolve) => a.emit('createRoom', { name: '甲' }, (r) => resolve(r.roomCode)));
  const joinRsP = once(b, 'roomState');
  await new Promise((resolve) => b.emit('joinRoom', { roomCode: code, name: '乙' }, resolve));
  await joinRsP; // 消费加入时的 roomState，避免与断线广播竞争
  const gsP = once(a, 'gameState');
  await new Promise((resolve) => a.emit('startGame', {}, resolve));
  let gs = await gsP;
  assert.strictEqual(gs.phase, 'waiting_roll');
  // 甲（当前回合玩家）认输结束对局
  const gsEnd = once(a, 'gameState');
  a.emit('action', { type: 'surrender' });
  gs = await gsEnd;
  assert.strictEqual(gs.phase, 'game_over');
  // 房主重新开始
  const gsR = once(a, 'gameState');
  const ack = await new Promise((resolve) => a.emit('startGame', {}, resolve));
  assert.strictEqual(ack.ok, true);
  gs = await gsR;
  assert.strictEqual(gs.phase, 'waiting_roll');
  assert.strictEqual(gs.rounds, 0);
  assert.strictEqual(gs.players[0].cash, 150000);
  assert.strictEqual(gs.status, 'playing');

  a.close();
  b.close();
  child.kill();
}, { timeout: 30000 });

test('房主在大厅掉线后，房主转移给在线玩家并可开始游戏', async () => {
  const port = 5700 + Math.floor(Math.random() * 500);
  const child = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  spawnedChildren.push(child);
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('服务器启动超时')), 8000);
    child.stdout.on('data', (d) => { if (String(d).includes('运行于')) { clearTimeout(t); resolve(); } });
    child.on('exit', (code) => reject(new Error('服务器退出 code=' + code)));
  });
  const url = `http://localhost:${port}`;
  const a = Client(url);
  const b = Client(url);
  spawnedSockets.push(a, b);
  await Promise.all([once(a, 'connect'), once(b, 'connect')]);
  const code = await new Promise((resolve) => a.emit('createRoom', { name: '甲' }, (r) => resolve(r.roomCode)));
  const joinRsP = once(b, 'roomState');
  await new Promise((resolve) => b.emit('joinRoom', { roomCode: code, name: '乙' }, resolve));
  await joinRsP; // 消费加入时的 roomState，避免与断线广播竞争
  const rsP = once(b, 'roomState');
  a.close(); // 房主在大厅掉线
  const rs = await rsP;
  assert.strictEqual(rs.hostId, b.id);
  const gsP = once(b, 'gameState');
  const ack = await new Promise((resolve) => b.emit('startGame', {}, resolve));
  assert.strictEqual(ack.ok, true);
  const gs = await gsP;
  assert.strictEqual(gs.status, 'playing');

  b.close();
  child.kill();
}, { timeout: 30000 });

test('房主对局中掉线后凭令牌重连，恢复房主身份', async () => {
  const port = 6200 + Math.floor(Math.random() * 500);
  const child = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  spawnedChildren.push(child);
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('服务器启动超时')), 8000);
    child.stdout.on('data', (d) => { if (String(d).includes('运行于')) { clearTimeout(t); resolve(); } });
    child.on('exit', (code) => reject(new Error('服务器退出 code=' + code)));
  });
  const url = `http://localhost:${port}`;
  const a = Client(url);
  const b = Client(url);
  spawnedSockets.push(a, b);
  await Promise.all([once(a, 'connect'), once(b, 'connect')]);
  let token = null;
  a.on('reconnectToken', (d) => { token = d.token; });
  const code = await new Promise((resolve) => a.emit('createRoom', { name: '甲' }, (r) => resolve(r.roomCode)));
  const joinRsP = once(b, 'roomState');
  await new Promise((resolve) => b.emit('joinRoom', { roomCode: code, name: '乙' }, resolve));
  await joinRsP; // 消费加入时的 roomState，避免与断线广播竞争
  const gsP = once(a, 'gameState');
  await new Promise((resolve) => a.emit('startGame', {}, resolve));
  await gsP;
  const rsP = once(b, 'roomState');
  a.close(); // 房主对局中掉线（不转移，等待重连）
  await rsP;
  assert.ok(token, '应收到重连令牌');
  const a2 = Client(url);
  await once(a2, 'connect');
  const rsP2 = once(b, 'roomState');
  const okRe = await new Promise((resolve) => a2.emit('reconnect', { roomCode: code, name: '甲', token }, resolve));
  assert.strictEqual(okRe.ok, true);
  const rs2 = await rsP2;
  assert.strictEqual(rs2.hostId, a2.id);

  a2.close();
  b.close();
  child.kill();
}, { timeout: 30000 });


test('房间内昵称重复加入被拒', async () => {
  const port = 7100 + Math.floor(Math.random() * 300);
  const child = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('服务器启动超时')), 8000);
    child.stdout.on('data', (d) => { if (String(d).includes('运行于')) { clearTimeout(t); resolve(); } });
    child.on('exit', (code) => reject(new Error('服务器退出 code=' + code)));
  });
  const url = `http://localhost:${port}`;
  const a = Client(url);
  const b = Client(url);
  const c = Client(url);
  await Promise.all([once(a, 'connect'), once(b, 'connect'), once(c, 'connect')]);
  const code = await new Promise((resolve) => a.emit('createRoom', { name: '甲' }, (r) => resolve(r.roomCode)));
  await new Promise((resolve) => b.emit('joinRoom', { roomCode: code, name: '乙' }, resolve));
  const dup = await new Promise((resolve) => c.emit('joinRoom', { roomCode: code, name: '甲' }, resolve));
  assert.strictEqual(dup.ok, false);
  assert.ok(String(dup.error || '').includes('昵称'));
  const ok = await new Promise((resolve) => c.emit('joinRoom', { roomCode: code, name: '丙' }, resolve));
  assert.strictEqual(ok.ok, true);
  a.close(); b.close(); c.close(); child.kill();
}, { timeout: 30000 });

test('在线玩家重复重连被拒', async () => {
  const port = 7400 + Math.floor(Math.random() * 300);
  const child = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('服务器启动超时')), 8000);
    child.stdout.on('data', (d) => { if (String(d).includes('运行于')) { clearTimeout(t); resolve(); } });
    child.on('exit', (code) => reject(new Error('服务器退出 code=' + code)));
  });
  const url = `http://localhost:${port}`;
  const a = Client(url);
  const b = Client(url);
  await Promise.all([once(a, 'connect'), once(b, 'connect')]);
  let token = null;
  a.on('reconnectToken', (d) => { token = d.token; });
  const code = await new Promise((resolve) => a.emit('createRoom', { name: '甲' }, (r) => resolve(r.roomCode)));
  await new Promise((resolve) => b.emit('joinRoom', { roomCode: code, name: '乙' }, resolve));
  assert.ok(token);
  const a2 = Client(url);
  await once(a2, 'connect');
  // 甲仍在线，用其令牌重连应被拒（防顶替）
  const res = await new Promise((resolve) => a2.emit('reconnect', { roomCode: code, name: '甲', token }, resolve));
  assert.strictEqual(res.ok, false);
  assert.ok(String(res.error || '').includes('在线'));
  a2.close(); a.close(); b.close(); child.kill();
}, { timeout: 30000 });

test.afterEach(() => {
  for (const sock of spawnedSockets) { try { sock.close(); } catch (e) {} }
  for (const child of spawnedChildren) { try { child.kill(); } catch (e) {} }
  spawnedSockets.length = 0;
  spawnedChildren.length = 0;
});
