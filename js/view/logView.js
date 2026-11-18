const MAX_LINES = 80;

export function createLogView(el) {
  function push(events) {
    for (const e of events) {
      const line = document.createElement('div');
      line.className = `log-line log-${e.kind || 'info'}`;
      line.textContent = e.text;
      el.appendChild(line);
    }
    while (el.children.length > MAX_LINES) el.removeChild(el.firstChild);
    el.scrollTop = el.scrollHeight;
  }

  function clear() {
    el.innerHTML = '';
  }

  return { push, clear };
}
