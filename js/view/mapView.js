import { getGrid } from '../data/levels.js';
import { ITEMS } from '../data/items.js';
import { keySvgHtml } from './keyIcon.js';
import { MONSTERS } from '../data/monsters.js';

/**
 * 地图渲染。只读 state，不含任何游戏规则。
 * 换层时重建格子，其余时候只改格子内容。
 */
export function createMapView(root) {
  let builtLevel = -1;
  let cells = [];
  let lastState = null;   // 窗口尺寸变了要重建格子板，重建完还得把内容重新画一遍

  /** 地图区能放下多宽多高：宽度减去侧栏，高度减去顶栏和日志栏 */
  function cellSize(cols, rows) {
    const availW = Math.max(240, window.innerWidth - 300);
    const availH = Math.max(240, window.innerHeight - 190);
    return Math.max(16, Math.min(38, Math.floor(availW / cols), Math.floor(availH / rows)));
  }

  // 窗口尺寸变了，格子大小要跟着重算。
  // 只重建格子板是不够的 —— 新建的格子还是空的，得把上一帧的内容再画一遍。
  window.addEventListener('resize', () => {
    if (builtLevel < 0) return;
    build(builtLevel);
    if (lastState) render(lastState);
  });

  function build(levelIndex) {
    const grid = getGrid(levelIndex);
    root.innerHTML = '';
    const board = document.createElement('div');
    board.className = 'board';
    const n = grid[0].length;
    // 格子边长：宽高两个方向都得塞得下（每层地图大小不一样）
    board.style.setProperty('--cell', cellSize(n, grid.length) + 'px');
    board.style.gridTemplateColumns = `repeat(${n}, var(--cell))`;

    cells = [];
    for (let y = 0; y < grid.length; y++) {
      for (let x = 0; x < grid[y].length; x++) {
        const cell = document.createElement('div');
        cell.className = 'tile';
        cell.dataset.x = String(x);
        cell.dataset.y = String(y);
        board.appendChild(cell);
        cells.push(cell);
      }
    }
    root.appendChild(board);
    builtLevel = levelIndex;
  }

  function render(state) {
    lastState = state;
    if (builtLevel !== state.level) build(state.level);

    const grid = getGrid(state.level);
    const width = grid[0].length;

    for (let y = 0; y < grid.length; y++) {
      for (let x = 0; x < grid[y].length; x++) {
        const tile = grid[y][x];
        const cell = cells[y * width + x];
        const key = `${state.level}:${x},${y}`;
        const taken = !!state.taken[key];
        const opened = !!state.openDoors[key];

        cell.className = 'tile';
        cell.textContent = '';

        let icon = '';
        let keyLock = null;
        switch (tile.t) {
          case 'wall':
            cell.classList.add('wall');
            break;
          case 'item':
            cell.classList.add('item');
            if (!taken) {
              const item = ITEMS[tile.id];
              // 钥匙画成带锁色的钥匙形状：颜色和同色的门一一对应，
              // 不会再出现三把钥匙长得一模一样、认不出颜色的情况。
              if (item && item.type === 'key') keyLock = item.lock || 'yellow';
              else icon = (item && item.icon) || '';
            }
            break;
          case 'gold':
            cell.classList.add('item');
            if (!taken) icon = '💰';
            break;
          case 'monster':
            cell.classList.add('monster');
            if (!taken) icon = (MONSTERS[tile.id] && MONSTERS[tile.id].icon) || '👾';
            break;
          case 'door':
            // 门用整格实心的方块表示，不画钥匙圆点图标——
            // 锁的图标是 🟡🔵🔴 这种圆点，和史莱姆的 🟢🔵🔴 长得几乎一样，
            // 玩家分不清哪个是门哪个是怪。改成实心方块 + 颜色，一眼就分得开。
            cell.classList.add('door');
            if (opened) {
              cell.classList.add('opened');
            } else {
              cell.classList.add('lock-' + (tile.lock || 'yellow'));
            }
            break;
          case 'stairDown':
            cell.classList.add('stair');
            icon = '↓';
            break;
          case 'stairUp':
            cell.classList.add('stair');
            icon = '↑';
            break;
          case 'boss':
            cell.classList.add('boss');
            icon = MONSTERS[tile.id] ? MONSTERS[tile.id].icon : '👿';
            break;
          case 'goal':
            cell.classList.add('goal');
            icon = '👑';
            break;
          default:
            break;
        }

        if (keyLock) {
          cell.innerHTML = keySvgHtml(keyLock);
        } else if (icon) {
          const span = document.createElement('span');
          span.className = 'icon';
          span.textContent = icon;
          cell.appendChild(span);
        }

        if (state.pos.x === x && state.pos.y === y) {
          const player = document.createElement('span');
          player.className = 'player';
          player.textContent = '🧙';
          cell.appendChild(player);
        }
      }
    }
  }

  return { render };
}
