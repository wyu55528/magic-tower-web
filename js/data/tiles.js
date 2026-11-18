/**
 * 地图字符 -> 格子对象 的全局对照表（默认图例）。
 * 每层可以用 legend 覆盖某个字符的 id，这样同一个 's' 在不同层代表不同的剑。
 */
export const TILE_CHARS = {
  '#': { t: 'wall' },
  '.': { t: 'floor' },
  '@': { t: 'start' },
  '>': { t: 'stairUp' },     // ↑ 往上爬：通到上面一层（层号 +1）
  '<': { t: 'stairDown' },   // ↓ 往下走：回到下面一层（层号 -1）
  'X': { t: 'boss', id: 'demon_king' },

  'y': { t: 'item', id: 'key_yellow' },
  'b': { t: 'item', id: 'key_blue' },
  'r': { t: 'item', id: 'key_red' },
  's': { t: 'item', id: 'sword_iron' },
  't': { t: 'item', id: 'shield_wood' },
  'h': { t: 'item', id: 'life_crystal' },
  '$': { t: 'gold', value: 20 },   // 大金币
  '%': { t: 'gold', value: 15 },   // 中金币
  '&': { t: 'gold', value: 10 },   // 小金币

  'd': { t: 'door', lock: 'yellow' },
  'D': { t: 'door', lock: 'blue' },
  'R': { t: 'door', lock: 'red' },

  'S': { t: 'shop' },
  'W': { t: 'item', id: 'warp_scroll' },    // 传送卷轴（第 15 层）
  'B': { t: 'item', id: 'monster_book' },   // 怪物图鉴（第 1 层出口）

  'G': { t: 'monster', id: 'guard_1' },   // 守关怪（每层 1 只）
  'g': { t: 'monster', id: 'imp_1' },   // 小怪：小鬼（每层 1 只，legend 指定具体楼层）
  'k': { t: 'monster', id: 'spr_1' },   // 小怪：史莱姆（每层 1 只，legend 指定具体楼层）
  'v': { t: 'monster', id: 'patrol_1' },   // 巡逻怪：站在通路上拦路（legend 指定具体楼层）
};

export const LOCK_NAMES = { yellow: '黄钥匙', blue: '蓝钥匙', red: '红钥匙' };
