import { LEVELS, getGrid, tileAt, landingNear } from '../data/levels.js';
import { LOCK_NAMES } from '../data/tiles.js';
import { ITEMS } from '../data/items.js';
import { tileEffects, applyEffects, recomputeStats } from './effects.js';
import { cloneState } from './state.js';

const DIRS = {
  up:    { x: 0,  y: -1 },
  down:  { x: 0,  y: 1 },
  left:  { x: -1, y: 0 },
  right: { x: 1,  y: 0 },
};

/**
 * 传送卷轴的生效范围：人站在楼梯格上，或者紧挨着楼梯格（上下左右）。
 *
 * 卷轴只在楼梯旁边有用，所以不在楼梯旁边时按 ↑ / ↓ 就是普通移动，
 * 而且不出任何提示 —— 没生效的东西不该刷屏。
 */
function stairReach(state) {
  const grid = getGrid(state.level);
  const at = (x, y) => (grid[y] && grid[y][x]) || null;
  const isStair = (t) => !!t && (t.t === 'stairUp' || t.t === 'stairDown');
  if (isStair(at(state.pos.x, state.pos.y))) return true;
  for (const d of Object.values(DIRS)) {
    if (isStair(at(state.pos.x + d.x, state.pos.y + d.y))) return true;
  }
  return false;
}

/**
 * 唯一改变世界的地方。
 * step(state, action) -> { state, events }
 * 输入状态不会被修改；events 是给表现层播日志用的。
 */
export function step(state, action) {
  // 商店里：可以买、关店、或者用方向键直接走人
  if (state.status === 'inShop') {
    if (action.type === 'BUY') return doBuy(state, action.itemId);
    if (action.type === 'CLOSE_SHOP') return doCloseShop(state);
    if (action.type === 'USE_ITEM') return doUseItem(state, action.itemId);
    if (action.type === 'MOVE') {
      const s = cloneState(state);
      s.status = 'playing';
      s.shop = null;
      return doMove(s, action.dir);
    }
    return { state, events: [] };
  }

  // 怪物图鉴打开时：可以合上它、或者直接用方向键走人
  if (state.status === 'inBook') {
    if (action.type === 'CLOSE_BOOK') return doCloseBook(state);
    if (action.type === 'USE_ITEM') return doUseItem(state, action.itemId);
    if (action.type === 'MOVE') {
      const s = cloneState(state);
      s.status = 'playing';
      return doMove(s, action.dir);
    }
    return { state, events: [] };
  }

  if (state.status !== 'playing') return { state, events: [] };

  switch (action.type) {
    case 'MOVE':     return doMove(state, action.dir);
    case 'USE_ITEM': return doUseItem(state, action.itemId);
    default:         return { state, events: [] };
  }
}

function doMove(state, dir) {
  const s = cloneState(state);
  const d = DIRS[dir];
  if (!d) return { state: s, events: [] };

  const events = [];

  // 传送卷轴：背包里有卷轴 + 人在楼梯格上或紧挨着楼梯格 → ↑ / ↓ 直接上下楼。
  // 越界（顶层按 ↑、底层按 ↓）或者落点不存在，就退回普通移动，同样不提示。
  if ((dir === 'up' || dir === 'down') && (s.bag.warp_scroll || 0) > 0 && stairReach(s)) {
    const target = dir === 'up' ? s.level + 1 : s.level - 1;
    const landing = target >= 0 && target < LEVELS.length
      ? landingNear(target, dir === 'up' ? '<' : '>')
      : null;
    if (landing) {
      s.level = target;
      s.pos = { x: landing.x, y: landing.y };
      s.steps += 1;
      events.push({ text: `📜 传送卷轴：${LEVELS[target].name}`, kind: 'level' });
      return { state: s, events };
    }
  }

  const nx = s.pos.x + d.x;
  const ny = s.pos.y + d.y;
  const target = tileAt(s.level, nx, ny);

  // 撞墙不提示：按方向键只是没走成，不用刷屏
  if (!target || target.t === 'wall') {
    return { state: s, events: [] };
  }

  // 门：没开过就先查钥匙
  if (target.t === 'door') {
    const doorKey = `${s.level}:${nx},${ny}`;
    if (!s.openDoors[doorKey]) {
      if ((s.keys[target.lock] || 0) > 0) {
        s.keys[target.lock] -= 1;
        s.openDoors[doorKey] = true;
        events.push({ text: `用掉 1 把${LOCK_NAMES[target.lock]}，门打开了。`, kind: 'open' });
      } else {
        events.push({ text: `这扇门需要${LOCK_NAMES[target.lock]}。`, kind: 'warn' });
        return { state: s, events };
      }
    }
  }

  // 走进去
  s.pos = { x: nx, y: ny };
  s.steps += 1;

  // 楼梯：换层，落点自动对齐对层楼梯（往上落到对层 '<'，往下落到对层 '>'）
  if (target.t === 'stairUp') {
    const next = s.level + 1;
    if (next >= LEVELS.length) {
      events.push({ text: '这已经是最高层了。', kind: 'info' });
      return { state: s, events };
    }
    const landing = landingNear(next, '<');
    s.level = next;
    s.pos = { x: landing.x, y: landing.y };
    events.push({ text: `进入 ${LEVELS[next].name}`, kind: 'level' });
    return { state: s, events };
  }

  if (target.t === 'stairDown') {
    const prev = s.level - 1;
    if (prev < 0) {
      events.push({ text: '这里已经是最底层了。', kind: 'info' });
      return { state: s, events };
    }
    const landing = landingNear(prev, '>');
    s.level = prev;
    s.pos = { x: landing.x, y: landing.y };
    events.push({ text: `返回 ${LEVELS[prev].name}`, kind: 'level' });
    return { state: s, events };
  }

  // 普通格子：效果只结算一次
  const tileKey = `${s.level}:${nx},${ny}`;
  if (s.taken[tileKey]) return { state: s, events };

  const effects = tileEffects(target);
  if (!effects.length) return { state: s, events };

  const result = applyEffects(s, effects, tileKey);
  events.push(...result.events);
  return { state: s, events };
}

function doCloseBook(state) {
  const s = cloneState(state);
  s.status = 'playing';
  return { state: s, events: [] };
}

/**
 * 买商店里的东西。
 *
 * 规则：买下当场生效，不进背包。
 *   疗伤丹 —— 血立刻涨上去；
 *   磨刀石 / 护心镜 —— 攻击力、防御力永久加到面板上。
 * 所以商店里没有"买来存着以后再喝"的东西：加血只有即时性。
 */
function doBuy(state, itemId) {
  const s = cloneState(state);
  const events = [];

  if (!s.shop) { s.status = 'playing'; return { state: s, events }; }

  const entry = s.shop.stock.find((x) => x.id === itemId);
  const item = ITEMS[itemId];
  if (!entry || !item || entry.count <= 0) {
    events.push({ text: '这件商品已经卖完了。', kind: 'warn' });
    return { state: s, events };
  }
  if (s.gold < item.price) {
    events.push({ text: `金币不够，还差 ${item.price - s.gold} 枚。`, kind: 'warn' });
    return { state: s, events };
  }

  // 回血：当场生效，不进背包；血已经满了就别花这个钱
  if (item.type === 'heal') {
    if (s.hp >= s.maxHp) {
      events.push({ text: '生命值已经满了，买药没意义。', kind: 'warn' });
      return { state: s, events };
    }
    const heal = Math.min(item.heal, s.maxHp - s.hp);
    s.gold -= item.price;
    entry.count -= 1;
    s.hp += heal;
    events.push({ text: `买下 ${item.name}，恢复了 ${heal} 点生命。`, kind: 'heal' });
    return { state: s, events };
  }

  // 加攻 / 加防：永久，直接算进面板
  if (item.type === 'bonus') {
    s.gold -= item.price;
    entry.count -= 1;
    if (item.atk) {
      s.bonus.atk += item.atk;
      recomputeStats(s);
      events.push({ text: `买下 ${item.name}，攻击力 +${item.atk}（现在是 ${s.atk}）。`, kind: 'item' });
    }
    if (item.def) {
      s.bonus.def += item.def;
      recomputeStats(s);
      events.push({ text: `买下 ${item.name}，防御力 +${item.def}（现在是 ${s.def}）。`, kind: 'item' });
    }
    return { state: s, events };
  }

  events.push({ text: `${item.name} 买不了。`, kind: 'warn' });
  return { state: s, events };
}

function doCloseShop(state) {
  const s = cloneState(state);
  s.status = 'playing';
  s.shop = null;
  return { state: s, events: [{ text: '离开了商店。', kind: 'info' }] };
}

function doUseItem(state, itemId) {
  const s = cloneState(state);
  const events = [];
  const item = ITEMS[itemId];

  if (!item) return { state: s, events };
  // 怪物图鉴：不是"用掉"，是翻开
  if (item.type === 'book') {
    s.status = 'inBook';
    events.push({ text: '翻开了怪物图鉴。', kind: 'info' });
    return { state: s, events };
  }
  // 背包里剩下的两样（怪物图鉴、传送卷轴）都不是"按一下就生效"的东西
  events.push({ text: `${item.name} 无法直接使用。`, kind: 'info' });
  return { state: s, events };
}
