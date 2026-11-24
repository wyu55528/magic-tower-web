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
 * 每层 10 个物种、30 只怪，全塔 300 个物种、900 只怪：
 *   守关怪（G）：每层 1 只，守在上锁房那间房的门口，不打就进不去。
 *   看门怪（g/k/m）：每层 3 只，堵在别的房间门洞上 —— 门洞是进房的唯一通道。
 *     三个物种（小鬼 / 史莱姆 / 恶犬）长得都不一样。
 *   巡逻怪（v/w/p/q/e/f）：每层 26 只，六种性格混着放在各个房间里。
 *
 * 巡逻怪的六种性格（见 PATROL_SPECIES）：
 *   疾行兵打 3 个回合、每回合掉的血少，但掉得快；
 *   铁甲卫打 8 个回合、每回合掉的血多，磨到最后；
 *   窥视者最脆，一两下就倒。
 *   六种性格的平均消耗跟以前那个单一巡逻怪一样，
 *   所以一层的总掉血不变 —— 变的是节奏，不是难度。
 *
 * 小怪和巡逻怪的数值不在这里手写，
 *   而是从本层守关怪（或本层的进入面板）按比例派生，这样两套数字不会打架。
 */
import { entryPanel } from './balance.js';

/**
 * 巡逻怪的六种性格。
 *   rounds   = 这一场打几个回合
 *   ratio    = 一场吃掉进层血量的百分之几
 *   defRatio = 防御占进层攻击力的百分之几（防御越高，玩家每回合打得越少，场数自然拉长）
 *   gold     = 掉落金币相对基准巡逻怪的倍数
 * 六种性格按 5/5/4/4/4/4 的数量铺开，平均消耗跟单一巡逻怪持平。
 */
export const PATROL_SPECIES = [
  {
    key: 'a', char: 'v', icon: '🦌',
    names: ['巡林兽', '暗林兽', '血月巡林', '虚空守林', '魔殿巡林', '无光巡林'],
    rounds: 5, ratio: 0.0070, defRatio: 0.08, gold: 1.00,
  },
  {
    key: 'b', char: 'w', icon: '🐇',
    names: ['疾行兵', '影刃', '血月疾行', '虚空疾影', '魔殿影袭', '逐风者'],
    rounds: 3, ratio: 0.0042, defRatio: 0.07, gold: 0.80,
  },
  {
    key: 'c', char: 'p', icon: '🦏',
    names: ['铁甲卫', '玄甲兵', '熔铁重卫', '霜甲武士', '深渊铁卫', '魔殿铁骑'],
    rounds: 8, ratio: 0.0090, defRatio: 0.12, gold: 1.35,
  },
  {
    key: 'd', char: 'q', icon: '🐘',
    names: ['蛮力兽', '狂怒兽', '熔岩蛮兽', '寒霜巨猿', '虚空暴君', '魔殿巨力'],
    rounds: 4, ratio: 0.0088, defRatio: 0.05, gold: 1.15,
  },
  {
    key: 'e', char: 'e', icon: '🐆',
    names: ['游猎者', '暗巷游猎', '赤瞳游猎', '黑羽游猎', '虚空猎手', '魔殿游侠'],
    rounds: 6, ratio: 0.0058, defRatio: 0.08, gold: 0.90,
  },
  {
    key: 'f', char: 'f', icon: '👁️',
    names: ['窥视者', '深渊之瞳', '灼热魔眼', '霜华之瞳', '虚空魔眼', '魔殿真眼'],
    rounds: 3, ratio: 0.0062, defRatio: 0.04, gold: 0.70,
  },
];

/**
 * 看门怪：三种，长得不一样，数值也不一样。
 * 数值按本层守关怪的比例派生。
 */
export const GATE_SPECIES = [
  {
    key: 'imp', char: 'g', goldRatio: 0.30,
    names: ['洞穴小鬼', '暗巷小鬼', '黑雾小鬼', '血月小鬼', '虚空小鬼', '魔殿小鬼'],
    icons: ['👺', '🧟', '👻', '👹', '🕷️', '🦗'],
    hp: 0.35, atk: 0.45, def: 0.60,
  },
  {
    key: 'spr', char: 'k', goldRatio: 0.15,
    names: ['青苔史莱姆', '幽蓝史莱姆', '赤焰史莱姆', '寒霜史莱姆', '虚空史莱姆', '魔殿史莱姆'],
    icons: ['🐸', '🦀', '🦎', '🐧', '🐙', '🦑'],
    hp: 0.18, atk: 0.25, def: 0.40,
  },
  {
    key: 'hound', char: 'm', goldRatio: 0.22,
    names: ['野犬', '铁鬃獒', '血月猎犬', '霜牙狼犬', '虚空魔犬', '魔殿獒犬'],
    icons: ['🐕', '🦮', '🐺', '🦊', '🐩', '🐴'],
    hp: 0.28, atk: 0.38, def: 0.48,
  },
];

export const MONSTERS = {
  guard_1        : { name: '绿史莱姆  ', hp:   2820, atk:    92, def:   24, gold:  112, icon: '🦠' },
  guard_2        : { name: '蓝史莱姆  ', hp:   2820, atk:   113, def:   24, gold:  112, icon: '🐙' },
  guard_3        : { name: '红史莱姆  ', hp:   2820, atk:   137, def:   24, gold:  112, icon: '🐞' },
  guard_4        : { name: '红蝙蝠   ', hp:   2820, atk:   224, def:   24, gold:  112, icon: '🦇' },
  guard_5        : { name: '骷髅兵   ', hp:   2820, atk:   254, def:   24, gold:  112, icon: '💀' },
  guard_6        : { name: '幽 灵   ', hp:   2820, atk:   287, def:   24, gold:  112, icon: '👻' },
  guard_7        : { name: '巨 魔   ', hp:   7050, atk:   323, def:   60, gold:  280, icon: '👹' },
  guard_8        : { name: '毒沼巨兽  ', hp:   7050, atk:   362, def:   60, gold:  280, icon: '🐊' },
  guard_9        : { name: '黑暗剑士  ', hp:   7050, atk:   404, def:   60, gold:  280, icon: '🦉' },
  guard_10       : { name: '魔王亲卫  ', hp:   7050, atk:   539, def:   60, gold:  280, icon: '🦅' },
  guard_11       : { name: '石像鬼   ', hp:   7050, atk:   587, def:   60, gold:  280, icon: '🗿' },
  guard_12       : { name: '巫妖侍从  ', hp:   7050, atk:   638, def:   60, gold:  280, icon: '🧙' },
  guard_13       : { name: '霜 狼   ', hp:  13395, atk:   692, def:  114, gold:  532, icon: '🐻‍❄️' },
  guard_14       : { name: '骨 龙   ', hp:  13395, atk:   749, def:  114, gold:  532, icon: '🦴' },
  guard_15       : { name: '血月祭司  ', hp:  13395, atk:   959, def:  114, gold:  532, icon: '🌙' },
  guard_16       : { name: '深渊魔犬  ', hp:  13395, atk:  1022, def:  114, gold:  532, icon: '🐺' },
  guard_17       : { name: '万骨领主  ', hp:  24675, atk:  1050, def:  180, gold:  840, icon: '🕷️' },
  guard_18       : { name: '虚空爬行者 ', hp:  24675, atk:  1050, def:  180, gold:  840, icon: '🦎' },
  guard_19       : { name: '地狱三头犬 ', hp:  28200, atk:  1250, def:  180, gold:  840, icon: '🐕' },
  guard_20       : { name: '虚空魔   ', hp:  31725, atk:  1250, def:  180, gold:  840, icon: '👾' },
  guard_21       : { name: '熔岩巨兽  ', hp:  31725, atk:  1250, def:  180, gold:  840, icon: '🦖' },
  guard_22       : { name: '烬火魔   ', hp:  58750, atk:  1250, def:  300, gold: 1400, icon: '🔥' },
  guard_23       : { name: '寒霜女妖  ', hp:  64625, atk:  1250, def:  300, gold: 1400, icon: '🥶' },
  guard_24       : { name: '冰晶守卫  ', hp:  70500, atk:  2000, def:  300, gold: 1400, icon: '❄️' },
  guard_25       : { name: '锈铁傀儡  ', hp:  70500, atk:  2000, def:  300, gold: 1400, icon: '🤖' },
  guard_26       : { name: '毒藤怪   ', hp:  70500, atk:  2000, def:  300, gold: 1400, icon: '🐛' },
  guard_27       : { name: '深渊祭司  ', hp:  70500, atk:  2000, def:  300, gold: 1400, icon: '👺' },
  guard_28       : { name: '虚空骑士  ', hp:  70500, atk:  2000, def:  300, gold: 1400, icon: '🐉' },
  guard_29       : { name: '判罚天使  ', hp:  70500, atk:  2000, def:  300, gold: 1400, icon: '⚖️' },
  guard_30       : { name: '终焉魔将  ', hp:  70500, atk:  2000, def:  300, gold: 1400, icon: '☠️' },
  demon_king:   { name: '魔 王',   hp: 200000, atk: 2500, def: 800, gold: 0,     icon: '👿' },
};

/**
 * 怪变多了，每只怪掉的金币就摊薄。
 * 一只守关怪现在只占三十只怪里的一只，金币要摊着掉，
 * 塔里金币的总量还是六万六千六百四十四，商店的价目表不用动。
 */
const GOLD_SCALE = 0.26;

/** 小怪分 6 档，每档换个名字和图标，免得 30 层全是同一张脸 */
function tierOf(floor) {
  return Math.min(5, Math.floor((floor - 1) / 5));
}

for (let floor = 1; floor <= 30; floor++) {
  const base = MONSTERS['guard_' + floor];
  if (!base) continue;
  const g = { ...base, gold: Math.round(base.gold * GOLD_SCALE) };
  MONSTERS['guard_' + floor] = g;
  const tier = tierOf(floor);

  // 看门怪：三个物种，都从本层守关怪派生
  for (const sp of GATE_SPECIES) {
    MONSTERS[sp.key + '_' + floor] = {
      name: sp.names[tier], icon: sp.icons[tier],
      hp: Math.round(g.hp * sp.hp), atk: Math.round(g.atk * sp.atk),
      def: Math.round(g.def * sp.def), gold: Math.round(g.gold * sp.goldRatio),
    };
  }

  // 巡逻怪：按"刚踏上这一层时的面板"倒推，保证刚进层打得过。
  // 每种性格有自己的回合数和每回合掉血量，节奏不一样。
  const p = entryPanel(floor);
  const baseGold = Math.round(g.gold * 0.25);
  for (const sp of PATROL_SPECIES) {
    const monDef = Math.max(1, Math.round(p.atk * sp.defRatio));   // 玩家每回合能打出的伤害
    const dmgPerRound = Math.max(1, p.atk - monDef);
    const hp = dmgPerRound * sp.rounds;                            // 撑 sp.rounds 个回合
    const loss = Math.round(p.hp * sp.ratio);                       // 一场要吃掉的血
    const atk = p.def + Math.max(1, Math.round(loss / (sp.rounds - 1)));
    MONSTERS['patrol_' + sp.key + '_' + floor] = {
      name: sp.names[tier], icon: sp.icon,
      hp, atk, def: monDef,
      gold: Math.max(1, Math.round(baseGold * sp.gold)),
    };
  }
}
