/**
 * 道具图鉴。数值、文案、图标、价格全在这里，加道具不用改规则层。
 * 30 层塔的属性曲线是倒推出来的：
 *   剑 5 档 取最高档：铁剑 +300 → 青铜剑 +900 → 白银剑 +1800 → 黄金剑 +2900 → 钻石剑 +4900
 *   盾 5 档 取最高档：木盾 +60 → 铁盾 +150 → 银盾 +300 → 黄金盾 +500 → 钻石盾 +1250
 *   生命结晶逐层累加，合计 +67200
 *   终局面板 攻击 5000 / 防御 1300 / 生命上限 68000
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

  // ---- 生命结晶（生命上限，逐层累加；数值由各层 legend 覆盖）----
  // 捡到当场回满血：塔里没有药水，加血只有即时性，没有"存起来以后再喝"的东西
  life_crystal: { name: '生命结晶', type: 'heart', maxHp: 0, icon: '💠', desc: '提高生命上限，并回满血' },

  // ---- 怪物图鉴（第 1 层出口拾取，进了背包，按 B 可以随时打开）----
  monster_book: { name: '怪物图鉴', type: 'book', icon: '📖', desc: '查看当前层怪物的属性和战斗结论' },

  // ---- 传送卷轴（第 15 层拾取，进了背包，按 ↑ / ↓ 在楼梯旁边上下楼）----
  warp_scroll: { name: '传送卷轴', type: 'warp', icon: '📜', desc: '站在楼梯旁边时，按 ↑ / ↓ 可以上下楼' },

  // ---- 钥匙 ----
  key_yellow: { name: '黄钥匙', short: '黄', type: 'key', lock: 'yellow', icon: '🔑', desc: '打开一扇黄门' },
  key_blue:   { name: '蓝钥匙', short: '蓝', type: 'key', lock: 'blue',   icon: '🔑', desc: '打开一扇蓝门' },
  key_red:    { name: '红钥匙', short: '红', type: 'key', lock: 'red',    icon: '🔑', desc: '打开一扇红门' },

  // ---- 商店商品：买下当场生效，不进背包、不留存 ----
  //   疗伤丹：血立刻涨上去；磨刀石 / 护心镜：攻击力、防御力永久加到面板上
  shop_heal_1: { name: '疗伤丹 · 小', type: 'heal', heal: 1000, price: 150,  icon: '💊', desc: '立刻恢复 1000 点生命' },
  shop_heal_2: { name: '疗伤丹 · 中', type: 'heal', heal: 2500, price: 400,  icon: '💊', desc: '立刻恢复 2500 点生命' },
  shop_heal_3: { name: '疗伤丹 · 大', type: 'heal', heal: 5000, price: 1000, icon: '💊', desc: '立刻恢复 5000 点生命' },
  shop_atk:    { name: '磨刀石',     type: 'bonus', atk: 200, price: 2000, icon: '🪨', desc: '攻击力永久 +200（买下立刻生效）' },
  shop_def:    { name: '护心镜',     type: 'bonus', def: 100, price: 2000, icon: '🔰', desc: '防御力永久 +100（买下立刻生效）' },
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
