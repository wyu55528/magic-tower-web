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

  function build(levelIndex) {
    const grid = getGrid(levelIndex);
    root.innerHTML = '';
    const board = document.createElement('div');
    board.className = 'board';
    const n = grid[0].length;
    // 格子边长跟着地图宽度收：13×13 用大格子，15×15 以上自动缩一档
    board.style.setProperty('--cell', n >= 15 ? 'min(32px, 4.1vw, 4.1vh)' : 'min(38px, 4.6vw, 4.6vh)');
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
