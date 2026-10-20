/* SPDX-License-Identifier: MIT
 * Shared counts are durable; local storage holds this browser's random secret,
 * pending desired state and last confirmed server response only.
 */
(() => {
  'use strict';
  const root = document.querySelector('[data-home-engagement]');
  if (!root || root.dataset.initialized === 'true') return;
  root.dataset.initialized = 'true';
  const key = 'experitome.home.shared.v1';
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const views = root.querySelector('[data-views]');
  const likes = root.querySelector('[data-likes]');
  const button = root.querySelector('[data-like-button]');
  const label = root.querySelector('[data-like-label]');
  const disclosure = root.querySelector('[data-disclosure]');
  const status = root.querySelector('[data-counter-status]');
  const formatter = new Intl.NumberFormat('zh-CN');
  let saved = {}, state = null, persistent = true, busy = false, initializing = true, sequence = 0, applied = 0;
  const validCount = n => Number.isSafeInteger(n) && n >= 0;
  const validState = x => x && validCount(x.views) && validCount(x.likes)
    && typeof x.liked === 'boolean' && validCount(x.revision);
  try {
    saved = JSON.parse(window.localStorage.getItem(key) || '{}');
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) saved = {};
  } catch (_) { saved = {}; }
  try {
    if (!uuid.test(saved.visitorId || '')) saved = { visitorId: crypto.randomUUID(), revision: 0 };
    window.localStorage.setItem(key, JSON.stringify(saved));
  } catch (_) { persistent = false; saved = {}; }
  if (validState(saved.cache)) state = saved.cache;
  if (!(saved.pending && typeof saved.pending.liked === 'boolean'
    && Number.isSafeInteger(saved.pending.revision) && saved.pending.revision > 0)) delete saved.pending;

  function save() {
    if (!persistent) return;
    try { window.localStorage.setItem(key, JSON.stringify(saved)); }
    catch (_) { persistent = false; }
  }
  function message(text = '') {
    if (!status) return;
    status.textContent = text; status.hidden = !text;
  }
  function render() {
    views.textContent = state ? formatter.format(state.views) : '—';
    likes.textContent = state ? formatter.format(state.likes) : '—';
    button.disabled = initializing || busy || !persistent;
    button.setAttribute('aria-busy', String(busy));
    button.setAttribute('aria-pressed', String(Boolean(state?.liked)));
    button.setAttribute('aria-label', busy ? '正在保存' : saved.pending ? '重试保存点赞' : state?.liked ? '取消点赞' : '点赞');
    label.textContent = busy ? '保存中' : saved.pending ? '重试' : state?.liked ? '已点赞' : '点赞';
    if (disclosure) disclosure.textContent = '所有访客共享新增浏览与点赞；同一浏览器每天访问计一次。显示值含历史初始基数，口径见About。';
  }
  async function request(action, extra = {}) {
    const ticket = ++sequence;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const options = { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal };
      if (persistent) Object.assign(options, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, visitorId: saved.visitorId, ...extra }) });
      const response = await fetch(root.dataset.counterApi, options);
      if (!response.ok) throw Error('request_failed');
      const data = await response.json();
      if (!validState(data)) throw Error('invalid_response');
      if (ticket < applied) return;
      applied = ticket; state = data;
      if (saved.pending && data.revision >= saved.pending.revision) delete saved.pending;
      saved.cache = data; saved.revision = Math.max(saved.revision || 0, data.revision); save();
      root.dataset.syncStatus = 'live';
      message(!persistent ? '浏览器未允许保存，暂不能点赞。' : saved.pending ? '上次操作尚未同步，点击重试。' : '');
    } finally { clearTimeout(timeout); }
  }
  async function refresh(action = 'read') {
    if (busy) return;
    try { await request(action); }
    catch (_) { root.dataset.syncStatus = state ? 'cached' : 'offline'; message('计数暂未连接，稍后重试。'); }
    render();
  }
  button.addEventListener('click', async () => {
    if (busy || !persistent) return;
    if (!state) { await refresh(); return; }
    busy = true;
    saved.pending ||= { liked: !state.liked, revision: Math.max(Date.now(), (saved.revision || 0) + 1, state.revision + 1) };
    save(); render();
    try { await request('like', saved.pending); }
    catch (_) { root.dataset.syncStatus = 'cached'; message('暂未保存，点击重试。'); }
    finally { busy = false; render(); }
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'hidden') return refresh(); });
  window.addEventListener('storage', event => {
    if (event.key !== key || !event.newValue || busy) return;
    try { const next = JSON.parse(event.newValue); if (validState(next.cache) && next.cache.revision > (state?.revision || 0)) return refresh(); }
    catch (_) { /* Ignore malformed browser cache, not a failed server write. */ }
  });
  setInterval(() => { if (document.visibilityState !== 'hidden') return refresh(); }, 60000);
  render();
  root.engagementReady = refresh(persistent ? 'visit' : 'read').finally(() => { initializing = false; render(); });
})();
