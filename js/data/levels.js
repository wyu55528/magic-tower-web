/**
 * 30 层塔的关卡地图。
 *
 * 地图字符：每行固定 11 个字符，第 0 行和最后一行是外墙。
 *   #  墙        .  空地      @  出生点     > 往上   < 往下   X 魔王
 *   y/b/r  黄/蓝/红钥匙        $/% 大中金币  & 小金币
 *   d/D/R  黄/蓝/红门          W 传送卷轴
 *   G  本层守关怪   g/k 本层两只小怪   B 怪物图鉴
 *   s 剑  t 盾  h 生命结晶（每层由 legend 指定具体档位与数值）
 *
 * legend：每层覆盖全局字符表，所以同一个 s 在不同层代表不同的剑。
 *
 * 关卡形状：每层一张 11×11 的地图，一格宽的走廊迷宫，没有开阔地。
 *   奇数坐标是房间，房间之间隔一格走廊；偶数坐标是实心柱子，
 *   所以任何 2×2 的方块里必定有一格墙 —— 整张图不存在 2×2 的空地，
 *   走起来永远是一格宽的通道。墙占 59.5%，空地 49 格。
 *   走廊末端是死胡同（一格房间 + 一格走廊口），奖励都藏在死胡同里，
 *   所以绕路一定有收获，不会白走。
 *
 * 结构约定（由 tools/verify.js 逐层强制）：
 *   守关怪站在某个死胡同的走廊口上，能开本层门的钥匙就在它身后那个死胡同里；
 *   门同样站在走廊口上，往上爬的楼梯在门后面的死胡同里（末层是魔王）。
 *   于是：挡住所有怪就拿不到开门的钥匙；封死所有门就到不了楼梯。
 *   本层门的钥匙全层只有一把，其余钥匙是下一层门的备用钥匙。
 *
 * 怪物图鉴书：第 1 层出口（通往第 2 层那扇门的外侧）有一本，捡进背包后按 B 打开。
 *
 * 传送卷轴：第 15 层有一个，捡进背包后按 ↑ / ↓ 可以在楼梯旁边上下楼。
 *
 * 地图由 tools/gen-levels.mjs 生成（关卡方案写在那里，地图按方案刻出来）。
 */
import { TILE_CHARS } from "./tiles.js";

export const LEVELS = [
/* ==== LEVELS:BEGIN ==== */
  {
    id: 1,
    name: "第 1 层 · 庭院",
    legend: {
          G: "guard_1",
          g: "imp_1",
          k: "spr_1",
          v: "patrol_1",
          s: "sword_iron",
          h: { id: "life_crystal", hp: 978 },
          "$": { value: 52 },
          "%": { value: 24 },
          "&": { value: 16 },
    },
    rows: [
      '###########',
      '#bk&#v%v#>#',
      '###v#v#v#d#',
      '#$#vvv#vvB#',
      '#.#######v#',
      '#.vvv.Gy#v#',
      '#v###v###.#',
      '#.#s#.#vvv#',
      '#@#g#v#v###',
      '#.vv#vv.gh#',
      '###########',
    ],
  },
  {
    id: 2,
    name: "第 2 层 · 石阶",
    legend: {
          G: "guard_2",
          g: "imp_2",
          k: "spr_2",
          v: "patrol_2",
          h: { id: "life_crystal", hp: 1458 },
          "$": { value: 52 },
          "%": { value: 24 },
          "&": { value: 16 },
    },
    rows: [
      '###########',
      '#h#b#vv%vv#',
      '#g#G#v###v#',
      '#.#.v.kr#v#',
      '#v#.#####.#',
      '#v#<#v.vv.#',
      '#v###v###v#',
      '#.vv#v.v#v#',
      '###v###v#g#',
      '#>D&v$vv#%#',
      '###########',
    ],
  },
  {
    id: 3,
    name: "第 3 层 · 钟楼",
    legend: {
          G: "guard_3",
          g: "imp_3",
          k: "spr_3",
          v: "patrol_3",
          h: { id: "life_crystal", hp: 1874 },
          "$": { value: 52 },
          "%": { value: 24 },
          "&": { value: 16 },
    },
    rows: [
      '###########',
      '#rG.#vvv#y#',
      '###v#v#.#k#',
      '#h#v#.#vv.#',
      '#g#v#v###v#',
      '#.&v#.vv#v#',
      '#v###g#v#v#',
      '#vvv#%#%#.#',
      '###.###v#.#',
      '#>R$vvvv#<#',
      '###########',
    ],
  },
  {
    id: 4,
    name: "第 4 层 · 画廊",
    legend: {
          G: "guard_4",
          g: "imp_4",
          k: "spr_4",
          v: "patrol_4",
          t: "shield_wood",
          h: { id: "life_crystal", hp: 2019 },
          "$": { value: 52 },
          "%": { value: 24 },
          "&": { value: 16 },
    },
    rows: [
      '###########',
      '#t#yG.v.d>#',
      '#g###v#v###',
      '#%vv#$#vv.#',
      '###v#k###v#',
      '#<#v#b#vv&#',
      '#.#v###.#v#',
      '#.vv#vvv#v#',
      '#v###v###v#',
      '#v.v.v#hg.#',
      '###########',
    ],
  },
  {
    id: 5,
    name: "第 5 层 · 密道",
    legend: {
          G: "guard_5",
          g: "imp_5",
          k: "spr_5",
          v: "patrol_5",
          h: { id: "life_crystal", hp: 2753 },
          "$": { value: 52 },
          "%": { value: 24 },
          "&": { value: 16 },
    },
    rows: [
      '###########',
      '#bG.#%g.vv#',
      '###v#####v#',
      '#<#vvvv&#v#',
      '#.#####v#%#',
      '#.v.D>#vv.#',
      '#v#v#####v#',
      '#v#.#vvv$v#',
      '#g#v#v#####',
      '#h#vv..vkr#',
      '###########',
    ],
  },
  {
    id: 6,
    name: "第 6 层 · 熔炉",
    legend: {
          G: "guard_6",
          g: "imp_6",
          k: "spr_6",
          v: "patrol_6",
          h: { id: "life_crystal", hp: 3352 },
          "$": { value: 52 },
          "%": { value: 24 },
          "&": { value: 16 },
    },
    rows: [
      '###########',
      '#$#v.vv.kS#',
      '#.#v###v###',
      '#v#vvv#vv%#',
      '#&###y###v#',
      '#v#>R.gh#v#',
      '#v###G###v#',
      '#.vv#r#vv.#',
      '###v###v#g#',
      '#<..vvvv#%#',
      '###########',
    ],
  },
  {
    id: 7,
    name: "第 7 层 · 冰窟",
    legend: {
          G: "guard_7",
          g: "imp_7",
          k: "spr_7",
          v: "patrol_7",
          s: "sword_bronze",
          h: { id: "life_crystal", hp: 3292 },
          "$": { value: 130 },
          "%": { value: 60 },
          "&": { value: 40 },
    },
    rows: [
      '###########',
      '#yG.vvv.#h#',
      '#######v#g#',
      '#>dvv.#vv&#',
      '#####v###.#',
      '#.vvv..<#v#',
      '#v###v###v#',
      '#v#sgv#v.v#',
      '#%#####v###',
      '#vvv.vv$kb#',
      '###########',
    ],
  },
  {
    id: 8,
    name: "第 8 层 · 暗殿",
    legend: {
          G: "guard_8",
          g: "imp_8",
          k: "spr_8",
          v: "patrol_8",
          h: { id: "life_crystal", hp: 4629 },
          "$": { value: 130 },
          "%": { value: 60 },
          "&": { value: 40 },
    },
    rows: [
      '###########',
      '#>#rk...vv#',
      '#D###g#v#v#',
      '#.vv#%#v#&#',
      '###v###v#g#',
      '#b#vvv#v#h#',
      '#G###.#v###',
      '#.vv#v#v%v#',
      '#.#v#v###.#',
      '#<#v$.vvvv#',
      '###########',
    ],
  },
  {
    id: 9,
    name: "第 9 层 · 王座前",
    legend: {
          G: "guard_9",
          g: "imp_9",
          k: "spr_9",
          v: "patrol_9",
          h: { id: "life_crystal", hp: 5307 },
          "$": { value: 130 },
          "%": { value: 60 },
          "&": { value: 40 },
    },
    rows: [
      '###########',
      '#%#v%.vv#>#',
      '#g#g#v#v#R#',
      '#.#h#v#.v&#',
      '#v###v###v#',
      '#vvv#.vv#v#',
      '###$#G#v#v#',
      '#<#v#r#v#.#',
      '#.#v###.#k#',
      '#.v.vvvv#y#',
      '###########',
    ],
  },
  {
    id: 10,
    name: "第 10 层 · 熔火王座",
    legend: {
          G: "guard_10",
          g: "imp_10",
          k: "spr_10",
          v: "patrol_10",
          t: "shield_iron",
          h: { id: "life_crystal", hp: 5022 },
          "$": { value: 130 },
          "%": { value: 60 },
          "&": { value: 40 },
    },
    rows: [
      '###########',
      '#y#>d$vv#S#',
      '#G###.#v#k#',
      '#.#vvv#v..#',
      '#v#v#####v#',
      '#vv.#<#vvv#',
      '#####.#v###',
      '#vvv#.vv#t#',
      '#g#b#v###g#',
      '#h#vv%.vv&#',
      '###########',
    ],
  },
  {
    id: 11,
    name: "第 11 层 · 荒骨荒原",
    legend: {
          G: "guard_11",
          g: "imp_11",
          k: "spr_11",
          v: "patrol_11",
          h: { id: "life_crystal", hp: 6646 },
          "$": { value: 130 },
          "%": { value: 60 },
          "&": { value: 40 },
    },
    rows: [
      '###########',
      '#hg.#>D.v%#',
      '###v###v#.#',
      '#%#v#vvv#<#',
      '#g#v#.#####',
      '#.$v#.vv.v#',
      '#v###v###v#',
      '#vvv#vGb#v#',
      '###.#####v#',
      '#rk&vvvvv.#',
      '###########',
    ],
  },
  {
    id: 12,
    name: "第 12 层 · 暗河",
    legend: {
          G: "guard_12",
          g: "imp_12",
          k: "spr_12",
          v: "patrol_12",
          h: { id: "life_crystal", hp: 7507 },
          "$": { value: 130 },
          "%": { value: 60 },
          "&": { value: 40 },
    },
    rows: [
      '###########',
      '#%#h#vv.vv#',
      '#g#g#v###v#',
      '#.#.v&.<#v#',
      '#v#R#####$#',
      '#v#>#v.vv.#',
      '#v###%###v#',
      '#vv.vv#vvv#',
      '#######v###',
      '#yk.vvv.Gr#',
      '###########',
    ],
  },
  {
    id: 13,
    name: "第 13 层 · 霜牙巢穴",
    legend: {
          G: "guard_13",
          g: "imp_13",
          k: "spr_13",
          v: "patrol_13",
          s: "sword_silver",
          h: { id: "life_crystal", hp: 7530 },
          "$": { value: 247 },
          "%": { value: 114 },
          "&": { value: 76 },
    },
    rows: [
      '###########',
      '#>#bk.vv#h#',
      '#d###v#v#g#',
      '#.vvv.#.#v#',
      '#######v#v#',
      '#vv..<#v%.#',
      '#.#v#####v#',
      '#v#vv&gs#v#',
      '#v###v###v#',
      '#.Gy#vvvv$#',
      '###########',
    ],
  },
  {
    id: 14,
    name: "第 14 层 · 幽冥回廊",
    legend: {
          G: "guard_14",
          g: "imp_14",
          k: "spr_14",
          v: "patrol_14",
          h: { id: "life_crystal", hp: 9308 },
          "$": { value: 247 },
          "%": { value: 114 },
          "&": { value: 76 },
    },
    rows: [
      '###########',
      '#b#<..vrvv#',
      '#G#####k#v#',
      '#v.vvv#S#v#',
      '#####v###.#',
      '#%g.#v.vv.#',
      '###v#####v#',
      '#vv&gh#vvv#',
      '#v#####%###',
      '#.vvvvv$D>#',
      '###########',
    ],
  },
  {
    id: 15,
    name: "第 15 层 · 血月祭坛",
    legend: {
          G: "guard_15",
          g: "imp_15",
          k: "spr_15",
          v: "patrol_15",
          t: "shield_silver",
          h: { id: "life_crystal", hp: 8360 },
          "$": { value: 247 },
          "%": { value: 114 },
          "&": { value: 76 },
    },
    rows: [
      '###########',
      '#rG.vvv$#h#',
      '#######v#g#',
      '#<..vv#v#v#',
      '###v#R#v#v#',
      '#%v.#>#&v.#',
      '#v#k#####v#',
      '#v#W#yvv.v#',
      '#v###v#####',
      '#v.vv.vvgt#',
      '###########',
    ],
  },
  {
    id: 16,
    name: "第 16 层 · 机械圣所",
    legend: {
          G: "guard_16",
          g: "imp_16",
          k: "spr_16",
          v: "patrol_16",
          h: { id: "life_crystal", hp: 10989 },
          "$": { value: 247 },
          "%": { value: 114 },
          "&": { value: 76 },
    },
    rows: [
      '###########',
      '#<..vvvv#b#',
      '#######v#k#',
      '#vv$v.#%v.#',
      '#v#v#v###v#',
      '#v#.#.Gy#v#',
      '#v#v#g###v#',
      '#.#v#h#vv&#',
      '#g#v###v###',
      '#%#vv.v.d>#',
      '###########',
    ],
  },
  {
    id: 17,
    name: "第 17 层 · 万骨魔殿",
    legend: {
          G: "guard_17",
          g: "imp_17",
          k: "spr_17",
          v: "patrol_17",
          s: "sword_gold",
          h: { id: "life_crystal", hp: 16964 },
          "$": { value: 390 },
          "%": { value: 180 },
          "&": { value: 120 },
    },
    rows: [
      '###########',
      '#s#rk.v.v.#',
      '#g###v#v#.#',
      '#.vv#v#v#<#',
      '###v#g#.###',
      '#v%v#h#.vv#',
      '#v#####G#v#',
      '#vv&vv#b#.#',
      '#####v###v#',
      '#>Dvv.$vvv#',
      '###########',
    ],
  },
  {
    id: 18,
    name: "第 18 层 · 虚空裂隙",
    legend: {
          G: "guard_18",
          g: "imp_18",
          k: "spr_18",
          v: "patrol_18",
          h: { id: "life_crystal", hp: 12865 },
          "$": { value: 390 },
          "%": { value: 180 },
          "&": { value: 120 },
    },
    rows: [
      '###########',
      '#$.&#Sk.vv#',
      '###v###g#.#',
      '#r#vvv#%#v#',
      '#G###v###v#',
      '#yR>#vvvv.#',
      '#v#######v#',
      '#%vvvv#vvv#',
      '#v###v#.###',
      '#..<#vv.gh#',
      '###########',
    ],
  },
  {
    id: 19,
    name: "第 19 层 · 魔王前庭",
    legend: {
          G: "guard_19",
          g: "imp_19",
          k: "spr_19",
          v: "patrol_19",
          t: "shield_gold",
          h: { id: "life_crystal", hp: 9483 },
          "$": { value: 390 },
          "%": { value: 180 },
          "&": { value: 120 },
    },
    rows: [
      '###########',
      '#bk.vvv&vv#',
      '#########v#',
      '#vvv.v#>#.#',
      '#.###v#d#v#',
      '#v#tg$vv#v#',
      '#v###.###v#',
      '#%v.#<#vv.#',
      '#G#v###v###',
      '#y#vv.v.gh#',
      '###########',
    ],
  },
  {
    id: 20,
    name: "第 20 层 · 终焉回廊",
    legend: {
          G: "guard_20",
          g: "imp_20",
          k: "spr_20",
          v: "patrol_20",
          h: { id: "life_crystal", hp: 15583 },
          "$": { value: 390 },
          "%": { value: 180 },
          "&": { value: 120 },
    },
    rows: [
      '###########',
      '#h#>D.v$vv#',
      '#g###v###.#',
      '#.vvv%#<#v#',
      '#######.#v#',
      '#vg%#vv.#v#',
      '#v###.#v#.#',
      '#.vv#v#vvv#',
      '#G#v#v#####',
      '#b#&v.vvkr#',
      '###########',
    ],
  },
  {
    id: 21,
    name: "第 21 层 · 灰烬阶梯",
    legend: {
          G: "guard_21",
          g: "imp_21",
          k: "spr_21",
          v: "patrol_21",
          h: { id: "life_crystal", hp: 16203 },
          "$": { value: 390 },
          "%": { value: 180 },
          "&": { value: 120 },
    },
    rows: [
      '###########',
      '#ykv#rG.v.#',
      '###v#####v#',
      '#<#vv.vv#v#',
      '#.#####v#v#',
      '#.g%#v.v#v#',
      '#v###v###%#',
      '#.vv#v#vv.#',
      '#g#v#v#v#R#',
      '#h#&v$v.#>#',
      '###########',
    ],
  },
  {
    id: 22,
    name: "第 22 层 · 逆时之庭",
    legend: {
          G: "guard_22",
          g: "imp_22",
          k: "spr_22",
          v: "patrol_22",
          s: "sword_diamond",
          h: { id: "life_crystal", hp: 15484 },
          "$": { value: 650 },
          "%": { value: 300 },
          "&": { value: 200 },
    },
    rows: [
      '###########',
      '#y#vvvv&kS#',
      '#G#v###.###',
      '#b#$.<#.vv#',
      '#v#####g#v#',
      '#vvvvv#h#v#',
      '#####.###%#',
      '#.vv#v#vv.#',
      '#d#v#v#v#g#',
      '#>#vv..v#s#',
      '###########',
    ],
  },
  {
    id: 23,
    name: "第 23 层 · 骸骨书库",
    legend: {
          G: "guard_23",
          g: "imp_23",
          k: "spr_23",
          v: "patrol_23",
          h: { id: "life_crystal", hp: 18766 },
          "$": { value: 650 },
          "%": { value: 300 },
          "&": { value: 200 },
    },
    rows: [
      '###########',
      '#%#<.&vv#>#',
      '#g###v#v#D#',
      '#.vv#v#vvv#',
      '###v#.#####',
      '#h#.#.v.vv#',
      '#g#v#k###v#',
      '#$vv#r#v%.#',
      '#v#####v#G#',
      '#.vvvv.v#b#',
      '###########',
    ],
  },
  {
    id: 24,
    name: "第 24 层 · 熔金深渊",
    legend: {
          G: "guard_24",
          g: "imp_24",
          k: "spr_24",
          v: "patrol_24",
          t: "shield_diamond",
          h: { id: "life_crystal", hp: 33706 },
          "$": { value: 650 },
          "%": { value: 300 },
          "&": { value: 200 },
    },
    rows: [
      '###########',
      '#yk.#v$vgt#',
      '###v#v#####',
      '#r#v#.vv.v#',
      '#G#v#.###v#',
      '#.v&#vR>#v#',
      '#v#######v#',
      '#vvvvv#vv.#',
      '#####v#.#.#',
      '#hg.v%vv#<#',
      '###########',
    ],
  },
  {
    id: 25,
    name: "第 25 层 · 寂灭回廊",
    legend: {
          G: "guard_25",
          g: "imp_25",
          k: "spr_25",
          v: "patrol_25",
          h: { id: "life_crystal", hp: 20612 },
          "$": { value: 650 },
          "%": { value: 300 },
          "&": { value: 200 },
    },
    rows: [
      '###########',
      '#hg.#bk$vv#',
      '###v#####v#',
      '#>#vvvv.v.#',
      '#d#######v#',
      '#%.vv&Gy#v#',
      '#v###v###.#',
      '#v#<#v.vvv#',
      '#.#.#######',
      '#vv.vvvvg%#',
      '###########',
    ],
  },
  {
    id: 26,
    name: "第 26 层 · 妖星观测台",
    legend: {
          G: "guard_26",
          g: "imp_26",
          k: "spr_26",
          v: "patrol_26",
          h: { id: "life_crystal", hp: 21332 },
          "$": { value: 650 },
          "%": { value: 300 },
          "&": { value: 200 },
    },
    rows: [
      '###########',
      '#S#<..vvvv#',
      '#k###v###$#',
      '#vvv&v#%#v#',
      '#######g#v#',
      '#.v.v.v.#v#',
      '#v#v#g###%#',
      '#v#v#h#vvv#',
      '#G#.###.###',
      '#b#vvvvrD>#',
      '###########',
    ],
  },
  {
    id: 27,
    name: "第 27 层 · 断罪刑场",
    legend: {
          G: "guard_27",
          g: "imp_27",
          k: "spr_27",
          v: "patrol_27",
          h: { id: "life_crystal", hp: 22156 },
          "$": { value: 650 },
          "%": { value: 300 },
          "&": { value: 200 },
    },
    rows: [
      '###########',
      '#rG.#hg.vv#',
      '###v###k#.#',
      '#%#vvv#y#v#',
      '#g###v###v#',
      '#&.$#vvvv%#',
      '#v#######v#',
      '#.vvv.R>#v#',
      '#v###v###v#',
      '#..<#vvv.v#',
      '###########',
    ],
  },
  {
    id: 28,
    name: "第 28 层 · 湮灭之门",
    legend: {
          G: "guard_28",
          g: "imp_28",
          k: "spr_28",
          v: "patrol_28",
          h: { id: "life_crystal", hp: 22980 },
          "$": { value: 650 },
          "%": { value: 300 },
          "&": { value: 200 },
    },
    rows: [
      '###########',
      '#h#.vvvv#b#',
      '#g#v###.#k#',
      '#.vv#%#vv.#',
      '#####g###v#',
      '#>#vv%vv#v#',
      '#d#.###.#.#',
      '#.vv#<#vvv#',
      '#v###.#####',
      '#v&vv$vvGy#',
      '###########',
    ],
  },
  {
    id: 29,
    name: "第 29 层 · 无光圣殿",
    legend: {
          G: "guard_29",
          g: "imp_29",
          k: "spr_29",
          v: "patrol_29",
          h: { id: "life_crystal", hp: 23804 },
          "$": { value: 650 },
          "%": { value: 300 },
          "&": { value: 200 },
    },
    rows: [
      '###########',
      '#bGv#vv.v.#',
      '###$#D#v#k#',
      '#<#v#>#.#S#',
      '#.#v###v###',
      '#.#vvv#vvv#',
      '#v###.###v#',
      '#&vv#v#vr.#',
      '#g#v#v#v#g#',
      '#%#v.%vv#h#',
      '###########',
    ],
  },
  {
    id: 30,
    name: "第 30 层 · 魔王之座",
    legend: {
          G: "guard_30",
          g: "imp_30",
          k: "spr_30",
          v: "patrol_30",
          h: { id: "life_crystal", hp: 28932 },
          "$": { value: 650 },
          "%": { value: 300 },
          "&": { value: 200 },
    },
    rows: [
      '###########',
      '#%k%vv#vRX#',
      '#####v#v###',
      '#.gh#.#.vv#',
      '#v###v#.#.#',
      '#.vvvv#<#v#',
      '#v#######v#',
      '#v&vvv#vv.#',
      '#####v#.#g#',
      '#rG$v.vv#%#',
      '###########',
    ],
  }
/* ==== LEVELS:END ==== */
];

const gridCache = new Map();

/** 把字符地图解析成二维格子数组（带缓存），legend 在这里生效 */
export function getGrid(levelIndex) {
  if (!gridCache.has(levelIndex)) {
    const level = LEVELS[levelIndex];
    if (!level) return null;
    const legend = level.legend || {};
    gridCache.set(levelIndex, level.rows.map((row) =>
      Array.from(row, (ch) => {
        const base = TILE_CHARS[ch] || { t: "floor" };
        const over = legend[ch];
        // legend 值可以是字符串（直接当 id）或对象（覆盖任意字段）
        const patch = typeof over === "string" ? { id: over } : (over || {});
        return { ...base, ...patch, ch };
      })
    ));
  }
  return gridCache.get(levelIndex);
}

/** 取某个格子，越界返回 null */
export function tileAt(levelIndex, x, y) {
  const grid = getGrid(levelIndex);
  if (!grid) return null;
  if (y < 0 || y >= grid.length) return null;
  const row = grid[y];
  if (x < 0 || x >= row.length) return null;
  return row[x];
}

/** 在某层里找到某个字符的位置（用于定位出生点、楼梯） */
export function findCharInLevel(levelIndex, ch) {
  const grid = getGrid(levelIndex);
  if (!grid) return null;
  for (let y = 0; y < grid.length; y++) {
    const x = grid[y].findIndex((c) => c.ch === ch);
    if (x >= 0) return { x, y };
  }
  return null;
}

/**
 * 某一层上出现的所有怪物 id（守关怪 + 魔王），按出现顺序去重。
 * 怪物图鉴只列当前层的怪，所以这个函数就是图鉴的数据源。
 */
export function monsterIdsOnLevel(levelIndex) {
  const grid = getGrid(levelIndex);
  if (!grid) return [];
  const ids = [];
  const seen = new Set();
  for (const row of grid) {
    for (const t of row) {
      if (t.t !== 'monster' && t.t !== 'boss') continue;
      if (!t.id || seen.has(t.id)) continue;
      seen.add(t.id);
      ids.push(t.id);
    }
  }
  return ids;
}

/**
 * 换层之后的落点：目标层楼梯**旁边**的一格，不站到楼梯上。
 *
 * 站在楼梯上有两个毛病：人物图标会把 ↑↓ 盖住，看不出那是楼梯；
 * 背包里有传送卷轴时，站在楼梯上按 ↑↓ 会立刻再传送，想挪开都别扭。
 * 所以落地一律落在隔壁能走的格子上：优先空地，其次才是别的
 * （上楼时楼梯口那扇门是唯一邻居，只能落在门上）。
 * 楼梯四面全是墙时（正常关卡不会出现）才退回楼梯本身。
 */
export function landingNear(levelIndex, stairChar) {
  const stair = findCharInLevel(levelIndex, stairChar);
  if (!stair) return null;
  const grid = getGrid(levelIndex);
  const cand = [];
  for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
    const x = stair.x + dx, y = stair.y + dy;
    if (y < 0 || x < 0 || y >= grid.length || x >= grid[0].length) continue;
    const t = grid[y][x];
    if (!t || t.t === 'wall') continue;
    cand.push({ x, y, t });
  }
  if (!cand.length) return { x: stair.x, y: stair.y };
  const plain = cand.find((c) => c.t.t === 'floor' || c.t.t === 'start');
  const spot = plain || cand[0];
  return { x: spot.x, y: spot.y };
}
