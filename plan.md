# 环球大亨联机游戏 Plan（技术设计）

## 架构概览

- 单 Node.js 服务：Express 托管静态前端页面，Socket.IO 提供实时通信与房间管理。
- 服务端权威：所有规则逻辑（掷骰、移动、结算、交易、股票、破产等）只在服务端执行；客户端只发送操作指令、渲染服务端广播的完整状态。
- 前端使用原生 HTML/CSS/JS，无构建步骤；`npm install && npm start` 后浏览器打开 `http://localhost:3000` 即可游玩。
- 纯逻辑层（`src/`）与网络层（`server.js`）分离，规则引擎为无 I/O 的纯函数，便于单元测试。
- 对局状态保存在内存中（v1 不落地数据库，进程重启即清空）；单实例部署。

## 核心技术决策

### 方案对比

| 方案 | 说明 | 优点 | 缺点 |
|------|------|------|------|
| A（选定）：Node.js + Express + Socket.IO + 原生前端 | 单服务、无构建 | 简单、生态成熟、联机/重连能力强、易部署 | 前端无组件化框架 |
| B：Node + React/Vite + Socket.IO | 组件化前端 | 界面组织更清晰 | 引入构建与依赖链 |
| C：Unity WebGL | 游戏引擎 | 画面与动画强 | 开发重、联机与部署复杂 |

选 A 的理由：规则复杂度主要在服务端逻辑；原生前端足以承载棋盘与操作面板，且最符合「本地一条命令启动、可部署公网」的目标。

### 关键决策

- **全量状态广播**：对局状态体量小（42 格、最多 4 人），每次变更后广播完整 JSON，保证所有客户端一致，实现简单可靠。
- **随机源注入**：骰子、机会卡洗牌、股价波动通过可注入的随机函数生成，测试时可固定随机序列复现场景。
- **断线重连**：Socket 断开 → 服务端生成一次性重连令牌、对局暂停；重连凭「房间码 + 昵称 + 令牌」校验后恢复订阅。
- **倒计时调度**：服务端驱动计时（主行动 90 秒、子流程 60 秒），超时由服务端自动执行默认动作。
- **回合状态机**：服务端维护明确的阶段（phase），每个动作校验「当前阶段 + 当前行动玩家 + 合法性」。

## 模块划分

### server.js

职责：HTTP 与 Socket.IO 入口；房间创建/加入/开始/解散；连接与重连；事件路由；倒计时调度；广播。

### src/board.js

职责：棋盘常量与静态数据——42 格布局（起点/城市/机场/机会卡/入狱/极地/休闲）、20 座城市表（国家/大洲/色组/地价）、4 座机场、机会卡组（40 张卡：奖励 15、罚款 15、位移 9、入狱 1）。

### src/gameLogic.js

职责：纯规则引擎。输入 `(state, action, rng)` → 输出 `(newState, events)`，覆盖：回合流转、移动与起点结算、收租与股票抵扣、购买、建房/拆房、直接出售/拍卖、抵押与利息、破产与认输、机场（费用/飞行）、极地（冰冻/救援）、监狱（入狱/出狱）、机会卡（抽卡/位移/入狱）、股票（买卖/转让/股息/股价联动）。

### src/state.js

职责：房间与对局状态的容器与序列化——创建初始状态、应用动作结果、生成对外广播快照。

### src/random.js

职责：随机源封装（掷骰、洗牌、波动），生产使用真随机，测试注入固定序列。

### public/（前端）

- `index.html`：大厅、房间、棋盘、操作面板、股票面板、规则图鉴的页面骨架。
- `style.css`：响应式布局与简洁几何风主题（后续替换 AI 素材）。
- `client.js`：Socket.IO 客户端——渲染棋盘与玩家状态、发送操作、展示事件与倒计时。

### test/

单元测试：`gameLogic.test.js`（规则引擎）、`board.test.js`（棋盘与卡组数据）、`stock.test.js`（股票规则）。使用 Node 内置 `node --test`。

## 核心数据结构

### BoardSquare

```js
{ id: 0..41, type: 'start'|'city'|'airport'|'chance'|'jail'|'pole'|'rest',
  name?, cityId?, price?, group? }
```

### City

```js
{ id, name, country, continent, group, price, ownerId|null, houseLevel 0..4, mortgaged bool }
```

### Airport

```js
{ id, name, ownerId|null }
```

### Player

```js
{ id, socketId, name, seat, color, cash, position,
  alive, jailed, jailTurns, frozen,
  properties: CityId[], airports: AirportId[],
  stocks: { cityId: shares },
  connected, reconnectToken }
```

### Stock

```js
{ cityId, price, holders: { playerId: shares }, totalShares: 10 }
```

### GameState

```js
{ roomCode, status: 'lobby'|'playing'|'over',
  players[], board[], cities, airports, stocks,
  chanceDeck, turnIndex, phase, dice, currentAction,
  winner, rank[], createdAt }
```

### phase 状态机（服务端）

`WAITING_ROLL → MOVING → RESOLVING_SQUARE → AWAIT_BUY / AWAIT_RENT / AWAIT_CHANCE / AWAIT_AIRPORT / AWAIT_POLE / AWAIT_JAIL / AWAIT_GO_STOCK → AWAIT_SELF_RESCUE → AWAIT_DIRECT_SALE / AWAIT_AUCTION → END_TURN → GAME_OVER`

每个阶段记录 `currentAction`（等待的决策对象：购买确认、拍卖出价、飞行选择、股票交易、自救选择等），60 秒子流程超时由服务端按默认动作推进。

## 接口（Socket 事件）

### 客户端 → 服务端

| 事件 | 参数 | 对应需求 |
|------|------|----------|
| `createRoom` | `{ name }` | F1 |
| `joinRoom` | `{ roomCode, name }` | F1 |
| `reconnect` | `{ roomCode, name, token }` | F11 |
| `startGame` | `{}` | F1 |
| `rollDice` | `{}` | F2 |
| `respondBuy` | `{ decision: 'buy'|'pass' }` | F3 |
| `respondJail` | `{ decision: 'pay'|'roll' }` | F7 |
| `buildHouse` / `demolishHouse` | `{ cityId }` | F5 |
| `chooseFlight` | `{ targetAirportId } | null` | F13 |
| `buyAirport` | `{ decision }` | F13 |
| `mortgage` / `redeem` | `{ cityId }` | F15 |
| `sellCity` | `{ cityId, mode: 'direct'|'auction' }` | F8/F9 |
| `directSaleRespond` | `{ decision: 'buy'|'pass' }` | F8 |
| `auctionRespond` | `{ decision: 'bid'|'pass', amount? }` | F8 |
| `stockTrade` | `{ orders: [{ cityId, side: 'buy'|'sell', shares }] }` | F14 |
| `stockTransfer` | `{ targetId, items: [{ cityId, shares }], cash }` | F14 |
| `selfRescue` | `{ actions: [...] , done: bool }` | F4/F10 |
| `surrender` | `{}` | F10 |
| `disbandRoom` | `{}` | F11 |

### 服务端 → 客户端

| 事件 | 内容 |
|------|------|
| `roomState` | 大厅/房间状态（成员、房主、就绪） |
| `gameState` | 完整对局状态快照（每次变更广播） |
| `timerStarted` | `{ phase, seconds }` |
| `event` | 事件提示（收租、抽卡、入狱、冻结、结算等） |
| `error` | 非法操作提示 |

## 模块交互与数据流

```
client 操作 → server 校验阶段/玩家 → gameLogic(纯函数) → newState + events
  → state.js 更新房间 → 全量广播 gameState → 各客户端渲染
```

- 房间与连接生命周期由 `server.js` 管理；规则执行完全走 `gameLogic`，网络层不内联业务规则。
- 拍卖/交易等多人交互由服务端维护 `currentAction`，逐轮等待并校验。
- 倒计时由服务端统一调度，超时走与玩家操作相同的动作入口。

## 文件组织

```
project/
├── package.json
├── server.js
├── src/
│   ├── board.js
│   ├── gameLogic.js
│   ├── state.js
│   └── random.js
├── public/
│   ├── index.html
│   ├── style.css
│   └── client.js
└── test/
    ├── board.test.js
    ├── gameLogic.test.js
    └── stock.test.js
```

## 技术决策表

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 后端框架 | Express | 轻量、静态托管 |
| 实时通信 | Socket.IO | 房间、广播、重连成熟 |
| 前端 | 原生 HTML/CSS/JS | 无构建步骤、易部署 |
| 状态同步 | 全量广播 | 状态小、一致性强 |
| 存储 | 内存 | v1 不落地，重启清空 |
| 随机 | 注入随机源 | 测试可复现 |
| 测试 | node --test | 内置、零依赖 |
| 部署 | 本地运行 + 免费托管（Render 免费层，备选 Railway） | 开发期本地/内网穿透；正式用免费层，避免付费 |
| 断线 | 一次性令牌重连 | 防冒用、暂停恢复 |

## 测试策略

- 单元测试（`node --test`）：回合流转、移动与起点结算、收租与抵扣、购买、建房/拆房、直接出售/拍卖、抵押与利息、破产与认输、机场、极地、监狱、机会卡洗牌、股票买卖/转让/股息/股价联动。
- 集成验证：两个浏览器客户端模拟完整对局，对照 AC1–AC25。
- 边界用例：满员拒绝、非当前玩家操作拒绝、资金不足自救组合、拍卖流拍、断线重连令牌、倒计时超时默认动作。

## spec 覆盖对照

- F1/F11 → server.js（房间、断线重连）
- F2/F3/F4/F5/F6/F7/F10/F13 → gameLogic.js 对应规则
- F8/F9/F15 → gameLogic.js（城市交易、抵押）
- F12/F14 → gameLogic.js + 前端渲染
- F13 → gameLogic.js（机场）+ board.js（机场数据）
- N1 → 前端响应式布局；N2 → 美术素材替换；N3 → 全量状态广播；N4 → 单服务部署；N5 → 简体中文文案；N6 → 规则速查与图鉴页。

## 手机访问方式

- 本地局域网调试：服务端监听 `0.0.0.0`（`server.listen(3000, '0.0.0.0')`）；手机与电脑连同一 WiFi，浏览器打开 `http://电脑局域网IP:3000`（如 192.168.x.x）；必要时在 Windows 防火墙放行 3000 端口。
- 公网访问：部署到免费托管平台（Render 免费层，备选 Railway）后打开公网域名/URL；开发期也可用内网穿透（如 cpolar、ngrok）临时生成公网链接。
- 手机无需安装 App，浏览器直接打开即可（响应式界面，spec N1）。
## 稳定性与架构优化（2026-08-14）

对应 spec 详细规则 16、F18–F20、N7–N9、AC27–AC29。全部改动集中在 server.js 与 scripts/analyze-games.js，不改变 Socket 协议、游戏规则与对局记录 schema。

### 架构概览
- 房间生命周期：每个房间新增闲置计时（idleSince），最后一名在线玩家断开时开始计时，玩家加入/重连时清零；服务器每 60 秒清扫一次空房，到期删除房间并释放资源。
- 数据保全：清扫对局中（未结束）的空房时，先补生成「闲置超时」对局记录并写入 records/ 目录，再删除房间；已结束房间同样在删除前把已生成的对局记录落盘，避免玩家未下载时数据丢失。
- 异常兜底：玩家操作入口与主要 Socket 回调统一捕获异常；进程级 uncaughtException/unhandledRejection 仅记录日志不退出。

### 核心数据结构
- room.idleSince: number | null —— 最后一名在线玩家断开的时间戳；null 表示房间当前有人在线，不参与清扫。
- 常量（server.js）：LOBBY_IDLE_MS=10 分钟、GAME_IDLE_MS=30 分钟、SWEEP_INTERVAL_MS=60 秒。

### 接口
- touchRoom(room): void —— 玩家加入/重连成功时调用，置 idleSince=null。
- shouldSweepRoom(room, now, cfg): boolean —— 纯函数；无人且闲置达到阈值（大厅取 lobbyIdleMs、有对局取 gameIdleMs）返回 true；cfg 可注入阈值。
- sweepRooms(now?, cfg?): void —— 遍历 rooms，对到期房间：对局中先 finalizeGame(room,'idle_timeout')；有 gameRecord 则 persistRecord 落盘；清 action/host 定时器后 rooms.delete。
- persistRecord(record, dir): void —— 写 records/<roomCode>-<startedAt>.json（mkdir recursive，失败仅记日志不阻断清理）。
- safeHandler(fn): (...args)=>void —— 包装 Socket 事件回调，捕获异常并记录日志。
- module.exports 新增导出 shouldSweepRoom、sweepRooms（供测试直接调用）。

### 模块设计
- server.js（修改）：新增 require('fs')；makeRoom 增加 idleSince 字段；disconnect 中全员离线时设置 idleSince；joinRoom/reconnect 调用 touchRoom；runAction 的 logic.apply 包 try/catch（异常时 emit error「操作异常，请重试」并 return）；createRoom/joinRoom/reconnect/startGame/action/disbandRoom 用 safeHandler 包裹；进程级 process.on 兜底；require.main 分支启动 setInterval 清扫。
- scripts/analyze-games.js（修改）：汇总段新增各玩家胜场、冠军平均最终总资产、全员平均最终总资产。
- public/Vintage_antique_world_map_in_s_2026-08-12T12-33-16.png（删除）：与 map-bg.png MD5 相同的未引用副本。
- test/room-sweep.test.js（新建）：覆盖 AC27/AC28。

### 模块交互与数据流
- 掉线：socket disconnect → rp.connected=false → 全员离线则 room.idleSince=Date.now()。
- 恢复：joinRoom/reconnect 成功 → touchRoom → idleSince=null。
- 清扫：setInterval(60s) → sweepRooms() → shouldSweepRoom(room, now) → 到期房间：finalizeGame('idle_timeout')（仅对局中）→ persistRecord → 清定时器 → rooms.delete。
- 异常：action → runAction → logic.apply 抛错 → catch → console.error + socket.emit('error','操作异常，请重试') → 返回，房间状态不变。

### 技术决策
| 决策点 | 选择 | 理由 |
|--------|------|------|
| 清理时限 | 大厅 10 分钟 / 对局与结束 30 分钟 | 用户确认；重连窗口与清理一致 |
| 闲置超时补记录 | 生成 endReason='idle_timeout' 并落盘 records/ | 保证无人对局数据不丢；与分析脚本兼容；AC27 可测 |
| 异常策略 | 捕获并继续 | 用户确认；避免单点异常团灭所有房间 |
| 清扫周期 | 60 秒 | 及时性与开销平衡，无人房间最多晚 60 秒回收 |
| 资产处理 | 只删重复图片，不压缩在用图 | 用户确认；零视觉风险 |
| 分析脚本 | 汇总加胜场与平均资产 | 服务规则平衡迭代；不改 schema |

### spec 覆盖对照
- F18 → idleSince + shouldSweepRoom + sweepRooms + persistRecord（AC27）
- F19 → runAction try/catch + safeHandler + process.on 兜底（AC28）
- F20 → analyze-games.js 汇总输出增强（AC29）
- N7 → 异常兜底；N8 → 清扫机制；N9 → 删除重复背景图

### 文件组织
```
server.js      修改：房间生命周期 + 异常兜底 + 记录落盘
scripts/analyze-games.js  修改：汇总输出增强
public/Vintage_antique_world_map_in_s_2026-08-12T12-33-16.png  删除
test/room-sweep.test.js   新建：清扫与异常兜底测试
spec.md       已更新（规则16 + F18-20 + N7-9 + AC27-29）
checklist.md  验收阶段更新
```