'use strict';

// 对局数据记录：对局结束后生成一份可离线分析的 JSON 记录
const { CITIES } = require('./board');
const { cityTotalValue } = require('./gameLogic');

const AIRPORT_VALUE = 15000;

function totalAssetsOf(state, p) {
  let v = p.cash;
  for (const id of p.cities) v += cityTotalValue(state.cities[id]);
  v += (p.airports || []).length * AIRPORT_VALUE;
  for (const cid of Object.keys(p.stocks || {})) v += (p.stocks[cid] || 0) * state.stocks[cid].price;
  return v;
}

// 从事件文本解析出「国家·城市」对应的城市 key
function cityKeyOf(text) {
  for (const name of Object.keys(CITIES)) {
    if (text.indexOf(CITIES[name].country + '·' + name) !== -1) return name;
  }
  return null;
}

function computeStats(state, events) {
  const stats = {
    eventCount: events.length,
    byType: {},
    bankruptcies: 0,
    surrenders: 0,
    chanceDraws: 0,
    auctions: 0,
    rentsPaid: 0,
    jailEntries: 0,
    mortgageEvents: 0,
    cityPurchases: {}, // cityId -> 购买/拍卖/直接出售成交次数
    cityRentPayments: {}, // cityId -> 租金支付次数
  };
  for (const e of events) {
    const t = e.type || 'log';
    stats.byType[t] = (stats.byType[t] || 0) + 1;
    const text = e.text || '';
    if (t === 'bankrupt') {
      if (text.indexOf('认输') !== -1) stats.surrenders++;
      else stats.bankruptcies++;
    } else if (t === 'chance') stats.chanceDraws++;
    else if (t === 'auction') stats.auctions++;
    else if (t === 'rent') {
      stats.rentsPaid++;
      const ck = cityKeyOf(text);
      if (ck) stats.cityRentPayments[ck] = (stats.cityRentPayments[ck] || 0) + 1;
    } else if (t === 'jail' && (text.indexOf('被关押') !== -1 || text.indexOf('直接入狱') !== -1)) {
      stats.jailEntries++;
    }
    const bought = text.indexOf('购买') !== -1
      && text.indexOf('放弃购买') === -1
      && text.indexOf('无法购买') === -1
      && text.indexOf('不能购买') === -1
      && text.indexOf('取消购买') === -1
      && text.indexOf('可选择购买') === -1;
    const won = text.indexOf('获得') !== -1;
    if ((t === 'buy' && bought) || (t === 'auction' && won) || (t === 'sale' && bought)) {
      const ck = cityKeyOf(text);
      if (ck) stats.cityPurchases[ck] = (stats.cityPurchases[ck] || 0) + 1;
    }
    if (text.indexOf('抵押') !== -1) stats.mortgageEvents++;
  }
  return stats;
}

function buildGameRecord(room, endReason) {
  const st = room.state;
  const record = {
    schema: 'global-tycoon.game-record.v1',
    roomCode: room.code,
    startedAt: st.startedAt,
    endedAt: Date.now(),
    endReason,
    rounds: st.rounds || 0,
    winner: st.winner || null,
    rank: st.rank || [],
    players: st.players.map((p) => ({
      id: p.id,
      name: p.name,
      seat: p.seat,
      color: p.color,
      alive: p.alive,
      cash: p.cash,
      totalAssets: totalAssetsOf(st, p),
      cities: p.cities.map((cid) => {
        const c = st.cities[cid];
        return {
          id: cid,
          country: c.country,
          continent: c.continent,
          price: c.price,
          houseLevel: c.houseLevel,
          mortgaged: c.mortgaged,
          mortgageInterest: c.mortgageInterest || 0,
        };
      }),
      airports: (p.airports || []).slice(),
      stocks: Object.keys(st.stocks).reduce((acc, cid) => {
        const n = st.stocks[cid].holders[p.id] || 0;
        if (n > 0) acc[cid] = n;
        return acc;
      }, {}),
    })),
    events: room.events.map((e) => Object.assign({}, e)),
    stats: computeStats(st, room.events),
  };
  return record;
}

module.exports = { buildGameRecord, computeStats, totalAssetsOf };
