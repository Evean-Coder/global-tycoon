# 环球大亨联机游戏 Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `package.json` | 依赖（express、socket.io）与脚本（start、test） |
| 新建 | `src/board.js` | 棋盘、城市、机场、机会卡静态数据 |
| 新建 | `src/random.js` | 随机源（掷骰/洗牌/波动，可注入） |
| 新建 | `src/state.js` | 对局状态容器与快照 |
| 新建 | `src/gameLogic.js` | 全部规则引擎（纯函数） |
| 新建 | `server.js` | 网络、房间、重连、倒计时、广播 |
| 新建 | `public/index.html`、`public/style.css`、`public/client.js` | 前端 |
| 新建 | `test/board.test.js`、`test/gameLogic.test.js`、`test/stock.test.js` | 单元测试 |

## T1: 项目骨架

**文件：** `package.json`
**依赖：** 无
**步骤：**
1. 初始化 `package.json`：dependencies 含 express、socket.io；scripts：`start = node server.js`、`test = node --test`。
2. 建立 `src/`、`public/`、`test/` 目录。
**验证：** `npm install` 成功；`npm test` 可运行（空测试通过）。

## T2: 棋盘与静态数据

**文件：** `src/board.js`、`test/board.test.js`
**依赖：** T1
**步骤：**
1. 按 spec 规则 2 布局实现 42 格数组（起点/城市/机场/机会卡/入狱/极地/休闲）。
2. 城市表：20 城（国家、大洲、色组、地价，按当前 spec 数值）。
3. 机场 4 座（开罗国际/伦敦希思罗/纽约肯尼迪国际/上海浦东，价格 15000）。
4. 机会卡组 40 张（奖励 15、罚款 15、位移 9、入狱 1，含金额与名称）。
**验证：** 单测断言 42 格、20 城、8 个机会卡格、4 机场、卡组 40 张（15/15/9/1）、入狱格 11/21/32、极地 14/34。

## T3: 随机源

**文件：** `src/random.js`
**依赖：** T1
**步骤：**
1. 提供 `rollDice(rng)`、`shuffle(deck, rng)`、`fluctuate(base, rng)`。
2. 支持注入固定随机序列（测试可复现）。
**验证：** 单测：固定序列下骰子/洗牌/波动结果可复现。

## T4: 状态容器

**文件：** `src/state.js`
**依赖：** T2、T3
**步骤：**
1. `createGameState(players)`：初始资金 100000、位置 0、完整棋盘/城市/机场/股票/卡组。
2. `snapshot(state)`：对外快照（剔除 reconnectToken 等敏感字段）。
**验证：** 单测：初始状态字段完整；快照不含令牌。

## T5: 回合与移动（gameLogic 1）

**文件：** `src/gameLogic.js`、`test/gameLogic.test.js`
**依赖：** T4
**步骤：**
1. 掷骰：双数连掷、连续三次双数入狱（送最近上一个入狱格 11/21/32）。
2. 移动：最终落点为「经过」；途中越过的格不结算（跨起点奖励除外）。
3. 起点结算顺序：① +5000 与名下城市股息 ② 开放股票交易窗口 ③ 跨过则继续结算落点。
**验证：** 单测：移动、跨起点、双数连掷、三次双数入狱、起点顺序。

## T6: 地产与收租（gameLogic 2）

**文件：** `src/gameLogic.js`
**依赖：** T5
**步骤：**
1. 购买/放弃（放弃标记进入拍卖）；租金 = 地价 ×（30% + 等级 × 30%）。
2. 股票抵扣：租金 × min(持股比例 × 2, 100%)，≥50% 免租，银行补足拥有者。
3. 付款不足 → 自救流程（可反复抵押/出售/拆房，凑够或放弃后破产判定）。
**验证：** 单测：租金计算、购买、抵扣、自救组合与破产判定。

## T7: 建房与拆房（gameLogic 3）

**文件：** `src/gameLogic.js`
**依赖：** T6
**步骤：**
1. 经过自有城可选建 1 级 / 拆 1 级；建房 = 地价 × 60%；拆房返还 60%（地价 × 36%）。
2. 空地皮不可拆；资金不足或抵押中不可建/拆；自救场景可随时拆房。
**验证：** 单测：建/拆、返还、限制。

## T8: 城市交易（gameLogic 4）

**文件：** `src/gameLogic.js`
**依赖：** T6
**步骤：**
1. 直接出售：成交价 = 总价值，卖家 80%、银行 20%；租金不足场景所经城市所有者优先购买，其余按座位顺序；仅起点执行（自救例外）。
2. 拍卖：起拍 10%、出价以当前现金为准（竞拍中不可临时抵押/出售）、掷骰定序、加价 ≥500、其余全放弃成交；流拍：破产归银行、自愿出售银行付 50%。
3. 多城同时拍卖按格编号从小到大逐座。
**验证：** 单测：出售、拍卖、三场景流拍、多城顺序。

## T9: 抵押（gameLogic 5）

**文件：** `src/gameLogic.js`
**依赖：** T6
**步骤：**
1. 抵押金 = 总价值 × 50%，同时最多 2 座；每轮结束计息 5%；赎回付本金 + 累计利息。
2. 破产时未赎回抵押城市归银行、债务豁免。
**验证：** 单测：抵押、计息、赎回、破产豁免。

## T10: 机场（gameLogic 6）

**文件：** `src/gameLogic.js`
**依赖：** T5
**步骤：**
1. 购买 15000；机场费 = 3000 × 拥有数；机票费 = 与目标机场最短距离 × 500。
2. 飞行：不触发起点奖励、本回合不再移动；目标无主可购买；所有者免费飞。
**验证：** 单测：购买、费用、飞行与距离计算。

## T11: 极地与监狱（gameLogic 7）

**文件：** `src/gameLogic.js`
**依赖：** T5
**步骤：**
1. 极地：冰冻一回合，支付 5000 解除，放弃则跳过整回合。
2. 监狱：落到 11/21/32 关押；入狱卡/三次双数送最近上一个；掷双数或付 15000 出狱，最多 3 回合；关押期双数不计入连掷计数。
**验证：** 单测：冰冻/救援、入狱/出狱、最近上一个判定。

## T12: 机会卡（gameLogic 8）

**文件：** `src/gameLogic.js`
**依赖：** T5、T11
**步骤：**
1. 抽卡 → 执行 → 放回卡池并重洗；奖励/罚款/位移/入狱行为。
2. 位移卡：移动途中跨起点照发 5000；落点照常结算；落到机会卡格不再抽卡；移动到起点开放股票窗口并触发股息。
**验证：** 单测：卡池行为、位移、入狱卡、股票窗口。

## T13: 股票（gameLogic 9 + stock.test.js）

**文件：** `src/gameLogic.js`、`test/stock.test.js`
**依赖：** T6、T9
**步骤：**
1. 10 股/城，初始价 = 地价 ÷ 10；买卖仅在经过起点（含机会卡移动至起点）：一笔可同时买卖，买入 ≤6 股（≤3 城、单城 ≤2 股），卖出不限。
2. 股价联动 ±10%（上限初始 2 倍）；股息 = 总价值 × 10%（单股东四舍五入、抵押不发、无主归银行）；抵扣 ×2（≥50% 免租）；转让 ≤3 城/单城 1 股；所有者持股 ≤1 股；破产作废。
**验证：** 单测（stock.test.js）覆盖买卖、联动、股息、抵扣、转让、上限。

## T14: 破产/认输/解散（gameLogic 10）

**文件：** `src/gameLogic.js`
**依赖：** T8、T9、T13
**步骤：**
1. 破产：未赎抵押城市归银行、其余拍卖、机场归银行、股票作废、剩余现金归银行。
2. 认输：无需确认，资产直接归银行、不拍卖；解散按总资产排名。
**验证：** 单测：破产资产处理、认输、解散结算。

## T15: 服务器与房间（server.js 1）

**文件：** `server.js`
**依赖：** T1、T4
**步骤：**
1. Express 静态托管 `public/`；Socket.IO 接入。
2. `createRoom` / `joinRoom` / `startGame`；6 位房间码；满 4 人拒绝；`roomState` / `gameState` 广播。
**验证：** 两个浏览器创建/加入/开始对局。

## T16: 事件路由与倒计时（server.js 2）

**文件：** `server.js`
**依赖：** T15、T5–T14
**步骤：**
1. 客户端事件 → 校验（当前阶段 + 当前玩家）→ gameLogic → 广播。
2. `timerStarted`（主行动 90 秒、子流程 60 秒）；超时由服务端执行默认动作。
**验证：** 非当前玩家操作被拒；倒计时显示与超时默认动作生效。

## T17: 断线重连（server.js 3）

**文件：** `server.js`
**依赖：** T16
**步骤：**
1. 断开 → 生成一次性令牌、对局暂停；`reconnect` 校验（房间码 + 昵称 + 令牌）后恢复。
2. 房主转移（10 分钟）；解散房间；结算后回房间可重新开局。
**验证：** 关闭标签页重开恢复；错误令牌被拒。

## T18: 前端-大厅与房间

**文件：** `public/index.html`、`public/style.css`、`public/client.js`
**依赖：** T15
**步骤：**
1. 大厅：昵称输入、创建/加入房间（房间码）。
2. 房间页：成员列表、房主开始按钮。
**验证：** 浏览器完成创建/加入/开始。

## T19: 前端-棋盘渲染

**文件：** `public/index.html`、`public/style.css`、`public/client.js`
**依赖：** T18
**步骤：**
1. 42 格环形棋盘（12×11 布局），色组颜色、图例、南北极同色。
2. 地皮格标注「国家·城市」与当前所有者；机场显示所属城市名。
**验证：** 浏览器渲染与 spec 分布图一致。

## T20: 前端-操作面板与事件

**文件：** `public/index.html`、`public/style.css`、`public/client.js`
**依赖：** T19
**步骤：**
1. 掷骰、购买确认、建房/拆房、交易、拍卖、抵押、股票面板操作。
2. 倒计时显示、事件提示、结算界面。
**验证：** 浏览器完成一轮完整操作。

## T21: 前端-规则图鉴

**文件：** `public/index.html`、`public/style.css`、`public/client.js`
**依赖：** T18
**步骤：**
1. N6 规则速查页；机会卡图鉴（40 张的名称、金额、效果）。
**验证：** 浏览器可查看。

## T22: 响应式适配

**文件：** `public/style.css`、`public/client.js`
**依赖：** T20
**步骤：**
1. 手机窄屏布局可完成掷骰、移动、购买确认。
**验证：** 手机或浏览器窄窗口完整操作一轮。

## T23: 端到端联调

**文件：** 全项目
**依赖：** T17、T20、T21
**步骤：**
1. 两个客户端完整对局；对照 AC1–AC25 抽查关键场景。
2. 局域网手机访问验证（监听 0.0.0.0）。
**验证：** 完整一局无卡死；关键 AC 通过。

## T24: 测试全绿与收尾

**文件：** `test/`、`package.json`、`README.md`
**依赖：** T5–T14、T23
**步骤：**
1. 补齐边界测试（满员、非法操作、流拍、重连令牌、超时）。
2. `npm test` 全绿；README 写启动与局域网访问说明。
**验证：** `node --test` 全部通过。

## T25: server.js 房间闲置计时与清扫
**文件：** `server.js`
**依赖：** 无
**步骤：**
1. 顶部新增 `require('fs')`；新增常量 `LOBBY_IDLE_MS=10*60*1000`、`GAME_IDLE_MS=30*60*1000`、`SWEEP_INTERVAL_MS=60*1000`
2. `makeRoom` 的 room 对象新增 `idleSince: null`
3. 新增函数：`touchRoom(room)`、`shouldSweepRoom(room, now, cfg)`、`sweepRooms(now, cfg)`、`persistRecord(record, dir)`
4. `disconnect` 回调中：置 `rp.connected=false` 后，若 `room.players` 全员离线则 `room.idleSince = room.idleSince || Date.now()`
5. `joinRoom` / `reconnect` 成功路径调用 `touchRoom(room)`
6. `sweepRooms` 清理逻辑：对局中且无 gameRecord 先 `finalizeGame(room,'idle_timeout')`；有 gameRecord 则 `persistRecord` 到 `cfg.recordsDir`（默认 `path.join(__dirname,'records')`）；`clearTimer('action')`、清 hostTimer、`rooms.delete`
7. `require.main` 分支在 `server.listen` 后启动 `setInterval(() => sweepRooms(), SWEEP_INTERVAL_MS)`
8. `module.exports` 增加 `shouldSweepRoom`、`sweepRooms`
**验证：** `node --check server.js` 通过；行为验证由 T27 覆盖

## T26: server.js 异常兜底
**文件：** `server.js`
**依赖：** 无（可与 T25 一并提交）
**步骤：**
1. `runAction` 中 `logic.apply(...)` 包 try/catch：异常时 `console.error('[action] 规则引擎异常:', err)`、`socket.emit('error',{message:'操作异常，请重试'})`、return
2. 新增 `safeHandler(fn)` 包装函数，捕获异常并记录日志
3. 用 `safeHandler` 包裹 createRoom / joinRoom / reconnect / startGame / action / disbandRoom 六个回调
4. 模块顶层新增 `process.on('uncaughtException'/'unhandledRejection')` 日志兜底
**验证：** `node --check server.js` 通过；`npm test` 现有用例不回归

## T27: 新增清扫与异常兜底测试
**文件：** `test/room-sweep.test.js`（新建）
**依赖：** T25、T26
**步骤：**
1. `shouldSweepRoom` 单元用例：大厅闲置 10 分钟到期清理；对局闲置 30 分钟到期；有人在线（idleSince=null）不清理；未到期不清理（注入短阈值）
2. 同进程集成：`require('../server')` 后 `server.listen(随机端口)`，用 socket.io-client 创建房间并加入
3. 场景 A：全部断开 → `sweepRooms(Date.now(), {lobbyIdleMs:0, gameIdleMs:0, recordsDir:tmp})` → rooms 不含该码、tmp 生成记录文件（endReason='idle_timeout'）
4. 场景 B：一个玩家保持在线 → 相同参数 sweep → 房间保留
5. afterEach：关闭 sockets/server、清空 rooms、删除临时目录
**验证：** `node --test test/room-sweep.test.js` 全部通过

## T28: 删除重复背景图
**文件：** `public/Vintage_antique_world_map_in_s_2026-08-12T12-33-16.png`
**依赖：** 无
**步骤：**
1. 确认该文件与 `public/map-bg.png` MD5 一致且未被引用（`rg map-bg public`）
2. `git rm public/Vintage_antique_world_map_in_s_2026-08-12T12-33-16.png`
**验证：** `git status` 显示删除；页面样式仍引用 `map-bg.png`

## T29: 分析脚本汇总增强
**文件：** `scripts/analyze-games.js`
**依赖：** 无
**步骤：**
1. 汇总段累计各玩家胜场（records 的 winner 匹配 players.id → name）
2. 累计冠军与全员 `totalAssets`，输出冠军平均最终总资产、全员平均最终总资产
3. 输出格式与现有汇总风格一致
**验证：** 运行 `node scripts/analyze-games.js`，输出包含胜场与平均资产两项

## T30: 文档同步与全量回归
**文件：** `README.md`、`checklist.md`
**依赖：** T25–T29
**步骤：**
1. README 新增房间清理说明（大厅 10 分钟、对局/结束 30 分钟；闲置超时记录自动落盘 records/）
2. checklist.md 新增「稳定性与架构优化（2026-08-14）」记录节（清理机制、异常兜底、资产清理、分析增强、测试结果）
3. 运行 `npm test` 全量
**验证：** `npm test` 全部通过（原 71 + 新增用例）；文档包含清理规则

## 执行顺序

```
T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10 → T11 → T12 → T13 → T14
                                                                       ↘
T15（依赖 T1、T4，可与 T5–T14 并行推进骨架）→ T16（依赖 T5–T14）→ T17
T18 → T19 → T20 → T21 → T22
T23 → T24
```
## 稳定性优化执行顺序（2026-08-14）

```
T25 → T26 → T27 → T30
T28、T29 可与 T25–T27 并行 → T30
```
## T31: server.js finalizeGame 统一落盘
**文件：** `server.js`
**依赖：** 无
**步骤：**
1. 新增常量 `RECORDS_DIR = path.join(__dirname, 'records')`
2. `finalizeGame` 生成 record 并广播后，调用 `persistRecord(room.gameRecord, RECORDS_DIR)`
3. `sweepRooms` 移除内部 `persistRecord` 调用（落盘已统一到 finalizeGame，清理只负责删房间）
**验证：** `node --check server.js` 通过；集成测试断言解散后 records/ 生成文件

## T32: analyze-games.js 四类统计
**文件：** `scripts/analyze-games.js`
**依赖：** 无
**步骤：**
1. 破产轮次：遍历 events，「轮到」开头的 log 计数轮次，遇「破产出局/认输」事件记录当时轮次
2. 城市租金收入：解析 rent 事件「支付 … 租金 Y」，按城市累计次数与金额
3. 机会卡分布：chance 事件按卡名计数
4. 各玩家胜率：胜场数 / 参与对局数（按 name）
5. 输出并入现有汇总段，风格一致
**验证：** 构造样例记录运行 `node scripts/analyze-games.js`，输出含四类统计

## T33: 前端对局回放
**文件：** `public/client.js`
**依赖：** 无
**步骤：**
1. `renderGameOver` 增加「回放对局」按钮（lastRecord 存在时，所有玩家可见）
2. 新增 `renderReplay()`：复用 #modal 渲染事件时间线（显示 当前条/总数、事件文本、当前条高亮）
3. 新增上一条/下一条/自动播放（间隔 1.2 秒）/关闭 逻辑（replayIndex、replayTimer）
4. 关闭回放恢复结算弹窗
**验证：** 浏览器双开一局到结算，点击回放可翻页与自动播放；`node --check` 通过

## T34: PWA 资源与注册
**文件：** `public/manifest.webmanifest`（新建）、`public/sw.js`（新建）、`public/icon.svg`（新建）、`public/index.html`
**依赖：** 无
**步骤：**
1. 创建 icon.svg：深炭棕底 #1A1410 + 哑光古金 #B89B68 元素
2. 创建 manifest.webmanifest：名称「环球大亨」、display standalone、主题色/背景色取老钱风配色、图标引用 icon.svg
3. 创建 sw.js：install 缓存核心资源（index.html/style.css/client.js/map-bg.png/manifest/icon），fetch 缓存优先+网络回退，activate 清理旧缓存
4. index.html 加 manifest/icon/theme-color 链接，并在页面加载时注册 service worker
**验证：** devtools Application 面板 manifest 有效、SW 激活；勾选 Offline 刷新页面仍可加载

## T35: style.css 移动端适配
**文件：** `public/style.css`
**依赖：** 无
**步骤：**
1. 审查现有 @media 断点（1320/1080/720），补充 375px 适配
2. 棋盘缩放/滚动、操作按钮触控尺寸（min-height 约 44px）、台账与侧栏堆叠不遮挡
**验证：** devtools 375px 与 720px 宽度下检查无遮挡、按钮可触控

## T36: 测试与样例验证
**文件：** `test/record.test.js`、`test/room-sweep.test.js`、`scripts/analyze-games.js`
**依赖：** T31、T32
**步骤：**
1. record.test.js 集成测试断言解散后项目 records/ 生成对应文件（测试后清理该文件）
2. room-sweep.test.js 适配（sweepRooms 不再落盘，断言改为检查 records/ 已有文件或跳过落盘断言）
3. 用样例记录验证 T32 四类统计输出
4. 运行全量 `npm test`
**验证：** `npm test` 全部通过（74 + 新增）

## T37: README 同步
**文件：** `README.md`
**依赖：** T31–T36
**步骤：**
1. 对局数据记录节补充「对局结束自动落盘 records/」
2. 新增对局回放说明
3. 新增 PWA 与移动端说明（可安装、离线壳、风格沿用 PC）
**验证：** 文档包含新功能说明

## 数据驱动与移动端执行顺序（2026-08-14）

```
T31 → T36 → T37
T32 → T36
T33、T34、T35 可与 T31/T32 并行 → T36 → T37
```
## T38: eslint 配置与存量修复
**文件：** `eslint.config.js`（新建）、`package.json`
**依赖：** 无
**步骤：**
1. `npm install -D eslint`（更新 package.json 与 package-lock.json）
2. 创建 eslint.config.js（flat config）：eslint:recommended；server.js/src/scripts/test/e2e 用 node globals，public/client.js 用 browser globals
3. package.json 新增 `"lint": "eslint server.js src scripts public/client.js test e2e"`
4. 运行 lint，修复报告问题（未使用变量等）直至通过
**验证：** `npm run lint` 退出码 0

## T39: 前端端到端测试
**文件：** `e2e/flow.test.js`（新建）、`package.json`
**依赖：** 无
**步骤：**
1. `npm install -D playwright`
2. 创建 e2e/flow.test.js：spawn 本地 server（随机端口）→ 双页面创建房间/加入 → 开始对局 → 掷骰（断言事件出现）→ 解散 → 结算弹窗 → 点击回放（断言时间线渲染）
3. 浏览器通道：CI 环境用 chromium（默认），本机用 msedge channel
4. package.json：`"test"` 改为 `node --test --test-force-exit test/`；新增 `"test:e2e": "node --test --test-force-exit e2e/"`
**验证：** `npm run test:e2e` 本机通过（Edge）

## T40: CI 工作流
**文件：** `.github/workflows/ci.yml`（新建）
**依赖：** 无（推送后生效）
**步骤：**
1. 创建 ci.yml：触发 push/pull_request；job runs-on ubuntu-latest
2. steps：checkout → setup-node 20（cache npm）→ npm ci → npm run lint → npm test → npx playwright install --with-deps chromium → npm run test:e2e
**验证：** YAML 语法正确；推送后 GitHub Actions 运行（验收时确认状态）

## T41: 规则平衡模拟器
**文件：** `scripts/simulate-balance.js`（新建）
**依赖：** 无
**步骤：**
1. 参数解析：--games（默认 20）、--seed、--players（2–4，默认 4）
2. decideAction(state) 按 phase 分发：waiting_roll 掷骰；buy/buy_airport 现金足够且未达上限则购买；build_decide 现金足够则建 1 级；auction_bid 现金足够出最低加价、已是最高价者则 end；direct_sale_ask 现金足够则买；frozen/jail 能付则付；flight 不飞；self_rescue 有可抵押城市则抵押一座否则 rescue_done；buy_fundraise 取消
3. 主循环：createRng(seed 或随机) → createGameState → resetDeck → 循环 logic.apply，MAX_TURNS 保险丝
4. 统计：累积每局 events 用 computeStats 提取城市成交/租金；胜场/回合/破产轮次/平均资产读 state 与事件
5. 输出平衡性报告（与 analyze-games.js 风格一致）
**验证：** `node scripts/simulate-balance.js --games 5 --seed 42` 运行并输出全部报告字段

## T42: 移动端棋盘整体缩放
**文件：** `public/style.css`
**依赖：** 无
**步骤：**
1. 720px 断点：#board 由固定 width:1200px/height:300px 改为 width:100% + aspect-ratio:12/11 + height:auto；#pieces 同步 width/height 100%
2. #boardWrap 高度自适应，移除/兜底横向滚动
3. 375px 下格子字号微调（num/nm 保持可读）
**验证：** playwright 375px 测量 board 宽度≈容器宽度、全部 42 格可见、scrollWidth<=clientWidth

## T43: 全量验证
**文件：** 无（运行验证）
**依赖：** T38、T39、T41、T42
**步骤：**
1. `npm run lint` 通过
2. `npm test`（test/）全部通过
3. `npm run test:e2e` 通过
4. `node scripts/simulate-balance.js --games 5 --seed 42` 输出报告
5. 浏览器 375px 棋盘缩放测量通过
**验证：** 以上全部通过

## T44: README 同步
**文件：** `README.md`
**依赖：** T38–T43
**步骤：**
1. 新增 lint/test:e2e 命令说明
2. 新增平衡模拟器用法
3. 移动端节补充「竖屏棋盘整体缩放全图可见」
**验证：** 文档包含新说明


## T45: 股票转让修复与界面调整
**文件：** `public/client.js`、`public/index.html`
**依赖：** 无
**步骤：**
1. index.html：从 stockModal 移除 transferBox 静态节点（转让面板与「发起转让」按钮）
2. client.js：转让列表遍历玩家持有股票（meP.stocks 中 n>0 的城市），行显示「国家·城市（持有 n 股）」，不再依赖拥有城市
3. client.js：「我的资产」弹窗（openAssetOverview）新增「股票转让」入口按钮；点击后仅在 phase==='stock' 且自己回合时渲染转让表单（目标选择/股票/现金/发起），否则提示「仅经过起点时可转让」
4. client.js：股票市场弹窗底部仅保留「确认交易」「放弃交易」两个按钮（移除「关闭」，「不交易，继续」改名「放弃交易」）
**验证：** 双浏览器实测：持有股票（无对应城市）可发起转让、对方确认后股票与现金到账；股票界面仅两个按钮

## T46: 移动端操作栏动态留白
**文件：** `public/client.js`、`public/style.css`
**依赖：** 无
**步骤：**
1. client.js：新增 fitActionBarPadding()，页面 load 与 resize 时设 body.style.paddingBottom = actionBar.offsetHeight + 12px
2. style.css：720px 断点 body padding-bottom 由 84px 改为 150px（兜底最小值，防脚本生效前遮挡）
**验证：** playwright 375px 测量滚动到底时事件记录底部与操作栏顶部不重叠

## T47: 高价城股票单次限购改为 2 股
**文件：** `src/gameLogic.js`、`public/client.js`、`test/stock.test.js`
**依赖：** 无
**步骤：**
1. gameLogic.js：删除 `if (city.price >= 15000 && o.shares > 1)` 的跳过逻辑（高价城单次限购）
2. client.js：删除买入上限中高价城 1 股限制（cap 保持单城 2 股）与提交校验；更新股票提示文本与规则速查文本（去掉「地价≥15000 单次 1 股」）
3. test/stock.test.js：更新用例——纽约（地价≥15000）单次买入 2 股成功，现金与持仓断言同步
4. spec.md 已同步（规则 9 / AC21）
**验证：** `npm test` 通过（含更新用例）；浏览器股票界面单城可一次 +2 股

## T48: 21 号监狱入狱当回合修复
**文件：** `src/gameLogic.js`、`test/gameLogic.test.js`
**依赖：** 无
**步骤：**
1. gameLogic.js：landing 的 jail 分支——21 号监狱（jailLimitFor=3）入狱当回合不再进入 jail_turn，统一 endTurn（与 11/32 号一致）
2. 新增单元测试：玩家从 20 号掷 1 落到 21 号监狱 → jailed=true、phase 不进入 jail_turn、回合推进到下一玩家
3. 回归：既有监狱测试（直接构造 jail_turn 场景）不受影响
**验证：** `npm test` 全部通过（含新用例）

## T49: 资产总览抵押时机说明
**文件：** `public/client.js`
**依赖：** 无
**步骤：**
1. openAssetOverview（资产总览弹窗）新增说明行：「抵押时机：轮到你行动时可随时抵押（竞拍、交易确认期间除外）；每名玩家最多同时抵押 2 座城市；赎回需先落到该城市，本界面不提供赎回。」
2. ledgerCityRow 抵押按钮 title 文案统一为「轮到你行动时可抵押（竞拍/交易确认期间除外）；抵押金 = 总价值 × 50%」
**验证：** 浏览器打开资产总览可见抵押时机说明；按钮提示文案正确

## T50: 银行/资产总览抵押按钮修复
**文件：** `public/client.js`
**依赖：** 无
**步骤：**
1. openBank：全部「贷款」文案改为「抵押」（标题行「可抵押额度」、区域标签「抵押（自有未抵押城市，上限 2 座）」、按钮「抵押」、行内「可抵押 X」、空态「没有可抵押的城市」）
2. openBank 抵押按钮 onclick：socket.emit mortgage 后调用 closeModal()（关闭弹窗，结果由事件记录/toast 反馈）
3. ledgerCityRow 抵押按钮 onclick 同步加 closeModal()（资产总览/中心台账场景）
**验证：** 浏览器打开银行交易界面显示「抵押」；轮到自己时点击抵押，弹窗关闭且事件记录出现抵押事件

## T51: 已破产玩家退出不影响对局
**文件：** `server.js`、`public/client.js`、`test/integration.test.js`
**依赖：** 无
**步骤：**
1. server.js runAction：掉线暂停检查改为——存在「存活（state.players 中 alive=true）且未连接」的玩家才暂停；破产玩家断开不拒绝行动
2. client.js updateWaitBanner：从断开名单中过滤已破产玩家（按 game.players alive 判断），仅存活玩家掉线才显示「等待重连」横幅
3. 新增集成测试：甲/乙开局后令乙破产（alive=false）并断开，甲掷骰正常推进；存活玩家断开时仍暂停
**验证：** `npm test` 通过（含新用例）；`npm run lint` 通过
## 工程化与平衡模拟执行顺序（2026-08-14）

```
T38 → T43 → T44
T39 → T43
T41 → T43
T42 → T43
T40 可与 T38–T42 并行（推送后触发）→ 随提交验证
T45–T50 可与 T38–T44 并行 → T43 全量验证一并纳入
```