'use strict';

// 42 格布局（0 起点，顺时针）
const LAYOUT = [
  ['start', '起点'],
  ['city', '内罗毕'], ['city', '开普敦'], ['chance'], ['city', '卡萨布兰卡'], ['city', '开罗'],
  ['airport', '开罗国际机场'],
  ['chance'],
  ['city', '奥克兰'], ['city', '悉尼'],
  ['rest'],
  ['jail', '监狱'],
  ['city', '罗马'], ['city', '阿姆斯特丹'],
  ['pole', '南极'],
  ['chance'],
  ['airport', '伦敦希思罗国际机场'],
  ['city', '伦敦'], ['city', '巴黎'],
  ['chance'],
  ['city', '柏林'],
  ['jail', '监狱'],
  ['city', '莫斯科'],
  ['rest'],
  ['airport', '纽约肯尼迪国际机场'],
  ['city', '纽约'],
  ['chance'],
  ['city', '多伦多'], ['city', '墨西哥城'], ['city', '里约热内卢'],
  ['chance'],
  ['rest'],
  ['jail', '监狱'],
  ['chance'],
  ['pole', '北极'],
  ['airport', '上海浦东国际机场'],
  ['city', '上海'], ['city', '东京'], ['city', '新加坡'], ['city', '迪拜'],
  ['chance'],
  ['rest'],
];

// 城市表：名称 → 国家/大洲/色组/地价
const CITIES = {
  内罗毕: { country: '肯尼亚', continent: '非洲', group: '黄', price: 3600 },
  开普敦: { country: '南非', continent: '非洲', group: '黄', price: 7200 },
  卡萨布兰卡: { country: '摩洛哥', continent: '非洲', group: '黄', price: 4800 },
  开罗: { country: '埃及', continent: '非洲', group: '黄', price: 6000 },
  奥克兰: { country: '新西兰', continent: '大洋洲', group: '紫', price: 8400 },
  悉尼: { country: '澳大利亚', continent: '大洋洲', group: '紫', price: 10800 },
  罗马: { country: '意大利', continent: '欧洲', group: '紫', price: 12000 },
  阿姆斯特丹: { country: '荷兰', continent: '欧洲', group: '紫', price: 10000 },
  莫斯科: { country: '俄罗斯', continent: '欧洲', group: '绿', price: 11000 },
  伦敦: { country: '英国', continent: '欧洲', group: '绿', price: 14000 },
  巴黎: { country: '法国', continent: '欧洲', group: '绿', price: 13000 },
  柏林: { country: '德国', continent: '欧洲', group: '绿', price: 15000 },
  纽约: { country: '美国', continent: '美洲', group: '蓝', price: 19000 },
  多伦多: { country: '加拿大', continent: '美洲', group: '蓝', price: 14000 },
  墨西哥城: { country: '墨西哥', continent: '美洲', group: '蓝', price: 12000 },
  里约热内卢: { country: '巴西', continent: '美洲', group: '蓝', price: 13000 },
  新加坡: { country: '新加坡', continent: '亚洲', group: '红', price: 14000 },
  东京: { country: '日本', continent: '亚洲', group: '红', price: 17000 },
  迪拜: { country: '阿联酋', continent: '亚洲', group: '红', price: 15000 },
  上海: { country: '中国', continent: '亚洲', group: '红', price: 20000 },
};

const AIRPORTS = {
  开罗国际机场: { name: '开罗国际机场', adjacentCity: '开罗' },
  伦敦希思罗国际机场: { name: '伦敦希思罗国际机场', adjacentCity: '伦敦' },
  纽约肯尼迪国际机场: { name: '纽约肯尼迪国际机场', adjacentCity: '纽约' },
  上海浦东国际机场: { name: '上海浦东国际机场', adjacentCity: '上海' },
};

// 机会卡组（40 张）
function buildChanceDeck() {
  const deck = [];
  const reward = [
    [8000, 1, ['环球市长奖']],
    [6000, 2, ['世博中奖', '最佳城市投资奖']],
    [4000, 4, ['投资分红', '遗产继承', '慈善拍卖收益', '房产升值']],
    [2000, 8, ['街头艺演', '彩票小奖', '亲友红包', '退税返还', '捡到钱包', '兼职导游', '广告代言', '发现宝藏']],
  ];
  const fine = [
    [8000, 1, ['税务稽查']],
    [6000, 2, ['古迹修缮', '违规施工']],
    [4000, 4, ['超速罚款', '噪音扰民', '违章改建', '拖欠物业费']],
    [2000, 8, ['停车费', '乱扔垃圾', '违规摆摊', '宠物随地便溺', '破坏公共设施', '逾期交通罚单', '违规鸣笛', '遗失证照补办']],
  ];
  for (const [amount, , names] of reward) {
    for (const name of names) deck.push({ type: 'reward', amount, name });
  }
  for (const [amount, , names] of fine) {
    for (const name of names) deck.push({ type: 'fine', amount, name });
  }
  for (let i = 0; i < 3; i++) deck.push({ type: 'move', delta: 3, name: '前进 3 格' });
  for (let i = 0; i < 3; i++) deck.push({ type: 'move', delta: -3, name: '后退 3 格' });
  for (let i = 0; i < 3; i++) deck.push({ type: 'move', delta: 0, toStart: true, name: '移动到起点' });
  deck.push({ type: 'jail', name: '直接入狱' });
  return deck;
}

function buildBoard() {
  const squares = LAYOUT.map((entry, id) => {
    const [type, name] = entry;
    const sq = { id, type };
    if (name !== undefined) sq.name = name;
    if (type === 'city') {
      sq.cityId = name;
      sq.price = CITIES[name].price;
      sq.group = CITIES[name].group;
    }
    if (type === 'airport') sq.airportId = name;
    return sq;
  });
  return squares;
}

module.exports = { buildBoard, buildChanceDeck, CITIES, AIRPORTS, LAYOUT };
