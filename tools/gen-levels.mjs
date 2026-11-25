/**
 * 30 层塔的关卡生成器。
 *
 * 地图结构：每层一张「树枝状」的楼层。
 *   房子 = 一间间小隔间（3~4 宽、4 高），上下左右都砌墙，只在墙上开一格门；
 *   底下一间 7 宽、2 高的入口厅，往上 3 列、每列竖着摞 3 间，一共 10 间；
 *   路   = 只留一格宽的横向走廊，一层一层往上分叉，走廊尽头接着下一层的隔间。
 *   走廊行横着贯通整片树杈，隔间开在走廊边上 —— 所以全图没有两格宽的路。
 *
 * 竖着看，一层楼是这样码上去的（从下往上）：
 *   [入口厅] [顶墙] [走廊行] [门洞行] [树枝隔间] [顶墙] [走廊行] [门洞行] [梢头隔间]
 *   每个房间只有一扇门（开在下墙），所以门永远不会撞车。
 *
 * 奖励与怪：
 *   5 间「上锁的房间」摆在树梢上，门口站着怪：
 *     守关怪守开门的钥匙、小鬼守生命结晶、史莱姆守商店 / 卷轴、恶犬守剑 / 盾。
 *   往上那级楼梯的房间，门洞上就是锁着的门，楼梯在门后房间的最深处 ——
 *     进房间先打怪，再踩楼梯升层，楼梯不会堵在门口后面。
 *   巡逻怪散在各个隔间里，走廊上不放怪 —— 路上不会出现「一格接一格全是怪」。
 *   一层 10 个物种：守关怪 1 只、看门怪 3 种各 1 只、巡逻怪六种性格共 26 只。
 *
 * 运行： node tools/gen-levels.mjs [随机种子]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SWORDS, SHIELDS, FLOOR_COUNT, SHOP_FLOORS, atkOn, defOn, crystalOn, patrolCount } from '../js/data/balance.js';
import { PATROL_SPECIES, GATE_SPECIES } from '../js/data/monsters.js';

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

/**
 * 每层 26 只巡逻怪在六种性格之间的分配。
 * 基准是 5/5/4/4/4/4，按层轮换一下，哪层多哪种怪不固定。
 */
function patrolSplit(floor) {
  const base = [5, 5, 4, 4, 4, 4];
  const rot = (floor - 1) % base.length;
  return base.slice(rot).concat(base.slice(0, rot));
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
    gateIds: GATE_SPECIES.map((sp) => sp.key + '_' + floor),
    patrolIds: PATROL_SPECIES.map((sp) => 'patrol_' + sp.key + '_' + floor),
    patrolQuota: patrolSplit(floor),
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

/* ---------------- 房间树 ---------------- */
const DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]];
const K = (x, y) => x + ',' + y;

const CANVAS_W = Number(process.env.CANVAS_W || 13);   // 画布宽度（两侧各留 1 郊外墙）
const MAX_DEPTH = Number(process.env.MAX_DEPTH || 3);       // 树干 → 树枝 → 小枝 → 梢头，一共四层房
const SLOT_X0 = 1;
const SLOT_X1 = CANVAS_W - 2;
const MAX_H = Number(process.env.MAX_H || 30);               // 画布最高这么多行，再高就重来

// 房间尺寸的调参（环境变量可以临时覆盖，方便扫参数）：
//   SLOT_MIN  = 每个孩子分到的地盘至少这么宽
//     —— 切太碎房间就碎成小盒子，四面砌墙反而比地多
//   ROOM_W_MAX = 房间最宽多少格
//   ROOM_H_MIN / ROOM_H_MAX = 房间高度区间
//   ROOT_W_MAX / ROOT_H_MAX = 底部入口厅最宽 / 最高多少格
//     —— 入口厅铺满整条底边会变成一整条空荡的带子，所以收窄压矮
//   CANVAS_W / MAX_DEPTH / MAX_H = 画布宽度、房间层数、画布最高行数
const SLOT_MIN = Number(process.env.SLOT_MIN || 3);
const ROOM_W_MAX = Number(process.env.ROOM_W_MAX || 4);
const ROOM_H_MIN = Number(process.env.ROOM_H_MIN || 4);
const ROOM_H_MAX = Number(process.env.ROOM_H_MAX || 4);
const ROOT_W_MAX = Number(process.env.ROOT_W_MAX || 7);
const ROOT_H_MAX = Number(process.env.ROOT_H_MAX || 2);

/** 一个节点最多长几个孩子 */
function maxKids(depth) {
  if (depth === 0) return 4;
  if (depth === 1) return 3;
  return 2;
}

/**
 * 房间树：每个节点占一段横向的地盘（slot），
 * 横向按孩子数切成竖条分给它们，中间留 1 格墙。
 * 越往梢头地盘越窄 —— 看着像一棵树从塔里长出来。
 */
function buildTree(rnd) {
  const nodes = [];
  function build(parentId, depth, x0, x1) {
    const id = nodes.length;
    const node = { id, parent: parentId, children: [], depth, x0, x1 };
    nodes.push(node);
    const usable = x1 - x0 + 1;
    // 地盘太窄就不横着切了：切下去只会切出 2 格的小盒子，墙比地还多。
    // 改成竖着摞一个（同一块地盘往上盖），树还是四层。
    if (usable < SLOT_MIN * 2 + 1) {
      node.w = Math.min(usable, ROOM_W_MAX);
      node.h = ROOM_H_MIN + Math.floor(rnd() * (ROOM_H_MAX - ROOM_H_MIN + 1));
      if (depth < MAX_DEPTH) {
        node.children.push(build(id, depth + 1, x0, x1));
      }
      return id;
    }
    if (depth >= MAX_DEPTH) {
      node.w = Math.min(usable, ROOM_W_MAX);
      node.h = ROOM_H_MIN + Math.floor(rnd() * (ROOM_H_MAX - ROOM_H_MIN + 1));
      return id;
    }
    // 孩子个数：让每个孩子的地盘落在 SLOT_MIN ~ SLOT_MIN+2 之间
    const kMin = Math.max(1, Math.ceil((usable + 1) / (SLOT_MIN + 3)));
    const kMax = Math.max(kMin, Math.floor((usable + 1) / (SLOT_MIN + 1)));
    let k = Math.min(maxKids(depth), kMin + Math.floor(rnd() * (kMax - kMin + 1)));
    k = Math.max(1, k);
    let rest = usable - k * SLOT_MIN - (k - 1);   // 还能多分的宽度
    const widths = new Array(k).fill(SLOT_MIN);
    for (let i = 0; i < rest; i++) widths[Math.floor(rnd() * k)]++;
    let cx = x0;
    for (let i = 0; i < k; i++) {
      const childId = build(id, depth + 1, cx, cx + widths[i] - 1);
      node.children.push(childId);
      cx += widths[i] + 1;
    }
    node.w = Math.min(usable, ROOM_W_MAX);
    node.h = ROOM_H_MIN + Math.floor(rnd() * (ROOM_H_MAX - ROOM_H_MIN + 1));
    return id;
  }
  build(-1, 0, SLOT_X0, SLOT_X1);
  return nodes;
}

/**
 * 竖向排布：从下往上盖楼。
 *   bottomY = 这个隔间下墙那一行（门就开在这行）
 *   hubY    = 隔间顶上面那一行，1 格宽的走廊，横着贯通整片树杈
 */
function assignRows(nodes) {
  // 底部大厅的高度在这里压：行高是这步算的，晚了就来不及
  for (const n of nodes) if (n.parent < 0 && ROOT_H_MAX > 0) n.h = Math.min(n.h, ROOT_H_MAX);
  const place = (node, bottomY) => {
    node.bottomY = bottomY;
    node.chamberY1 = bottomY - 1;
    node.chamberY0 = bottomY - node.h;
    node.topWallY = bottomY - node.h - 1;
    node.hubY = bottomY - node.h - 2;
    for (const c of node.children) place(nodes[c], node.hubY - 1);
  };
  place(nodes[0], 0);
  let top = 0;
  for (const n of nodes) top = Math.min(top, n.topWallY);
  const shift = -top;                         // 让最上面那行贴到 0
  for (const n of nodes) {
    n.bottomY += shift;
    n.chamberY1 += shift;
    n.chamberY0 += shift;
    n.topWallY += shift;
    n.hubY += shift;
  }
  return shift;                               // 根节点的下墙行 = 画布最底下一行
}

/** 隔间在横向地盘里的位置（居中偏一点，别贴着边） */
function placeChambers(nodes, rnd) {
  for (const n of nodes) {
    const span = n.x1 - n.x0 + 1;
    // 根隔间（树干）铺满自己的地盘：两侧不留废墙
    //   ROOT_W_MAX > 0 时收窄成一个小厅，避免底部出现一整条空荡的大厅
    const rootW = ROOT_W_MAX > 0 ? Math.min(span, ROOT_W_MAX) : span;
    n.w = n.parent < 0 ? rootW : Math.max(2, Math.min(n.w, span));
    // 房间填满地盘时不抖；地盘比房间宽才左右挪一点
    const slack = span - n.w;
    const jitter = slack > 1 ? Math.floor(rnd() * 3) - 1 : 0;
    let cx0 = n.x0 + Math.floor(slack / 2) + jitter;
    cx0 = Math.max(n.x0, Math.min(cx0, n.x1 - n.w + 1));
    n.cx0 = cx0;
    n.cx1 = cx0 + n.w - 1;
  }
}

/** 把隔间、走廊、门画到格子上 */
function carve(nodes, H, W) {
  const grid = Array.from({ length: H }, () => new Array(W).fill(0));
  const set = (x, y) => {
    if (x >= 0 && y >= 0 && y < H && x < W) grid[y][x] = 1;
  };
  // 走廊行：每个有孩子的节点，在自己的地盘上横着铺一条 1 格宽的路
  for (const n of nodes) {
    if (!n.children.length) continue;
    for (let x = n.x0; x <= n.x1; x++) set(x, n.hubY);
  }
  // 隔间
  for (const n of nodes) {
    for (let y = n.chamberY0; y <= n.chamberY1; y++) {
      for (let x = n.cx0; x <= n.cx1; x++) set(x, y);
    }
  }
  // 门洞：每个隔间下墙那一行开一格门。
  // 同一行里的两扇门不能挨着 —— 门洞上站着怪的话，两只怪就贴上了。
  const doorsInRow = new Map();
  for (const n of nodes) {
    if (n.parent < 0) continue;               // 根没有门
    const taken = doorsInRow.get(n.bottomY) || [];
    let dx = n.cx0 + Math.floor(rnd() * n.w);
    while (taken.some((x) => Math.abs(x - dx) === 1) && dx < n.cx1) dx++;
    while (taken.some((x) => Math.abs(x - dx) === 1) && dx > n.cx0) dx--;
    n.doorX = dx;
    taken.push(dx);
    doorsInRow.set(n.bottomY, taken);
    set(n.doorX, n.bottomY);
  }
  // 房顶的门：往上一层走廊的门，只有有孩子的隔间才有
  for (const n of nodes) {
    if (!n.children.length) continue;
    n.topDoorX = n.cx0 + Math.floor(rnd() * n.w);
    set(n.topDoorX, n.topWallY);
  }
  return grid;
}

/* ---------------- 摆东西 ---------------- */

/**
 * 树上挑 5 间房：上楼房取树梢（最深的一片），其余也从梢头挑。
 * 不用再怕门撞车 —— 每个房间只有一扇门，门天生就不重样。
 */
function pickSpecialRooms(nodes) {
  const byDepth = (d) => nodes.filter((n) => n.depth === d && n.parent >= 0);
  const deep = shuffled(byDepth(MAX_DEPTH));
  const mid = shuffled(byDepth(MAX_DEPTH - 1));
  const chosen = [];
  const upRoom = deep[0] || mid[0];
  if (!upRoom) return [];
  chosen.push(upRoom);
  for (const n of deep.concat(mid)) {
    if (chosen.length >= 5) break;
    if (chosen.includes(n)) continue;
    chosen.push(n);
  }
  return chosen;
}

/** 房间正中间那一格（偶数边长取靠左 / 靠上的一格） */
function roomCenter(n) {
  return { x: n.cx0 + Math.floor((n.w - 1) / 2), y: n.chamberY0 + Math.floor((n.h - 1) / 2) };
}

/**
 * 房间里离 from 最远的那一格（同距时取离房间正中最近的那格）。
 *
 * 上楼梯要用它：楼梯不能堵在门口后面 ——
 * 一进门就踩上楼梯的话，那间房里的怪一只都打不了，
 * 玩家只能先升上去、再走下来才能清怪。
 * 所以楼梯放在房间最深處，进门后先走一段、打掉路上的怪，再踩楼梯。
 */
function deepestCellInRoom(n, from, blocked) {
  const cells = [];
  for (let y = n.chamberY0; y <= n.chamberY1; y++) {
    for (let x = n.cx0; x <= n.cx1; x++) {
      if (blocked && blocked.some((b) => b.x === x && b.y === y)) continue;
      cells.push({ x, y, d: Math.abs(x - from.x) + Math.abs(y - from.y) });
    }
  }
  if (!cells.length) return null;
  const maxD = Math.max(...cells.map((c) => c.d));
  const far = cells.filter((c) => c.d === maxD);
  const mid = roomCenter(n);
  far.sort((a, b) => {
    const da = Math.abs(a.x - mid.x) + Math.abs(a.y - mid.y);
    const db = Math.abs(b.x - mid.x) + Math.abs(b.y - mid.y);
    return da - db || (a.y - b.y) || (a.x - b.x);
  });
  return far[0];
}

/**
 * 根隔间里放「往下那级楼梯」的格子。
 *
 * 楼梯是「踩上去就掉层」的格子，压在门口的落脚点上会把门堵死，
 * 所以这里避开房顶那扇门和所有门内侧的落脚格，并要求楼梯四周还有两格地板，
 * 换层落点才有地方站。
 */
function pickDownCell(root, blocked) {
  const cands = [];
  for (let y = root.chamberY0; y <= root.chamberY1; y++) {
    for (let x = root.cx0; x <= root.cx1; x++) {
      if (blocked.has(K(x, y))) continue;
      let around = 0;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (nx < root.cx0 || ny < root.chamberY0 || nx > root.cx1 || ny > root.chamberY1) continue;
        around++;
      }
      if (around < 2) continue;
      cands.push({ x, y });
    }
  }
  return cands.length ? pick(cands) : null;
}

function fail(reason) { return { fail: reason }; }

function tryPlace(map, plan) {
  const { grid, nodes } = map;
  const placed = new Map();
  const used = new Set();
  const put = (cell, ch) => placed.set(K(cell.x, cell.y), ch);
  const isTaken = (cell) => placed.has(K(cell.x, cell.y)) || used.has(K(cell.x, cell.y));

  const special = pickSpecialRooms(nodes);
  if (special.length < 5) return fail('special');
  const upRoom = special[0];
  const restRoles = special.slice(1);
  const keyRoom = restRoles[0];
  const cryRoom = restRoles[1];
  const nookRoom = restRoles[2];
  const eqRoom = restRoles[3];
  const root = nodes[0];

  // 往上那级楼梯（末层是魔王）：门洞上是锁着的门，楼梯在门后房间的最深处
  const upInner = { x: upRoom.doorX, y: upRoom.chamberY1 };   // 门内侧那一格
  // 楼梯 / 魔王不能压在门内侧那一格，也不能跟它挨着 ——
  // 进门先撞上守门的怪，再往里走才踩得到楼梯。
  const stairBlocked = [upInner];
  for (const [dx, dy] of DIRS) {
    stairBlocked.push({ x: upInner.x + dx, y: upInner.y + dy });
  }
  const stairCell = deepestCellInRoom(upRoom, upInner, stairBlocked);
  if (!stairCell) return fail('stair');
  put(stairCell, plan.isLast ? 'X' : '>');
  put({ x: upRoom.doorX, y: upRoom.bottomY }, DOOR_CHARS[plan.doorLock]);

  // 上楼那间房：门正后方一格必须站一只怪。
  // 楼梯已经挪到房间最深处（不会一进门就升层），
  // 但光「进得去」还不够 —— 得有一只怪挡在门口，
  // 玩家清掉它才能往里走，房里的怪才真的打得了，不用上去再下来。
  let forcedPatrol = 0;
  if (!isTaken(upInner)) {
    put(upInner, PATROL_SPECIES[0].char);
    forcedPatrol = 1;
  }
  if (!forcedPatrol) return fail('forced');

  // 这些怪的四邻不能站别的怪：门口的强制怪，还有末层的魔王
  const noAdjacent = [upInner];
  if (plan.isLast) noAdjacent.push(stairCell);

  // 看门怪：守关怪堵在钥匙房门口，小鬼守结晶房，史莱姆守杂物房，恶犬守装备房
  const gateChars = GATE_SPECIES.map((sp) => sp.char);
  const guarded = [
    { room: keyRoom, char: 'G' },
    { room: cryRoom, char: gateChars[0] },
    { room: nookRoom, char: gateChars[1] },
    { room: eqRoom, char: gateChars[2] },
  ];
  for (const g of guarded) {
    put({ x: g.room.doorX, y: g.room.bottomY }, g.char);
  }

  // 钥匙在房间正中间
  put(roomCenter(keyRoom), plan.keys.find((k) => k.role === 'door').ch);
  // 生命结晶在房间正中间
  put(roomCenter(cryRoom), 'h');
  // 商店 / 卷轴 / 备用钥匙在杂物房正中间
  const spare = plan.keys.find((k) => k.role === 'spare');
  const nookCell = roomCenter(nookRoom);
  if (plan.hasWarp) put(nookCell, 'W');
  else if (plan.hasShop) put(nookCell, 'S');
  else if (spare) put(nookCell, spare.ch);
  else put(nookCell, '%');
  // 剑 / 盾在装备房正中间
  const eqCell = roomCenter(eqRoom);
  if (plan.sword) put(eqCell, 's');
  else if (plan.shield) put(eqCell, 't');
  else put(eqCell, '%');

  // 第 1 层的怪物图鉴放在锁着的门外面一格（进门就捡得到）
  if (plan.hasBook) {
    const outside = { x: upRoom.doorX, y: upRoom.bottomY + 1 };   // 门外面那一格（走廊上）
    if (!isTaken(outside)) {
      put(outside, 'B');
      used.add(K(outside.x, outside.y));
    }
  }

  // 往下走回上一层的楼梯（第 1 层是出生点）
  const blocked = new Set();
  // 房顶那扇门和所有门内侧的落脚格都不能放楼梯
  for (const n of nodes) {
    if (n.parent >= 0) blocked.add(K(n.doorX, n.chamberY1));
    if (n.children.length) blocked.add(K(n.topDoorX, n.chamberY0));
  }
  const downCell = pickDownCell(root, blocked);
  if (!downCell) return fail('downcell');
  let arrival = null;
  if (plan.floor === 1) {
    put(downCell, '@');
    arrival = downCell;
  } else {
    put(downCell, '<');
    const options = [];
    for (const [dx, dy] of DIRS) {
      const c = { x: downCell.x + dx[0], y: downCell.y + dy[1] };
      if (c.x < root.cx0 || c.y < root.chamberY0 || c.x > root.cx1 || c.y > root.chamberY1) continue;
      if (isTaken(c)) continue;
      options.push(c);
    }
    if (!options.length) return fail('arrival');
    arrival = pick(options);
    used.add(K(arrival.x, arrival.y));
  }

  // 金币和备用钥匙：摊在隔间的空地上
  const loose = [];
  for (const n of nodes) {
    for (let y = n.chamberY0; y <= n.chamberY1; y++) {
      for (let x = n.cx0; x <= n.cx1; x++) {
        const c = { x, y };
        if (isTaken(c)) continue;
        loose.push(c);
      }
    }
  }
  const loosePool = shuffled(loose);
  for (const g of plan.golds.slice(0, GOLD_PER_FLOOR)) {
    if (!loosePool.length) return fail('gold');
    put(loosePool.pop(), g.ch);
  }
  if (spare && [...placed.values()].indexOf(spare.ch) < 0) {
    if (!loosePool.length) return fail('spare');
    put(loosePool.pop(), spare.ch);
  }

  // 巡逻怪：放在隔间里的棋盘格位置 —— 同色格子互不相邻，天然不会连成一片
  const doorInner = new Set();
  for (const n of nodes) {
    if (n.parent >= 0) doorInner.add(K(n.doorX, n.chamberY1));
  }
  const nearForced = (c) =>
    noAdjacent.some((b) => Math.abs(c.x - b.x) + Math.abs(c.y - b.y) === 1);

  const candidates = new Map();
  for (const n of nodes) {
    const cells = [];
    for (let y = n.chamberY0; y <= n.chamberY1; y++) {
      for (let x = n.cx0; x <= n.cx1; x++) {
        const c = { x, y };
        if (isTaken(c)) continue;
        if (doorInner.has(K(x, y))) continue;   // 门内侧那一格留给看门怪
        if (nearForced(c)) continue;           // 门口那只强制怪的隔壁不能再站怪
        cells.push(c);
      }
    }
    const even = cells.filter((c) => (c.x + c.y) % 2 === 0);
    const odd = cells.filter((c) => (c.x + c.y) % 2 === 1);
    const same = even.length >= odd.length ? even : odd;
    candidates.set(n.id, shuffled(same));
  }

  // 六种性格按配额铺开
  const quota = plan.patrolQuota.slice();
  quota[0] -= forcedPatrol;                   // 门口那只强制怪算在基准性格里
  const byChar = new Map();
  PATROL_SPECIES.forEach((sp, i) => byChar.set(sp.char, { count: quota[i], char: sp.char }));

  const need = totalNeeded(byChar);
  const roomOrder = shuffled(nodes.map((n) => n.id));
  const chosen = [];
  for (;;) {
    let progressed = false;
    for (const rid of roomOrder) {
      for (const info of byChar.values()) {
        if (info.count <= 0) continue;
        const list = candidates.get(rid);
        if (list && list.length) {
          chosen.push({ cell: list.pop(), ch: info.char });
          info.count--;
          progressed = true;
          break;
        }
      }
      if (chosen.length >= need) break;
    }
    if (!progressed || chosen.length >= need) break;
  }
  if (chosen.length < need) return fail('patrol:' + chosen.length + '/' + need);
  for (const c of chosen) put(c.cell, c.ch);

  // 一层怪数必须是设计值：守关怪 1 + 看门怪 3 + 巡逻怪 26
  const monsterTotal = 4 + forcedPatrol + chosen.length;
  if (monsterTotal !== patrolCount(plan.floor) + 4) return fail('count:' + monsterTotal);

  // 组装字符图
  const rows = grid.map((row) => row.map((v) => (v === 1 ? '.' : '#')));
  for (const entry of placed) {
    const parts = entry[0].split(',');
    rows[Number(parts[1])][Number(parts[0])] = entry[1];
  }
  return { rows };
}

/** 巡逻怪一共要放多少只 */
function totalNeeded(byChar) {
  let n = 0;
  for (const info of byChar.values()) n += info.count;
  return n;
}

/* ---------------- 输出 ---------------- */
function legendOf(plan) {
  const lines = [];
  lines.push('          G: ' + JSON.stringify(plan.guardId) + ',');
  GATE_SPECIES.forEach((sp, i) => {
    lines.push('          ' + sp.char + ': ' + JSON.stringify(plan.gateIds[i]) + ',');
  });
  PATROL_SPECIES.forEach((sp, i) => {
    lines.push('          ' + sp.char + ': ' + JSON.stringify(plan.patrolIds[i]) + ',');
  });
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

/**
 * 量一层的密度指标，顺便查有没有两只怪挨着、
 * 有没有哪条路宽到了两格（房间之外的地方必须全是 1 格宽）。
 */
function measure(rows) {
  const N = rows.length;
  const M = rows[0].length;
  let wall = 0, open = 0, dead = 0, junction = 0, mons = 0, openSquares = 0;
  const monsterCells = [];
  const isMonster = (ch) => ch === 'G' || ch === 'g' || ch === 'k' || ch === 'm'
    || 'vwpqef'.includes(ch) || ch === 'X';
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < M; x++) {
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
  const placed = [];
  const stats = [];

  for (let f = 1; f <= FLOOR_COUNT; f++) {
    const plan = planOf(f);
    let ok = null;
    let lastFail = '?';
    for (let attempt = 0; attempt < 400 && !ok; attempt++) {
      const nodes = buildTree(rnd);
      if (nodes.length < 9) continue;              // 房间太少，5 间上锁的房放不下
      const shift = assignRows(nodes);
      const H = shift + 1;
      if (H > MAX_H) continue;                     // 太高了，换一棵树
      placeChambers(nodes, rnd);
      const grid = carve(nodes, H, CANVAS_W);
      const map = { grid, nodes, H, W: CANVAS_W };
      const r = tryPlace(map, plan);
      if (r && r.fail) { lastFail = r.fail; continue; }
      ok = r;
      ok.nodes = nodes;
    }
    if (!ok) {
      console.error('第 ' + f + ' 层摆不下（原因 ' + lastFail + '）。');
      process.exit(1);
    }
    placed.push(ok);
    if (process.env.DBG_FLOOR && f === Number(process.env.DBG_FLOOR)) {
      console.log('DBG 第 ' + f + ' 层：');
      for (const n of ok.nodes) {
        console.log('  #' + n.id + ' d' + n.depth +
          ' slot[' + n.x0 + '-' + n.x1 + ']' +
          ' 房[' + n.cx0 + '-' + n.cx1 + ']x[' + n.chamberY0 + '-' + n.chamberY1 + ']' +
          ' 门x=' + (n.doorX === undefined ? '-' : n.doorX) +
          ' 门行=' + n.bottomY + ' 走廊行=' + n.hubY +
          ' 父=' + n.parent);
      }
      ok.rows.forEach((r, y) => console.log('  ' + String(y).padStart(2) + ' |' + r.join('') + '|'));
    }
    const m = measure(ok.rows);
    m.rooms = ok.nodes.length;
    m.size = ok.rows.length + '×' + ok.rows[0].length;
    // 最大的一间房：入口厅要是铺满整条底边，这里就会变成一个空荡的大盒子
    m.maxRoom = Math.max(...ok.nodes.map((n) => n.w * n.h));
    stats.push(m);
  }

  const dry = process.argv.includes('--dry');   // 只算不写：调参数时用
  const src = readFileSync(LEVELS_FILE, 'utf8');
  const bi = src.indexOf(BEGIN);
  const ei = src.indexOf(END);
  if (bi < 0 || ei < 0) {
    console.error('levels.js 里找不到 ' + BEGIN + ' 标记。');
    process.exit(1);
  }
  const next = src.slice(0, bi + BEGIN.length) + '\n' + emit(placed) + '\n' + src.slice(ei);
  if (!dry) writeFileSync(LEVELS_FILE, next, 'utf8');

  const sum = (key) => stats.reduce((n, s) => n + s[key], 0);
  const avg = (key) => (sum(key) / FLOOR_COUNT).toFixed(1);
  console.log('种子 ' + SEED + '，画布宽 ' + CANVAS_W + '，树 ' + (MAX_DEPTH + 1) + ' 层房');
  console.log('平均每层 ' + avg('rooms') + ' 间房，尺寸 ' + stats[0].size + ' 起');
  console.log('墙占比 ' + (sum('wall') / (sum('wall') + sum('open')) * 100).toFixed(1) +
    '%，平均每层空地 ' + avg('open') + ' 格');
  console.log('平均每层怪 ' + avg('mons') + ' 只，挨着的怪对数 ' + sum('adjacent') + '（必须是 0）');
  console.log('平均每层 2×2 空地 ' + avg('openSquares') + ' 处（房间内部才有）、岔口 ' + avg('junction') + ' 个');
  console.log('最大的一间房 ' + Math.max(...stats.map((s) => s.maxRoom)) + ' 格（入口厅别太大）');
  if (process.argv.includes('--print')) {
    for (const i of [0, 1, 2]) {
      console.log('\n第 ' + (i + 1) + ' 层（' + stats[i].rooms + ' 间房）：');
      placed[i].rows.forEach((r) => console.log('  ' + r.join('')));
    }
  }
  console.log(dry ? '（--dry：只算没写文件）' : '已写入 ' + LEVELS_FILE);
}

export { buildTree, assignRows, placeChambers, carve, tryPlace, planOf, measure, pickSpecialRooms };

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/gen-levels.mjs')) main();
