import { LEVELS, monsterIdsOnLevel } from '../data/levels.js';
import { MONSTERS } from '../data/monsters.js';
import { previewFight, verdictText } from '../core/battle.js';

/**
 * 怪物图鉴面板。
 *
 * 只列当前层出现的怪：本层的守关怪（末层还有魔王）。
 * 这一层没有怪就显示空状态，不列别层的怪，免得翻起来是一屏没用得上的数字。
 *
 * 表里给的是按玩家当前面板算出来的战斗结论
 * （不可战胜 / 无伤击杀 / 损失 XXX 点血量）。
 */
export function renderBook(overlay, state, onLeave) {
  overlay.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'overlay-card book-card';

  const floor = state.level + 1;
  const ids = monsterIdsOnLevel(state.level);

  const title = document.createElement('h2');
  title.textContent = `📖 怪物图鉴 · 第 ${floor} 层`;
  card.appendChild(title);

  const desc = document.createElement('p');
  desc.className = 'book-desc';
  desc.textContent =
    `当前面板：攻击 ${state.atk} / 防御 ${state.def} / 生命 ${state.hp}。` +
    '结论按这个面板算：塔里没有药水，打不赢就是打不赢。';
  card.appendChild(desc);

  if (!ids.length) {
    const empty = document.createElement('p');
    empty.className = 'book-empty';
    empty.textContent = `第 ${floor} 层没有怪物。这一层只有机关和路。`;
    card.appendChild(empty);
  } else {
    const scroll = document.createElement('div');
    scroll.className = 'book-scroll';

    const table = document.createElement('table');
    table.className = 'book-table';

    const thead = document.createElement('thead');
    const hr = document.createElement('tr');
    ['怪物', '血量', '攻击', '防御', '金币', '战斗结论'].forEach((h) => {
      const th = document.createElement('th');
      th.textContent = h;
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    const player = { hp: state.hp, maxHp: state.maxHp, atk: state.atk, def: state.def };

    ids.forEach((id) => {
      const mon = MONSTERS[id];
      if (!mon) return;
      const r = previewFight(player, mon);
      const tr = document.createElement('tr');
      if (id === 'demon_king') tr.className = 'book-here';

      const cells = [
        { text: (mon.icon ? mon.icon + ' ' : '') + mon.name, cls: 'book-name' },
        { text: mon.hp },
        { text: mon.atk },
        { text: mon.def },
        { text: mon.gold },
        { text: verdictText(r), cls: 'vd-' + r.verdict },
      ];
      cells.forEach((c) => {
        const td = document.createElement('td');
        if (c.cls) td.className = c.cls;
        td.textContent = String(c.text);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    scroll.appendChild(table);
    card.appendChild(scroll);
  }

  const leave = document.createElement('button');
  leave.type = 'button';
  leave.className = 'overlay-leave';
  leave.textContent = '合上图鉴（Esc）';
  leave.addEventListener('click', onLeave);
  card.appendChild(leave);

  overlay.appendChild(card);
}
