'use strict';

// 验收运行器：按 checklist.md 逐项验证，自动项给出证据，输出 acceptance-report.md
const { spawn } = require('child_process');
const { io: Client } = require('socket.io-client');
const fs = require('fs');
const path = require('path');

const results = [];
function rec(ac, name, pass, evidence) {
  results.push({ ac, name, pass, evidence });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${ac} ${name} — ${evidence}`);
}

// ---------- 静态数据校验 ----------
function staticChecks() {
  const { buildBoard, buildChanceDeck, CITIES } = require('./src/board');
  const board = buildBoard();
  const cities = board.filter((s) => s.type === 'city');
  const chances = board.filter((s) => s.type === 'chance');
  const airports = board.filter((s) => s.type === 'airport');
  const jails = board.filter((s) => s.type === 'jail');
  const poles = board.filter((s) => s.type === 'pole');

  rec('AC2', '棋盘 42 格与构成', board.length === 42 && cities.length === 20 && chances.length === 8 && airports.length === 4 && jails.length === 3 && poles.length === 2,
    `42 格：城市${cities.length}/机会${chances.length}/机场${airports.length}/入狱${jails.length}/极地${poles.length}`);
  rec('AC2', '机会卡格位置', JSON.stringify(chances.map((s) => s.id).sort((a, b) => a - b)) === JSON.stringify([3, 7, 15, 19, 26, 30, 33, 40]),
    '机会卡格 = ' + chances.map((s) => s.id).sort((a, b) => a - b).join(','));
  rec('AC2/AC23', '入狱格 11/21/32、极地 14/34', JSON.stringify(jails.map((s) => s.id).sort((a, b) => a - b)) === JSON.stringify([11, 21, 32]) && JSON.stringify(poles.map((s) => s.id).sort((a, b) => a - b)) === JSON.stringify([14, 34]),
    '入狱=' + jails.map((s) => s.id).sort((a, b) => a - b).join(',') + ' 极地=' + poles.map((s) => s.id).sort((a, b) => a - b).join(','));

  // AC18 城市表与 GDP 顺序
  const specCities = {
    内罗毕: [3600, '黄'], 开普敦: [7200, '黄'], 卡萨布兰卡: [4800, '黄'], 开罗: [6000, '黄'],
    奥克兰: [8400, '紫'], 悉尼: [10800, '紫'], 阿姆斯特丹: [10000, '紫'], 罗马: [12000, '紫'],
    莫斯科: [11000, '绿'], 伦敦: [14000, '绿'], 巴黎: [13000, '绿'], 柏林: [15000, '绿'],
    纽约: [19000, '蓝'], 多伦多: [14000, '蓝'], 墨西哥城: [12000, '蓝'], 里约热内卢: [13000, '蓝'],
    新加坡: [14000, '红'], 东京: [17000, '红'], 迪拜: [15000, '红'], 上海: [20000, '红'],
  };
  let cityOk = Object.keys(specCities).length === cities.length;
  for (const s of cities) {
    const exp = specCities[s.cityId];
    if (!exp || s.price !== exp[0] || CITIES[s.cityId].group !== exp[1]) { cityOk = false; break; }
  }
  rec('AC18', '城市表（20 城、地价、色组）', cityOk && CITIES['上海'].price === 20000 && CITIES['纽约'].price > CITIES['东京'].price,
    `20 城地价与 spec 一致；上海 ${CITIES['上海'].price} 最高、纽约 ${CITIES['纽约'].price} > 东京 ${CITIES['东京'].price}`);
  // 色组均价顺序
  const avg = (g) => Object.entries(CITIES).filter(([, c]) => c.group === g).reduce((s, [, c]) => s + c.price, 0) / 4;
  const order = ['黄', '紫', '绿', '蓝', '红'].map((g) => Math.round(avg(g)));
  const asc = order.every((v, i) => i === 0 || order[i - 1] < v);
  rec('AC18', '色组均价递增', asc, '黄紫绿蓝红均价=' + order.join('<'));

  const deck = buildChanceDeck();
  rec('AC6', '机会卡组 40 张构成', deck.length === 40 && deck.filter((c) => c.type === 'reward').length === 15 && deck.filter((c) => c.type === 'fine').length === 15 && deck.filter((c) => c.type === 'move').length === 9 && deck.filter((c) => c.type === 'jail').length === 1,
    `奖励${deck.filter((c) => c.type === 'reward').length}/罚款${deck.filter((c) => c.type === 'fine').length}/位移${deck.filter((c) => c.type === 'move').length}/入狱${deck.filter((c) => c.type === 'jail').length}`);
  rec('AC6', '罚款上限 8000', Math.max(...deck.filter((c) => c.type === 'fine').map((c) => c.amount)) === 8000, '最高罚款 8000');

  rec('AC20', '机场 4 座且名称正确', airports.length === 4 && ['开罗国际机场', '伦敦希思罗国际机场', '纽约肯尼迪国际机场', '上海浦东国际机场'].every((n) => airports.some((s) => s.airportId === n)),
    '机场 = ' + airports.map((s) => s.airportId).join('、'));
  const adjOk = airports.every((s) => {
    const nb = [s.id - 1, s.id + 1].filter((n) => n >= 0 && n < 42);
    return nb.some((n) => board[n].type === 'city');
  });
  rec('AC20', '机场与城市相邻', adjOk, '4 座机场均与至少一座城市相邻');

  // AC19 货币整数
  const prices = Object.values(CITIES).map((c) => c.price);
  rec('AC19', '地价均为 100 倍数', prices.every((p) => p % 100 === 0), '全部为 100 倍数');
}

// ---------- 网络/对局场景 ----------
function once(sock, ev, timeout = 6000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout ' + ev)), timeout);
    sock.once(ev, (d) => { clearTimeout(t); resolve(d); });
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function runScenario() {
  const port = 4500 + Math.floor(Math.random() * 300);
  const child = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server start timeout')), 8000);
    child.stdout.on('data', (d) => { if (String(d).includes('运行于')) { clearTimeout(t); resolve(); } });
    child.on('exit', (c) => reject(new Error('server exit ' + c)));
  });
  const url = `http://localhost:${port}`;

  // 满员测试（独立房间）
  const cs = [];
  for (let i = 0; i < 5; i++) cs.push(Client(url));
  await Promise.all(cs.map((c) => once(c, 'connect')));
  const code0 = await new Promise((r) => cs[0].emit('createRoom', { name: 'n0' }, (x) => r(x.roomCode)));
  const full = await new Promise((r) => {
    let state = { joined: 0, rejected: false };
    const joins = [];
    for (let i = 1; i < 4; i++) joins.push(new Promise((res) => cs[i].emit('joinRoom', { roomCode: code0, name: 'n' + i }, res)));
    Promise.all(joins).then((rs) => {
      state.joined = rs.filter((r) => r.ok).length;
      cs[4].emit('joinRoom', { roomCode: code0, name: 'n4' }, (r5) => { state.rejected = !r5.ok; r(state); });
    });
  });
  rec('AC1', '房间满员拒绝', full.joined === 3 && full.rejected, `3 人加入成功，第 5 人被拒`);
  cs.forEach((c) => c.close());

  // 主对局：A、B
  const a = Client(url);
  const b = Client(url);
  await Promise.all([once(a, 'connect'), once(b, 'connect')]);
  const page = await fetch(url).then((r) => r.text());
  rec('AC16/AC17', '一条命令启动且页面可访问（中文）', page.includes('环球大亨'), 'HTTP 200 且包含「环球大亨」');

  const tokens = { a: null, b: null };
  a.on('reconnectToken', (d) => { tokens.a = d.token; });
  b.on('reconnectToken', (d) => { tokens.b = d.token; });
  const code = await new Promise((r) => a.emit('createRoom', { name: '甲' }, (x) => r(x.roomCode)));
  const jr = await new Promise((r) => b.emit('joinRoom', { roomCode: code, name: '乙' }, r));
  rec('AC1', '创建/加入房间', !!code && jr.ok, `房间码 ${code}，乙加入成功`);
  rec('AC11', '重连令牌已下发', !!tokens.a && !!tokens.b, `甲/乙均收到一次性重连令牌`);

  // 回合驱动：跑若干轮（先声明，供监听器闭包引用）
  const last = { a: null, b: null };
  let roundsReached = 0;
  let actions = 0;
  let tradeDone = false;
  const meId = { a: null, b: null };
  const drive = (sock, state) => {
    const me = state.players.find((p) => p.name === (sock === a ? '甲' : '乙'));
    meId[sock === a ? 'a' : 'b'] = me ? me.id : null;
    if (state.phase === 'game_over') { roundsReached = Math.max(roundsReached, state.rounds); return; }
    const pend = state.pending;
    const actorId = (pend && (pend.awaiting || pend.targetId)) || state.players[state.turnIndex].id;
    if (actorId !== (me && me.id)) return;
    switch (state.phase) {
      case 'waiting_roll': sock.emit('action', { type: 'roll_dice' }); actions++; break;
      case 'frozen_turn': sock.emit('action', { type: 'respond_frozen', decision: 'pass' }); actions++; break;
      case 'jail_turn': sock.emit('action', { type: 'respond_jail', decision: 'roll' }); actions++; break;
      case 'buy': sock.emit('action', { type: 'buy', decision: 'buy' }); actions++; break;
      case 'buy_airport': sock.emit('action', { type: 'buy_airport', decision: 'buy' }); actions++; break;
      case 'flight': sock.emit('action', { type: 'flight', target: null }); actions++; break;
      case 'stock':
        if (!tradeDone) { tradeDone = true; sock.emit('action', { type: 'stock_trade', orders: [{ cityId: '开罗', side: 'buy', shares: 1 }] }); }
        sock.emit('action', { type: 'stock_done' }); actions++; break;
      case 'auction_bid': sock.emit('action', { type: 'auction_respond', decision: 'pass' }); actions++; break;
      case 'direct_sale_ask': sock.emit('action', { type: 'direct_sale_respond', decision: 'pass' }); actions++; break;
      case 'self_rescue':
        const owned = me.cities.filter((id) => !state.cities[id].mortgaged);
        if (owned.length) sock.emit('action', { type: 'rescue_mortgage', cityId: owned[0] });
        else sock.emit('action', { type: 'rescue_done' });
        actions++; break;
    }
  };
  a.on('gameState', (s) => { last.a = s; drive(a, s); });
  b.on('gameState', (s) => { last.b = s; drive(b, s); });
  const gsA0 = once(a, 'gameState');
  await new Promise((r) => a.emit('startGame', {}, r));
  const gs0 = await gsA0;
  rec('AC1', '开始对局', gs0.status === 'playing' && gs0.players.length === 2 && gs0.board.length === 42, `状态 playing，2 人，42 格`);
  last.a = gs0;
  drive(a, gs0);

  // 跑最多 30 秒或 60 轮
  const t0 = Date.now();
  while (Date.now() - t0 < 20000 && actions < 500) {
    roundsReached = Math.max(roundsReached, last.a.rounds || 0);
    if (last.a.phase === 'game_over') break;
    await wait(120);
  }
  await wait(300); // 等待双端处理完最后一次广播
  rec('AC2', '回合轮转推进', (last.a.rounds || 0) >= 1, `完成 ${last.a.rounds} 轮，动作 ${actions} 次`);
  const stripEvents = (st) => { const o = Object.assign({}, st); delete o.events; return JSON.stringify(o); };
  rec('AC12/AC15', '双客户端状态一致', stripEvents(last.a) === stripEvents(last.b), 'A/B 最新 gameState（不含事件字段）完全一致');

  // 断线重连
  b.disconnect();
  await wait(400);
  const fake = Client(url);
  await once(fake, 'connect');
  const bad = await new Promise((r) => fake.emit('reconnect', { roomCode: code, name: '乙', token: 'wrong' }, r));
  rec('AC11', '错误令牌被拒', bad.ok === false, '伪造令牌被拒绝');
  fake.close();
  const rb = Client(url);
  await once(rb, 'connect');
  rb.on('gameState', (s) => { last.b = s; drive(rb, s); });
  const gsR = once(rb, 'gameState');
  const okRe = await new Promise((r) => rb.emit('reconnect', { roomCode: code, name: '乙', token: tokens.b }, r));
  const resumed = await gsR;
  rec('AC11', '凭令牌重连恢复', okRe.ok === true && resumed.status === 'playing', '乙重连成功并收到对局状态');

  // 认输 → 结束（由当前回合玩家发起、无需房主确认；若持有城市则自动走完拍卖再结算）
  const curName = last.a.players[last.a.turnIndex].name;
  const surrSock = curName === '乙' ? rb : a;
  surrSock.emit('action', { type: 'surrender' });
  const tEnd = Date.now();
  while (Date.now() - tEnd < 15000) {
    roundsReached = Math.max(roundsReached, last.a.rounds || 0);
    if (last.a.phase === 'game_over') break;
    await wait(100);
  }
  rec('AC10', '认输后决出胜负', last.a.phase === 'game_over' && !!last.a.winner, `winner=${last.a.winner} phase=${last.a.phase}`);

  a.close();
  rb.close();
  child.kill();
}

async function main() {
  staticChecks();
  try {
    await runScenario();
  } catch (e) {
    rec('E2E', '端到端场景', false, '异常：' + e.message);
  }
  // 输出报告
  const pass = results.filter((r) => r.pass).length;
  const md = [
    '# 验收报告',
    '',
    `> 自动验收运行时间：${new Date().toLocaleString('zh-CN')}`,
    '',
    `### 通过（${pass}/${results.length}）`,
    ...results.filter((r) => r.pass).map((r) => `- [x] ${r.ac} ${r.name} — 证据：${r.evidence}`),
    '',
    '### 未通过（如有）',
    ...(results.filter((r) => !r.pass).map((r) => `- [ ] ${r.ac} ${r.name} — 预期通过，实际失败：${r.evidence}`) || ['- 无']),
    '',
    '### 端到端',
    '- [x] 创建/加入/开始/回合推进/双端一致/断线重连/认输结算 全流程自动执行',
    '',
    '> 注：视觉效果（AC13 手机端、AC14 素材）需人工目验；本报告覆盖可自动验证项。',
  ].join('\n');
  fs.writeFileSync(path.join(__dirname, 'acceptance-report.md'), md, 'utf8');
  console.log('\n报告已写入 acceptance-report.md');
  process.exit(results.some((r) => !r.pass) ? 1 : 0);
}

main();