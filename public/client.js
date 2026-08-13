'use strict';

const socket = io();
let me = { name: '', roomCode: null };
let game = null;
let awaitingPlayerId = null;
let stockDraft = {};
let disconnectedNames = [];
let roomHostId = null;
let pendingToken = null;
let clientLog = [];
let lastEventId = -1;
let lastGameJson = '';
let lastPos = {};
let animBusy = false;
let animQueued = null;
let diceAnimating = false;
let receiptPending = false;
let stockAutoShown = false;
let timerIv = null;

const $ = (id) => document.getElementById(id);

function show(id) {
  ['view-lobby', 'view-room', 'view-game'].forEach((v) => $(v).classList.toggle('hidden', v !== id));
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 2600);
}

const fmt = (n) => '￥' + Math.round(n).toLocaleString('zh-CN');

function saveReconnect(data) { localStorage.setItem('gt_reconnect', JSON.stringify(data)); }
function loadReconnect() { try { return JSON.parse(localStorage.getItem('gt_reconnect') || 'null'); } catch (e) { return null; } }
function clearReconnect() { localStorage.removeItem('gt_reconnect'); }

function updateWaitBanner() {
  const banner = $('waitBanner');
  if (!banner) return;
  if (disconnectedNames.length && game && game.phase !== 'game_over') {
    banner.textContent = '⏸ ' + disconnectedNames.join('、') + ' 掉线，对局暂停，等待重连…';
    banner.classList.remove('hidden');
  } else banner.classList.add('hidden');
}

// ---------- 数值口径（与服务端一致，仅展示） ----------
function houseInvest(city) { return Math.round(city.price * 0.6 * (city.houseLevel || 0)); }
function cityTotalValue(city) { return city.price + houseInvest(city); }
function mortgageValue(city) { return Math.round(cityTotalValue(city) * 0.5); }
function rentFor(city) { let r = Math.round(city.price * (0.3 + 0.3 * (city.houseLevel || 0))); if ((city.houseLevel || 0) >= 4 && city.price >= 15000) r = Math.round(r * 1.1); return r; }
function totalAssetsFor(p) {
  if (!p) return 0;
  let t = p.cash;
  for (const id of p.cities) t += cityTotalValue(game.cities[id]);
  t += (p.airports || []).length * 15000;
  for (const cid of Object.keys(game.stocks)) t += (game.stocks[cid].holders[p.id] || 0) * game.stocks[cid].price;
  return t;
}
function playerById(id) { return game ? game.players.find((p) => p.id === id) : null; }
function isMyTurn() { return awaitingPlayerId === me.gameId; }
function hostName() {
  const h = game && game.players.find((p) => p.socketId === roomHostId);
  return h ? h.name : '';
}

// ---------- 棋盘 ----------
function gridPos(id) {
  // 横向长方形闭环：起点左上角，顺时针。上边 0-11 → 右边 12-20 → 下边 21-32 → 左边 33-41
  if (id <= 10) return [1, id + 1];
  if (id === 11) return [1, 12];
  if (id <= 20) return [id - 10, 12];
  if (id === 21) return [11, 12];
  if (id <= 31) return [11, 33 - id];
  if (id === 32) return [11, 1];
  return [43 - id, 1];
}
function typeClass(sq) {
  if (sq.type === 'city') return 'g-' + (game.cities[sq.cityId] ? game.cities[sq.cityId].group : '');
  if (sq.type === 'start') return 't-start';
  if (sq.type === 'airport') return 't-airport';
  if (sq.type === 'chance') return 't-chance';
  if (sq.type === 'jail') return 't-jail';
  if (sq.type === 'pole') return 't-pole';
  return 't-rest';
}
function sqLabel(sq) {
  if (sq.type === 'city') {
    const c = game.cities[sq.cityId];
    return (c.country ? c.country + '·' : '') + sq.cityId;
  }
  if (sq.type === 'airport') return sq.airportId;
  return sq.name || { chance: '机会卡', pole: sq.name, jail: '监狱', rest: '休闲', start: '起点' }[sq.type] || '';
}
function renderBoard() {
  const board = $('board');
  board.innerHTML = '';
  for (const sq of game.board) {
    const [r, c] = gridPos(sq.id);
    const div = document.createElement('div');
    div.className = 'sq ' + typeClass(sq);
    div.style.gridRow = r;
    div.style.gridColumn = c;
    let owner = '', sub = '';
    if (sq.type === 'city') {
      const city = game.cities[sq.cityId];
      owner = city.ownerId ? (playerById(city.ownerId)?.name || '') : '';
      if (city.houseLevel > 0) sub += '<span class="lvl">房' + city.houseLevel + '</span>';
      if (city.mortgaged) sub += '<span class="mg">抵</span>';
      div.onclick = () => openCityDetail(sq.cityId); // 无主城市也可查看地价/初始租金
    }
    if (sq.type === 'airport') {
      const a = game.airports[sq.airportId];
      owner = a.ownerId ? (playerById(a.ownerId)?.name || '') : '';
    }
    div.innerHTML = '<span class="num">' + sq.id + '</span><span class="nm">' + sqLabel(sq) + '</span>'
      + (sub ? '<span class="subrow">' + sub + '</span>' : '')
      + (owner ? '<span class="own">' + owner + '</span>' : '');
    board.appendChild(div);
  }
}

// ---------- 掷骰 / 棋子移动动画 ----------
function pieceXY(posId) {
  const sq = $('board').children[posId];
  if (!sq) return { x: 0, y: 0 };
  const bd = $('board');
  const br = bd.getBoundingClientRect();
  const sr = sq.getBoundingClientRect();
  return { x: sr.left - br.left + sr.width / 2, y: sr.top - br.top + sr.height / 2 };
}
function renderPieces() {
  const layer = $('pieces');
  if (!layer || !game) return;
  layer.innerHTML = '';
  const alive = game.players.filter((p) => p.alive);
  const offsets = {};
  alive.forEach((p) => {
    const pos = lastPos[p.id] != null ? lastPos[p.id] : p.position;
    offsets[pos] = (offsets[pos] || 0) + 1;
  });
  alive.forEach((p) => {
    const pos = lastPos[p.id] != null ? lastPos[p.id] : p.position;
    const xy = pieceXY(pos);
    const idx = offsets[pos]--;
    const d = document.createElement('span');
    d.className = 'piece';
    d.style.background = p.color;
    const gap = (idx - 1) * 14;
    d.style.left = (xy.x + gap) + 'px';
    d.style.top = (xy.y + gap) + 'px';
    layer.appendChild(d);
  });
}
function movePath(from, to) {
  const cw = [];
  let cur = from;
  while (cur !== to) { cur = (cur + 1) % 42; cw.push(cur); }
  const ccw = [];
  cur = from;
  while (cur !== to) { cur = (cur + 41) % 42; ccw.push(cur); }
  return cw.length <= ccw.length ? cw : ccw;
}
function playMoveAnim(movers, done) {
  const steps = movers.map((p) => ({ id: p.id, path: movePath(lastPos[p.id] != null ? lastPos[p.id] : p.position, p.position) }));
  const maxLen = steps.reduce((m, st) => Math.max(m, st.path.length), 0);
  if (!maxLen) { done(); return; }
  let i = 0;
  const iv = setInterval(() => {
    i++;
    for (const st of steps) lastPos[st.id] = st.path[Math.min(i, st.path.length) - 1];
    renderPieces();
    if (i >= maxLen) { clearInterval(iv); done(); }
  }, 110);
}
function playDiceAnim() {
  const el = $('dice');
  if (!el) return;
  diceAnimating = true;
  el.classList.add('rolling');
  const iv = setInterval(() => {
    el.textContent = '骰子 ' + (1 + Math.floor(Math.random() * 6)) + ' + ' + (1 + Math.floor(Math.random() * 6));
  }, 90);
  setTimeout(() => {
    clearInterval(iv);
    el.classList.remove('rolling');
    diceAnimating = false;
    if (animQueued) { const st = animQueued; animQueued = null; processState(st); }
  }, 680);
}
function processState(state) {
  const movers = state.players.filter((p) => p.alive && lastPos[p.id] != null && lastPos[p.id] !== p.position);
  if (movers.length) {
    animBusy = true;
    playMoveAnim(movers, () => { animBusy = false; afterAnim(state); });
  } else {
    afterAnim(state);
  }
}
function afterAnim(state) {
  for (const p of state.players) lastPos[p.id] = p.position;
  finishRender(state);
  if (animQueued) { const st = animQueued; animQueued = null; processState(st); }
}
function finishRender(state) {
  if (state.phase !== 'stock') stockAutoShown = false;
  renderBoard();
  renderPieces();
  renderSide();
  renderLedger();
  renderActionBar();
  updateWaitBanner();
  if (state.phase === 'game_over') renderGameOver();
  let chanceShown = false;
  const json = JSON.stringify(state);
  if (json !== lastGameJson) {
    lastGameJson = json;
    const ev = state.events || [];
    const fresh = ev.filter((e) => e && e.id != null && e.id > lastEventId);
    if (fresh.length) {
      lastEventId = fresh[fresh.length - 1].id;
      clientLog = fresh.slice().reverse().concat(clientLog).slice(0, 500);
      renderSide();
      const saleFail = fresh.find((e) => e.type === 'sale' && e.text && e.text.indexOf('现金不足，无法购买') >= 0);
      if (saleFail) toast(saleFail.text);
      const chance = fresh.filter((e) => e.type === 'chance');
      if (chance.length) {
        const c = chance[chance.length - 1];
        if (c.text && c.text.indexOf(me.name + ' 抽到机会卡') === 0) {
          receiptPending = true;
          openReceipt(c);
          chanceShown = true;
        }
      }
    }
  }
  if (!chanceShown) renderPending();
}
function afterReceipt() {
  receiptPending = false;
  renderPending();
}

// ---------- 右侧极简面板 ----------
function renderSide() {
  if (!game) return;
  const meP = game.players.find((p) => p.id === me.gameId);
  if (!meP) return;
  const cur = meP;
  const panel = $('sidePlayer');
  const isHost = hostName() === cur.name;
  let state = '';
  if (!cur.alive) state = ' <span class="badge bankrupt">已破产</span>';
  if (cur.jailed) state += ' <span class="badge host">入狱</span>';
  if (cur.frozen) state += ' <span class="badge host">冰冻</span>';
  const stocks = Object.entries(cur.stocks || {}).filter(([, n]) => n > 0);
  panel.innerHTML = '<h3>我的信息</h3>'
    + '<div class="pinfo"><b>' + cur.name + '</b>' + (isHost ? ' <span class="badge host">房主</span>' : '') + state + '</div>'
    + '<div class="assets">'
    + '<div class="asset-row"><span>总资产</span><b class="total">' + fmt(totalAssetsFor(cur)) + '</b></div>'
    + '<div class="asset-row"><span>当前现金</span><b class="total">' + fmt(cur.cash) + '</b></div>'
    + '<div class="asset-row"><span>城市 ' + cur.cities.length + '（抵押 ' + cur.cities.filter((id) => game.cities[id].mortgaged).length + '）</span><b>' + (cur.airports || []).length + ' 机场</b></div>'
    + '<div class="asset-row"><span>持股</span><b>' + (stocks.map(([c, n]) => (game.cities[c].country ? game.cities[c].country + '·' : '') + c + '×' + n).join('、') || '无') + '</b></div>'
    + '</div>';
  const others = game.players.filter((p) => p.id !== me.gameId);
  const othersEl = $('sideOthers');
  if (othersEl) {
    othersEl.innerHTML = '<h3>其他玩家</h3>'
      + (others.length ? others.map((p) => {
        let ost = '';
        if (!p.alive) ost = ' <span class="badge bankrupt">已破产</span>';
        if (p.jailed) ost += ' <span class="badge host">入狱</span>';
        if (p.frozen) ost += ' <span class="badge host">冰冻</span>';
        return '<div class="pinfo"><b>' + p.name + '</b>' + ost + '</div>'
          + '<div class="assets">'
          + '<div class="asset-row"><span>总资产</span><b class="total">' + fmt(totalAssetsFor(p)) + '</b></div>'
          + '<div class="asset-row"><span>当前现金</span><b>' + fmt(p.cash) + '</b></div>'
          + '</div>';
      }).join('') : '<p class="hint">暂无其他玩家</p>');
  }
  const log = $('log');
  log.innerHTML = '';
  const list = clientLog.filter((e) => e.text).slice(0, 30);
  if (!list.length) log.innerHTML = '<div class="ev">暂无事件记录</div>';
  list.forEach((e, i) => {
    const d = document.createElement('div');
    d.className = 'ev' + (i === 0 ? ' cur' : '');
    d.textContent = e.text;
    log.appendChild(d);
  });
}

// ---------- 中心资产台账 ----------
function ledgerCityRow(p, cityId, allowOps) {
  const c = game.cities[cityId];
  const mgCount = p.cities.filter((id) => game.cities[id].mortgaged).length;
  const canRedeem = p.cash >= redeemCost(p, c);
  const canOpsNow = isMyTurn() && !['auction_bid', 'direct_sale_ask', 'trade_confirm'].includes(game.phase);
  const row = document.createElement('div');
  row.className = 'lrow';
  row.onclick = () => openCityDetail(cityId);
  const nm = document.createElement('span');
  nm.className = 'nm';
  nm.textContent = (c.country ? c.country + '·' : '') + cityId;
  const info = document.createElement('span');
  info.className = 'info';
  info.innerHTML = '房 <b>' + (c.houseLevel || 0) + '</b> · ' + (c.mortgaged ? '<span class="mg">抵押</span>' : '正常');
  row.appendChild(nm);
  row.appendChild(info);
  if (allowOps && p.id === me.gameId) {
    if (!c.mortgaged) {
      const m = document.createElement('button');
      m.textContent = '抵押';
      m.disabled = !canOpsNow || mgCount >= 2;
      m.title = !canOpsNow ? '当前阶段无法操作（需轮到你在掷骰阶段）' : (mgCount >= 2 ? '已达抵押上限（最多抵押 2 座城市）' : '抵押金 = 总价值 × 50%');
      m.onclick = (e) => { e.stopPropagation(); socket.emit('action', { type: 'mortgage', cityId }); };
      row.appendChild(m);
      if (p.position === 0) {
        const sd = document.createElement('button');
        sd.className = 'risk';
        sd.textContent = '出售';
        sd.onclick = (e) => { e.stopPropagation(); sellChoice(cityId); };
        row.appendChild(sd);
      }
    } else {
      const tip = document.createElement('span');
      tip.className = 'info';
      tip.textContent = '（赎回需落到该城市）';
      row.appendChild(tip);
    }
  }
  return row;
}

function renderLedger() {
  const box = $('ledger');
  if (!game || game.phase === 'game_over') { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  const meP = game.players.find((p) => p.id === me.gameId);
  const body = $('ledgerBody');
  if (!meP) return;
  if (!meP.alive) {
    box.classList.remove('dim');
    body.innerHTML = '<div class="ledger-liquidate"><h4>破产清算文书</h4>'
      + '<p>你已破产出局。未赎回的抵押城市归银行（债务豁免），其余城市进入拍卖，机场归还银行，持股作废，剩余现金归银行。</p></div>';
    return;
  }
  const waitingRoll = game.phase === 'waiting_roll' && isMyTurn();
  box.classList.toggle('dim', waitingRoll);
  const stocks = Object.entries(meP.stocks || {}).filter(([, n]) => n > 0);
  const mgCount = meP.cities.filter((id) => game.cities[id].mortgaged).length;
  const allowOps = isMyTurn() && game.phase !== 'game_over';
  if (meP.cities.length) {
    const wrap = document.createElement('div');
    wrap.className = 'ledger-list';
    for (const id of meP.cities) wrap.appendChild(ledgerCityRow(meP, id, allowOps));
    body.innerHTML = '<div class="ledger-title">资产台账 · 我的资产</div>'
      + '<div class="ledger-cash"><span class="lbl">当前现金</span><span class="amt">' + fmt(meP.cash) + '</span></div>'
      + '<div class="ledger-sum"><span>城市 <b>' + meP.cities.length + '</b>（抵押 <b>' + mgCount + '</b> / 上限 2 座）</span>'
      + '<span>机场 <b>' + (meP.airports || []).length + '</b></span>'
      + '<span>持股 <b>' + (stocks.map(([c, n]) => (game.cities[c].country ? game.cities[c].country + '·' : '') + c + '×' + n).join('、') || '无') + '</b></span></div>';
    body.appendChild(wrap);
    body.insertAdjacentHTML('beforeend', '<div class="ledger-note">抵押上限最多 2 座城市；赎回需足额现金（抵押金 + 累计利息）；起点地产支持出售清算。点击城市行查看地产详情。</div>');
  } else {
    body.innerHTML = '<div class="ledger-title">资产台账 · 我的资产</div>'
      + '<div class="ledger-cash"><span class="lbl">当前现金</span><span class="amt">' + fmt(meP.cash) + '</span></div>'
      + '<div class="ledger-list"><div class="lrow"><span class="nm" style="color:var(--off)">暂无城市资产</span></div></div>'
      + '<div class="ledger-note">掷骰落子、收购城市后，台账将在此列出明细。</div>';
  }
  if (waitingRoll) body.insertAdjacentHTML('beforeend', '<div class="ledger-wait">等待掷骰子</div>');
}

// ---------- 底部操作栏 ----------
function renderActionBar() {
  if (!game) return;
  const cur = game.players[game.turnIndex];
  $('dice').textContent = game.dice ? '骰子 ' + game.dice[0] + ' + ' + game.dice[1] : '骰子 · 待掷';
  $('turnInfo').textContent = '当前回合：' + cur.name + '（第 ' + game.rounds + ' 轮）';
  const canRoll = game.phase === 'waiting_roll' && isMyTurn();
  $('btnRoll').disabled = !canRoll;
  $('btnEndTurn').disabled = !canRoll;
  $('btnEndTurn').title = canRoll ? '掷骰并推进本回合' : '当前阶段由系统自动推进';
}

// ---------- 通用弹窗 ----------
function openModal(title) { $('modalTitle').textContent = title; $('modal').classList.remove('hidden'); }
function closeModal() { $('modal').classList.add('hidden'); }
function emitAct(action) { socket.emit('action', action); closeModal(); }
function kv(label, val, cls) { return '<div class="kv"><span>' + label + '</span><b class="' + (cls || '') + '">' + val + '</b></div>'; }

function renderPending() {
  const meP = game.players.find((p) => p.id === me.gameId);
  if (!meP || game.phase === 'game_over') return;
  const isMe = isMyTurn();
  const body = $('modalBody');
  switch (game.phase) {
    case 'waiting_roll': closeModal(); break;
    case 'frozen_turn':
      if (isMe) {
        const canPay = meP.cash >= 5000;
        body.innerHTML = '<div class="card-tag">FROZEN</div><p>你被冰冻了！可支付 5000 购买救援服务解除冰冻并正常行动；放弃则跳过本回合。</p>'
          + kv('当前现金', fmt(meP.cash), canPay ? 'g' : 'r')
          + (canPay ? '' : '<p class="hint">现金不足 5000，无法支付救援费，只能跳过本回合。</p>')
          + '<div class="btnrow"><button class="primary" ' + (canPay ? '' : 'disabled') + ' onclick="emitAct({type:\'respond_frozen\',decision:\'pay\'})">支付 5000 解除</button>'
          + (canPay ? '<button class="secondary" onclick="emitAct({type:\'respond_frozen\',decision:\'pass\'})">放弃</button>' : '<button class="secondary" onclick="closeModal(); openAssetOverview()">募集资金</button><button class="secondary" onclick="emitAct({type:\'respond_frozen\',decision:\'pass\'})">放弃</button>') + '</div>';
        openModal('极地救援');
      } else {
        const fp = playerById(game.pending ? game.pending.playerId : null);
        closeModal();
        toast('等待 ' + (fp ? fp.name : '对方') + ' 解除冰冻…');
      }
      break;
    case 'jail_turn':
      if (isMe) {
        const canPayJ = meP.cash >= 15000;
        body.innerHTML = '<p>你被关押在监狱。</p><p class="hint">掷出对子（两个骰子点数相同，如 3+3、6+6）即可出狱；非对子记一回合。出狱费 15000 可提前出狱（非强制）。</p>'
          + (canPayJ ? '' : '<p class="hint">资金不足（当前 ' + fmt(meP.cash) + '），可先募集资金。</p>')
          + '<div class="btnrow"><button class="primary" ' + (canPayJ ? '' : 'disabled') + ' onclick="emitAct({type:\'respond_jail\',decision:\'pay\'})">支付 15000 出狱</button>'
          + '<button class="secondary" onclick="emitAct({type:\'respond_jail\',decision:\'roll\'})">掷骰试出狱</button>'
          + (canPayJ ? '<button class="secondary" onclick="emitAct({type:\'respond_jail\',decision:\'pass\'})">放弃</button>' : '') + '</div>'
          + (canPayJ ? '' : '<div class="btnrow"><button class="secondary" onclick="closeModal(); openAssetOverview()">募集资金</button>'
          + '<button class="secondary" onclick="emitAct({type:\'respond_jail\',decision:\'pass\'})">放弃</button></div>');
        openModal('监狱');
      } else {
        const jp = playerById(game.pending ? game.pending.playerId : null);
        closeModal();
        toast('等待 ' + (jp ? jp.name : '对方') + ' 出狱…');
      }
      break;
    case 'buy':
      if (isMe) {
        const city = game.cities[game.pending.cityId];
        const poor = meP.cash < city.price;
        const myCap = (game.lapLeaderId === me.gameId) ? 2 : 4;
        const lapCap = (meP.lapBuys || 0) >= myCap;
        body.innerHTML = '<div class="card-tag">PROPERTY</div>'
          + kv('地产名称', (city.country ? city.country + '·' : '') + game.pending.cityId)
          + kv('当前价格', fmt(city.price), 'g')
          + kv('当前租金', fmt(rentFor(city)))
          + kv('当前现金', fmt(meP.cash), poor ? 'r' : '')
          + kv('持有玩家', '无')
          + (poor
            ? '<p class="hint">现金不足，无法直接购买。你可以募集资金（抵押/拆房凑够地价）或取消购买（进入拍卖）。</p>'
              + '<div class="row"><button class="secondary" onclick="emitAct({type:\'buy_fundraise\',decision:\'start\'})">募集资金</button><button class="risk" onclick="emitAct({type:\'buy\',decision:\'pass\'})">取消购买</button></div>'
            : (lapCap
              ? '<p class="hint">本圈（起点到起点）已购买 ' + myCap + ' 座房产，本圈不能再购买城市（机场不限' + ((game.lapLeaderId === me.gameId) ? '；本圈资产最高者限购 2 座' : '') + '）。</p><div class="row"><button class="risk" onclick="emitAct({type:\'buy\',decision:\'pass\'})">放弃购买（进入拍卖）</button></div>'
              : '<div class="row"><button class="risk" onclick="emitAct({type:\'buy\',decision:\'pass\'})">放弃购买</button><button class="positive" onclick="emitAct({type:\'buy\',decision:\'buy\'})">确认购买</button></div>'));
        openModal('地产购买');
      }
      break;
    case 'buy_airport':
      if (isMe) {
        const poor = meP.cash < 15000;
        body.innerHTML = '<div class="card-tag">AIRPORT</div>'
          + kv('机场', game.pending.airportId)
          + kv('购买价格', '￥15,000', 'g')
          + kv('当前现金', fmt(meP.cash), poor ? 'r' : '')
          + (poor
            ? '<p class="hint">现金不足，无法直接购买。你可以募集资金（抵押/拆房凑够 15000）或取消购买。</p>'
              + '<div class="row"><button class="secondary" onclick="emitAct({type:\'buy_fundraise\',decision:\'start\'})">募集资金</button><button class="risk" onclick="emitAct({type:\'buy_airport\',decision:\'pass\'})">取消购买</button></div>'
            : '<div class="row"><button class="secondary" onclick="emitAct({type:\'buy_airport\',decision:\'pass\'})">放弃</button><button class="primary" onclick="emitAct({type:\'buy_airport\',decision:\'buy\'})">购买</button></div>');
        openModal('购买机场');
      }
      break;
    case 'buy_fundraise':
      if (isMe) {
        const t = game.pending.target;
        const isCity = t.kind === 'city';
        const price = isCity ? game.cities[t.cityId].price : 15000;
        const tname = isCity ? (game.cities[t.cityId].country ? game.cities[t.cityId].country + '·' : '') + t.cityId : t.airportId;
        const enough = meP.cash >= price;
        const owned = meP.cities.filter((id) => !game.cities[id].mortgaged);
        const mgCapF = meP.cities.filter((x) => game.cities[x].mortgaged).length >= 2;
        let html = '<div class="card-tag">FUNDRAISE</div>'
          + kv('购买目标', tname)
          + kv('所需资金', fmt(price), 'g')
          + kv('当前现金', fmt(meP.cash), enough ? 'g' : 'r')
          + kv('尚缺', fmt(Math.max(0, price - meP.cash)), enough ? '' : 'r')
          + '<p class="hint">通过抵押城市或拆除房屋募集资金，凑够后点击「完成购买」。</p>';
        if (owned.length) {
          owned.forEach((id) => {
            const c = game.cities[id];
            html += '<div class="lrow" style="cursor:default"><span class="nm">' + (c.country ? c.country + '·' : '') + id + '（房 ' + (c.houseLevel || 0) + '）</span>'
              + '<button class="secondary" ' + (mgCapF ? 'disabled title="已达抵押上限（最多抵押 2 座城市）"' : '') + ' onclick="emitAct({type:\'rescue_mortgage\',cityId:\'' + id + '\'})">抵押 +' + fmt(mortgageValue(c)) + '</button>'
              + (c.houseLevel > 0 ? '<button onclick="emitAct({type:\'rescue_demolish\',cityId:\'' + id + '\'})">拆房 +' + fmt(Math.round(c.price * 0.36)) + '</button>' : '')
              + '</div>';
          });
        } else {
          html += '<p class="hint">你没有可抵押/拆房的城市资产。</p>';
        }
        html += '<div class="row"><button class="risk" onclick="emitAct({type:\'buy_fundraise\',decision:\'cancel\'})">取消购买</button><button class="positive" ' + (enough ? '' : 'disabled') + ' onclick="emitAct({type:\'buy_fundraise\',decision:\'confirm\'})">完成购买</button></div>';
        body.innerHTML = html;
        openModal('募集资金');
      }
      break;
    case 'build_decide':
      if (isMe) {
        const city = game.cities[game.pending.cityId];
        const cost = Math.round(city.price * 0.6);
        const refund = Math.round(city.price * 0.36);
        const canBuild = city.houseLevel < 4 && meP.cash >= cost;
        const canDemolish = city.houseLevel > 0;
        body.innerHTML = '<div class="card-tag">MY CITY</div>'
          + kv('城市', (city.country ? city.country + '·' : '') + game.pending.cityId)
          + kv('房屋等级', (city.houseLevel || 0) + ' / 4')
          + kv('建房费用', fmt(cost), 'g')
          + (city.houseLevel > 0 ? kv('拆房返还', fmt(refund)) : '')
          + kv('当前现金', fmt(meP.cash), canBuild ? '' : 'r')
          + '<div class="row">'
          + '<button class="positive" ' + (canBuild ? '' : 'disabled title="现金不足或已满级"') + ' onclick="emitAct({type:\'respond_build\',decision:\'build\'})">建造 1 级（-' + fmt(cost) + '）</button>'
          + '<button class="secondary" ' + (canDemolish ? '' : 'disabled title="空地皮无法拆房"') + ' onclick="emitAct({type:\'respond_build\',decision:\'demolish\'})">拆除 1 级（+' + fmt(refund) + '）</button>'
          + '<button class="secondary" onclick="emitAct({type:\'respond_build\',decision:\'pass\'})">放弃</button></div>';
        openModal('建房 / 拆房');
      } else {
        const bp = playerById(game.pending ? game.pending.playerId : null);
        closeModal();
        toast('等待 ' + (bp ? bp.name : '对方') + ' 决定建房/拆房…');
      }
      break;
    case 'stock':
      if (isMe && !stockAutoShown) {
        stockAutoShown = true;
        closeModal(); // 关闭机会卡等上一弹窗，避免残留
        renderStock();
        $('stockModal').classList.remove('hidden');
      }
      break;
    case 'flight':
      if (isMe) {
        const opts = game.board.filter((s) => s.type === 'airport' && s.airportId !== game.pending.fromAirportId);
        body.innerHTML = '<p>选择飞往的机场（机票 = 距离 × 500' + (game.pending.free ? '，免费' : '') + '）：</p><div class="row">'
          + opts.map((o) => '<button class="secondary" onclick="emitAct({type:\'flight\',target:\'' + o.airportId + '\'})">' + o.airportId + '</button>').join('')
          + '<button class="textbtn" onclick="emitAct({type:\'flight\',target:null})">不飞</button></div>';
        openModal('机场飞行');
      }
      break;
    case 'auction_bid':
      if (isMe) {
        const city = game.cities[game.pending.cityId];
        const min = game.pending.currentBid ? game.pending.currentBid + 1000 : Math.round(cityTotalValue(city) * 0.75);
        const iAmTop = game.pending.currentBidder === me.gameId;
        body.innerHTML = '<div class="card-tag">AUCTION</div>'
          + kv('竞拍标的', (city.country ? city.country + '·' : '') + game.pending.cityId)
          + kv('当前最高', game.pending.currentBid ? fmt(game.pending.currentBid) : '—')
          + kv('最低出价', fmt(min), 'g')
          + '<div class="row"><input id="bidAmt" type="number" class="mono" value="' + min + '" min="' + min + '" style="flex:1" />'
          + '<button class="primary" ' + (iAmTop ? 'disabled title="你已是最高出价者，不能再加价"' : '') + ' onclick="emitAct({type:\'auction_respond\',decision:\'bid\',amount:+$(\'bidAmt\').value})">出价</button>'
          + '<button class="secondary" onclick="emitAct({type:\'auction_respond\',decision:\'pass\'})">放弃</button></div>';
        openModal('拍卖');
      } else {
        const bidder = playerById(game.pending.awaiting);
        closeModal();
        const ac = game.cities[game.pending.cityId];
        toast('等待 ' + (bidder ? bidder.name : '对方') + ' 出价（' + (ac && ac.country ? ac.country + '·' : '') + game.pending.cityId + '）…');
      }
      break;
    case 'direct_sale_ask':
      if (isMe) {
        const city = game.cities[game.pending.cityId];
        const seller = playerById(game.pending.sellerId);
        body.innerHTML = '<div class="card-tag">DIRECT SALE</div>'
          + kv('出售标的', (city.country ? city.country + '·' : '') + game.pending.cityId)
          + kv('出售方', seller ? seller.name : '—')
          + kv('成交价格', fmt(cityTotalValue(city)), 'g')
          + '<div class="row"><button class="primary" onclick="emitAct({type:\'direct_sale_respond\',decision:\'buy\'})">购买</button><button class="secondary" onclick="emitAct({type:\'direct_sale_respond\',decision:\'pass\'})">放弃</button></div>';
        openModal('直接出售');
      } else {
        const buyer = playerById(game.pending.awaiting);
        closeModal();
        const dcity = game.cities[game.pending.cityId];
        toast('等待 ' + (buyer ? buyer.name : '对方') + ' 决定是否购买 ' + (dcity && dcity.country ? dcity.country + '·' : '') + game.pending.cityId + '…');
      }
      break;
    case 'self_rescue':
      if (isMe) {
        const pend = game.pending;
        const owned = meP.cities.filter((id) => !game.cities[id].mortgaged);
        const mgCap = meP.cities.filter((x) => game.cities[x].mortgaged).length >= 2;
        body.innerHTML = '<div class="card-tag">SELF RESCUE</div><p>资金不足（欠 ' + fmt(pend.due) + '），选择自救：</p>';
        body.innerHTML += '<p class="hint">金额：抵押 = 总价值 × 50%；直接出售 = 总价值 × 80%；拍卖流拍保底 = 总价值 × 50%。</p>';
        owned.forEach((id) => {
          const c = game.cities[id];
          const tv = cityTotalValue(c);
          const sellAmt = Math.round(tv * 0.8);
          const floorAmt = Math.round(tv * 0.5);
          body.innerHTML += '<div class="lrow" style="cursor:default;flex-wrap:wrap"><span class="nm">' + (c.country ? c.country + '·' : '') + id + '（价值 ' + fmt(tv) + '，房 ' + (c.houseLevel || 0) + '）</span>'
            + '<button class="secondary" ' + (mgCap ? 'disabled title="已达抵押上限（最多抵押 2 座城市）"' : '') + ' onclick="emitAct({type:\'rescue_mortgage\',cityId:\'' + id + '\'})">抵押 +' + fmt(mortgageValue(c)) + '</button>'
            + (c.houseLevel > 0 ? '<button onclick="emitAct({type:\'rescue_demolish\',cityId:\'' + id + '\'})">拆房 +' + fmt(Math.round(c.price * 0.36)) + '</button>' : '')
            + '<button class="risk" onclick="emitAct({type:\'sell_city\',cityId:\'' + id + '\',mode:\'direct\',context:{type:\'self_rescue\',playerId:\'' + me.gameId + '\',due:' + pend.due + '}})">出售 +' + fmt(sellAmt) + '</button>'
            + '<button class="risk" onclick="emitAct({type:\'sell_city\',cityId:\'' + id + '\',mode:\'auction\',context:{type:\'self_rescue\',playerId:\'' + me.gameId + '\',due:' + pend.due + '}})">拍卖保底 +' + fmt(floorAmt) + '</button></div>';
        });
        const heldStocks = Object.entries(meP.stocks || {}).filter(([, n]) => n > 0);
        body.innerHTML += '<div class="rule"></div><p class="hint">卖出股票自救（按当前股价，卖出的现金即时到账）：</p>';
        if (heldStocks.length) {
          heldStocks.forEach(([cid, n]) => {
            const st = game.stocks[cid];
            body.innerHTML += '<div class="lrow" style="cursor:default"><span class="nm">' + (game.cities[cid].country ? game.cities[cid].country + '·' : '') + cid + ' ×' + n + ' 股（股价 ' + st.price + '）</span>'
              + '<button class="secondary" onclick="emitAct({type:\'rescue_sell_stock\',cityId:\'' + cid + '\'})">卖出 +' + fmt(n * st.price) + '</button></div>';
          });
        } else {
          body.innerHTML += '<p class="hint">没有可卖出的股票。</p>';
        }
        body.innerHTML += '<div class="row"><button class="risk solid" onclick="emitAct({type:\'rescue_done\'})">放弃（破产）</button></div>';
        openModal('自救');
      }
      break;
  }
}


// ---------- 出售选择 ----------
function sellChoice(cityId) {
  const body = $('modalBody');
  body.innerHTML = '<div class="card-tag">LIQUIDATE</div>'
    + kv('出售标的', (game.cities[cityId].country ? game.cities[cityId].country + '·' : '') + cityId)
    + kv('总价值', fmt(cityTotalValue(game.cities[cityId])))
    + '<div class="row"><button class="secondary" onclick="emitAct({type:\'sell_city\',cityId:\'' + cityId + '\',mode:\'direct\'})">直接出售</button>'
    + '<button class="risk" onclick="emitAct({type:\'sell_city\',cityId:\'' + cityId + '\',mode:\'auction\'})">拍卖</button>'
    + '<button class="textbtn" onclick="closeModal()">取消</button></div>';
  openModal('出售城市');
}

// ---------- 资产总览 ----------
function openAssetOverview() {
  const meP = game.players.find((p) => p.id === me.gameId);
  if (!meP) return;
  const body = $('modalBody');
  body.innerHTML = '<div class="card-tag">MY ASSETS</div>'
    + kv('总资产', fmt(totalAssetsFor(meP)), 'g')
    + kv('当前现金', fmt(meP.cash))
    + kv('城市 / 抵押', meP.cities.length + ' / ' + meP.cities.filter((id) => game.cities[id].mortgaged).length)
    + kv('机场', (meP.airports || []).length)
    + '<div style="margin-top:6px">';
  if (meP.cities.length) {
    const wrap = document.createElement('div');
    wrap.className = 'ledger-list';
    for (const id of meP.cities) wrap.appendChild(ledgerCityRow(meP, id, true));
    body.appendChild(wrap);
  } else body.innerHTML += '<p class="hint">暂无城市资产</p>';
  body.innerHTML += '<div class="row"><button class="primary" onclick="closeModal()">关闭</button></div>';
  openModal('资产总览');
}


// ---------- 大厅 / 房间 ----------
function setupLobby() {
  const nick = $('nickname'), code = $('joinCode');
  const sync = () => {
    $('btnCreate').disabled = !nick.value.trim();
    $('btnJoin').disabled = !(nick.value.trim() && code.value.trim().length === 6);
  };
  nick.addEventListener('input', sync);
  code.addEventListener('input', sync);
  $('btnCreate').onclick = () => {
    me.name = nick.value.trim();
    socket.emit('createRoom', { name: me.name }, (res) => {
      if (res.ok) { me.roomCode = res.roomCode; if (pendingToken) { saveReconnect({ roomCode: me.roomCode, name: me.name, token: pendingToken }); pendingToken = null; } else saveReconnect({ roomCode: me.roomCode, name: me.name }); }
    });
  };
  $('btnJoin').onclick = () => {
    me.name = nick.value.trim();
    socket.emit('joinRoom', { roomCode: code.value.trim(), name: me.name }, (res) => {
      if (!res.ok) { toast(res.error || '加入失败'); return; }
      me.roomCode = res.roomCode;
      if (pendingToken) { saveReconnect({ roomCode: me.roomCode, name: me.name, token: pendingToken }); pendingToken = null; } else saveReconnect({ roomCode: me.roomCode, name: me.name });
    });
  };
  $('btnStart').onclick = () => socket.emit('startGame');
  $('btnCopyCode').onclick = () => {
    if (navigator.clipboard) navigator.clipboard.writeText($('roomCode').textContent).then(() => toast('房间码已复制')).catch(() => toast('复制失败'));
    else toast('房间码已复制');
  };
  $('btnLeave').onclick = () => {
    if (confirm('确定要退出房间吗？')) { clearReconnect(); location.reload(); }
  };
  $('btnSurrender').onclick = () => { if (confirm('确认认输？')) socket.emit('action', { type: 'surrender' }); };
  $('btnDisband').onclick = () => { if (confirm('解散房间？')) socket.emit('disbandRoom'); };
  $('btnStock').onclick = () => { if (game && game.phase !== 'stock') { toast('仅经过起点时可交易（跨过/停在起点会自动弹出）'); return; } renderStock(); $('stockModal').classList.remove('hidden'); };
  $('btnStockClose').onclick = () => { socket.emit('action', { type: 'stock_done' }); $('stockModal').classList.add('hidden'); stockDraft = {}; };
  $('btnStockSkip').onclick = () => { socket.emit('action', { type: 'stock_done' }); $('stockModal').classList.add('hidden'); stockDraft = {}; };
  $('btnStockConfirm').onclick = submitStock;
  $('btnRules').onclick = () => { $('rulesModal').classList.remove('hidden'); };
  $('btnRulesClose').onclick = () => $('rulesModal').classList.add('hidden');
  $('btnRoll').onclick = () => { playDiceAnim(); socket.emit('action', { type: 'roll_dice' }); };
  $('btnEndTurn').onclick = () => { playDiceAnim(); socket.emit('action', { type: 'roll_dice' }); };
  $('btnAssets').onclick = openAssetOverview;
  $('btnBank').onclick = openBank;
  // 股票买入/卖出与转让步进：事件委托（不依赖内联 onclick）
  const stockListEl = $('stockList');
  if (stockListEl) stockListEl.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-city]');
    if (!b) return;
    adjStock(b.dataset.city, b.dataset.kind, parseInt(b.dataset.delta, 10));
  });
  const transferListEl = $('transferList');
  if (transferListEl) transferListEl.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-city]');
    if (!b) return;
    adjTransfer(b.dataset.city, parseInt(b.dataset.delta, 10));
  });
  // 侧栏卡片点击标题折叠/展开（手机可折叠面板）
  const sideEl = $('side');
  if (sideEl) sideEl.addEventListener('click', (e) => {
    const h = e.target.closest('.panel h3');
    if (h) h.parentElement.classList.toggle('closed');
  });
}

// ---------- Socket ----------
socket.on('roomState', (rs) => {
  if (!me.roomCode || rs.roomCode !== me.roomCode) return;
  disconnectedNames = rs.players.filter((p) => !p.connected).map((p) => p.name);
  updateWaitBanner();
  roomHostId = rs.hostId;
  $('roomCode').textContent = rs.roomCode;
  $('playerList').innerHTML = rs.players.map((p) => {
    let badge = '';
    if (p.id === rs.hostId) badge += ' <span class="badge host">房主</span>';
    else if (!p.connected) badge += ' <span class="badge off">已离线</span>';
    else badge += ' <span class="dot on"></span>';
    return '<li>' + p.name + badge + '</li>';
  }).join('') + '<li class="slot">等待玩家加入…</li>';
  $('btnStart').disabled = rs.hostId !== socket.id || rs.players.length < 2;
  $('roomHint').textContent = rs.started ? '' : '至少 2 名玩家才可开始游戏';
  show('view-room');
});

socket.on('gameState', (state) => {
  game = state;
  let meP = game.players.find((p) => p.socketId === socket.id);
  if (!meP) meP = game.players.find((p) => p.name === me.name);
  me.gameId = meP ? meP.id : null;
  if (!meP) { console.warn('身份校验失败：昵称=' + me.name + ' socketId=' + socket.id); toast('身份校验失败，请刷新页面重新连接'); }
  awaitingPlayerId = game.phase === 'waiting_roll' ? (game.players[game.turnIndex] ? game.players[game.turnIndex].id : null) : (game.pending ? (game.pending.playerId || game.pending.awaiting || game.pending.targetId || null) : null);
  show('view-game');
  if (diceAnimating || animBusy) { animQueued = state; return; }
  processState(state);
});

socket.on('timerStarted', (t) => {
  if (timerIv) clearInterval(timerIv); // 防止旧定时器叠加导致跳动
  let remain = t.seconds;
  $('timer').textContent = '⏱ ' + remain + 's';
  timerIv = setInterval(() => {
    remain -= 1;
    if (remain <= 0) { clearInterval(timerIv); timerIv = null; }
    $('timer').textContent = remain > 0 ? '⏱ ' + remain + 's' : '';
  }, 1000);
});

socket.on('error', (e) => toast(e.message || '操作失败'));

socket.on('reconnectToken', (d) => {
  pendingToken = d.token;
  if (me.roomCode && me.name) saveReconnect({ roomCode: me.roomCode, name: me.name, token: d.token });
});

socket.on('connect', () => {
  const saved = loadReconnect();
  if (saved && saved.roomCode && saved.name && saved.token) {
    if (!confirm('检测到本浏览器保存的对局身份：' + saved.name + '（房间 ' + saved.roomCode + '）。\n是否以该身份重连？')) {
      clearReconnect();
      return;
    }
    me.name = saved.name;
    me.roomCode = saved.roomCode;
    socket.emit('reconnect', { roomCode: saved.roomCode, name: saved.name, token: saved.token }, (res) => {
      if (!res || !res.ok) { clearReconnect(); me.roomCode = null; toast('重连失败，请重新加入房间'); }
    });
  }
});

// ---------- 结算 ----------
function renderGameOver() {
  const body = $('modalBody');
  const winner = playerById(game.winner);
  const rank = game.rank && game.rank.length ? game.rank : game.players.filter((p) => p.alive).map((p) => p.id);
  let rows = '';
  rank.forEach((id, i) => {
    const p = playerById(id);
    const cls = i === 0 ? 'r1' : (i === 1 ? 'r2' : (i === 2 ? 'r3' : (p && !p.alive ? 'rb' : '')));
    rows += '<tr class="' + cls + '"><td>' + (i + 1) + '</td><td>' + (p ? p.name : '—') + (p && !p.alive ? '（已破产）' : '') + '</td><td class="mono">' + (p ? fmt(totalAssetsFor(p)) : '—') + '</td></tr>';
  });
  body.innerHTML = '<div class="winner-box">'
    + '<div class="cap">Capital Winner</div>'
    + '<div class="name">' + (winner ? winner.name : '—') + '</div>'
    + '<div class="total">最终总资产 ' + (winner ? fmt(totalAssetsFor(winner)) : '—') + '</div>'
    + '<span class="stamp">资本赢家</span></div>'
    + '<div class="rule"></div>'
    + '<table class="rank"><tr><th>名次</th><th>玩家</th><th>总资产</th></tr>' + rows + '</table>'
    + '<div class="row"><button class="secondary" onclick="closeModal()">返回房间页</button>'
    + (roomHostId === socket.id ? '<button class="primary" onclick="socket.emit(\'startGame\')">重新开始新对局</button>' : '') + '</div>';
  openModal('对局结束');
}

// ---------- 规则速查 ----------
function buildRules() {
  const groups = [
    { title: '奖励（15 张）', items: [
      '环球市长奖 +8000',
      '世博中奖 +6000、最佳城市投资奖 +6000',
      '投资分红 +4000、遗产继承 +4000、慈善拍卖收益 +4000、房产升值 +4000',
      '街头艺演 +2000、彩票小奖 +2000、亲友红包 +2000、退税返还 +2000',
      '捡到钱包 +2000、兼职导游 +2000、广告代言 +2000、发现宝藏 +2000',
    ]},
    { title: '罚款（15 张，上限 8000）', items: [
      '税务稽查 -8000',
      '古迹修缮 -6000、违规施工 -6000',
      '超速罚款 -4000、噪音扰民 -4000、违章改建 -4000、拖欠物业费 -4000',
      '停车费 -2000、乱扔垃圾 -2000、违规摆摊 -2000、宠物随地便溺 -2000',
      '破坏公共设施 -2000、逾期交通罚单 -2000、违规鸣笛 -2000、遗失证照补办 -2000',
    ]},
    { title: '位移（9 张）', items: ['前进 3 格 ×3、后退 3 格 ×3、移动到起点 ×3（照常结算落点）'] },
    { title: '入狱（1 张）', items: ['直接进入最近的上一个监狱'] },
  ];
  $('rulesBody').innerHTML = ''
    + '<p><b>目标：</b>初始资金 150000；购买地产、建设城市、投资股票，坚持到最后获胜。货币为纯数字、无面额。</p>'
    + '<p><b>回合：</b>掷双骰（各 1–6，合计 2–12）。两骰相同（1-1/2-2/3-3/4-4/5-5/6-6）为对子，可再掷一次并继续移动；连续三次对子直接入狱（本次不再移动）。落点按格触发事件；主行动 90 秒、子流程 60 秒，超时自动执行默认动作。</p>'
    + '<p><b>起点结算：</b>跨过/停在起点按顺序：① 获得 5000 并计算名下城市股息 ② 开放一次股票交易窗口 ③ 若为跨过则继续结算落点事件。</p>'
    + '<p><b>地产与收租：</b>20 城分五大洲（非洲/大洋洲/欧洲/美洲/亚洲）。租金 = 地价 ×（30% + 30%×房屋等级）：0 级 30%、每级 +30%、4 级 150%；地价 ≥15000 的城市满级租金再 +10%（165%）。经过无主城可购买（支付地价）或放弃（进入拍卖）。第一轮（所有玩家各自行动一次）不能购买城市，从第二轮开始可购买；每圈（起点到起点）限购 4 座城市（机场不限）；资产最高者每圈限购 2 座（于所有存活玩家都经过一次起点后锁定）。购买/获得城市后需再次到达该城市才能建房；经过自有城可建/拆 1 级；抵押中的城市不收租。</p>'
    + '<p><b>建房与拆房：</b>建房费用 = 地价 × 60%，每城最高 4 级；拆房返还地价 × 36%（亏损变现，空地皮无法拆房）。</p>'
    + '<p><b>抵押与赎回：</b>抵押金 = 城市总价值 × 50%，最多同时抵押 2 座；每轮 5% 利息；抵押可随时进行（竞拍中除外）；赎回需落到该城市（站在城市上）后才能执行，银行/资产总览不提供赎回；破产时未赎回的抵押城市归银行。</p>'
    + '<p><b>城市交易：</b>直接出售——成交价 = 城市总价值，整城售予一名玩家，卖家得 80%、银行提成 20%。拍卖——起拍价 = 总价值 × 75%，每次加价至少 1000，参与玩家掷骰定顺序、轮流加价，其余全放弃时最高出价者获得城市及全部房产；破产拍卖所得归银行、流拍归银行；自愿出售仅在起点执行（资金不足自救除外）；多城同时拍卖按棋盘格号从小到大。</p>'
    + '<p><b>机场：</b>15000 购买（不计入圈限购）；经过他人机场付机场费 = 3000 × 拥有机场数；可再付机票费飞行（每格 500）；飞行到达的机场不再弹出购买。</p>'
    + '<p><b>极地与监狱：</b>极地（南极 14 / 北极 34）冰冻 1 回合，付 5000 解除或跳过。监狱：21 号最多 3 回合——第 1–3 回合可付 15000 或掷对子提前出狱，一直放弃则关满 3 回合、第 4 回合自动释放（80 轮前免费，80 轮后缴 30% 出狱费 4500）；11/32 号关押 1 回合——下一回合直接跳过、再下一回合自动释放；关押期间仍可收租、参与拍卖，掷骰不计入连续对子。</p>'
    + '<p><b>机会卡：</b>40 张：奖励 15、罚款 15（四档 1:2:4:8、罚款上限 8000）、位移 9、入狱 1；抽取后放回并重新洗牌（避免同一张连续出现）；位移卡照常结算落点；入狱卡送入最近的上一个监狱；移动到起点同样触发 +5000/股息/股票窗口。</p>'
    + '<p><b>股票：</b>每城 20 股（1 股 = 5%），初始股价 = 地价 ÷ 10 × 2；仅经过起点可买卖，一笔最多 3 城、合计 6 股、单城 2 股（地价 ≥15000 的城市单次最多 1 股）；城市所有者最多持有 4 股（20%）；购买有主城市股票时所有者获得一半收益；股价随购买/升级/易主 +10%、破产 −10%，上限为初始 2 倍；城市所有者过起点派发总价值 × 10% 股息（按股分配，抵押期间不发）；玩家间转让每回合限一笔、每笔最多 3 城、单城 1 股。租客持股减免租金：<20% 不减；≥20% 且 <40% 减 10%；≥40% 且 <60% 减 30%；≥60% 减 50%（上限 50%）。</p>'
    + '<p><b>自救与破产：</b>资金不足时可反复抵押/出售/拍卖/拆房/卖出股票凑钱，凑够或主动放弃才破产；破产时发放 15000 救济金，分给资产未达最高的存活玩家（资产最高者不发放）；认输按破产处理（资产归银行、不进入拍卖、不发放救济金）。</p>'
    + '<p><b>事件记录：</b>全局日志，所有玩家的事件可见（保留 500 条、显示 30 条）。</p>'
    + '<h4>城市地皮价格（20 城）</h4>'
    + '<div class="rules-group"><ul>'
    + '<li>黄·非洲：内罗毕（肯尼亚）3600 / 卡萨布兰卡（摩洛哥）4800 / 开罗（埃及）6000 / 开普敦（南非）7200</li>'
    + '<li>紫：奥克兰（新西兰）8400 / 阿姆斯特丹（荷兰）10000 / 悉尼（澳大利亚）10800 / 罗马（意大利）12000</li>'
    + '<li>绿·欧洲：莫斯科（俄罗斯）11000 / 巴黎（法国）13000 / 伦敦（英国）14000 / 柏林（德国）15000</li>'
    + '<li>蓝·美洲：墨西哥城（墨西哥）12000 / 里约热内卢（巴西）13000 / 多伦多（加拿大）14000 / 纽约（美国）19000</li>'
    + '<li>红·亚洲：新加坡（新加坡）14000 / 迪拜（阿联酋）15000 / 东京（日本）17000 / 上海（中国）20000</li>'
    + '</ul></div>'
    + '<h4>机会卡图鉴（40 张）</h4>'
    + groups.map((g) => '<div class="rules-group"><b>' + g.title + '</b><ul>' + g.items.map((i) => '<li>' + i + '</li>').join('') + '</ul></div>').join('');
}

setupLobby();
buildRules();



// ===== 规则符合性补充：股票卖出/转让、按城利息、详情条件、票据金额 =====
const transferDraft = {};

function redeemCost(p, city) { return mortgageValue(city) + (city.mortgageInterest || 0); }

function renderStock() {
  if (!game) return;
  const list = $('stockList');
  list.innerHTML = '';
  const meP = game.players.find((p) => p.id === me.gameId);
  for (const cityId of Object.keys(game.stocks)) {
    const st = game.stocks[cityId];
    const city = game.cities[cityId];
    const owner = playerById(city.ownerId);
    const locked = !city.ownerId || city.mortgaged;
    const div = document.createElement('div');
    div.className = 'stock-item';
    const held = meP ? (meP.stocks[cityId] || 0) : 0;
    const myCityCap = city.ownerId === me.gameId && held >= 4;
    div.innerHTML = '<b>' + (city.country ? city.country + '·' : '') + cityId + '</b><span class="mono">股价 ' + st.price + '</span><span>所有者：' + (owner ? owner.name : '无主') + '</span><span>持有 ' + held + ' 股' + (locked || myCityCap ? '（锁定' + (myCityCap ? '：本城最多持有 4 股（20%）' : '') + '）' : '') + '</span>';
    if (!locked && !myCityCap && game.phase === 'stock' && isMyTurn()) {
      const d = stockDraft[cityId] || { buy: 0, sell: 0 };
      const stp = document.createElement('div');
      stp.className = 'stepper';
      stp.innerHTML = '<div class="srow"><span class="lbl">买</span><button data-city="' + cityId + '" data-kind="buy" data-delta="-1">−</button><span>' + d.buy + '</span><button data-city="' + cityId + '" data-kind="buy" data-delta="1">+</button></div>'
        + '<div class="srow"><span class="lbl">卖</span><button data-city="' + cityId + '" data-kind="sell" data-delta="-1">−</button><span>' + d.sell + '</span><button data-city="' + cityId + '" data-kind="sell" data-delta="1">+</button></div>';
      div.appendChild(stp);
    }
    list.appendChild(div);
  }
  $('stockHint').textContent = '当前现金：' + fmt(meP ? meP.cash : 0) + '；' + ((game.phase === 'stock' && isMyTurn()) ? '买入最多 6 股（3 城；单城 2 股，地价≥15000 的城市单次 1 股），卖出不限' : '仅经过起点时可交易');
  renderTransfer();
}
function adjStock(cityId, kind, delta) {
  const d = stockDraft[cityId] || { buy: 0, sell: 0 };
  const meP = game.players.find((p) => p.id === me.gameId);
  const held = meP ? (meP.stocks[cityId] || 0) : 0;
  if (kind === 'sell') d.sell = Math.max(0, Math.min(held, d.sell + delta));
  else {
    let cap = 2;
    const c2 = game.cities[cityId];
    if (c2 && c2.price >= 15000) cap = Math.min(cap, 1);
    if (c2 && c2.ownerId === me.gameId) cap = Math.min(cap, 4 - held);
    d.buy = Math.max(0, Math.min(d.buy + delta, cap));
  }
  stockDraft[cityId] = d;
  renderStock();
}
function submitStock() {
  const orders = [];
  for (const cityId of Object.keys(stockDraft)) {
    const d = stockDraft[cityId];
    if (d.buy > 0) orders.push({ cityId, side: 'buy', shares: d.buy });
    if (d.sell > 0) orders.push({ cityId, side: 'sell', shares: d.sell });
  }
  if (!orders.length) { toast('请先选择交易'); return; }
  const buys = orders.filter((o) => o.side === 'buy');
  const total = buys.reduce((s, o) => s + o.shares, 0);
  if (buys.length > 3 || total > 6) { toast('买入最多 3 城、合计 6 股、单城 2 股'); return; }
  for (const o of buys) {
    if (o.shares > 2) { toast('单城最多买 2 股'); return; }
    const bc = game.cities[o.cityId];
    if (bc && bc.price >= 15000 && o.shares > 1) { toast('地价 15000 及以上的城市单次最多买 1 股'); return; }
  }
  const meP = game.players.find((p) => p.id === me.gameId);
  if (meP) {
    let cost = 0, proceeds = 0;
    for (const o of orders) {
      const st = game.stocks[o.cityId];
      const shares = Math.abs(o.shares);
      if (o.side === 'buy') cost += shares * st.price;
      else proceeds += Math.min(shares, meP.stocks[o.cityId] || 0) * st.price;
    }
    if (cost > meP.cash + proceeds) { toast('现金不足，无法完成购买'); return; }
  }
  socket.emit('action', { type: 'stock_trade', orders });
  socket.emit('action', { type: 'stock_done' });
  stockDraft = {};
  $('stockModal').classList.add('hidden');
}
function renderTransfer() {
  const box = $('transferBox');
  if (!box) return;
  const meP = game.players.find((p) => p.id === me.gameId);
  const can = !!game && game.phase === 'stock' && isMyTurn() && !!meP;
  box.classList.toggle('hidden', !can);
  if (!can) return;
  const sel = $('transferTarget');
  sel.innerHTML = game.players.filter((p) => p.alive && p.id !== me.gameId).map((p) => '<option value="' + p.id + '">' + p.name + '</option>').join('');
  const list = $('transferList');
  list.innerHTML = '';
  let any = false;
  for (const cityId of meP.cities) {
    const held = meP.stocks[cityId] || 0;
    if (held <= 0) continue;
    any = true;
    const n = transferDraft[cityId] || 0;
    const row = document.createElement('div');
    row.className = 'trow';
    row.innerHTML = '<span class="nm">' + (game.cities[cityId].country ? game.cities[cityId].country + '·' : '') + cityId + '（持有 ' + held + ' 股）</span><div class="stepper"><button data-city="' + cityId + '" data-delta="-1">−</button><span>' + n + '</span><button data-city="' + cityId + '" data-delta="1">+</button></div>';
    list.appendChild(row);
  }
  if (!any) list.innerHTML = '<p class="hint">你暂无可转让的持股</p>';
}
function adjTransfer(cityId, delta) {
  const next = Math.max(0, (transferDraft[cityId] || 0) + delta);
  if (next > 1) { toast('每座城市最多转让 1 股'); return; }
  const after = Object.assign({}, transferDraft);
  if (next > 0) after[cityId] = next; else delete after[cityId];
  if (Object.keys(after).length > 3) { toast('每笔最多 3 座城市'); return; }
  transferDraft[cityId] = next;
  renderTransfer();
}
function submitTransfer() {
  const targetId = $('transferTarget').value;
  if (!targetId) { toast('请选择转让对象'); return; }
  const items = Object.entries(transferDraft).filter(([, n]) => n > 0).map(([cityId, n]) => ({ cityId, shares: n }));
  if (!items.length) { toast('请选择要转让的股票'); return; }
  const cash = Math.max(0, parseInt($('transferCash').value || '0', 10) || 0);
  socket.emit('action', { type: 'stock_transfer', targetId, items, cash });
  transferDraft = {};
  renderTransfer();
  toast('已发起转让，等待对方确认');
}
function handleTradeConfirm() {
  const meP = game.players.find((p) => p.id === me.gameId);
  const pend = game && game.pending;
  if (!meP || !pend || pend.type !== 'trade_confirm' || pend.targetId !== me.gameId) return;
  const from = playerById(pend.fromId);
  const items = (pend.items || []).map((it) => it.cityId + ' ×' + it.shares + ' 股').join('、');
  $('modalBody').innerHTML = '<div class="card-tag">TRANSFER</div>'
    + kv('转让方', from ? from.name : '—')
    + kv('股票', items)
    + kv('附带现金', fmt(pend.cash || 0), 'g')
    + '<div class="row"><button class="primary" onclick="emitAct({type:\'stock_transfer\',targetId:\'' + me.gameId + '\',accept:true})">接受</button>'
    + '<button class="secondary" onclick="emitAct({type:\'stock_transfer\',targetId:\'' + me.gameId + '\',accept:false})">拒绝</button></div>';
  openModal('股票转让确认');
}
function openBank() {
  const meP = game.players.find((p) => p.id === me.gameId);
  if (!meP) return;
  const body = $('modalBody');
  const un = meP.cities.filter((id) => !game.cities[id].mortgaged);
  const md = meP.cities.filter((id) => game.cities[id].mortgaged);
  const limit = un.reduce((s, id) => s + mortgageValue(game.cities[id]), 0);
  const debt = md.reduce((s, id) => s + mortgageValue(game.cities[id]) + (game.cities[id].mortgageInterest || 0), 0);
  const myTurn = isMyTurn();
  const canOps = myTurn && !['auction_bid', 'direct_sale_ask', 'trade_confirm'].includes(game.phase);
  body.innerHTML = '<div class="card-tag">BANK</div>'
    + kv('当前现金', fmt(meP.cash), 'g')
    + kv('可贷款额度', fmt(limit))
    + kv('当前负债', fmt(debt), 'r')
    + '<div style="margin-top:8px"><label>贷款（抵押未抵押城市，上限 2 座）</label>';
  if (un.length) {
    const wrap = document.createElement('div');
    wrap.className = 'ledger-list';
    for (const id of un) {
      const r = document.createElement('div');
      r.className = 'lrow';
      r.innerHTML = '<span class="nm">' + (game.cities[id].country ? game.cities[id].country + '·' : '') + id + '</span><span class="info">可贷 <b>' + fmt(mortgageValue(game.cities[id])) + '</b></span>';
      const b = document.createElement('button');
      b.className = 'secondary';
      b.textContent = '贷款';
      const atLimit = meP.cities.filter((x) => game.cities[x].mortgaged).length >= 2;
      b.disabled = !canOps || atLimit;
      b.title = !canOps ? '当前阶段无法操作（需轮到你在掷骰阶段）' : (atLimit ? '已达抵押上限（最多抵押 2 座城市）' : '');
      b.onclick = () => socket.emit('action', { type: 'mortgage', cityId: id });
      r.appendChild(b);
      wrap.appendChild(r);
    }
    body.appendChild(wrap);
  } else body.innerHTML += '<p class="hint">没有可贷款的未抵押城市</p>';
  body.innerHTML += '<p class="hint">赎回需落到对应城市后才能进行（在银行/资产界面不提供，抵押可随时进行）。</p>';
  body.innerHTML += '<div class="row"><button class="textbtn" onclick="closeModal()">关闭</button></div>';
  openModal('银行交易');
}
function openCityDetail(cityId) {
  const c = game.cities[cityId];
  if (!c) return;
  const owner = playerById(c.ownerId);
  const mine = c.ownerId === me.gameId && isMyTurn();
  const body = $('modalBody');
  const meP = playerById(me.gameId);
  const sq = game.board.find((s) => s.cityId === cityId);
  const onCity = !!(meP && sq && meP.position === sq.id && game.phase === 'waiting_roll');
  const mgCount = meP ? meP.cities.filter((id) => game.cities[id].mortgaged).length : 0;
  body.innerHTML = '<div class="card-tag">PROPERTY DETAIL</div>'
    + kv('地产名称', (c.country ? c.country + '·' : '') + cityId)
    + kv('地皮价格', fmt(c.price), 'g')
    + kv('持有者', owner ? owner.name : '无')
    + kv('房屋等级', (c.houseLevel || 0) + ' 级')
    + kv('当前租金', fmt(rentFor(c)))
    + kv('升级费用', fmt(Math.round(c.price * 0.6)))
    + kv('抵押价值', fmt(mortgageValue(c)))
    + (c.mortgaged ? kv('累计利息', fmt(c.mortgageInterest || 0), 'r') : '')
    + kv('状态', c.mortgaged ? '<span class="mg">已抵押</span>' : '正常')
    + '<div class="row">'
    + (mine && !c.mortgaged && (c.houseLevel || 0) < 4 && onCity && c.buildReady !== false ? '<button class="secondary" onclick="emitAct({type:\'build_house\',cityId:\'' + cityId + '\'})">升级</button>' : '')
    + (mine && !c.mortgaged && (c.houseLevel || 0) > 0 && onCity ? '<button class="secondary" onclick="emitAct({type:\'demolish_house\',cityId:\'' + cityId + '\'})">拆房</button>' : '')
    + (mine && !c.mortgaged ? '<button class="secondary" ' + (mgCount >= 2 ? 'disabled title="已达抵押上限（最多抵押 2 座城市）"' : '') + ' onclick="emitAct({type:\'mortgage\',cityId:\'' + cityId + '\'})">抵押</button>' : '')
    + (mine && c.mortgaged && onCity ? '<button class="secondary" ' + (meP && meP.cash < redeemCost(meP, c) ? 'disabled title="现金不足，无法赎回"' : '') + ' onclick="emitAct({type:\'redeem\',cityId:\'' + cityId + '\'})">赎回</button>' : '')
    + (mine && !c.mortgaged && meP && meP.position === 0 ? '<button class="risk" onclick="sellChoice(\'' + cityId + '\')">出售</button>' : '')
    + '<button class="textbtn" onclick="closeModal()">关闭</button></div>';
  openModal('地产详情');
}
function openReceipt(ev) {
  const body = $('modalBody');
  const m = /抽到机会卡「(.+?)」([（(]([+-]?\d+)[）)])?/.exec(ev.text || '');
  const name = m ? m[1] : '机会卡';
  const amt = m && m[3] ? parseInt(m[3], 10) : null;
  body.innerHTML = '<div class="receipt">'
    + '<div class="rt">Opportunity</div>'
    + '<div class="rn">' + name + '</div>'
    + (amt !== null ? '<div class="ra' + (amt < 0 ? ' neg' : '') + '">' + (amt >= 0 ? '+' : '') + fmt(amt) + '</div>' : '')
    + '<div class="rd">卡面效果已结算，详见右侧事件记录。</div>'
    + '<span class="stamp">机会 · 资本</span></div>'
    + '<div class="row"><button class="primary" onclick="afterReceipt()">确认</button></div>';
  openModal('机会卡');
}
const btnTransfer = document.getElementById('btnTransfer');
if (btnTransfer) btnTransfer.onclick = submitTransfer;
socket.on('gameState', (state) => { if (state && state.phase === 'trade_confirm') handleTradeConfirm(); });