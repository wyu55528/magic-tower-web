import { ITEMS } from '../data/items.js';

/**
 * 商店界面。渲染进 overlay 面板，点击购买 / 按数字键购买。
 *
 * 货架上就三样：加血、加攻、加防。每样东西买一次加固定的数，
 * 越高层加得越多；每家商店自己一套价目表，在同一家店里连买同一项就越来越贵。
 * 没有库存限制，也没有"买来存着以后再用"这一说 —— 买下当场生效。
 */
/** 这一项买一次能加多少，写成一句人话 */
function effectText(item, amount) {
  if (item.type === 'heal') return `生命 +${amount}`;
  if (item.line === 'atk') return `攻击 +${amount}（永久）`;
  if (item.line === 'def') return `防御 +${amount}（永久）`;
  return item.desc;
}

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
    btn.disabled = state.gold < entry.price;
    btn.innerHTML =
      `<span class="slot">${index + 1}</span>` +
      `<span class="bag-icon">${item.icon}</span>` +
      `<span class="shop-name">${item.name}</span>` +
      `<span class="shop-desc">${effectText(item, entry.amount)}</span>` +
      `<span class="shop-next">再买一次 ${entry.next} 金</span>` +
      `<span class="shop-price">${entry.price} 金</span>`;

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
