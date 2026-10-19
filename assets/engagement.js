/* SPDX-License-Identifier: MIT
 * Local-only homepage interactions. Demo seeds are always disclosed in the UI.
 * No requests, tracking endpoints or cross-visitor totals.
 */
(() => {
  'use strict';
  const root = document.querySelector('[data-home-engagement]');
  if (!root || root.dataset.initialized === 'true') return;
  root.dataset.initialized = 'true';
  const demo = root.dataset.engagementMode === 'demo';
  const count = value => Number.isSafeInteger(Number(value)) && Number(value) >= 0
    ? Math.min(Number(value), 1000000000) : 0;
  const baseViews = demo ? count(root.dataset.initialViews) : 0;
  const baseLikes = demo ? count(root.dataset.initialLikes) : 0;
  const key = 'experitome.home.' + (demo ? 'demo' : 'local') + '.v1';
  const sessionKey = key + '.visited';
  let state = {views: 0, liked: false};
  let persistent = true;
  const viewOutput = root.querySelector('[data-views]');
  const likeOutput = root.querySelector('[data-likes]');
  const button = root.querySelector('[data-like-button]');
  const label = root.querySelector('[data-like-label]');
  const disclosure = root.querySelector('[data-disclosure]');
  const formatter = new Intl.NumberFormat('zh-CN');

  function read() {
    if (!persistent) return;
    let raw;
    try {
      raw = window.localStorage.getItem(key);
    } catch (_) { persistent = false; return; }
    let saved;
    try { saved = JSON.parse(raw || 'null'); } catch (_) { saved = null; }
    state = saved && typeof saved === 'object'
      ? {views: count(saved.views), liked: saved.liked === true}
      : {views: 0, liked: false};
  }
  function save() {
    try { window.localStorage.setItem(key, JSON.stringify(state)); }
    catch (_) { persistent = false; }
  }
  function render() {
    viewOutput.textContent = formatter.format(baseViews + state.views);
    likeOutput.textContent = formatter.format(baseLikes + (state.liked ? 1 : 0));
    button.setAttribute('aria-pressed', String(state.liked));
    button.setAttribute('aria-label', state.liked ? '取消点赞' : '点赞');
    label.textContent = state.liked ? '已点赞' : '点赞';
    disclosure.textContent = demo
      ? (persistent ? '计数含初始展示值与本浏览器交互；不是全站访客统计。' : '计数含初始展示值；本次交互为临时状态。')
      : (persistent ? '本机浏览与点赞记录' : '本次浏览与点赞记录');
  }
  read();
  let visited = false;
  try { visited = window.sessionStorage.getItem(sessionKey) === '1'; }
  catch (_) { persistent = false; }
  if (!visited) {
    state.views = count(state.views + 1);
    save();
    try { window.sessionStorage.setItem(sessionKey, '1'); }
    catch (_) { persistent = false; }
  }
  render();
  button.addEventListener('click', () => {
    read();
    state.liked = !state.liked;
    save();
    render();
  });
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) { read(); render(); }
  });
})();
