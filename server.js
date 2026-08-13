'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { createGameState, snapshot, resetDeck } = require('./src/state');
const logic = require('./src/gameLogic');
const { createRng } = require('./src/random');

const PORT = process.env.PORT || 3000;
const MAIN_TIMEOUT = 90 * 1000;
const SUB_TIMEOUT = 60 * 1000;
const HOST_TRANSFER_MS = 10 * 60 * 1000;

const app = express();
app.get('/healthz', (req, res) => res.send('ok')); // Render 健康检查
app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app);
const io = new Server(server);

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
  };
  issueToken(hostSocket, room.players[0]);
  rooms.set(code, room);
  hostSocket.join(`room:${code}`);
  return room;
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

function findPlayer(room, socketId) {
  return room.players.find((p) => p.socketId === socketId);
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
  const res = logic.apply(room.state, action, rng);
  if (!res.rejected) {
    room.lastEvents = res.events || [];
    room.lastEventBase = room.eventSeq;
    room.eventSeq += (res.events || []).length;
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

io.on('connection', (socket) => {
  socket.on('createRoom', (data, cb) => {
    const name = String(data && data.name || '玩家').slice(0, 12);
    const room = makeRoom(socket, name);
    cb && cb({ ok: true, roomCode: room.code });
    emitRoom(room);
  });

  socket.on('joinRoom', (data, cb) => {
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
    socket.join(`room:${code}`);
    cb && cb({ ok: true, roomCode: code });
    emitRoom(room);
  });

  socket.on('reconnect', (data, cb) => {
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
  });

  socket.on('startGame', (data, cb) => {
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
  });

  socket.on('action', (action, cb) => {
    const room = [...rooms.values()].find((r) => r.players.some((p) => p.socketId === socket.id));
    if (!room) return cb && cb({ ok: false, error: '不在房间内' });
    runAction(room, socket, action);
    cb && cb({ ok: true });
  });

  socket.on('disconnect', () => {
    for (const room of rooms.values()) {
      const rp = room.players.find((p) => p.socketId === socket.id);
      if (!rp) continue;
      rp.connected = false;
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

  socket.on('disbandRoom', (data, cb) => {
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
      emitGame(room);
    }
    cb && cb({ ok: true });
  });
});

function totalAssets(state, player) {
  let cash = player.cash;
  for (const cityId of player.cities) cash += logic.cityTotalValue(state.cities[cityId]);
  for (const airportId of player.airports) cash += 15000;
  for (const cityId of Object.keys(state.stocks)) cash += (state.stocks[cityId].holders[player.id] || 0) * state.stocks[cityId].price;
  return cash;
}

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log('环球大亨运行于 http://localhost:' + PORT);
  });
}

module.exports = { app, server, io, rooms, totalAssets };
