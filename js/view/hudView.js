import { ITEMS, bagEntries } from '../data/items.js';
import { keySvgHtml } from './keyIcon.js';

export function createHudView(hudEl, keysEl, bagEl, gearEl) {
  let onUseItem = null;

  function render(state) {
    // 状态
    hudEl.innerHTML = '';
    const rows = [
      ['生命', state.hp],
      ['攻击', state.atk],
      ['防御', state.def],
      ['金币', state.gold],
      ['步数', state.steps],
    ];
    for (const [k, v] of rows) {
      const row = document.createElement('div');
      row.className = 'stat';
      const key = document.createElement('span');
      key.className = 'stat-k';
      key.textContent = k;
      const val = document.createElement('span');
      val.className = 'stat-v';
      val.textContent = String(v);
      row.appendChild(key);
      row.appendChild(val);
      hudEl.appendChild(row);
    }

    // 装备：剑和盾各 5 档，只显示当前最高档
    if (gearEl) {
      gearEl.innerHTML = '';
      const lines = [
        { icon: '⚔️', slot: state.gear && state.gear.weapon },
        { icon: '🛡️', slot: state.gear && state.gear.armor },
      ];
      for (const line of lines) {
        const el = document.createElement('div');
        el.className = 'gear-item';

        const icon = document.createElement('span');
        icon.className = 'gear-icon';
        icon.textContent = line.icon;

        const name = document.createElement('span');
        name.className = 'gear-name';
        name.textContent = line.slot
          ? ((ITEMS[line.slot.id] && ITEMS[line.slot.id].name) || '未知装备')
          : '未装备';

        const dots = document.createElement('span');
        dots.className = 'gear-dots';
        for (let i = 1; i <= 5; i++) {
          const dot = document.createElement('span');
          dot.className = 'dot' + (line.slot && i <= line.slot.tier ? ' on' : '');
          dots.appendChild(dot);
        }

        el.appendChild(icon);
        el.appendChild(name);
        el.appendChild(dots);
        gearEl.appendChild(el);
      }
    }

    // 钥匙
    keysEl.innerHTML = '';
    for (const color of ['yellow', 'blue', 'red']) {
      const item = ITEMS[`key_${color}`];
      const el = document.createElement('div');
      el.className = 'key-item';
      el.title = item.name;

      const icon = document.createElement('span');
      icon.className = 'key-icon';
      icon.innerHTML = keySvgHtml(color);
      const name = document.createElement('span');
      name.className = 'key-name';
      name.textContent = item.short;
      const count = document.createElement('span');
      count.className = 'key-count';
      count.textContent = `×${state.keys[color] || 0}`;

      el.appendChild(icon);
      el.appendChild(name);
      el.appendChild(count);
      keysEl.appendChild(el);
    }

    // 背包
    bagEl.innerHTML = '';
    const entries = bagEntries(state);
    if (!entries.length) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = '空空如也';
      bagEl.appendChild(empty);
      return;
    }

    for (const entry of entries) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bag-item';
      btn.title = entry.item.desc || '';

      const slot = document.createElement('span');
      slot.className = 'slot';
      slot.textContent = String(entry.slot);
      const icon = document.createElement('span');
      icon.className = 'bag-icon';
      icon.textContent = entry.item.icon;
      const name = document.createElement('span');
      name.className = 'bag-name';
      name.textContent = entry.item.name;
      const count = document.createElement('span');
      count.className = 'bag-count';
      count.textContent = `×${entry.count}`;

      btn.appendChild(slot);
      btn.appendChild(icon);
      btn.appendChild(name);
      btn.appendChild(count);
      btn.addEventListener('click', () => {
        if (onUseItem) onUseItem(entry.id);
      });
      bagEl.appendChild(btn);
    }
  }

  return {
    render,
    setUseItemHandler(fn) { onUseItem = fn; },
  };
}
