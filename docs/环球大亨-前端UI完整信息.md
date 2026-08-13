# 环球大亨·资本博弈 — 前端 UI 完整信息

> 用途：供其他大模型据此编写设计文档 / 开发文档 / 需求文档。
> 对应实现版本：v20260813k（2026-08-13）。本文档描述**当前实际运行的前端**，包含页面结构、视觉系统、棋盘、逻辑、数据契约与关键交互，全部与代码一致。

## 1. 项目概况

- 游戏：《环球大亨·资本博弈》——2–4 人联机大富翁。42 格世界地图，包含地产购买/建房/抵押/拍卖/直接出售、机场、股票交易所、机会卡、监狱、极地冰冻、破产淘汰与结算。
- 技术栈：Node.js + Express + Socket.IO（服务端权威、状态由服务端计算并广播），前端为原生 HTML/CSS/JS（无框架、无构建步骤）。
- 启动：`npm start` → http://localhost:3000（监听 0.0.0.0，局域网/手机可访问）。
- 测试：`npm test`（36 项单元+集成）、`node acceptance.js`（20 项端到端验收，输出 acceptance-report.md）。
- 目录：`public/`（前端：index.html、style.css、client.js）、`src/`（服务端逻辑：board.js、gameLogic.js、state.js、random.js）、`server.js`（网络层）、`test/`。

## 2. 页面与视图结构（public/index.html）

单页应用，通过 `hidden` 类切换视图。所有交互文案为简体中文。

### 2.1 头部（通栏）

- `.brand`：标题 `<h1>环球大亨｜资本博弈</h1>` + `.sub`（GLOBAL TYCOON）。
- `#btnRules`（ghost 按钮）：打开规则速查弹窗。

### 2.2 大厅视图（#view-lobby）

居中卡片（`.card.center`）：
- `.brand-mark`：大标题「环球大亨」+ 副题。
- `.rule`：细分割线。
- `#nickname`：昵称输入（maxlength 12）。
- `#btnCreate`：创建房间（主按钮，昵称为空时 disabled）。
- `#joinCode`：6 位房间码输入（等宽字体）。
- `#btnJoin`：加入房间（次按钮，昵称+6 位码齐全才可用）。
- 底部提示文字。

### 2.3 房间视图（#view-room）

- `#roomCode`：大号等宽房间码。
- `#btnCopyCode`：复制房间码（文字按钮）。
- `#playerList`：玩家列表（房主徽章 / 在线点 / 已离线 / 等待空位）。
- `#btnStart`：开始游戏（房主且 ≥2 人可用）。
- `#btnLeave`：退出房间（确认后清本地记录并刷新回大厅）。
- `#roomHint`：提示文字。

### 2.4 游戏视图（#view-game）—— 核心

- `#waitBanner`：掉线暂停横幅（「等待 XX 重连」）。
- `#gameMain`（左右布局）：
  - `#boardWrap`：棋盘容器（海洋版图背景）。
    - `#board`：42 格网格棋盘（详见第 4 节）。
    - `#pieces`：棋子动画层（绝对定位，pointer-events:none）。
    - `#ledger`：中心资产台账（`#ledgerBody` 由 JS 填充）。
  - `#side`（右侧 528px 三卡片）：
    - `#sidePlayer`：我的信息卡（昵称、房主标识、总资产、现金、城市/抵押、机场、持股）。`#sideOthers`：其他玩家卡（实时显示其他玩家的总资产与现金，含破产/入狱/冰冻状态）。
    - 事件记录卡：`#log`（显示所有玩家的完整事件记录）。
    - `.side-ops`：`#btnStock`（股票市场）、`#btnSurrender`（认输）、`#btnDisband`（解散房间）。
- `#actionBar`（底部操作栏，桌游 HUD 质感）：
  - `#dice`：骰子显示（`骰子 X + Y` 或 `骰子 · 待掷`）。
  - `#turnInfo`：当前回合：XX（第 N 轮）。
  - `#btnRoll`（主按钮）掷骰子、`#btnAssets`（次按钮）查看资产、`#btnBank`（次按钮）银行、`#btnEndTurn`（次按钮，非本人回合 disabled）。
  - `#timer`：右下角倒计时（⏱ Ns）。

### 2.5 弹窗（overlay 层）

- `#modal`：通用操作弹窗（`#modalTitle` 标题 + `#modalBody` 内容）。用于：购买地产、购买机场、机场飞行、拍卖、直接出售、自救、地产详情、银行、资产总览、机会卡票据、冰冻、监狱、结算、股票转让确认。
- `#stockModal`：股票市场弹窗（`#stockList` 城市股票网格、`#transferBox` 玩家间转让区：`#transferTarget` 下拉、`#transferList`、`#transferCash`、`#btnTransfer`；底部 `#btnStockSkip` 不交易继续 / `#btnStockConfirm` 确认交易 / `#btnStockClose` 关闭）。
- `#rulesModal`：规则速查弹窗（`#rulesBody`，含 40 张机会卡图鉴）。
- `#toast`：顶部轻提示（错误/等待提示，2.6 秒自动消失）。

## 3. 视觉设计系统（public/style.css）—— 文明 6 桌游感

### 3.1 色彩令牌（:root）

| 令牌 | 值 | 用途 |
|---|---|---|
| --bg | #D9CBB7 | 页面背景（浅暖米，叠加 5% 弱古地图纹理） |
| --card | #F2E9DC | 卡片/弹窗/台账底 |
| --card2 | #E3D4C1 | 次级块/输入/列表行 |
| --gold | #D4A048 | 繁荣金：主按钮、重点金额、房级标记 |
| --gold2 | #8C7862 | 描边、分割线、次级强调 |
| --gold-soft | #E8C87E | 金 hover 提亮 |
| --title | #3A2E22 | 标题文字（深棕黑） |
| --text | #4F4133 | 正文 |
| --muted | #70604F | 辅助文字 |
| --off | #998877 | 禁用文字 |
| --danger | #C64C4C | 风险红：抵押、破产、罚金、放弃 |
| --success | #479958 | 发展绿：正向、购买、赎回 |
| --blue | #3B7CBF | 贸易蓝：机场/航线 |
| --violet | #8357A1 | 城邦紫：特殊地块 |
| --ocean | #7397B3 | 海洋：棋盘外围版图 |
| --land | #C8B8A2 | 陆地地块基准色 |
| --line / --line-soft / --line-faint | rgba(140,120,98,.5/.28/.14) | 描边与分割 |

三层色彩层级：底层版图（浅暖米+海洋外围）→ 中层卡牌面板（明度最高、上浮）→ 高层强调色（金/绿/红/蓝/紫仅作标记、按钮、重点数字，不做大面积铺底）。

### 3.2 圆角与字体

- 圆角：弹窗/台账 10px、卡牌 8px、按钮/输入 6px、版图格 4px、标签 3px；禁止胶囊大圆角。
- 字体：标题粗衬线（Georgia/Songti）、正文无衬线（Segoe UI/雅黑）、金额/数据/房间码等宽（Consolas/Courier）。

### 3.3 按钮体系

- `.primary` 主按钮：金底 `#D4A048`、深字、用于创建/加入/开始/确认交易/重新开局。
- `.positive` 正向按钮：绿底 `#479958`、白字、用于购置地产（购买确认）。
- `.risk` 风险按钮：红底 `#C64C4C`、白字、用于放弃/抵押/出售/罚金/认输/解散。
- `.secondary` 次按钮：透明底、`#8C7862` 描边、正文色文字。
- `.textbtn` 文字按钮（复制房间码/关闭）、`.ghost`（规则）。
- disabled：底 `#BBAA99`、字 `#998877`。
- 输入框：卡片底、`#8C7862` 描边、聚焦金框光晕。

### 3.4 棋盘版图

- `#boardWrap`：海洋蓝背景（`#7397B3` + 弱纹理），作为版图海洋外围。
- `#board`：浅米陆地底（`linear-gradient(#E6DAC6,#DBCFB7)`），42 格横向闭环网格（12 列 × 11 行）。
- 格子 `.sq`：陆地底色/类型色、`#8C7862` 1.5px 描边、4px 圆角、hover 提亮。
- 类型样式：
  - 城市 `.g-黄/.g-紫/.g-绿/.g-蓝/.g-红`：浅色实底 + 3px 资源色顶条（黄 #D4A048、紫 #8357A1、绿 #479958、蓝 #3B7CBF、红 #C64C4C）。
  - 起点 `.t-start` 浅绿；机会卡 `.t-chance` 浅金；机场 `.t-airport` 淡蓝（贸易）；监狱 `.t-jail` 浅红；极地 `.t-pole` **白色**（南北极，淡蓝描边）；休闲 `.t-rest` 浅米。
  - 格内：格号 `.num`、名称 `.nm`、所有者 `.own`、房级金块 `.lvl`、抵押红块 `.mg`。
- 棋子 `#pieces .piece`：16px 扁平实体小方块，玩家资源色 + 深描边，随移动动画逐格平滑过渡。

### 3.5 卡牌/台账/弹窗质感

- 台账 `#ledger`：卡片底 `#F2E9DC`、金边、居中浮于棋盘；标题衬线深棕、现金金高亮、汇总行、城市列表（偶数行次级底色）、底部规则提示。
- 右侧 `.panel`：卡片底 + 8px 圆角 + 金描边，点击标题可折叠（`.closed`）。
- 弹窗 `.modal`：卡片底、金描边、10px 圆角、半透明深色遮罩。
- 机会卡票据 `.receipt`：卡牌质感（米金底 + 内描边 + 印章）。
- 底部操作栏 `#actionBar`：桌游 HUD（米金渐变条、金边、加粗回合信息）。
- Toast：深棕底白字顶部提示。

### 3.6 响应式断点

- ≤1320px：右侧面板收窄至 380px。
- ≤1080px：主区改为纵向堆叠，右侧面板改横向排布。
- ≤720px（手机）：viewport 锁定不缩放；棋盘容器高 320px、`overflow-x:auto` 内部 1200×300 横向滑动；台账隐藏（由「查看资产」弹窗唤起）；侧栏纵向卡片；操作栏固定底部；格内只显示格号+名称小字。

## 4. 棋盘

### 4.1 42 格闭环（12 列 × 11 行，起点左上角，顺时针）

gridPos(id)（client.js）：

```
id ≤ 10    → [1, id+1]          上边（含左上角起点 0、右上角 11）
id === 11  → [1, 12]
id ≤ 20    → [id-10, 12]        右边（上→下）
id === 21  → [11, 12]
id ≤ 31    → [11, 33-id]        下边（右→左）
id === 32  → [11, 1]
id ≤ 41    → [43-id, 1]         左边（下→上）
```

走向：起点(0 左上角) → 上边向右 → 右上角 → 右边向下 → 右下角 → 下边向左 → 左下角 → 左边向上 → 回起点。

### 4.2 42 格内容（src/board.js LAYOUT，与 spec 一致）

0 起点｜1 内罗毕(黄·肯尼亚)｜2 开普敦(黄·南非)｜3 机会卡｜4 卡萨布兰卡(黄·摩洛哥)｜5 开罗(黄·埃及)｜6 开罗国际机场｜7 机会卡｜8 奥克兰(紫·新西兰)｜9 悉尼(紫·澳大利亚)｜10 休闲｜11 监狱｜12 罗马(紫·意大利)｜13 阿姆斯特丹(紫·荷兰)｜14 南极｜15 机会卡｜16 伦敦希思罗国际机场｜17 伦敦(绿·英国)｜18 巴黎(绿·法国)｜19 机会卡｜20 柏林(绿·德国)｜21 监狱｜22 莫斯科(绿·俄罗斯)｜23 休闲｜24 纽约肯尼迪国际机场｜25 纽约(蓝·美国)｜26 机会卡｜27 多伦多(蓝·加拿大)｜28 墨西哥城(蓝·墨西哥)｜29 里约热内卢(蓝·巴西)｜30 机会卡｜31 休闲｜32 监狱｜33 机会卡｜34 北极｜35 上海浦东国际机场｜36 上海(红·中国)｜37 东京(红·日本)｜38 新加坡(红·新加坡)｜39 迪拜(红·阿联酋)｜40 机会卡｜41 休闲

- 城市地价：内罗毕 3600、开普敦 7200、卡萨布兰卡 4800、开罗 6000、奥克兰 8400、悉尼 10800、阿姆斯特丹 10000、罗马 12000、莫斯科 11000、伦敦 14000、巴黎 13000、柏林 15000、纽约 19000、多伦多 14000、墨西哥城 12000、里约热内卢 13000、新加坡 14000、东京 17000、迪拜 15000、上海 20000。
- 机场 4 座均 15000：开罗国际机场、伦敦希思罗国际机场、纽约肯尼迪国际机场、上海浦东国际机场。

## 5. 前端逻辑总览（public/client.js）

### 5.1 全局状态

me（昵称/房间码/游戏内 id）、game（最新 gameState）、awaitingPlayerId（当前待行动者 id）、stockDraft/transferDraft（股票草稿）、disconnectedNames、roomHostId、pendingToken、clientLog（事件历史）、lastEventId、lastPos（动画用）、animBusy/animQueued/diceAnimating（动画编排）、receiptPending、stockAutoShown、timerIv。

### 5.2 渲染函数

- `renderBoard()`：按 gameState 渲染 42 格（名称/所有者/房级/抵押/格号）；城市格可点击打开地产详情。
- `renderPieces()`：在 #pieces 层按 lastPos 渲染棋子（动画逐格更新）。
- `renderSide()`：我的信息卡（总资产/现金/城市/机场/持股）+ 其他玩家卡（总资产/现金，实时刷新）+ 事件记录（全局事件，最近 8 条）。
- `renderLedger()`：中心台账「资产台账 · 我的资产」（现金高亮、汇总、城市行抵押/赎回/起点出售、规则提示；本人等待掷骰时弱化；破产显示清算文书）。
- `renderActionBar()`：骰子、当前回合、按钮可用态（仅本人 waiting_roll 可掷骰/结束回合）。
- `renderPending()`：按 phase 渲染操作弹窗（购买/机场/飞行/拍卖/直接出售/自救/冰冻/监狱/股票自动弹窗），监狱/冰冻仅本人弹窗、他人轻提示。
- `openCityDetail / openBank / openAssetOverview / sellChoice / openReceipt / renderStock / adjStock / submitStock / renderTransfer / adjTransfer / submitTransfer / handleTradeConfirm`：地产详情、银行（贷款=抵押、还款=赎回）、资产总览、出售选择、机会卡票据、股票买入/卖出、玩家间转让与确认。
- `renderGameOver()`：结算弹窗（冠军+排名+返回房间/房主重开）。
- `buildRules()`：规则速查 + 40 张机会卡图鉴。

### 5.3 动画编排

- `playDiceAnim()`：点掷骰后骰子滚动约 0.68s。
- `processState/afterAnim/playMoveAnim`：检测玩家位置变化 → 沿最短路径逐格移动棋子（约 0.11s/格）→ 动画结束后 `finishRender`（渲染 + 弹窗 + 事件）。
- 机会卡票据先弹、确认后（`afterReceipt`）再弹落点操作；抽卡票据仅抽卡者本人。

### 5.4 Socket 事件（客户端监听）

- `roomState`：渲染房间页（房间码、玩家列表、房主、开始按钮状态）。
- `gameState`：全量刷新（身份定位 → 动画编排 → 渲染）。
- `timerStarted`：倒计时（单一定时器，防叠加跳动）。
- `error`：toast 提示。
- `reconnectToken`：保存一次性重连令牌到 localStorage（gt_reconnect）。
- `connect`：页面加载时若有存根则弹确认并以保存身份重连。

### 5.5 身份与重连

- 身份定位：`game.players.find(p => p.socketId === socket.id)`，兜底按昵称；失败 toast 提示。
- 重连：localStorage 存 {roomCode,name,token}；掉线重连自动执行；服务端令牌单次有效、在线防顶替、昵称去重。
- 事件全局广播：服务端向所有客户端广播完整事件（带唯一 id），前端按 id 去重。

## 6. 数据契约

### 6.1 客户端 → 服务端（socket.emit）

- `createRoom {name}` → ack `{ok, roomCode}`
- `joinRoom {roomCode, name}` → ack `{ok, roomCode, error?}`
- `reconnect {roomCode, name, token}` → ack `{ok, roomCode, error?}`
- `startGame {}` → ack `{ok}`
- `action {type, ...}` → ack `{ok}`
- `disbandRoom {}` → ack `{ok}`

### 6.2 服务端 → 客户端（socket.on）

- `roomState`：`{roomCode, hostId, players:[{id,name,seat,connected}], started}`
- `gameState`：`{...对局状态, events:[{text,type,id}]}`（events 按玩家过滤）
- `timerStarted {phase, seconds}`
- `error {message}`
- `reconnectToken {token}`

### 6.3 gameState 主要字段

- `roomCode, status('playing'/'over'), rounds, turnIndex, phase, pending, dice:[a,b]`
- `players[]`：`{id,name,seat,color,cash,position,alive,jailed,jailTurns,frozen,cities[],airports[],stocks{城:股},connected,socketId,transferDone}`
- `board[]`：`{id,type,name?,cityId?,price?,group?,airportId?}`
- `cities{}`：`{id,name,country,continent,ownerId,houseLevel,mortgaged,price,group,mortgageInterest}`
- `airports{}`：`{id,ownerId}`
- `stocks{}`：`{price, holders{playerId:股数}}`
- `events[]`：`{text, type, id}`（type: buy/rent/chance/jail/stock/auction/bankrupt/sale/win/dividend/house/airport 等）
- `rank[]`（最终排名，胜利者第一）、`winner`

### 6.4 客户端可发送的 action 类型

roll_dice、respond_frozen(pay/pass)、respond_jail(pay/roll/pass)、buy(buy/pass)、buy_airport(buy/pass)、flight(target|null)、stock_trade(orders[buy/sell])、stock_done、stock_transfer(targetId,items,cash 或 accept)、auction_respond(bid/pass)、direct_sale_respond(buy/pass)、rescue_mortgage、rescue_demolish、rescue_done、mortgage、redeem、sell_city(cityId,mode,direct/auction,context?)、build_house、demolish_house、surrender。

### 6.5 阶段（phase）清单

waiting_roll、frozen_turn、jail_turn、buy、buy_airport、flight、stock、trade_confirm、auction_bid、direct_sale_ask、self_rescue、game_over（以及瞬态：auction、direct_sale）。

## 7. 关键交互流程

1. **回合**：waiting_roll（本人掷骰按钮）→ 掷骰动画 → 移动动画 → 落点结算（购买/租金/机会卡/极地/机场/监狱等）→ endTurn 轮转。
2. **起点结算**（跨过或停在起点）：① +5000 与名下城市股息 → ② 开放股票窗口（自动弹出）→ ③ 跨过则继续结算落点、停在起点则本回合结束。
3. **购买/放弃**：无主城市 → 购买确认（绿色按钮）或放弃（进入拍卖）；拍卖唯一参与者出价后立即成交，多参与者逐轮加价。
4. **机会卡**：先弹票据（仅本人）→ 确认后结算落点；位移卡照常结算；入狱卡立即进监狱判定。
5. **监狱**：落监狱格/入狱卡/三双 → 立即弹出「支付 15000 / 掷骰试出狱 / 放弃」；放弃或掷骰未出狱关押回合 +1；第 3 回合强制出狱（现金不足进自救）。
6. **自救**：资金不足 → 弹窗提供抵押/拆房/出售/拍卖，凑够或放弃后破产判定。
7. **股票窗口**：仅经过起点时；买入 ≤6 股（3 城、单城 ≤2），卖出不限；确认/不交易/关闭都会结束窗口（stock_done）；转让需对方确认（trade_confirm），每回合限一笔。
8. **银行**：贷款=抵押（≤2 座、总价值 50%、每城按 5% 计息）、还款=赎回（本金+该城累计利息）；现金不足置灰。
9. **破产/认输**：认输资产直接归银行（不拍卖）；破产走逐城拍卖；最后一人获胜，结算按出局顺序排名。
10. **断线**：对局暂停 + 等待横幅；凭一次性令牌重连；房主可解散（按总资产排名）。

## 8. 游戏内规则速查（#rulesBody 文案）

目标、回合（双骰、双数连掷、三双入狱、跨起点 +5000 与股息与股票窗口）、地产（租金=地价×(30%+等级×30%)、经过自有城建/拆 1 级）、城市交易（直接出售总价值成交、卖家得 80%；拍卖起拍 10%）、抵押（总价值 50%、最多 2 座、每轮 5% 利息）、机场（15000、机场费 3000×拥有数、机票=距离×500）、极地/监狱（冰冻付 5000 解除；21 号监狱付 15000 或掷双数出狱、第 3 回合自动缴纳出狱；11/32 号监狱关押 1 回合自动释放）、股票（每城 10 股、仅起点可买卖、租客持股抵扣）、机会卡 40 张图鉴（奖励 15/罚款 15/位移 9/入狱 1，金额与名称全列）。

## 9. 已知约束与设计决策（重要）

- 中心台账与右侧「我的信息」均为**个人视角**（只显示自己的资产，不显示其他玩家资产）；事件记录为全局日志，显示所有玩家的事件。
- 事件记录为全局日志：服务端广播完整事件，所有玩家可见。
- 机会卡票据 → 确认 → 落点弹窗的先后顺序。
- 动画期间新状态排队，动画完成后统一渲染。
- 棋盘为横向闭环 42 格（起点左上角、顺时针），桌面一屏、移动端棋盘内横向滑动。
- 皮肤为文明 6 桌游感（亮色），业务逻辑与交互不变。
- 手机端台账经「查看资产」弹窗唤起；侧栏卡片可折叠；操作栏固定底部。
- 资源文件带版本号（?v=…）防缓存；建议每次改前端后递增。

## 10. 常见易错点（供开发文档参考）

- gameState 的 events 是按玩家过滤的附加字段（状态本身双端一致，比较状态时忽略 events）。
- 股票/转让按钮使用事件委托（data-city/data-kind/data-delta），勿改回内联 onclick。
- 倒计时使用单一定时器，收到新 timerStarted 先清除旧定时器。
- 身份定位优先 socketId；重连前弹确认；同房间昵称去重。
- 动画编排：diceAnimating/animBusy 期间新广播入队（animQueued），避免状态错乱。
- 监狱「放弃」= 跳过判定（jailTurns+1，第 3 次强制出狱）。
- 唯一参与者拍卖：出价后立即成交（无需再放弃一次）。