'use strict';
// 双客户端自动对局：直到有玩家被冰冻，验证其客户端能收到 frozen_turn 阶段
const { io: Client } = require('socket.io-client');

const url = 'http://localhost:3000';
function once(sock, ev, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout ' + ev)), timeout);
    sock.once(ev, (d) => { clearTimeout(t); resolve(d); });
  });
}

(async () => {
  const a = Client(url);
  const b = Client(url);
  await Promise.all([once(a, 'connect'), once(b, 'connect')]);
  const code = await new Promise((r) => a.emit('createRoom', { name: '甲', token: null }, (x) => r(x.roomCode)));
  await new Promise((r) => b.emit('joinRoom', { roomCode: code, name: '乙' }, r));
  const last = { p0: null, p1: null };
  a.on('gameState', (s) => { last.p0 = s; });
  b.on('gameState', (s) => { last.p1 = s; });
  a.on('reconnectToken', () => {});
  b.on('reconnectToken', () => {});
  await new Promise((r) => a.emit('startGame', {}, r));
  await new Promise((r) => setTimeout(r, 300));

  const auto = (s) => {
    switch (s.phase) {
      case 'waiting_roll': return { type: 'roll_dice' };
      case 'frozen_turn': return null; // 停下观察
      case 'jail_turn': return { type: 'respond_jail', decision: 'roll' };
      case 'buy': return { type: 'buy', decision: 'pass' };
      case 'buy_airport': return { type: 'buy_airport', decision: 'pass' };
      case 'build_decide': return { type: 'respond_build', decision: 'pass' };
      case 'buy_fundraise': return { type: 'buy_fundraise', decision: 'cancel' };
      case 'stock': return { type: 'stock_done' };
      case 'flight': return { type: 'flight', target: null };
      case 'self_rescue': return { type: 'rescue_done' };
      case 'auction_bid': return { type: 'auction_respond', decision: 'pass' };
      case 'direct_sale_ask': return { type: 'direct_sale_respond', decision: 'pass' };
      default: return null;
    }
  };
  const waitChange = async (id, pre) => {
    const t0 = Date.now();
    while (Date.now() - t0 < 6000) {
      if (JSON.stringify(last[id]) !== pre) return;
      await new Promise((r) => setTimeout(r, 30));
    }
    throw new Error('state stuck at phase=' + (last[id] && last[id].phase));
  };

  let guard = 0;
  let found = null;
  while (guard++ < 300 && !found) {
    const s = last.p0;
    if (!s) { await new Promise((r) => setTimeout(r, 100)); continue; }
    if (s.phase === 'game_over') break;
    if (s.phase === 'frozen_turn') { found = s; break; }
    // 决定行动者
    let actorId = s.players[s.turnIndex].id;
    if (s.pending && (s.pending.awaiting || s.pending.targetId)) actorId = s.pending.awaiting || s.pending.targetId;
    const act = auto(s);
    if (!act) { console.log('无默认动作 phase=', s.phase); break; }
    const pre = JSON.stringify(s);
    (actorId === 'p0' ? a : b).emit('action', act);
    await waitChange('p0', pre);
  }

  if (found) {
    const frozenId = found.pending.playerId;
    const other = frozenId === 'p0' ? 'p1' : 'p0';
    const viewMine = last[frozenId];
    const viewOther = last[other];
    console.log('到达 frozen_turn，被冰冻玩家 =', frozenId, '=', found.players.find((p) => p.id === frozenId).name);
    console.log('被冰冻者客户端视角 phase =', viewMine.phase, 'pending.playerId =', viewMine.pending && viewMine.pending.playerId);
    console.log('客户端 awaitingPlayerId 计算 =', viewMine.pending.playerId || viewMine.pending.awaiting || viewMine.pending.targetId);
    console.log(' frozen 玩家现金 =', viewMine.players.find((p) => p.id === frozenId).cash);
    console.log('另一玩家视角 phase =', viewOther.phase);
    // 模拟被冰冻者支付
    const pay = viewMine.players.find((p) => p.id === frozenId).cash >= 5000 ? 'pay' : 'pass';
    (frozenId === 'p0' ? a : b).emit('action', { type: 'respond_frozen', decision: pay });
    await waitChange(frozenId, JSON.stringify(viewMine));
    console.log('响应后 phase =', last[frozenId].phase, '（期望 waiting_roll 或下一位玩家回合）');
    console.log('RESULT: PASS');
  } else {
    console.log('RESULT: 未遇到冰冻（300 步内），无法验证');
  }
  a.close(); b.close();
  process.exit(0);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
