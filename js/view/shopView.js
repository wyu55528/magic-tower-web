import { ITEMS } from '../data/items.js';

/**
 * 商店界面。渲染进 overlay 面板，点击购买 / 按数字键购买。
 *
 * 货架上的东西买下当场生效：疗伤丹立刻回血，磨刀石 / 护心镜永久加攻加防。
 * 没有"买来存着以后再用"这一说 —— 加血只有即时性。
 */
export function renderShop(overlay, state, onBuy, onLeave) {
  overlay.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'overlay-card shop-card';

  const title = document.createElement('h2');
  title.textContent = '🛒 商人';
  card.appendChild(title);

  const gold = document.createElement('p');
  gold.textContent = `当前金币：${state.gold}`;
  card.appendChild(gold);

  const stock = (state.shop && state.shop.stock) || [];
  stock.forEach((entry, index) => {
    const item = ITEMS[entry.id];
    if (!item) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'shop-item';
    btn.disabled = entry.count <= 0 || state.gold < item.price;
    btn.innerHTML =
      `<span class="slot">${index + 1}</span>` +
      `<span class="bag-icon">${item.icon}</span>` +
      `<span class="shop-name">${item.name}</span>` +
      `<span class="shop-desc">${item.desc}</span>` +
      `<span class="shop-stock">×${entry.count}</span>` +
      `<span class="shop-price">${item.price} 金</span>`;

    btn.addEventListener('click', () => onBuy(entry.id));
    card.appendChild(btn);
  });

  const leave = document.createElement('button');
  leave.type = 'button';
  leave.className = 'overlay-leave';
  leave.textContent = '离开商店（Esc）';
  leave.addEventListener('click', onLeave);
  card.appendChild(leave);

  overlay.appendChild(card);
}
