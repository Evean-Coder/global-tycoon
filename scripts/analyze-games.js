'use strict';

// 对局数据批量分析工具
// 用法：
//   node scripts/analyze-games.js                    # 汇总 records/ 下所有对局
//   node scripts/analyze-games.js <目录>             # 指定记录目录
//   node scripts/analyze-games.js --detail <文件>    # 查看单局完整事件

const fs = require('fs');
const path = require('path');
const { CITIES } = require('../src/board');

const args = process.argv.slice(2);
const detailIdx = args.indexOf('--detail');
if (detailIdx !== -1) {
  const file = args[detailIdx + 1];
  if (!file) { console.error('请指定对局记录文件路径'); process.exit(1); }
  printDetail(path.resolve(file));
  process.exit(0);
}

const dir = args[0] ? path.resolve(args[0]) : path.join(process.cwd(), 'records');
const files = fs.existsSync(dir)
  ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => path.join(dir, f))
  : [];

if (!files.length) {
  console.log('未找到对局记录。');
  console.log('对局结束后，房主可在结算界面点击「下载对局数据」，把 JSON 文件放进 ' + dir);
  process.exit(0);
}

const records = [];
for (const f of files) {
  try {
    const r = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (r && r.schema && r.schema.indexOf('global-tycoon.game-record') === 0) records.push(r);
    else console.warn('跳过非对局记录文件: ' + path.basename(f));
  } catch (e) {
    console.warn('跳过无法解析的文件: ' + path.basename(f));
  }
}

if (!records.length) { console.log('目录中没有可用的对局记录。'); process.exit(0); }

const merged = {
  eventCount: 0,
  endReason: {},
  rounds: [],
  duration: [],
  bankruptcies: 0,
  surrenders: 0,
  chanceDraws: 0,
  jailEntries: 0,
  auctions: 0,
  rentsPaid: 0,
  mortgageEvents: 0,
  cityPurchases: {},
};

for (const r of records) {
  const s = r.stats || {};
  merged.eventCount += s.eventCount || 0;
  merged.endReason[r.endReason || 'unknown'] = (merged.endReason[r.endReason || 'unknown'] || 0) + 1;
  merged.rounds.push(r.rounds || 0);
  if (r.startedAt && r.endedAt) merged.duration.push((r.endedAt - r.startedAt) / 60000);
  merged.bankruptcies += s.bankruptcies || 0;
  merged.surrenders += s.surrenders || 0;
  merged.chanceDraws += s.chanceDraws || 0;
  merged.jailEntries += s.jailEntries || 0;
  merged.auctions += s.auctions || 0;
  merged.rentsPaid += s.rentsPaid || 0;
  merged.mortgageEvents += s.mortgageEvents || 0;
  for (const cid of Object.keys(s.cityPurchases || {})) {
    merged.cityPurchases[cid] = (merged.cityPurchases[cid] || 0) + s.cityPurchases[cid];
  }
}

const avg = (arr) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 10) / 10 : 0;

console.log('========== 对局数据汇总 ==========');
console.log('记录文件：' + records.length + ' 份，总事件：' + merged.eventCount + ' 条');
console.log('');
console.log('结束方式分布：');
for (const k of Object.keys(merged.endReason)) {
  const label = k === 'disband' ? '中途解散' : k === 'normal' ? '正常结束' : k;
  console.log('  ' + label + ': ' + merged.endReason[k] + ' 局');
}
console.log('');
console.log('平均回合数：' + avg(merged.rounds) + ' 轮（各局: ' + merged.rounds.join(', ') + '）');
if (merged.duration.length) console.log('平均时长：' + avg(merged.duration) + ' 分钟');
console.log('');
console.log('关键动作合计：');
console.log('  破产: ' + merged.bankruptcies + ' | 认输: ' + merged.surrenders);
console.log('  机会卡抽取: ' + merged.chanceDraws + ' | 入狱: ' + merged.jailEntries);
console.log('  拍卖: ' + merged.auctions + ' | 租金支付: ' + merged.rentsPaid + ' | 抵押相关事件: ' + merged.mortgageEvents);
console.log('');
const topCities = Object.keys(merged.cityPurchases).sort((a, b) => merged.cityPurchases[b] - merged.cityPurchases[a]);
console.log('城市交易热度（购买/拍得/直接购入次数，共 ' + topCities.length + ' 座有交易）：');
topCities.slice(0, 10).forEach((cid, i) => {
  const c = CITIES[cid] || {};
  console.log('  ' + (i + 1) + '. ' + (c.country || '') + '·' + cid + ' x ' + merged.cityPurchases[cid]);
});
if (!topCities.length) console.log('  （暂无城市成交记录）');
console.log('');
console.log('========== 单局明细 ==========');
records.forEach((r, i) => {
  const label = r.endReason === 'disband' ? '解散' : r.endReason === 'normal' ? '正常' : r.endReason;
  const time = r.startedAt ? new Date(r.startedAt).toLocaleString('zh-CN') : '-';
  const winner = r.players && r.winner ? (r.players.find((p) => p.id === r.winner) || {}).name : '-';
  console.log('[' + (i + 1) + '] 房间 ' + r.roomCode + ' | ' + time + ' | ' + label + ' | ' + (r.players ? r.players.length : 0) + ' 人 | ' + (r.rounds || 0) + ' 轮 | 事件 ' + (r.events ? r.events.length : 0) + ' 条 | 赢家: ' + winner);
});

function printDetail(file) {
  let r;
  try {
    r = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error('无法解析文件: ' + file);
    process.exit(1);
  }
  console.log('房间: ' + r.roomCode + ' | 开始: ' + new Date(r.startedAt).toLocaleString('zh-CN') + ' | 结束: ' + new Date(r.endedAt).toLocaleString('zh-CN'));
  console.log('结束方式: ' + r.endReason + ' | 回合数: ' + r.rounds + ' | 赢家: ' + (r.players || []).map((p) => p.id + '=' + p.name).join(', '));
  console.log('');
  for (const p of r.players || []) {
    console.log('玩家 ' + p.name + ' | 现金 ' + p.cash + ' | 总资产 ' + p.totalAssets + ' | 城市 ' + p.cities.map((c) => c.country + '·' + c.id + (c.houseLevel ? '(房' + c.houseLevel + ')' : '') + (c.mortgaged ? '(抵)' : '')).join(', ') + ' | 机场 ' + p.airports.join(', ') + ' | 股票 ' + JSON.stringify(p.stocks));
  }
  console.log('');
  for (const e of r.events || []) {
    console.log('#' + e.id + ' [' + (e.type || 'log') + '] ' + (e.text || ''));
  }
}
