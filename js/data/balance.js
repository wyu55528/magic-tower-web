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
 * 生命上限：每层一枚结晶。
 * 1~25 层每层 +100，第 26 层起每层 +200（末层再给一大块），
 * 合计 67200，正好把终局生命上限顶到 68000。
 */
export function crystalOn(floor) {
  if (floor === FLOOR_COUNT) return 8200;
  if (floor <= 25) return 600 + (floor - 1) * 100;
  return 3200 + (floor - 26) * 200;
}

/** 打完第 floor 层（含这层的结晶）之后的生命上限 */
export function maxHpOn(floor) {
  let hp = 800;
  for (let f = 1; f <= floor; f++) hp += crystalOn(f);
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
    maxHp: below <= 0 ? 800 : maxHpOn(below),
  };
}

/**
 * 巡逻怪：站在通路上拦路的怪（不是守在死胡同门口的那种）。
 * 数量随层数往上加，后半程路上基本一步一兵。
 */
export function patrolCount(floor) {
  return floor <= 15 ? 2 : 3;
}

/**
 * 一场巡逻战吃掉多少血上限。
 * 守关怪一场吃 18%，巡逻怪小一号，一场吃 8%——
 * 一层要打 2~3 场，加上守关怪和壁龛里的小怪，
 * 整层的消耗才撑得起"路上处处要打"的节奏。
 */
export const PATROL_DAMAGE_RATIO = 0.08;

/** 一场巡逻战打多少个回合 */
export const PATROL_ROUNDS = 5;
