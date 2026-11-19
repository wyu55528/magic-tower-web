/**
 * 30 层塔的关卡生成器。
 *
 * 关卡方案（哪层放什么、数值多少）写在这个文件里，地图按方案刻出来，
 * 所以重新跑一次就能得到一模一样的塔。调平衡改这里的 PLAN，
 * 改布局改 buildMap / tryPlace。
 *
 * 地图结构：一格宽的走廊迷宫，没有开阔地。
 *   - 奇数坐标是房间，房间之间隔一格走廊，走廊用随机 DFS 打通成一棵树；
 *     偶数坐标是实心柱子，所以任何 2×2 的方块里必定有一格墙
 *     —— 整张图不存在 2×2 的空地，走起来永远是一格宽的通道
 *   - 走廊末端自然形成死胡同：一格房间 + 一格走廊口。
 *     走廊格只连着两间房，出口数恒为 2，所以怪站在走廊口就是堵在通道中间，
 *     身后那格死胡同就是存着资源的小房间
 *   - 每层最多用掉 6 个死胡同：往上那级楼梯（末层是魔王）、开门钥匙、
 *     生命结晶、商店 / 传送卷轴 / 备用钥匙、剑或盾、往下那级楼梯
 *
 * 塔是往上爬的：第 1 层在最底下。
 *   '>' 画成 ↑，踩上去通到上面一层；'<' 画成 ↓，踩上去回到下面一层。
 *
 * 每层强制的不变式（tools/verify.js 会再验一遍）：
 *   - 往上那级楼梯（末层是魔王）在门后的死胡同里，开门钥匙在守关怪身后
 *   - 剑、盾、生命结晶都藏在死胡同里
 *   - 每只怪都站在只有两个出口的走廊口上，身后是存着资源的房间
 *   - 没有 2×2 的空地，走廊都是一格宽
 *
 * 运行： node tools/gen-levels.mjs [地图边长] [随机种子]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SWORDS, SHIELDS, FLOOR_COUNT, SHOP_FLOORS, atkOn, defOn, crystalOn, patrolCount } from '../js/data/balance.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEVELS_FILE = join(ROOT, 'js', 'data', 'levels.js');
const BEGIN = '/* ==== LEVELS:BEGIN ==== */';
const END = '/* ==== LEVELS:END ==== */';

const SIZE = Number(process.argv[2]) || 11;
const SEED = Number(process.argv[3]) || 20261117;

const FLOOR_NAMES = [
  '庭院', '石阶', '钟楼', '画廊', '密道', '熔炉', '冰窟', '暗殿', '王座前', '熔火王座',
  '荒骨荒原', '暗河', '霜牙巢穴', '幽冥回廊', '血月祭坛', '机械圣所', '万骨魔殿', '虚空裂隙',
  '魔王前庭', '终焉回廊', '灰烬阶梯', '逆时之庭', '骸骨书库', '熔金深渊', '寂灭回廊',
  '妖星观测台', '断罪刑场', '湮灭之门', '无光圣殿', '魔王之座',
];

// 剑 / 盾 / 生命结晶的档位表在 js/data/balance.js 里，
// 那里是全塔唯一的数值来源，生成器和怪物表都从那儿取数。
const BOOK_FLOOR = 1;
const WARP_FLOOR = 15;
const LOCKS = ['yellow', 'blue', 'red'];
const LOCK_CHARS = { yellow: 'y', blue: 'b', red: 'r' };
const DOOR_CHARS = { yellow: 'd', blue: 'D', red: 'R' };

// 每层的内容密度
const GOLD_PER_FLOOR = 3;    // 金币格数
/** 门的颜色：黄→蓝→红循环 */
function doorLock(floor) {
  return LOCKS[(floor - 1) % 3];
}
/** 本层门的钥匙 + 下一层门的备用钥匙 */
function keysOn(floor) {
  const out = [{ ch: LOCK_CHARS[doorLock(floor)], role: 'door' }];
  if (floor < FLOOR_COUNT) {
    const next = LOCKS[floor % 3];
    if (next !== doorLock(floor)) out.push({ ch: LOCK_CHARS[next], role: 'spare' });
  }
  return out;
}

/** 一层的完整方案 */
function planOf(floor) {
  const atk = atkOn(floor);
  const sword = SWORDS.find((s) => s.floor === floor);
  const shield = SHIELDS.find((s) => s.floor === floor);
  return {
    floor,
    name: '第 ' + floor + ' 层 · ' + FLOOR_NAMES[floor - 1],
    guardId: 'guard_' + floor,
    impId: 'imp_' + floor,
    sprId: 'spr_' + floor,
    patrolId: 'patrol_' + floor,
    crystal: crystalOn(floor),
    sword: sword ? sword.id : null,
    shield: shield ? shield.id : null,
    doorLock: doorLock(floor),
    keys: keysOn(floor),
    golds: [
      { ch: '$', value: Math.floor(0.13 * atk) },
      { ch: '%', value: Math.floor(0.06 * atk) },
      { ch: '&', value: Math.floor(0.04 * atk) },
    ],
    hasBook: floor === BOOK_FLOOR,
    hasWarp: floor === WARP_FLOOR,
    hasShop: SHOP_FLOORS.includes(floor),
    isLast: floor === FLOOR_COUNT,
  };
}

/* ---------------- 随机数 ---------------- */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(SEED);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

/* ---------------- 地图 ---------------- */
const DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]];

/**
 * 开阔场地 + 分散壁龛。
 *
 * 做法：先把内部全挖成空地，再凿壁龛。
 *   - 门闸壁龛（gated）：Q - M - P 一条直线，P 是尽头（死胡同），
 *     M 是壁龛口（只有 P 和 Q 两个出口，所以门放在 M 上就能卡住整条路）
 *   - 普通壁龛（plain）：P 是尽头，M 是开口，M 其它方向照常通，
 *     所以奖励要拐进去才拿得到
 * 每个壁龛的墙都跟别的壁龛的墙保持一格以上距离，
 * 于是墙永远连不成大块（校验器会断言最大连通墙块只有 2 格）。
 */
/**
 * 迷宫式走廊布局。
 *
 * 奇数坐标是"房间"，两个房间之间隔着一格走廊；打通哪些走廊，就决定了地图长什么样。
 * 偶数坐标（2,2）(2,4)... 是实心柱子，所以地图里任何 2×2 的方块必定含一格墙
 * —— 整张图不存在 2×2 的空地，走起来永远是一格宽的通道，不会再有开阔地。
 *
 * 走廊用随机 DFS 打通成一棵树（25 间房、24 段走廊），末端自然形成死胡同。
 * 一个死胡同 = 一格房间 + 一格走廊口：
 *   - 房间是尽头，放东西
 *   - 走廊格只连着两间房，出口数恒为 2，正好是"堵在通道中间"的那一格
 */
function buildMap(N) {
  const grid = Array.from({ length: N }, () => new Array(N).fill(0));  // 0 = 墙
  const rooms = [];
  const idxOf = new Map();
  for (let y = 1; y < N - 1; y += 2) {
    for (let x = 1; x < N - 1; x += 2) {
      idxOf.set(x + ',' + y, rooms.length);
      rooms.push({ x, y });
    }
  }
  if (!rooms.length) return null;

  // 随机 DFS：打通一棵树
  const seen = new Array(rooms.length).fill(false);
  const stack = [0];
  seen[0] = true;
  grid[rooms[0].y][rooms[0].x] = 1;
  while (stack.length) {
    const cur = rooms[stack[stack.length - 1]];
    const cand = [];
    for (const [dx, dy] of DIRS) {
      const nx = cur.x + 2 * dx, ny = cur.y + 2 * dy;
      if (nx < 1 || ny < 1 || nx >= N - 1 || ny >= N - 1) continue;
      const ni = idxOf.get(nx + ',' + ny);
      if (ni === undefined || seen[ni]) continue;
      cand.push({ ni, mx: cur.x + dx, my: cur.y + dy });
    }
    if (!cand.length) { stack.pop(); continue; }
    const ch = cand[Math.floor(rnd() * cand.length)];
    grid[ch.my][ch.mx] = 1;                     // 打通这一格走廊
    grid[rooms[ch.ni].y][rooms[ch.ni].x] = 1;   // 目标房间
    seen[ch.ni] = true;
    stack.push(ch.ni);
  }

  // 每间房的出口数
  const degOf = new Map();
  for (const r of rooms) {
    degOf.set(r.x + ',' + r.y, degree(grid, r.x, r.y));
  }

  // 死胡同：一格房间 + 一格走廊口（走廊口的另一头是另一间房）
  const deadEnds = [];
  for (const r of rooms) {
    if (degOf.get(r.x + ',' + r.y) !== 1) continue;
    let mouth = null;
    let other = null;
    for (const [dx, dy] of DIRS) {
      const nx = r.x + dx, ny = r.y + dy;
      if (nx < 0 || ny < 0 || ny >= N || nx >= N) continue;
      if (grid[ny][nx] !== 1) continue;
      mouth = { x: nx, y: ny };
      break;
    }
    if (!mouth) continue;
    for (const [dx, dy] of DIRS) {
      const nx = mouth.x + dx, ny = mouth.y + dy;
      if (nx === r.x && ny === r.y) continue;
      if (nx < 0 || ny < 0 || ny >= N || nx >= N) continue;
      if (grid[ny][nx] === 1) { other = { x: nx, y: ny }; break; }
    }
    deadEnds.push({ room: r, mouth, other });
  }

  return { grid, rooms, degOf, deadEnds };
}

/** 空地邻居数 */
function degree(grid, x, y) {
  let d = 0;
  for (const [dx, dy] of DIRS) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || ny >= grid.length || nx >= grid[0].length) continue;
    if (grid[ny][nx] === 1) d++;
  }
  return d;
}

function fail(why) { return { fail: why }; }

/**
 * 在地图上摆东西。
 * 壁龛的角色分配：
 *   gated[0]  -> 门 + 往上爬的楼梯（第 30 层是魔王）
 *   gated[1]  -> 守关怪堵在通道口，身后是开门的钥匙
 *   narrow[0] -> 小鬼堵在通道口，身后是生命结晶
 *   narrow[1] -> 史莱姆堵在通道口，身后是商店 / 传送卷轴 / 备用钥匙
 *   plain[0]  -> 剑 / 盾
 *   plain[1]  -> 往下走回上一层的楼梯
 */
/**
 * 在地图上摆东西。
 *
 * 死胡同的用法（每层最多用掉 6 个）：
 *   往上那级楼梯（末层是魔王）+ 门    门在走廊口，楼梯在门后的死胡同
 *   开门钥匙 + 守关怪                守关怪堵在走廊口，钥匙在它身后
 *   生命结晶 + 小鬼                  小鬼堵在走廊口，结晶在它身后
 *   商店 / 传送卷轴 / 备用钥匙 + 史莱姆
 *   剑 / 盾                          放在死胡同里，走到底才拿得到
 *   往下走回上一层的楼梯
 *
 * 走廊格只连着两间房，出口数恒为 2，所以怪站在走廊口就是"堵在通道中间"，
 * 它身后那格死胡同就是存着资源的小房间。
 */
/**
 * 巡逻怪：站在通路上拦路。
 *
 * 走廊格是奇偶交替的（房间在奇数坐标，走廊在偶数坐标那一侧），
 * 一格走廊只连着两间房，出口数恒为 2，所以怪站在上面就等于堵住整条路。
 *
 * 巡逻怪只站在**不是死胡同口**的走廊上：死胡同口留给守关怪和壁龛怪，
 * 巡逻怪堵的是主路，所以玩家从落脚点往里走，一路都要打。
 */
function placePatrols(map, plan, placed, used, arrival) {
  const { grid } = map;
  const N = grid.length;
  const want = patrolCount(plan.floor);

  // 从落脚点 BFS，算每格离落脚点多远（用来把怪铺开在不同的距离上）
  const dist = new Map();
  const queue = [arrival];
  dist.set(arrival.x + ',' + arrival.y, 0);
  while (queue.length) {
    const cur = queue.shift();
    const d = dist.get(cur.x + ',' + cur.y);
    for (const [dx, dy] of DIRS) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (nx < 0 || ny < 0 || ny >= N || nx >= N) continue;
      if (grid[ny][nx] !== 1) continue;
      const k = nx + ',' + ny;
      if (dist.has(k)) continue;
      dist.set(k, d + 1);
      queue.push({ x: nx, y: ny });
    }
  }

  // 候选：走廊格（奇偶交替），没被占过，离落脚点至少 2 步
  //
  // 走廊格只连着两间房（出口数恒为 2），所以它本身就堵住了整条路。
  // 但死胡同的走廊口要留给壁龛怪，巡逻怪只站在两头都是普通房间的通道上。
  const cand = [];
  for (let y = 1; y < N - 1; y++) {
    for (let x = 1; x < N - 1; x++) {
      if (grid[y][x] !== 1) continue;
      if (x % 2 === 1 && y % 2 === 1) continue;    // 房间格，不算走廊
      const k = x + ',' + y;
      if (used.has(k) || placed.has(k)) continue;
      // 这格走廊两头的房间（横向走廊是左右，纵向走廊是上下）
      const rooms = x % 2 === 0
        ? [{ x: x - 1, y }, { x: x + 1, y }]
        : [{ x, y: y - 1 }, { x, y: y + 1 }];
      const isDeadMouth = rooms.some((r) => (map.degOf.get(r.x + ',' + r.y) || 0) === 1);
      if (isDeadMouth) continue;
      const d = dist.get(k);
      if (d == null || d < 2) continue;
      cand.push({ x, y, k, d });
    }
  }
  if (cand.length < want) return null;

  // 沿着"离落脚点的距离"这条轴均匀铺开，避免几只怪挤在一块
  cand.sort((a, b) => a.d - b.d || (a.k < b.k ? -1 : 1));
  const picked = [];
  const tooClose = (c) => picked.some((p) => Math.abs(p.x - c.x) + Math.abs(p.y - c.y) < 3);
  for (let i = 0; i < want; i++) {
    const idx = want === 1 ? Math.floor(cand.length / 2)
      : Math.round((i * (cand.length - 1)) / (want - 1));
    let c = cand[idx];
    if (!c) return null;
    if (tooClose(c)) {
      // 就近换一只：离落脚点的距离差不多就行
      const alt = cand.find((t) => !tooClose(t) && Math.abs(t.d - c.d) <= 3);
      if (!alt) continue;
      c = alt;
    }
    picked.push(c);
  }
  if (picked.length < want) return null;

  for (const c of picked) {
    placed.set(c.k, 'v');
    used.add(c.k);
  }
  return picked;
}

function tryPlace(map, plan) {
  const { grid, deadEnds, degOf } = map;
  const N = grid.length;
  const placed = new Map();
  const K = (c) => c.x + ',' + c.y;
  const put = (cell, ch) => placed.set(K(cell), ch);
  const used = new Set();

  /** 挑一个还没用过的死胡同（房间 + 走廊口都不许重复） */
  const pickDead = (filter) => {
    const cand = deadEnds.filter((d) =>
      !used.has(K(d.room)) && !used.has(K(d.mouth)) && (!filter || filter(d)));
    if (!cand.length) return null;
    const d = cand[Math.floor(rnd() * cand.length)];
    used.add(K(d.room));
    used.add(K(d.mouth));
    return d;
  };

  // 往上那级楼梯（第 30 层是魔王）：门在走廊口，楼梯在门后的死胡同
  const stair = pickDead((d) => d.other && degOf.get(K(d.other)) >= 2);
  if (!stair) return fail('stair');
  put(stair.room, plan.isLast ? 'X' : '>');
  put(stair.mouth, DOOR_CHARS[plan.doorLock]);
  if (plan.hasBook) {
    // 图鉴书在门的另一头，不开门也够得着
    put(stair.other, 'B');
    used.add(K(stair.other));
  }

  // 守关怪堵在走廊口，开门的钥匙在它身后的死胡同
  const keyRoom = pickDead();
  if (!keyRoom) return fail('key');
  put(keyRoom.room, plan.keys.find((k) => k.role === 'door').ch);
  put(keyRoom.mouth, 'G');

  // 小鬼堵在走廊口，生命结晶在它身后
  const crystal = pickDead();
  if (!crystal) return fail('crystal');
  put(crystal.room, 'h');
  put(crystal.mouth, 'g');

  // 史莱姆堵在走廊口，商店 / 卷轴 / 备用钥匙在它身后
  const nook = pickDead();
  if (!nook) return fail('nook');
  put(nook.mouth, 'k');
  const spare = plan.keys.find((k) => k.role === 'spare');
  if (plan.hasWarp) put(nook.room, 'W');
  else if (plan.hasShop) put(nook.room, 'S');
  else if (spare) put(nook.room, spare.ch);
  else put(nook.room, '%');

  // 剑 / 盾放在死胡同里；这一层没有就摆金币
  const equip = pickDead();
  if (!equip) return fail('equip');
  if (plan.sword) put(equip.room, 's');
  else if (plan.shield) put(equip.room, 't');
  else put(equip.room, '%');

  // 往下走回上一层的楼梯
  let down = null;
  if (plan.floor > 1) {
    down = pickDead();
    if (!down) return fail('down');
    put(down.room, '<');
  }

  // ---- 剩下的零碎：优先塞进还没用过的死胡同，走廊本身尽量留空 ----
  const collectFree = () => {
    const out = [];
    for (let y = 1; y < N - 1; y++) {
      for (let x = 1; x < N - 1; x++) {
        if (grid[y][x] !== 1) continue;
        const k = x + ',' + y;
        if (used.has(k) || placed.has(k)) continue;
        out.push({ x, y });
      }
    }
    return out;
  };
  const deadPool = deadEnds.filter((d) => !used.has(K(d.room)) && !used.has(K(d.mouth)));
  let freeCells = collectFree();
  if (freeCells.length < 8) return fail('space');

  const takeSpot = () => {
    const pool = deadPool.filter((d) => !used.has(K(d.room)));
    if (pool.length) {
      const d = pool[Math.floor(rnd() * pool.length)];
      used.add(K(d.room));
      return d.room;
    }
    const cand = freeCells.filter((c) => !used.has(K(c)));
    if (!cand.length) return null;
    const c = cand[Math.floor(rnd() * cand.length)];
    used.add(K(c));
    return c;
  };

  // 出生点（第 1 层）：挑一格走廊
  let arrival = null;
  if (plan.floor === 1) {
    const roads = freeCells.filter((c) => degree(grid, c.x, c.y) === 2);
    const cand = roads.length ? roads : freeCells;
    const c = cand[Math.floor(rnd() * cand.length)];
    used.add(K(c));
    put(c, '@');
    arrival = c;
  } else {
    // 换层之后落在下楼楼梯旁边的走廊口上，那一格不能站怪
    arrival = down.mouth;
  }

  // 巡逻怪：站在通路上拦路，让这一层的路上处处要打
  const patrol = placePatrols(map, plan, placed, used, arrival);
  if (!patrol) return fail('patrol');
  freeCells = collectFree();

  // 金币
  for (const g of plan.golds.slice(0, GOLD_PER_FLOOR)) {
    const c = takeSpot();
    if (!c) return fail('gold');
    put(c, g.ch);
  }

  // 没摆进壁龛的备用钥匙，摊在剩下的死胡同里
  for (const k of plan.keys) {
    if (k.role !== 'spare') continue;
    if ([...placed.values()].includes(k.ch)) continue;
    const c = takeSpot();
    if (!c) return fail('spare');
    put(c, k.ch);
  }

  // 组装字符图（buildMap 里是 0/1，这里转成 '#' 和 '.'）
  const rows = grid.map((r) => r.map((v) => (v === 1 ? '.' : '#')));
  for (const [k, ch] of placed) {
    const parts = k.split(',');
    rows[Number(parts[1])][Number(parts[0])] = ch;
  }
  return { rows };
}

/* ---------------- 输出 ---------------- */
function legendOf(plan) {
  const lines = [];
  lines.push('          G: ' + JSON.stringify(plan.guardId) + ',');
  lines.push('          g: ' + JSON.stringify(plan.impId) + ',');
  lines.push('          k: ' + JSON.stringify(plan.sprId) + ',');
  lines.push('          v: ' + JSON.stringify(plan.patrolId) + ',');
  if (plan.sword) lines.push('          s: ' + JSON.stringify(plan.sword) + ',');
  if (plan.shield) lines.push('          t: ' + JSON.stringify(plan.shield) + ',');
  lines.push('          h: { id: "life_crystal", hp: ' + plan.crystal + ' },');
  for (const g of plan.golds) {
    lines.push('          ' + JSON.stringify(g.ch) + ': { value: ' + g.value + ' },');
  }
  return lines.join('\n');
}

function emit(placed) {
  const body = placed.map((p, i) => {
    const plan = planOf(i + 1);
    const rows = p.rows.map((r) => "      '" + r.join('') + "',").join('\n');
    return [
      '  {',
      '    id: ' + (i + 1) + ',',
      '    name: ' + JSON.stringify(plan.name) + ',',
      '    legend: {',
      legendOf(plan),
      '    },',
      '    rows: [',
      rows,
      '    ],',
      '  }',
    ].join('\n');
  }).join(',\n');
  return body;
}

/* ---------------- 主流程 ---------------- */
const placed = [];
const stats = [];

for (let f = 1; f <= FLOOR_COUNT; f++) {
  const plan = planOf(f);
  let ok = null;
  let lastFail = '?';
  for (let attempt = 0; attempt < 4000 && !ok; attempt++) {
    const map = buildMap(SIZE);
    if (!map) { lastFail = 'map'; continue; }
    const r = tryPlace(map, plan);
    if (r && r.fail) { lastFail = r.fail; continue; }
    ok = r;
  }
  if (!ok) {
    console.error('第 ' + f + ' 层摆不下（原因 ' + lastFail + '）。');
    process.exit(1);
  }
  placed.push(ok);

  // 统计墙的分布，顺便自己看一遍
  const grid = ok.rows;
  let wall = 0, open = 0, dead = 0;
  const seen = new Set();
  let maxComp = 0;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (grid[y][x] === '#') { wall++; continue; }
      open++;
      let d = 0;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || ny >= SIZE || nx >= SIZE) continue;
        if (grid[ny][nx] !== '#') d++;
      }
      if (d === 1) dead++;
    }
  }
  for (let y = 1; y < SIZE - 1; y++) {
    for (let x = 1; x < SIZE - 1; x++) {
      if (grid[y][x] !== '#') continue;
      const k = x + ',' + y;
      if (seen.has(k)) continue;
      let size = 0;
      const q = [[x, y]];
      seen.add(k);
      while (q.length) {
        const [cx, cy] = q.shift();
        size++;
        for (const [dx, dy] of DIRS) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 1 || ny < 1 || nx >= SIZE - 1 || ny >= SIZE - 1) continue;
          if (grid[ny][nx] !== '#') continue;
          const kk = nx + ',' + ny;
          if (seen.has(kk)) continue;
          seen.add(kk);
          q.push([nx, ny]);
        }
      }
      maxComp = Math.max(maxComp, size);
    }
  }
  stats.push({ f, wall, open, dead, maxComp });
}

const src = readFileSync(LEVELS_FILE, 'utf8');
const bi = src.indexOf(BEGIN);
const ei = src.indexOf(END);
if (bi < 0 || ei < 0) {
  console.error('levels.js 里找不到 ' + BEGIN + ' 标记。');
  process.exit(1);
}
const next = src.slice(0, bi + BEGIN.length) + '\n' + emit(placed) + '\n' + src.slice(ei);
writeFileSync(LEVELS_FILE, next, 'utf8');

const sum = (k) => stats.reduce((n, s) => n + s[k], 0);
console.log('地图边长 ' + SIZE + '，种子 ' + SEED);
console.log('墙占比 ' + (sum('wall') / (sum('wall') + sum('open')) * 100).toFixed(1) +
  '%，平均每层空地 ' + (sum('open') / FLOOR_COUNT).toFixed(1) +
  ' 格、死胡同 ' + (sum('dead') / FLOOR_COUNT).toFixed(1) + ' 个');
console.log('最大连通墙块 ' + Math.max.apply(null, stats.map((s) => s.maxComp)) + ' 格（越大越聚拢）');
console.log('已写入 ' + LEVELS_FILE);
