/**
 * 无头求解器 + 关卡结构校验。
 *
 * 直接跑纯规则层（完全不启动浏览器），验证三件事：
 *   1. 关卡地图结构合法：宽度一致、楼梯只能从门进、开门钥匙必须先打守关怪、
 *      装备档位齐全且递增、传送卷轴的位置、图鉴只列当前层的怪
 *   2. 存在一条通关路线：走完 30 层并打死 20 万血的魔王
 *   3. 终局面板与设计值一致
 *
 * 运行： node tools/verify.js
 * 导出通关路线： node tools/verify.js --emit
 */
import { LEVELS, getGrid, findCharInLevel, monsterIdsOnLevel, landingNear } from '../js/data/levels.js';
import { ITEMS } from '../js/data/items.js';
import { TILE_CHARS } from '../js/data/tiles.js';
import { MONSTERS } from '../js/data/monsters.js';
import { createInitialState, BASE_STATS } from '../js/core/state.js';
import { FLOOR_DAMAGE, crystalOn, shopPlan, shopPrice, SHOP_FLOORS, SHOP_GOLD_BUDGET, SHOP_PRICE_RATIO } from '../js/data/balance.js';
import { step } from '../js/core/reducer.js';
import { resolveBattle, previewFight } from '../js/core/battle.js';
import { writeFileSync } from 'node:fs';

const DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]];
const DIR_NAME = { '0,-1': 'up', '0,1': 'down', '-1,0': 'left', '1,0': 'right' };

/** 设计目标：终局面板与魔王参数（hp = 魔王战开打前身上的血） */
const TARGET = { atk: 5000, def: 1300, hp: 68000 };
const WARP_FLOOR = 15;              // 传送卷轴所在的层号（1 起）

/**
 * 传送卷轴所在的那一格。
 *
 * 参考路线必须绕开它：卷轴一旦进背包，玩家在楼梯旁边按 ↑ / ↓ 会被卷轴
 * 传送到别的层，整条路线就乱了（浏览器回放和规则层对不上）。
 */
const WARP_CELL = (() => {
  let hit = null;
  LEVELS.forEach((level, i) => {
    getGrid(i).forEach((row, y) => row.forEach((t, x) => {
      if (t.t === 'item' && t.id === 'warp_scroll') hit = { level: i, x, y };
    }));
  });
  return hit;
})();

let failures = [];
function check(name, cond, detail = '') {
  console.log(`${cond ? '  OK  ' : ' FAIL '} ${name}${detail ? '  — ' + detail : ''}`);
  if (!cond) failures.push(name + (detail ? ': ' + detail : ''));
}

/* ---- 房间结构：从地图几何反推（每层大小不一样，不再是固定网格） ---- */

/**
 * 一层地图的布局：
 *   门洞 = 能走、而且左右（或上下）各挨着一个格子的过道格；
 *   房间 = 去掉门洞之后，剩下的连通块（每间房是一个填满的矩形）。
 * 这样不管房间多大、怎么排，都能从地图本身认出来。
 */
function analyzeLayout(grid) {
  const H = grid.length, W = grid[0].length;
  const D2 = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  const open = (x, y) => (x < 0 || y < 0 || y >= H || x >= W) ? false : grid[y][x].t !== 'wall';

  // 走廊格：处在 1 格宽的通道里 ——
  //   上下都是墙 = 横着的一条路；左右都是墙 = 竖着的一条路。
  // 房间不是走廊：房间至少两格宽，上下左右都有邻居。
  const isCorridor = Array.from({ length: H }, () => new Array(W).fill(false));
  const corridorCells = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!open(x, y)) continue;
      const up = open(x, y - 1), down = open(x, y + 1);
      const left = open(x - 1, y), right = open(x + 1, y);
      const flat = !up && !down;        // 横着的路
      const tall = !left && !right;    // 竖着的路
      if (!flat && !tall) continue;
      if (!(up || down || left || right)) continue;   // 四面全墙，孤零零一格
      isCorridor[y][x] = true;
      corridorCells.push({ x, y });
    }
  }

  // 房间 = 去掉走廊格之后剩下的连通块（每间房是一个填满的矩形）
  const roomOf = Array.from({ length: H }, () => new Array(W).fill(-1));
  const rooms = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!open(x, y) || isCorridor[y][x] || roomOf[y][x] >= 0) continue;
      const id = rooms.length;
      const cells = [];
      const stack = [[x, y]];
      roomOf[y][x] = id;
      while (stack.length) {
        const [cx, cy] = stack.pop();
        cells.push({ x: cx, y: cy });
        for (const [dx, dy] of D2) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || ny >= H || nx >= W) continue;
          if (!open(nx, ny) || isCorridor[ny][nx] || roomOf[ny][nx] >= 0) continue;
          roomOf[ny][nx] = id;
          stack.push([nx, ny]);
        }
      }
      const xs = cells.map((c) => c.x), ys = cells.map((c) => c.y);
      rooms.push({
        id, cells,
        x: Math.min(...xs), y: Math.min(...ys),
        w: Math.max(...xs) - Math.min(...xs) + 1,
        h: Math.max(...ys) - Math.min(...ys) + 1,
      });
    }
  }

  // 每个房间的「下门」「上门」：贴着自己下墙 / 上墙的那一格走廊。
  // 下门 = 进门的地方（锁着的门 / 看门怪就站在这一格）；
  // 上门 = 通往上一层走廊的那一格。
  const entranceAt = (r, y) => {
    if (y < 0 || y >= H) return null;
    for (let x = r.x; x < r.x + r.w; x++) {
      if (isCorridor[y][x]) return { x, y };
    }
    return null;
  };
  const roomDown = rooms.map((r) => entranceAt(r, r.y + r.h));
  const roomUp = rooms.map((r) => entranceAt(r, r.y - 1));

  // 图：房间 + 走廊格，相邻就连一条边。这张图必须是一棵树 ——
  // 有分叉、没环路，才说明楼层真的像一棵树，而不是一片互相串通的走廊网。
  const nodeOf = (x, y) => {
    const rid = roomOf[y][x];
    if (rid >= 0) return 'r' + rid;
    return isCorridor[y][x] ? 'c' + x + ',' + y : null;
  };
  const edges = new Set();
  const addEdge = (a, b) => edges.add(a < b ? a + '|' + b : b + '|' + a);
  for (const c of corridorCells) {
    const me = nodeOf(c.x, c.y);
    for (const [dx, dy] of D2) {
      const nx = c.x + dx, ny = c.y + dy;
      if (!open(nx, ny)) continue;
      const other = nodeOf(nx, ny);
      if (!other) continue;
      addEdge(me, other);
    }
  }

  return { grid, isCorridor, corridorCells, rooms, roomOf, roomDown, roomUp, edges, H, W };
}

/**
 * 这间房算不算「上锁的房」：每个门口都被怪或者锁着的门堵住了。
 * 这样的房里放着好东西，不打怪就进不去。
 */
function roomIsSealed(L, roomId) {
  // 这间房的入口就是它下墙那一格（下门）：锁着的门或者看门怪就站在那儿
  const d = L.roomDown[roomId];
  if (!d) return false;
  const t = L.grid[d.y][d.x];
  return t.t === 'monster' || t.t === 'boss' || t.t === 'door';
}

/** 这一层所有上锁的房（返回房间编号集合） */
function sealedRoomsOf(L) {
  const set = new Set();
  for (const room of L.rooms) {
    if (roomIsSealed(L, room.id)) set.add(room.id);
  }
  return set;
}

/**
 * 从 from 走到 to 的一串方向（只避开墙）。
 * 怪也算能走 —— 踩上去打一架；门也算能走 —— 有钥匙就能开。
 */
function walkPath(grid, from, to) {
  const H = grid.length, W = grid[0].length;
  const prev = new Map();
  const q = [from];
  const seen = new Set([from.x + ',' + from.y]);
  while (q.length) {
    const cur = q.shift();
    if (cur.x === to.x && cur.y === to.y) break;
    for (const [dx, dy] of DIRS) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (nx < 0 || ny < 0 || ny >= H || nx >= W) continue;
      if (grid[ny][nx].t === 'wall') continue;
      const k = nx + ',' + ny;
      if (seen.has(k)) continue;
      seen.add(k);
      prev.set(k, cur);
      q.push({ x: nx, y: ny });
    }
  }
  const path = [];
  let cur = to;
  while (!(cur.x === from.x && cur.y === from.y)) {
    const prevCell = prev.get(cur.x + ',' + cur.y);
    if (!prevCell) return null;
    path.unshift(DIR_NAME[(cur.x - prevCell.x) + ',' + (cur.y - prevCell.y)]);
    cur = prevCell;
  }
  return path;
}

/** 朝目标走一步的方向 */
function stepToward(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y;
  if (dx !== 0) return dx > 0 ? 'right' : 'left';
  if (dy !== 0) return dy > 0 ? 'down' : 'up';
  return null;
}

/* ------------------------------------------------------------------ */
/* 1. 关卡结构校验                                                     */
/* ------------------------------------------------------------------ */

/** 从起点 BFS，可把某类格子当成墙 */
function reachable(state, blockedKind) {
  const kinds = Array.isArray(blockedKind) ? blockedKind : [blockedKind];
  const grid = getGrid(state.level);
  const H = grid.length, W = grid[0].length;
  const seen = new Set();
  const queue = [[state.pos.x, state.pos.y]];
  seen.add(state.pos.x + ',' + state.pos.y);
  while (queue.length) {
    const [x, y] = queue.shift();
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || ny >= H || nx >= W) continue;
      const k = nx + ',' + ny;
      if (seen.has(k)) continue;
      const t = grid[ny][nx];
      if (t.t === 'wall') continue;
      if (kinds.includes('door') && t.t === 'door') continue;
      if (kinds.includes('monster') && (t.t === 'monster' || t.t === 'boss')) continue;
      seen.add(k);
      queue.push([nx, ny]);
    }
  }
  return seen;
}

/** 格子的上下左右邻居（地图内且不是墙） */
function neighborsOf(levelIndex, x, y) {
  const grid = getGrid(levelIndex);
  const out = [];
  for (const [dx, dy] of DIRS) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || ny >= grid.length || nx >= grid[0].length) continue;
    if (grid[ny][nx].t === 'wall') continue;
    out.push(nx + ',' + ny);
  }
  return out;
}

function checkLevels() {
  console.log('\n=== 1. 关卡结构校验 ===');
  check('塔高 30 层', LEVELS.length === 30, `实际 ${LEVELS.length} 层`);

  // 地图宽固定 17，高随树的高度变（每层房间树深浅不一样）
  const badSize = LEVELS.map((l, i) => ({ l, i }))
    .filter(({ l }) => l.rows[0].length !== 17 || l.rows.length < 14 || l.rows.length > 21);
  check('30 层地图都是 17 宽，高 14~21', badSize.length === 0,
    badSize.map(({ l, i }) => `第 ${i + 1} 层 ${l.rows.length}×${l.rows[0].length}`).join(' '));

  LEVELS.forEach((level, i) => {
    const width = level.rows[0].length;
    const badRow = level.rows.findIndex((r) => r.length !== width);
    check(`第 ${i + 1} 层每行宽度一致 (${width})`, badRow < 0,
      badRow < 0 ? '' : `第 ${badRow + 1} 行长度 ${level.rows[badRow].length}`);

    const downs = level.rows.join('').split('>').length - 1;
    const ups = level.rows.join('').split('<').length - 1;
    const wantDown = i < LEVELS.length - 1 ? 1 : 0;
    const wantUp = i === 0 ? 0 : 1;
    check(`第 ${i + 1} 层楼梯数量`, downs === wantDown && ups === wantUp, `↓${downs} ↑${ups}`);
  });

  // 图鉴引用完整性
  LEVELS.forEach((level, i) => {
    const grid = getGrid(i);
    const bad = [];
    grid.forEach((row, y) => row.forEach((t, x) => {
      if ((t.t === 'monster' || t.t === 'boss') && !MONSTERS[t.id]) bad.push(`${t.id}@(${x},${y})`);
      if (t.t === 'item' && !ITEMS[t.id]) bad.push(`${t.id}@(${x},${y})`);
    }));
    check(`第 ${i + 1} 层引用的道具/怪物都在图鉴表里`, bad.length === 0, bad.join(' '));
  });


  // ---- 怪物图鉴书：全塔一本，放在第 1 层出口（书 → 门 → 下楼楼梯）----
  const bookCells = [];
  LEVELS.forEach((level, i) => {
    const grid = getGrid(i);
    grid.forEach((row, y) => row.forEach((t, x) => {
      if (t.t === 'item' && t.id === 'monster_book') bookCells.push({ level: i, x, y });
    }));
  });
  check('怪物图鉴书全塔只有 1 本', bookCells.length === 1, `实际 ${bookCells.length} 本`);
  check('怪物图鉴书在第 1 层', bookCells.length === 1 && bookCells[0].level === 0,
    bookCells.length === 1 ? `实际在第 ${bookCells[0].level + 1} 层` : '');
  if (bookCells.length === 1) {
    const b = bookCells[0];
    const g1 = getGrid(0);
    let door = null, stair = null;
    g1.forEach((row, y) => row.forEach((t, x) => {
      if (t.t === 'door') door = { x, y };
      if (t.t === 'stairUp') stair = { x, y };
    }));
    const manhattan = (a, c) => Math.abs(a.x - c.x) + Math.abs(a.y - c.y);
    const aligned = (a, c) => (a.x === c.x) !== (a.y === c.y);   // 同一行或同一列
    check('怪物图鉴书就放在第 1 层那扇锁着的门外面一格（进门就捡得到）',
      !!door && manhattan(b, door) === 1 && aligned(b, door),
      `书 (${b.x},${b.y}) 门 (${door ? door.x : '-'},${door ? door.y : '-'})`);
    check('上楼梯离锁着的门至少隔一格（不会一进门就换层）',
      !!door && !!stair && manhattan(door, stair) >= 2,
      `门 (${door ? door.x : '-'},${door ? door.y : '-'}) 楼梯 (${stair ? stair.x : '-'},${stair ? stair.y : '-'})`);
    check('怪物图鉴是可翻开的道具（type = book）',
      ITEMS.monster_book && ITEMS.monster_book.type === 'book', JSON.stringify(ITEMS.monster_book));
  }

  // ---- 传送卷轴：全塔一个，在第 15 层，是可拾取物品 ----
  const warpCells = [];
  LEVELS.forEach((level, i) => {
    const grid = getGrid(i);
    grid.forEach((row, y) => row.forEach((t, x) => {
      if (t.t === 'item' && t.id === 'warp_scroll') warpCells.push({ level: i, x, y });
    }));
  });
  check('传送卷轴全塔只有 1 个', warpCells.length === 1, `实际 ${warpCells.length} 个`);
  check(`传送卷轴在第 ${WARP_FLOOR} 层`,
    warpCells.length === 1 && warpCells[0].level === WARP_FLOOR - 1,
    warpCells.length === 1 ? `实际在第 ${warpCells[0].level + 1} 层` : '');
  check('传送卷轴是道具表里的 warp 类型',
    ITEMS.warp_scroll && ITEMS.warp_scroll.type === 'warp', JSON.stringify(ITEMS.warp_scroll));
  check('地图里已经没有跨层阶梯格（传送改成可拾取物品）',
    LEVELS.every((level, i) => getGrid(i).every((row) => row.every((t) => t.t !== 'teleport'))));

  // ---- 怪物图鉴：只列当前层的怪 ----
  const firstLayerMonsters = monsterIdsOnLevel(0);
  check('第 1 层图鉴只列本层的 10 种怪（守关怪 + 3 只看门怪 + 6 种巡逻怪）',
    firstLayerMonsters.length === 10 &&
    firstLayerMonsters.includes('guard_1') &&
    firstLayerMonsters.includes('imp_1') &&
    firstLayerMonsters.includes('spr_1') &&
    firstLayerMonsters.includes('hound_1') &&
    ['a', 'b', 'c', 'd', 'e', 'f'].every((k) => firstLayerMonsters.includes('patrol_' + k + '_1')),
    firstLayerMonsters.join(', '));
  const lastLayerMonsters = monsterIdsOnLevel(LEVELS.length - 1);
  check('第 30 层图鉴里有魔王',
    lastLayerMonsters.includes('demon_king'), lastLayerMonsters.join(', '));
  check('各层图鉴里的怪都在怪物表里',
    LEVELS.every((level, i) => monsterIdsOnLevel(i).every((id) => !!MONSTERS[id])));
  const listedTotal = LEVELS.reduce((n, level, i) => n + monsterIdsOnLevel(i).length, 0);
  check('图鉴合计 = 30 层 × 10 种 + 末层多 1 只魔王 = 301 种', listedTotal === 301, `实际 ${listedTotal} 种`);

  // ---- 图标不能撞脸：同一层不同物种的图标互不相同，也不跟这一层的道具图标一样 ----
  const iconBad = [];
  for (let f = 1; f <= LEVELS.length; f++) {
    const monIcons = new Map();
    const itemIcons = new Set();
    getGrid(f - 1).forEach((row, y) => row.forEach((t, x) => {
      if (t.t === 'monster' || t.t === 'boss') {
        const mon = MONSTERS[t.id];
        if (!mon) return;
        if (monIcons.has(mon.icon) && monIcons.get(mon.icon) !== t.id) {
          iconBad.push('第 ' + f + ' 层 ' + monIcons.get(mon.icon) + ' 和 ' + t.id + ' 都用 ' + mon.icon);
        }
        monIcons.set(mon.icon, t.id);
      } else if (t.t === 'item') {
        const it = ITEMS[t.id];
        if (it) itemIcons.add(it.icon);
      }
    }));
    for (const icon of monIcons.keys()) {
      if (itemIcons.has(icon)) iconBad.push('第 ' + f + ' 层的怪和道具都用 ' + icon);
    }
  }
  check('怪图标不跟道具撞脸，同一层的不同物种图标也互不相同',
    iconBad.length === 0, iconBad.slice(0, 5).join(' | '));

  // ---- 装备档位：塔里 5 档剑 + 5 档盾，每档只出现一次，数值递增 ----
  const swordSeen = new Map();
  const shieldSeen = new Map();
  LEVELS.forEach((level, i) => {
    const grid = getGrid(i);
    grid.forEach((row, y) => row.forEach((t, x) => {
      if (t.t !== 'item') return;
      const item = ITEMS[t.id];
      if (!item || item.type !== 'equip') return;
      const bag = item.line === 'weapon' ? swordSeen : shieldSeen;
      if (bag.has(t.id)) failures.push(`${t.id} 重复出现在第 ${i + 1} 层`);
      bag.set(t.id, { tier: item.tier, value: item.atk || item.def, floor: i + 1 });
    }));
  });
  const swordTiers = [...swordSeen.values()].sort((a, b) => a.tier - b.tier);
  const shieldTiers = [...shieldSeen.values()].sort((a, b) => a.tier - b.tier);
  check('塔里正好 5 档剑', swordTiers.length === 5, `实际 ${swordTiers.length}`);
  check('塔里正好 5 档盾', shieldTiers.length === 5, `实际 ${shieldTiers.length}`);
  const swordsOk = swordTiers.every((v, i) => v.tier === i + 1) &&
    swordTiers.every((v, i) => i === 0 || v.value > swordTiers[i - 1].value);
  const shieldsOk = shieldTiers.every((v, i) => v.tier === i + 1) &&
    shieldTiers.every((v, i) => i === 0 || v.value > shieldTiers[i - 1].value);
  check('剑的 5 档档位连续且数值递增', swordsOk,
    swordTiers.map((v) => `${v.tier}档+${v.value}@${v.floor}层`).join(' '));
  check('盾的 5 档档位连续且数值递增', shieldsOk,
    shieldTiers.map((v) => `${v.tier}档+${v.value}@${v.floor}层`).join(' '));
  check(`基础面板 攻击 ${BASE_STATS.atk} / 防御 ${BASE_STATS.def} / 生命 ${BASE_STATS.hp}`,
    BASE_STATS.atk === 100 && BASE_STATS.def === 50 && BASE_STATS.hp === 800);
  check('血量没有上限：状态里不存在 maxHp 这个字段',
    !('maxHp' in createInitialState(findCharInLevel(0, '@'))) && !('maxHp' in BASE_STATS),
    'BASE_STATS: ' + Object.keys(BASE_STATS).join(','));

  // ---- 关键奖励锁在上锁的房间里：不打怪就拿不到 ----
  const probe = createInitialState(findCharInLevel(0, '@'));
  LEVELS.forEach((level, i) => {
    const grid = getGrid(i);
    const L = analyzeLayout(grid);
    const outside = [];
    let doorLock = null;
    grid.forEach((row, y) => row.forEach((t, x) => {
      if (t.t === 'door' && !doorLock) doorLock = t.lock;
    }));
    grid.forEach((row, y) => row.forEach((t, x) => {
      if (t.t !== 'item') return;
      const item = ITEMS[t.id];
      if (!item) return;
      const precious = item.type === 'equip' || item.type === 'heart' ||
        (item.type === 'key' && item.lock === doorLock);
      if (!precious) return;
      const roomId = L.roomOf[y][x];
      if (roomId < 0) { outside.push(`${item.name}@(${x},${y}) 不在房间里`); return; }
      if (!roomIsSealed(L, roomId)) {
        outside.push(`${item.name}@(${x},${y}) 所在房间有门没被堵住`);
      }
    }));
    check(`第 ${i + 1} 层的贵重奖励都锁在上锁的房间里（不打怪拿不到）`,
      outside.length === 0, outside.join(' '));
  });

  LEVELS.forEach((level, i) => {
    const st = { ...probe, level: i, pos: findCharInLevel(i, i === 0 ? '@' : '<') };
    const grid = getGrid(i);
    const cells = [];
    grid.forEach((row, y) => row.forEach((t, x) => cells.push({ t, x, y })));

    const stair = cells.find((c) => c.t.t === 'stairUp' || c.t.t === 'boss');
    const doors = cells.filter((c) => c.t.t === 'door');
    const keys = cells.filter((c) => c.t.t === 'item' && ITEMS[c.t.id] && ITEMS[c.t.id].type === 'key');
    const guards = cells.filter((c) => c.t.t === 'monster');

    if (stair && doors.length) {
      const sealed = reachable(st, ['door', 'monster']);
      check(`第 ${i + 1} 层：封死所有门和怪，上楼楼梯就上不去`,
        !sealed.has(stair.x + ',' + stair.y),
        sealed.has(stair.x + ',' + stair.y) ? '门和怪全封死后楼梯仍可达' : '');
      // 楼梯不能堵在门口后面：踩上去就换层，房间里的怪一只都打不了
      const dDoor = Math.min(...doors.map((d) => Math.abs(d.x - stair.x) + Math.abs(d.y - stair.y)));
      check(`第 ${i + 1} 层：上楼梯离锁着的门至少隔一格`, dDoor >= 2,
        `楼梯 (${stair.x},${stair.y}) 离最近的门 ${dDoor} 格`);
    }

    // 能开本层门的钥匙必须被守关怪挡在后面
    if (doors.length && guards.length) {
      const lock = doors[0].t.lock;
      const doorKeys = keys.filter((c) => ITEMS[c.t.id].lock === lock);
      const noMonster = reachable(st, 'monster');
      const leaked = doorKeys.filter((c) => noMonster.has(c.x + ',' + c.y));
      check(`第 ${i + 1} 层：开门的钥匙必须先打怪`, doorKeys.length === 1 && leaked.length === 0,
        doorKeys.length !== 1 ? `能开 ${lock} 门的钥匙有 ${doorKeys.length} 把（应只有守关怪后面那 1 把）`
          : leaked.length ? '不打怪也能拿到开门的钥匙，关卡没有强制战斗' : '');
    }
  });
}


/* ------------------------------------------------------------------ */
/* 1d. 地图密度：墙不能多、不能连成一片，内容要够                          */
/* ------------------------------------------------------------------ */

/**
 * 墙的"聚拢度"只看地图内部的墙，外圈那圈围墙是地图边框，不算。
 * 连通按 4 邻接算：一格墙和斜着挨着的墙不算连成一片。
 */
function checkMapDensity() {
  console.log('\n=== 1d. 地图密度 ===');

  const WALL_LIMIT = 0.70;   // 墙占比上限（路只留一格宽，墙自然多；实测最高 67.2%）
  const MON_LIMIT = 28;      // 每层最少怪数（4 只看门怪 + 26 只巡逻怪）
  const ITEM_LIMIT = 6;      // 每层最少道具数（不含楼梯/门/怪）

  const wallRatios = [];
  const openSquaresPerLevel = [];
  const deadCounts = [];
  const monCounts = [];
  const itemCounts = [];

  LEVELS.forEach((level, i) => {
    const grid = getGrid(i);
    const H = grid.length, W = grid[0].length;

    const interiorWalls = new Set();
    let walls = 0, mons = 0, items = 0;
    grid.forEach((row, y) => row.forEach((t, x) => {
      if (t.t === 'wall') {
        walls++;
        if (x > 0 && y > 0 && x < W - 1 && y < H - 1) interiorWalls.add(x + ',' + y);
      } else if (t.t === 'monster' || t.t === 'boss') mons++;
      else if (t.t === 'item' || t.t === 'gold') items++;
    }));
    wallRatios.push(walls / (H * W));
    monCounts.push(mons);
    itemCounts.push(items);

    // 开阔地：2×2 的空地方块，厅堂就是靠它才不像一条弯折的走廊
    let openSquares = 0;
    let dead = 0;
    for (let y = 0; y < H - 1; y++) {
      for (let x = 0; x < W - 1; x++) {
        const s0 = grid[y][x].t === 'wall';
        const s1 = grid[y][x + 1].t === 'wall';
        const s2 = grid[y + 1][x].t === 'wall';
        const s3 = grid[y + 1][x + 1].t === 'wall';
        if (!s0 && !s1 && !s2 && !s3) openSquares++;
      }
    }
    // 死胡同：只有一个出口的格子
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (grid[y][x].t === 'wall') continue;
        let deg = 0;
        for (const [dx, dy] of DIRS) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || ny >= H || nx >= W) continue;
          if (grid[ny][nx].t !== 'wall') deg++;
        }
        if (deg === 1) dead++;
      }
    }
    openSquaresPerLevel.push(openSquares);
    deadCounts.push(dead);
  });

  const worstWall = Math.max(...wallRatios);
  check(`每层墙占比不超过 ${(WALL_LIMIT * 100).toFixed(0)}%（实测最高 ${(worstWall * 100).toFixed(1)}%）`,
    worstWall <= WALL_LIMIT, `最高的是第 ${wallRatios.indexOf(worstWall) + 1} 层`);

  const minOpenSquares = Math.min(...openSquaresPerLevel);
  check(`每层都有开阔地（2×2 空地，最少 ${minOpenSquares} 处，下限 2）`, minOpenSquares >= 2,
    `共 ${openSquaresPerLevel.reduce((n, v) => n + v, 0)} 处 2×2 空地`);

  checkRoomStructure();
  checkStairNotBlockingDoor();

  const minMon = Math.min(...monCounts);
  const maxMon = Math.max(...monCounts);
  check(`每层都有怪（最少 ${minMon} 只，最多 ${maxMon} 只，下限 ${MON_LIMIT}）`,
    minMon >= MON_LIMIT);

  const minItem = Math.min(...itemCounts);
  const maxItem = Math.max(...itemCounts);
  check(`每层都有东西可捡（最少 ${minItem} 件，最多 ${maxItem} 件，下限 ${ITEM_LIMIT}）`,
    minItem >= ITEM_LIMIT);
}


/* ------------------------------------------------------------------ */
/* 1b. 传送卷轴的行为                                                  */
/* ------------------------------------------------------------------ */

/**
 * 找一个测试用的场景：
 *   near = 挨着楼梯的地面格（正上方不是楼梯，所以按 ↑ 不会踩着楼梯换层；
 *          优先挑上方是墙的，按 ↑ 就是撞墙，什么都不会发生）
 *   far  = 离楼梯远、正上方不是楼梯的地面格（优先挑上方是墙的）
 * 这样"没生效"和"生效"两种情况都能看得很清楚。
 */
function findWarpFixture() {
  for (let i = 1; i < LEVELS.length - 1; i++) {
    const grid = getGrid(i);
    const H = grid.length, W = grid[0].length;
    const at = (x, y) => (x < 0 || y < 0 || y >= H || x >= W) ? null : grid[y][x];
    const isStair = (x, y) => {
      const t = at(x, y);
      return !!t && (t.t === 'stairUp' || t.t === 'stairDown');
    };
    const isWall = (x, y) => {
      const t = at(x, y);
      return !t || t.t === 'wall';
    };

    const nearCands = [];
    const farCands = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const t = at(x, y);
        if (!t || t.t !== 'floor') continue;
        if (isStair(x, y - 1)) continue;          // 正上方是楼梯：按 ↑ 会换层，测试就不干净了
        const touchesStair = isStair(x, y - 1) || isStair(x, y + 1) ||
                            isStair(x - 1, y) || isStair(x + 1, y);
        const cand = { x, y, walled: isWall(x, y - 1) };
        if (touchesStair) nearCands.push(cand);
        else farCands.push(cand);
      }
    }
    const near = nearCands.find((c) => c.walled) || nearCands[0];
    const far = farCands.find((c) => c.walled) || farCands[0];
    if (near && far) return { level: i, near: { x: near.x, y: near.y }, far: { x: far.x, y: far.y } };
  }
  return null;
}

function checkWarpRules() {
  console.log('\n=== 1b. 传送卷轴行为 ===');
  const fx = findWarpFixture();
  check('能找到"挨着楼梯"和"离楼梯远"两个测试格子', !!fx);
  if (!fx) return;

  const mk = (pos, withScroll) => {
    const s = createInitialState(fx.near);
    s.level = fx.level;
    s.pos = { x: pos.x, y: pos.y };
    if (withScroll) s.bag.warp_scroll = 1;
    return s;
  };

  const up = step(mk(fx.near, true), { type: 'MOVE', dir: 'up' });
  check('挨着楼梯 + 有卷轴：按 ↑ 往上爬一层',
    up.state.level === fx.level + 1, `第 ${fx.level + 1} 层 → 第 ${up.state.level + 1} 层`);
  const upStair = findCharInLevel(fx.level + 1, '<');
  const upCell = getGrid(up.state.level)[up.state.pos.y][up.state.pos.x];
  const upDist = upStair ? Math.abs(up.state.pos.x - upStair.x) + Math.abs(up.state.pos.y - upStair.y) : -1;
  check('卷轴上楼后落在目标层楼梯旁边一格（不站在楼梯上）',
    upDist === 1 && upCell.t !== 'stairUp' && upCell.t !== 'stairDown',
    `落点 (${up.state.pos.x},${up.state.pos.y}) ${upCell.t}，楼梯 (${upStair ? upStair.x : '-'},${upStair ? upStair.y : '-'})`);

  const down = step(mk(fx.near, true), { type: 'MOVE', dir: 'down' });
  check('挨着楼梯 + 有卷轴：按 ↓ 往下走一层',
    down.state.level === fx.level - 1, `第 ${fx.level + 1} 层 → 第 ${down.state.level + 1} 层`);
  const downStair = findCharInLevel(fx.level - 1, '>');
  const downCell = getGrid(down.state.level)[down.state.pos.y][down.state.pos.x];
  const downDist = downStair ? Math.abs(down.state.pos.x - downStair.x) + Math.abs(down.state.pos.y - downStair.y) : -1;
  check('卷轴下楼后落在目标层楼梯旁边一格（不站在楼梯上）',
    downDist === 1 && downCell.t !== 'stairUp' && downCell.t !== 'stairDown',
    `落点 (${down.state.pos.x},${down.state.pos.y}) ${downCell.t}，楼梯 (${downStair ? downStair.x : '-'},${downStair ? downStair.y : '-'})`);

  const noScroll = step(mk(fx.near, false), { type: 'MOVE', dir: 'up' });
  check('挨着楼梯但没有卷轴：按 ↑ 不换层', noScroll.state.level === fx.level,
    `实际第 ${noScroll.state.level + 1} 层`);
  check('没有卷轴时按 ↑ 不出任何提示', noScroll.events.length === 0,
    JSON.stringify(noScroll.events));

  const farRes = step(mk(fx.far, true), { type: 'MOVE', dir: 'up' });
  check('离楼梯远 + 有卷轴：按 ↑ 不换层', farRes.state.level === fx.level,
    `实际第 ${farRes.state.level + 1} 层`);
  check('离楼梯远时按 ↑ 不出任何提示（完全静默）', farRes.events.length === 0,
    JSON.stringify(farRes.events));

  const bottom = createInitialState(findCharInLevel(0, '@'));
  bottom.bag.warp_scroll = 1;
  const edge = step(bottom, { type: 'MOVE', dir: 'down' });
  check('第 1 层按 ↓ 不会越界', edge.state.level === 0, `实际第 ${edge.state.level + 1} 层`);

  const top = createInitialState(findCharInLevel(0, '@'));
  top.level = LEVELS.length - 1;
  top.pos = findCharInLevel(LEVELS.length - 1, '<');
  top.bag.warp_scroll = 1;
  const edgeTop = step(top, { type: 'MOVE', dir: 'up' });
  check('第 30 层按 ↑ 不会越界', edgeTop.state.level === LEVELS.length - 1,
    `实际第 ${edgeTop.state.level + 1} 层`);
}


/* ------------------------------------------------------------------ */
/* 1d-2. 房间结构：9 间房，门洞连成一棵有分叉的树                          */
/* ------------------------------------------------------------------ */

/**
 * 每层是一张「树枝状」的地图：
 *   底下一间大厅当树干，往上分成树枝、梢头是小房间；
 *   房间大小各不相同（不是固定 3×3），
 *   门洞连成一棵有分叉的树 —— 有分叉、不绕圈，路不会是一条道走到黑。
 */
function checkRoomStructure() {
  console.log('\n=== 1d-2. 房间结构 ===');
  const bad = [];
  const wide = [];
  const roomCounts = [];
  const sizeMix = new Set();
  LEVELS.forEach((level, i) => {
    const grid = getGrid(i);
    const L = analyzeLayout(grid);
    const open = (x, y) => !!(grid[y] && grid[y][x] && grid[y][x].t !== 'wall');

    // 每间房都要是一个填满的矩形
    for (const room of L.rooms) {
      if (room.cells.length !== room.w * room.h) {
        bad.push(`第 ${i + 1} 层有一间房不是填满的矩形`);
      }
    }
    roomCounts.push(L.rooms.length);
    for (const room of L.rooms) sizeMix.add(room.w + '×' + room.h);

    // 路只留一格宽：房间以外不允许出现 2×2 的空地
    for (let y = 0; y < L.H - 1; y++) {
      for (let x = 0; x < L.W - 1; x++) {
        if (!open(x, y) || !open(x + 1, y) || !open(x, y + 1) || !open(x + 1, y + 1)) continue;
        const ids = [L.roomOf[y][x], L.roomOf[y][x + 1], L.roomOf[y + 1][x], L.roomOf[y + 1][x + 1]];
        if (ids.some((id) => id < 0)) {
          wide.push(`第 ${i + 1} 层 (${x},${y}) 附近有两格宽的路`);
        }
      }
    }
    // 走廊格不能四面都通：那是十字路口，路就不是 1 格宽的通道了
    for (const c of L.corridorCells) {
      let deg = 0;
      for (const [dx, dy] of DIRS) {
        if (open(c.x + dx, c.y + dy)) deg++;
      }
      if (deg > 3) wide.push(`第 ${i + 1} 层走廊 (${c.x},${c.y}) 四面都通`);
    }

    // 房间 + 走廊连成一张树：连通 + 边数 = 点数 - 1
    const nodes = L.rooms.length + L.corridorCells.length;
    if (L.edges.size !== nodes - 1) {
      bad.push(`第 ${i + 1} 层的房间和走廊有 ${L.edges.size} 条边，应该 ${nodes - 1} 条（不是树）`);
    }
    const adjMap = new Map();
    for (const e of L.edges) {
      const [a, b] = e.split('|');
      if (!adjMap.has(a)) adjMap.set(a, new Set());
      if (!adjMap.has(b)) adjMap.set(b, new Set());
      adjMap.get(a).add(b);
      adjMap.get(b).add(a);
    }
    const seen = new Set(['r0']);
    const stack = ['r0'];
    while (stack.length) {
      const cur = stack.pop();
      for (const nx of (adjMap.get(cur) || [])) if (!seen.has(nx)) { seen.add(nx); stack.push(nx); }
    }
    if (seen.size !== nodes) {
      bad.push(`第 ${i + 1} 层的房间和走廊没连成一片（只连到 ${seen.size}/${nodes} 个点）`);
    }

    // 楼梯不能堵在门口：楼梯是「踩上去就换层」的格子，
    // 一旦压在某个门口旁边，玩家一进门就被送上楼 / 送下楼，
    // 房间里的怪只能上去再下来才能清，门洞也就废了。
    for (const c of L.corridorCells) {
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const nx = c.x + dx, ny = c.y + dy;
        const t = grid[ny] && grid[ny][nx];
        if (!t) continue;
        if (t.t === 'stairUp' || t.t === 'stairDown') {
          bad.push(`第 ${i + 1} 层门洞 (${c.x},${c.y}) 挨着楼梯 (${nx},${ny})`);
        }
      }
    }
  });
  check('房间和走廊连成一棵有分叉的树，每间房都是填满的矩形', bad.length === 0,
    bad.slice(0, 6).join(' '));
  check('路只留一格宽（房间以外没有两格宽的通道）', wide.length === 0,
    wide.slice(0, 6).join(' '));
  check('房间大小不都是 3×3（大小不一的房间）', sizeMix.size >= 5,
    `出现过的尺寸：${[...sizeMix].sort().join(' ')}`);
  check('每层至少 9 间房', roomCounts.every((n) => n >= 9), roomCounts.join(' '));
}

/* ------------------------------------------------------------------ */
/* 1d-3. 楼梯口不许堵在门口后面                                        */
/* ------------------------------------------------------------------ */

/**
 * 楼梯是「踩上去就换层」的格子。它要是堵在门口后面：
 *   - 玩家一进门就被送走，房间里的怪一只都打不了，只能上去再下来；
 *   - 门也废了，门后面那条分支谁都进不去。
 *
 * 所以两条硬规矩：
 *   1) 上楼梯放在门后房间的最深处，离锁着的门至少隔一格地板；
 *   2) 门正后方那一格必须站着怪 —— 进门就得先清怪，清完才接得上楼梯。
 * 往下那级楼梯放在根大厅里，离任何门洞至少两格。
 */
function checkStairNotBlockingDoor() {
  console.log('\n=== 1d-3. 楼梯口不许堵在门口后面 ===');
  const bad = [];
  const upDists = [];
  const downDists = [];
  const D2 = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  LEVELS.forEach((level, i) => {
    const grid = getGrid(i);
    const H = grid.length, W = grid[0].length;
    const at = (x, y) => (x < 0 || y < 0 || y >= H || x >= W) ? null : grid[y][x];
    const doors = [], upStairs = [], downStairs = [];
    grid.forEach((row, y) => row.forEach((t, x) => {
      if (t.t === 'door') doors.push({ x, y });
      if (t.t === 'stairUp' || t.t === 'boss') upStairs.push({ x, y });
      if (t.t === 'stairDown') downStairs.push({ x, y });
    }));
    const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

    for (const st of upStairs) {
      if (!doors.length) continue;
      const near = doors.reduce((p, d) => (dist(d, st) < dist(p, st) ? d : p));
      const d = dist(near, st);
      upDists.push(d);
      if (d < 3) bad.push('第 ' + (i + 1) + ' 层上楼梯 (' + st.x + ',' + st.y + ') 离锁着的门只有 ' + d + ' 格');
      // 门内侧那一格（门的正上方）必须站着怪：进门先清怪
      const inner = at(near.x, near.y - 1);
      if (!inner || (inner.t !== 'monster' && inner.t !== 'boss')) {
        bad.push('第 ' + (i + 1) + ' 层门后 (' + near.x + ',' + (near.y - 1) + ') 没站着怪，进门就没人拦');
      }
    }

    for (const st of downStairs) {
      if (!doors.length) continue;
      const d = Math.min(...doors.map((dr) => dist(dr, st)));
      downDists.push(d);
      if (d < 2) bad.push('第 ' + (i + 1) + ' 层下楼梯 (' + st.x + ',' + st.y + ') 离门只有 ' + d + ' 格');
    }
  });
  const fmt = (arr) => arr.length ? Math.min(...arr) + '~' + Math.max(...arr) : '无';
  console.log('  上楼梯离最近的门洞：' + fmt(upDists) + ' 格');
  console.log('  下楼梯离最近的门洞：' + fmt(downDists) + ' 格');
  check('上下楼梯都不许堵在门口后面（上楼梯离门至少三格，门后还得有怪守着）', bad.length === 0,
    bad.slice(0, 6).join(' '));
}

/* ------------------------------------------------------------------ */
/* 1e. 怪物站位：看门怪守在门口，巡逻怪散在房间里                         */
/* ------------------------------------------------------------------ */

/**
 * 每只怪都要有位置，分两种站位：
 *
 *   看门怪（守关怪 / 小鬼 / 史莱姆）：
 *     - 站在门洞上，房间里放着钥匙、结晶、商店这类好东西
 *     - 所以不打怪就进不了那间房，拿不到里面的东西
 *
 *   巡逻怪（patrol_*）：
 *     - 站在房间里（房角或房中心）
 *     - 少数站在门口 —— 那是上锁房间多出来的门，得有人堵着
 *
 * 另外：任何两只怪都不会上下左右相邻，
 * 所以路上不会出现「一格接一格全是怪」。
 */
function checkMonsterPosts() {
  console.log('\n=== 1e. 怪物站位 ===');
  const D2 = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  const bad = [];
  const adjacent = [];
  let checked = 0;
  let patrols = 0;
  LEVELS.forEach((level, i) => {
    const grid = getGrid(i);
    const H = grid.length, W = grid[0].length;
    const at = (x, y) => (x < 0 || y < 0 || y >= H || x >= W) ? null : grid[y][x];
    const degOfCell = (x, y) => {
      let d = 0;
      for (const [dx, dy] of D2) {
        const a = at(x + dx, y + dy);
        if (a && a.t !== 'wall') d++;
      }
      return d;
    };
    const isMonster = (a) => a && (a.t === 'monster' || a.t === 'boss');

    const L = analyzeLayout(grid);
    // 这一层哪些房间是「上锁的」：每个门口都被怪或者锁着的门堵住
    const locked = sealedRoomsOf(L);

    grid.forEach((row, y) => row.forEach((t, x) => {
      if (!isMonster(t)) return;

      // 两只怪挨在一起就要记下来（只看右和下，免得重复计数）
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        if (isMonster(at(x + dx, y + dy))) {
          adjacent.push(`第 ${i + 1} 层 (${x},${y}) 与 (${x + dx},${y + dy})`);
        }
      }

      if (t.t !== 'monster') return;      // 魔王不参与站位规则
      checked++;
      const roomId = L.roomOf[y][x];
      // 看门怪要站在某间房的下门（门洞）上
      const onDoor = L.roomDown.some((d) => d && d.x === x && d.y === y);

      if (t.id.startsWith('patrol_')) {
        patrols++;
        if (roomId < 0) {
          bad.push(`第 ${i + 1} 层 ${t.id}@(${x},${y}) 不在房间里`);
        }
        return;
      }

      // 看门怪：必须站在门洞上，否则能绕过去拿房间里的东西
      if (!onDoor) {
        bad.push(`第 ${i + 1} 层 ${t.id}@(${x},${y}) 不在门洞上`);
      }
    }));
  });
  check(`看门怪（守关怪 / 小鬼 / 史莱姆 / 恶犬）都站在门洞上（共 ${checked - patrols} 只）`,
    bad.filter((b) => !b.includes('patrol_')).length === 0,
    bad.filter((b) => !b.includes('patrol_')).slice(0, 6).join(' '));
  check(`巡逻怪都在房间里（共 ${patrols} 只）`,
    bad.filter((b) => b.includes('patrol_')).length === 0,
    bad.filter((b) => b.includes('patrol_')).slice(0, 6).join(' '));
  check('两只怪不会挨着（正交相邻的怪对数为 0）', adjacent.length === 0,
    adjacent.slice(0, 6).join(' '));

  // 每层的巡逻怪数量：巡逻怪 26 只，门口补位的怪从房间里挪出来
  const perLevel = [];
  LEVELS.forEach((level, i) => {
    const grid = getGrid(i);
    let n = 0;
    grid.forEach((row, y) => row.forEach((t, x) => {
      if (t.t === 'monster' && t.id.startsWith('patrol_')) n++;
    }));
    perLevel.push(n);
  });
  const wrongCount = perLevel.filter((n) => n !== 26);
  check('每层巡逻怪数量符合设计（26 只）',
    wrongCount.length === 0,
    perLevel.join(' '));

  // 每层的物种数：守关怪 1 种 + 看门怪 3 种 + 巡逻怪 6 种 = 10 种
  const speciesPerLevel = [];
  const gateKinds = [];
  LEVELS.forEach((level, i) => {
    const grid = getGrid(i);
    const ids = new Set();
    const gates = new Set();
    grid.forEach((row, y) => row.forEach((t, x) => {
      if (t.t !== 'monster') return;
      ids.add(t.id);
      if (!t.id.startsWith('patrol_')) gates.add(t.id);
    }));
    speciesPerLevel.push(ids.size);
    gateKinds.push(gates.size);
  });
  check('每层 10 个物种（守关怪 + 3 种看门怪 + 6 种巡逻怪）',
    speciesPerLevel.every((n) => n === 10), speciesPerLevel.join(' '));
  check('每层 4 只看门怪是 4 个不同的物种',
    gateKinds.every((n) => n === 4), gateKinds.join(' '));

  // 每层的总怪数：看门怪 4（守关怪 / 小鬼 / 史莱姆 / 小鬼）+ 巡逻怪 26
  const totalPerLevel = [];
  LEVELS.forEach((level, i) => {
    const grid = getGrid(i);
    let n = 0;
    grid.forEach((row, y) => row.forEach((t, x) => {
      if (t.t === 'monster') n++;
    }));
    totalPerLevel.push(n);
  });
  const wrongTotal = totalPerLevel.filter((n) => n !== 30);
  check('每层怪数符合设计（30 只：看门怪 4 + 巡逻怪 26）',
    wrongTotal.length === 0,
    totalPerLevel.join(' '));
}

/* ------------------------------------------------------------------ */
/* 1c. 换层落点：楼梯旁边一格，不站在楼梯上                             */
/* ------------------------------------------------------------------ */

function checkStairLanding() {
  console.log('\n=== 1c. 换层落点 ===');

  // 结构：每层每道楼梯的落点都在它旁边一格，而且是能走的格子
  LEVELS.forEach((level, i) => {
    for (const ch of ['>', '<']) {
      const stair = findCharInLevel(i, ch);
      if (!stair) continue;
      const spot = landingNear(i, ch);
      const dist = spot ? Math.abs(spot.x - stair.x) + Math.abs(spot.y - stair.y) : -1;
      check(`第 ${i + 1} 层 ${ch} 的落点在楼梯旁边一格（不在楼梯上）`,
        !!spot && dist === 1,
        spot ? `落点 (${spot.x},${spot.y})，楼梯 (${stair.x},${stair.y})` : '落点为空');
      if (!spot) continue;
      const cell = getGrid(i)[spot.y][spot.x];
      check(`第 ${i + 1} 层 ${ch} 的落点是能走的格子`, !!cell && cell.t !== 'wall',
        cell ? cell.t : 'null');
    }
  });

  const dirTo = (from, to) => DIR_NAME[(to.x - from.x) + ',' + (to.y - from.y)];

  // 行为：第 1 层开门下楼 -> 落在第 2 层楼梯旁边
  const g1 = getGrid(0);
  let door = null, stairUp = null;
  g1.forEach((row, y) => row.forEach((t, x) => {
    if (t.t === 'door') door = { x, y, lock: t.lock };
    if (t.t === 'stairUp') stairUp = { x, y };
  }));
  if (door && stairUp) {
    const entrance = neighborsOf(0, door.x, door.y)
      .map((k) => k.split(',').map(Number))
      .find(([x, y]) => !(x === stairUp.x && y === stairUp.y));
    check('第 1 层门口那格找得到', !!entrance, JSON.stringify(entrance));
    if (entrance) {
      const from = { x: entrance[0], y: entrance[1] };
      let s = createInitialState(from);
      s.keys[door.lock] = 1;
      const r1 = step(s, { type: 'MOVE', dir: dirTo(from, door) });
      check('走到门口自动开门并站上去',
        r1.state.pos.x === door.x && r1.state.pos.y === door.y &&
        !!r1.state.openDoors['0:' + door.x + ',' + door.y]);
      // 上楼梯在门后房间的最深处，得往里走几步才踩得到
      let r2 = r1;
      const path = plan(r1.state, stairUp, new Set());
      if (path) {
        for (const p of path.path) {
          const dx = p.x - r2.state.pos.x, dy = p.y - r2.state.pos.y;
          r2 = step(r2.state, { type: 'MOVE', dir: DIR_NAME[dx + ',' + dy] });
        }
      }
      const land = r2.state.pos;
      const t2 = findCharInLevel(1, '<');
      const d2 = t2 ? Math.abs(land.x - t2.x) + Math.abs(land.y - t2.y) : -1;
      check('第 1 层踩往上那级楼梯，落在第 2 层楼梯旁边一格', r2.state.level === 1 && d2 === 1,
        `第 ${r2.state.level + 1} 层 (${land.x},${land.y})，楼梯 (${t2 ? t2.x : '-'},${t2 ? t2.y : '-'})`);
      const landCell = getGrid(r2.state.level)[land.y][land.x];
      check('换层落点不在楼梯格上', landCell.t !== 'stairUp' && landCell.t !== 'stairDown', landCell.t);
    }
  }

  // 行为：第 2 层踩往下那级楼梯 -> 落在第 1 层楼梯旁边
  const upStair = findCharInLevel(1, '<');
  if (upStair) {
    const nb = neighborsOf(1, upStair.x, upStair.y).map((k) => k.split(',').map(Number));
    check('第 2 层上楼楼梯有可站的邻居', nb.length > 0, JSON.stringify(nb));
    if (nb.length) {
      const from = { x: nb[0][0], y: nb[0][1] };
      const s2 = createInitialState(from);
      s2.level = 1;
      const r = step(s2, { type: 'MOVE', dir: dirTo(from, upStair) });
      const land = r.state.pos;
      const t = findCharInLevel(0, '>');
      const d = t ? Math.abs(land.x - t.x) + Math.abs(land.y - t.y) : -1;
      check('第 2 层踩往下那级楼梯，落在第 1 层楼梯旁边一格', r.state.level === 0 && d === 1,
        `第 ${r.state.level + 1} 层 (${land.x},${land.y})，楼梯 (${t ? t.x : '-'},${t ? t.y : '-'})`);
      const landCell = getGrid(r.state.level)[land.y][land.x];
      check('上楼落点不在楼梯格上', landCell.t !== 'stairUp' && landCell.t !== 'stairDown', landCell.t);
    }
  }
}

/* ------------------------------------------------------------------ */
/* 1f. 战斗结算                                                        */
/* ------------------------------------------------------------------ */

/**
 * 三条硬规矩（验收时踩出来的坑）：
 *   1) 战斗中血量只会往下掉，不会比开打时更多；
 *   2) 塔里没有药水，打不赢的仗只能一路掉到 0；
 *   3) 图鉴给的结论和真打的结果完全一致。
 */
function checkBattleRules() {
  console.log('\n=== 1f. 战斗结算 ===');

  const base = { hp: 800, atk: 100, def: 50 };
  const guard = MONSTERS.guard_1;          // 第 1 层守关怪 2820/92/24
  const patrol = MONSTERS.patrol_a_1;     // 第 1 层基准巡逻怪

  // ① 打得赢的仗：血量只会往下掉
  const win = resolveBattle(base, patrol);
  check('打得赢的战斗结束后血量不高于开打时',
    win.win && win.hpLeft <= base.hp, `开打 ${base.hp} → 结束 ${win.hpLeft}`);

  // ② 打不过的仗：没有药续命，血量一路掉到 0
  const lose = resolveBattle(base, guard);
  check('打不过的战斗血量一路掉到 0', !lose.win && lose.hpLeft === 0,
    `结束 ${lose.hpLeft} 血`);

  // ③ 受伤进场打完也不会比开打时血多
  const hurt = { hp: 200, atk: 400, def: 50 };
  const weak = { name: '测试怪', hp: 800, atk: 100, def: 10, gold: 0 };
  const hurtFight = resolveBattle(hurt, weak);
  check('受伤进场打完也不会比开打时血多',
    hurtFight.hpLeft <= hurt.hp, `开打 ${hurt.hp} → 结束 ${hurtFight.hpLeft}`);

  // ④ 图鉴的结论和真打的结果一致
  const look = previewFight(base, guard);
  check('图鉴说不可战胜的怪，真打确实赢不了',
    look.verdict === 'unsolvable' && !lose.win, JSON.stringify(look));

  // ⑤ 魔王战按设计血量裸打就能赢
  const boss = previewFight(
    { hp: TARGET.hp, atk: TARGET.atk, def: TARGET.def },
    MONSTERS.demon_king
  );
  check('魔王战拿 68000 血裸打就能赢',
    boss.verdict === 'damage' && boss.loss === 56400,
    JSON.stringify(boss));
}

/* ------------------------------------------------------------------ */
/* 1g. 喝药系统已经整个删掉：全塔不该再有药水和商店                       */
/* ------------------------------------------------------------------ */

function checkNoPotions() {
  console.log('\n=== 1g. 喝药系统已删除 ===');

  const potionItems = Object.keys(ITEMS).filter((id) => ITEMS[id].type === 'potion');
  check('道具表里没有任何药水', potionItems.length === 0, potionItems.join(' '));

  // 字符表里也不能有药水（'p' / 'q' 现在是巡逻怪，别写死字符，按字符表查）
  const potionChars = Object.entries(TILE_CHARS)
    .filter(([, t]) => t.t === 'item' && ITEMS[t.id] && ITEMS[t.id].type === 'potion')
    .map(([ch]) => ch);
  check('地图字符表里没有药水格', potionChars.length === 0, potionChars.join(' '));

  const potionCells = [];
  LEVELS.forEach((level, i) => {
    getGrid(i).forEach((row, y) => row.forEach((t, x) => {
      if (t.t === 'item' && ITEMS[t.id] && ITEMS[t.id].type === 'potion') {
        potionCells.push(`第 ${i + 1} 层 (${x},${y})`);
      }
    }));
  });
  check('解析出来的格子里也没有药水', potionCells.length === 0, potionCells.slice(0, 5).join(' '));

  // 背包能装的东西：只有图鉴和卷轴；药和商店商品都是当场生效
  const bagKinds = Object.entries(ITEMS)
    .filter(([, it]) => it.type === 'book' || it.type === 'warp')
    .map(([id]) => id);
  const instantKinds = Object.entries(ITEMS)
    .filter(([, it]) => it.type === 'potion' || it.type === 'heal' || it.type === 'bonus')
    .map(([id]) => id);
  check('背包里装得下的只有图鉴和卷轴，药和商店商品都是当场生效',
    bagKinds.length === 2 && instantKinds.length > 0,
    `能进背包：${bagKinds.join(',')}；当场生效：${instantKinds.join(',')}`);
}

/* ------------------------------------------------------------------ */
/* 1h. 血量没有上限：生命结晶直接加血                                     */
/* ------------------------------------------------------------------ */

function checkHealRules() {
  console.log('\n=== 1h. 血量规则 ===');

  const dirTo = (from, to) => DIR_NAME[(to.x - from.x) + ',' + (to.y - from.y)];

  // ① 捡到生命结晶：血量直接涨上去，涨多少就是结晶给多少
  const g0 = getGrid(0);
  let crystal = null, imp = null;
  g0.forEach((row, y) => row.forEach((t, x) => {
    if (t.t === 'item' && t.id === 'life_crystal') crystal = { x, y };
  }));
  if (crystal) {
    // 守着结晶的那只小鬼：站在结晶那间房的门口
    const L0 = analyzeLayout(g0);
    const roomId = L0.roomOf[crystal.y][crystal.x];
    // 门口 = 这间房下墙那一格（下门），看门怪就站在那儿
    const down = roomId >= 0 ? L0.roomDown[roomId] : null;
    const dt = down ? g0[down.y][down.x] : null;
    if (dt && dt.t === 'monster') imp = down;
  }
  check('第 1 层找得到生命结晶和守着它的看门怪', !!crystal && !!imp);
  if (crystal && imp) {
    const start = neighborsOf(0, imp.x, imp.y)
      .map((k) => k.split(',').map(Number))
      .find(([x, y]) => !(x === crystal.x && y === crystal.y));
    check('看门怪旁边有能站的格子', !!start, JSON.stringify(start));
    if (start) {
      const st = createInitialState({ x: start[0], y: start[1] });
      st.hp = 300;                       // 故意带着残血去捡
      const r1 = step(st, { type: 'MOVE', dir: dirTo(st.pos, imp) });
      // 守门的怪在门口，结晶在房间正中间 —— 寻路走进去（路上会打掉几只巡逻怪）
      const path = walkPath(g0, r1.state.pos, crystal);
      check('能从门口走到结晶跟前', !!path, path ? path.join(',') : '走不到');
      if (path) {
        let cur = r1;
        for (let i = 0; i < path.length - 1; i++) cur = step(cur.state, { type: 'MOVE', dir: path[i] });
        const before = cur.state.hp;
        const r2 = step(cur.state, { type: 'MOVE', dir: path[path.length - 1] });
        const gain = crystalOn(1);
        check('捡到生命结晶：血量直接涨上去，没有上限',
          r2.state.hp === before + gain && !('maxHp' in r2.state),
          '血量 ' + before + ' → ' + r2.state.hp + '（结晶 +' + gain + '）');
      }
    }
  }

  // ② 走到魔王跟前：不再回血（没有"满"可回），直接开打
  const boss = findCharInLevel(LEVELS.length - 1, 'X');
  check('第 30 层找得到魔王', !!boss);
  if (boss) {
    const mouth = neighborsOf(LEVELS.length - 1, boss.x, boss.y)
      .map((k) => k.split(',').map(Number))
      .find(([x, y]) => {
        const t = getGrid(LEVELS.length - 1)[y][x];
        return t.t !== 'monster' && t.t !== 'boss';
      });
    const st = createInitialState({ x: mouth[0], y: mouth[1] });
    st.level = LEVELS.length - 1;
    st.hp = TARGET.hp;
    st.atk = TARGET.atk; st.def = TARGET.def;
    const r = step(st, { type: 'MOVE', dir: dirTo(st.pos, boss) });
    check('走到魔王跟前：不再回血，直接开打',
      r.state.hp === 11600 && !r.events.some((e) => e.text.includes('血量回到')),
      `进门 ${TARGET.hp} → 打完 ${r.state.hp}`);
    check('魔王战打 48 回合、挨 56400 点伤害后还剩 11600 血',
      r.state.status === 'win' && r.state.hp === 11600,
      `状态 ${r.state.status}，剩 ${r.state.hp} 血`);
  }
}
/* ------------------------------------------------------------------ */
/* 1i. 商店：买下当场生效，不进背包                                      */
/* ------------------------------------------------------------------ */

function checkShopRules() {
  console.log('\n=== 1i. 商店规则 ===');

  // 商店在 7 层
  const shopFloors = [];
  LEVELS.forEach((level, i) => {
    getGrid(i).forEach((row, y) => row.forEach((t, x) => {
      if (t.t === 'shop') shopFloors.push(i + 1);
    }));
  });
  const want = [6, 10, 14, 18, 22, 26, 29];
  check('商店在第 6、10、14、18、22、26、29 层（一共 7 家）',
    shopFloors.length === want.length && want.every((f) => shopFloors.includes(f)),
    shopFloors.join(','));

  // 走进商店：走真实规则层，从隔壁那格踩上商店格
  // st 是"进店前"的状态（可以带着之前买过的东西），所以跨商店的涨价计数能延续上
  const enterShopAt = (st, floor) => {
    const idx = floor - 1;
    const grid = getGrid(idx);
    let cell = null;
    grid.forEach((row, y) => row.forEach((t, x) => {
      if (t.t === 'shop' && !cell) cell = { x, y };
    }));
    if (!cell) return null;
    const nb = neighborsOf(idx, cell.x, cell.y).map((k) => k.split(',').map(Number))[0];
    if (!nb) return null;
    const s = { ...st, level: idx, pos: { x: nb[0], y: nb[1] }, status: 'playing', shop: null };
    const dir = DIR_NAME[(cell.x - nb[0]) + ',' + (cell.y - nb[1])];
    return step(s, { type: 'MOVE', dir }).state;
  };
  const enterShop = (floor) => enterShopAt(createInitialState(findCharInLevel(0, '@')), floor);
  const openShop = (floor, gold) => {
    const s = enterShop(floor);
    if (!s) return null;
    s.gold = gold;
    return s;
  };
  const priceOf = (st, id) => st.shop.stock.find((x) => x.id === id).price;

  const shop6 = enterShop(6);
  const shop29 = enterShop(29);
  check('能走进第 6 层和第 29 层的商店',
    !!shop6 && shop6.status === 'inShop' && !!shop29 && shop29.status === 'inShop');
  if (!shop6 || !shop29) return;

  const healId = 'shop_heal', atkId = 'shop_atk', defId = 'shop_def';
  const plan6 = shopPlan(6);
  const healPlan = plan6.find((x) => x.id === healId);
  const atkPlan = plan6.find((x) => x.id === atkId);
  const defPlan = plan6.find((x) => x.id === defId);

  // ① 货架上只有三样：加血、加攻、加防
  const ids6 = shop6.shop.stock.map((x) => x.id);
  check('商店只卖三项：加血、加攻、加防',
    ids6.length === 3 && ids6.join(',') === 'shop_heal,shop_atk,shop_def',
    ids6.join(','));

  // ② 越高层加的数越大
  const a6 = shop6.shop.stock.map((x) => x.amount);
  const a29 = shop29.shop.stock.map((x) => x.amount);
  check('越高层加的数越大（第 29 层 > 第 6 层）',
    a29.every((v, i) => v > a6[i]),
    `第 6 层 ${a6.join('/')}，第 29 层 ${a29.join('/')}`);

  let mono = true;
  for (let i = 1; i < SHOP_FLOORS.length; i++) {
    const a = shopPlan(SHOP_FLOORS[i - 1]).map((x) => x.amount);
    const b = shopPlan(SHOP_FLOORS[i]).map((x) => x.amount);
    if (!b.every((v, j) => v > a[j])) mono = false;
  }
  check('七家商店的加成逐层递增', mono);

  // ③ 起步价逐层递增（每家店自己一套价目表）
  let baseMono = true;
  const baseTable = [];
  for (let i = 0; i < SHOP_FLOORS.length; i++) {
    const plan = shopPlan(SHOP_FLOORS[i]);
    baseTable.push(`第${SHOP_FLOORS[i]}层 ${plan.map((x) => x.base).join('/')}`);
    if (i > 0) {
      const prev = shopPlan(SHOP_FLOORS[i - 1]);
      if (!plan.every((x, j) => x.base > prev[j].base)) baseMono = false;
    }
  }
  check('七家商店的起步价逐层递增', baseMono, baseTable.join('，'));

  // ④ 价目表是按金币产出标定的：重新扫一遍关卡，核对这个表
  let cum = 0;
  const cumByFloor = [];
  LEVELS.forEach((lv, i) => {
    getGrid(i).forEach((row) => row.forEach((t) => {
      if (t.t === 'gold') cum += t.value || 0;
      else if (t.t === 'monster' || t.t === 'boss') cum += (MONSTERS[t.id] || {}).gold || 0;
    }));
    cumByFloor.push(cum);
  });
  check('价目表按金币产出标定（金币预算表和关卡里实际掉的金币对得上）',
    SHOP_FLOORS.every((f, k) => cumByFloor[f - 1] === SHOP_GOLD_BUDGET[k]),
    SHOP_FLOORS.map((f, k) => `第${f}层 ${cumByFloor[f - 1]}`).join('，') +
    ' vs ' + SHOP_GOLD_BUDGET.join('，'));

  // 一套（三样各买一次）占家底的比例逐层下降：越往上越买得起
  const setShare = SHOP_FLOORS.map((f, k) => {
    const set = shopPlan(f).reduce((a, x) => a + x.base, 0);
    return set / SHOP_GOLD_BUDGET[k];
  });
  check('一套三样的价钱占家底的比例逐层下降（第 6 层最吃力，第 29 层最宽裕）',
    setShare.every((v, i) => i === 0 || v < setShare[i - 1]),
    setShare.map((v) => Math.round(v * 100) + '%').join(' → '));

  // ③ 买加血：当场回血、金币扣掉、不进背包
  const s1 = openShop(6, 5000);
  const r1 = step(s1, { type: 'BUY', itemId: healId });
  check('买加血：当场回血、金币扣掉、不进背包',
    r1.state.hp === s1.hp + healPlan.amount && r1.state.gold === 5000 - healPlan.base &&
    !(r1.state.bag && r1.state.bag[healId]),
    `血量 ${s1.hp} → ${r1.state.hp}，金币 5000 → ${r1.state.gold}`);

  // ④ 同一家店里连买同一项，价格按 1.6 倍往上走（等比，不是等差）
  let cur = openShop(6, 999999);
  const prices = [priceOf(cur, healId)];
  for (let i = 0; i < 3; i++) {
    cur = step(cur, { type: 'BUY', itemId: healId }).state;
    prices.push(priceOf(cur, healId));
  }
  check('同一家店里连买同一项，价格按 1.6 倍往上走（等比，不是等差）',
    prices[0] === healPlan.base &&
    prices[1] === shopPrice(healPlan.base, 1) && prices[2] === shopPrice(healPlan.base, 2) &&
    prices[3] === shopPrice(healPlan.base, 3) &&
    prices[1] > prices[0] && prices[2] - prices[1] > prices[1] - prices[0],
    prices.join(' → '));

  // ⑤ 没有库存限制：想买多少次买多少次
  let c3 = openShop(6, 999999);
  let bought12 = 0;
  for (let i = 0; i < 12; i++) {
    const res = step(c3, { type: 'BUY', itemId: atkId });
    c3 = res.state;
    if (res.events.some((e) => e.kind === 'item')) bought12++;
  }
  check('没有库存限制：连买 12 次都买得到',
    bought12 === 12 && priceOf(c3, atkId) === shopPrice(atkPlan.base, 12),
    `买了 ${bought12} 次，价格 ${priceOf(c3, atkId)}`);

  // ⑥ 三个计数器各算各的
  const s4 = openShop(6, 999999);
  const defBefore = priceOf(s4, defId);
  const c4 = step(s4, { type: 'BUY', itemId: healId }).state;
  check('买了加血不影响加攻、加防的价格',
    priceOf(c4, defId) === defBefore && priceOf(c4, atkId) === atkPlan.base,
    `加防 ${defBefore} → ${priceOf(c4, defId)}，加攻 ${priceOf(c4, atkId)}`);

  // ⑦ 各家商店独立计价：第 6 层买过加攻，不影响第 10 层那家的起步价
  const s5 = openShop(6, 999999);
  const c5 = step(s5, { type: 'BUY', itemId: atkId }).state;
  const plan10 = shopPlan(10).find((x) => x.id === atkId);
  const s5b = enterShopAt(c5, 10);
  check('各家商店独立计价：第 6 层买过的加攻，不影响第 10 层那家的起步价',
    !!s5b && s5b.status === 'inShop' && priceOf(s5b, atkId) === plan10.base,
    `第 10 层加攻 ${s5b ? priceOf(s5b, atkId) : '进不去'}，起步价 ${plan10.base}`);

  // ⑧ 同一家商店反复进出，价格接着上次继续涨
  const s6a = openShop(6, 999999);
  const c6a = step(s6a, { type: 'BUY', itemId: healId }).state;
  const priceBefore = priceOf(c6a, healId);
  const c6b = step(c6a, { type: 'CLOSE_SHOP' }).state;
  const c6c = enterShopAt(c6b, 6);
  check('同一家商店反复进出，价格接着上次继续涨',
    !!c6c && c6c.status === 'inShop' && priceOf(c6c, healId) === priceBefore,
    `离开前 ${priceBefore}，再进 ${c6c ? priceOf(c6c, healId) : '进不去'}`);

  // ⑧ 加攻 / 加防永久加到面板上
  const s6 = openShop(6, 999999);
  const r6 = step(s6, { type: 'BUY', itemId: atkId });
  check('买加攻：攻击力永久加到面板上',
    r6.state.atk === s6.atk + atkPlan.amount, `攻击 ${s6.atk} → ${r6.state.atk}`);
  const r6b = step(r6.state, { type: 'BUY', itemId: defId });
  check('买加防：防御力永久加到面板上',
    r6b.state.def === r6.state.def + defPlan.amount, `防御 ${r6.state.def} → ${r6b.state.def}`);

  // ⑨ 血量没有上限：血再多也照加不误
  const s7 = openShop(6, 5000);
  s7.hp = 999999;
  const r7 = step(s7, { type: 'BUY', itemId: healId });
  check('血量没有上限：血量再高，加血照样往上加',
    r7.state.hp === 999999 + healPlan.amount, `血量 999999 → ${r7.state.hp}`);

  // ⑩ 金币不够：钱和血都不动
  const s8 = openShop(6, 10);
  const r8 = step(s8, { type: 'BUY', itemId: healId });
  check('金币不够时买不了（钱和血量都不动）',
    r8.state.gold === 10 && r8.state.hp === s8.hp,
    `金币 ${r8.state.gold}，血量 ${r8.state.hp}`);
}

/* ------------------------------------------------------------------ */
/* 2. 无头求解器                                                       */
/* ------------------------------------------------------------------ */

let state;
let shopDone = new Set();   // 已经进过的商店（参考路线只看不买）
const hpUpViolations = [];   // 血量只该往下掉（生命结晶和魔王房的门除外）
const bagViolations = [];    // 背包里只该有图鉴和卷轴
const route = [];
const dmgByLevel = {};
let bookStep = -1;
let bossEntryHp = 0;   // 魔王战开打前身上的血   // 捡到怪物图鉴书时的动作序号（-1 = 这条路线没捡到）

function canSurvive(monsterId) {
  const mon = MONSTERS[monsterId];
  const res = resolveBattle(
    { hp: state.hp, atk: state.atk, def: state.def },
    mon
  );
  return res.win;
}

/** 当前打不赢的怪（把玩家打死）→ 视作墙。 */
function dangerousCells() {
  const grid = getGrid(state.level);
  const bad = new Set();
  grid.forEach((row, y) => row.forEach((t, x) => {
    if (t.t !== 'monster') return;
    if (state.taken[state.level + ':' + x + ',' + y]) return;
    if (!canSurvive(t.id)) bad.add(x + ',' + y);
  }));
  return bad;
}

/** Dijkstra：普通格 cost 1，门 cost 3，怪 cost 30（尽量绕开），dangerous 视作墙 */
function plan(state, target, impassable) {
  const grid = getGrid(state.level);
  const H = grid.length, W = grid[0].length;
  const dist = new Map();
  const prev = new Map();
  const start = state.pos;
  dist.set(start.x + ',' + start.y, 0);
  const open = [{ x: start.x, y: start.y, d: 0 }];

  while (open.length) {
    open.sort((a, b) => a.d - b.d);
    const cur = open.shift();
    const ck = cur.x + ',' + cur.y;
    if (cur.d > (dist.get(ck) ?? Infinity)) continue;
    if (cur.x === target.x && cur.y === target.y) break;

    for (const [dx, dy] of DIRS) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (nx < 0 || ny < 0 || ny >= H || nx >= W) continue;
      const t = grid[ny][nx];
      if (t.t === 'wall') continue;
      if (impassable.has(nx + ',' + ny)) continue;
      // 卷轴那一格绕着走：踩上去卷轴进背包，后面的 ↑ / ↓ 全会被它劫走
      if (WARP_CELL && WARP_CELL.level === state.level && nx === WARP_CELL.x && ny === WARP_CELL.y) continue;
      // 楼梯只能作为目标踩上去
      if ((t.t === 'stairUp' || t.t === 'stairDown') && !(nx === target.x && ny === target.y)) continue;
      let cost = 1;
      if (t.t === 'door') {
        const dk = state.level + ':' + nx + ',' + ny;
        if (!state.openDoors[dk] && !(state.keys[t.lock] || 0)) continue;
        cost = 3;
      } else if (t.t === 'monster' || t.t === 'boss') {
        cost = 30;
      }
      const nk = nx + ',' + ny;
      const nd = cur.d + cost;
      if (nd < (dist.get(nk) ?? Infinity)) {
        dist.set(nk, nd);
        prev.set(nk, [cur.x, cur.y]);
        open.push({ x: nx, y: ny, d: nd });
      }
    }
  }

  const tk = target.x + ',' + target.y;
  if (target.x === start.x && target.y === start.y) return { path: [], cost: 0 };
  if (!prev.has(tk)) return null;

  const path = [];
  let cur = [target.x, target.y];
  while (cur) {
    path.unshift({ x: cur[0], y: cur[1] });
    cur = prev.get(cur[0] + ',' + cur[1]) || null;
  }
  return { path: path.slice(1), cost: dist.get(tk) };
}

function collectTargets(dangerous) {
  const grid = getGrid(state.level);
  const out = [];
  grid.forEach((row, y) => row.forEach((t, x) => {
    const k = state.level + ':' + x + ',' + y;
    if (t.t === 'item' || t.t === 'gold') {
      if (state.taken[k]) return;
      // 传送卷轴不捡：卷轴会突然换层，把规划好的路径打乱
      if (t.t === 'item' && ITEMS[t.id] && ITEMS[t.id].type === 'warp') return;
      out.push({ kind: 'item', cell: { x, y }, tier: 0 });
    } else if (t.t === 'monster') {
      if (state.taken[k]) return;
      if (dangerous.has(x + ',' + y)) return;
      out.push({ kind: 'monster', cell: { x, y }, id: t.id, tier: 2 });
    } else if (t.t === 'boss') {
      if (state.taken[k]) return;
      out.push({ kind: 'boss', cell: { x, y }, id: t.id, tier: 3 });
    } else if (t.t === 'door') {
      if (state.openDoors[k]) return;
      out.push({ kind: 'door', cell: { x, y }, tier: 1 });
    } else if (t.t === 'shop') {
      if (!shopDone.has(state.level)) out.push({ kind: 'shop', cell: { x, y }, tier: 1 });
    } else if (t.t === 'stairUp') {
      out.push({ kind: 'stair', cell: { x, y }, tier: 4 });   // 往上爬的那级楼梯
    }
  }));
  return out;
}

/**
 * 进商店：参考路线只看不买，买了会让终局面板和魔王战数值漂掉。
 * 买不买得动、买了什么效果，由 1i 那组断言单独验。
 */
function shop() {
  shopDone.add(state.level);
  route.push('esc');
  state = step(state, { type: 'CLOSE_SHOP' }).state;
}

function solve() {
  console.log('\n=== 2. 无头求解（30 层通关） ===');
  state = createInitialState(findCharInLevel(0, '@'));
  shopDone = new Set();
  const noProgress = new Set();
  const report = [];
  const journal = [];
  let iterations = 0;
  const trace = [];
  let lastLevel = 0;

  while (state.status !== 'win') {
    if (++iterations > 40000) {
      console.log(trace.join('\n'));
      throw new Error(`求解器迭代超限：第 ${state.level + 1} 层，位置 (${state.pos.x},${state.pos.y})，血量 ${state.hp}`);
    }
    if (state.status === 'dead') {
      throw new Error(`第 ${state.level + 1} 层阵亡于 (${state.pos.x},${state.pos.y})`);
    }
    if (state.status === 'inShop') { shop(); continue; }
    if (state.status === 'inBook') {
      route.push('esc');
      state = step(state, { type: 'CLOSE_BOOK' }).state;
      continue;
    }

    if (state.level !== lastLevel) {
      lastLevel = state.level;
      report.push({
        level: state.level,
        atk: state.atk, def: state.def, hp: state.hp,
        gold: state.gold, steps: state.steps,
      });
    }

    const dangerous = dangerousCells();
    const targets = collectTargets(dangerous).filter(
      (t) => !noProgress.has(state.level + ':' + t.cell.x + ',' + t.cell.y)
    );

    let best = null;
    for (const t of targets) {
      const p = plan(state, t.cell, dangerous);
      if (!p) continue;
      if (!best || t.tier < best.target.tier ||
          (t.tier === best.target.tier && p.cost < best.cost)) {
        best = { target: t, ...p };
      }
    }
    if (!best) {
      const dump = targets.map((t) => {
        const p = plan(state, t.cell, dangerous);
        return `${t.kind}@(${t.cell.x},${t.cell.y})=${p ? 'ok' : 'UNREACHABLE'}`;
      }).join(' ');
      console.log('  已发生事件：' + journal.slice(-30).join(' / '));
      console.log('  目标清单：' + (dump || '(空)'));
      console.log('  危险怪：' + [...dangerous].join(',') + '  钥匙：' + JSON.stringify(state.keys));
      throw new Error(`第 ${state.level + 1} 层没有可达目标（位置 ${state.pos.x},${state.pos.y}，血量 ${state.hp}）`);
    }

    if (best.path.length === 0 && best.target.kind !== 'stair') {
      noProgress.add(state.level + ':' + best.target.cell.x + ',' + best.target.cell.y);
      continue;
    }

    trace.push(`#${iterations} L${state.level + 1} pos(${state.pos.x},${state.pos.y}) -> ${best.target.kind}@(${best.target.cell.x},${best.target.cell.y}) len=${best.path.length}`);
    if (trace.length > 22) trace.shift();

    for (const next of best.path) {
      const t = getGrid(state.level)[next.y][next.x];
      if (t.t === 'boss' && !state.taken[state.level + ':' + next.x + ',' + next.y]) {
        bossEntryHp = state.hp;
        if (!canSurvive(t.id)) {
          console.log('  背包：' + JSON.stringify(state.bag) + '  金币：' + state.gold);
          console.log('  各层结束时：');
          report.forEach((r) => console.log(`    第 ${r.level + 1} 层  血 ${r.hp}  金币 ${r.gold}`));
          throw new Error(`打不过魔王：当前 ${state.hp} 血、攻击 ${state.atk}、防御 ${state.def}`);
        }
      }
      const dx = next.x - state.pos.x, dy = next.y - state.pos.y;
      route.push(DIR_NAME[dx + ',' + dy]);
      const hpBefore = state.hp;
      const mv = step(state, { type: 'MOVE', dir: DIR_NAME[dx + ',' + dy] });
      for (const ev of mv.events) journal.push(`L${state.level + 1} ${ev.text}`);
      state = mv.state;
      if (state.hp < hpBefore) dmgByLevel[state.level] = (dmgByLevel[state.level] || 0) + (hpBefore - state.hp);
      // 血量只该往下掉：只有捡生命结晶、推开魔王房的门才会涨
      if (state.hp > hpBefore) {
        const isCrystal = t.t === 'item' && ITEMS[t.id] && ITEMS[t.id].type === 'heart';
        if (!isCrystal) {
          hpUpViolations.push(`第 ${state.level + 1} 层 (${next.x},${next.y}) 血量 ${hpBefore} → ${state.hp}`);
        }
      }
      // 路径可能顺手踩过卷轴格，捡到就丢掉，免得它半路把人传走
      if (state.bag && state.bag.warp_scroll) delete state.bag.warp_scroll;
      // 背包里只该有图鉴和卷轴：药和商店商品都是当场生效，不进背包
      for (const id of Object.keys(state.bag || {})) {
        const it = ITEMS[id];
        if (!it || (it.type !== 'book' && it.type !== 'warp')) {
          bagViolations.push(`第 ${state.level + 1} 层背包里出现了 ${id}`);
        }
      }
      if (bookStep < 0 && state.bag && state.bag.monster_book) bookStep = route.length;
      if (state.status === 'dead') throw new Error(`第 ${state.level + 1} 层阵亡`);
      if (state.status === 'win') break;
    }
  }

  console.log('\n  层 | 攻击 | 防御 |   生命 | 金币 | 累计步数');
  console.log('  ---+-----+------+-------+------+---------');
  for (const r of report) {
    console.log(
      `  ${String(r.level + 1).padStart(2)} | ${String(r.atk).padStart(4)} | ${String(r.def).padStart(4)} | ` +
      `${String(r.hp).padStart(7)} | ${String(r.gold).padStart(4)} | ${String(r.steps).padStart(6)}`
    );
  }

  const mon = MONSTERS.demon_king;
  const pDmg = Math.max(1, state.atk - mon.def);
  const rounds = Math.ceil(mon.hp / pDmg);
  const bDmg = Math.max(1, mon.atk - state.def);

  console.log('\n  --- 魔王战验算 ---');
  console.log(`  玩家面板：攻击 ${state.atk} / 防御 ${state.def} / 生命 ${state.hp}`);
  console.log(`  每回合输出 ${pDmg}（=${state.atk}-${mon.def}），击杀需 ${rounds} 回合`);
  console.log(`  魔王每回合 ${bDmg}（=${mon.atk}-${state.def}），反击 ${rounds - 1} 次共 ${bDmg * (rounds - 1)} 伤害`);
  console.log(`  通关剩余生命：${state.hp}`);
  console.log(`  通关总步数：${state.steps}，金币：${state.gold}`);

  return { state, report, rounds, bossDamage: bDmg * (rounds - 1), bookStep, bossEntryHp, dmgByLevel };
}

/* ------------------------------------------------------------------ */

try {
  checkLevels();
  checkMapDensity();
  checkMonsterPosts();
  checkStairLanding();
  checkWarpRules();
  checkBattleRules();
  checkNoPotions();
  checkHealRules();
  checkShopRules();
  const result = solve();
  check('整条通关路线上血量只会往下掉（只有捡生命结晶会涨）',
    hpUpViolations.length === 0, hpUpViolations.slice(0, 5).join(' | '));

  console.log('\n=== 3. 验收断言 ===');
  check('30 层全部走通并击杀魔王', result.state.status === 'win');
  check(`终局面板达到设计值（攻击 ${TARGET.atk} / 防御 ${TARGET.def}）`,
    result.state.atk === TARGET.atk && result.state.def === TARGET.def,
    `实际 ${result.state.atk}/${result.state.def}`);
  check(`魔王战开打前身上有 ${TARGET.hp} 血（没有上限，全靠一路攒）`,
    result.bossEntryHp === TARGET.hp, `实际 ${result.bossEntryHp}`);
  check('魔王战 48 回合（每回合 4200 伤害）', result.rounds === 48, `实际 ${result.rounds} 回合`);
  check('通关后剩余生命在 11600 上下（8000~16000）',
    result.state.hp >= 8000 && result.state.hp <= 16000,
    `实际 ${result.state.hp}`);
  const bossLook = previewFight(
    { hp: TARGET.hp, atk: TARGET.atk, def: TARGET.def },
    MONSTERS.demon_king
  );
  check('图鉴对魔王的结论是"损失 56400 点血量"',
    bossLook.verdict === 'damage' && bossLook.loss === 56400, JSON.stringify(bossLook));
  check('通关路线上捡到了怪物图鉴书，并且全程带在身上',
    result.bookStep >= 0 && result.state.bag && result.state.bag.monster_book === 1,
    `捡到时机：第 ${result.bookStep} 个动作`);
  check('整条通关路线上背包里只有图鉴和卷轴（药和商店商品都不进背包）',
    bagViolations.length === 0, bagViolations.slice(0, 5).join(' | '));
  const dmgBad = [];
  const measuredAll = [];
  for (let f = 1; f <= 30; f++) {
    const measured = (result.dmgByLevel[f - 1] || 0) - (f === 30 ? 56400 : 0);
    measuredAll.push(measured);
    if (measured !== FLOOR_DAMAGE[f]) {
      dmgBad.push(`第 ${f} 层实测 ${measured} / 表里 ${FLOOR_DAMAGE[f]}`);
    }
  }
  check('每一层掉的血和数值表对得上（结晶给多少就是这么标定的）',
    dmgBad.length === 0, '实测 ' + measuredAll.join(','));
  check('装备为 5 档钻石剑 + 5 档钻石盾',
    result.state.gear.weapon && result.state.gear.weapon.tier === 5 &&
    result.state.gear.armor && result.state.gear.armor.tier === 5,
    JSON.stringify(result.state.gear));
} catch (err) {
  console.log('\n FAIL  ' + err.message);
  failures.push(err.message);
}

if (process.argv.includes('--emit')) {
  const out = process.cwd() + '/tools/solution.json';
  writeFileSync(out, JSON.stringify(route));
  console.log('\n  路线已导出：' + out + '（' + route.length + ' 步）');

  // 顺带导出逐动作指纹：浏览器回放时每走一步就跟规则层对一次账，
  // 对不上就说明表现层和规则层不是同一套结果。
  const marks = [];
  let s = createInitialState(findCharInLevel(0, '@'));
  const fp = (st) => [st.level + 1, st.hp, st.atk, st.def, st.gold, st.steps, st.pos.x, st.pos.y].join('|');
  marks.push(fp(s));
  for (const a of route) {
    if (a === 'esc') {
      s = (s.status === 'inShop'
        ? step(s, { type: 'CLOSE_SHOP' })
        : step(s, { type: 'CLOSE_BOOK' })).state;
    } else {
      s = step(s, { type: 'MOVE', dir: a }).state;
    }
    marks.push(fp(s));
  }
  const fpOut = process.cwd() + '/tools/fingerprints.json';
  writeFileSync(fpOut, JSON.stringify(marks));
  console.log('  指纹已导出：' + fpOut + '（' + marks.length + ' 个对账点）');
}

console.log('');
if (failures.length) {
  console.log(`❌ 验证未通过：${failures.length} 项失败`);
  process.exitCode = 1;
} else {
  console.log('✅ 全部验证通过：这座 30 层塔可以被走通，20 万血的魔王可以被击杀。');
}
