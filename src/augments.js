'use strict';

const { shuffle } = require('./random');

// ---------- 品质 / 圈数映射 ----------

const TIER = {
  SILVER: 'silver',
  GOLD: 'gold',
  PRISMATIC: 'prismatic',
};

// 第 1/6/10 圈完成时分别锁定对应品质池；其余圈数不触发
const LAP_TO_TIER = { 1: TIER.SILVER, 6: TIER.GOLD, 10: TIER.PRISMATIC };

const GO_BONUS = 10000;
const DEFAULT_HOUSE_CAP = 4;

function tierForLap(lapCount) {
  return LAP_TO_TIER[lapCount] || null;
}

// ---------- 卡池定义 ----------

// 每个海克斯通过 hooks 声明对哪些事件作出响应：
//  - OnDiceRoll(ref steps, ref roll, ref spaceWarp)：修改投掷/移动
//  - OnTileBuyCostCalculate(ref cost, baseCost)：地皮购买价格
//  - OnPassingTile(ref charge)：敌人路过己方地块
//  - OnLandingTile(ref pay, ref buyout, ref demote)：停留结算
//  - OnLapCompleted：跑圈结算（由 gameLogic 检测 lapCount 触发）
//  - OnPreBankruptcy(ref cancel)：破产前置拦截
const AUGMENTS = {
  // ---------- 白银池 · 第 1 圈 ----------
  AUG_SILVER_01: {
    id: 'AUG_SILVER_01', tier: TIER.SILVER, name: '开工补贴',
    desc: '购买未开发空地时，费用享受 35% 折扣。',
    hooks: {
      OnTileBuyCostCalculate(state, player, ctx) {
        if (ctx.city && (ctx.city.houseLevel || 0) === 0) {
          ctx.cost = Math.round(ctx.baseCost * 0.65);
          log(ctx, `${player.name} 开工补贴：${label(state, ctx.city.id)} 购买价 65 折（${ctx.baseCost}→${ctx.cost}）`);
        }
      },
    },
  },
  AUG_SILVER_02: {
    id: 'AUG_SILVER_02', tier: TIER.SILVER, name: '双速引擎',
    desc: '投掷点数为奇数时，移动步数额外 +2。',
    hooks: {
      OnDiceRoll(_state, player, ctx) {
        if (ctx.roll % 2 === 1) {
          ctx.steps += 2;
          log(ctx, `${player.name} 双速引擎：奇数 ${ctx.roll}，移动步数 +2（${ctx.roll}→${ctx.steps}）`);
        }
      },
    },
  },
  AUG_SILVER_03: {
    id: 'AUG_SILVER_03', tier: TIER.SILVER, name: '天使轮融资',
    desc: '立即获得 2 倍起点工资现金；前 2 圈路过起点奖励 +50%。',
    onAcquire(_state, player, ctx) {
      const gain = 2 * GO_BONUS;
      player.cash += gain;
      log(ctx, `${player.name} 天使轮融资：立即获得 ${gain} 现金`);
    },
    hooks: {
      OnGoBonus(_state, player, ctx, inst) {
        if (player.lapCount <= inst.acquiredAtLap + 2) {
          ctx.bonus += Math.round(GO_BONUS * 0.5);
          log(ctx, `${player.name} 天使轮融资：前 2 圈起点奖励 +${Math.round(GO_BONUS * 0.5)}`);
        }
      },
    },
  },
  AUG_SILVER_04: {
    id: 'AUG_SILVER_04', tier: TIER.SILVER, name: '地契盲盒',
    desc: '选取后立即随机获得 1 处当前全图未售出的空地产权。',
    onAcquire(state, player, ctx) {
      const unsold = Object.keys(state.cities).filter((id) => !state.cities[id].ownerId);
      if (!unsold.length) {
        log(ctx, `${player.name} 地契盲盒：全场已无未售出地产`);
        return;
      }
      const cityId = unsold[Math.floor(ctx.rng() * unsold.length)];
      state.cities[cityId].ownerId = player.id;
      player.cities.push(cityId);
      state.cities[cityId].buildReady = false;
      log(ctx, `${player.name} 地契盲盒：获得 ${label(state, cityId)}`);
    },
  },
  AUG_SILVER_05: {
    id: 'AUG_SILVER_05', tier: TIER.SILVER, name: '低谷保单',
    desc: '前 3 圈内停留在敌方地块时，所需支付的过路费降低 50%。',
    hooks: {
      OnLandingTile(state, player, ctx, inst) {
        if (ctx.city && ctx.city.ownerId && ctx.city.ownerId !== player.id && player.lapCount < inst.acquiredAtLap + 3) {
          ctx.pay = Math.round(ctx.pay * 0.5);
          ctx.reduced = true;
          log(ctx, `${player.name} 低谷保单：${label(state, ctx.city.id)} 过路费减半`);
        }
      },
    },
  },

  // ---------- 黄金池 · 第 6 圈 ----------
  AUG_GOLD_01: {
    id: 'AUG_GOLD_01', tier: TIER.GOLD, name: '违章扩建',
    desc: '己方所有地产等级上限 +1，地产升级费用降低 20%。',
    hooks: {
      OnHouseLevelCap(_state, _player, ctx) {
        ctx.cap = DEFAULT_HOUSE_CAP + 1;
      },
      OnHouseCost(state, player, ctx) {
        ctx.cost = Math.round(ctx.cost * 0.8);
        log(ctx, `${player.name} 违章扩建：${label(state, ctx.city.id)} 升级费用 8 折（${Math.round(ctx.baseCost)}→${ctx.cost}）`);
      },
    },
  },
  AUG_GOLD_02: {
    id: 'AUG_GOLD_02', tier: TIER.GOLD, name: '强拆通告',
    desc: '停留在敌方 >=2 级建筑时，使其强制降 1 级且本次免租（CD：3 回合）。',
    hooks: {
      OnLandingTile(state, player, ctx, inst) {
        const city = ctx.city;
        if (!city || city.ownerId === player.id || (city.houseLevel || 0) < 2) return;
        const cd = (player.augmentCooldowns && player.augmentCooldowns[inst.id]) || 0;
        if (cd > 0) return;
        city.houseLevel -= 1;
        player.augmentCooldowns[inst.id] = 3;
        ctx.pay = 0;
        ctx.demote = true;
        log(ctx, `${player.name} 强拆通告：${label(state, city.id)} 强制降级并免租（CD 3 回合）`);
      },
    },
  },
  AUG_GOLD_03: {
    id: 'AUG_GOLD_03', tier: TIER.GOLD, name: '连锁商圈',
    desc: '同色系地块中只要持有 >=2 处，该色系所有己方地块基础租金提升 100%。',
    hooks: {
      OnOwnerRentBase(state, player, ctx) {
        const group = ctx.city.group;
        const owned = player.cities.filter((id) => state.cities[id].group === group).length;
        if (owned >= 2) {
          ctx.rent = Math.round(ctx.rent * 2);
          log(ctx, `${player.name} 连锁商圈：${label(state, ctx.city.id)} 基础租金 ×2`);
        }
      },
    },
  },
  AUG_GOLD_04: {
    id: 'AUG_GOLD_04', tier: TIER.GOLD, name: '地籍调换',
    desc: '立即触发一次选地流程：选定己方 1 处地产与全场任意 1 处同级地产强制互换归属。',
    // 交互式效果：由 gameLogic 在选择后进入 augment_swap 阶段
  },
  AUG_GOLD_05: {
    id: 'AUG_GOLD_05', tier: TIER.GOLD, name: '过路税改',
    desc: '敌人路过（无需停留）己方最高级地产时，强制扣除并向你支付 15% 的基础租金。',
    hooks: {
      OnPassingTile(state, player, ctx) {
        const city = ctx.city;
        const maxLevel = Math.max(...player.cities.map((id) => state.cities[id].houseLevel || 0), 0);
        if (maxLevel > 0 && (city.houseLevel || 0) === maxLevel) {
          ctx.charge = Math.round(ctx.baseRent * 0.15);
          log(ctx, `${ctx.passer.name} 路过 ${player.name} 最高级地产 ${label(state, city.id)}，过路税 ${ctx.charge}`);
        }
      },
    },
  },

  // ---------- 棱彩池 · 第 10 圈 ----------
  AUG_PRISMATIC_01: {
    id: 'AUG_PRISMATIC_01', tier: TIER.PRISMATIC, name: '恶意收购',
    desc: '停在敌方最高等级地产时，可选择支付该地块原造价 1.5 倍现金直接强制买断。',
    hooks: {
      OnLandingTile(state, player, ctx) {
        const city = ctx.city;
        if (!city || !city.ownerId || city.ownerId === player.id) return;
        const owner = byId(state, city.ownerId);
        if (!owner || !owner.alive) return;
        const maxLevel = Math.max(...owner.cities.map((id) => state.cities[id].houseLevel || 0), 0);
        if (maxLevel > 0 && (city.houseLevel || 0) === maxLevel) {
          ctx.buyout = { cityId: city.id, ownerId: owner.id, price: Math.round(city.price * 1.5) };
        }
      },
    },
  },
  AUG_PRISMATIC_02: {
    id: 'AUG_PRISMATIC_02', tier: TIER.PRISMATIC, name: '资本清算',
    desc: '敌方单次向你支付超过其总资产 20% 的租金时，强制向你割让其名下 1 处最低等级地产。',
    hooks: {
      OnRentPaid(state, _player, ctx) {
        if (!ctx.amount || ctx.amount <= 0 || !ctx.payerAssets) return;
        if (ctx.amount > ctx.payerAssets * 0.2) {
          const owned = (ctx.payer.cities || []).map((id) => state.cities[id]).filter((c) => c && c.ownerId === ctx.payer.id && !c.mortgaged);
          if (!owned.length) return;
          const lowest = owned.reduce((a, b) => ((b.houseLevel || 0) < (a.houseLevel || 0) ? b : a));
          ctx.cede = { cityId: lowest.id };
        }
      },
    },
  },
  AUG_PRISMATIC_03: {
    id: 'AUG_PRISMATIC_03', tier: TIER.PRISMATIC, name: '全域通胀',
    desc: '己方全图地租 +150%，且免疫敌方的免租卡/减租效果。',
    hooks: {
      OnOwnerRentBase(state, player, ctx) {
        ctx.rent = Math.round(ctx.rent * 2.5);
        ctx.immune = true;
        log(ctx, `${player.name} 全域通胀：${label(state, ctx.city.id)} 租金 +150%`);
      },
    },
  },
  AUG_PRISMATIC_04: {
    id: 'AUG_PRISMATIC_04', tier: TIER.PRISMATIC, name: '末日对冲',
    desc: '遭遇破产时免除所有债务，保留 1 处最高级地产，重置为 2000 启动现金（限 1 次）。',
    hooks: {
      OnPreBankruptcy(_state, player, ctx, inst) {
        if (player.augmentUsed && player.augmentUsed[inst.id]) return;
        player.augmentUsed[inst.id] = true;
        ctx.cancel = true;
      },
    },
  },
  AUG_PRISMATIC_05: {
    id: 'AUG_PRISMATIC_05', tier: TIER.PRISMATIC, name: '空间折跃',
    desc: '每回合投掷两个骰子，玩家可自选点数【相加 / 相减绝对值 / 相乘】作为最终位移步数。',
    hooks: {
      OnDiceRoll(_state, _player, ctx) {
        ctx.spaceWarp = true;
      },
    },
  },
};

// ---------- 抽取算法 ----------

function getAugmentChoices(lapCount, rng, excludeIds = []) {
  const tier = tierForLap(lapCount);
  if (!tier) return [];
  const pool = Object.values(AUGMENTS).filter((a) => a.tier === tier && !excludeIds.includes(a.id));
  return shuffle(pool, rng).slice(0, 3).map((a) => ({
    id: a.id,
    name: a.name,
    desc: a.desc,
    tier: a.tier,
  }));
}

// ---------- 运行时工具 ----------

function hasAug(state, player, id) {
  return !!(player && player.augments && player.augments.some((a) => a.id === id));
}

function runHook(state, player, hook, ctx) {
  if (!player || !Array.isArray(player.augments)) return;
  for (const inst of player.augments) {
    const def = AUGMENTS[inst.id];
    const fn = def && def.hooks && def.hooks[hook];
    if (fn) fn(state, player, ctx, inst);
  }
}

function onAcquire(state, player, augId, ctx) {
  const def = AUGMENTS[augId];
  if (def && def.onAcquire) def.onAcquire(state, player, ctx);
}

function augmentDef(augId) {
  return AUGMENTS[augId] || null;
}

// ---------- 内部辅助 ----------

function label(state, cityId) {
  const c = state.cities[cityId];
  return c && c.country ? c.country + '·' + cityId : cityId;
}

function byId(state, id) {
  return state.players.find((p) => p.id === id);
}

function log(ctx, text, type = 'augment') {
  if (ctx && Array.isArray(ctx.events)) ctx.events.push({ type, text });
}

module.exports = {
  TIER,
  LAP_TO_TIER,
  AUGMENTS,
  tierForLap,
  getAugmentChoices,
  hasAug,
  runHook,
  onAcquire,
  augmentDef,
};
