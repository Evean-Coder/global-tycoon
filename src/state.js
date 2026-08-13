'use strict';

const { buildBoard, buildChanceDeck } = require('./board');
const { createRng, shuffle } = require('./random');

const START_CASH = 150000;
const PLAYER_COLORS = ['#e53935', '#1e88e5', '#43a047', '#fdd835'];

function createPlayer(name, seat, id) {
  return {
    id,
    name,
    seat,
    color: PLAYER_COLORS[seat % PLAYER_COLORS.length],
    cash: START_CASH,
    position: 0,
    alive: true,
    jailed: false,
    jailTurns: 0,
    frozen: false,
    cities: [],
    airports: [],
    stocks: {}, // cityId -> shares
    lapBuys: 0, // 一圈（起点到起点）内购买城市数
    lapDone: false, // 本圈是否已经过起点
    connected: true,
    reconnectToken: null,
  };
}

function createGameState(roomCode, playerNames) {
  const players = playerNames.map((name, i) => createPlayer(name, i, `p${i}`));
  const board = buildBoard();
  const cities = {};
  for (const sq of board) {
    if (sq.type === 'city') {
      cities[sq.cityId] = { id: sq.cityId, name: sq.cityId, country: require('./board').CITIES[sq.cityId].country, continent: require('./board').CITIES[sq.cityId].continent, ownerId: null, houseLevel: 0, mortgaged: false, price: sq.price, group: sq.group };
    }
  }
  const airports = {};
  for (const sq of board) {
    if (sq.type === 'airport') {
      airports[sq.airportId] = { id: sq.airportId, ownerId: null };
    }
  }
  const stocks = {};
  for (const cityId of Object.keys(cities)) {
    stocks[cityId] = { price: Math.round((cities[cityId].price / 10) * 2), holders: {} };
  }
  return {
    roomCode,
    status: 'playing',
    players,
    board,
    cities,
    airports,
    stocks,
    chanceDeck: buildChanceDeck(),
    firstRoundDone: false, // 第一轮（每个玩家从起点出发回到起点一次）是否结束；结束前禁止购买房产与机场
    turnIndex: 0,
    phase: 'waiting_roll',
    pending: null, // 当前等待决策
    dice: null,
    diceBag: [], // 骰子洗牌袋（1–10 各一张，抽完重洗）
    rounds: 0,
    rank: [],
    winner: null,
    rngSeed: Math.floor(Math.random() * 1e9),
    startedAt: Date.now(),
  };
}

// 对外快照：剔除敏感字段
function snapshot(state) {
  return JSON.parse(JSON.stringify(state, (key, value) => (key === 'reconnectToken' ? undefined : value)));
}

function resetDeck(state, rng) {
  state.chanceDeck = shuffle(state.chanceDeck, rng);
}

module.exports = { createGameState, snapshot, resetDeck, START_CASH };
