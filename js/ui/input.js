const KEY_DIRS = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', a: 'left', s: 'down', d: 'right',
  W: 'up', A: 'left', S: 'down', D: 'right',
};

/**
 * 键盘输入。中文输入法下 key 会变成大写，额外用 e.code 兜底。
 */
export function createInput(target, handlers) {
  function onKeyDown(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    if (e.key === 'Escape') {
      e.preventDefault();
      handlers.escape();
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (handlers.enter) handlers.enter();
      return;
    }

    let dir = KEY_DIRS[e.key];
    if (!dir && e.code && e.code.startsWith('Key')) {
      const c = e.code.slice(3).toLowerCase();
      if (c === 'w' || c === 'a' || c === 's' || c === 'd') dir = KEY_DIRS[c];
    }
    if (dir) {
      e.preventDefault();
      handlers.move(dir);
      return;
    }

    // 允许 0：跨层面板要能选两位数（10 及以上）
    if (/^[0-9]$/.test(e.key)) {
      e.preventDefault();
      handlers.slot(Number(e.key));
      return;
    }

    if (e.key === 'b' || e.key === 'B') {
      e.preventDefault();
      if (handlers.book) handlers.book();
      return;
    }

    if (e.key === 'u' || e.key === 'U') {
      e.preventDefault();
      handlers.undo();
    }
  }

  target.addEventListener('keydown', onKeyDown);
  return {
    destroy() { target.removeEventListener('keydown', onKeyDown); },
  };
}
