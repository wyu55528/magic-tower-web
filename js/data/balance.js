/**
 * 全塔的数值底表：剑盾档位、每层生命结晶、玩家面板推算。
 *
 * 这份表是唯一的"事实来源"：
 *   - 关卡生成器（tools/gen-levels.mjs）用它决定每层摆什么、给多少生命结晶；
 *   - 怪物表（js/data/monsters.js）用它反推"巡逻怪"的数值；
 *   - README 里那两张表也照它排（node tools/readme-table.mjs）。
 *
 * 三处都从这里取数，改一处全塔一致。
 */

/** 塔高 30 层（第 1 层在最底下） */
export const FLOOR_COUNT = 30;

/** 剑：只生效最高档，所以攻击力 = 100 + 当前最高那把 */
export const SWORDS = [
  { floor: 1, id: 'sword_iron', atk: 300 },
  { floor: 7, id: 'sword_bronze', atk: 900 },
  { floor: 13, id: 'sword_silver', atk: 1800 },
  { floor: 17, id: 'sword_gold', atk: 2900 },
  { floor: 22, id: 'sword_diamond', atk: 4900 },
];

/** 盾：只生效最高档 */
export const SHIELDS = [
  { floor: 4, id: 'shield_wood', def: 60 },
  { floor: 10, id: 'shield_iron', def: 150 },
  { floor: 15, id: 'shield_silver', def: 300 },
  { floor: 19, id: 'shield_gold', def: 500 },
  { floor: 24, id: 'shield_diamond', def: 1250 },
];

/** 这一层（含本层的剑）之后的攻击力 */
export function atkOn(floor) {
  let atk = 100;
  for (const s of SWORDS) if (s.floor <= floor) atk = Math.max(atk, 100 + s.atk);
  return atk;
}

/** 这一层（含本层的盾）之后的防御力 */
export function defOn(floor) {
  let def = 50;
  for (const s of SHIELDS) if (s.floor <= floor) def = Math.max(def, 50 + s.def);
  return def;
}

/**
 * 每层的血量账本。
 *
 * 塔里的血量没有上限，只有一个数字：捡结晶把它加上去，打怪把它减下来。
 * 怪的攻击和防御不随血量变，所以每一层要挨的打是固定的，
 * 结晶给的血就等于"这一层要挨的打 + 净增长"：
 *   - 净增长（GROWTH）：打完这一层，血量比刚进来时多出来的那部分。
 *     1~25 层每层 +100，第 26 层起每层 +200，末层再给一大块，合计 67200。
 *   - 要挨的打（FLOOR_DAMAGE）：参考路线在这一层实际掉的血，实测值。
 * 两项一加，血量就只涨不跌：刚踏上第 30 层是 59800 血，
 * 打完第 30 层剩 68000 血，正好是魔王战要用的那 68000。
 */
const GROWTH = [
  0,
  600, 700, 800, 900, 1000, 1100, 1200, 1300, 1400, 1500,
  1600, 1700, 1800, 1900, 2000, 2100, 2200, 2300, 2400, 2500,
  2600, 2700, 2800, 2900, 3000,
  3200, 3400, 3600, 3800,
  8200,
];

/** 参考路线上每一层实际掉的血（第 30 层不含魔王那 56400） */
export const FLOOR_DAMAGE = [
  0,
  323, 724, 1018, 971, 1711, 2142, 2208, 3191, 3793, 2750, 4956, 5634, 9254, 7202, 4855, 8653, 8656, 10333, 7828, 12945, 13354, 12070, 15916, 13365, 17327, 17919, 18448, 19178, 19995, 20414,
];

/** 生命结晶给的血 = 这一层要挨的打 + 净增长 */
export function crystalOn(floor) {
  return (FLOOR_DAMAGE[floor] || 0) + (GROWTH[floor] || 0);
}

/** 刚踏上第 floor 层时的血量（参考血池） */
export function poolOn(floor) {
  let hp = 800;
  for (let f = 1; f < floor; f++) hp += GROWTH[f] || 0;
  return hp;
}

/**
 * 刚踏上第 floor 层时的玩家面板：身上的装备都来自下面的层，
 * 本层的东西还没拿到。巡逻怪按这个面板标定，所以刚进层就一定打得过。
 */
export function entryPanel(floor) {
  const below = floor - 1;
  return {
    atk: atkOn(below),
    def: defOn(below),
    hp: poolOn(floor),
  };
}

/**
 * 商店：7 家（楼层 6/10/14/18/22/26/29），每家卖同样三样东西 ——
 *   疗伤丹（加血）、磨刀石（加攻）、护心镜（加防）。
 *
 * 规则：
 *   1) 每样东西买一次加固定的数，加的数随楼层变高而变大（第 k 家商店给第 k 份量）；
 *   2) 没有库存限制，想买多少次买多少次；
 *   3) 每家商店自己一套价目表：第 6 层买过几次，不影响第 10 层那家的起步价；
 *   4) 同一家店里连买同一项，价格按 1.6 倍往上走（不是等差，是等比），买得越多越贵。
 *
 * 价目表是按金币产出标定的，不是随手拍的数字：
 *   玩家走到第 k 家商店时，累计能攒 SHOP_GOLD_BUDGET[k-1] 枚金币，
 *   一套（三样各买一次）要花的钱占家底的比例，从第 6 层的 48% 一路降到第 29 层的 8%。
 *   越往上家底越厚，一次能买得越多，所以高层商店是花钱的主战场。
 */
export const SHOP_FLOORS = [6, 10, 14, 18, 22, 26, 29];

/**
 * 走到每家商店时，玩家累计攒下的金币（参考路线把每层金币都捡完的实测值）。
 * verify.js 会重新扫一遍关卡，核对这个表跟关卡里实际掉的金币对得上。
 */
export const SHOP_GOLD_BUDGET = [2002, 5355, 10337, 18713, 30514, 47797, 60988];

/** 第 k 家商店的单位价系数（k = 1..7）：越往上单位越便宜，攒钱到高层买更划算 */
const SHOP_PRICE_SCALE = [1.3, 1.25, 1.2, 1.15, 1.1, 1.05, 1.0];

/** 三样东西的单位价：每点生命 / 每点攻击 / 每点防御，各是多少金 */
const SHOP_UNIT_PRICE = { hp: 0.2, atk: 5, def: 12 };

/** 同一家店里连买同一项，价格按这个倍数往上走（等比） */
export const SHOP_PRICE_RATIO = 1.6;

/**
 * 第 floor 层那家商店卖什么。
 * amount = 买一次加多少；base = 这家店的起步价（第一次买的价格）。
 */
export function shopPlan(floor) {
  const k = SHOP_FLOORS.indexOf(floor) + 1;      // 第几家商店（1 起）
  if (k < 1) return [];
  const s = SHOP_PRICE_SCALE[k - 1];
  return [
    { id: 'shop_heal', amount: 1000 * k, base: Math.round(SHOP_UNIT_PRICE.hp * 1000 * k * s) },
    { id: 'shop_atk',  amount: 50 * k,   base: Math.round(SHOP_UNIT_PRICE.atk * 50 * k * s) },
    { id: 'shop_def',  amount: 25 * k,   base: Math.round(SHOP_UNIT_PRICE.def * 25 * k * s) },
  ];
}

/** 在同一家店里已经买过 n 次之后，这一样东西下一次的价格 */
export function shopPrice(base, boughtHere) {
  return Math.round(base * Math.pow(SHOP_PRICE_RATIO, boughtHere));
}

/** 涨价计数的键：每家商店的三项各算各的，互不牵连 */
export function shopKey(floor, id) {
  return floor + ':' + id;
}

/**
 * 巡逻怪：待在房间里的怪（不是守在门洞上的看门怪）。
 * 每层 10 间大小不一的隔间，怪放在房间里的棋盘同色格 ——
 * 同色格互不相邻，所以不会有一对怪上下左右挨着。
 */
export function patrolCount(floor) {
  return 26;
}

/**
 * 一场巡逻战吃掉多少血。
 *
 * 守关怪一场吃 18%，巡逻怪小一号 —— 一层要打 26 场巡逻战，
 * 加上守关怪和守在门洞上的看门怪，整层的消耗才撑得起"路上处处要打"的节奏。
 *
 * 怪多了五倍，每一场的伤害就得摊薄成原来的 1/10 出头，
 * 否则一层掉的血会翻五倍，玩家根本爬不上去。
 *
 * 巡逻怪不再是"一种怪"，而是六种性格（PATROL_SPECIES）：
 * 回合数 / 每场消耗 / 防御比 / 掉金各不相同，
 * 但六种性格的平均消耗跟以前那个单一巡逻怪持平 —— 变的是节奏，不是难度。
 */
