'use strict';

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { createGameState, snapshot, resetDeck } = require('./src/state');
const logic = require('./src/gameLogic');
const { createRng } = require('./src/random');
const { buildGameRecord } = require('./src/record');

const PORT = process.env.PORT || 3000;
const MAIN_TIMEOUT = 90 * 1000;
const SUB_TIMEOUT = 60 * 1000;
const HOST_TRANSFER_MS = 10 * 60 * 1000;
const LOBBY_IDLE_MS = 10 * 60 * 1000; // 大厅（未开局）空房保留时限
const GAME_IDLE_MS = 30 * 60 * 1000; // 对局中/已结束房间无人保留时限
const SWEEP_INTERVAL_MS = 60 * 1000; // 房间清扫周期
const RECORDS_DIR = path.join(__dirname, 'records'); // 对局记录落盘目录

const app = express();
app.get('/healthz', (req, res) => res.send('ok')); // Render 健康检查
app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app);
const io = new Server(server);

// 异常兜底：记录日志后保持进程存活，避免单个错误拖垮所有房间
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));

const rooms = new Map(); // roomCode -> room

function genToken() {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}

function issueToken(socket, rp) {
  rp.token = genToken();
  socket.emit('reconnectToken', { token: rp.token });
}

function genRoomCode() {
  let code;
  do {
    code = String(Math.floor(100000 + Math.random() * 900000));
  } while (rooms.has(code));
  return code;
}

function makeRoom(hostSocket, name) {
  const code = genRoomCode();
  const room = {
    code,
    hostId: hostSocket.id,
    players: [{ socketId: hostSocket.id, id: 'p0', name, seat: 0, connected: true, token: null }],
    state: null,
    timers: new Map(),
    hostTimer: null,
    awaiting: null, // {playerId, phase}
    lastEvents: [], // 最近一次动作的事件日志（仅用于前端展示）
    eventSeq: 0, // 事件全局序号（用于前端去重与排序）
    lastEventBase: 0,
    events: [], // 完整对局事件流水（用于生成对局数据记录）
    gameRecord: null, // 已生成的对局记录（防重复）
    idleSince: null, // 最后一名在线玩家断开的时间；null 表示有人在线
  };
  issueToken(hostSocket, room.players[0]);
  rooms.set(code, room);
  hostSocket.join(`room:${code}`);
  return room;
}

function touchRoom(room) {
  room.idleSince = null; // 有玩家加入/重连时取消闲置计时
}

function shouldSweepRoom(room, now, cfg) {
  if (room.idleSince == null) return false; // 有人在线的房间永不清理
  const c = Object.assign({ lobbyIdleMs: LOBBY_IDLE_MS, gameIdleMs: GAME_IDLE_MS }, cfg);
  const idle = now - room.idleSince;
  return room.state ? idle >= c.gameIdleMs : idle >= c.lobbyIdleMs;
}

function persistRecord(record, dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, record.roomCode + '-' + record.startedAt + '.json'), JSON.stringify(record, null, 2));
  } catch (err) {
    console.error('[record] 落盘失败:', err);
  }
}

function sweepRooms(now = Date.now(), cfg) {
  const c = Object.assign({ lobbyIdleMs: LOBBY_IDLE_MS, gameIdleMs: GAME_IDLE_MS }, cfg);
  for (const [code, room] of rooms) {
    if (!shouldSweepRoom(room, now, c)) continue;
    if (room.state && !room.gameRecord) finalizeGame(room, 'idle_timeout');
    clearTimer(room, 'action');
    if (room.hostTimer) {
      clearTimeout(room.hostTimer);
      room.hostTimer = null;
    }
    rooms.delete(code);
  }
}

function roomStatePayload(room) {
  return {
    roomCode: room.code,
    hostId: room.hostId,
    players: room.players.map((p) => ({ id: p.id, name: p.name, seat: p.seat, connected: p.connected })),
    started: !!room.state,
  };
}

function emitRoom(room) {
  io.to(`room:${room.code}`).emit('roomState', roomStatePayload(room));
}

function emitGame(room) {
  if (!room.state) return;
  if (room.state.phase === 'game_over' && !room.gameRecord) finalizeGame(room, 'normal');
  const base = snapshot(room.state);
  const evs = (room.lastEvents || []).map((e, i) => Object.assign({}, e, { id: (room.lastEventBase || 0) + i }));
  // 事件全局可见：每个客户端收到完整事件记录
  for (const rp of room.players) {
    const sock = io.sockets.sockets.get(rp.socketId);
    if (!sock) continue;
    sock.emit('gameState', Object.assign({}, base, { events: evs }));
  }
  if (room.state.phase === 'game_over') emitRoom(room);
  startTimer(room);
}

function finalizeGame(room, endReason) {
  if (room.gameRecord) return room.gameRecord;
  room.gameRecord = buildGameRecord(room, endReason);
  for (const rp of room.players) {
    const sock = io.sockets.sockets.get(rp.socketId);
    if (sock) sock.emit('gameRecord', room.gameRecord);
  }
  persistRecord(room.gameRecord, RECORDS_DIR);
  return room.gameRecord;
}

function clearTimer(room, key) {
  const t = room.timers.get(key);
  if (t) clearTimeout(t);
  room.timers.delete(key);
}

function defaultAction(room, phase) {
  const cur = room.state ? room.state.players[room.state.turnIndex] : null;
  switch (phase) {
    case 'waiting_roll': return { type: 'roll_dice' };
    case 'frozen_turn': return { type: 'respond_frozen', decision: cur && cur.cash >= 5000 ? 'pay' : 'pass' };
    case 'jail_turn': return { type: 'respond_jail', decision: cur && cur.cash >= 15000 ? 'pay' : 'roll' };
    case 'buy': return { type: 'buy', decision: 'pass' };
    case 'buy_airport': return { type: 'buy_airport', decision: 'pass' };
    case 'build_decide': return { type: 'respond_build', decision: 'pass' };
    case 'buy_fundraise': return { type: 'buy_fundraise', decision: 'cancel' };
    case 'flight': return { type: 'flight', target: null };
    case 'stock': return { type: 'stock_done' };
    case 'auction_bid': return { type: 'auction_respond', decision: 'pass' };
    case 'direct_sale_ask': return { type: 'direct_sale_respond', decision: 'pass' };
    case 'self_rescue': return { type: 'rescue_done' };
    default: return null;
  }
}

function phaseDuration(phase) {
  const main = ['waiting_roll', 'frozen_turn', 'jail_turn'];
  return main.includes(phase) ? MAIN_TIMEOUT : SUB_TIMEOUT;
}

function startTimer(room) {
  if (!room.state || room.state.phase === 'game_over') return;
  clearTimer(room, 'action');
  const phase = room.state.phase;
  const dur = phaseDuration(phase);
  io.to(`room:${room.code}`).emit('timerStarted', { phase, seconds: dur / 1000 });
  const t = setTimeout(() => {
    const act = defaultAction(room, phase);
    if (!act) return;
    runAction(room, null, act);
  }, dur);
  room.timers.set('action', t);
}

function runAction(room, socket, action) {
  if (!room.state || room.state.phase === 'game_over') return;
  // 掉线暂停：有玩家离线时仅允许认输，其余行动拒绝
  if (room.players.some((p) => !p.connected)) {
    if (action && action.type !== 'surrender') {
      if (socket) socket.emit('error', { message: '有玩家掉线，对局暂停，等待重连' });
      return;
    }
  }
  // 校验当前行动玩家；拍卖/直接出售/交易确认等子流程按 pending.awaiting/targetId 放行
  const cur = room.state.players[room.state.turnIndex];
  let allowedId = cur.id;
  const pend = room.state.pending;
  if (pend && ['auction_bid', 'direct_sale_ask', 'trade_confirm'].includes(room.state.phase)) {
    allowedId = pend.awaiting || pend.targetId || cur.id;
  }
  const allowedRp = playerByGameId(room, allowedId);
  const allowedSocketId = allowedRp ? allowedRp.socketId : cur.socketId;
  if (socket && socket.id !== allowedSocketId) {
    socket.emit('error', { message: '还没轮到你行动' });
    return;
  }
  const rng = createRng();
  let res;
  try {
    res = logic.apply(room.state, action, rng);
  } catch (err) {
    console.error('[action] 规则引擎异常:', err);
    if (socket) socket.emit('error', { message: '操作异常，请重试' });
    return;
  }
  if (!res.rejected) {
    room.lastEvents = res.events || [];
    room.lastEventBase = room.eventSeq;
    for (const e of res.events || []) {
      room.events.push(Object.assign({}, e, { id: room.eventSeq, ts: Date.now() }));
      room.eventSeq++;
    }
  }
  if (res.rejected) {
    if (socket) socket.emit('error', { message: '当前状态下无法执行该操作' });
    return;
  }
  emitGame(room);
}

function playerByGameId(room, pid) {
  return room.players.find((p) => p.id === pid);
}

function syncSocketIds(room) {
  // 将对局玩家与房间成员按 id 对应，更新 socketId
  if (!room.state) return;
  for (const gp of room.state.players) {
    const rp = playerByGameId(room, gp.id);
    if (rp) gp.socketId = rp.socketId;
  }
}

function safeHandler(fn) {
  return (...args) => {
    try { fn(...args); } catch (err) { console.error('[socket] 回调异常:', err); }
  };
}

io.on('connection', (socket) => {
  socket.on('createRoom', safeHandler((data, cb) => {
    const name = String(data && data.name || '玩家').slice(0, 12);
    const room = makeRoom(socket, name);
    cb && cb({ ok: true, roomCode: room.code });
    emitRoom(room);
  }));

  socket.on('joinRoom', safeHandler((data, cb) => {
    const code = String(data && data.roomCode || '').trim();
    const room = rooms.get(code);
    if (!room) return cb && cb({ ok: false, error: '房间不存在' });
    if (room.state) return cb && cb({ ok: false, error: '对局已开始' });
    if (room.players.length >= 4) return cb && cb({ ok: false, error: '房间已满' });
    const name = String(data.name || '玩家').slice(0, 12);
    if (room.players.some((x) => x.name === name)) return cb && cb({ ok: false, error: '该昵称已被使用，请换一个昵称' });
    const p = { socketId: socket.id, id: `p${room.players.length}`, name, seat: room.players.length, connected: true, token: null };
    issueToken(socket, p);
    room.players.push(p);
    touchRoom(room);
    socket.join(`room:${code}`);
    cb && cb({ ok: true, roomCode: code });
    emitRoom(room);
  }));

  socket.on('reconnect', safeHandler((data, cb) => {
    const code = String(data && data.roomCode || '').trim();
    const room = rooms.get(code);
    if (!room) return cb && cb({ ok: false, error: '房间不存在' });
    const rp = room.players.find((p) => p.name === data.name && p.token === data.token);
    if (!rp) return cb && cb({ ok: false, error: '重连校验失败' });
    const oldSocketId = rp.socketId;
    // 令牌有效但旧连接仍标记在线（网络抖动自动重连、快速刷新竞态等）：
    // 先接管身份，再强制断开旧连接（顺序不可颠倒，否则旧连接的 disconnect 会误处理本玩家）
    const oldSock = rp.connected && oldSocketId !== socket.id ? io.sockets.sockets.get(oldSocketId) : null;
    rp.socketId = socket.id;
    rp.connected = true;
    rp.token = null;
    touchRoom(room);
    socket.join(`room:${code}`);
    if (oldSock) oldSock.disconnect(true);
    issueToken(socket, rp);
    if (room.hostId === oldSocketId) {
      room.hostId = socket.id;
      clearTimeout(room.hostTimer);
      room.hostTimer = null;
    }
    syncSocketIds(room);
    cb && cb({ ok: true, roomCode: code });
    emitRoom(room);
    emitGame(room);
  }));

  socket.on('startGame', safeHandler((data, cb) => {
    const room = [...rooms.values()].find((r) => r.players.some((p) => p.socketId === socket.id));
    if (!room) return cb && cb({ ok: false, error: '不在房间内' });
    if (room.hostId !== socket.id) return cb && cb({ ok: false, error: '只有房主能开始' });
    if (room.players.length < 2) return cb && cb({ ok: false, error: '至少需要 2 名玩家' });
    if (room.state && room.state.phase !== 'game_over') return cb && cb({ ok: false, error: '对局已开始' });
    clearTimer(room, 'action');
    room.state = createGameState(room.code, room.players.map((p) => p.name));
    room.players.forEach((p, i) => {
      room.state.players[i].socketId = p.socketId;
    });
    resetDeck(room.state, createRng());
    cb && cb({ ok: true });
    emitRoom(room);
    emitGame(room);
  }));

  socket.on('action', safeHandler((action, cb) => {
    const room = [...rooms.values()].find((r) => r.players.some((p) => p.socketId === socket.id));
    if (!room) return cb && cb({ ok: false, error: '不在房间内' });
    runAction(room, socket, action);
    cb && cb({ ok: true });
  }));

  socket.on('disconnect', () => {
    for (const room of rooms.values()) {
      const rp = room.players.find((p) => p.socketId === socket.id);
      if (!rp) continue;
      rp.connected = false;
      // 全部玩家离线时开始记录闲置时间，供房间清扫器清理
      if (room.players.every((p) => !p.connected)) room.idleSince = room.idleSince || Date.now();
      // 房主掉线：大厅或对局已结束时立即转移；对局进行中按 spec 等 10 分钟
      if (room.hostId === socket.id && room.players.filter((p) => p.connected).length > 0) {
        clearTimeout(room.hostTimer);
        room.hostTimer = null;
        const immediate = !room.state || room.state.phase === 'game_over';
        if (immediate) {
          const next = room.players.find((p) => p.connected);
          if (next) room.hostId = next.socketId;
        } else {
          room.hostTimer = setTimeout(() => {
            const next = room.players.find((p) => p.connected);
            if (next) {
              room.hostId = next.socketId;
              emitRoom(room);
            }
          }, HOST_TRANSFER_MS);
        }
      }
      emitRoom(room);
      if (room.state) {
        // 对局暂停：广播等待提示（前端据 connected 显示）
        io.to(`room:${room.code}`).emit('gameState', Object.assign({}, snapshot(room.state), { events: [] }));
      }
      return;
    }
  });

  socket.on('disbandRoom', safeHandler((data, cb) => {
    const room = [...rooms.values()].find((r) => r.players.some((p) => p.socketId === socket.id));
    if (!room) return cb && cb({ ok: false });
    if (room.hostId !== socket.id && room.state) return cb && cb({ ok: false, error: '仅房主可解散' });
    if (room.state && room.state.phase !== 'game_over') {
      // 按总资产排名结算
      const rank = room.state.players.slice().sort((a, b) => totalAssets(room.state, b) - totalAssets(room.state, a));
      room.state.rank = rank.map((p) => p.id);
      room.state.winner = room.state.rank[0] || null;
      room.state.status = 'over';
      room.state.phase = 'game_over';
      finalizeGame(room, 'disband');
      emitGame(room);
    }
    cb && cb({ ok: true });
  }));
});

function totalAssets(state, player) {
  let cash = player.cash;
  for (const cityId of player.cities) cash += logic.cityTotalValue(state.cities[cityId]);
  cash += (player.airports || []).length * 15000;
  for (const cityId of Object.keys(state.stocks)) cash += (state.stocks[cityId].holders[player.id] || 0) * state.stocks[cityId].price;
  return cash;
}

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log('环球大亨运行于 http://localhost:' + PORT);
  });
  setInterval(() => sweepRooms(), SWEEP_INTERVAL_MS);
}

module.exports = { app, server, io, rooms, totalAssets, shouldSweepRoom, sweepRooms };
