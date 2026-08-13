'use strict';

const { rollDice, shuffle } = require('./random');

const JAILS = [11, 21, 32];
const GO = 0;
const GO_BONUS = 5000;
const START_CASH = 150000;
const JAIL_FINE = 15000;
const FREEZE_FINE = 5000;
const AIRPORT_PRICE = 15000;
const MORTGAGE_MAX = 2;
const MORTGAGE_INTEREST = 0.05;

// ---------- helpers ----------

function log(events, text, type = 'log') {
  events.push({ type, text });
}

function cityLabel(state, cityId) {
  const c = state.cities[cityId];
  return c && c.country ? c.country + '·' + cityId : cityId;
}

function currentPlayer(state) {
  return state.players[state.turnIndex];
}

function alivePlayers(state) {
  return state.players.filter((p) => p.alive);
}

function otherAlivePlayers(state, excludeId) {
  return state.players.filter((p) => p.alive && p.id !== excludeId);
}

function houseInvest(city) {
  return city.price * 0.6 * city.houseLevel;
}

function cityTotalValue(city) {
  return city.price + houseInvest(city);
}

function rentFor(city) {
  return city.price * (0.3 + 0.3 * city.houseLevel);
}

function refundFor(city) {
  return Math.round(city.price * 0.36);
}

function mortgageValue(city) {
  return Math.round(cityTotalValue(city) * 0.5);
}

function nearestPrevJail(pos) {
  let best = JAILS[0];
  let bestD = 42;
  for (const j of JAILS) {
    const d = (pos - j + 42) % 42;
    if (d > 0 && d < bestD) {
      best = j;
      bestD = d;
    }
  }
  return best;
}

// 监狱关押时长：21 号监狱 3 回合；11/32 号监狱 1 回合
function jailLimitFor(pos) {
  return pos === 21 ? 3 : 1;
}

function seatOrderIds(state, fromId) {
  const ids = state.players.map((p) => p.id);
  const start = ids.indexOf(fromId);
  const order = [];
  for (let i = 1; i < ids.length; i++) order.push(ids[(start + i) % ids.length]);
  return order;
}

function playerById(state, id) {
  return state.players.find((p) => p.id === id);
}

function stockPriceCap(city) {
  return Math.round((city.price / 10) * 2 * 2); // 初始股价的 2 倍
}

function bumpStock(state, cityId, delta) {
  const st = state.stocks[cityId];
  const city = state.cities[cityId];
  const cap = stockPriceCap(city);
  let next = Math.round(st.price * (1 + delta));
  if (delta > 0) next = Math.min(next, cap);
  if (next < 0) next = 0;
  st.price = next;
}

function sharesOf(state, playerId, cityId) {
  return state.stocks[cityId].holders[playerId] || 0;
}

// ---------- 回合推进 ----------

function advanceTurn(state, events, rng) {
  // 清算抵押利息：一轮（所有存活玩家各行动一次）结束时计息
  if (state.turnIndex === 0) state.rounds++;
  for (const p of state.players) {
    if (!p.alive) continue;
    p.transferDone = false; // 每回合重置：股票转让每回合至多一笔
    for (const cityId of p.cities) {
      const c = state.cities[cityId];
      if (c.mortgaged) {
        const interest = Math.round(mortgageValue(c) * MORTGAGE_INTEREST);
        c.mortgageInterest = (c.mortgageInterest || 0) + interest;
      }
    }
  }
  const alive = alivePlayers(state);
  if (alive.length <= 1) {
    state.winner = alive[0].id;
    state.status = 'over';
    state.phase = 'game_over';
    state.rank = [alive[0].id, ...state.rank.filter((id) => id !== alive[0].id).reverse()];
    log(events, `${alive[0].name} 成为最终赢家！`, 'win');
    return;
  }
  do {
    state.turnIndex = (state.turnIndex + 1) % state.players.length;
  } while (!state.players[state.turnIndex].alive);
  let p = currentPlayer(state);
  // 11/32 号监狱：关押 1 回合——该玩家的下一回合直接跳过（不做任何行动）
  if (p.jailed && jailLimitFor(p.position) === 1 && p.jailTurns < 1) {
    p.jailTurns = 1;
    log(events, `${p.name} 被关押 1 回合，本回合跳过`, 'jail');
    do {
      state.turnIndex = (state.turnIndex + 1) % state.players.length;
    } while (!state.players[state.turnIndex].alive);
    p = currentPlayer(state);
  }
  log(events, `轮到 ${p.name}`);
  if (p.frozen) {
    state.phase = 'frozen_turn';
    state.pending = { playerId: p.id, kind: 'frozen' };
  } else if (p.jailed) {
    if (jailLimitFor(p.position) === 1) {
      // 11/32 号监狱：关押 1 回合到期，自动释放（无需缴费）
      p.jailed = false;
      p.jailTurns = 0;
      log(events, `${p.name} 关押期满，自动释放`, 'jail');
      state.phase = 'waiting_roll';
      state.pending = null;
    } else if (p.jailTurns >= 3) {
      // 21 号监狱：关满 3 回合后自动释放（出狱费仅用于提前出狱，非强制）
      p.jailed = false;
      p.jailTurns = 0;
      log(events, `${p.name} 关押满 3 回合，自动释放`, 'jail');
      state.phase = 'waiting_roll';
      state.pending = null;
    } else {
      state.phase = 'jail_turn';
      state.pending = { playerId: p.id, kind: 'jail' };
    }
  } else {
    state.phase = 'waiting_roll';
    state.pending = null; // 新回合开始必须清空上一阶段残留
  }
}

// ---------- 起点结算 ----------

function settleGo(state, player, events) {
  player.cash += GO_BONUS;
  player.lapBuys = 0; // 回到起点重置本圈购买次数
  log(events, `${player.name} 跨过/停在起点，获得 ${GO_BONUS}`);
  // 名下城市股息
  for (const cityId of player.cities) {
    const c = state.cities[cityId];
    if (c.mortgaged) continue;
    const total = Math.round(cityTotalValue(c) * 0.1);
    const holders = Object.entries(state.stocks[cityId].holders).filter(([, n]) => n > 0);
    let distributed = 0;
    for (const [pid, n] of holders) {
      const amt = Math.round((total * n) / 20); // 每城 20 股
      if (amt > 0) {
        playerById(state, pid).cash += amt;
        distributed += amt;
        log(events, `${playerById(state, pid).name} 获得 ${cityLabel(state, cityId)} 股息 ${amt}`, 'dividend');
      }
    }
    const remainder = total - distributed;
    if (remainder > 0) log(events, `${cityLabel(state, cityId)} 股息零头/无主部分 ${remainder} 归银行`, 'dividend');
  }
}

function openStockWindow(state, player, events, after) {
  state.phase = 'stock';
  state.pending = { playerId: player.id, kind: 'go_stock', after };
  log(events, `${player.name} 可在起点进行一次股票交易`, 'stock');
}

// ---------- 落点结算 ----------

function resolveLanding(state, sqId, events, rng) {
  const p = currentPlayer(state);
  const sq = state.board[sqId];
  switch (sq.type) {
    case 'city':
      return resolveCity(state, p, sq, events, rng);
    case 'chance':
      return resolveChance(state, p, events, rng);
    case 'airport':
      return resolveAirport(state, p, sq, events);
    case 'pole':
      p.frozen = true;
      log(events, `${p.name} 落到${sq.name === '北极' ? '北极' : '南极'}，被冰冻一回合`, 'frozen');
      endTurn(state, events, rng);
      return;
    case 'jail':
      p.jailed = true;
      p.jailTurns = 0;
      log(events, `${p.name} 被关押在 ${sq.id} 号监狱（${jailLimitFor(sq.id)} 回合）`, 'jail');
      if (jailLimitFor(sq.id) === 1) {
        endTurn(state, events, rng);
      } else {
        state.phase = 'jail_turn';
        state.pending = { playerId: p.id, kind: 'jail' };
      }
      return;
    case 'rest':
    case 'start':
    default:
      endTurn(state, events, rng);
      return;
  }
}

function resolveCity(state, player, sq, events, rng) {
  const city = state.cities[sq.cityId];
  if (!city.ownerId) {
    state.phase = 'buy';
    state.pending = { playerId: player.id, cityId: sq.cityId, context: null };
    log(events, `${player.name} 经过无主的 ${cityLabel(state, sq.cityId)}（${city.price}），可选择购买`, 'buy');
    return;
  }
  if (city.ownerId === player.id) {
    if (city.mortgaged) {
      log(events, `${player.name} 经过自己的城市 ${cityLabel(state, sq.cityId)}（抵押中，不能建/拆房）`);
      endTurn(state, events, rng);
      return;
    }
    const cost = Math.round(city.price * 0.6);
    const canBuild = city.houseLevel < 4 && player.cash >= cost;
    const canDemolish = city.houseLevel > 0;
    if (!canBuild && !canDemolish) {
      log(events, `${player.name} 经过自己的城市 ${cityLabel(state, sq.cityId)}`);
      endTurn(state, events, rng);
      return;
    }
    state.phase = 'build_decide';
    state.pending = { playerId: player.id, cityId: sq.cityId, kind: 'build' };
    log(events, `${player.name} 经过自己的城市 ${cityLabel(state, sq.cityId)}，可选择建房或拆房`, 'house');
    return;
  }
  if (city.mortgaged) {
    log(events, `${cityLabel(state, sq.cityId)} 处于抵押状态，不收租`);
    endTurn(state, events, rng);
    return;
  }
  const rent = rentFor(city);
  const owner = playerById(state, city.ownerId);
  const owned = sharesOf(state, player.id, sq.cityId);
  const ratio = owned / 20; // 每城 20 股
  let dr = 0;
  if (ratio >= 0.6) dr = 0.5;
  else if (ratio >= 0.4) dr = 0.3;
  else if (ratio >= 0.2) dr = 0.1;
  const discount = Math.round(rent * dr); // 减免上限 50%
  const pay = rent - discount;
  player.cash -= pay;
  owner.cash += rent; // 银行补足抵扣部分
  log(events, `${player.name} 向 ${owner.name} 支付 ${cityLabel(state, sq.cityId)} 租金 ${rent}（持股抵扣 ${discount}）`, 'rent');
  if (player.cash < 0) {
    startSelfRescue(state, player, -player.cash, events, `支付租金`);
  } else {
    endTurn(state, events, rng);
  }
}

function resolveChance(state, player, events, rng) {
  if (!state.chanceDeck.length) state.chanceDeck = require('./board').buildChanceDeck();
  const card = state.chanceDeck.shift();
  state.chanceDeck.push(card);
  state.chanceDeck = shuffle(state.chanceDeck, rng);
  let guard = 0;
  while (state.chanceDeck.length > 1 && state.chanceDeck[0].name === card.name && guard++ < 20) {
    state.chanceDeck = shuffle(state.chanceDeck, rng);
  }
  const amtText = card.type === 'reward' ? `（+${card.amount}）` : card.type === 'fine' ? `（-${card.amount}）` : '';
  log(events, `${player.name} 抽到机会卡「${card.name}」${amtText}`, 'chance');
  if (card.type === 'reward') {
    player.cash += card.amount;
    log(events, `${player.name} 获得 ${card.amount}`);
    endTurn(state, events, rng);
  } else if (card.type === 'fine') {
    player.cash -= card.amount;
    log(events, `${player.name} 支付罚款 ${card.amount}`);
    if (player.cash < 0) startSelfRescue(state, player, -player.cash, events, `机会卡罚款`);
    else endTurn(state, events, rng);
  } else if (card.type === 'move') {
    let target;
    if (card.toStart) {
      target = GO;
      player.position = GO;
      settleGo(state, player, events);
      openStockWindow(state, player, events, 'end');
      return;
    }
    target = (player.position + card.delta + 42) % 42;
    const crossed = card.delta > 0 && target < player.position;
    player.position = target;
    if (crossed || card.delta < 0 && player.position > target) {
      // 后退也可能跨过起点：后退从 1→40 会跨过 0
      if (crossed || (card.delta < 0 && target > player.position - card.delta)) {
        settleGo(state, player, events);
        openStockWindow(state, player, events, 'land');
        return;
      }
    }
    finishLanding(state, player, events, rng);
  } else if (card.type === 'jail') {
    player.jailed = true;
    player.jailTurns = 0;
    player.position = nearestPrevJail(player.position);
    log(events, `${player.name} 直接入狱（${player.position} 号，${jailLimitFor(player.position)} 回合）`, 'jail');
    if (jailLimitFor(player.position) === 1) {
      endTurn(state, events, rng);
    } else {
      state.phase = 'jail_turn';
      state.pending = { playerId: player.id, kind: 'jail' };
    }
  }
}

function finishLanding(state, player, events, rng) {
  const sq = state.board[player.position];
  if (sq.type === 'chance') {
    log(events, `${player.name} 停在机会卡格（位移后不抽卡）`);
    endTurn(state, events, rng);
    return;
  }
  resolveLanding(state, player.position, events, rng);
}

function resolveAirport(state, player, sq, events) {
  const airport = state.airports[sq.airportId];
  if (!airport.ownerId) {
    state.phase = 'buy_airport';
    state.pending = { playerId: player.id, airportId: sq.airportId, context: null };
    log(events, `${player.name} 经过无主机场「${sq.airportId}」，可选择购买（${AIRPORT_PRICE}）`, 'buy_airport');
    return;
  }
  if (airport.ownerId === player.id) {
    state.phase = 'flight';
    state.pending = { playerId: player.id, kind: 'flight', fromAirportId: sq.airportId, free: true, context: null };
    log(events, `${player.name} 停在自己的机场，可免费飞行`, 'airport');
    return;
  }
  const owner = playerById(state, airport.ownerId);
  const fee = 3000 * owner.airports.length;
  player.cash -= fee;
  owner.cash += fee;
  log(events, `${player.name} 向 ${owner.name} 支付机场费 ${fee}`, 'airport');
  if (player.cash < 0) {
    startSelfRescue(state, player, -player.cash, events, `机场费`);
    return;
  }
  state.phase = 'flight';
  state.pending = { playerId: player.id, kind: 'flight', fromAirportId: sq.airportId, free: false, context: null };
  log(events, `${player.name} 可选择支付机票费飞行`, 'airport');
}

// ---------- 自救 ----------

function startSelfRescue(state, player, due, events, reason) {
  state.phase = 'self_rescue';
  state.pending = { playerId: player.id, kind: 'self_rescue', due, reason };
  log(events, `${player.name} 资金不足（欠 ${due}，${reason}），可抵押/出售/拆房自救`, 'rescue');
}

function finishSelfRescue(state, events, rng) {
  const pend = state.pending;
  const p = playerById(state, pend.playerId);
  if (p.cash >= 0) {
    log(events, `${p.name} 完成自救，正常结算`);
    state.pending = null;
    if (pend.resume) resolveLanding(state, p.position, events, rng);
    else endTurn(state, events, rng);
  } else {
    bankrupt(state, p, events, rng);
  }
}

// ---------- 破产 ----------

function bankrupt(state, player, events, rng) {
  player.alive = false;
  if (!state.rank.includes(player.id)) state.rank.push(player.id);
  log(events, `${player.name} 破产出局`, 'bankrupt');
  // 未赎回抵押城市归银行
  const toAuction = [];
  for (const cityId of player.cities) {
    const c = state.cities[cityId];
    if (c.mortgaged) {
      c.ownerId = null;
      c.mortgaged = false;
      c.houseLevel = 0;
      c.mortgageInterest = 0;
      log(events, `抵押城市 ${cityLabel(state, cityId)} 归银行（债务豁免）`);
    } else {
      toAuction.push(cityId);
    }
  }
  for (const airportId of player.airports) state.airports[airportId].ownerId = null;
  player.airports = [];
  for (const cityId of Object.keys(player.stocks)) {
    state.stocks[cityId].holders[player.id] = 0;
  }
  player.stocks = {};
  log(events, `${player.name} 的机场归还银行、股票作废、剩余现金归银行`);
  player.cash = 0;
  player.cities = [];
  player.mortgageInterest = 0;
  // 其余城市进入拍卖（按格编号从小到大）
  if (toAuction.length) {
    toAuction.sort((a, b) => state.board.findIndex((s) => s.cityId === a) - state.board.findIndex((s) => s.cityId === b));
    startAuction(state, toAuction[0], null, events, rng, { queue: toAuction.slice(1), bankrupted: true });
    return;
  }
  afterBankrupt(state, events, rng);
}

function surrenderLiquidation(state, player, events, rng) {
  player.alive = false;
  if (!state.rank.includes(player.id)) state.rank.push(player.id);
  log(events, `${player.name} 认输，资产直接归银行`, 'bankrupt');
  for (const cityId of player.cities) {
    const c = state.cities[cityId];
    c.ownerId = null;
    c.mortgaged = false;
    c.houseLevel = 0;
    c.mortgageInterest = 0;
    log(events, `城市 ${cityLabel(state, cityId)} 归银行（房屋拆除）`);
  }
  player.cities = [];
  for (const airportId of player.airports) state.airports[airportId].ownerId = null;
  player.airports = [];
  for (const cityId of Object.keys(player.stocks)) state.stocks[cityId].holders[player.id] = 0;
  player.stocks = {};
  player.cash = 0;
  player.mortgageInterest = 0;
  afterBankrupt(state, events, rng);
}

function afterBankrupt(state, events, rng) {
  const alive = alivePlayers(state);
  if (alive.length <= 1) {
    state.winner = alive[0].id;
    state.status = 'over';
    state.phase = 'game_over';
    state.rank = [alive[0].id, ...state.rank.filter((id) => id !== alive[0].id).reverse()];
    log(events, `${alive[0].name} 成为最终赢家！`, 'win');
    return;
  }
  // 若当前回合玩家破产，推进回合
  if (!state.players[state.turnIndex].alive) {
    advanceTurn(state, events, rng);
  } else {
    state.phase = 'waiting_roll';
    state.pending = null;
  }
}

// ---------- 拍卖 ----------

function startAuction(state, cityId, sellerId, events, rng, extra) {
  const participants = otherAlivePlayers(state, sellerId == null ? null : sellerId).map((p) => p.id);
  // 破产场景卖家为 null → 所有其他玩家参与
  if (sellerId == null) {
    const all = state.players.filter((p) => p.alive);
    const sellerIdx = state.pending && state.pending.playerId ? state.pending.playerId : null;
    const rest = all.filter((p) => p.id !== sellerIdx).map((p) => p.id);
    // 破产场景：全部其他玩家
    state.pending = { type: 'auction', cityId, sellerId: null, order: rest, index: 0, currentBid: 0, currentBidder: null, roundBidMade: false, ...extra, isBankruptcyAuction: !!(extra && extra.bankrupted) };
  } else {
    state.pending = { type: 'auction', cityId, sellerId, order: participants, index: 0, currentBid: 0, currentBidder: null, roundBidMade: false, ...extra };
  }
  // 掷骰定出价顺序（点数高者先）
  const rolls = {};
  for (const pid of state.pending.order) rolls[pid] = rollDice(rng)[0];
  state.pending.order.sort((a, b) => rolls[b] - rolls[a]);
  state.phase = 'auction';
  log(events, `${cityLabel(state, cityId)} 进入拍卖，起拍价 ${Math.round(cityTotalValue(state.cities[cityId]) * 0.75)}`, 'auction');
  advanceAuction(state, events, rng);
}

function advanceAuction(state, events, rng) {
  const pend = state.pending;
  if (!pend) return;
  const city = state.cities[pend.cityId];
  const startPrice = Math.round(cityTotalValue(city) * 0.75);
  if (pend.index >= pend.order.length) {
    // 一轮结束
    if (pend.roundBidMade) {
      pend.index = 0;
      pend.roundBidMade = false;
      state.phase = 'auction_bid';
      pend.awaiting = pend.order[0];
      log(events, `${pend.currentBidder} 当前最高出价 ${pend.currentBid}`);
      return;
    }
    // 无人出价 → 流拍
    auctionFail(state, events, rng);
    return;
  }
  const bidderId = pend.order[pend.index];
  state.phase = 'auction_bid';
  state.pending.awaiting = bidderId;
  const min = pend.currentBid ? pend.currentBid + 1000 : startPrice;
  log(events, `等待 ${playerById(state, bidderId).name} 出价（至少 ${min}）`, 'auction');
}

function auctionFail(state, events, rng) {
  const pend = state.pending;
  const city = state.cities[pend.cityId];
  const seller = pend.sellerId ? playerById(state, pend.sellerId) : null;
  if (pend.isBankruptcyAuction || (!seller && !pend.context)) {
    city.ownerId = null;
    city.houseLevel = 0;
    log(events, `${cityLabel(state, pend.cityId)} 流拍，归银行`, 'auction');
  } else if (seller && pend.context && pend.context.type === 'self_rescue') {
    city.ownerId = null;
    city.houseLevel = 0;
    const pay = Math.round(cityTotalValue(city) * 0.5);
    seller.cash += pay;
    log(events, `${cityLabel(state, pend.cityId)} 流拍，银行向 ${seller.name} 支付 ${pay}`, 'auction');
  } else if (seller) {
    city.ownerId = null;
    city.houseLevel = 0;
    const pay = Math.round(cityTotalValue(city) * 0.5);
    seller.cash += pay;
    log(events, `${cityLabel(state, pend.cityId)} 流拍，银行向卖家支付 ${pay}`, 'auction');
  } else {
    city.ownerId = null;
    log(events, `${cityLabel(state, pend.cityId)} 流拍，保持无主`, 'auction');
  }
  finishAuction(state, events, null, rng);
}

function auctionWin(state, events, rng) {
  const pend = state.pending;
  const city = state.cities[pend.cityId];
  const winner = playerById(state, pend.currentBidder);
  winner.cash -= pend.currentBid;
  if (winner.cash < 0) {
    // 出价以当前现金为准，理论不会发生
    startSelfRescue(state, winner, -winner.cash, events, `拍卖付款`);
    return;
  }
  city.ownerId = winner.id;
  winner.cities.push(pend.cityId);
  bumpStock(state, pend.cityId, 0.1);
  log(events, `${winner.name} 以 ${pend.currentBid} 获得 ${cityLabel(state, pend.cityId)}（含房产）`, 'auction');
  // 出价归属
  if (pend.sellerId) playerById(state, pend.sellerId).cash += pend.currentBid;
  finishAuction(state, events, winner, rng);
}

function finishAuction(state, events, winner, rng) {
  const pend = state.pending;
  const ctx = pend.context;
  if (pend.queue && pend.queue.length) {
    const next = pend.queue.shift();
    startAuction(state, next, null, events, rng, { queue: pend.queue, bankrupted: true });
    return;
  }
  if (ctx && ctx.type === 'self_rescue') {
    state.phase = 'self_rescue';
    state.pending = { playerId: ctx.playerId, kind: 'self_rescue', due: ctx.due, reason: ctx.reason, resume: ctx.resume };
    if (playerById(state, ctx.playerId).cash >= 0) finishSelfRescue(state, events, rng);
    return;
  }
  if (pend.isBankruptcyAuction) {
    afterBankrupt(state, events, rng);
    return;
  }
  // 拍卖/交易结束：本回合行动结束，不再额外行动
  endTurn(state, events, rng);
}

// ---------- 直接出售 ----------

function startDirectSale(state, cityId, sellerId, events, rng, context) {
  const city = state.cities[cityId];
  const rofr = context && context.type === 'rent' ? city.ownerId : null;
  let buyers = otherAlivePlayers(state, sellerId).map((p) => p.id);
  if (rofr && buyers.includes(rofr)) buyers = [rofr, ...buyers.filter((id) => id !== rofr)];
  state.pending = { type: 'direct_sale', cityId, sellerId, buyers, buyerIndex: 0, context };
  state.phase = 'direct_sale';
  log(events, `${cityLabel(state, cityId)} 开始直接出售（总价值 ${cityTotalValue(city)}，卖家得 80%）`, 'sale');
  advanceDirectSale(state, events, rng);
}

function advanceDirectSale(state, events, rng) {
  const pend = state.pending;
  if (pend.buyerIndex >= pend.buyers.length) {
    log(events, `直接出售无人购买，失败`, 'sale');
    const ctx = pend.context;
    if (ctx && ctx.type === 'self_rescue') {
      state.phase = 'self_rescue';
      state.pending = { playerId: ctx.playerId, kind: 'self_rescue', due: ctx.due, reason: ctx.reason, resume: ctx.resume };
      if (playerById(state, ctx.playerId).cash >= 0) finishSelfRescue(state, events, rng);
      return;
    }
    endTurn(state, events, rng);
    return;
  }
  const bidderId = pend.buyers[pend.buyerIndex];
  state.phase = 'direct_sale_ask';
  state.pending.awaiting = bidderId;
  log(events, `等待 ${playerById(state, bidderId).name} 决定是否购买 ${cityLabel(state, pend.cityId)}（${cityTotalValue(state.cities[pend.cityId])}）`, 'sale');
}

// ---------- 动作分发 ----------

function apply(state, action, rng) {
  const events = [];
  const p = currentPlayer(state);
  switch (action.type) {
    case 'roll_dice':
      if (state.phase !== 'waiting_roll') return { state, events, rejected: true };
      rollAction(state, p, events, rng);
      break;
    case 'respond_frozen':
      if (state.phase !== 'frozen_turn') return { state, events, rejected: true };
      if (action.decision === 'pay' && p.cash >= FREEZE_FINE) {
        p.cash -= FREEZE_FINE;
        p.frozen = false;
        log(events, `${p.name} 支付 ${FREEZE_FINE} 解除冰冻`);
        state.phase = 'waiting_roll';
      } else {
        if (action.decision === 'pay') log(events, `${p.name} 资金不足，无法支付救援费`);
        p.frozen = false;
        log(events, `${p.name} 放弃救援，跳过本回合`);
        endTurn(state, events, rng);
      }
      break;
    case 'respond_build':
      if (state.phase !== 'build_decide') return { state, events, rejected: true };
      respondBuild(state, p, action, events, rng);
      break;
    case 'buy_fundraise':
      if (!['buy', 'buy_airport', 'buy_fundraise'].includes(state.phase)) return { state, events, rejected: true };
      buyFundraise(state, p, action, events, rng);
      break;
    case 'respond_jail':
      if (state.phase !== 'jail_turn') return { state, events, rejected: true };
      jailAction(state, p, action, events, rng);
      break;
    case 'stock_done':
      if (state.phase !== 'stock') return { state, events, rejected: true };
      stockDone(state, events, rng);
      break;
    case 'buy':
      if (state.phase !== 'buy') return { state, events, rejected: true };
      buyAction(state, p, action, events, rng);
      break;
    case 'buy_airport':
      if (state.phase !== 'buy_airport') return { state, events, rejected: true };
      buyAirportAction(state, p, action, events, rng);
      break;
    case 'flight':
      if (state.phase !== 'flight') return { state, events, rejected: true };
      flightAction(state, p, action, events, rng);
      break;
    case 'build_house':
      buildHouse(state, p, action.cityId, events);
      break;
    case 'demolish_house':
      demolishHouse(state, p, action.cityId, events, rng);
      break;
    case 'mortgage':
      if (!['waiting_roll', 'stock', 'self_rescue'].includes(state.phase)) return { state, events, rejected: true };
      mortgage(state, p, action.cityId, events, rng);
      break;
    case 'redeem':
      if (!['waiting_roll', 'stock', 'self_rescue'].includes(state.phase)) return { state, events, rejected: true };
      redeem(state, p, action.cityId, events);
      break;
    case 'sell_city':
      if (!['waiting_roll', 'stock', 'self_rescue'].includes(state.phase)) return { state, events, rejected: true };
      sellCity(state, p, action, events, rng);
      break;
    case 'direct_sale_respond':
      if (state.phase !== 'direct_sale_ask') return { state, events, rejected: true };
      directSaleRespond(state, action, events, rng);
      break;
    case 'auction_respond':
      if (state.phase !== 'auction_bid') return { state, events, rejected: true };
      auctionRespond(state, action, events, rng);
      break;
    case 'rescue_mortgage':
      if (state.phase !== 'self_rescue' && state.phase !== 'buy_fundraise') return { state, events, rejected: true };
      rescueMortgage(state, p, action.cityId, events, rng);
      break;
    case 'rescue_demolish':
      if (state.phase !== 'self_rescue' && state.phase !== 'buy_fundraise') return { state, events, rejected: true };
      rescueDemolish(state, p, action.cityId, events, rng);
      break;
    case 'rescue_sell_stock':
      if (state.phase !== 'self_rescue') return { state, events, rejected: true };
      rescueSellStock(state, p, action, events, rng);
      break;
    case 'rescue_done':
      if (state.phase !== 'self_rescue') return { state, events, rejected: true };
      finishSelfRescue(state, events, rng);
      break;
    case 'stock_trade':
      if (state.phase !== 'stock') return { state, events, rejected: true };
      stockTrade(state, p, action.orders, events);
      break;
    case 'stock_transfer':
      if (state.phase !== 'stock' && state.phase !== 'trade_confirm') return { state, events, rejected: true };
      stockTransfer(state, p, action, events);
      break;
    case 'surrender':
      if (!p.alive) return { state, events, rejected: true };
      surrenderLiquidation(state, p, events, rng);
      break;
    case 'end_phase':
      // 供前端跳过（如机会卡/事件展示后）
      break;
    default:
      return { state, events, rejected: true };
  }
  return { state, events };
}

// ---------- 动作实现 ----------

function rollAction(state, p, events, rng) {
  const dice = rollDice(rng);
  state.dice = dice;
  const isDouble = dice[0] === dice[1];
  log(events, `${p.name} 掷出 ${dice[0]} + ${dice[1]}`);
  if (isDouble) {
    p.consecutiveDoubles = (p.consecutiveDoubles || 0) + 1;
    if (p.consecutiveDoubles >= 3) {
      p.consecutiveDoubles = 0;
      p.jailed = true;
      p.jailTurns = 0;
      p.position = nearestPrevJail(p.position);
      log(events, `${p.name} 连续三次双数，直接入狱（${p.position} 号，${jailLimitFor(p.position)} 回合）`, 'jail');
      if (jailLimitFor(p.position) === 1) {
        endTurn(state, events, rng);
      } else {
        state.phase = 'jail_turn';
        state.pending = { playerId: p.id, kind: 'jail' };
      }
      return;
    }
  } else {
    p.consecutiveDoubles = 0;
  }
  const steps = dice[0] + dice[1];
  const oldPos = p.position;
  p.position = (p.position + steps) % 42;
  const crossedGo = oldPos + steps >= 42;
  if (crossedGo) settleGo(state, p, events);
  if (crossedGo || p.position === GO) {
    if (crossedGo) {
      openStockWindow(state, p, events, 'land');
    } else {
      p.lapBuys = 0; // 停在起点同样重置本圈购买次数
      openStockWindow(state, p, events, 'end');
    }
  } else {
    resolveLanding(state, p.position, events, rng);
  }
}

function jailAction(state, p, action, events, rng) {
  if (action.decision === 'pay') {
    p.cash -= JAIL_FINE;
    p.jailed = false;
    p.jailTurns = 0;
    log(events, `${p.name} 支付 ${JAIL_FINE} 出狱`);
    if (p.cash < 0) startSelfRescue(state, p, -p.cash, events, `出狱罚金`);
    else state.phase = 'waiting_roll';
    return;
  }
  if (action.decision === 'pass') {
    // 放弃本次出狱判定：跳过本回合
    p.jailTurns += 1;
    log(events, `${p.name} 放弃出狱判定（第 ${p.jailTurns} 回合）`);
    endTurn(state, events, rng);
    return;
  }
  // 掷骰出狱
  const dice = rollDice(rng);
  state.dice = dice;
  if (dice[0] === dice[1]) {
    p.jailed = false;
    p.jailTurns = 0;
    const steps = dice[0] + dice[1];
    const oldPos = p.position;
    p.position = (p.position + steps) % 42;
    log(events, `${p.name} 掷出 ${dice[0]} + ${dice[1]}（双数）出狱并移动`);
    if (oldPos + steps >= 42) {
      settleGo(state, p, events);
      openStockWindow(state, p, events, 'land');
      return;
    }
    if (p.position === GO) {
      p.lapBuys = 0; // 停在起点重置本圈购买次数
      openStockWindow(state, p, events, 'end');
      return;
    }
    resolveLanding(state, p.position, events, rng);
    return;
  }
  p.jailTurns += 1;
  log(events, `${p.name} 掷出 ${dice[0]}+${dice[1]}，未出狱（第 ${p.jailTurns} 回合）`);
  endTurn(state, events, rng);
}

function stockDone(state, events, rng) {
  const pend = state.pending;
  state.pending = null;
  const p = playerById(state, pend.playerId);
  if (!pend.traded) log(events, `${p.name} 未进行股票交易`, 'stock');
  if (pend.after === 'end') {
    endTurn(state, events, rng);
  } else {
    resolveLanding(state, p.position, events, rng);
  }
}

function buyAction(state, p, action, events, rng) {
  const pend = state.pending;
  const city = state.cities[pend.cityId];
  if (action.decision === 'buy') {
    if (p.lapBuys >= 4) {
      log(events, `${p.name} 本圈（起点到起点）已达购买上限（4 座房产，机场不限）`, 'buy');
      return;
    }
    if (p.cash < city.price) {
      log(events, `${p.name} 资金不足，需先募集资金或取消购买`, 'buy');
      buyFundraise(state, p, { decision: 'start' }, events, rng);
      return;
    }
    p.cash -= city.price;
    city.ownerId = p.id;
    p.cities.push(pend.cityId);
    p.lapBuys = (p.lapBuys || 0) + 1;
    bumpStock(state, pend.cityId, 0.1);
    enforceOwnerStockCap(state, p, pend.cityId, events);
    log(events, `${p.name} 购买 ${cityLabel(state, pend.cityId)}（${city.price}，本圈第 ${p.lapBuys} 座）`, 'buy');
    if (p.cash < 0) startSelfRescue(state, p, -p.cash, events, `购买`);
    else endTurn(state, events, rng);
  } else {
    log(events, `${p.name} 放弃购买 ${cityLabel(state, pend.cityId)}，进入拍卖`, 'auction');
    startAuction(state, pend.cityId, null, events, rng, { context: null });
  }
}

function buyAirportAction(state, p, action, events, rng) {
  const pend = state.pending;
  if (action.decision === 'buy') {
    if (p.cash < AIRPORT_PRICE) {
      log(events, `${p.name} 资金不足，需先募集资金或取消购买`, 'airport');
      buyFundraise(state, p, { decision: 'start' }, events, rng);
      return;
    }
    p.cash -= AIRPORT_PRICE;
    state.airports[pend.airportId].ownerId = p.id;
    p.airports.push(pend.airportId);
    log(events, `${p.name} 购买机场「${pend.airportId}」（${AIRPORT_PRICE}）`, 'airport');
    if (p.cash < 0) startSelfRescue(state, p, -p.cash, events, `购买机场`);
    else endTurn(state, events, rng);
  } else {
    log(events, `${p.name} 放弃购买机场「${pend.airportId}」`);
    endTurn(state, events, rng);
  }
}

function flightAction(state, p, action, events, rng) {
  const pend = state.pending;
  if (!action.target) {
    log(events, `${p.name} 选择不飞行`);
    endTurn(state, events, rng);
    return;
  }
  const from = state.board.find((s) => s.type === 'airport' && s.airportId === pend.fromAirportId);
  const to = state.board.find((s) => s.type === 'airport' && s.airportId === action.target);
  const dist = Math.min(Math.abs(to.id - from.id), 42 - Math.abs(to.id - from.id));
  if (!pend.free) {
    const ticket = dist * 500;
    p.cash -= ticket;
    log(events, `${p.name} 支付机票费 ${ticket} 飞往「${action.target}」`, 'airport');
    if (p.cash < 0) {
      startSelfRescue(state, p, -p.cash, events, `机票费`);
      return;
    }
  } else {
    log(events, `${p.name} 免费飞往「${action.target}」`, 'airport');
  }
  p.position = to.id;
  const airport = state.airports[action.target];
  if (!airport.ownerId) {
    log(events, `${p.name} 飞抵无主机场「${action.target}」（飞行不触发购买）`, 'airport');
    endTurn(state, events, rng);
    return;
  }
  endTurn(state, events, rng);
}

// ---------- 建房/拆房决策（经过自己城市） ----------

function respondBuild(state, p, action, events, rng) {
  const pend = state.pending;
  const city = state.cities[pend.cityId];
  if (!city || city.ownerId !== p.id) {
    endTurn(state, events, rng);
    return;
  }
  if (action.decision === 'build') {
    const cost = Math.round(city.price * 0.6);
    if (!city.mortgaged && city.houseLevel < 4 && p.cash >= cost) {
      p.cash -= cost;
      city.houseLevel += 1;
      bumpStock(state, pend.cityId, 0.1);
      log(events, `${p.name} 在 ${cityLabel(state, pend.cityId)} 建造第 ${city.houseLevel} 级房（${cost}）`, 'house');
    } else {
      log(events, `${p.name} 建房条件不满足，放弃建房`);
    }
  } else if (action.decision === 'demolish') {
    if (!city.mortgaged && city.houseLevel > 0) {
      const refund = refundFor(city);
      p.cash += refund;
      city.houseLevel -= 1;
      log(events, `${p.name} 拆除 ${cityLabel(state, pend.cityId)} 一级房，返还 ${refund}`, 'house');
    } else {
      log(events, `${p.name} 拆房条件不满足，放弃拆房`);
    }
  } else {
    log(events, `${p.name} 经过 ${cityLabel(state, pend.cityId)}，不建不拆`);
  }
  endTurn(state, events, rng);
}

// ---------- 购买募资（资金不足时先凑钱再买） ----------

function buyFundraise(state, p, action, events, rng) {
  const pend = state.pending;
  if (action.decision === 'start') {
    // 从 buy / buy_airport 进入募资阶段，保存购买目标
    let target = null;
    if (state.phase === 'buy') target = { kind: 'city', cityId: pend.cityId };
    else if (state.phase === 'buy_airport') target = { kind: 'airport', airportId: pend.airportId };
    else if (state.phase === 'buy_fundraise') target = pend.target;
    if (!target) return;
    state.phase = 'buy_fundraise';
    state.pending = { playerId: p.id, kind: 'buy_fundraise', target };
    log(events, `${p.name} 资金不足，开始募集资金（可抵押/拆房）`, 'rescue');
    return;
  }
  if (state.phase !== 'buy_fundraise') return;
  const target = pend.target;
  const price = target.kind === 'city' ? state.cities[target.cityId].price : AIRPORT_PRICE;
  if (action.decision === 'confirm') {
    if (p.cash < price) {
      log(events, `${p.name} 资金仍不足（${p.cash}/${price}），无法完成购买`, 'rescue');
      return;
    }
    if (target.kind === 'city') {
      const city = state.cities[target.cityId];
      if (city.ownerId) { endTurn(state, events, rng); return; }
      if (p.lapBuys >= 4) {
        log(events, `${p.name} 本圈（起点到起点）已达购买上限（4 座房产，机场不限）`, 'buy');
        endTurn(state, events, rng);
        return;
      }
      p.cash -= city.price;
      city.ownerId = p.id;
      p.cities.push(target.cityId);
      p.lapBuys = (p.lapBuys || 0) + 1;
      bumpStock(state, target.cityId, 0.1);
      enforceOwnerStockCap(state, p, target.cityId, events);
      log(events, `${p.name} 募资完成，购买 ${cityLabel(state, target.cityId)}（${city.price}，本圈第 ${p.lapBuys} 座）`, 'buy');
    } else {
      const airport = state.airports[target.airportId];
      if (airport.ownerId) { endTurn(state, events, rng); return; }
      p.cash -= AIRPORT_PRICE;
      airport.ownerId = p.id;
      p.airports.push(target.airportId);
      log(events, `${p.name} 募资完成，购买机场「${target.airportId}」（${AIRPORT_PRICE}）`, 'airport');
    }
    endTurn(state, events, rng);
    return;
  }
  // 取消购买：城市按放弃处理进入拍卖；机场保持无主直接结束
  if (target.kind === 'city') {
    log(events, `${p.name} 取消购买 ${cityLabel(state, target.cityId)}，进入拍卖`, 'auction');
    startAuction(state, target.cityId, null, events, rng, { context: null });
  } else {
    log(events, `${p.name} 取消购买机场「${target.airportId}」`);
    endTurn(state, events, rng);
  }
}

function buildHouse(state, p, cityId, events) {
  if (state.phase !== 'waiting_roll') return;
  const city = state.cities[cityId];
  if (city.ownerId !== p.id || city.mortgaged || city.houseLevel >= 4 || p.position !== state.board.find((s) => s.cityId === cityId).id) {
    return;
  }
  const cost = Math.round(city.price * 0.6);
  if (p.cash < cost) return;
  p.cash -= cost;
  city.houseLevel += 1;
  bumpStock(state, cityId, 0.1);
  log(events, `${p.name} 在 ${cityLabel(state, cityId)} 建造第 ${city.houseLevel} 级房（${cost}）`, 'house');
}

function demolishHouse(state, p, cityId, events, rng) {
  const city = state.cities[cityId];
  if (city.ownerId !== p.id || city.mortgaged || city.houseLevel <= 0) return;
  if (state.phase === 'self_rescue') {
    // 自救场景可随时拆
  } else if (state.phase !== 'waiting_roll' || p.position !== state.board.find((s) => s.cityId === cityId).id) {
    return;
  }
  const refund = refundFor(city);
  p.cash += refund;
  city.houseLevel -= 1;
  log(events, `${p.name} 拆除 ${cityLabel(state, cityId)} 一级房，返还 ${refund}`, 'house');
  if (state.phase === 'self_rescue' && p.cash >= 0) finishSelfRescue(state, events, rng);
}

function mortgage(state, p, cityId, events, rng) {
  if (state.phase === 'self_rescue') {
    rescueMortgage(state, p, cityId, events, rng);
    return;
  }
  if (state.phase !== 'waiting_roll' && state.phase !== 'stock') return;
  const city = state.cities[cityId];
  if (city.ownerId !== p.id || city.mortgaged) return;
  const mortgagedCount = p.cities.filter((id) => state.cities[id].mortgaged).length;
  if (mortgagedCount >= MORTGAGE_MAX) return;
  const val = mortgageValue(city);
  p.cash += val;
  city.mortgaged = true;
  log(events, `${p.name} 抵押 ${cityLabel(state, cityId)}，获得 ${val}`, 'mortgage');
}

function redeem(state, p, cityId, events) {
  if (state.phase !== 'waiting_roll' && state.phase !== 'stock') return;
  const city = state.cities[cityId];
  if (city.ownerId !== p.id || !city.mortgaged) return;
  const cost = mortgageValue(city) + (city.mortgageInterest || 0);
  if (p.cash < cost) return;
  p.cash -= cost;
  city.mortgageInterest = 0;
  city.mortgaged = false;
  log(events, `${p.name} 赎回 ${cityLabel(state, cityId)}（${cost}）`, 'mortgage');
}

function rescueMortgage(state, p, cityId, events, rng) {
  const city = state.cities[cityId];
  if (city.ownerId !== p.id || city.mortgaged) return;
  const mortgagedCount = p.cities.filter((id) => state.cities[id].mortgaged).length;
  if (mortgagedCount >= MORTGAGE_MAX) return;
  const val = mortgageValue(city);
  p.cash += val;
  city.mortgaged = true;
  log(events, `${p.name} 抵押 ${cityLabel(state, cityId)} 自救，获得 ${val}`, 'rescue');
  if (state.phase === 'self_rescue' && p.cash >= 0) finishSelfRescue(state, events, rng);
}

function rescueDemolish(state, p, cityId, events, rng) {
  const city = state.cities[cityId];
  if (city.ownerId !== p.id || city.mortgaged || city.houseLevel <= 0) return;
  const refund = refundFor(city);
  p.cash += refund;
  city.houseLevel -= 1;
  log(events, `${p.name} 拆房自救 ${cityLabel(state, cityId)}，返还 ${refund}`, 'rescue');
  if (state.phase === 'self_rescue' && p.cash >= 0) finishSelfRescue(state, events, rng);
}

function rescueSellStock(state, p, action, events, rng) {
  const st = state.stocks[action.cityId];
  if (!st) return;
  const held = st.holders[p.id] || 0;
  if (held <= 0) return;
  const shares = action.shares ? Math.min(action.shares, held) : held;
  p.cash += shares * st.price;
  st.holders[p.id] = held - shares;
  p.stocks[action.cityId] = Math.max(0, (p.stocks[action.cityId] || 0) - shares);
  log(events, `${p.name} 卖出 ${cityLabel(state, action.cityId)} 股份 ×${shares} 自救（+${shares * st.price}）`, 'rescue');
  if (state.phase === 'self_rescue' && p.cash >= 0) finishSelfRescue(state, events, rng);
}

function sellCity(state, p, action, events, rng) {
  const city = state.cities[action.cityId];
  if (city.ownerId !== p.id || city.mortgaged) return;
  const isRescue = !!(action.context && action.context.type === 'self_rescue');
  if (!isRescue && p.position !== 0) return;
  if (action.mode === 'direct') {
    startDirectSale(state, action.cityId, p.id, events, rng, action.context || null);
  } else {
    startAuction(state, action.cityId, p.id, events, rng, { context: action.context || null });
  }
}

function directSaleRespond(state, action, events, rng) {
  const pend = state.pending;
  const bidder = playerById(state, pend.awaiting);
  const city = state.cities[pend.cityId];
  if (action.decision === 'buy') {
    const total = cityTotalValue(city);
    if (bidder.cash < total) {
      log(events, `${bidder.name} 现金不足，无法购买`);
    } else {
      bidder.cash -= total;
      const seller = playerById(state, pend.sellerId);
      seller.cash += Math.round(total * 0.8);
      city.ownerId = bidder.id;
      if (!bidder.cities.includes(pend.cityId)) bidder.cities.push(pend.cityId);
      if (seller.cities) seller.cities = seller.cities.filter((id) => id !== pend.cityId);
      bumpStock(state, pend.cityId, 0.1);
      log(events, `${bidder.name} 以 ${total} 购买 ${cityLabel(state, pend.cityId)}（卖家得 80%）`, 'sale');
      const ctx = pend.context;
      if (ctx && ctx.type === 'self_rescue') {
        state.phase = 'self_rescue';
        state.pending = { playerId: ctx.playerId, kind: 'self_rescue', due: ctx.due, reason: ctx.reason, resume: ctx.resume };
        if (playerById(state, ctx.playerId).cash >= 0) finishSelfRescue(state, events, rng);
        return;
      }
      endTurn(state, events, rng);
      return;
    }
  } else {
    log(events, `${bidder.name} 放弃购买`);
  }
  pend.buyerIndex += 1;
  advanceDirectSale(state, events, rng);
}

function auctionRespond(state, action, events, rng) {
  const pend = state.pending;
  const bidder = playerById(state, pend.awaiting);
  const city = state.cities[pend.cityId];
  const startPrice = Math.round(cityTotalValue(city) * 0.75);
  const min = pend.currentBid ? pend.currentBid + 1000 : startPrice;
  if (action.decision === 'bid') {
    const amount = action.amount;
    if (amount < min || amount > bidder.cash) {
      log(events, `${bidder.name} 出价无效（需 ≥${min} 且不超过现金）`);
      pend.index += 1;
      advanceAuction(state, events, rng);
      return;
    }
    pend.currentBid = amount;
    pend.currentBidder = bidder.id;
    pend.roundBidMade = true;
    log(events, `${bidder.name} 出价 ${amount}`);
  } else {
    log(events, `${bidder.name} 放弃竞价`);
  }
  pend.index += 1;
  // 唯一参与者出价后立即成交（其余参与玩家为空，视为全部放弃）
  if (pend.order.length <= 1 && pend.currentBidder != null) {
    auctionWin(state, events, rng);
    return;
  }
  if (pend.index >= pend.order.length && !pend.roundBidMade && pend.currentBidder == null) {
    auctionFail(state, events, rng);
    return;
  }
  if (pend.index >= pend.order.length && !pend.roundBidMade && pend.currentBidder != null) {
    auctionWin(state, events, rng);
    return;
  }
  advanceAuction(state, events, rng);
}

// ---------- 股票 ----------

function stockTrade(state, p, orders, events) {
  if (!orders || !orders.length) return;
  const validBuys = [];
  for (const o of orders.filter((x) => x.side === 'buy')) {
    const city = state.cities[o.cityId];
    if (o.shares > 2) {
      log(events, `${p.name} 跳过无效买入：${cityLabel(state, o.cityId)} 单城最多 2 股`, 'stock');
      continue;
    }
    if (city.price >= 15000 && o.shares > 1) {
      log(events, `${p.name} 跳过无效买入：${cityLabel(state, o.cityId)} 地价较高，单次最多买 1 股`, 'stock');
      continue;
    }
    if (city.ownerId === p.id && sharesOf(state, p.id, o.cityId) + o.shares > 4) {
      log(events, `${p.name} 跳过无效买入：${cityLabel(state, o.cityId)} 城市所有者最多持有 4 股（20%）`, 'stock');
      continue;
    }
    validBuys.push(o);
  }
  if (validBuys.length > 3 || validBuys.reduce((s, o) => s + o.shares, 0) > 6) {
    log(events, `${p.name} 股票交易未生效：买入最多 3 城、合计 6 股`, 'stock');
    return;
  }
  const buys = validBuys;
  const execute = validBuys.concat(orders.filter((x) => x.side !== 'buy'));
  let cost = 0, proceeds = 0;
  for (const o of execute) {
    const st = state.stocks[o.cityId];
    const shares = Math.abs(o.shares);
    if (o.side === 'buy') cost += shares * st.price;
    else proceeds += Math.min(shares, st.holders[p.id] || 0) * st.price;
  }
  if (cost > p.cash + proceeds) {
    log(events, `${p.name} 股票交易未生效：现金不足`, 'stock');
    return;
  }
  for (const o of execute) {
    const st = state.stocks[o.cityId];
    const shares = Math.abs(o.shares);
    if (o.side === 'buy') {
      p.cash -= shares * st.price;
      st.holders[p.id] = (st.holders[p.id] || 0) + shares;
      p.stocks[o.cityId] = (p.stocks[o.cityId] || 0) + shares;
      log(events, `${p.name} 购买 ${cityLabel(state, o.cityId)} 股份 ×${shares}（${shares * st.price}）`, 'stock');
      const city = state.cities[o.cityId];
      if (city && city.ownerId && city.ownerId !== p.id) {
        const owner = playerById(state, city.ownerId);
        const rev = Math.round(shares * st.price * 0.5);
        owner.cash += rev;
        log(events, `${owner.name} 获得股票出售收益 ${rev}（购股金额一半）`, 'stock');
      }
    } else {
      const held = st.holders[p.id] || 0;
      const sell = Math.min(shares, held);
      p.cash += sell * st.price;
      st.holders[p.id] = held - sell;
      p.stocks[o.cityId] = Math.max(0, (p.stocks[o.cityId] || 0) - sell);
      log(events, `${p.name} 出售 ${cityLabel(state, o.cityId)} 股份 ×${sell}（${sell * st.price}）`, 'stock');
    }
  }
  if (state.pending) state.pending.traded = true;
}

function stockTransfer(state, p, action, events) {
  const target = playerById(state, action.targetId);
  if (!target || !target.alive) return;
  if (state.pending && state.pending.type === 'trade_confirm') {
    // 对方确认
    const pend = state.pending;
    if (action.accept) {
      if (pend.cash > 0 && target.cash < pend.cash) {
        log(events, `${target.name} 现金不足，无法接受转让`);
        state.pending = pend.fromStock || null;
        state.phase = pend.fromStock ? 'stock' : 'waiting_roll';
        return;
      }
      for (const item of pend.items) {
        const st = state.stocks[item.cityId];
        const from = playerById(state, pend.fromId);
        const held = st.holders[pend.fromId] || 0;
        const take = Math.min(item.shares, held, 1);
        if (take > 0) {
          st.holders[pend.fromId] = held - take;
          playerById(state, pend.fromId).stocks[item.cityId] = Math.max(0, (playerById(state, pend.fromId).stocks[item.cityId] || 0) - take);
          const to = target;
          const city = state.cities[item.cityId];
          if (city.ownerId === to.id && (st.holders[to.id] || 0) + take > 1) return;
          st.holders[to.id] = (st.holders[to.id] || 0) + take;
          to.stocks[item.cityId] = (to.stocks[item.cityId] || 0) + take;
        }
      }
      if (pend.cash > 0) {
        if (target.cash < pend.cash) return;
        target.cash -= pend.cash;
        playerById(state, pend.fromId).cash += pend.cash;
      }
      log(events, `股票转让完成`, 'stock');
    } else {
      log(events, `股票转让被拒绝`);
    }
    state.pending = pend.fromStock || null;
    state.phase = pend.fromStock ? 'stock' : 'waiting_roll';
    return;
  }
  // 发起转让
  if (p.transferDone) return; // 每回合至多一笔
  if (action.items.length > 3) return;
  for (const it of action.items) if (it.shares > 1 || it.shares <= 0) return;
  const fromStock = state.pending && state.pending.kind === 'go_stock' ? state.pending : null;
  p.transferDone = true;
  state.pending = { type: 'trade_confirm', fromId: p.id, targetId: action.targetId, items: action.items, cash: action.cash || 0, fromStock };
  state.phase = 'trade_confirm';
  log(events, `${p.name} 发起股票转让，等待 ${target.name} 确认`, 'stock');
}

function enforceOwnerStockCap(state, p, cityId, events) {
  const st = state.stocks[cityId];
  const held = st.holders[p.id] || 0;
  if (held > 4) {
    const extra = held - 4;
    p.cash += extra * st.price;
    st.holders[p.id] = 4;
    p.stocks[cityId] = 4;
    log(events, `${p.name} 超持 ${cityLabel(state, cityId)} 股份（上限 4 股），强制卖出 ${extra} 股`, 'stock');
  }
}

// ---------- 回合结束 ----------

function endTurn(state, events, rng) {
  const p = currentPlayer(state);
  if (p) {
    p.consecutiveDoubles = 0;
  }
  advanceTurn(state, events, rng);
}

module.exports = {
  apply,
  advanceTurn,
  endTurn,
  currentPlayer,
  cityTotalValue,
  rentFor,
  refundFor,
  mortgageValue,
  nearestPrevJail,
  START_CASH,
  JAIL_FINE,
  FREEZE_FINE,
  AIRPORT_PRICE,
};
