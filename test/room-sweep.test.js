'use strict';

const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { io: Client } = require('socket.io-client');
const { server, rooms, shouldSweepRoom, sweepRooms } = require('../server');

const sockets = [];
const tmpDirs = [];

function once(sock, ev, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting ${ev}`)), timeout);
    sock.once(ev, (data) => { clearTimeout(t); resolve(data); });
  });
}

function listen() {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve('http://127.0.0.1:' + server.address().port)));
}

function closeServer() {
  return new Promise((resolve) => {
    try {
      if (server.listening) {
        server.close(() => resolve());
        if (server.closeAllConnections) server.closeAllConnections();
      } else {
        resolve();
      }
    } catch { resolve(); }
  });
}

async function waitFor(fn, timeout = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('waitFor timeout');
}

test.afterEach(async () => {
  for (const s of sockets) { try { s.close(); } catch {} }
  sockets.length = 0;
  for (const code of [...rooms.keys()]) rooms.delete(code);
  for (const d of tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
  tmpDirs.length = 0;
  await closeServer();
});

test('shouldSweepRoom：到期清理、有人在线与未到期不清理', () => {
  const now = 1000000;
  const cfg = { lobbyIdleMs: 600000, gameIdleMs: 1800000 };
  assert.strictEqual(shouldSweepRoom({ state: null, idleSince: now - 600001 }, now, cfg), true);
  assert.strictEqual(shouldSweepRoom({ state: null, idleSince: now - 599999 }, now, cfg), false);
  assert.strictEqual(shouldSweepRoom({ state: { phase: 'waiting_roll' }, idleSince: now - 1800001 }, now, cfg), true);
  assert.strictEqual(shouldSweepRoom({ state: { phase: 'waiting_roll' }, idleSince: now - 1799999 }, now, cfg), false);
  assert.strictEqual(shouldSweepRoom({ state: null, idleSince: null }, now, cfg), false);
  assert.strictEqual(shouldSweepRoom({ state: { phase: 'waiting_roll' }, idleSince: null }, now, cfg), false);
});

test('集成：全员离线清扫删除房间并落盘 idle_timeout 记录', async () => {
  const url = await listen();
  const a = Client(url);
  const b = Client(url);
  sockets.push(a, b);
  await Promise.all([once(a, 'connect'), once(b, 'connect')]);
  const code = await new Promise((r) => a.emit('createRoom', { name: '甲' }, (x) => r(x.roomCode)));
  const joined = await new Promise((r) => b.emit('joinRoom', { roomCode: code, name: '乙' }, r));
  assert.strictEqual(joined.ok, true);
  await new Promise((r) => a.emit('startGame', {}, r));
  const startedAt = rooms.get(code).state.startedAt;
  a.close();
  b.close();
  await waitFor(() => rooms.has(code) && rooms.get(code).idleSince != null);
  sweepRooms(Date.now(), { lobbyIdleMs: 0, gameIdleMs: 0 });
  assert.strictEqual(rooms.has(code), false);
  const recDir = path.join(__dirname, '..', 'records');
  const recFile = path.join(recDir, code + '-' + startedAt + '.json');
  assert.strictEqual(fs.existsSync(recFile), true);
  const rec = JSON.parse(fs.readFileSync(recFile, 'utf8'));
  assert.strictEqual(rec.endReason, 'idle_timeout');
  assert.strictEqual(rec.roomCode, code);
  assert.strictEqual(rec.players.length, 2);
  try { fs.unlinkSync(recFile); } catch {}
});

test('集成：对局中有人在线时清扫不删除房间', async () => {
  const url = await listen();
  const a = Client(url);
  const b = Client(url);
  sockets.push(a, b);
  await Promise.all([once(a, 'connect'), once(b, 'connect')]);
  const code = await new Promise((r) => a.emit('createRoom', { name: '甲' }, (x) => r(x.roomCode)));
  await new Promise((r) => b.emit('joinRoom', { roomCode: code, name: '乙' }, r));
  await new Promise((r) => a.emit('startGame', {}, r));
  b.close();
  await new Promise((r) => setTimeout(r, 200)); // 等服务端处理断开
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tycoon-sweep-'));
  tmpDirs.push(tmpDir);
  sweepRooms(Date.now(), { lobbyIdleMs: 0, gameIdleMs: 0, recordsDir: tmpDir });
  assert.strictEqual(rooms.has(code), true);
  assert.strictEqual(fs.readdirSync(tmpDir).filter((f) => f.endsWith('.json')).length, 0);
});
test('集成：规则引擎异常时服务器不退出、房间保留、操作者收到提示', async () => {
  const logic = require('../src/gameLogic');
  const originalApply = logic.apply;
  const url = await listen();
  const a = Client(url);
  const b = Client(url);
  sockets.push(a, b);
  await Promise.all([once(a, 'connect'), once(b, 'connect')]);
  const code = await new Promise((r) => a.emit('createRoom', { name: '甲' }, (x) => r(x.roomCode)));
  await new Promise((r) => b.emit('joinRoom', { roomCode: code, name: '乙' }, r));
  await new Promise((r) => a.emit('startGame', {}, r));
  logic.apply = () => { throw new Error('injected boom'); };
  try {
    const errP = once(a, 'error', 4000);
    await new Promise((r) => a.emit('action', { type: 'roll_dice' }, r));
    const err = await errP;
    assert.ok(err.message.indexOf('操作异常') !== -1);
  } finally {
    logic.apply = originalApply;
  }
  assert.strictEqual(rooms.has(code), true);
});