/**
 * README 里那两张表的生成器：数值表和图鉴示例表都照代码真值排，不手抄。
 *
 *   node tools/readme-table.mjs          # 打印两张表（Markdown）
 *   node tools/readme-table.mjs --md     # 额外写到 tools/readme-table30.md / readme-codex1.md
 *
 * 数值表 = 每层的名字、结晶给的血、本层装备、各类怪的数值、进入时的面板；
 * 图鉴表 = 第 1 层 10 只怪在「捡到书那一刻」的面板下的战斗结论。
 */
import { LEVELS } from '../js/data/levels.js';
import { MONSTERS } from '../js/data/monsters.js';
import { SWORDS, SHIELDS, crystalOn, entryPanel } from '../js/data/balance.js';
import { previewFight, verdictText } from '../js/core/battle.js';
import { writeFileSync } from 'node:fs';

/** 本层带出来的装备（剑 / 盾），没有就写 - */
function gearOn(floor) {
  const out = [];
  for (const s of SWORDS) if (s.floor === floor) out.push(s.id + '(+' + s.atk + ')');
  for (const s of SHIELDS) if (s.floor === floor) out.push(s.id + '(+' + s.def + ')');
  return out.length ? out.join(' ') : '-';
}

/** 一只怪：图标 名字 血/攻/防 */
function cell(id) {
  const m = MONSTERS[id];
  return m.icon + ' ' + m.name + ' ' + m.hp + '/' + m.atk + '/' + m.def;
}

const t30 = [
  '| 层 | 名字 | 结晶给的血 | 本层装备 | 守关怪 | 看门怪·小鬼 | 看门怪·史莱姆 | 看门怪·恶犬 | 巡逻怪·巡林兽 | 进入时 攻/防/血 |',
  '|---|---|---|---|---|---|---|---|---|---|',
];
for (const L of LEVELS) {
  const f = L.id, g = L.legend, p = entryPanel(f);
  t30.push('| ' + f + ' | ' + L.name.split(' · ')[1] + ' | ' + crystalOn(f) + ' | ' + gearOn(f) +
    ' | ' + cell(g.G) + ' | ' + cell(g.g) + ' | ' + cell(g.k) + ' | ' + cell(g.m) + ' | ' + cell(g.v) +
    ' | ' + p.atk + ' / ' + p.def + ' / ' + p.hp + ' |');
}

/** 捡到图鉴书那一刻的面板（参考路线第 86 个动作之后） */
const BOOK_PANEL = { atk: 400, def: 50, hp: 1710 };
const legend1 = LEVELS[0].legend;
const codex = [];
for (const id of ['G', 'g', 'k', 'm', 'v', 'w', 'p', 'q', 'e', 'f'].map((c) => legend1[c])) {
  const m = MONSTERS[id];
  codex.push('| ' + m.icon + ' ' + m.name.trim() + ' | ' + m.hp + ' | ' + m.atk + ' | ' + m.def +
    ' | ' + (m.gold || 0) + ' | ' + verdictText(previewFight(BOOK_PANEL, m)) + ' |');
}

console.log('=== 30 行数值表 ===');
console.log(t30.join('\n'));
console.log('');
console.log('=== 第 1 层图鉴示例表 ===');
console.log('| 怪物 | 血量 | 攻击 | 防御 | 金币 | 战斗结论 |');
console.log('|---|---|---|---|---|---|');
console.log(codex.join('\n'));

if (process.argv.includes('--md')) {
  writeFileSync('tools/readme-table30.md', t30.join('\n'), 'utf8');
  writeFileSync('tools/readme-codex1.md',
    ['| 怪物 | 血量 | 攻击 | 防御 | 金币 | 战斗结论 |', '|---|---|---|---|---|---|', ...codex].join('\n'), 'utf8');
  console.log('');
  console.log('已写到 tools/readme-table30.md 和 tools/readme-codex1.md');
}