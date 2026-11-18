import { LEVELS, findCharInLevel } from './data/levels.js';
import { bagEntries } from './data/items.js';
import { createInitialState, cloneState } from './core/state.js';
import { step } from './core/reducer.js';
import { createMapView } from './view/mapView.js';
import { createHudView } from './view/hudView.js';
import { createLogView } from './view/logView.js';
import { renderShop } from './view/shopView.js';
import { renderBook } from './view/bookView.js';
import { createInput } from './ui/input.js';
import { saveState, loadState, clearState } from './ui/storage.js';

const $ = (id) => document.getElementById(id);

const mapView = createMapView($('map'));
const hudView = createHudView($('hud'), $('keys'), $('bag'), $('gear'));
const logView = createLogView($('log'));
const overlay = $('overlay');

let state = null;
const history = [];   // 撤销栈：存每一步之前的 state
const MAX_HISTORY = 200;
// 数字缓冲：编号超过 9 时要能选到两位数（商店第 10 件起、背包第 10 件起）
let digitBuf = '';

function newGame() {
  const start = findCharInLevel(0, '@');
  state = createInitialState(start);
  history.length = 0;
  logView.clear();
  logView.push([{ text: `欢迎来到魔塔，共 ${LEVELS.length} 层。魔王在塔顶等着你。`, kind: 'level' }]);
  render();
}

function dispatch(action) {
  const before = state;
  const result = step(state, action);
  state = result.state;
  // 界面换了（打开图鉴 / 传送）就丢掉没选完的数字缓冲
  if (before.status !== state.status) digitBuf = '';

  if (result.events.length) logView.push(result.events);

  const moved = state.steps !== before.steps || state.level !== before.level;
  if (moved) {
    history.push(before);
    if (history.length > MAX_HISTORY) history.shift();
  }

  render();

  // 只有还活着的时候才自动存档，这样"读取存档"能回到阵亡前那一刻
  if (state.status === 'playing' || state.status === 'inShop' || state.status === 'inBook') saveState(state);
}

function undo() {
  if (!history.length) {
    logView.push([{ text: '没有可撤销的步骤了。', kind: 'info' }]);
    return;
  }
  state = history.pop();
  logView.push([{ text: '撤销了一步。', kind: 'info' }]);
  render();
  if (state.status === 'playing') saveState(state);
}

function loadGame() {
  const saved = loadState();
  if (!saved) {
    logView.push([{ text: '没有找到本地存档。', kind: 'warn' }]);
    return;
  }
  state = cloneState(saved);
  history.length = 0;
  logView.push([{ text: '已读取本地存档。', kind: 'info' }]);
  render();
}

function render() {
  // 顶栏只留「第 n 层」；楼层名（庭院 / 石阶 / …）留在数据里，悬停能看见
  const lv = LEVELS[state.level];
  $('level-name').textContent = `第 ${state.level + 1} 层`;
  $('level-name').title = lv.name;
  mapView.render(state);
  hudView.render(state);
  updateOverlay();
}

function updateOverlay() {
  if (state.status === 'playing') {
    overlay.hidden = true;
    overlay.innerHTML = '';
    return;
  }

  overlay.hidden = false;

  if (state.status === 'inShop') {
    renderShop(
      overlay,
      state,
      (itemId) => dispatch({ type: 'BUY', itemId }),
      () => dispatch({ type: 'CLOSE_SHOP' })
    );
    return;
  }

  if (state.status === 'inBook') {
    renderBook(overlay, state, () => dispatch({ type: 'CLOSE_BOOK' }));
    return;
  }

  overlay.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'overlay-card';

  const title = document.createElement('h2');
  const desc = document.createElement('p');
  const buttons = [];

  if (state.status === 'win') {
    title.textContent = '🎉 通关成功！';
    desc.textContent =
      `一共走了 ${state.steps} 步，剩余生命 ${state.hp}，共获得 ${state.gold} 金币。`;
  } else {
    title.textContent = '💀 你倒下了';
    desc.textContent = '存档保留在了倒下的那一刻之前，可以读取回来重试。';
    buttons.push({ label: '读取存档', fn: loadGame });
  }
  buttons.push({ label: '再来一局', fn: newGame });

  card.appendChild(title);
  card.appendChild(desc);
  for (const b of buttons) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = b.label;
    btn.addEventListener('click', b.fn);
    card.appendChild(btn);
  }
  overlay.appendChild(card);
}

hudView.setUseItemHandler((itemId) => dispatch({ type: 'USE_ITEM', itemId }));

/**
 * 当前状态下能选的东西：商店货架、背包。
 * 统一成"1 起的连续编号"，这样数字键就能用同一套两位数逻辑。
 */
function digitPicker() {
  if (state.status === 'inShop') {
    const stock = (state.shop && state.shop.stock) || [];
    return {
      count: stock.length,
      pick: (n) => {
        const entry = stock[n - 1];
        if (entry) dispatch({ type: 'BUY', itemId: entry.id });
      },
    };
  }
  const entries = bagEntries(state);
  return {
    count: entries.length,
    pick: (n) => {
      const entry = entries[n - 1];
      if (entry) dispatch({ type: 'USE_ITEM', itemId: entry.id });
    },
  };
}

/**
 * 按下一个数字键。
 * 如果还存在"更长的编号以当前缓冲开头"（比如按了 1，但货架上有 13 件），
 * 先攒着等下一个数字；回车可以确定。
 */
function pressDigit(d) {
  const picker = digitPicker();
  if (!picker.count) return;
  digitBuf += d;
  const num = Number(digitBuf);

  for (let i = picker.count; i >= 1; i--) {
    const label = String(i);
    if (label.length > digitBuf.length && label.startsWith(digitBuf)) return;   // 还能是两位数
  }

  digitBuf = '';
  if (num < 1 || num > picker.count) return;
  picker.pick(num);
}

/** 回车：确定缓冲里的编号 */
function confirmDigit() {
  if (!digitBuf) return;
  const picker = digitPicker();
  const num = Number(digitBuf);
  digitBuf = '';
  if (num >= 1 && num <= picker.count) picker.pick(num);
}

createInput(window, {
  move: (dir) => { digitBuf = ''; dispatch({ type: 'MOVE', dir }); },
  slot: (n) => {
    if (state.status === 'inBook') return;   // 图鉴开着的时候数字键不做事
    pressDigit(String(n));
  },
  undo,
  book: () => {
    if (state.status === 'inBook') { dispatch({ type: 'CLOSE_BOOK' }); return; }
    if (state.bag && state.bag.monster_book) {
      dispatch({ type: 'USE_ITEM', itemId: 'monster_book' });
    }
  },
  enter: () => {
    confirmDigit();
  },
  escape: () => {
    digitBuf = '';
    if (state.status === 'inShop') dispatch({ type: 'CLOSE_SHOP' });
    if (state.status === 'inBook') dispatch({ type: 'CLOSE_BOOK' });
  },
});

$('btn-save').addEventListener('click', () => {
  const ok = saveState(state);
  logView.push([{ text: ok ? '已保存到本地存档。' : '保存失败（浏览器可能禁用了本地存储）。', kind: ok ? 'info' : 'warn' }]);
});

$('btn-load').addEventListener('click', loadGame);

$('btn-reset').addEventListener('click', () => {
  if (!window.confirm('确定要清空本地存档并重新开始吗？')) return;
  clearState();
  newGame();
});

newGame();

// 标记"游戏已经跑起来了"。index.html 里的兜底提示靠它来判断
// 要不要给用户弹那张"请用本地服务器打开"的卡片。
window.__gameBooted = true;
