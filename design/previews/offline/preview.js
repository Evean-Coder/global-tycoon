'use strict';
// 离线预览共享脚本：模拟数据 + 与真实前端一致的渲染（文明6桌游皮肤）
window.__PREVIEW = (function () {
  const fmt = (n) => '￥' + Math.round(n).toLocaleString('zh-CN');

  const CITY_DATA = {
    内罗毕:{country:'肯尼亚',price:3600,group:'黄'},开普敦:{country:'南非',price:7200,group:'黄'},
    卡萨布兰卡:{country:'摩洛哥',price:4800,group:'黄'},开罗:{country:'埃及',price:6000,group:'黄'},
    奥克兰:{country:'新西兰',price:8400,group:'紫'},悉尼:{country:'澳大利亚',price:10800,group:'紫'},
    罗马:{country:'意大利',price:12000,group:'紫'},阿姆斯特丹:{country:'荷兰',price:10000,group:'紫'},
    莫斯科:{country:'俄罗斯',price:11000,group:'绿'},伦敦:{country:'英国',price:14000,group:'绿'},
    巴黎:{country:'法国',price:13000,group:'绿'},柏林:{country:'德国',price:15000,group:'绿'},
    纽约:{country:'美国',price:19000,group:'蓝'},多伦多:{country:'加拿大',price:14000,group:'蓝'},
    墨西哥城:{country:'墨西哥',price:12000,group:'蓝'},里约热内卢:{country:'巴西',price:13000,group:'蓝'},
    新加坡:{country:'新加坡',price:14000,group:'红'},东京:{country:'日本',price:17000,group:'红'},
    迪拜:{country:'阿联酋',price:15000,group:'红'},上海:{country:'中国',price:20000,group:'红'},
  };

  const LAYOUT = [
    ['start','起点'],['city','内罗毕'],['city','开普敦'],['chance'],['city','卡萨布兰卡'],['city','开罗'],
    ['airport','开罗国际机场'],['chance'],['city','奥克兰'],['city','悉尼'],['rest'],['jail','监狱'],
    ['city','罗马'],['city','阿姆斯特丹'],['pole','南极'],['chance'],['airport','伦敦希思罗国际机场'],
    ['city','伦敦'],['city','巴黎'],['chance'],['city','柏林'],['jail','监狱'],['city','莫斯科'],['rest'],
    ['airport','纽约肯尼迪国际机场'],['city','纽约'],['chance'],['city','多伦多'],['city','墨西哥城'],['city','里约热内卢'],
    ['chance'],['rest'],['jail','监狱'],['chance'],['pole','北极'],['airport','上海浦东国际机场'],
    ['city','上海'],['city','东京'],['city','新加坡'],['city','迪拜'],['chance'],['rest'],
  ];

  const FAKE = {
    players: [
      { id:'p0', name:'玩家A', color:'#e53935', cash:84200, position:36, alive:true, cities:['内罗毕','开普敦','阿姆斯特丹','伦敦','纽约','上海'], airports:['上海浦东国际机场'], stocks:{ 伦敦:2, 上海:1 }, socketId:'a', connected:true },
      { id:'p1', name:'玩家B', color:'#1e88e5', cash:91800, position:17, alive:true, cities:['开罗','东京'], airports:[], stocks:{ 伦敦:1 }, socketId:'b', connected:true },
    ],
    turnIndex: 0, rounds: 7,
  };
  const OWN = { 内罗毕:'p0', 开普敦:'p0', 开罗:'p1', 伦敦:'p0', 纽约:'p0', 上海:'p0', 东京:'p1', 阿姆斯特丹:'p0' };
  const LVL = { 伦敦:1 };
  const MG = { 上海:true };
  const AIR_OWN = { '上海浦东国际机场':'p0' };

  function gridPos(id) {
    if (id <= 10) return [1, id + 1];
    if (id === 11) return [1, 12];
    if (id <= 20) return [id - 10, 12];
    if (id === 21) return [11, 12];
    if (id <= 31) return [11, 33 - id];
    if (id === 32) return [11, 1];
    return [43 - id, 1];
  }

  function renderBoard(el) {
    el.innerHTML = '';
    LAYOUT.forEach((e, id) => {
      const [r, c] = gridPos(id);
      const type = e[0];
      let cls = '', label = '', sub = '', own = '';
      if (type === 'city') {
        const cid = e[1];
        cls = 'g-' + CITY_DATA[cid].group;
        label = CITY_DATA[cid].country + '·' + cid;
        if (OWN[cid]) { own = '玩家' + (OWN[cid] === 'p0' ? 'A' : 'B'); }
        if (LVL[cid]) sub = '<span class="lvl">房' + LVL[cid] + '</span>';
        if (MG[cid]) sub += '<span class="mg">抵</span>';
      } else if (type === 'start') { cls = 't-start'; label = '起点'; }
      else if (type === 'chance') { cls = 't-chance'; label = '机会卡'; }
      else if (type === 'jail') { cls = 't-jail'; label = '监狱'; }
      else if (type === 'airport') { cls = 't-airport'; label = e[1]; if (AIR_OWN[e[1]]) own = '玩家A'; }
      else if (type === 'pole') { cls = 't-pole'; label = e[1]; }
      else { cls = 't-rest'; label = '休闲'; }
      const d = document.createElement('div');
      d.className = 'sq ' + cls;
      d.style.gridRow = r; d.style.gridColumn = c;
      d.innerHTML = '<span class="num">' + id + '</span><span class="nm">' + label + '</span>'
        + (sub ? '<span class="subrow">' + sub + '</span>' : '')
        + (own ? '<span class="own">' + own + '</span>' : '');
      el.appendChild(d);
    });
  }

  function renderPieces(wrap, boardEl) {
    let layer = document.getElementById('offlinePieces');
    if (!layer) { layer = document.createElement('div'); layer.id = 'offlinePieces'; layer.style.cssText = 'position:absolute;left:50%;top:0;transform:translateX(-50%);width:min(100%,1320px);height:100%;pointer-events:none;z-index:4'; wrap.appendChild(layer); }
    layer.innerHTML = '';
    FAKE.players.forEach((p) => {
      const sq = boardEl.children[p.position];
      if (!sq) return;
      const bd = boardEl.getBoundingClientRect();
      const sr = sq.getBoundingClientRect();
      const d = document.createElement('span');
      d.className = 'piece';
      d.style.background = p.color;
      d.style.left = (sr.left - bd.left + sr.width / 2) + 'px';
      d.style.top = (sr.top - bd.top + sr.height / 2) + 'px';
      layer.appendChild(d);
    });
  }

  function renderLedger(body) {
    const me = FAKE.players[0];
    const mgCount = me.cities.filter((x) => MG[x]).length;
    let rows = '';
    me.cities.forEach((cid) => {
      const lv = LVL[cid] || 0; const mg = MG[cid];
      rows += '<div class="lrow"><span class="nm">' + cid + '</span><span class="info">房 <b>' + lv + '</b> · ' + (mg ? '<span class="mg">抵押</span>' : '正常') + '</span>'
        + (mg ? '<button disabled>赎回</button>' : '<button>抵押</button>')
        + '</div>';
    });
    body.innerHTML = '<div class="ledger-title">资产台账 · 我的资产</div>'
      + '<div class="ledger-cash"><span class="lbl">当前现金</span><span class="amt">' + fmt(me.cash) + '</span></div>'
      + '<div class="ledger-sum"><span>城市 <b>' + me.cities.length + '</b>（抵押 <b>' + mgCount + '</b> / 上限 2 座）</span>'
      + '<span>机场 <b>' + me.airports.length + '</b></span>'
      + '<span>持股 <b>伦敦×2、上海×1</b></span></div>'
      + '<div class="ledger-list">' + rows + '</div>'
      + '<div class="ledger-note">抵押上限最多 2 座城市；赎回需足额现金；起点地产支持出售清算。</div>';
  }

  function renderSide(side) {
    const me = FAKE.players[0];
    side.innerHTML = '<div class="panel" id="sidePlayer"><h3>我的信息</h3>'
      + '<div class="pinfo"><b>' + me.name + '</b><span class="badge host">房主</span></div>'
      + '<div class="assets">'
      + '<div class="asset-row"><span>总资产</span><b class="total">' + fmt(162400) + '</b></div>'
      + '<div class="asset-row"><span>当前现金</span><b class="total">' + fmt(me.cash) + '</b></div>'
      + '<div class="asset-row"><span>城市 6（抵押 1）</span><b>1 机场</b></div>'
      + '<div class="asset-row"><span>持股</span><b>伦敦×2、上海×1</b></div>'
      + '</div></div>'
      + '<div class="panel" id="sideOthers"><h3>其他玩家</h3>'
      + '<div class="pinfo"><b>玩家乙</b></div>'
      + '<div class="assets">'
      + '<div class="asset-row"><span>总资产</span><b class="total">' + fmt(128900) + '</b></div>'
      + '<div class="asset-row"><span>当前现金</span><b>' + fmt(82300) + '</b></div>'
      + '</div></div>'
      + '<div class="panel"><h3>事件记录</h3><div id="log">'
      + '<div class="ev cur">你 购买了 英国·伦敦</div>'
      + '<div class="ev">你 掷出 4 + 4（双数）出狱并移动</div>'
      + '<div class="ev">你 跨过起点 +5000</div>'
      + '<div class="ev">玩家B 以 6500 拍得 日本·东京</div>'
      + '<div class="ev">你 抵押 中国·上海</div>'
      + '</div></div>'
      + '<div class="side-ops"><button class="secondary">股票市场</button><button class="risk">认输</button><button class="risk">解散房间</button></div>';
  }

  function kv(label, val, cls) { return '<div class="kv"><span>' + label + '</span><b class="' + (cls || '') + '">' + val + '</b></div>'; }

  function modal(title, body, foot) {
    return '<div class="overlay"><div class="modal"><div class="mh"><h3>' + title + '</h3></div><div id="modalBody">' + body + '</div>'
      + (foot ? '<div class="mf">' + foot + '</div>' : '') + '</div></div>';
  }

  const views = {
    buy: modal('地产购买', '<div class="card-tag">PROPERTY</div>'
      + kv('地产名称', '英国·伦敦')
      + kv('当前价格', '￥14,000', 'g')
      + kv('当前租金', '￥4,200')
      + kv('持有玩家', '无')
      + '<div class="row"><button class="risk">放弃购买</button><button class="positive">确认购买</button></div>'),
    detail: modal('地产详情', '<div class="card-tag">PROPERTY DETAIL</div>'
      + kv('地产名称', '英国·伦敦')
      + kv('持有者', '玩家A')
      + kv('房屋等级', '1 级')
      + kv('当前租金', '￥8,400')
      + kv('升级费用', '￥8,400')
      + kv('抵押价值', '￥11,200')
      + kv('状态', '正常')
      + '<div class="row"><button class="secondary">升级</button><button class="secondary">抵押</button><button class="textbtn">关闭</button></div>'),
    bank: modal('银行交易', '<div class="card-tag">BANK</div>'
      + kv('当前现金', '￥84,200', 'g')
      + kv('可贷款额度', '￥48,600')
      + kv('当前负债', '￥10,600', 'r')
      + '<div class="ledger-list"><div class="lrow"><span class="nm">内罗毕</span><span class="info">可贷 ￥1,800</span><button class="secondary">贷款</button></div></div>'
      + '<div class="row"><button class="textbtn">关闭</button></div>'),
    stock: modal('股票市场', '<p class="hint">买入最多 6 股（3 城、单城 2 股），卖出不限</p>'
      + '<div id="stockList">' + [['伦敦','1400','2'],['巴黎','1300','0'],['纽约','1900','1'],['上海','2000','0'],['东京','1700','0'],['内罗毕','360','0']].map((s) =>
        '<div class="stock-item"><b>' + s[0] + '</b><span class="mono">股价 ' + s[1] + '</span><span>持有 ' + s[2] + ' 股</span>'
        + '<div class="srow"><span class="lbl">买</span><button>−</button><span>0</span><button>+</button></div>'
        + '<div class="srow"><span class="lbl">卖</span><button>−</button><span>0</span><button>+</button></div></div>').join('')
        + '</div><div class="mf"><button class="secondary">不交易，继续</button><button class="primary">确认交易</button><button class="textbtn">关闭</button></div>'),
    chance: modal('机会卡', '<div class="receipt">'
      + '<div class="rt">Opportunity</div>'
      + '<div class="rn">环球市长奖</div>'
      + '<div class="ra">+￥8,000</div>'
      + '<div class="rd">卡面效果已结算。</div>'
      + '<span class="stamp">机会 · 资本</span></div>'
      + '<div class="row" style="justify-content:center"><button class="primary">确认</button></div>'),
    jail: modal('监狱', '<p>你被关押在 21 号监狱。</p><p class="hint">21 号监狱最多关押 3 回合：第 3 回合开始将自动缴纳 15000 出狱并正常行动；11/32 号监狱仅关押 1 回合、到点自动释放。</p><p class="hint">资金不足（当前 ￥8,000），可先募集资金。</p>'
      + '<div class="btnrow"><button class="primary" disabled>支付 15000 出狱</button><button class="secondary">掷骰试出狱</button></div>'
      + '<div class="btnrow"><button class="secondary">募集资金</button><button class="secondary">放弃</button></div>'),
    frozen: modal('极地救援', '<div class="card-tag">FROZEN</div><p>你被冰冻了！可支付 5000 购买救援服务解除冰冻并正常行动；放弃则跳过本回合。</p>'
      + kv('当前现金', '￥8,000', 'r')
      + '<p class="hint">现金不足 5000，无法支付救援费，可先募集资金。</p>'
      + '<div class="btnrow"><button class="primary" disabled>支付 5000 解除</button><button class="secondary">募集资金</button><button class="secondary">放弃</button></div>'),
    auction: modal('拍卖', '<div class="card-tag">AUCTION</div>'
      + kv('竞拍标的', '日本·东京')
      + kv('当前最高', '￥6,500')
      + kv('最低出价', '￥7,000', 'g')
      + '<div class="row"><input class="mono" value="7000" style="flex:1"><button class="primary">出价</button><button class="secondary">放弃</button></div>'),
    settle: modal('对局结束', '<div class="winner-box"><div class="cap">Capital Winner</div><div class="name">玩家A</div><div class="total">最终总资产 ￥162,400</div><span class="stamp">资本赢家</span></div>'
      + '<div class="rule"></div>'
      + '<table class="rank"><tr><th>名次</th><th>玩家</th><th>总资产</th></tr>'
      + '<tr class="r1"><td>1</td><td>玩家A</td><td class="mono">￥162,400</td></tr>'
      + '<tr class="r2"><td>2</td><td>玩家B</td><td class="mono">￥128,900</td></tr>'
      + '<tr class="r3"><td>3</td><td>玩家C（已破产）</td><td class="mono">￥76,200</td></tr></table>'
      + '<div class="row"><button class="secondary">返回房间页</button><button class="primary">重新开始新对局</button></div>'),
  };

  function gameView() {
    return '<div id="waitBanner" class="hidden"></div><div id="gameMain">'
      + '<div id="boardWrap"><div id="board"></div><div id="ledger"><div id="ledgerBody"></div></div></div>'
      + '<div id="side"></div></div>'
      + '<div id="actionBar"><div id="dice">骰子 3 + 5</div><span id="turnInfo" style="font-weight:700;color:var(--title)">当前回合：玩家A（第 7 轮）</span><span class="spacer"></span><button class="primary">掷骰子</button><button class="secondary">查看资产</button><button class="secondary">银行</button><button class="secondary" disabled>结束回合</button><span id="timer" style="font-weight:700;color:var(--danger)">⏱ 72s</span></div>';
  }

  return {
    FAKE, LAYOUT, CITY_DATA,
    renderBoard, renderPieces, renderLedger, renderSide, gameView, views, modal,
  };
})();