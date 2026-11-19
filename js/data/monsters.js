/**
 * 怪物图鉴。
 * 战斗公式：伤害 = max(1, 攻方攻击 - 守方防御)，双方每回合同时结算，玩家先手。
 *
 * 守关怪数值按"该层玩家打完本层装备后的面板"倒推：
 *   每回合打玩家 3% 血量（最多 700），一场怪大约吃掉 18% 血，3~12 回合打死。
 *   塔里每层的怪变多了、也变强了（血量 ×1.25），一场怪吃掉的血更多，
 *   所以每层补的东西也跟着加。
 * 魔王是 20 万血的耐久战：玩家每回合打 4200，48 回合击杀，
 *   魔王反击 47 次共 56400 伤害，魔王战前 68000 血打完剩 11600。
 *
 * 三种怪：
 *   守关怪（G）：每层 1 只，堵在开门钥匙前面，不打就拿不到钥匙。
 *   壁龛小怪（g/k）：每层 2 只，守在生命结晶、传送卷轴这些死胡同门口。
 *   巡逻怪（v）：每层 2~3 只，直接站在通路上拦路，把战斗密度铺到路上。
 *
 * 小怪和巡逻怪的数值不在这里手写，
 *   而是从本层守关怪（或本层的进入面板）按比例派生，这样两套数字不会打架。
 *   imp（小鬼）：血 35% / 攻 45% / 防 60% / 金币 30%
 *   spr（史莱姆）：血 18% / 攻 25% / 防 40% / 金币 15%
 *   patrol（巡逻怪）：按"刚进这一层时的面板"倒推，
 *     打 5 个回合，每回合吃掉 8% 血量
 */
import { entryPanel, PATROL_DAMAGE_RATIO, PATROL_ROUNDS } from './balance.js';

export const MONSTERS = {
  guard_1        : { name: '绿史莱姆  ', hp:   2820, atk:    92, def:   24, gold:  112, icon: '🟢' },
  guard_2        : { name: '蓝史莱姆  ', hp:   2820, atk:   113, def:   24, gold:  112, icon: '🔵' },
  guard_3        : { name: '红史莱姆  ', hp:   2820, atk:   137, def:   24, gold:  112, icon: '🔴' },
  guard_4        : { name: '红蝙蝠   ', hp:   2820, atk:   224, def:   24, gold:  112, icon: '🦇' },
  guard_5        : { name: '骷髅兵   ', hp:   2820, atk:   254, def:   24, gold:  112, icon: '💀' },
  guard_6        : { name: '幽 灵   ', hp:   2820, atk:   287, def:   24, gold:  112, icon: '👻' },
  guard_7        : { name: '巨 魔   ', hp:   7050, atk:   323, def:   60, gold:  280, icon: '👹' },
  guard_8        : { name: '毒沼巨兽  ', hp:   7050, atk:   362, def:   60, gold:  280, icon: '🐊' },
  guard_9        : { name: '黑暗剑士  ', hp:   7050, atk:   404, def:   60, gold:  280, icon: '🗡️' },
  guard_10       : { name: '魔王亲卫  ', hp:   7050, atk:   539, def:   60, gold:  280, icon: '🛡️' },
  guard_11       : { name: '石像鬼   ', hp:   7050, atk:   587, def:   60, gold:  280, icon: '🟢' },
  guard_12       : { name: '巫妖侍从  ', hp:   7050, atk:   638, def:   60, gold:  280, icon: '🔵' },
  guard_13       : { name: '霜 狼   ', hp:  13395, atk:   692, def:  114, gold:  532, icon: '🔴' },
  guard_14       : { name: '骨 龙   ', hp:  13395, atk:   749, def:  114, gold:  532, icon: '🦇' },
  guard_15       : { name: '血月祭司  ', hp:  13395, atk:   959, def:  114, gold:  532, icon: '💀' },
  guard_16       : { name: '深渊魔犬  ', hp:  13395, atk:  1022, def:  114, gold:  532, icon: '👻' },
  guard_17       : { name: '万骨领主  ', hp:  24675, atk:  1050, def:  180, gold:  840, icon: '👹' },
  guard_18       : { name: '虚空爬行者 ', hp:  24675, atk:  1050, def:  180, gold:  840, icon: '🐊' },
  guard_19       : { name: '地狱三头犬 ', hp:  28200, atk:  1250, def:  180, gold:  840, icon: '🗡️' },
  guard_20       : { name: '虚空魔   ', hp:  31725, atk:  1250, def:  180, gold:  840, icon: '🛡️' },
  guard_21       : { name: '熔岩巨兽  ', hp:  31725, atk:  1250, def:  180, gold:  840, icon: '🟢' },
  guard_22       : { name: '烬火魔   ', hp:  58750, atk:  1250, def:  300, gold: 1400, icon: '🔵' },
  guard_23       : { name: '寒霜女妖  ', hp:  64625, atk:  1250, def:  300, gold: 1400, icon: '🔴' },
  guard_24       : { name: '冰晶守卫  ', hp:  70500, atk:  2000, def:  300, gold: 1400, icon: '🦇' },
  guard_25       : { name: '锈铁傀儡  ', hp:  70500, atk:  2000, def:  300, gold: 1400, icon: '💀' },
  guard_26       : { name: '毒藤怪   ', hp:  70500, atk:  2000, def:  300, gold: 1400, icon: '👻' },
  guard_27       : { name: '深渊祭司  ', hp:  70500, atk:  2000, def:  300, gold: 1400, icon: '👹' },
  guard_28       : { name: '虚空骑士  ', hp:  70500, atk:  2000, def:  300, gold: 1400, icon: '🐊' },
  guard_29       : { name: '判罚天使  ', hp:  70500, atk:  2000, def:  300, gold: 1400, icon: '🗡️' },
  guard_30       : { name: '终焉魔将  ', hp:  70500, atk:  2000, def:  300, gold: 1400, icon: '🛡️' },
  demon_king:   { name: '魔 王',   hp: 200000, atk: 2500, def: 800, gold: 0,     icon: '👿' },
};

/* ---------------- 小怪：从本层守关怪派生 ---------------- */

/** 小怪按层数分成 6 档，每档换个名字和图标，免得 30 层全是同一张脸 */
const SMALL_TIERS = [
  { imp: { name: '洞穴小鬼  ', icon: '👺' }, spr: { name: '青苔史莱姆', icon: '🟢' } },
  { imp: { name: '暗巷小鬼  ', icon: '🧟' }, spr: { name: '幽蓝史莱姆', icon: '🔵' } },
  { imp: { name: '黑雾小鬼  ', icon: '👻' }, spr: { name: '赤焰史莱姆', icon: '🔴' } },
  { imp: { name: '血月小鬼  ', icon: '👹' }, spr: { name: '寒霜史莱姆', icon: '⚪' } },
  { imp: { name: '虚空小鬼  ', icon: '💀' }, spr: { name: '虚空史莱姆', icon: '🟣' } },
  { imp: { name: '魔殿小鬼  ', icon: '👿' }, spr: { name: '魔王史莱姆', icon: '⚫' } },
];

/* ---------------- 巡逻怪：站在通路上拦路的怪 ---------------- */

/**
 * 巡逻怪也分 6 档换名字换图标。
 * 图标特意避开 🟢🔵🔴 这种纯色圆点——那是史莱姆的脸，
 * 门要用实心方块来跟它们区分，巡逻怪也不能再撞脸。
 */
const PATROL_TIERS = [
  { name: '巡逻土狼  ', icon: '🐺' },
  { name: '铁面卫兵  ', icon: '🦂' },
  { name: '赤瞳猎犬  ', icon: '🐍' },
  { name: '寒霜巨蛛  ', icon: '🕷️' },
  { name: '黑羽隼    ', icon: '🦅' },
  { name: '魔殿龙裔  ', icon: '🐉' },
];

for (let floor = 1; floor <= 30; floor++) {
  const g = MONSTERS['guard_' + floor];
  if (!g) continue;
  const tier = SMALL_TIERS[Math.min(SMALL_TIERS.length - 1, Math.floor((floor - 1) / 5))];
  MONSTERS['imp_' + floor] = {
    name: tier.imp.name, icon: tier.imp.icon,
    hp: Math.round(g.hp * 0.35), atk: Math.round(g.atk * 0.45),
    def: Math.round(g.def * 0.60), gold: Math.round(g.gold * 0.30),
  };
  MONSTERS['spr_' + floor] = {
    name: tier.spr.name, icon: tier.spr.icon,
    hp: Math.round(g.hp * 0.18), atk: Math.round(g.atk * 0.25),
    def: Math.round(g.def * 0.40), gold: Math.round(g.gold * 0.15),
  };

  // 巡逻怪：按"刚踏上这一层时的面板"倒推，保证刚进层打得过。
  const p = entryPanel(floor);
  const pt = PATROL_TIERS[Math.min(PATROL_TIERS.length - 1, Math.floor((floor - 1) / 5))];
  const monDef = Math.max(1, Math.round(p.atk * 0.08));      // 玩家每回合能打出的伤害
  const dmgPerRound = Math.max(1, p.atk - monDef);
  const hp = dmgPerRound * PATROL_ROUNDS;                    // 撑 PATROL_ROUNDS 个回合
  const loss = Math.round(p.hp * PATROL_DAMAGE_RATIO);        // 一场要吃掉的血
  const atk = p.def + Math.max(1, Math.round(loss / (PATROL_ROUNDS - 1)));
  MONSTERS['patrol_' + floor] = {
    name: pt.name, icon: pt.icon,
    hp, atk, def: monDef,
    gold: Math.round(g.gold * 0.25),
  };
}
