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

let failures = [];
function check(name, cond, detail = '') {
  console.log(`${cond ? '  OK  ' : ' FAIL '} ${name}${detail ? '  — ' + detail : ''}`);
  if (!cond) failures.push(name + (detail ? ': ' + detail : ''));
}

/* ------------------------------------------------------------------ */
/* 1. 关卡结构校验                                                     */
/* ------------------------------------------------------------------ */

/** 从起点 BFS，可把某类格子当成墙 */
function reachable(state, blockedKind) {
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
      if (blockedKind === 'door' && t.t === 'door') continue;
      if (blockedKind === 'monster' && (t.t === 'monster' || t.t === 'boss')) continue;
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

  // 地图统一 11×11：比 13×13 少一大圈，跑路时间短，战斗密度高
  const badSize = LEVELS.map((l, i) => ({ l, i }))
    .filter(({ l }) => l.rows.length !== 11 || l.rows[0].length !== 11);
  check('30 层地图都是 11×11', badSize.length === 0,
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
    check('怪物图鉴书就在第 1 层出口（书 → 门 → 往上爬的楼梯，三格一线）',
      !!door && !!stair &&
      manhattan(b, door) === 1 && manhattan(door, stair) === 1 &&
      aligned(b, door) && aligned(door, stair) && (b.x === stair.x || b.y === stair.y),
      `书 (${b.x},${b.y}) 门 (${door ? door.x : '-'},${door ? door.y : '-'}) 楼梯 (${stair ? stair.x : '-'},${stair ? stair.y : '-'})`);
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
  check('第 1 层图鉴只列本层的 4 种怪（守关怪 + 2 只壁龛怪 + 巡逻怪）',
    firstLayerMonsters.length === 4 &&
    firstLayerMonsters.includes('guard_1') &&
    firstLayerMonsters.includes('imp_1') &&
    firstLayerMonsters.includes('spr_1') &&
    firstLayerMonsters.includes('patrol_1'),
    firstLayerMonsters.join(', '));
  const lastLayerMonsters = monsterIdsOnLevel(LEVELS.length - 1);
  check('第 30 层图鉴里有魔王',
    lastLayerMonsters.includes('demon_king'), lastLayerMonsters.join(', '));
  check('各层图鉴里的怪都在怪物表里',
    LEVELS.every((level, i) => monsterIdsOnLevel(i).every((id) => !!MONSTERS[id])));
  const listedTotal = LEVELS.reduce((n, level, i) => n + monsterIdsOnLevel(i).length, 0);
  check('图鉴合计 = 30 层 × 4 种 + 末层多 1 只魔王 = 121 种', listedTotal === 121, `实际 ${listedTotal} 种`);

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

  // ---- 关键奖励必须在死胡同里 ----
  const probe = createInitialState(findCharInLevel(0, '@'));
  LEVELS.forEach((level, i) => {
    const grid = getGrid(i);
    const outside = [];
    grid.forEach((row, y) => row.forEach((t, x) => {
      if (t.t !== 'item') return;
      const item = ITEMS[t.id];
      if (!item) return;
      const precious = item.type === 'equip' || item.type === 'heart';
      if (!precious) return;
      if (neighborsOf(i, x, y).length !== 1) outside.push(`${item.name}@(${x},${y})`);
    }));
    check(`第 ${i + 1} 层贵重奖励都在死胡同里`, outside.length === 0, outside.join(' '));
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
      const noDoor = reachable(st, 'door');
      check(`第 ${i + 1} 层：楼梯只能经由门进入`, !noDoor.has(stair.x + ',' + stair.y),
        noDoor.has(stair.x + ',' + stair.y) ? '门全封死后楼梯仍可达（可绕过门）' : '');
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

  const WALL_LIMIT = 0.65;   // 墙占比上限（实测 59.5%）
  const MON_LIMIT = 5;       // 每层最少怪数（守关怪 + 2 只壁龛怪 + 至少 2 只巡逻怪）
  const ITEM_LIMIT = 6;      // 每层最少道具数（不含楼梯/门/怪）
  const DEAD_LIMIT = 6;      // 每层最少死胡同（钥匙/结晶/剑盾/楼梯都要塞进死胡同）

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

    // 走廊宽度：任何 2×2 的方块里必须至少有一格墙。
    // 否则就会出现 2×2 的空地（一小片开阔地），那就不是"一行一行的道路"了。
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

  const openSquares = openSquaresPerLevel.reduce((n, v) => n + v, 0);
  check('没有 2×2 的空地（走廊都是一格宽，没有开阔地）', openSquares === 0,
    `共 ${openSquares} 处 2×2 空地`);

  const minDead = Math.min(...deadCounts);
  check(`每层死胡同够用（最少 ${minDead} 个，下限 ${DEAD_LIMIT}）`, minDead >= DEAD_LIMIT);

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
/* 1e. 怪物站位：都堵在通道中间，身后是存资源的房间                        */
/* ------------------------------------------------------------------ */

/**
 * 每只怪都必须"有位置"，但分两种站位：
 *
 *   壁龛怪（守关怪 / 小鬼 / 史莱姆）：
 *     - 站在死胡同的走廊口上，格子只有两个出口
 *     - 身后那格死胡同房间里放着资源
 *
 *   巡逻怪（patrol_*）：
 *     - 站在两间房之间的通道上（格子只有两个出口）
 *     - 两头都不是死胡同——它堵的是主路，不是壁龛
 *
 * 孤零零站在空地上的怪会被这条断言挡下来。
 */
function checkMonsterPosts() {
  console.log('\n=== 1e. 怪物站位 ===');
  const D2 = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  const bad = [];
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
    grid.forEach((row, y) => row.forEach((t, x) => {
      if (t.t !== 'monster') return;
      checked++;
      const deg = degOfCell(x, y);
      if (deg !== 2) {
        bad.push(`第 ${i + 1} 层 ${t.id}@(${x},${y}) 出口 ${deg} 个（必须正好 2 个）`);
        return;
      }

      // 身后那格：它的出口只有 1 个（出口就是怪站的地方），所以是个封闭的小房间
      let room = null;
      for (const [dx, dy] of D2) {
        const a = at(x + dx, y + dy);
        if (!a || a.t === 'wall') continue;
        if (degOfCell(x + dx, y + dy) === 1) { room = a; break; }
      }

      if (t.id.startsWith('patrol_')) {
        // 巡逻怪：两头都必须是普通房间（不是死胡同），它堵的是主路
        patrols++;
        if (room) {
          bad.push(`第 ${i + 1} 层 ${t.id}@(${x},${y}) 站在死胡同口上（该由壁龛怪站）`);
        }
        return;
      }

      const holdsSomething = room &&
        (room.t === 'item' || room.t === 'shop' || room.t === 'gold' || room.t === 'door');
      if (!holdsSomething) {
        bad.push(`第 ${i + 1} 层 ${t.id}@(${x},${y}) 身后 ${room ? room.ch : '无房间'}（壁龛怪身后必须有资源）`);
      }
    }));
  });
  check(`壁龛怪堵在死胡同口、身后有资源（共 ${checked - patrols} 只）`,
    bad.filter((b) => !b.includes('patrol_')).length === 0,
    bad.filter((b) => !b.includes('patrol_')).slice(0, 6).join(' '));
  check(`巡逻怪站在两间房之间的通道上，堵住主路（共 ${patrols} 只）`,
    bad.filter((b) => b.includes('patrol_')).length === 0,
    bad.filter((b) => b.includes('patrol_')).slice(0, 6).join(' '));

  // 每层的巡逻怪数量：前 15 层 2 只，后 15 层 3 只
  const perLevel = [];
  LEVELS.forEach((level, i) => {
    const grid = getGrid(i);
    let n = 0;
    grid.forEach((row, y) => row.forEach((t, x) => {
      if (t.t === 'monster' && t.id.startsWith('patrol_')) n++;
    }));
    perLevel.push(n);
  });
  const wrongCount = perLevel.filter((n, i) => n !== (i < 15 ? 2 : 3));
  check('每层巡逻怪数量符合设计（前 15 层 2 只，后 15 层 3 只）',
    wrongCount.length === 0,
    wrongCount.map((_, i) => i + 1).join(' '));
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
      const r2 = step(r1.state, { type: 'MOVE', dir: dirTo(door, stairUp) });
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
  const patrol = MONSTERS.patrol_1;        // 第 1 层巡逻怪 460/66/8

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

  const potionChars = [];
  LEVELS.forEach((level, i) => {
    level.rows.forEach((row, y) => Array.from(row, (ch, x) => {
      if (ch === 'p' || ch === 'q') potionChars.push(`第 ${i + 1} 层 (${x},${y})`);
    }));
  });
  check('地图里没有药水格', potionChars.length === 0, potionChars.slice(0, 5).join(' '));

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
    if (t.t === 'monster' && t.id === 'imp_1') imp = { x, y };
  }));
  check('第 1 层找得到生命结晶和守着它的小鬼', !!crystal && !!imp);
  if (crystal && imp) {
    const start = neighborsOf(0, imp.x, imp.y)
      .map((k) => k.split(',').map(Number))
      .find(([x, y]) => !(x === crystal.x && y === crystal.y));
    check('小鬼旁边有能站的格子', !!start, JSON.stringify(start));
    if (start) {
      const st = createInitialState({ x: start[0], y: start[1] });
      st.hp = 300;                       // 故意带着残血去捡
      const r1 = step(st, { type: 'MOVE', dir: dirTo(st.pos, imp) });
      const r2 = step(r1.state, { type: 'MOVE', dir: dirTo(r1.state.pos, crystal) });
      const gain = crystalOn(1);
      check('捡到生命结晶：血量直接涨上去，没有上限',
        r2.state.hp === r1.state.hp + gain && !('maxHp' in r2.state),
        `血量 ${r1.state.hp} → ${r2.state.hp}（结晶 +${gain}）`);
    }
  }

  // ② 推开魔王房的门：不再回血（没有"满"可回），直接开打
  const boss = findCharInLevel(LEVELS.length - 1, 'X');
  check('第 30 层找得到魔王', !!boss);
  if (boss) {
    const mouth = neighborsOf(LEVELS.length - 1, boss.x, boss.y)
      .map((k) => k.split(',').map(Number))[0];
    const st = createInitialState({ x: mouth[0], y: mouth[1] });
    st.level = LEVELS.length - 1;
    st.hp = TARGET.hp;
    st.atk = TARGET.atk; st.def = TARGET.def;
    const r = step(st, { type: 'MOVE', dir: dirTo(st.pos, boss) });
    check('推开魔王房的门：不再回血，直接开打',
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
    dmgBad.length === 0, dmgBad.length ? '实测 ' + measuredAll.join(',') : '');
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
}

console.log('');
if (failures.length) {
  console.log(`❌ 验证未通过：${failures.length} 项失败`);
  process.exitCode = 1;
} else {
  console.log('✅ 全部验证通过：这座 30 层塔可以被走通，20 万血的魔王可以被击杀。');
}
