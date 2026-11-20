/**
 * 30 层塔的关卡生成器。
 *
 * 地图不再是「一条走廊一路弯折」的树状迷宫，改成「厅堂 + 街巷」：
 *   - 每层是一张 3×3 的街区图：每个街区 3×3 格，要么挖成厅堂，要么留成实心墙块；
 *   - 街巷 1 格宽，沿着街区之间的缝走，随机连成一张有分叉、有环路的网；
 *   - 墙上凿「壁龛」：两格深的死胡同，尽头放奖励，门口站小怪。
 * 于是地上有开阔的厅堂，路有岔口和环路，奖励藏在不打怪就拿不到的小凹室里。
 *
 * 三种版式轮着用，30 层不会长一个样：
 *   A 街区     —— 6~8 间厅堂 + 随机连通的一段街巷
 *   B 中央大厅 —— 中间一间 5×5 大厅，四周一圈环形回廊，四周各一间厅堂
 *   C 长廊     —— 两条贯通长廊 + 两条竖巷，上下两排厅堂
 *
 * 怪不挨着：任何两只怪都不会上下左右相邻，路上不会出现「一格接一格全是怪」。
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

const SIZE = Number(process.argv[2]) || 15;
const SEED = Number(process.argv[3]) || 20261120;

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
const ALCOVE_WANT = 9;       // 想凿多少个壁龛（不够就换一张图）
const ALCOVE_MIN = 6;        // 至少要凿出几个（楼梯 / 钥匙 / 结晶 / 壁龛 / 剑盾）

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

/* ---------------- 街区骨架 ---------------- */
const DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]];
const K = (x, y) => x + ',' + y;

/**
 * 街区骨架：3×3 个街区，每个街区 3×3 格，街区之间留 1 格的缝当街巷。
 * 缝的位置固定（每 4 格一条），于是整张图天然带分叉和环路。
 */
function skeleton(N) {
  const size = 3;          // 街区 3×3
  const pitch = size + 1;  // 两条街巷之间夹着一个街区
  const lines = [];        // 街巷所在的行 / 列
  for (let p = 1; p <= N - 2; p += pitch) lines.push(p);
  const blocks = [];
  for (let j = 0; j + 1 < lines.length; j++) {
    for (let i = 0; i + 1 < lines.length; i++) {
      blocks.push({
        i, j,
        x: lines[i] + 1, y: lines[j] + 1,
        w: lines[i + 1] - lines[i] - 1,
        h: lines[j + 1] - lines[j] - 1,
      });
    }
  }
  // 每条街巷被横街巷切成几段，每段就是一段路
  const segs = [];
  for (const g of lines) {
    for (let k = 0; k + 1 < lines.length; k++) {
      segs.push({ axis: 'v', line: g, a: lines[k], b: lines[k + 1] });
    }
  }
  for (const r of lines) {
    for (let k = 0; k + 1 < lines.length; k++) {
      segs.push({ axis: 'h', line: r, a: lines[k], b: lines[k + 1] });
    }
  }
  return { blocks, lines, segs };
}

/** 两段街巷接不接得上（同一根线上首尾相接，或者十字交叉） */
function segTouch(a, b) {
  if (a.axis === b.axis) {
    if (a.line !== b.line) return false;
    return a.b === b.a || b.b === a.a;
  }
  const v = a.axis === 'v' ? a : b;
  const h = a.axis === 'v' ? b : a;
  return h.a <= v.line && v.line <= h.b && v.a <= h.line && h.line <= v.b;
}

/** 这间厅堂挨不挨着某段街巷 */
function roomTouchesSeg(room, seg) {
  if (seg.axis === 'v') {
    if (seg.line !== room.x - 1 && seg.line !== room.x + room.w) return false;
    return seg.a <= room.y + room.h - 1 && room.y <= seg.b;
  }
  if (seg.line !== room.y - 1 && seg.line !== room.y + room.h) return false;
  return seg.a <= room.x + room.w - 1 && room.x <= seg.b;
}

/** 这几段街巷是不是连成一整片 */
function segsConnected(segs) {
  if (!segs.length) return false;
  const seen = new Set([0]);
  const stack = [0];
  while (stack.length) {
    const i = stack.pop();
    for (let j = 0; j < segs.length; j++) {
      if (seen.has(j)) continue;
      if (!segTouch(segs[i], segs[j])) continue;
      seen.add(j); stack.push(j);
    }
  }
  return seen.size === segs.length;
}

/** 有没有环：连通图的边数比点数多，说明能绕路 */
function segsHaveCycle(segs) {
  let edges = 0;
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      if (segTouch(segs[i], segs[j])) edges++;
    }
  }
  return edges >= segs.length;
}

/** 随机生成树：把街区连成一棵有分叉的树 */
function spanningTree(nodes, neighbors) {
  const seen = new Set([nodes[0]]);
  const edges = [];
  const stack = [nodes[0]];
  while (stack.length) {
    const cur = stack[stack.length - 1];
    const cand = neighbors(cur).filter((n) => !seen.has(n) && nodes.indexOf(n) >= 0);
    if (!cand.length) { stack.pop(); continue; }
    const nx = cand[Math.floor(rnd() * cand.length)];
    seen.add(nx);
    edges.push([cur, nx]);
    stack.push(nx);
  }
  return edges;
}

/* ---------------- 挖地图 ---------------- */
function carveRect(grid, r) {
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) grid[y][x] = 1;
  }
}
function carveSeg(grid, seg) {
  if (seg.axis === 'v') {
    for (let y = seg.a; y <= seg.b; y++) grid[y][seg.line] = 1;
  } else {
    for (let x = seg.a; x <= seg.b; x++) grid[seg.line][x] = 1;
  }
}

/**
 * 找能凿壁龛的地方。
 * 一个壁龛 = 从走廊上的一格（锚点）往外凿两格：壁龛口 + 壁龛尽头。
 *   - 尽头是死胡同，只有 1 个出口；
 *   - 壁龛口只有 2 个出口（锚点 + 尽头）。
 * 所以站在壁龛口上的怪正好堵住这个小凹室，门放在这儿也只挡这一条支路。
 */
function findAlcoveSpots(grid, N) {
  const out = [];
  for (let y = 1; y < N - 1; y++) {
    for (let x = 1; x < N - 1; x++) {
      if (grid[y][x] !== 1) continue;
      for (const [dx, dy] of DIRS) {
        const mx = x + dx, my = y + dy;
        const ex = x + 2 * dx, ey = y + 2 * dy;
        if (mx < 1 || my < 1 || mx > N - 2 || my > N - 2) continue;
        if (ex < 1 || ey < 1 || ex > N - 2 || ey > N - 2) continue;
        if (grid[my][mx] !== 0 || grid[ey][ex] !== 0) continue;
        let ok = true;
        // 壁龛口的另外两个邻居必须是墙
        for (const [ax, ay] of DIRS) {
          const nx = mx + ax, ny = my + ay;
          if (nx === x && ny === y) continue;
          if (nx === ex && ny === ey) continue;
          if (grid[ny] && grid[ny][nx] === 1) { ok = false; break; }
        }
        if (!ok) continue;
        // 壁龛尽头的另外三个邻居必须是墙
        for (const [ax, ay] of DIRS) {
          const nx = ex + ax, ny = ey + ay;
          if (nx === mx && ny === my) continue;
          if (grid[ny] && grid[ny][nx] === 1) { ok = false; break; }
        }
        if (!ok) continue;
        out.push({ ax: x, ay: y, mx, my, ex, ey });
      }
    }
  }
  return out;
}

function carveAlcoves(grid, N, want) {
  const spots = shuffled(findAlcoveSpots(grid, N));
  const alcoves = [];
  const used = new Set();
  for (const sp of spots) {
    if (alcoves.length >= want) break;
    // 壁龛格不能挨着别的壁龛格，不然出口数就变了
    let clash = false;
    for (const [x, y] of [[sp.mx, sp.my], [sp.ex, sp.ey]]) {
      if (used.has(K(x, y))) clash = true;
      for (const [dx, dy] of DIRS) {
        if (used.has(K(x + dx, y + dy))) clash = true;
      }
      if (clash) break;
    }
    if (clash) continue;
    grid[sp.my][sp.mx] = 1;
    grid[sp.ey][sp.ex] = 1;
    used.add(K(sp.mx, sp.my));
    used.add(K(sp.ex, sp.ey));
    alcoves.push(sp);
  }
  return alcoves;
}

/**
 * 造一张图。三种版式轮着用：
 *   A 街区：几间厅堂 + 一段连通的街巷（带环）
 *   B 中央大厅：中间 5×5 大厅 + 四周环形回廊
 *   C 长廊：两条贯通长廊 + 两条竖巷
 */
function buildMap(N, flavor) {
  const grid = Array.from({ length: N }, () => new Array(N).fill(0));
  const skel = skeleton(N);
  const L = skel.lines.length - 1;          // 每个方向的街区数
  const blockAt = (i, j) => skel.blocks[j * L + i];
  const neighbors = (b) => {
    const out = [];
    if (b.i > 0) out.push(blockAt(b.i - 1, b.j));
    if (b.i < L - 1) out.push(blockAt(b.i + 1, b.j));
    if (b.j > 0) out.push(blockAt(b.i, b.j - 1));
    if (b.j < L - 1) out.push(blockAt(b.i, b.j + 1));
    return out;
  };
  /** 两个相邻街区之间的那条街巷 */
  const segBetween = (a, b) => {
    if (a.i === b.i) {
      return { axis: 'h', line: skel.lines[Math.min(a.j, b.j) + 1], a: skel.lines[a.i], b: skel.lines[a.i + 1] };
    }
    return { axis: 'v', line: skel.lines[Math.min(a.i, b.i) + 1], a: skel.lines[a.j], b: skel.lines[a.j + 1] };
  };

  const rooms = [];
  const streets = [];
  let hall = null;

  // 选一间起始街区，长成一团（这样厅堂之间连得上）
  const count = 6 + Math.floor(rnd() * 3);
  const start = skel.blocks[Math.floor(rnd() * skel.blocks.length)];
  const roomSet = [start];
  while (roomSet.length < count) {
    const cands = [];
    for (const b of roomSet) {
      for (const n of neighbors(b)) if (roomSet.indexOf(n) < 0) cands.push(n);
    }
    if (!cands.length) break;
    roomSet.push(cands[Math.floor(rnd() * cands.length)]);
  }

  if (flavor === 'B') {
    // 中央大厅：正中间挖成 5×5 的大厅
    const mi = Math.floor(L / 2), mj = Math.floor(L / 2);
    const mid = blockAt(mi, mj);
    if (roomSet.indexOf(mid) < 0) roomSet[roomSet.length - 1] = mid;
    hall = {
      x: skel.lines[mi], y: skel.lines[mj],
      w: skel.lines[mi + 1] - skel.lines[mi] + 1,
      h: skel.lines[mj + 1] - skel.lines[mj] + 1,
    };
  }

  const midI = Math.floor(L / 2), midJ = Math.floor(L / 2);
  for (const b of roomSet) {
    if (hall && b.i === midI && b.j === midJ) continue;
    rooms.push(b);
  }
  if (hall) rooms.push(hall);

  if (flavor === 'C') {
    // 长廊：两条贯通的长廊 + 两条竖巷，最下面一排留成墙块
    for (const s of skel.segs) {
      if (s.axis === 'h' && (s.line === skel.lines[1] || s.line === skel.lines[L - 1])) streets.push(s);
      if (s.axis === 'v' && (s.line === skel.lines[1] || s.line === skel.lines[L - 1])) {
        if (s.b < skel.lines[L - 1]) streets.push(s);
      }
    }
    // 厅堂占上面两排，最下面一排是实心墙块（壁龛凿在里面）
    rooms.length = 0;
    for (const b of skel.blocks) {
      if (b.j === L - 1) continue;
      rooms.push(b);
    }
  } else {
    // 街巷：把所有街区连成一棵树（分叉），再补几条形成环路。
    // 每个街区旁边都有路，空着的墙块也挨着路，才凿得出壁龛。
    const tree = spanningTree(skel.blocks, neighbors);
    for (const [a, b] of tree) streets.push(segBetween(a, b));
    for (let t = 0; t < 2; t++) {
      const pairs = [];
      for (const a of skel.blocks) {
        for (const b of neighbors(a)) {
          const key = (x, y) => (x.i < y.i || (x.i === y.i && x.j < y.j))
            ? x.i + ',' + x.j + '|' + y.i + ',' + y.j
            : y.i + ',' + y.j + '|' + x.i + ',' + x.j;
          if (tree.some(([x, y]) => key(x, y) === key(a, b))) continue;
          pairs.push([a, b]);
        }
      }
      if (!pairs.length) break;
      const pr = pairs[Math.floor(rnd() * pairs.length)];
      streets.push(segBetween(pr[0], pr[1]));
    }
  }

  for (const r of rooms) carveRect(grid, r);
  const openStreets = [];
  for (const s of streets) {
    // 钻进大厅里的街巷已经被大厅本身盖住了，不用再挖
    if (hall) {
      const inside = s.axis === 'v'
        ? (s.a >= hall.y && s.b <= hall.y + hall.h - 1 && s.line >= hall.x && s.line <= hall.x + hall.w - 1)
        : (s.a >= hall.x && s.b <= hall.x + hall.w - 1 && s.line >= hall.y && s.line <= hall.y + hall.h - 1);
      if (inside) continue;
    }
    carveSeg(grid, s);
    openStreets.push(s);
  }

  const alcoves = carveAlcoves(grid, N, ALCOVE_WANT);
  if (alcoves.length < ALCOVE_MIN) return null;

  // 每个格子的出口数
  const deg = [];
  for (let y = 0; y < N; y++) {
    deg[y] = [];
    for (let x = 0; x < N; x++) {
      let d = 0;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        if (grid[ny][nx] === 1) d++;
      }
      deg[y][x] = d;
    }
  }
  return { grid, rooms, streets, alcoves, deg };
}

/* ---------------- 摆东西 ---------------- */
function fail(why) { return { fail: why }; }

/**
 * 巡逻怪：站在厅堂和街巷上巡逻。
 *
 * 站位规则：
 *   - 不能挨着别的怪（上下左右都不行）—— 路上不会出现「一格接一格全是怪」；
 *   - 不能站在死胡同和壁龛口上（那是守关怪和壁龛怪的位置）；
 *   - 离落脚点至少 2 步，进层不会一上来就撞上怪。
 * 选法：按离落脚点的距离铺开，一路走过去隔一段就能遇到一只。
 */
function placePatrols(map, plan, placed, used, arrival) {
  const { grid, deg } = map;
  const N = grid.length;
  const want = patrolCount(plan.floor);

  const monsterSet = new Set();
  for (const [k, ch] of placed) {
    if (ch === 'G' || ch === 'g' || ch === 'k' || ch === 'v') monsterSet.add(k);
  }
  const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  const isMonster = (x, y) => monsterSet.has(K(x, y));

  /** 这一格能走到的相邻格 */
  const walk = (x, y) => {
    const out = [];
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      if (grid[ny][nx] !== 1) continue;
      out.push({ x: nx, y: ny });
    }
    return out;
  };

  /**
   * 离别的怪太近就不能站：
   *   - 八邻格里不能有怪（不挨着，斜着也不行）；
   *   - 走廊上两头 2 格内不能有怪（中间至少空 2 格）。
   * 所以一路上是「走一段、遇一只」，不会变成一格接一格全是怪。
   */
  const tooClose = (x, y) => {
    for (const [dx, dy] of DIRS) {
      if (isMonster(x + dx, y + dy)) return true;
    }
    // 厅堂里斜着挨着也不行，走廊上就只要求不挨着
    if (deg[y][x] >= 3) {
      for (const [dx, dy] of DIAG) {
        if (isMonster(x + dx, y + dy)) return true;
      }
    }
    return false;
  };

  // 离落脚点多远
  const dist = new Map();
  const queue = [arrival];
  dist.set(K(arrival.x, arrival.y), 0);
  while (queue.length) {
    const cur = queue.shift();
    const d = dist.get(K(cur.x, cur.y));
    for (const [dx, dy] of DIRS) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      if (grid[ny][nx] !== 1) continue;
      const k = K(nx, ny);
      if (dist.has(k)) continue;
      dist.set(k, d + 1);
      queue.push({ x: nx, y: ny });
    }
  }

  // 每间厅堂能站几只怪：厅堂 3×3 就站 4 只，再多就排成棋盘了
  const roomOf = new Map();
  (map.rooms || []).forEach((r, idx) => {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) roomOf.set(K(x, y), idx);
    }
  });
  const roomCap = (map.rooms || []).map((r) => Math.max(2, Math.round((r.w * r.h) / 2.25)));
  const roomUsed = new Array(roomCap.length).fill(0);

  // 候选：能站的空地，出口 ≥ 2，离落脚点 ≥ 2 步
  const cand = [];
  for (let y = 1; y < N - 1; y++) {
    for (let x = 1; x < N - 1; x++) {
      if (grid[y][x] !== 1) continue;
      const k = K(x, y);
      if (used.has(k) || placed.has(k)) continue;
      if (deg[y][x] < 2) continue;
      const d = dist.get(k);
      if (d == null || d < 2) continue;
      cand.push({ x, y, k, d });
    }
  }
  if (cand.length < want) return null;

  cand.sort((a, b) => a.d - b.d || (a.k < b.k ? -1 : 1));
  const picked = [];
  const taken = new Set();
  const tryPick = (c) => {
    if (picked.length >= want) return;
    if (taken.has(c.k)) return;
    if (tooClose(c.x, c.y)) return;
    const rid = roomOf.get(c.k);
    if (rid !== undefined && roomUsed[rid] >= roomCap[rid]) return;
    picked.push(c);
    taken.add(c.k);
    monsterSet.add(c.k);
    if (rid !== undefined) roomUsed[rid]++;
  };
  // 先在厅堂里放（厅堂宽敞，站得下更多怪），再往走廊上补
  const halls = cand.filter((c) => deg[c.y][c.x] >= 3);
  const corridors = cand.filter((c) => deg[c.y][c.x] === 2);
  const takeFrom = (list) => {
    if (!list.length) return;
    const stride = Math.max(1, Math.floor(list.length / want));
    for (let i = 0; i < list.length && picked.length < want; i++) {
      tryPick(list[Math.floor(i * stride) % list.length]);
    }
  };
  takeFrom(halls);
  takeFrom(corridors);
  for (const c of cand) {
    if (picked.length >= want) break;
    tryPick(c);
  }
  if (picked.length < want) return { count: picked.length };

  for (const c of picked) {
    placed.set(c.k, 'v');
    used.add(c.k);
  }
  return { count: picked.length, picked };
}

function tryPlace(map, plan) {
  const { grid, deg } = map;
  const N = grid.length;
  const placed = new Map();
  const used = new Set();
  const put = (cell, ch) => placed.set(K(cell.x, cell.y), ch);

  const pool = shuffled(map.alcoves);
  const takeAlcove = () => {
    for (const a of pool) {
      if (used.has(K(a.mx, a.my))) continue;
      used.add(K(a.mx, a.my));
      used.add(K(a.ex, a.ey));
      return a;
    }
    return null;
  };
  const mouth = (a) => ({ x: a.mx, y: a.my });
  const end = (a) => ({ x: a.ex, y: a.ey });

  // 往上那级楼梯（末层是魔王）：门在壁龛口，楼梯在壁龛尽头
  const upA = takeAlcove();
  if (!upA) return fail('stair');
  put(end(upA), plan.isLast ? 'X' : '>');
  put(mouth(upA), DOOR_CHARS[plan.doorLock]);

  // 往下走回上一层的楼梯
  let downA = null;
  if (plan.floor > 1) {
    downA = takeAlcove();
    if (!downA) return fail('down');
    put(end(downA), '<');
  }

  // 守关怪堵在壁龛口，开门的钥匙在它身后
  const keyA = takeAlcove();
  if (!keyA) return fail('key');
  put(end(keyA), plan.keys.find((k) => k.role === 'door').ch);
  put(mouth(keyA), 'G');

  // 小鬼堵在壁龛口，生命结晶在它身后
  const cryA = takeAlcove();
  if (!cryA) return fail('crystal');
  put(end(cryA), 'h');
  put(mouth(cryA), 'g');

  // 史莱姆堵在壁龛口，商店 / 卷轴 / 备用钥匙在它身后
  const nookA = takeAlcove();
  if (!nookA) return fail('nook');
  put(mouth(nookA), 'k');
  const spare = plan.keys.find((k) => k.role === 'spare');
  if (plan.hasWarp) put(end(nookA), 'W');
  else if (plan.hasShop) put(end(nookA), 'S');
  else if (spare) put(end(nookA), spare.ch);
  else put(end(nookA), '%');

  // 剑 / 盾放在壁龛里；这一层没有就摆金币。门口站着小鬼
  const eqA = takeAlcove();
  if (!eqA) return fail('equip');
  if (plan.sword) put(end(eqA), 's');
  else if (plan.shield) put(end(eqA), 't');
  else put(end(eqA), '%');
  put(mouth(eqA), 'g');

  // 第 1 层的怪物图鉴放在门外（书 → 门 → 楼梯，三格一线）
  if (plan.hasBook) {
    put({ x: upA.ax, y: upA.ay }, 'B');
    used.add(K(upA.ax, upA.ay));
  }

  // 剩下的空地
  const freeCells = () => {
    const out = [];
    for (let y = 1; y < N - 1; y++) {
      for (let x = 1; x < N - 1; x++) {
        if (grid[y][x] !== 1) continue;
        const k = K(x, y);
        if (used.has(k) || placed.has(k)) continue;
        out.push({ x, y, k });
      }
    }
    return out;
  };

  // 金币：先摊在厅堂里（出口多的格子），实在没有就随便找格空地
  const goldSpots = freeCells().filter((c) => deg[c.y][c.x] >= 3);
  const anySpots = goldSpots.length >= GOLD_PER_FLOOR ? goldSpots : freeCells();
  for (const g of plan.golds.slice(0, GOLD_PER_FLOOR)) {
    const pool2 = anySpots.filter((c) => !used.has(c.k) && !placed.has(c.k));
    if (!pool2.length) return fail('gold');
    const c = pool2[Math.floor(rnd() * pool2.length)];
    used.add(c.k);
    put(c, g.ch);
  }

  // 备用钥匙（这一层没有塞进壁龛的那把）摊在空地上
  for (const k of plan.keys) {
    if (k.role !== 'spare') continue;
    if ([...placed.values()].indexOf(k.ch) >= 0) continue;
    const pool2 = freeCells().filter((c) => !used.has(c.k) && !placed.has(c.k));
    if (!pool2.length) return fail('spare');
    const c = pool2[Math.floor(rnd() * pool2.length)];
    used.add(c.k);
    put(c, k.ch);
  }

  // 出生点（第 1 层）
  let arrival;
  if (plan.floor === 1) {
    const pool2 = freeCells().filter((c) => deg[c.y][c.x] >= 2);
    if (!pool2.length) return fail('start');
    const c = pool2[Math.floor(rnd() * pool2.length)];
    used.add(c.k);
    put(c, '@');
    arrival = c;
  } else {
    // 换层之后落在下楼梯的壁龛口上，这一格不能站怪
    arrival = mouth(downA);
  }

  // 巡逻怪
  const patrol = placePatrols(map, plan, placed, used, arrival);
  if (!patrol || patrol.count < patrolCount(plan.floor)) {
    return fail('patrol:' + (patrol ? patrol.count : 0));
  }

  // 组装字符图
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

function main() {
const placed = [];
const stats = [];

// 30 层的版式：三种各 10 次，打散开，保证相邻两层不像
const flavorPlan = shuffled(
  Array(10).fill('A').concat(Array(10).fill('B'), Array(10).fill('C'))
);

for (let f = 1; f <= FLOOR_COUNT; f++) {
  const plan = planOf(f);
  let ok = null;
  let lastFail = '?';
  for (let attempt = 0; attempt < 4000 && !ok; attempt++) {
    const flavor = flavorPlan[(f - 1 + attempt) % flavorPlan.length];
    const map = buildMap(SIZE, flavor);
    if (!map) { lastFail = 'map/' + flavor; continue; }
    const r = tryPlace(map, plan);
    if (r && r.fail) { lastFail = r.fail + '/' + flavor; continue; }
    ok = r;
    ok.flavor = flavor;
  }
  if (!ok) {
    console.error('第 ' + f + ' 层摆不下（原因 ' + lastFail + '）。');
    process.exit(1);
  }
  placed.push(ok);

  // 自己看一遍：空地多少、有没有开阔地、有几个岔口、怪挨没挨着
  const rows = ok.rows;
  const N = rows.length;
  let wall = 0, open = 0, dead = 0, junction = 0, mons = 0;
  let openSquares = 0;
  const monsterCells = [];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const ch = rows[y][x];
      if (ch === '#') { wall++; continue; }
      open++;
      let d = 0;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || ny >= N || nx >= N) continue;
        if (rows[ny][nx] !== '#') d++;
      }
      if (d === 1) dead++;
      if (d >= 3) junction++;
      if (ch === 'G' || ch === 'g' || ch === 'k' || ch === 'v' || ch === 'X') {
        mons++;
        monsterCells.push({ x, y });
      }
    }
  }
  for (let y = 0; y < N - 1; y++) {
    for (let x = 0; x < N - 1; x++) {
      const s0 = rows[y][x] === '#';
      const s1 = rows[y][x + 1] === '#';
      const s2 = rows[y + 1][x] === '#';
      const s3 = rows[y + 1][x + 1] === '#';
      if (!s0 && !s1 && !s2 && !s3) openSquares++;
    }
  }
  let adjacent = 0;
  for (const c of monsterCells) {
    for (const [dx, dy] of DIRS) {
      const nx = c.x + dx, ny = c.y + dy;
      if (nx < 0 || ny < 0 || ny >= N || nx >= N) continue;
      const ch = rows[ny][nx];
      if (ch === 'G' || ch === 'g' || ch === 'k' || ch === 'v' || ch === 'X') adjacent++;
    }
  }
  stats.push({ f, flavor: ok.flavor, wall, open, dead, junction, mons, openSquares, adjacent });
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
console.log('平均每层怪 ' + (sum('mons') / FLOOR_COUNT).toFixed(1) +
  ' 只，挨着的怪对数 ' + sum('adjacent') + '（必须是 0）');
console.log('平均每层开阔地（2×2 空地）' + (sum('openSquares') / FLOOR_COUNT).toFixed(1) +
  ' 处、岔口（3 个以上出口）' + (sum('junction') / FLOOR_COUNT).toFixed(1) + ' 个');
if (process.argv.includes('--print')) {
  for (const i of [0, 1, 2]) {
    console.log('\n第 ' + (i + 1) + ' 层（' + stats[i].flavor + ' 版）：');
    placed[i].rows.forEach((r) => console.log('  ' + r.join('')));
  }
}
console.log('已写入 ' + LEVELS_FILE);
}

// 直接运行时才生成关卡；被 import 时只导出工具函数
if (process.argv[1] && /gen-levels\.mjs$/.test(process.argv[1])) main();

export { buildMap, tryPlace, skeleton, placePatrols, planOf, rnd };
