import { STATE_VERSION } from '../core/state.js';

const SAVE_KEY = 'magic-tower-save-v1';

/**
 * 本地存档。state 是纯数据，直接 JSON 序列化即可，
 * 所以存档 / 读档不需要任何额外的状态转换代码。
 */
export function saveState(state) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      version: STATE_VERSION,
      savedAt: Date.now(),
      state,
    }));
    return true;
  } catch (err) {
    console.warn('保存失败', err);
    return false;
  }
}

export function loadState() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.version !== STATE_VERSION || !data.state) return null;
    return data.state;
  } catch (err) {
    console.warn('读取存档失败', err);
    return null;
  }
}

export function clearState() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch (err) {
    console.warn('清除存档失败', err);
  }
}

export function hasSave() {
  try {
    return !!localStorage.getItem(SAVE_KEY);
  } catch (err) {
    return false;
  }
}
