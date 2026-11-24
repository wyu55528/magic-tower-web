/**
 * 数值标定循环。
 *
 * 逻辑（每轮）：
 *   1) 跑 verify.js，把参考路线上每一层实际掉的血读出来（measured[0] 是第 1 层）；
 *   2) 把实测值回填到 balance.js 的 FLOOR_DAMAGE（表里第 0 位是占位 0）；
 *   3) 重生成关卡（结晶给的血 = 这一层要挨的打 + 净增长）；
 *   4) 再测，直到实测值和表里的值完全一样（不动点）。
 *
 * 跑： node tools/calibrate.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BAL = join(ROOT, 'js', 'data', 'balance.js');

const node = process.execPath;
const run = (args) => {
  try {
    return execFileSync(node, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
  } catch (e) {
    return (e.stdout || '') + (e.stderr || '');
  }
};

/** 实测值：第 1 层到第 30 层各掉多少血 */
function measuredFrom(stdout) {
  const m = stdout.match(/每一层掉的血和数值表对得上[^\n]*?— 实测 ([0-9,]+)/);
  if (!m) return null;
  return m[1].split(',').map(Number);
}

/** 表里的值：第 0 位是占位 0，第 1~30 位是各层 */
function tableFrom(src) {
  const m = src.match(/export const FLOOR_DAMAGE = \[([\s\S]*?)\];/);
  if (!m) throw new Error('balance.js 里找不到 FLOOR_DAMAGE');
  return m[1].split(',').map((s) => s.trim()).filter((s) => s !== '').map(Number);
}

function writeTable(floors) {
  const src = readFileSync(BAL, 'utf8');
  const body = 'export const FLOOR_DAMAGE = [\n  0,\n  ' + floors.join(', ') + ',\n];';
  const out = src.replace(/export const FLOOR_DAMAGE = \[[\s\S]*?\];/, body);
  if (out === src) throw new Error('回填 FLOOR_DAMAGE 失败（内容没变）');
  writeFileSync(BAL, out);
}

for (let round = 1; round <= 12; round++) {
  const out = run([join('tools', 'verify.js')]);
  const measured = measuredFrom(out);
  if (!measured) {
    console.error('第 ' + round + ' 轮：没读到实测值，verify 输出末尾：');
    console.error(out.slice(-3000));
    process.exit(1);
  }
  const cur = tableFrom(readFileSync(BAL, 'utf8'));      // [0, f1..f30]
  const same = measured.length === cur.length - 1 && measured.every((v, i) => v === cur[i + 1]);
  console.log('第 ' + round + ' 轮：' + (same ? '已经是不动点 ✓' : '实测 ' + measured.join(', ')));
  if (same) {
    const hp = out.match(/玩家面板：攻击 (\d+) \/ 防御 (\d+) \/ 生命 (\d+)/);
    const left = out.match(/通关剩余生命：(\d+)/);
    const steps = out.match(/通关总步数：(\d+)，金币：(\d+)/);
    console.log('收敛：魔王战开打前 ' + (hp ? hp[3] : '?') + ' 血，打完剩 ' + (left ? left[1] : '?')
      + ' 血，总步数 ' + (steps ? steps[1] : '?') + '，金币 ' + (steps ? steps[2] : '?'));
    process.exit(0);
  }
  writeTable(measured);
  run([join('tools', 'gen-levels.mjs')]);
}
console.error('12 轮还没收敛');
process.exit(1);
