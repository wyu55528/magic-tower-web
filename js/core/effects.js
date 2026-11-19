import { ITEMS } from '../data/items.js';
import { MONSTERS } from '../data/monsters.js';
import { LOCK_NAMES } from '../data/tiles.js';
import { DEFAULT_SHOP_STOCK } from '../data/levels.js';
import { BASE_STATS } from './state.js';
import { resolveBattle } from './battle.js';

/**
 * 格子 -> 效果列表。
 * 所有机制（钥匙、装备、生命、商店、战斗）最终都收敛成效果，规则层只有一条执行路径。
 */
export function tileEffects(tile) {
  switch (tile.t) {
    case 'item': {
      const item = ITEMS[tile.id];
      if (!item) return [];
      if (item.type === 'key')    return [{ kind: 'giveKey', color: item.lock, count: 1 }];
      if (item.type === 'equip')  return [{ kind: 'equip', id: tile.id }];
      if (item.type === 'heart')  return [{ kind: 'addHp', id: tile.id, value: tile.hp }];
      if (item.type === 'book')   return [{ kind: 'giveItem', id: tile.id, count: 1 }];
      if (item.type === 'warp')   return [{ kind: 'giveItem', id: tile.id, count: 1 }];
      return [];
    }
    case 'gold':    return [{ kind: 'gold', value: tile.value }];
    case 'monster': return [{ kind: 'battle', id: tile.id }];
    case 'boss':    return [{ kind: 'battle', id: tile.id, boss: true }];
    case 'shop':    return [{ kind: 'openShop', stock: DEFAULT_SHOP_STOCK }];
    default:        return [];
  }
}

/** 按当前装备重算攻防（武器/防具取最高档，所以是替换而不是累加） */
export function recomputeStats(s) {
  // 商店买的磨刀石 / 护心镜是永久加攻加防，直接算进面板
  const bonus = s.bonus || { atk: 0, def: 0 };
  s.atk = BASE_STATS.atk + (s.gear.weapon ? s.gear.weapon.atk : 0) + (bonus.atk || 0);
  s.def = BASE_STATS.def + (s.gear.armor ? s.gear.armor.def : 0) + (bonus.def || 0);
}

const HANDLERS = {
  giveKey(s, p) {
    const count = p.count || 1;
    s.keys[p.color] = (s.keys[p.color] || 0) + count;
    return { events: [{ text: `获得 ${LOCK_NAMES[p.color]} ×${count}`, kind: 'item' }] };
  },

  giveItem(s, p) {
    const item = ITEMS[p.id];
    const count = p.count || 1;
    s.bag[p.id] = (s.bag[p.id] || 0) + count;
    const events = [{ text: `获得 ${item.name} ×${count}`, kind: 'item' }];
    // 怪物图鉴：捡到就直接翻开，之后按 B 可以随时再看
    if (item.type === 'book') {
      s.status = 'inBook';
      events.push({ text: '翻开怪物图鉴：可以查当前层怪物的属性和战斗结论。', kind: 'level' });
    }
    return { events };
  },

  // 装备只认最高档：拿到低档不生效，同档也不生效
  equip(s, p) {
    const item = ITEMS[p.id];
    const line = item.line;                       // 'weapon' / 'armor'
    const tier = item.tier || 1;
    const cur = s.gear[line];
    const kindName = line === 'weapon' ? '武器' : '防具';

    if (cur && cur.tier >= tier) {
      return {
        events: [{
          text: `已经有 ${cur.tier} 档的${kindName}了，${item.name} 无效。`,
          kind: 'info',
        }],
      };
    }

    s.gear[line] = {
      id: p.id,                 // 用格子上的道具 id；图鉴条目本身没有 id 字段
      tier,
      atk: item.atk || 0,
      def: item.def || 0,
    };
    recomputeStats(s);

    const detail = item.atk ? `攻击 +${item.atk}` : `防御 +${item.def}`;
    return { events: [{ text: `装备了 ${item.name}（${detail}，${tier} 档）`, kind: 'item' }] };
  },

  // 生命结晶：直接加血。
  // 塔里的血量没有上限，结晶给多少血，身上的血就多多少。
  addHp(s, p) {
    const item = ITEMS[p.id];
    const gain = p.value != null ? p.value : (item.hp || 0);
    if (gain <= 0) return { events: [] };
    s.hp += gain;
    return { events: [{ text: `获得 ${item.name}（生命 +${gain}，现在 ${s.hp}）`, kind: 'item' }] };
  },

  gold(s, p) {
    const value = p.value || 0;
    s.gold += value;
    return { events: [{ text: `获得 ${value} 金币`, kind: 'item' }] };
  },

  openShop(s, p) {
    s.status = 'inShop';
    s.shop = { stock: (p.stock || []).map((x) => ({ ...x })) };
    return {
      events: [{ text: '进入商店。', kind: 'level' }],
      interrupt: { kind: 'shop' },
    };
  },

  battle(s, p) {
    const mon = MONSTERS[p.id];
    const events = [];

    // 推开魔王房的门不会再回血：血量没有上限，就没有"满"可回。
    // 这一仗要打 48 回合、硬挨 56400 点伤害，中途没有任何补给，
    // 够不够血全看你一路攒了多少——魔王战是硬碰硬的一场。
    const res = resolveBattle({ hp: s.hp, atk: s.atk, def: s.def }, mon);
    res.log.forEach((text) => events.push({ text, kind: text.startsWith('你') ? 'hit' : 'hurt' }));
    s.hp = res.hpLeft;

    if (!res.win) {
      s.status = 'dead';
      events.push({ text: `你被 ${mon.name} 击败了……`, kind: 'death' });
      return { events, interrupt: { kind: 'dead' } };
    }

    s.gold += mon.gold || 0;
    events.push({ text: `击败 ${mon.name}，获得 ${mon.gold} 金币`, kind: 'kill' });

    if (p.boss) {
      s.status = 'win';
      events.push({ text: '魔王倒下了，塔的诅咒解除了！', kind: 'win' });
      return { events, interrupt: { kind: 'win' } };
    }
    return { events };
  },
};

/**
 * 执行一串效果。
 * 任何一步返回 interrupt 就中断（例如战斗失败、进入商店），此时格子不会标记为已结算。
 */
export function applyEffects(state, effects, tileKey) {
  const events = [];

  for (const eff of effects) {
    const handler = HANDLERS[eff.kind];
    if (!handler) continue;
    const result = handler(state, eff) || {};
    events.push(...(result.events || []));
    if (result.interrupt) return { events, interrupt: result.interrupt };
  }

  if (tileKey) state.taken[tileKey] = true;
  return { events, interrupt: null };
}
