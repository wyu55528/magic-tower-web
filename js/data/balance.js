/**
 * 全塔的数值底表：剑盾档位、每层生命结晶、玩家面板推算。
 *
 * 这份表是唯一的"事实来源"：
 *   - 关卡生成器（tools/gen-levels.mjs）用它决定每层摆什么、给多少生命结晶；
 *   - 怪物表（js/data/monsters.js）用它反推"巡逻怪"的数值；
 *   - README 里那张 30 行的数值表也是照它排出来的。
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
  329, 572, 858, 809, 1481, 1886, 1754, 2815, 3339, 3444,
  4406, 5049, 4699, 6454, 6452, 9317, 10719, 11223, 9844, 14196,
  14772, 13542, 17410, 9819, 19383, 20079, 20799, 21567, 22383, 23247,
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
    hp: below <= 0 ? 800 : poolOn(below),
  };
}

/**
 * 商店：7 家（楼层 6/10/14/18/22/26/29），每家卖同样三样东西 ——
 *   疗伤丹（加血）、磨刀石（加攻）、护心镜（加防）。
 *
 * 规则：
 *   1) 每样东西买一次加固定的数，加的数随楼层变高而变大（第 k 家商店给第 k 份量）；
 *   2) 没有库存限制，想买多少次买多少次；
 *   3) 每买一次，同一样东西的价格就往上抬一格（抬多少见 step），
 *      三个计数器各算各的：买了磨刀石不会影响疗伤丹的价格。
 */
export const SHOP_FLOORS = [6, 10, 14, 18, 22, 26, 29];

/**
 * 第 floor 层那家商店卖什么。
 * amount = 买一次加多少；base = 起步价；step = 每买一次涨价多少。
 * 起步价也随楼层涨，但涨得比数值慢，所以越高层越划算。
 */
export function shopPlan(floor) {
  const k = SHOP_FLOORS.indexOf(floor) + 1;      // 第几家商店（1 起）
  if (k < 1) return [];
  return [
    { id: 'shop_heal', amount: 1000 * k, base: 300 + 100 * (k - 1), step: 400 },
    { id: 'shop_atk',  amount: 50 * k,   base: 600 + 150 * (k - 1), step: 700 },
    { id: 'shop_def',  amount: 25 * k,   base: 400 + 120 * (k - 1), step: 500 },
  ];
}

/**
 * 巡逻怪：站在通路上拦路的怪（不是守在死胡同门口的那种）。
 * 数量随层数往上加，后半程路上基本一步一兵。
 */
export function patrolCount(floor) {
  return floor <= 15 ? 2 : 3;
}

/**
 * 一场巡逻战吃掉多少血。
 * 守关怪一场吃 18%，巡逻怪小一号，一场吃 8%——
 * 一层要打 2~3 场，加上守关怪和壁龛里的小怪，
 * 整层的消耗才撑得起"路上处处要打"的节奏。
 */
export const PATROL_DAMAGE_RATIO = 0.08;

/** 一场巡逻战打多少个回合 */
export const PATROL_ROUNDS = 5;
