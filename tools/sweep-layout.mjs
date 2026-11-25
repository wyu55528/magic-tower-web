/**
 * 关卡尺寸参数扫描器。
 *
 *   node tools/sweep-layout.mjs            # 扫预设的几套尺寸
 *   node tools/sweep-layout.mjs --dry      # 同上（生成器不写文件，本来就不写）
 *
 * 每套配置都用子进程跑一遍生成器（--dry 只算不写），
 * 然后把墙占比、空地格数、最大房、画布高度摆成一张表，用来挑参数。
 *
 * 可调参数（生成器读环境变量）：
 *   CANVAS_W / SLOT_MIN / ROOM_W_MAX / ROOM_H_MIN / ROOM_H_MAX
 *   ROOT_W_MAX / ROOT_H_MAX / MAX_DEPTH / MAX_H
 */
import { execFileSync } from 'node:child_process';

const CONFIGS = [
  { name: '当前默认', env: {} },
  { name: '画布 15', env: { CANVAS_W: '15' } },
  { name: '画布 15 + 房 4 高', env: { CANVAS_W: '15', ROOM_H_MIN: '4', ROOM_H_MAX: '4' } },
  { name: '画布 15 + 房 3 高', env: { CANVAS_W: '15', ROOM_H_MIN: '3', ROOM_H_MAX: '3' } },
  { name: '画布 17 + 房 4 高', env: { CANVAS_W: '17', SLOT_MIN: '4', ROOM_H_MIN: '4', ROOM_H_MAX: '4' } },
  { name: '入口厅 9 宽', env: { ROOT_W_MAX: '9' } },
  { name: '入口厅 5 宽', env: { ROOT_W_MAX: '5' } },
  { name: '树 3 层', env: { MAX_DEPTH: '2' } },
];

const ROOT = 'D:/下载/学习资料/Tower';
const rows = [];
for (const c of CONFIGS) {
  const env = { ...process.env, ...c.env, MAX_H: '40' };
  let out = '';
  try {
    out = execFileSync('node', ['tools/gen-levels.mjs', '--dry'], { env, cwd: ROOT, encoding: 'utf8', timeout: 180000 });
  } catch (e) {
    rows.push({ name: c.name, fail: String(e.stderr || e.message).split('\n')[0] });
    continue;
  }
  const pick = (re) => { const m = out.match(re); return m ? m[1] : '-'; };
  rows.push({
    name: c.name,
    wall: pick(/墙占比 ([\d.]+)%/),
    open: pick(/平均每层空地 ([\d.]+) 格/),
    maxRoom: pick(/最大的一间房 (\d+) 格/),
    size: pick(/平均每层 [\d.]+ 间房，尺寸 ([\d×]+) 起/),
    sq: pick(/平均每层 2×2 空地 ([\d.]+) 处/),
    mon: pick(/平均每层怪 ([\d.]+) 只/),
    adj: pick(/挨着的怪对数 (\d+)/),
  });
}

const p = (s, n) => String(s).padEnd(n);
console.log(p('配置', 18) + p('墙%', 7) + p('空地', 8) + p('最大房', 8) + p('画布', 9) + p('2×2', 8) + p('怪', 6) + '备注');
for (const r of rows) {
  if (r.fail) { console.log(p(r.name, 18) + '失败: ' + r.fail); continue; }
  console.log(p(r.name, 18) + p(r.wall, 7) + p(r.open, 8) + p(r.maxRoom, 8) + p(r.size, 9) + p(r.sq, 8) + p(r.mon, 6) +
    (r.adj !== '0' ? '相邻怪 ' + r.adj : ''));
}