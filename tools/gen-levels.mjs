/**
 * 30 层塔的关卡生成器。
 *
 * 地图结构：每层一张「树枝状」的楼层。
 *   房间大小不一（2×2 ~ 5×4），从一个底部的根房间往上分叉；
 *   子房间不比父房间大，越往梢头越小 —— 看着像一棵树从塔里长出来。
 *   房间之间隔 1 格墙，墙上开门洞；门洞的连法就是房间树本身，
 *   所以路从树干分到树枝、再到树梢，有分叉、不绕圈。
 *
 * 奖励与怪：
 *   5 间「上锁的房间」都在树梢上（彼此不相邻，门洞不会撞车），门口站着怪：
 *     守关怪守开门的钥匙、小鬼守生命结晶、史莱姆守商店 / 卷轴、小鬼守剑 / 盾。
 *   往上那级楼梯的房间，门洞上就是锁着的门，楼梯在门后房间的最深处 ——
 *     进房间先打怪，再踩楼梯升层，楼梯不会堵在门口后面。
 *   巡逻怪散在各个房间里，门洞留空 —— 路上不会出现「一格接一格全是怪」。
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

/* ---------------- 房间树（树形分块） ---------------- */
const DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]];
const K = (x, y) => x + ',' + y;

const CANVAS_W = 15;        // 画布宽度（房间总宽 = 宽 - 2，两侧各留 1 格外墙）
const MAX_DEPTH = 3;        // 树最多几层房

/** 一个节点最多长几个孩子 */
function maxKids(depth) {
  if (depth === 0) return 3;
  if (depth === 1) return 2;
  return 2;
}

/**
 * 树形分块：底下一间大厅当树干，往上分成树枝，梢头是小房间。
 *
 *   每个节点占自己那块地的一层：房间是底下的一条，房间上面留给孩子。
 *   横向按孩子数切成竖条，宽度随机分 —— 所以每间房大小都不一样。
 *   门洞就开在「房间和它孩子之间」的那道墙上。
 */
function planTree(rnd) {
  const nodes = [];
  function build(parentId, depth, x, w) {
    const id = nodes.length;
    const node = {
      id, parent: parentId, children: [], depth, x, w,
      roomH: 2 + Math.floor(rnd() * 2),
    };
    nodes.push(node);
    if (depth >= MAX_DEPTH) return id;
    // 每个孩子至少 2 格宽，中间还要留 1 格墙
    const maxK = Math.max(1, Math.min(maxKids(depth), Math.floor((w + 1) / 3)));
    const k = 1 + Math.floor(rnd() * maxK);
    const usable = w - (k - 1);
    const base = Math.floor(usable / k);
    const widths = new Array(k).fill(base);
    for (let i = 0; i < usable - base * k; i++) widths[Math.floor(rnd() * k)]++;
    let cx = x;
    for (let i = 0; i < k; i++) {
      const childId = build(id, depth + 1, cx, widths[i]);
      node.children.push(childId);
      cx += widths[i] + 1;
    }
    return id;
  }
  build(-1, 0, 1, CANVAS_W - 2);
  // 高度：叶子就是自己那间房；中间节点 = 房高 + 1 格墙 + 最高的孩子
  const calcH = (id) => {
    const n = nodes[id];
    if (!n.children.length) { n.subH = n.roomH; return n.subH; }
    let m = 0;
    for (const c of n.children) m = Math.max(m, calcH(c));
    n.subH = n.roomH + 1 + m;
    return n.subH;
  };
  calcH(0);
  return {
    nodes,
    W: CANVAS_W,
    H: nodes[0].subH + 2,
    leaves: nodes.filter((n) => !n.children.length).length,
  };
}

/** 把树摆进画布：房间是每块地的底下一条，孩子在它上面 */
function layoutTree(plan, rnd) {
  const { nodes, W, H } = plan;
  const rooms = [];
  const doors = [];
  const place = (id, top, h) => {
    const n = nodes[id];
    const roomY = top + h - n.roomH;
    rooms.push({ id, parent: n.parent, x: n.x, y: roomY, w: n.w, h: n.roomH, depth: n.depth, children: n.children.slice() });
    if (!n.children.length) return;
    const childH = h - n.roomH - 1;
    for (const c of n.children) {
      const cn = nodes[c];
      place(c, top + childH - cn.subH, cn.subH);
      // 门洞：房间和它孩子之间那道墙
      doors.push({ x: cn.x + Math.floor(rnd() * cn.w), y: roomY - 1, a: id, b: c });
    }
  };
  place(0, 1, nodes[0].subH);
  return { W, H, rooms, doors, root: 0 };
}

/** 一次完整的房间树：定形 + 摆放 */
function growRoomTree(rnd) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const plan = planTree(rnd);
    if (plan.nodes.length < 9) continue;      // 房间太少，5 间上锁的房放不下
    return layoutTree(plan, rnd);
  }
  return null;
}

/**
 * 树上挑 5 间互不相邻的房间（独立集）：
 *   上楼房取最深的那片树梢，其余优先也从树梢里挑，不够再从中间的房间补。
 *   互不相邻 = 两间房之间没有门洞，门洞不会撞车。
 */
function pickSpecialRooms(map) {
  const { rooms } = map;
  const byId = new Map(rooms.map((r) => [r.id, r]));
  const neighbors = (id) => {
    const r = byId.get(id);
    const out = [id];
    if (r.parent >= 0) out.push(r.parent);
    for (const c of r.children) out.push(c);
    return out;
  };
  // 根房间（放往下那级楼梯）不能选：楼梯会盖掉房间正中间的东西
  const leaves = rooms.filter((r) => r.children.length === 0 && r.id !== map.root).sort((a, b) => b.depth - a.depth);
  if (!leaves.length) return [];
  // 上楼房：树最高处那片梢头
  const upRoom = leaves[0];
  const chosen = [upRoom.id];
  const taken = new Set(chosen);
  const blocked = new Set(neighbors(upRoom.id));
  const take = (r) => {
    chosen.push(r.id);
    taken.add(r.id);
    for (const n of neighbors(r.id)) blocked.add(n);
  };
  // 其余 4 间：先从别的树梢里挑
  for (const r of shuffled(leaves)) {
    if (chosen.length >= 5) break;
    if (taken.has(r.id) || blocked.has(r.id)) continue;
    take(r);
  }
  // 还是不够：从剩下的房间里补（不和已选的相邻）
  for (const r of shuffled(rooms)) {
    if (chosen.length >= 5) break;
    if (r.id === map.root) continue;
    if (taken.has(r.id) || blocked.has(r.id)) continue;
    take(r);
  }
  return chosen;
}
/* ---------------- 造一张图 ---------------- */
function buildMap(tree) {
  const { W, H, rooms, doors } = tree;
  const grid = Array.from({ length: H }, () => new Array(W).fill(0));
  const roomOf = Array.from({ length: H }, () => new Array(W).fill(-1));
  const doorAt = Array.from({ length: H }, () => new Array(W).fill(null));
  for (const r of rooms) {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) { grid[y][x] = 1; roomOf[y][x] = r.id; }
    }
  }
  const roomDoors = rooms.map(() => []);
  for (const d of doors) {
    grid[d.y][d.x] = 1;
    doorAt[d.y][d.x] = d;
    roomDoors[d.a].push(d);
    roomDoors[d.b].push(d);
  }
  return { grid, roomOf, doorAt, rooms, doors, roomDoors, W, H, root: tree.root };
}

/** 挨着门洞、属于某一间房的那一格 */
function insideNeighbor(map, door, roomIdx) {
  for (const dir of DIRS) {
    const x = door.x + dir[0], y = door.y + dir[1];
    if (map.roomOf[y] && map.roomOf[y][x] === roomIdx) return { x, y };
  }
  return null;
}

/** 房间正中间那一格（偶数边长取靠左 / 靠上的一格） */
function roomCenter(room) {
  return { x: room.x + Math.floor((room.w - 1) / 2), y: room.y + Math.floor((room.h - 1) / 2) };
}

/**
 * 房间里离 from 最远的那一格（同距时取离房间正中最近的那格）。
 *
 * 上楼梯要用它：楼梯不能堵在门口后面 ——
 * 一进门就踩上楼梯的话，那间房里的怪一只都打不了，
 * 玩家只能先升上去、再走下来才能清怪。
 * 所以楼梯放在房间最深處，进门后先走一段、打掉路上的怪，再踩楼梯。
 */
function deepestCellInRoom(room, from) {
  const cells = [];
  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) {
      cells.push({ x, y, d: Math.abs(x - from.x) + Math.abs(y - from.y) });
    }
  }
  const maxD = Math.max(...cells.map((c) => c.d));
  const far = cells.filter((c) => c.d === maxD);
  const mid = roomCenter(room);
  far.sort((a, b) => {
    const da = Math.abs(a.x - mid.x) + Math.abs(a.y - mid.y);
    const db = Math.abs(b.x - mid.x) + Math.abs(b.y - mid.y);
    return da - db || (a.y - b.y) || (a.x - b.x);
  });
  return far[0];
}

/**
 * 根房间里放「往下那级楼梯」的格子。
 *
 * 门口正下方那一格不能放楼梯：楼梯是「踩上去就掉层」的格子，
 * 一旦它压在某个门口的唯一落脚点上，那扇门就再也上不去了，
 * 门上面那一整条分支会被整个隔断。
 * 所以这里避开所有门口内侧的落脚格，并要求楼梯四周至少还有两格地板，
 * 换层落点才有地方站。
 */
function pickDownCell(map, room) {
  const blocked = new Set();
  for (const d of map.roomDoors[room.id]) {
    const n = insideNeighbor(map, d, room.id);
    if (n) blocked.add(K(n.x, n.y));
    // 门洞周围一格也不放楼梯：踩上去就换层，等于把门堵死
    for (const [dx, dy] of DIRS) {
      if (dx === 0 && dy === 0) continue;
      blocked.add(K(d.x + dx, d.y + dy));
    }
  }
  const cands = [];
  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) {
      if (blocked.has(K(x, y))) continue;
      let around = 0;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (nx < room.x || ny < room.y || nx >= room.x + room.w || ny >= room.y + room.h) continue;
        around++;
      }
      if (around < 2) continue;
      cands.push({ x, y });
    }
  }
  return cands.length ? pick(cands) : null;
}

function fail(reason) { return { fail: reason }; }

/* ---------------- 摆东西 ---------------- */
function tryPlace(map, plan) {
  const { grid, rooms, roomDoors } = map;
  const placed = new Map();
  const used = new Set();
  const put = (cell, ch) => placed.set(K(cell.x, cell.y), ch);
  const isTaken = (cell) => placed.has(K(cell.x, cell.y)) || used.has(K(cell.x, cell.y));

  // 5 间上锁的房间：树梢上的独立集，彼此不相邻，门洞不会撞车
  const special = pickSpecialRooms(map);
  if (special.length < 5) return fail('special');
  const upRoom = special[0];
  const restRoles = special.slice(1);
  const keyRoom = restRoles[0];
  const cryRoom = restRoles[1];
  const nookRoom = restRoles[2];
  const eqRoom = restRoles[3];
  const downRoom = map.root;      // 树干底：往下那级楼梯 / 出生点

  // 房间有两个门时，另一个门也得有人守着，否则能从别的门绕进去
  const extraBlockers = [];
  const guard = (roomIdx, ch) => {
    const ds = roomDoors[roomIdx];
    if (!ds.length) return false;
    put(ds[0], ch);
    for (let i = 1; i < ds.length; i++) extraBlockers.push(ds[i]);
    return true;
  };

  // 往上那级楼梯（末层是魔王）：门洞上是锁着的门，楼梯在门后房间的最深处
  const upDoors = roomDoors[upRoom];
  if (!upDoors.length) return fail('updoor');
  const upDoor = upDoors[0];
  const otherOfUp = upDoor.a === upRoom ? upDoor.b : upDoor.a;
  // 楼梯放在门后房间的最深处：进门先打怪，再踩楼梯升层
  const stairCell = deepestCellInRoom(rooms[upRoom], upDoor);
  const outsideCell = insideNeighbor(map, upDoor, otherOfUp);
  if (!stairCell || !outsideCell) return fail('stair');
  put(stairCell, plan.isLast ? 'X' : '>');
  put(upDoor, DOOR_CHARS[plan.doorLock]);
  for (let i = 1; i < upDoors.length; i++) extraBlockers.push(upDoors[i]);

  // 上楼那间房：门正后方一格必须站一只巡逻怪。
  // 楼梯已经挪到房间最深处（不会一进门就升层），
  // 但光「进得去」还不够 —— 得有一只怪挡在门口，
  // 玩家清掉它才能往里走，房里的怪才真的打得了，不用上去再下来。
  const upInner = insideNeighbor(map, upDoor, upRoom);
  let forcedPatrol = 0;
  if (upInner && !isTaken(upInner) && (upInner.x !== stairCell.x || upInner.y !== stairCell.y)) {
    put(upInner, 'v');
    forcedPatrol = 1;
  }

  // 守关怪堵在钥匙房门口，钥匙在房间正中间
  if (!guard(keyRoom, 'G')) return fail('keydoor');
  put(roomCenter(rooms[keyRoom]), plan.keys.find((k) => k.role === 'door').ch);

  // 小鬼堵在结晶房门口，生命结晶在房间正中间
  if (!guard(cryRoom, 'g')) return fail('crydoor');
  put(roomCenter(rooms[cryRoom]), 'h');

  // 史莱姆堵在杂物房门口，商店 / 卷轴 / 备用钥匙在房间正中间
  if (!guard(nookRoom, 'k')) return fail('nookdoor');
  const spare = plan.keys.find((k) => k.role === 'spare');
  const nookCell = roomCenter(rooms[nookRoom]);
  if (plan.hasWarp) put(nookCell, 'W');
  else if (plan.hasShop) put(nookCell, 'S');
  else if (spare) put(nookCell, spare.ch);
  else put(nookCell, '%');

  // 小鬼堵在装备房门口，剑 / 盾在房间正中间
  if (!guard(eqRoom, 'g')) return fail('eqdoor');
  const eqCell = roomCenter(rooms[eqRoom]);
  if (plan.sword) put(eqCell, 's');
  else if (plan.shield) put(eqCell, 't');
  else put(eqCell, '%');

  // 第 1 层的怪物图鉴放在门外（书 → 门 → 楼梯，三格一线）
  if (plan.hasBook) {
    put(outsideCell, 'B');
    used.add(K(outsideCell.x, outsideCell.y));
  }

  // 往下走回上一层的楼梯（第 1 层是出生点）
  const downCell = pickDownCell(map, rooms[downRoom]);
  if (!downCell) return fail('downcell');
  let arrival = null;
  if (plan.floor === 1) {
    put(downCell, '@');
    arrival = downCell;
  } else {
    put(downCell, '<');
    const options = [];
    for (const dir of DIRS) {
      const c = { x: downCell.x + dir[0], y: downCell.y + dir[1] };
      if (!map.roomOf[c.y] || map.roomOf[c.y][c.x] !== downRoom) continue;
      if (isTaken(c)) continue;
      options.push(c);
    }
    if (!options.length) return fail('arrival');
    arrival = pick(options);
    used.add(K(arrival.x, arrival.y));
  }

  // 门口旁边的格子留空 —— 看门怪就站在门口，挨着的格子不能再站怪
  const onDoor = (c) => map.doors.some((d) => d.x === c.x && d.y === c.y);
  const nearDoor = (c) => map.doors.some((d) => Math.abs(d.x - c.x) + Math.abs(d.y - c.y) === 1);
  const nearStair = (c) =>
    Math.abs(stairCell.x - c.x) + Math.abs(stairCell.y - c.y) <= 1 ||
    Math.abs(downCell.x - c.x) + Math.abs(downCell.y - c.y) <= 1;
  // 门口那只强制怪的隔壁不能再站怪（两只怪不挨着）
  const nearForced = (c) =>
    forcedPatrol && Math.abs(c.x - upInner.x) + Math.abs(c.y - upInner.y) === 1;

  // 金币和备用钥匙：摊在房间的空地上
  const loose = [];
  for (const r of rooms) {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const c = { x, y };
        if (isTaken(c)) continue;
        if (onDoor(c)) continue;
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

  // 巡逻怪：放在房间里的棋盘格位置 —— 同色格子互不相邻，天然不会连成一片
  const candidates = new Map();
  for (const r of rooms) {
    const cells = [];
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const c = { x, y };
        if (isTaken(c)) continue;
        if (onDoor(c)) continue;
        if (nearDoor(c)) continue;
        if (nearStair(c)) continue;
        if (nearForced(c)) continue;
        cells.push(c);
      }
    }
    const even = cells.filter((c) => (c.x + c.y) % 2 === 0);
    const odd = cells.filter((c) => (c.x + c.y) % 2 === 1);
    const same = even.length >= odd.length ? even : odd;
    candidates.set(r.id, shuffled(same));
  }

  const need = patrolCount(plan.floor) - extraBlockers.length - forcedPatrol;
  const roomOrder = shuffled(rooms.map((r) => r.id));
  const chosen = [];
  for (;;) {
    let progressed = false;
    for (const rid of roomOrder) {
      const list = candidates.get(rid);
      if (list && list.length) { chosen.push(list.pop()); progressed = true; }
      if (chosen.length >= need) break;
    }
    if (!progressed || chosen.length >= need) break;
  }
  if (chosen.length < need) return fail('patrol:' + chosen.length);
  for (const c of chosen) put(c, 'v');
  // 多门上锁房多出来的门口，得有人堵着
  for (const c of extraBlockers) put(c, 'v');

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
  const placed = [];
  const stats = [];

  for (let f = 1; f <= FLOOR_COUNT; f++) {
    const plan = planOf(f);
    let ok = null;
    let lastFail = '?';
    for (let attempt = 0; attempt < 400 && !ok; attempt++) {
      const tree = growRoomTree(rnd);
      if (!tree) continue;
      const map = buildMap(tree);
      const r = tryPlace(map, plan);
      if (r && r.fail) { lastFail = r.fail; continue; }
      ok = r;
      ok.tree = tree;
    }
    if (!ok) {
      console.error('第 ' + f + ' 层摆不下（原因 ' + lastFail + '）。');
      process.exit(1);
    }
    placed.push(ok);
    const m = measure(ok.rows);
    m.rooms = ok.tree.rooms.length;
    m.doors = ok.tree.doors.length;
    m.size = ok.rows.length + '×' + ok.rows[0].length;
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
  const avg = (key) => (sum(key) / FLOOR_COUNT).toFixed(1);
  console.log('种子 ' + SEED + '，画布宽 ' + CANVAS_W + '，树最多 ' + MAX_DEPTH + ' 层');
  console.log('平均每层 ' + avg('rooms') + ' 间房、' + avg('doors') + ' 个门洞，尺寸 ' + stats[0].size + ' 起');
  console.log('墙占比 ' + (sum('wall') / (sum('wall') + sum('open')) * 100).toFixed(1) +
    '%，平均每层空地 ' + avg('open') + ' 格');
  console.log('平均每层怪 ' + avg('mons') + ' 只，挨着的怪对数 ' + sum('adjacent') + '（必须是 0）');
  console.log('平均每层开阔地（2×2 空地）' + avg('openSquares') + ' 处、岔口 ' + avg('junction') + ' 个');
  if (process.argv.includes('--print')) {
    for (const i of [0, 1, 2]) {
      console.log('\n第 ' + (i + 1) + ' 层（' + stats[i].rooms + ' 间房 / ' + stats[i].doors + ' 个门洞）：');
      placed[i].rows.forEach((r) => console.log('  ' + r.join('')));
    }
  }
  console.log('已写入 ' + LEVELS_FILE);
}

export { growRoomTree, buildMap, tryPlace, planOf, rnd, pickSpecialRooms, roomCenter, measure };

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/gen-levels.mjs')) main();
