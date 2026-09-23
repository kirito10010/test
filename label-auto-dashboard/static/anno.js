/* 作业平台（标注端）前端逻辑 */
'use strict';

const $ = (id) => document.getElementById(id);

const AUTH_KEY = 'la_auth';
function getAuth() {
  try { const raw = localStorage.getItem(AUTH_KEY); if (raw) return JSON.parse(raw); } catch (e) {}
  return {};
}
function clearAuth() {
  try { localStorage.removeItem(AUTH_KEY); } catch (e) {}
}
function logout() {
  clearAuth();
  location.href = '/';
}
let RELEASE = false;

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 2200);
}

async function api(path, options) {
  const opts = Object.assign({ headers: {} }, options || {});
  const isGet = !opts.method || opts.method === 'GET';
  if (isGet) {
    // 穿透缓存：浏览器侧不走缓存，URL 加时间戳让中间代理也拿不到旧响应
    opts.cache = 'no-store';
    path += (path.indexOf('?') >= 0 ? '&' : '?') + '_t=' + Date.now();
  }
  if (RELEASE) {
    const auth = getAuth();
    if (auth.token) opts.headers['Authorization'] = 'Bearer ' + auth.token;
    if (auth.user && auth.user.id) opts.headers['X-User-Id'] = auth.user.id;
    if (auth.user && auth.user.role) opts.headers['X-User-Role'] = auth.user.role;
  }
  if (opts.body && typeof opts.body === 'object') {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  const r = await fetch(path, opts);
  const ct = r.headers.get('Content-Type') || '';
  if (ct.includes('application/json')) return await r.json();
  return r;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const state = {
  setup: [],
  setupIds: '',        // 项目 id 集合签名：没变就不重建下拉（静默刷新用）
  projectId: null,
  uid: null,
  annotators: [],
  categories: [],
  status: 'unannotated',   // 'unannotated' | 'submitted' | 'rejected'
  activeCategory: null,
  shortcuts: { catKeys: {}, submit: 'c', hideLabels: 'shift+3' },
  currentImage: null,
  recentSubmits: [],
  hideLabels: false,
  search: '',
  qcFilter: '',
  qcOf: {},
  qcs: [],
};

let currentBoxes = [];
let currentViewer = null;
let imageToken = 0;   // 换图自增，丢弃过期的异步标注框结果，避免串图
let lastListSig = ''; // 上次列表签名，内容没变就只刷新徽标、不重建 DOM（10s 轮询用）

/* ============ 最近提交持久化（存浏览器 localStorage，按项目隔离） ============ */
const RECENT_KEY = 'anno_recent_submits';
function loadRecentSubmits() {
  try { const raw = localStorage.getItem(RECENT_KEY); if (raw) { const o = JSON.parse(raw); if (o && typeof o === 'object') return o; } } catch (e) {}
  return {};
}
function saveRecentSubmits(all) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(all)); } catch (e) {}
}
function loadProjectRecent(pid_) {
  const all = loadRecentSubmits();
  const cur = all[pid_];
  return (cur && Array.isArray(cur)) ? cur : [];
}
function saveProjectRecent(pid_, list) {
  const all = loadRecentSubmits();
  all[pid_] = list;
  saveRecentSubmits(all);
}
function recordRecentSubmit(imageId) {
  state.recentSubmits = [imageId, ...state.recentSubmits.filter((x) => x !== imageId)].slice(0, 300);
  saveProjectRecent(state.projectId, state.recentSubmits);
}

function pid() { return state.projectId; }
function uid() { return state.uid; }

function imageUrl(id) {
  return '/api/projects/' + encodeURIComponent(pid()) + '/image?image_id=' + encodeURIComponent(id);
}

function prefetchImage(id) {
  const img = new Image();
  img.src = imageUrl(id);
}

function isLocalHost() {
  return ['127.0.0.1', 'localhost', '::1'].indexOf(location.hostname) >= 0;
}

/* ============ 快捷键（按项目隔离，独立 localStorage） ============ */
const ANNO_KEY = 'anno_shortcuts';
const DEFAULT_KEYS = '1234567890qwertyuiopasdfghjklzxcvbnm'.split('');

function loadAnnoShortcuts() {
  try { const raw = localStorage.getItem(ANNO_KEY); if (raw) return JSON.parse(raw); } catch (e) {}
  return {};
}
function saveAnnoShortcuts(data) {
  try { localStorage.setItem(ANNO_KEY, JSON.stringify(data)); } catch (e) {}
}
function loadProjectShortcuts(pid_) {
  const all = loadAnnoShortcuts();
  const cur = (all[pid_] && all[pid_].catKeys) || {};
  const catKeys = {};
  state.categories.forEach((c, i) => {
    catKeys[c] = (cur[c] !== undefined && cur[c] !== null) ? cur[c] : (DEFAULT_KEYS[i] || '');
  });
  const submit = (all[pid_] && all[pid_].submit) || 'c';
  const hideLabels = (all[pid_] && all[pid_].hideLabels) || 'shift+3';
  state.shortcuts = { catKeys, submit, hideLabels };
}

/* ============ 自动刷新：每日标注量 + 徽标计数 + 列表（10s） ============ */
const POLL_MS = 10000;
let _pollTimer = null;
let _ticking = false;
let dailyToken = 0;

function startPoll() {
  if (_pollTimer) return;
  _pollTimer = setInterval(tick, POLL_MS);
}

/* 10s 心跳：数据坏了能自愈，不用手动刷新（页面不可见时跳过） */
async function tick() {
  if (_ticking || document.hidden) return;
  _ticking = true;
  try {
    loadDailyStats();
    await refresh({ silent: true });
    await refreshProjects();   // 每次心跳都与探针同步：新建项目/结构变化最坏 ~20s 就能看到
  } finally {
    _ticking = false;
  }
}

/* 静默刷新项目列表：管理员后台新建的项目，不用退应用/刷页面也能出现在下拉里。
   只在项目集合真的变了时重建下拉，并保留当前选中的项目，不打断正在做的事。 */
async function refreshProjects() {
  let s;
  try {
    s = await api('/api/anno/setup');
  } catch (e) {
    return;
  }
  if (!s || !s.ok) return;
  const list = s.projects || [];
  const ids = list.map((p) => p.id).join(',');
  if (ids === state.setupIds) return;            // 集合没变 → 什么都不做
  state.setupIds = ids;
  state.setup = list;
  const sel = $('annoProject');
  const keep = state.projectId;
  sel.innerHTML = '';
  list.forEach((p) => {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.name;
    sel.appendChild(o);
  });
  if (list.some((p) => p.id === keep)) {          // 当前项目还在 → 只多出新选项
    sel.value = keep;
    return;
  }
  if (list.length) {                              // 当前项目没了才切换
    onProjectChange();
    toast('项目列表已更新');
  }
}

function loadDailyStats() {
  const el = $('annoDailyStats');
  if (!el) return;
  if (!uid()) { el.innerHTML = ''; el.classList.add('hidden'); return; }
  const myToken = ++dailyToken;
  api('/api/daily_stats?uid=' + encodeURIComponent(uid())).then((res) => {
    if (myToken !== dailyToken) return;   // 已切作业员，丢弃过期结果
    if (res && res.ok && res.has_login) {
      el.innerHTML = formatDailyStats('标注量', res.annotated_days);
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

/* ============ 搜索 / 质检员筛选 / 归属显示 ============ */
function loadQcOwners() {
  state.qcOf = {};
  state.qcs = [];
  if (!pid() || !uid()) return;
  api('/api/anno/qc_owners?pid=' + encodeURIComponent(pid()) + '&uid=' + encodeURIComponent(uid())).then((r) => {
    if (!r || !r.ok) return;
    state.qcOf = r.qc_of || {};
    state.qcs = r.qcs || [];
    renderQcFilter();
  }).catch(() => {});
}

function renderQcFilter() {
  const sel = $('annoQcFilter');
  const cur = state.qcFilter;
  sel.innerHTML = '<option value="">全部质检员</option>';
  state.qcs.forEach((q) => {
    const o = document.createElement('option');
    o.value = q.uid;
    o.textContent = q.name;
    sel.appendChild(o);
  });
  if (cur && state.qcs.some((q) => q.uid === cur)) sel.value = cur;
  else state.qcFilter = '';
}

function applyFilters(items) {
  const kw = state.search.trim().toLowerCase();
  return items.filter((id) => {
    if (kw && id.toLowerCase().indexOf(kw) < 0) return false;
    if (state.qcFilter) {
      const q = state.qcOf[id];
      if (!q || q.uid !== state.qcFilter) return false;
    }
    return true;
  });
}

/* ============ 筛选重置（切项目/切作业员时调用） ============ */
function resetFilters() {
  state.search = '';
  state.qcFilter = '';
  $('annoSearch').value = '';
  renderQcFilter();          // 重建「全部质检员」下拉
  lastListSig = '';          // 强制重建列表
}

/* ============ 初始化 ============ */
async function init() {
  try {
    const c = await api('/api/config');
    RELEASE = !!(c && c.release);
  } catch (e) {}
  if (RELEASE) {
    if (!getAuth().token) { location.href = '/'; return; }
    applyReleaseUI();
  } else {
    const r = await api('/api/autologin');
    if (!r || !r.ok) { toast((r && r.error) || '自动登录失败'); return; }
  }
  const s = await api('/api/anno/setup');
  if (!s || !s.ok) { toast('加载项目失败'); return; }
  state.setup = s.projects || [];
  state.setupIds = state.setup.map((p) => p.id).join(',');
  renderProjectSelect();
  startPoll();
}

function applyReleaseUI() {
  // 发布版：去掉切换平台按钮，只留「退出」
  const linkQc = $('linkQc');
  const linkDashboard = $('linkDashboard');
  const linkLogout = $('linkLogout');
  if (linkQc) linkQc.classList.add('hidden');
  if (linkDashboard) linkDashboard.classList.add('hidden');
  if (linkLogout) linkLogout.classList.remove('hidden');
}

function renderProjectSelect() {
  const sel = $('annoProject');
  sel.innerHTML = '';
  const prefs = loadPrefs();
  state.setup.forEach((p) => {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.name;
    sel.appendChild(o);
  });
  if (prefs.projectId && state.setup.some((p) => p.id === prefs.projectId)) {
    sel.value = prefs.projectId;
  }
  onProjectChange();
}

function onProjectChange() {
  state.projectId = $('annoProject').value;
  const p = state.setup.find((x) => x.id === state.projectId);
  state.categories = (p && p.categories) || [];
  state.activeCategory = null;
  state.recentSubmits = loadProjectRecent(state.projectId);
  loadProjectShortcuts(state.projectId);
  renderCategoryButtons();
  resetFilters();   // 切项目必须清掉旧搜索/质检员筛选，否则新列表会被旧条件过滤成空
  renderAnnotatorSelect(p ? p.annotators : []);
  savePrefs();
}

function renderAnnotatorSelect(annotators) {
  const sel = $('annoReviewer');
  sel.innerHTML = '';
  const prefs = loadPrefs();
  state.annotators = annotators || [];
  // 发布版：非 admin 只有一个作业员（当前用户）时，隐藏「作业员」下拉
  const field = sel.closest('.anno-field');
  if (field) field.classList.toggle('hidden', RELEASE && annotators.length <= 1);
  annotators.forEach((a) => {
    const o = document.createElement('option');
    o.value = a.uid;
    o.textContent = a.name;
    sel.appendChild(o);
  });
  if (annotators.length) {
    if (prefs.reviewerUid && annotators.some((a) => a.uid === prefs.reviewerUid)) {
      sel.value = prefs.reviewerUid;
    }
    state.uid = sel.value;
    onAnnotatorChange();
  } else {
    state.uid = null;
    lastListSig = '';
    $('annoList').innerHTML = '<div class="empty">该项目暂无作业员</div>';
    clearViewer();
    clearCounts();
  }
}

function onAnnotatorChange() {
  state.uid = $('annoReviewer').value;
  state.currentImage = null;
  clearViewer();
  savePrefs();
  loadDailyStats();
  resetFilters();
  loadQcOwners();
  if (!RELEASE) {
    const a = state.annotators.find((x) => x.uid === state.uid);
    if (!isLocalHost() && a && !a.has_login) {
      probeLogin();
      return;
    }
  }
  $('annoLogin').classList.add('hidden');
  refresh({ autoSelect: true, force: true });   // 切作业员即强制取最新
}

/* ============ 登录门槛 ============ */
async function probeLogin() {
  let res;
  try {
    res = await api('/api/anno/assigned?pid=' + encodeURIComponent(pid()) + '&uid=' + encodeURIComponent(uid()) + '&status=' + state.status + '&offset=0&limit=1');
  } catch (e) {
    toast('加载失败（网络或服务异常）');
    return;
  }
  if (res && res.ok) {
    $('annoLogin').classList.add('hidden');
    refresh({ autoSelect: true, force: true });
  } else if (res && res.need_login) {
    lastListSig = '';
    $('annoList').innerHTML = '<div class="empty">该作业员需登录后查看</div>';
    openLogin(state.annotators.find((x) => x.uid === state.uid));
  }
}
function openLogin(a) {
  $('annoLoginName').textContent = a ? a.name : '';
  $('annoLoginEmail').value = '';
  $('annoLoginPassword').value = '';
  $('annoLogin').classList.remove('hidden');
}
function closeLogin() { $('annoLogin').classList.add('hidden'); }
async function submitLogin() {
  const email = $('annoLoginEmail').value.trim();
  const password = $('annoLoginPassword').value;
  if (!email || !password) { toast('请输入邮箱和密码'); return; }
  const btn = $('annoLoginOk');
  btn.disabled = true;
  let r;
  try {
    r = await api('/api/qc/reviewer_login', { method: 'POST', body: { uid: state.uid, email, password } });
  } catch (e) {
    btn.disabled = false; toast('登录失败（网络或服务异常）'); return;
  }
  btn.disabled = false;
  if (r && r.ok) {
    closeLogin(); toast('登录成功'); refresh({ autoSelect: true, force: true });
  } else {
    toast((r && r.error) || '登录失败，请检查账号密码');
  }
}

/* ============ 左侧属性按钮 ============ */
function renderCategoryButtons() {
  const wrap = $('annoCats');
  wrap.innerHTML = '';
  state.categories.forEach((c) => {
    const b = document.createElement('button');
    b.className = 'cat-btn';
    b.dataset.cat = c;
    const key = state.shortcuts.catKeys[c];
    b.innerHTML = esc(c) + (key ? '<span class="cat-key">' + esc(key) + '</span>' : '');
    b.onclick = () => setActiveCategory(c);
    wrap.appendChild(b);
  });
  highlightCategory();
}
function highlightCategory() {
  Array.from($('annoCats').querySelectorAll('.cat-btn')).forEach((b) => {
    b.classList.toggle('active', b.dataset.cat === state.activeCategory);
  });
}
function setActiveCategory(cat) {
  state.activeCategory = cat;
  highlightCategory();
  // 有选中的框时，点属性按钮 = 修改该框分类，然后取消选中
  if (currentViewer) {
    const idx = currentViewer.getSelected();
    if (idx >= 0 && currentBoxes[idx]) {
      currentBoxes[idx].category = cat;
      currentViewer.redraw();
      currentViewer.setSelected(-1);
      toast('已修改分类为 ' + cat + '（未保存）');
    }
  }
}

/* ============ 右侧列表 + 徽标计数（同一次请求，保证一致） ============ */
let listToken = 0;    // 切页签/项目/刷新时自增，丢弃过期的异步结果，避免竞态
let countsToken = 0;  // 单独的计数请求（登录探针、保存后）也需要令牌保护

function listUrl(force) {
  const q = ['pid=' + encodeURIComponent(pid()), 'uid=' + encodeURIComponent(uid()),
             'status=' + state.status, 'offset=0', 'limit=100000'];
  if (force) q.push('force=1');   // 打穿服务端内存缓存，取最新快照
  return '/api/anno/assigned?' + q.join('&');
}

/* 已提交：原始顺序反转显示，本次会话刚提交的提到最前 */
function orderItems(items) {
  if (state.status !== 'submitted') return items;
  const out = items.slice().reverse();
  if (!state.recentSubmits.length) return out;
  const recent = state.recentSubmits.filter((id) => out.indexOf(id) >= 0);
  const rest = out.filter((id) => recent.indexOf(id) < 0);
  return recent.concat(rest);
}

function renderCounts(c) {
  if (!c) return;
  $('annoCounts').textContent = '共 ' + c.total + ' 条：已提交 ' + c.submitted;
  $('badgeUnannotated').textContent = c.unannotated;
  $('badgeSubmitted').textContent = c.submitted;
  $('badgeRejected').textContent = c.rejected;
}

function clearCounts() {
  $('annoCounts').textContent = '';
  $('badgeUnannotated').textContent = '';
  $('badgeSubmitted').textContent = '';
  $('badgeRejected').textContent = '';
}

function showListError(msg) {
  lastListSig = '';
  $('annoList').innerHTML = '<div class="empty">' + esc(msg || '加载失败') + '</div>';
}

/* 列表内容签名：状态/筛选/每项及其框数都没变 → 只刷徽标，不重建 DOM */
function listSignature(items, boxCounts) {
  return [state.status, state.search, state.qcFilter, state.recentSubmits.slice(0, 20).join(','),
          items.map((id) => id + ':' + (boxCounts[id] || 0)).join(',')].join('|');
}

function rebuildList(items, boxCounts) {
  const listEl = $('annoList');
  listEl.innerHTML = '';
  if (!items.length) {
    listEl.innerHTML = '<div class="empty">' + statusEmptyText() + '</div>';
    return;
  }
  items.forEach((id) => makeListItem(id, (state.qcOf[id] || {}).name, boxCounts[id]));
  // 预加载前几张图片，减少切换时闪黑
  items.slice(0, 4).forEach((id) => prefetchImage(id));
}

/* 有弹窗时自动刷新不要打断用户 */
function uiBusy() {
  return !$('annoSettingsBox').classList.contains('hidden') ||
         !$('annoLogin').classList.contains('hidden');
}

async function refresh(opts) {
  opts = opts || {};
  if (!pid() || !uid()) return [];
  const myToken = ++listToken;
  if (!opts.silent && !$('annoList').children.length) {
    $('annoList').innerHTML = '<div class="empty">加载中…</div>';
  }
  let r;
  try {
    r = await api(listUrl(opts.force));
  } catch (e) {
    if (myToken === listToken && !opts.silent) showListError('网络异常，请点「刷新」重试');
    return [];
  }
  if (myToken !== listToken) return [];   // 期间又切了页签/项目，丢弃过期结果
  if (!r || !r.ok) {
    if (!opts.silent) showListError((r && r.error) || '加载失败');
    return [];
  }
  renderCounts(r.counts);   // 与列表同源，不会再出现「有计数、没数据」

  const boxCounts = r.box_counts || {};
  const items = orderItems(applyFilters(r.items || []));
  const sig = listSignature(items, boxCounts);
  if (sig === lastListSig) {
    if (opts.autoSelect && !state.currentImage && items.length) loadImage(items[0]);
    return items;
  }
  if (opts.silent && uiBusy()) return items;   // 只更徽标，列表等用户空闲再重建

  const prevScroll = $('annoList').scrollTop;
  rebuildList(items, boxCounts);
  lastListSig = sig;
  $('annoList').scrollTop = prevScroll;   // 保留滚动位置

  if (opts.autoSelect) {
    if (items.length) loadImage(items[0]);
    else clearViewer();
  } else if (items.indexOf(state.currentImage) >= 0) {
    highlightListItem(state.currentImage);
  }
  // 自动刷新不动当前图，避免丢掉正在画的框
  return items;
}

/* 单独的计数请求：登录探针与保存后使用（列表请求本身已带 counts） */
async function loadCounts() {
  if (!pid() || !uid()) return;
  const myToken = ++countsToken;
  let r;
  try {
    r = await api('/api/anno/counts?pid=' + encodeURIComponent(pid()) + '&uid=' + encodeURIComponent(uid()));
  } catch (e) {
    return;
  }
  if (myToken !== countsToken) return;   // 已切项目/作业员，丢弃过期结果
  if (!r || !r.ok) return;
  renderCounts(r.counts);
}

function switchStatus(status) {
  state.status = status;
  document.querySelectorAll('.anno-tab').forEach((b) => b.classList.toggle('active', b.dataset.status === status));
  lastListSig = '';
  refresh({ autoSelect: true });
}

/* 手动刷新：打穿服务端缓存，重新取最新 */
async function onManualRefresh() {
  if (!pid() || !uid()) return;
  const btn = $('annoRefresh');
  if (btn) btn.disabled = true;
  toast('正在刷新…');
  lastListSig = '';
  await refresh({ force: true });
  loadDailyStats();
  if (btn) btn.disabled = false;
  toast('已刷新');
}

function statusEmptyText() {
  if (state.status === 'unannotated') return '暂无未作业图';
  if (state.status === 'submitted') return '暂无已提交图';
  return '暂无被打回图';
}

/* ============ 数量统计（见上方 loadCounts：单独请求，列表请求自带 counts） ============ */

function makeListItem(id, qcName, boxCount) {
  const item = document.createElement('div');
  item.className = 'anno-item';
  item.dataset.id = id;

  // 第一行：文件名（超长缩略 + 悬浮显示全名）+ 框数 + 复制按钮
  const row1 = document.createElement('div');
  row1.className = 'anno-item-row';
  const nameEl = document.createElement('span');
  nameEl.className = 'anno-item-name';
  nameEl.textContent = id;
  nameEl.title = id;   // 鼠标悬浮显示完整文件名
  row1.appendChild(nameEl);
  if (boxCount != null) {
    const bc = document.createElement('span');
    bc.className = 'anno-box-count';
    bc.textContent = boxCount + ' 框';
    row1.appendChild(bc);
  }
  const copyBtn = document.createElement('button');
  copyBtn.className = 'anno-copy-btn';
  copyBtn.type = 'button';
  copyBtn.textContent = '复制';
  copyBtn.title = '复制文件名';
  copyBtn.onclick = (e) => {
    e.stopPropagation();
    copyTextToClipboard(id).then(() => toast('已复制文件名'));
  };
  row1.appendChild(copyBtn);
  item.appendChild(row1);

  // 第二行：质检人
  if (qcName) {
    const tag = document.createElement('div');
    tag.className = 'anno-qc-tag';
    tag.textContent = '质检：' + qcName;
    item.appendChild(tag);
  }

  item.onclick = () => loadImage(id);
  $('annoList').appendChild(item);
}

function highlightListItem(id) {
  Array.from($('annoList').querySelectorAll('.anno-item')).forEach((el) => {
    el.classList.toggle('active', el.dataset.id === id);
  });
}

/* ============ 中间照片 ============ */
function clearViewer() {
  imageToken++;   // 使在途的标注框加载失效
  const v = $('annoViewer');
  if (currentViewer) { currentViewer.destroy(); currentViewer = null; }
  v.innerHTML = '<div class="empty">请选择图片</div>';
  currentBoxes = [];
  state.currentImage = null;
}

function loadImage(id) {
  if (!id) return;
  const myToken = ++imageToken;
  state.currentImage = id;
  highlightListItem(id);
  const v = $('annoViewer');
  if (currentViewer) { currentViewer.destroy(); currentViewer = null; }
  v.innerHTML = '';
  currentBoxes = [];
  currentViewer = createViewer(v, imageUrl(id), currentBoxes, {
    editable: true,
    onBoxDrawn: (bbox) => {
      const cat = state.activeCategory || state.categories[0];
      if (!cat) { toast('请先在左侧选择属性'); return; }
      currentBoxes.push({ category: cat, bbox: bbox, source: 'manual' });
      currentViewer.redraw();
      currentViewer.setSelected(-1);
    },
    onDelete: (idx) => {
      currentBoxes.splice(idx, 1);
      currentViewer.setSelected(-1);
      currentViewer.redraw();
    },
  });
  currentViewer.setHideLabels(state.hideLabels);
  // 预加载下一张图片，避免切换时闪黑
  const allItems = Array.from($('annoList').querySelectorAll('.anno-item'));
  const curIdx = allItems.findIndex((el) => el.dataset.id === id);
  const nextItem = allItems[curIdx + 1];
  if (nextItem && nextItem.dataset.id) prefetchImage(nextItem.dataset.id);
  api('/api/projects/' + encodeURIComponent(pid()) + '/annotation?image_id=' + encodeURIComponent(id))
    .then((ann) => {
      if (myToken !== imageToken) return;   // 已切到别的图，丢弃过期结果
      currentBoxes.length = 0;
      ((ann && ann.boxes) || []).forEach((b) => currentBoxes.push(b));
      currentViewer.redraw();
    })
    .catch(() => {});
}

/* ============ 保存（提交） ============ */
async function save() {
  if (!state.currentImage) { toast('请先选择图片'); return; }
  const imageId = state.currentImage;
  const r = await api('/api/qc/save', { method: 'POST', body: { pid: pid(), image_id: imageId, boxes: currentBoxes } });
  if (!r || !r.ok) { toast((r && r.error) || '保存失败'); return; }
  toast('已保存 ' + r.box_count + ' 框');
  // 记录最近提交（最新在前），用于「已提交」排序（持久化到浏览器，刷新后仍在最上面）
  recordRecentSubmit(imageId);
  loadCounts();

  if (state.status === 'submitted') {
    // 已提交页签：该图保留，重新排序到顶部
    lastListSig = '';
    await refresh({});
    highlightListItem(imageId);
  } else {
    // 未作业/被打回：从列表移除，并自动加载下一张
    let item = null;
    Array.from($('annoList').querySelectorAll('.anno-item')).forEach((el) => {
      if (el.dataset.id === imageId) item = el;
    });
    const next = item ? item.nextElementSibling : null;
    if (item) item.remove();
    if (next && next.dataset.id) {
      loadImage(next.dataset.id);
    } else {
      clearViewer();
      if (!$('annoList').querySelector('.anno-item')) {
        $('annoList').innerHTML = '<div class="empty">' + statusEmptyText() + '</div>';
      }
    }
  }
}

/* ============ 设置 ============ */
function openSettings() {
  renderSettings();
  $('annoSettingsBox').classList.remove('hidden');
}
function closeSettings() { $('annoSettingsBox').classList.add('hidden'); }

function renderSettings() {
  const body = $('annoSettingsBody');
  body.innerHTML = '';
  state.categories.forEach((c) => {
    const label = document.createElement('label');
    label.innerHTML = '<span>' + esc(c) + '</span>';
    const input = document.createElement('input');
    input.className = 'key-input';
    input.dataset.cat = c;
    input.value = state.shortcuts.catKeys[c] || '';
    label.appendChild(input);
    body.appendChild(label);
  });
  const sub = document.createElement('label');
  sub.innerHTML = '<span>提交键</span>';
  const sinput = document.createElement('input');
  sinput.className = 'key-input';
  sinput.id = 'annoSubmitKey';
  sinput.value = state.shortcuts.submit || 'c';
  sub.appendChild(sinput);
  body.appendChild(sub);
  const hide = document.createElement('label');
  hide.innerHTML = '<span>隐藏属性键</span>';
  const hinput = document.createElement('input');
  hinput.className = 'key-input';
  hinput.id = 'annoHideKey';
  hinput.value = state.shortcuts.hideLabels || 'shift+3';
  hide.appendChild(hinput);
  body.appendChild(hide);
  body.querySelectorAll('.key-input').forEach((el) => el.addEventListener('keydown', (e) => {
    e.preventDefault(); e.stopPropagation();
    const lbl = keyLabel(e);
    if (lbl) { el.value = lbl; el.blur(); }
  }));
}

function saveSettings() {
  const catKeys = {};
  $('annoSettingsBody').querySelectorAll('input[data-cat]').forEach((el) => {
    catKeys[el.dataset.cat] = el.value.trim().toLowerCase() || '';
  });
  const submit = ($('annoSubmitKey').value || '').trim().toLowerCase() || 'c';
  const hideLabels = ($('annoHideKey').value || '').trim().toLowerCase() || 'shift+3';
  const all = loadAnnoShortcuts();
  all[state.projectId] = { catKeys, submit, hideLabels };
  saveAnnoShortcuts(all);
  state.shortcuts = { catKeys, submit, hideLabels };
  renderCategoryButtons();
  closeSettings();
  toast('快捷键已保存');
}

function resetSettings() {
  const all = loadAnnoShortcuts();
  delete all[state.projectId];
  saveAnnoShortcuts(all);
  loadProjectShortcuts(state.projectId);
  renderSettings();
  renderCategoryButtons();
  toast('已恢复默认快捷键');
}

/* ============ 快捷键按键处理 ============ */
function keyLabel(e) {
  if (e.key === 'Escape') return null;
  // 修饰键本身不当作快捷键（避免按 shift 时被记成 shift+shift）
  if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return null;
  const code = e.code || '';
  let k;
  if (code.startsWith('Digit')) k = code.slice(5);                    // Digit3 -> 3（避免 shift+3 变成 #）
  else if (code.startsWith('Key')) k = code.slice(3).toLowerCase();   // KeyA -> a
  else if (code === 'Space') k = 'Space';
  else k = (e.key && e.key.length === 1) ? e.key.toLowerCase() : e.key;
  const mods = [];
  if (e.ctrlKey) mods.push('ctrl');
  if (e.altKey) mods.push('alt');
  if (e.shiftKey) mods.push('shift');
  return (mods.length ? mods.join('+') + '+' : '') + k;
}

function toggleHideLabels() {
  state.hideLabels = !state.hideLabels;
  if (currentViewer) currentViewer.setHideLabels(state.hideLabels);
  toast(state.hideLabels ? '已隐藏属性' : '已显示属性');
}

document.addEventListener('keydown', (e) => {
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (!$('annoSettingsBox').classList.contains('hidden')) return;
  if (!$('annoLogin').classList.contains('hidden')) return;
  const k = keyLabel(e);
  if (!k) return;
  const submit = state.shortcuts.submit || 'c';
  if (k === submit) { save(); e.preventDefault(); return; }
  if (k === (state.shortcuts.hideLabels || 'shift+3')) { toggleHideLabels(); e.preventDefault(); return; }
  const cat = state.categories.find((c) => (state.shortcuts.catKeys[c] || '').toLowerCase() === k);
  if (cat) { setActiveCategory(cat); e.preventDefault(); }
});

/* ============ 偏好持久化 ============ */
const PREFS_KEY = 'anno_prefs';
function loadPrefs() {
  try { const raw = localStorage.getItem(PREFS_KEY); if (raw) { const p = JSON.parse(raw); if (p && typeof p === 'object') return p; } } catch (e) {}
  return {};
}
function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ projectId: state.projectId, reviewerUid: state.uid })); } catch (e) {}
}

/* ============ 事件绑定 ============ */
$('annoProject').onchange = onProjectChange;
$('annoReviewer').onchange = onAnnotatorChange;
$('annoSearch').addEventListener('input', () => { state.search = $('annoSearch').value; refresh({}); });
$('annoQcFilter').onchange = () => { state.qcFilter = $('annoQcFilter').value; refresh({}); };
$('annoRefresh').onclick = onManualRefresh;
$('annoSettings').onclick = openSettings;
$('annoSettingsClose').onclick = closeSettings;
$('annoSettingsSave').onclick = saveSettings;
$('annoSettingsReset').onclick = resetSettings;
$('annoLoginClose').onclick = closeLogin;
$('annoLoginCancel').onclick = closeLogin;
$('annoLoginOk').onclick = submitLogin;
$('annoLogin').onclick = (e) => { if (e.target === $('annoLogin')) closeLogin(); };
document.querySelectorAll('.anno-tab').forEach((b) => { b.onclick = () => switchStatus(b.dataset.status); });

/* 浏览器回退/前进恢复页面（bfcache）不会重新发请求，主动刷新一次 */
window.addEventListener('pageshow', (e) => {
  if (e.persisted && pid() && uid()) {
    lastListSig = '';
    refresh({ silent: true, force: true });
  }
});
/* 从别的标签页切回来时立即对齐一次 */
document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });

init();
