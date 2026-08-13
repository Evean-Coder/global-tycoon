'use strict';
const fs = require('fs');
// 服务端 rentFor
let g = fs.readFileSync('C:/Users/Yifan/Desktop/game/src/gameLogic.js', 'utf8');
const og = "function rentFor(city) {\n  return city.price * (0.3 + 0.3 * city.houseLevel);\n}";
const ng = "function rentFor(city) {\n  let rent = city.price * (0.3 + 0.3 * city.houseLevel);\n  if (city.houseLevel >= 4 && city.price >= 15000) rent *= 1.1; // 高价城满级租金 +10%\n  return Math.round(rent);\n}";
if (g.indexOf(og) < 0) { console.error('server rentFor not found'); process.exit(1); }
g = g.split(og).join(ng);
fs.writeFileSync('C:/Users/Yifan/Desktop/game/src/gameLogic.js', g, 'utf8');
// 前端 rentFor（显示一致）
let c = fs.readFileSync('C:/Users/Yifan/Desktop/game/public/client.js', 'utf8');
const oc = "function rentFor(city) { return Math.round(city.price * (0.3 + 0.3 * (city.houseLevel || 0))); }";
const nc = "function rentFor(city) { let r = Math.round(city.price * (0.3 + 0.3 * (city.houseLevel || 0))); if ((city.houseLevel || 0) >= 4 && city.price >= 15000) r = Math.round(r * 1.1); return r; }";
if (c.indexOf(oc) < 0) { console.error('client rentFor not found'); process.exit(1); }
c = c.split(oc).join(nc);
fs.writeFileSync('C:/Users/Yifan/Desktop/game/public/client.js', c, 'utf8');
// 规则速查
const oq = "租金 = 地价 ×（30% + 房屋等级 × 30%）";
const nq = "租金 = 地价 ×（30% + 房屋等级 × 30%）；地价 ≥15000 的城市满级租金 +10%";
if (c.indexOf(oq) < 0) { console.error('rules rent pattern not found'); process.exit(1); }
c = c.split(oq).join(nq);
fs.writeFileSync('C:/Users/Yifan/Desktop/game/public/client.js', c, 'utf8');
console.log('patched');