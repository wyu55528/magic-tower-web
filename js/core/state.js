// 地图从 15×15 改成 13×13 的九间房结构，旧存档的坐标跟新地图对不上，
// 版本号 +1 让旧存档直接读不出来（读档会提示「没有找到本地存档」）。
export const STATE_VERSION = 9;

/**
 * 基础属性。
 * 武器和防具是"取最高档替换"（低档拾取无效）。
 * 血量没有上限：hp 就是身上所有的血，捡生命结晶、买疗伤丹把它加上去，
 * 战斗只把它减下来。
 */
export const BASE_STATS = { atk: 100, def: 50, hp: 800 };

/** 新游戏初始状态。pos 由关卡的出生点填入。 */
export function createInitialState(start) {
  return {
    version: STATE_VERSION,
    level: 0,
    pos: { x: start.x, y: start.y },
    hp: BASE_STATS.hp,
    atk: BASE_STATS.atk,
    def: BASE_STATS.def,
    gold: 0,
    keys: { yellow: 0, blue: 0, red: 0 },
    bag: {},       // 道具 id -> 数量（只有怪物图鉴和传送卷轴）
    gear: {       // 武器/防具各一个槽，只保留最高档
      weapon: null,   // { id, tier, atk }
      armor: null,    // { id, tier, def }
    },
    flags: {},     // 预留：剧情/机关开关
    openDoors: {}, // "层:x,y" -> true，已开过的门不再扣钥匙
    taken: {},     // "层:x,y" -> true，一次性效果已结算
    bonus: { atk: 0, def: 0 },   // 商店买的永久加攻/加防（直接算进面板）
    bought: {},     // 商店涨价计数："层:商品" -> 在这家店里买过几次（每家店各算各的）
    shop: null,    // 进入商店时：{ floor, stock: [{id,amount,base,price,next}] }
    steps: 0,
    status: 'playing', // playing | inShop | inBook | dead | win
  };
}

/** 深拷贝。reducer 只改副本，原状态永不被就地修改。 */
export function cloneState(s) {
  return {
    ...s,
    pos: { ...s.pos },
    keys: { ...s.keys },
    bag: { ...s.bag },
    gear: {
      weapon: s.gear && s.gear.weapon ? { ...s.gear.weapon } : null,
      armor: s.gear && s.gear.armor ? { ...s.gear.armor } : null,
    },
    flags: { ...s.flags },
    openDoors: { ...s.openDoors },
    taken: { ...s.taken },
    bonus: { ...s.bonus },
    bought: { ...(s.bought || {}) },
    shop: s.shop ? { floor: s.shop.floor, stock: s.shop.stock.map((x) => ({ ...x })) } : null,
  };
}
