/* 质检平台前端逻辑 */
'use strict';

const $ = (id) => document.getElementById(id);

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 2200);
}

// 登录态存浏览器 localStorage，随请求头发给后端（不落盘）
const AUTH_KEY = 'la_auth';
function getAuth() {
  try { const raw = localStorage.getItem(AUTH_KEY); if (raw) return JSON.parse(raw); } catch (e) {}
  return {};
}
function setAuth(token, user) {
  try { localStorage.setItem(AUTH_KEY, JSON.stringify({ token: token, user: user })); } catch (e) {}
}
function clearAuth() {
  try { localStorage.removeItem(AUTH_KEY); } catch (e) {}
}

async function api(path, options) {
  const opts = Object.assign({ headers: {} }, options || {});
  if (opts.body && typeof opts.body === 'object') {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  const auth = getAuth();
  if (auth.token) opts.headers['Authorization'] = 'Bearer ' + auth.token;
  if (auth.user && auth.user.id) opts.headers['X-User-Id'] = auth.user.id;
  if (auth.user && auth.user.role) opts.headers['X-User-Role'] = auth.user.role;
  const r = await fetch(path, opts);
  const ct = r.headers.get('Content-Type') || '';
  if (ct.includes('application/json')) return await r.json();
  return r;
}

/* ============ 状态 ============ */
const state = {
  setup: [],
  projectId: null,
  tab: 'pending',
  browseOffset: 0,
  submitted: new Set(),
  categories: [],
  user: null,
};

// 记住上次选择的项目
const PREFS_KEY = 'qc_prefs';
function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (p && typeof p === 'object') return p;
    }
  } catch (e) {}
  return {};
}
function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ projectId: state.projectId }));
  } catch (e) {}
}

// 大图编辑会话
let lightboxSession = null;   // { imageId, boxes, viewer, editable }
let activeCategory = null;    // 左侧当前选中的分类，用于新画框

function pid() { return state.projectId; }

function imageUrl(id) {
  return '/api/projects/' + encodeURIComponent(pid()) + '/image?image_id=' + encodeURIComponent(id);
}

/* ============ 大图编辑工具栏 ============ */
function renderCategoryButtons() {
  const wrap = $('lbCats');
  wrap.innerHTML = '';
  (state.categories || []).forEach((c) => {
    const b = document.createElement('button');
    b.className = 'cat-btn';
    b.textContent = c;
    b.onclick = () => clickCategory(c);
    wrap.appendChild(b);
  });
  highlightActiveCategory();
}

function highlightActiveCategory() {
  Array.from($('lbCats').querySelectorAll('.cat-btn')).forEach((b) =>
    b.classList.toggle('active', b.textContent === activeCategory));
}

function clickCategory(cat) {
  activeCategory = cat;
  highlightActiveCategory();
  if (!lightboxSession) return;
  const idx = lightboxSession.viewer.getSelected();
  if (idx >= 0 && lightboxSession.boxes[idx]) {
    lightboxSession.boxes[idx].category = cat;
    lightboxSession.viewer.redraw();
    lightboxSession.viewer.setSelected(-1);   // 改完一次取消选中
    toast('已修改分类为 ' + cat + '（未保存）');
  }
}

function deleteBoxAt(idx) {
  if (!lightboxSession || idx < 0 || !lightboxSession.boxes[idx]) return;
  lightboxSession.boxes.splice(idx, 1);
  lightboxSession.viewer.setSelected(-1);
  lightboxSession.viewer.redraw();
  toast('已删除框（未保存）');
}
/* ============ 登录 / 初始化 ============ */
function showLogin(msg) {
  $('loginView').classList.remove('hidden');
  $('appHeader').classList.add('hidden');
  $('appMain').classList.add('hidden');
  $('loginError').textContent = msg || '';
}
function showApp() {
  $('loginView').classList.add('hidden');
  $('appHeader').classList.remove('hidden');
  $('appMain').classList.remove('hidden');
}

async function doLogin() {
  const email = $('loginEmail').value.trim();
  const password = $('loginPassword').value;
  if (!email || !password) { $('loginError').textContent = '请输入邮箱和密码'; return; }
  const btn = $('loginBtn');
  btn.disabled = true;
  let r;
  try {
    r = await api('/api/login', { method: 'POST', body: { email, password } });
  } catch (e) {
    btn.disabled = false;
    $('loginError').textContent = '登录失败（网络或服务异常）';
    return;
  }
  btn.disabled = false;
  if (r && r.ok) {
    state.user = r.user || {};
    setAuth(r.token, r.user);
    $('qcUser').textContent = (state.user.display_name || state.user.email || '');
    await loadSetup();
  } else {
    $('loginError').textContent = (r && r.error) || '登录失败，请检查账号密码';
  }
}

async function doLogout() {
  await api('/api/logout', { method: 'POST' });
  clearAuth();
  location.href = '/';
}

async function loadSetup() {
  const s = await api('/api/qc/setup');
  if (!s || !s.ok) { toast('加载项目失败'); showLogin((s && s.error) || ''); return; }
  state.setup = s.projects || [];
  if (!state.setup.length) {
    showApp();
    $('qcGrid').innerHTML = '<div class="empty">该账号暂无质检权限的项目</div>';
    $('qcSubmit').disabled = true;
    return;
  }
  showApp();
  renderProjectSelect();
  startPendingPoll();
  startDailyPoll();
}

async function init() {
  const auth = getAuth();
  if (auth.token) {
    state.user = auth.user || {};
    $('qcUser').textContent = (state.user.display_name || state.user.email || '');
    await loadSetup();
  } else {
    showLogin('');
  }
}

function renderProjectSelect() {
  const sel = $('qcProject');
  sel.innerHTML = '';
  const prefs = loadPrefs();
  state.setup.forEach((p) => {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.name;
    sel.appendChild(o);
  });
  // 恢复上次选择的项目
  if (prefs.projectId && state.setup.some((p) => p.id === prefs.projectId)) {
    sel.value = prefs.projectId;
  }
  onProjectChange();
}

function onProjectChange() {
  state.projectId = $('qcProject').value;
  const p = state.setup.find((x) => x.id === state.projectId);
  state.categories = (p && p.categories) || [];
  state.browseOffset = 0;
  savePrefs();
  loadCounts();
  loadCurrentTab();
}

async function loadCounts() {
  $('qcCounts').textContent = '';
  $('badgePending').textContent = '';
  $('badgePassed').textContent = '';
  $('badgeRejected').textContent = '';
  if (!pid()) return;
  const r = await api('/api/qc/counts?pid=' + encodeURIComponent(pid()));
  if (!r || !r.ok) return;
  const c = r.counts || {};
  $('qcCounts').textContent = '共 ' + c.total + ' 条：作业中 ' + c.annotating;
  $('badgePending').textContent = c.pending;
  $('badgePassed').textContent = c.passed;
  $('badgeRejected').textContent = c.rejected;
}

/* ============ 页签 ============ */
function switchTab(tab) {
  state.tab = tab;
  state.browseOffset = 0;
  closeLightbox();
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('pendingPanel').classList.toggle('hidden', tab !== 'pending');
  $('browsePanel').classList.toggle('hidden', tab !== 'passed' && tab !== 'rejected');
  $('recentPanel').classList.toggle('hidden', tab !== 'recent');
  if (tab !== 'pending') $('qcSubmit').disabled = true;
  if (tab === 'pending') startPendingPoll();
  else stopPendingPoll();
  loadCurrentTab();
}

function loadCurrentTab() {
  if (state.tab === 'pending') loadPending();
  else if (state.tab === 'recent') loadRecent();
  else loadBrowse(state.tab);
}

/* ============ 未质检工作区 ============ */
async function loadPending() {
  $('qcSubmit').disabled = true;
  if (!pid()) return;
  const grid = $('qcGrid');
  // 网格为空（初次/切回）时显示「加载中」；已有旧图时保持不动，避免提交后「黑屏/加载中」闪烁
  if (!grid.children.length) {
    grid.innerHTML = '<div class="empty">加载中…</div>';
  }
  // 循环翻页：后端返回的 pending 里可能混有「已提交但快照滞后的图」，过滤后若不足 4 张则继续取下一页。
  // 一次多取一组（共 8 张）：前 4 张显示，后 4 张提前预加载，提交后秒开。
  const ids = [];
  let offset = 0;
  while (ids.length < 8 && offset < 200) {
    const r = await api('/api/qc/assigned?pid=' + encodeURIComponent(pid()) + '&status=pending&offset=' + offset + '&limit=4');
    const items = ((r && r.items) || []).filter((id) => !state.submitted.has(id));
    ids.push(...items);
    if (!(r && r.items && r.items.length)) break;          // 没有更多了
    if (r.total <= offset + (r.items ? r.items.length : 0)) break;  // 已到末尾
    offset += 4;
  }
  grid.innerHTML = '';
  if (!ids.length) {
    grid.innerHTML = '<div class="empty">该质检员暂无未质检图</div>';
    return;
  }
  ids.slice(0, 4).forEach((id) => makeCell(id));
  // 预加载下一组图片（图片不可变，会命中代理/浏览器缓存）
  ids.slice(4, 8).forEach((id) => prefetchImage(id));
  $('qcSubmit').disabled = false;
}

function prefetchImage(id) {
  const img = new Image();
  img.src = imageUrl(id);
}

/* ============ 待质检自动轮询：每 10s 检测作业员重新提交的新图 ============ */
let _pendingPollTimer = null;
let _polling = false;

function startPendingPoll() {
  stopPendingPoll();
  _pendingPollTimer = setInterval(pollPending, 10000);
}

function stopPendingPoll() {
  if (_pendingPollTimer) { clearInterval(_pendingPollTimer); _pendingPollTimer = null; }
}

async function pollPending() {
  if (_polling) return;  // 上一次还没返回，跳过
  if (state.tab !== 'pending') return;
  if (!$('lightbox').classList.contains('hidden')) return;  // 大图编辑时不动
  if (!pid()) return;
  // 只有当前一张图都没显示（提交完后的空闲状态）才允许轮询自动刷新，
  // 避免正在看四张图时被打断、打乱质检节奏
  if ($('qcGrid').querySelectorAll('.cell').length) return;
  _polling = true;
  try {
    const r = await api('/api/qc/assigned?pid=' + encodeURIComponent(pid()) + '&status=pending&offset=0&limit=8');
    if (!r || !r.ok) return;
    const fresh = ((r.items) || []).filter((id) => !state.submitted.has(id));
    if (fresh.length) {
      loadPending();
    }
  } finally {
    _polling = false;
  }
}

/* ============ 每日质检量（本人，10s 轮询） ============ */
let _dailyTimer = null;

function startDailyPoll() {
  loadDailyStats();
  if (_dailyTimer) return;
  _dailyTimer = setInterval(loadDailyStats, 10000);
}

function loadDailyStats() {
  const el = $('qcDailyStats');
  if (!el) return;
  api('/api/my_daily_stats').then((res) => {
    if (res && res.ok) {
      el.innerHTML = formatDailyStats('质检量', res.qc_days);
      el.classList.toggle('hidden', !el.innerHTML);
    } else {
      el.innerHTML = ''; el.classList.add('hidden');
    }
  }).catch(() => {});
}

function formatDailyStats(title, days) {
  if (!days || !days.length) return '';
  const today = days[0].date;
  return '<span class="ds-title">' + title + '</span>' + days.map((d) => {
    const label = d.date === today ? '今天' : d.date.slice(5);
    return '<span class="ds-item"><span class="ds-day">' + label + '</span><span class="ds-num">' + d.count + '</span></span>';
  }).join('');
}

function flipVerdict(btn) {
  if (btn.dataset.verdict === 'pass') {
    btn.dataset.verdict = 'reject';
    btn.textContent = '打回';
    btn.classList.remove('pass');
    btn.classList.add('reject');
  } else {
    btn.dataset.verdict = 'pass';
    btn.textContent = '通过';
    btn.classList.remove('reject');
    btn.classList.add('pass');
  }
}

function makeCell(id) {
  const cell = document.createElement('div');
  cell.className = 'cell';
  cell.dataset.id = id;

  const viewerWrap = document.createElement('div');
  viewerWrap.className = 'cell-viewer';
  cell.appendChild(viewerWrap);

  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'verdict-btn pass';
  toggleBtn.dataset.verdict = 'pass';
  toggleBtn.textContent = '通过';
  toggleBtn.onclick = (e) => {
    e.stopPropagation();
    flipVerdict(toggleBtn);
  };
  viewerWrap.appendChild(toggleBtn);

  $('qcGrid').appendChild(cell);

  // 先建查看器立即加载图片，标注框异步返回后再填充，避免图片等待标注接口
  const boxesArr = [];
  const viewer = createViewer(viewerWrap, imageUrl(id), boxesArr, {
    onOpen: () => openLightbox(id, boxesArr, 'pending'),
    zoomable: true
  });
  api('/api/projects/' + encodeURIComponent(pid()) + '/annotation?image_id=' + encodeURIComponent(id))
    .then((ann) => {
      boxesArr.length = 0;
      ((ann && ann.boxes) || []).forEach((b) => boxesArr.push(b));
      viewer.redraw();
    })
    .catch(() => { /* 图片已显示，标注拉取失败时保持无框 */ });
}

async function submit() {
  if ($('qcSubmit').disabled) return;   // 正在提交/无图时忽略重复触发
  const cells = Array.from($('qcGrid').querySelectorAll('.cell'));
  if (!cells.length) return;
  const verdicts = cells.map((c) => ({
    image_id: c.dataset.id,
    verdict: c.querySelector('.verdict-btn').dataset.verdict,
  }));
  $('qcSubmit').disabled = true;
  let r;
  try {
    r = await api('/api/qc/submit', { method: 'POST', body: { pid: pid(), verdicts } });
  } catch (e) {
    toast('提交失败（网络或服务异常）');
    $('qcSubmit').disabled = false;
    return;
  }
  if (r && r.ok) {
    verdicts.forEach((v) => {
      // 只记「通过」的图：打回的图由后端 _reconcile_rejected 实时复核，
      // 作业员重新提交后能立刻回到待质检；若把打回的也记进来会被永久过滤掉。
      if (v.verdict === 'pass') {
        state.submitted.add(v.image_id);
        if (state.submitted.size > 500) { const it = state.submitted.values().next().value; state.submitted.delete(it); }
      }
    });
    const failN = (r.failed && r.failed.length) || 0;
    toast('提交成功 ' + r.succeeded + ' 张' + (failN ? '，失败 ' + failN + ' 张' : ''));
    loadCounts();
    loadPending();
  } else {
    toast((r && r.error) || '提交失败');
    $('qcSubmit').disabled = false;
  }
}

/* ============ 已通过 / 已打回 浏览 ============ */
async function loadBrowse(status) {
  const grid = $('browseGrid');
  if (state.browseOffset === 0) grid.innerHTML = '<div class="empty">加载中…</div>';
  const r = await api('/api/qc/assigned?pid=' + encodeURIComponent(pid()) + '&status=' + status + '&offset=' + state.browseOffset + '&limit=20');
  if (state.browseOffset === 0) grid.innerHTML = '';
  const items = (r && r.items) || [];
  if (!items.length && state.browseOffset === 0) {
    grid.innerHTML = '<div class="empty">暂无数据</div>';
  }
  items.forEach((id) => makeBrowseCell(id));
  state.browseOffset += items.length;
  $('qcMore').style.display = (r && r.total > state.browseOffset) ? '' : 'none';
}

function makeBrowseCell(id) {
  const cell = document.createElement('div');
  cell.className = 'cell';
  cell.dataset.id = id;
  const viewerWrap = document.createElement('div');
  viewerWrap.className = 'cell-viewer';
  cell.appendChild(viewerWrap);
  $('browseGrid').appendChild(cell);
  const boxesArr = [];
  const viewer = createViewer(viewerWrap, imageUrl(id), boxesArr, {
    onOpen: () => openLightbox(id, boxesArr, state.tab),
    zoomable: false
  });
  api('/api/projects/' + encodeURIComponent(pid()) + '/annotation?image_id=' + encodeURIComponent(id))
    .then((ann) => {
      boxesArr.length = 0;
      ((ann && ann.boxes) || []).forEach((b) => boxesArr.push(b));
      viewer.redraw();
    })
    .catch(() => { /* 图片已显示，标注拉取失败时保持无框 */ });
}

/* ============ 最近提交（找回误通过） ============ */
async function loadRecent() {
  const grid = $('recentGrid');
  grid.innerHTML = '<div class="empty">加载中…</div>';
  if (!pid()) return;
  const r = await api('/api/qc/recent?pid=' + encodeURIComponent(pid()));
  grid.innerHTML = '';
  const items = (r && r.items) || [];
  if (!items.length) {
    grid.innerHTML = '<div class="empty">暂无最近提交</div>';
    return;
  }
  items.forEach((id) => makeRecentCell(id));
}

function makeRecentCell(id) {
  const cell = document.createElement('div');
  cell.className = 'cell';
  cell.dataset.id = id;

  const viewerWrap = document.createElement('div');
  viewerWrap.className = 'cell-viewer';
  cell.appendChild(viewerWrap);

  const rejectBtn = document.createElement('button');
  rejectBtn.className = 'verdict-btn reject';
  rejectBtn.textContent = '打回';
  rejectBtn.onclick = (e) => {
    e.stopPropagation();
    rejectRecent(id, rejectBtn);
  };
  viewerWrap.appendChild(rejectBtn);

  $('recentGrid').appendChild(cell);

  const boxesArr = [];
  const viewer = createViewer(viewerWrap, imageUrl(id), boxesArr, {
    onOpen: () => openLightbox(id, boxesArr, 'recent'),
    zoomable: false
  });
  api('/api/projects/' + encodeURIComponent(pid()) + '/annotation?image_id=' + encodeURIComponent(id))
    .then((ann) => {
      boxesArr.length = 0;
      ((ann && ann.boxes) || []).forEach((b) => boxesArr.push(b));
      viewer.redraw();
    })
    .catch(() => { /* 图片已显示，标注拉取失败时保持无框 */ });
}

async function rejectRecent(id, btn) {
  btn.disabled = true;
  const r = await api('/api/qc/submit', { method: 'POST', body: { pid: pid(), verdicts: [{ image_id: id, verdict: 'reject' }] } });
  btn.disabled = false;
  if (r && r.ok && r.succeeded > 0) {
    toast('已打回');
    loadCounts();
    loadRecent();
  } else {
    toast((r && r.error) || '打回失败');
  }
}

/* ============ 大图 ============ */
function closeLightbox() {
  $('lightbox').classList.add('hidden');
  $('lightboxSidebar').classList.add('hidden');
  $('lightboxFloat').classList.add('hidden');
  lightboxSession = null;
}

function openLightbox(id, boxes, source) {
  const editable = (source === 'pending' || source === 'rejected');
  $('lightbox').classList.remove('hidden');
  const v = $('lightboxViewer');
  v.innerHTML = '';
  if (editable) {
    $('lightboxSidebar').classList.remove('hidden');
    $('lightboxFloat').classList.remove('hidden');
    renderCategoryButtons();
    if (!activeCategory) activeCategory = (state.categories && state.categories[0]) || null;
    highlightActiveCategory();
    $('editSave').disabled = false;
    toast('左键拖动画框 · 右键拖动平移 · 单击选中 · 双击删除 · C保存');
  } else {
    $('lightboxSidebar').classList.add('hidden');
    $('lightboxFloat').classList.add('hidden');
  }

  const viewer = createViewer(v, imageUrl(id), boxes, {
    editable: editable,
    onOpen: () => closeLightbox(),
    onBoxDrawn: (bbox) => {
      const cat = activeCategory || (state.categories && state.categories[0]);
      if (!cat) { toast('请先在左侧选择属性'); return; }
      boxes.push({ category: cat, bbox, source: 'manual' });
      viewer.redraw();
      viewer.setSelected(-1);            // 每画完一个取消选中
      toast('已添加框（未保存）');
    },
    onDelete: deleteBoxAt,
  });
  lightboxSession = { imageId: id, boxes: boxes, viewer: viewer, source: source, editable: editable };

  // 照片名放在查看器内部左上角（矢量，不随缩放）
  const name = document.createElement('div');
  name.className = 'photo-name';
  name.textContent = id;
  viewer.el.appendChild(name);
}

/* ============ 大图工具栏事件 ============ */
$('lightboxClose').onclick = () => closeLightbox();

async function saveLightbox() {
  if (!lightboxSession) return;
  const { imageId, boxes, source } = lightboxSession;
  const r = await api('/api/qc/save', { method: 'POST', body: { pid: pid(), image_id: imageId, boxes } });
  if (!r || !r.ok) {
    toast((r && r.error) || '保存失败');
    return;
  }
  if (source === 'pending') {
    const p = await api('/api/qc/submit', { method: 'POST', body: { pid: pid(), verdicts: [{ image_id: imageId, verdict: 'pass' }] } });
    if (!p || !p.ok || p.succeeded < 1) {
      toast('框已保存，但质检通过失败，请重试');
      return;   // 不关闭大图，允许重试
    }
    toast('已保存并质检通过');
  } else {
    toast('已保存 ' + r.box_count + ' 框');
  }
  closeLightbox();
  state.browseOffset = 0;   // 重置分页，强制已通过/已打回列表重新加载
  loadCounts();
  loadCurrentTab();
}

$('editSave').onclick = saveLightbox;

/* ============ 大图快捷键 ============ */
document.addEventListener('keydown', (e) => {
  if ($('lightbox').classList.contains('hidden')) return;
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (lightboxSession) deleteBoxAt(lightboxSession.viewer.getSelected());
    e.preventDefault();
  } else if ((e.key || '').toLowerCase() === 'c') {
    saveLightbox();
    e.preventDefault();
  } else if (e.key === 'Escape') {
    closeLightbox();
    e.preventDefault();
  }
});

/* ============ 快捷键 ============ */
const DEFAULT_SHORTCUTS = { toggle: ['1', '2', '3', '4'], submit: 'c' };
let shortcuts = loadShortcuts();

function loadShortcuts() {
  try {
    const raw = localStorage.getItem('qc_shortcuts');
    if (raw) {
      const s = JSON.parse(raw);
      if (s && Array.isArray(s.toggle) && s.toggle.length === 4 && s.submit) return s;
    }
  } catch (e) {}
  return JSON.parse(JSON.stringify(DEFAULT_SHORTCUTS));
}
function saveShortcuts() {
  try { localStorage.setItem('qc_shortcuts', JSON.stringify(shortcuts)); } catch (e) {}
}
function normKey(key) { return (key || '').length === 1 ? key.toLowerCase() : key; }
function keyLabel(e) {
  if (e.key === ' ') return 'Space';
  if (e.key === 'Escape') return null;
  if (e.key.length === 1) return e.key.toLowerCase();
  return e.key;
}

document.addEventListener('keydown', (e) => {
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (!$('settings').classList.contains('hidden')) return;   // 设置框打开时忽略
  if (!$('lightbox').classList.contains('hidden')) return;   // 大图打开时忽略
  if (state.tab !== 'pending') return;
  const k = normKey(e.key);
  const idx = shortcuts.toggle.map(normKey).indexOf(k);
  if (idx >= 0) {
    const cells = Array.from($('qcGrid').querySelectorAll('.cell'));
    const btn = cells[idx] && cells[idx].querySelector('.verdict-btn');
    if (btn) { flipVerdict(btn); e.preventDefault(); }
  } else if (k === normKey(shortcuts.submit)) {
    submit();
    e.preventDefault();
  }
});

/* ============ 快捷键设置 ============ */
function openSettings() {
  $('key1').value = shortcuts.toggle[0];
  $('key2').value = shortcuts.toggle[1];
  $('key3').value = shortcuts.toggle[2];
  $('key4').value = shortcuts.toggle[3];
  $('keySubmit').value = shortcuts.submit;
  $('settings').classList.remove('hidden');
}
function closeSettings() {
  $('settings').classList.add('hidden');
}
function bindKeyInput(el) {
  el.addEventListener('keydown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const lbl = keyLabel(e);
    if (lbl) el.value = lbl;
    el.blur();
  });
}
['key1', 'key2', 'key3', 'key4', 'keySubmit'].forEach((id) => bindKeyInput($(id)));

$('qcSettings').onclick = openSettings;
$('settingsClose').onclick = closeSettings;
$('settings').onclick = (e) => { if (e.target === $('settings')) closeSettings(); };
$('settingsSave').onclick = () => {
  const toggles = [$('key1').value, $('key2').value, $('key3').value, $('key4').value];
  const submitKey = $('keySubmit').value;
  if (toggles.some((t) => !t) || !submitKey) { toast('快捷键不能为空'); return; }
  shortcuts.toggle = toggles;
  shortcuts.submit = submitKey;
  saveShortcuts();
  closeSettings();
  toast('快捷键已保存');
};
$('settingsReset').onclick = () => {
  shortcuts = JSON.parse(JSON.stringify(DEFAULT_SHORTCUTS));
  saveShortcuts();
  openSettings();
  toast('已恢复默认快捷键');
};

/* ============ 事件绑定 ============ */
$('loginBtn').onclick = doLogin;
$('loginPassword').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
$('qcLogout').onclick = doLogout;
$('qcProject').onchange = onProjectChange;
$('qcSubmit').onclick = submit;
$('qcMore').onclick = () => loadBrowse(state.tab);
document.querySelectorAll('.tab').forEach((b) => { b.onclick = () => switchTab(b.dataset.tab); });

init();
