/**
 * 30 层塔的关卡生成器。
 *
 * 地图结构：13×13 的「九宫格房间」。
 *   9 间 3×3 的房间，被 1 格宽的墙隔开（墙在第 4 / 8 行和第 4 / 8 列）。
 *   房间之间只在墙上开「门洞」，一个门洞就是一条通路。
 *   门洞的连法是一棵有分叉的树（再补几条边形成环路），
 *   所以路会分叉、能绕路，不会是一条道走到黑。
 *
 * 奖励与怪：
 *   5 间「上锁的房间」只有 1 个门洞，门口站着怪：
 *     守关怪守开门的钥匙、小鬼守生命结晶、史莱姆守商店 / 卷轴、小鬼守剑 / 盾。
 *     门口站着怪 → 不打怪就拿不到里面的东西。
 *   往上那级楼梯的房间也只有 1 个门洞，门洞上就是锁着的门 → 封死门就到不了楼梯。
 *   巡逻怪散在各个房间的角上，门洞留空 —— 路上不会出现「一格接一格全是怪」。
 *
 * 运行： node tools/gen-levels.mjs [随机种子]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SWORDS, SHIELDS, FLOOR_COUNT, SHOP_FLOORS, atkOn, defOn, crystalOn, patrolCount } from '../js/data/balance.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEVELS_FILE = join(ROOT, 'js', 'data', 'levels.js');
const BEGIN = '/* ==== LEVELS:BEGIN ==== */';
const END = '/* ==== LEVELS:END ==== */';

const SEED = Number(process.argv[2]) || 20261121;

const FLOOR_NAMES = [
  '庭院', '石阶', '钟楼', '画廊', '密道', '熔炉', '冰窟', '暗殿', '王座前', '熔火王座',
  '荒骨荒原', '暗河', '霜牙巢穴', '幽冥回廊', '血月祭坛', '机械圣所', '万骨魔殿', '虚空裂隙',
  '魔王前庭', '终焉回廊', '灰烬阶梯', '逆时之庭', '骸骨书库', '熔金深渊', '寂灭回廊',
  '妖星观测台', '断罪刑场', '湮灭之门', '无光圣殿', '魔王之座',
];

const BOOK_FLOOR = 1;
const WARP_FLOOR = 15;
const LOCKS = ['yellow', 'blue', 'red'];
const LOCK_CHARS = { yellow: 'y', blue: 'b', red: 'r' };
const DOOR_CHARS = { yellow: 'd', blue: 'D', red: 'R' };

const GOLD_PER_FLOOR = 3;

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
function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}

/* ---------------- 房间骨架 ---------------- */
const DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]];
const K = (x, y) => x + ',' + y;

const GRID = 3;              // 每个方向 3 间房
const ROOM = 3;             // 房间 3×3
const PITCH = ROOM + 1;     // 房间 3 格 + 墙 1 格
const SIZE = GRID * PITCH + 1;   // 13

/** 第 idx 间房（idx = row * GRID + col）的格子范围 */
function roomRect(idx) {
  const r = Math.floor(idx / GRID), c = idx % GRID;
  return { r, c, x: 1 + c * PITCH, y: 1 + r * PITCH, w: ROOM, h: ROOM };
}
/** 房间中心格 */
function roomCenter(idx) {
  const r = roomRect(idx);
  return { x: r.x + 1, y: r.y + 1 };
}
/** 房间的四个角格（怪的候选位） */
function roomCorners(idx) {
  const r = roomRect(idx);
  return [
    { x: r.x, y: r.y },
    { x: r.x + 2, y: r.y },
    { x: r.x, y: r.y + 2 },
    { x: r.x + 2, y: r.y + 2 },
  ];
}
/** 房间的四个边中点（空地 / 金币的候选位） */
function roomEdges(idx) {
  const r = roomRect(idx);
  return [
    { x: r.x + 1, y: r.y },
    { x: r.x, y: r.y + 1 },
    { x: r.x + 2, y: r.y + 1 },
    { x: r.x + 1, y: r.y + 2 },
  ];
}
/** 两间房之间的门洞格子 */
function doorCell(a, b) {
  const A = roomRect(a), B = roomRect(b);
  if (A.r === B.r) {
    const c = Math.min(A.c, B.c);
    return { x: ROOM + 1 + c * PITCH, y: A.y + 1 };
  }
  const r = Math.min(A.r, B.r);
  return { x: A.x + 1, y: ROOM + 1 + r * PITCH };
}
/** 房间在 GRID×GRID 网格里的邻居 */
function roomNeighbors(idx) {
  const r = Math.floor(idx / GRID), c = idx % GRID;
  const out = [];
  if (r > 0) out.push(idx - GRID);
  if (r < GRID - 1) out.push(idx + GRID);
  if (c > 0) out.push(idx - 1);
  if (c < GRID - 1) out.push(idx + 1);
  return out;
}

/** 3×3 房间网格的全部生成树（8 条边、无环、连通） */
function allSpanningTrees() {
  const edges = [];
  for (let idx = 0; idx < GRID * GRID; idx++) {
    for (const n of roomNeighbors(idx)) if (n > idx) edges.push([idx, n]);
  }
  const total = GRID * GRID;
  const out = [];
  for (let mask = 0; mask < (1 << edges.length); mask++) {
    let cnt = 0;
    for (let i = 0; i < edges.length; i++) if (mask & (1 << i)) cnt++;
    if (cnt !== total - 1) continue;
    const picked = [];
    for (let i = 0; i < edges.length; i++) if (mask & (1 << i)) picked.push(edges[i]);
    const parent = [];
    for (let i = 0; i < total; i++) parent.push(i);
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    let ok = true;
    for (const pair of picked) {
      const ra = find(pair[0]), rb = find(pair[1]);
      if (ra === rb) { ok = false; break; }
      parent[ra] = rb;
    }
    if (!ok) continue;
    const root = find(0);
    for (let i = 1; i < total; i++) if (find(i) !== root) { ok = false; break; }
    if (ok) out.push(picked);
  }
  return out;
}

/** 树的度数和叶子（只有一个门洞的房间） */
function treeShape(tree) {
  const deg = new Array(GRID * GRID).fill(0);
  for (const pair of tree) { deg[pair[0]]++; deg[pair[1]]++; }
  const leaves = [];
  for (let i = 0; i < deg.length; i++) if (deg[i] === 1) leaves.push(i);
  return { deg, leaves };
}

/** 8 种对称变换，让同一棵树的门洞位置也各不相同 */
const TRANSFORMS = [];
for (const flip of [false, true]) {
  for (const swap of [false, true]) {
    TRANSFORMS.push((idx) => {
      let r = Math.floor(idx / GRID), c = idx % GRID;
      if (flip) c = GRID - 1 - c;
      if (swap) { const t = r; r = c; c = t; }
      return r * GRID + c;
    });
  }
}

/** 房型库：3×3 房间网格的全部生成树（每棵的门洞连法都不一样） */
function buildShapePool() {
  return allSpanningTrees();
}

/* ---------------- 造一张图 ---------------- */
function buildMap(N, tree) {
  const grid = Array.from({ length: N }, () => new Array(N).fill(0));
  const roomOf = Array.from({ length: N }, () => new Array(N).fill(-1));
  const doorAt = Array.from({ length: N }, () => new Array(N).fill(null));
  const rooms = [];
  for (let i = 0; i < GRID * GRID; i++) {
    const r = roomRect(i);
    rooms.push({ idx: i, r: r.r, c: r.c, x: r.x, y: r.y, w: r.w, h: r.h });
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) { grid[y][x] = 1; roomOf[y][x] = i; }
    }
  }
  const doors = [];
  const roomDoors = rooms.map(() => []);
  for (const pair of tree) {
    const c = doorCell(pair[0], pair[1]);
    grid[c.y][c.x] = 1;
    const d = { x: c.x, y: c.y, a: pair[0], b: pair[1] };
    doors.push(d);
    roomDoors[pair[0]].push(d);
    roomDoors[pair[1]].push(d);
    doorAt[c.y][c.x] = d;
  }
  const deg = Array.from({ length: N }, () => new Array(N).fill(0));
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (grid[y][x] !== 1) continue;
      let d = 0;
      for (const dir of DIRS) {
        const nx = x + dir[0], ny = y + dir[1];
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        if (grid[ny][nx] === 1) d++;
      }
      deg[y][x] = d;
    }
  }
  const shape = treeShape(tree);
  return { grid, rooms, doors, roomDoors, roomOf, doorAt, deg, leaves: shape.leaves, degOf: shape.deg };
}

/** 挨着门洞、属于某一间房的那一格 */
function insideNeighbor(map, door, roomIdx) {
  for (const dir of DIRS) {
    const x = door.x + dir[0], y = door.y + dir[1];
    if (map.roomOf[y] && map.roomOf[y][x] === roomIdx) return { x, y };
  }
  return null;
}

function fail(reason) { return { fail: reason }; }

/* ---------------- 摆东西 ---------------- */
function tryPlace(map, plan) {
  const { grid, rooms, roomDoors } = map;
  const placed = new Map();
  const used = new Set();
  const put = (cell, ch) => placed.set(K(cell.x, cell.y), ch);

  // 5 间上锁的房间：4 个角 + 正中间，彼此不相邻，门洞不会撞车。
  // 门口站着怪 → 不打怪就拿不到里面的东西。
  const special = [];
  for (let idx = 0; idx < GRID * GRID; idx++) {
    const r = Math.floor(idx / GRID), c = idx % GRID;
    if ((r + c) % 2 === 0) special.push(idx);
  }
  if (special.length !== 5) return fail('special');
  // 上楼房优先挑门少的（门口要放锁着的门，多出来的门还得有人堵着）
  const ordered = special.slice().sort((a, b) => map.degOf[a] - map.degOf[b]);
  const upRoom = ordered[0];
  const restRoles = shuffled(ordered.slice(1));
  const keyRoom = restRoles[0];
  const cryRoom = restRoles[1];
  const nookRoom = restRoles[2];
  const eqRoom = restRoles[3];
  const rest = rooms.map((r) => r.idx).filter((i) => special.indexOf(i) < 0);
  const downRoom = pick(rest);

  // 房间有两个门时，另一个门也得有人守着，否则能从别的门绕进去
  const extraBlockers = [];
  const guard = (roomIdx, ch) => {
    const ds = roomDoors[roomIdx];
    put(ds[0], ch);
    for (let i = 1; i < ds.length; i++) extraBlockers.push(ds[i]);
  };

  // 往上那级楼梯（末层是魔王）：门洞上是锁着的门，楼梯在门正后方
  const upDoor = roomDoors[upRoom][0];
  const otherOfUp = upDoor.a === upRoom ? upDoor.b : upDoor.a;
  const stairCell = insideNeighbor(map, upDoor, upRoom);
  const outsideCell = insideNeighbor(map, upDoor, otherOfUp);
  if (!stairCell || !outsideCell) return fail('stair');
  put(stairCell, plan.isLast ? 'X' : '>');
  put(upDoor, DOOR_CHARS[plan.doorLock]);
  for (let i = 1; i < roomDoors[upRoom].length; i++) extraBlockers.push(roomDoors[upRoom][i]);

  // 守关怪堵在钥匙房门口，钥匙在房间中心
  guard(keyRoom, 'G');
  put(roomCenter(keyRoom), plan.keys.find((k) => k.role === 'door').ch);

  // 小鬼堵在结晶房门口，生命结晶在房间中心
  guard(cryRoom, 'g');
  put(roomCenter(cryRoom), 'h');

  // 史莱姆堵在杂物房门口，商店 / 卷轴 / 备用钥匙在房间中心
  guard(nookRoom, 'k');
  const spare = plan.keys.find((k) => k.role === 'spare');
  const nookCell = roomCenter(nookRoom);
  if (plan.hasWarp) put(nookCell, 'W');
  else if (plan.hasShop) put(nookCell, 'S');
  else if (spare) put(nookCell, spare.ch);
  else put(nookCell, '%');

  // 小鬼堵在装备房门口，剑 / 盾在房间中心
  guard(eqRoom, 'g');
  const eqCell = roomCenter(eqRoom);
  if (plan.sword) put(eqCell, 's');
  else if (plan.shield) put(eqCell, 't');
  else put(eqCell, '%');

  // 第 1 层的怪物图鉴放在门外（书 → 门 → 楼梯，三格一线）
  if (plan.hasBook) {
    put(outsideCell, 'B');
    used.add(K(outsideCell.x, outsideCell.y));
  }

  // 往下走回上一层的楼梯（第 1 层是出生点）
  const downCell = roomCenter(downRoom);
  let arrival = null;
  if (plan.floor === 1) {
    put(downCell, '@');
    arrival = downCell;
  } else {
    put(downCell, '<');
    const edges = roomEdges(downRoom).filter((e) => !placed.has(K(e.x, e.y)) && !used.has(K(e.x, e.y)));
    if (!edges.length) return fail('arrival');
    arrival = pick(edges);
    used.add(K(arrival.x, arrival.y));
  }

  // 巡逻怪：只放房间的角和中心 —— 这几个格互相不挨着，天然不会连成一片。
  // 楼梯（末层是魔王）旁边那几格也不放怪，免得挤成一堆。
  const centerTaken = new Set([keyRoom, cryRoom, nookRoom, eqRoom, downRoom]);
  const nearStair = new Set();
  for (const dir of DIRS) {
    const nx = stairCell.x + dir[0], ny = stairCell.y + dir[1];
    if (nx < 0 || ny < 0 || nx >= grid.length || ny >= grid.length) continue;
    nearStair.add(K(nx, ny));
  }
  const byRoom = new Map();
  for (const r of rooms) {
    const list = shuffled(roomCorners(r.idx)).filter((c) => !nearStair.has(K(c.x, c.y)));
    const ctr = roomCenter(r.idx);
    if (!centerTaken.has(r.idx) && !nearStair.has(K(ctr.x, ctr.y))) list.push(ctr);
    byRoom.set(r.idx, list);
  }
  // 多门房间里多出来的那只补位怪，也算巡逻怪
  for (const c of extraBlockers) put(c, 'v');
  const need = patrolCount(plan.floor) - extraBlockers.length;
  const roomOrder = shuffled(rooms.map((r) => r.idx));
  const chosen = [];
  for (;;) {
    let progressed = false;
    for (const rid of roomOrder) {
      const list = byRoom.get(rid);
      if (list.length) { chosen.push(list.pop()); progressed = true; }
      if (chosen.length >= need) break;
    }
    if (!progressed || chosen.length >= need) break;
  }
  if (chosen.length < need) return fail('patrol:' + chosen.length);
  for (const c of chosen) put(c, 'v');

  // 金币和备用钥匙：摊在房间的边中点上
  const edgePool = [];
  for (const r of rooms) {
    for (const e of roomEdges(r.idx)) {
      const k = K(e.x, e.y);
      if (placed.has(k) || used.has(k)) continue;
      edgePool.push(e);
    }
  }
  const loose = shuffled(edgePool);
  for (const g of plan.golds.slice(0, GOLD_PER_FLOOR)) {
    if (!loose.length) return fail('gold');
    put(loose.pop(), g.ch);
  }
  for (const k of plan.keys) {
    if (k.role !== 'spare') continue;
    if ([...placed.values()].indexOf(k.ch) >= 0) continue;
    if (!loose.length) return fail('spare');
    put(loose.pop(), k.ch);
  }

  // 组装字符图
  const rows = grid.map((row) => row.map((v) => (v === 1 ? '.' : '#')));
  for (const entry of placed) {
    const parts = entry[0].split(',');
    rows[Number(parts[1])][Number(parts[0])] = entry[1];
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
      '  }'
    ].join('\n');
  }).join(',\n');
  return body;
}

/** 量一层的密度指标，顺便查有没有两只怪挨着 */
function measure(rows) {
  const N = rows.length;
  let wall = 0, open = 0, dead = 0, junction = 0, mons = 0, openSquares = 0;
  const monsterCells = [];
  const isMonster = (ch) => ch === 'G' || ch === 'g' || ch === 'k' || ch === 'v' || ch === 'X';
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const ch = rows[y][x];
      if (ch === '#') { wall++; continue; }
      open++;
      let d = 0;
      for (const dir of DIRS) {
        const nx = x + dir[0], ny = y + dir[1];
        if (nx < 0 || ny < 0 || ny >= N || nx >= N) continue;
        if (rows[ny][nx] !== '#') d++;
      }
      if (d === 1) dead++;
      if (d >= 3) junction++;
      if (isMonster(ch)) { mons++; monsterCells.push({ x, y }); }
    }
  }
  for (let y = 0; y < N - 1; y++) {
    for (let x = 0; x < N - 1; x++) {
      if (rows[y][x] !== '#' && rows[y][x + 1] !== '#' && rows[y + 1][x] !== '#' && rows[y + 1][x + 1] !== '#') openSquares++;
    }
  }
  let adjacent = 0;
  for (const c of monsterCells) {
    for (const dir of DIRS) {
      const nx = c.x + dir[0], ny = c.y + dir[1];
      if (nx < 0 || ny < 0 || ny >= N || nx >= N) continue;
      if (isMonster(rows[ny][nx])) adjacent++;
    }
  }
  return { wall, open, dead, junction, mons, openSquares, adjacent };
}

/* ---------------- 主流程 ---------------- */
function main() {
  const pool = buildShapePool();
  if (!pool.length) { console.error('房型库是空的。'); process.exit(1); }
  const shapes = shuffled(pool);
  const placed = [];
  const stats = [];

  for (let f = 1; f <= FLOOR_COUNT; f++) {
    const plan = planOf(f);
    let ok = null;
    let lastFail = '?';
    for (let attempt = 0; attempt < 300 && !ok; attempt++) {
      const tree = shapes[(f - 1 + attempt) % shapes.length];
      const map = buildMap(SIZE, tree);
      const r = tryPlace(map, plan);
      if (r && r.fail) { lastFail = r.fail; continue; }
      ok = r;
      ok.shapeIdx = shapes.indexOf(tree);
    }
    if (!ok) {
      console.error('第 ' + f + ' 层摆不下（原因 ' + lastFail + '）。');
      process.exit(1);
    }
    placed.push(ok);
    const m = measure(ok.rows);
    m.shape = ok.shapeIdx;
    stats.push(m);
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

  const sum = (key) => stats.reduce((n, s) => n + s[key], 0);
  console.log('地图 ' + SIZE + '×' + SIZE + '，房型库 ' + pool.length + ' 种，种子 ' + SEED);
  console.log('墙占比 ' + (sum('wall') / (sum('wall') + sum('open')) * 100).toFixed(1) +
    '%，平均每层空地 ' + (sum('open') / FLOOR_COUNT).toFixed(1) + ' 格');
  console.log('平均每层怪 ' + (sum('mons') / FLOOR_COUNT).toFixed(1) +
    ' 只，挨着的怪对数 ' + sum('adjacent') + '（必须是 0）');
  console.log('平均每层开阔地（2×2 空地）' + (sum('openSquares') / FLOOR_COUNT).toFixed(1) +
    ' 处、岔口（3 个以上出口）' + (sum('junction') / FLOOR_COUNT).toFixed(1) +
    ' 个、死胡同 ' + (sum('dead') / FLOOR_COUNT).toFixed(1) + ' 个');
  if (process.argv.includes('--print')) {
    for (const i of [0, 1, 2]) {
      console.log('\n第 ' + (i + 1) + ' 层：');
      placed[i].rows.forEach((r) => console.log('  ' + r.join('')));
    }
  }
  console.log('已写入 ' + LEVELS_FILE);
}

export { buildMap, tryPlace, planOf, rnd, buildShapePool, allSpanningTrees, treeShape,
  roomRect, roomCenter, roomCorners, roomEdges, doorCell, roomNeighbors, measure };

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/gen-levels.mjs')) main();
