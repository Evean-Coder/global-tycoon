async page => {
  const out = {};
  // 1) build_decide 弹窗
  out.build = await page.evaluate(() => {
    me.gameId = 'p0'; awaitingPlayerId = 'p0';
    game = {
      phase: 'build_decide', pending: { playerId: 'p0', cityId: '罗马', kind: 'build' },
      players: [{ id: 'p0', name: 'A', cash: 100000, alive: true, cities: ['罗马'], airports: [], stocks: {}, position: 12 }],
      cities: { '罗马': { price: 12000, houseLevel: 1, ownerId: 'p0', country: '意大利' } },
      stocks: {}, board: [],
    };
    renderPending();
    return { visible: !document.getElementById('modal').classList.contains('hidden'), title: document.getElementById('modalTitle').textContent, body: document.getElementById('modalBody').innerText.slice(0, 300) };
  });
  // 2) buy 资金不足 → 募集资金/取消购买
  out.buyPoor = await page.evaluate(() => {
    game = {
      phase: 'buy', pending: { playerId: 'p0', cityId: '罗马' },
      players: [{ id: 'p0', name: 'A', cash: 5000, alive: true, cities: [], airports: [], stocks: {}, position: 12 }],
      cities: { '罗马': { price: 12000, houseLevel: 0, ownerId: null, country: '意大利' } },
      stocks: {}, board: [],
    };
    renderPending();
    return { visible: !document.getElementById('modal').classList.contains('hidden'), title: document.getElementById('modalTitle').textContent, body: document.getElementById('modalBody').innerText.slice(0, 300) };
  });
  // 3) buy_fundraise 弹窗
  out.fundraise = await page.evaluate(() => {
    game = {
      phase: 'buy_fundraise', pending: { playerId: 'p0', kind: 'buy_fundraise', target: { kind: 'city', cityId: '罗马' } },
      players: [{ id: 'p0', name: 'A', cash: 8000, alive: true, cities: ['巴黎'], airports: [], stocks: {}, position: 12 }],
      cities: {
        '罗马': { price: 12000, houseLevel: 0, ownerId: null, country: '意大利' },
        '巴黎': { price: 13000, houseLevel: 1, ownerId: 'p0', country: '法国', mortgaged: false },
      },
      stocks: {}, board: [],
    };
    renderPending();
    return { visible: !document.getElementById('modal').classList.contains('hidden'), title: document.getElementById('modalTitle').textContent, body: document.getElementById('modalBody').innerText.slice(0, 400) };
  });
  // 4) buy_airport 资金不足
  out.airportPoor = await page.evaluate(() => {
    game = {
      phase: 'buy_airport', pending: { playerId: 'p0', airportId: '开罗国际机场' },
      players: [{ id: 'p0', name: 'A', cash: 9000, alive: true, cities: [], airports: [], stocks: {}, position: 6 }],
      cities: {}, stocks: {}, board: [],
    };
    renderPending();
    return { visible: !document.getElementById('modal').classList.contains('hidden'), title: document.getElementById('modalTitle').textContent, body: document.getElementById('modalBody').innerText.slice(0, 300) };
  });
  return out;
}
