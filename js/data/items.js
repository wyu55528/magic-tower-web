/**
 * 道具图鉴。数值、文案、图标、价格全在这里，加道具不用改规则层。
 * 30 层塔的属性曲线是倒推出来的：
 *   剑 5 档 取最高档：铁剑 +300 → 青铜剑 +900 → 白银剑 +1800 → 黄金剑 +2900 → 钻石剑 +4900
 *   盾 5 档 取最高档：木盾 +60 → 铁盾 +150 → 银盾 +300 → 黄金盾 +500 → 钻石盾 +1250
 *   生命结晶逐层加血，净增长合计 +67200
 *   商店每家卖三样（加血 / 加攻 / 加防），买一次加固定的数；
 *   每家商店自己一套价目表，同一家店里连买同一项就越来越贵
 *   终局面板 攻击 5000 / 防御 1300，魔王战前 68000 血，打完剩 11600
 */
export const ITEMS = {
  // ---- 武器（攻击）5 档：只生效最高档，拾取低档无效 ----
  sword_iron     : { name: '铁剑', type: 'equip', line: 'weapon', tier: 1, atk: 300, icon: '⚔️', desc: '攻击力 +300（1 档）' },
  sword_bronze   : { name: '青铜剑', type: 'equip', line: 'weapon', tier: 2, atk: 900, icon: '⚔️', desc: '攻击力 +900（2 档）' },
  sword_silver   : { name: '白银剑', type: 'equip', line: 'weapon', tier: 3, atk: 1800, icon: '⚔️', desc: '攻击力 +1800（3 档）' },
  sword_gold     : { name: '黄金剑', type: 'equip', line: 'weapon', tier: 4, atk: 2900, icon: '⚔️', desc: '攻击力 +2900（4 档）' },
  sword_diamond  : { name: '钻石剑', type: 'equip', line: 'weapon', tier: 5, atk: 4900, icon: '🗡️', desc: '攻击力 +4900（5 档）' },

  // ---- 防具（防御）5 档：只生效最高档 ----
  shield_wood    : { name: '木盾', type: 'equip', line: 'armor', tier: 1, def: 60, icon: '🛡️', desc: '防御力 +60（1 档）' },
  shield_iron    : { name: '铁盾', type: 'equip', line: 'armor', tier: 2, def: 150, icon: '🛡️', desc: '防御力 +150（2 档）' },
  shield_silver  : { name: '银盾', type: 'equip', line: 'armor', tier: 3, def: 300, icon: '🛡️', desc: '防御力 +300（3 档）' },
  shield_gold    : { name: '黄金盾', type: 'equip', line: 'armor', tier: 4, def: 500, icon: '🛡️', desc: '防御力 +500（4 档）' },
  shield_diamond : { name: '钻石盾', type: 'equip', line: 'armor', tier: 5, def: 1250, icon: '🛡️', desc: '防御力 +1250（5 档）' },

  // ---- 生命结晶（直接加血；数值由各层 legend 覆盖）----
  // 塔里的血量没有上限：结晶给多少，血量就多多少
  life_crystal: { name: '生命结晶', type: 'heart', hp: 0, icon: '💠', desc: '直接增加生命值' },

  // ---- 怪物图鉴（第 1 层出口拾取，进了背包，按 B 可以随时打开）----
  monster_book: { name: '怪物图鉴', type: 'book', icon: '📖', desc: '查看当前层怪物的属性和战斗结论' },

  // ---- 传送卷轴（第 15 层拾取，进了背包，按 ↑ / ↓ 在楼梯旁边上下楼）----
  warp_scroll: { name: '传送卷轴', type: 'warp', icon: '📜', desc: '站在楼梯旁边时，按 ↑ / ↓ 可以上下楼' },

  // ---- 钥匙 ----
  key_yellow: { name: '黄钥匙', short: '黄', type: 'key', lock: 'yellow', icon: '🔑', desc: '打开一扇黄门' },
  key_blue:   { name: '蓝钥匙', short: '蓝', type: 'key', lock: 'blue',   icon: '🔑', desc: '打开一扇蓝门' },
  key_red:    { name: '红钥匙', short: '红', type: 'key', lock: 'red',    icon: '🔑', desc: '打开一扇红门' },

  // ---- 商店商品：买下当场生效，不进背包、不留存 ----
  //   加多少、价格多少都由「这家商店在第几层 + 这一项在这家买过几次」算出来，
  //   所以这里只放名字、种类和图标，数值在 js/data/balance.js 的 shopPlan() 里。
  shop_heal: { name: '疗伤丹', type: 'heal',  line: 'hp',  icon: '💊', desc: '回复生命值' },
  shop_atk:  { name: '磨刀石', type: 'bonus', line: 'atk', icon: '🪨', desc: '攻击力永久增加' },
  shop_def:  { name: '护心镜', type: 'bonus', line: 'def', icon: '🔰', desc: '防御力永久增加' },
};

export const ITEM_LIST = Object.keys(ITEMS);

/** 背包条目（只有怪物图鉴和传送卷轴会进背包：装备即时生效，钥匙单独计数） */
export function bagEntries(state) {
  return ITEM_LIST
    .filter((id) => state.bag[id] > 0)
    .map((id, index) => ({
      slot: index + 1,
      id,
      count: state.bag[id],
      item: ITEMS[id],
    }));
}
