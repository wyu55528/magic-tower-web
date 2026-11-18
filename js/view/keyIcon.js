/**
 * 钥匙图标。
 *
 * 以前地图上的三把钥匙画的都是同一个 🔑 emoji，玩家根本分不出手上这把
 * 是黄钥匙还是蓝钥匙。现在统一成钥匙形状的矢量图，颜色直接取门用的
 * 同一组色值（--lock-yellow / --lock-blue / --lock-red），
 * 钥匙颜色 = 门颜色，一眼就知道该去开哪扇门。
 */

const KEY_PATH = 'M12.65 10C11.83 7.67 9.61 6 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6c2.61 0 4.83-1.67 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z';

/** 三种锁色，和 CSS 里的 --lock-* 一一对应 */
export const LOCK_CLASS = {
  yellow: 'lock-yellow',
  blue: 'lock-blue',
  red: 'lock-red',
};

/**
 * 钥匙图标的 HTML 片段。
 * @param {string} lock 'yellow' | 'blue' | 'red'
 */
export function keySvgHtml(lock) {
  const cls = LOCK_CLASS[lock] || LOCK_CLASS.yellow;
  return '<svg class="key-svg ' + cls + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
    + '<path d="' + KEY_PATH + '" fill="currentColor"/></svg>';
}