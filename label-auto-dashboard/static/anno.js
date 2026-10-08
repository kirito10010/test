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
  shortcuts: { catKeys: {}, submit: 'C', hideLabels: 'Shift+3' },   // 与 DEFAULT_SHORTCUTS 一致
  currentImage: null,
  recentSubmits: [],
  hideLabels: false,
  search: '',
  qcFilter: '',
  boxFilter: 'all',    // 框数筛选：all / none(无框) / some(有框) / 精确数字 / '6+'
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

/* 默认只给两个功能键：提交 C、隐藏属性 Shift+3。
   属性键默认留空，由使用者自己设（以前会自动分配 1/2/3…，容易被误当成"已经设好了"）。 */
const DEFAULT_SHORTCUTS = { pass: 'C', reject: 'V', submit: 'C', hideLabels: 'Shift+3' };

/* 修饰键 / 命名键的规范写法（归一化用） */
const MOD_ALIAS = { ctrl: 'Ctrl', control: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Meta', cmd: 'Meta', win: 'Meta' };
const NAMED_KEYS = { space: 'Space', delete: 'Delete', backspace: 'Backspace', enter: 'Enter', tab: 'Tab',
                     escape: 'Escape', insert: 'Insert', home: 'Home', end: 'End', pageup: 'PageUp',
                     pagedown: 'PageDown', arrowup: 'ArrowUp', arrowdown: 'ArrowDown',
                     arrowleft: 'ArrowLeft', arrowright: 'ArrowRight' };

/* 把任意写法（含历史遗留的 'c' / 'shift+3'）归一化成统一显示形式：
   Ctrl+S / Shift+3 / C / 4 / Space。单个符号（¥ # 之类）直接丢弃成空。 */
function normalizeKeyLabel(s) {
  const raw = String(s == null ? '' : s).trim();
  if (!raw) return '';
  const parts = raw.split('+').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return '';
  const key = parts.pop();
  const mods = [];
  parts.forEach((p) => {
    const m = MOD_ALIAS[p.toLowerCase()];
    if (m && mods.indexOf(m) < 0) mods.push(m);
  });
  let k;
  if (/^[a-z]$/i.test(key)) k = key.toUpperCase();                       // a -> A
  else if (/^\d$/.test(key)) k = key;                                    // 4 -> 4
  else if (/^numpad\d+$/i.test(key)) k = 'Numpad' + key.slice(6);         // numpad1 -> Numpad1
  else if (NAMED_KEYS[key.toLowerCase()]) k = NAMED_KEYS[key.toLowerCase()];
  else if (/^f\d{1,2}$/i.test(key)) k = key.toUpperCase();                // f5 -> F5
  else if (key.length > 1) k = key.charAt(0).toUpperCase() + key.slice(1);
  else return '';                                                        // 单个符号 → 丢弃
  return (mods.length ? mods.join('+') + '+' : '') + k;
}

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
  state.categories.forEach((c) => {
    catKeys[c] = normalizeKeyLabel(cur[c]);   // 属性键默认留空，不再按索引分配
  });
  const submit = normalizeKeyLabel((all[pid_] && all[pid_].submit) || DEFAULT_SHORTCUTS.submit);
  const hideLabels = normalizeKeyLabel((all[pid_] && all[pid_].hideLabels) || DEFAULT_SHORTCUTS.hideLabels);
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

/* 框数筛选：all=全部 none=无框 some=有框 '6+'=6 框及以上，其它=精确框数。
   图不在 box_counts 里时按 0 框算（与列表显示的「0 框」一致）。
   注意「未作业」页签里的框数是模型预标注框数。 */
function boxMatch(id, boxCounts) {
  const f = state.boxFilter;
  if (!f || f === 'all') return true;
  const n = boxCounts[id] || 0;
  if (f === 'none') return n === 0;
  if (f === 'some') return n >= 1;
  if (f === '6+') return n >= 6;
  return n === Number(f);
}

function applyFilters(items, boxCounts) {
  const kw = state.search.trim().toLowerCase();
  return items.filter((id) => {
    if (kw && id.toLowerCase().indexOf(kw) < 0) return false;
    if (!boxMatch(id, boxCounts || {})) return false;
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
  state.boxFilter = 'all';
  $('annoSearch').value = '';
  $('annoBoxFilter').value = 'all';
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
  clearCounts();        // 别让上一个项目的数字留在新项目上（否则就是「小圈有数字 + 列表空」）
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
  clearCounts();        // 同上：换作业员后徽标必须清空，等新数据回来再填
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

/* 徽标只由 refresh() 在「列表已定」之后调用（原来 loadCounts 会单独请求计数并直接写徽标，
   徽标与列表可能来自两次不同的快照）。 */
function renderCounts(c, shownCount) {
  if (!c) return;
  let line = '共 ' + c.total + ' 条：已提交 ' + c.submitted;
  if (filtersActive() && typeof shownCount === 'number') line += '（筛选后 ' + shownCount + '）';
  $('annoCounts').textContent = line;
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

/* 是否有前端筛选在生效（决定要不要在徽标后面标「筛选后 M」） */
function filtersActive() {
  return !!(state.search.trim() || state.qcFilter ||
            (state.boxFilter && state.boxFilter !== 'all'));
}

function showListError(msg) {
  lastListSig = '';
  $('annoList').innerHTML = '<div class="empty"><div>' + esc(msg || '加载失败') + '</div>' +
    '<div class="empty-action"><button class="btn" data-empty-action="retry">重试</button></div></div>';
}

/* 列表内容签名：状态/筛选/每项及其框数都没变 → 只刷徽标，不重建 DOM */
function listSignature(items, boxCounts) {
  return [state.status, state.search, state.qcFilter, state.boxFilter,
          state.recentSubmits.slice(0, 20).join(','),
          items.map((id) => id + ':' + (boxCounts[id] || 0)).join(',')].join('|');
}

function rebuildList(items, boxCounts, rawCount) {
  const listEl = $('annoList');
  listEl.innerHTML = '';
  if (!items.length) {
    listEl.innerHTML = emptyStateHtml({ rawCount });
    return;
  }
  items.forEach((id) => makeListItem(id, (state.qcOf[id] || {}).name, boxCounts[id]));
  // 预加载前几张图片，减少切换时闪黑
  items.slice(0, 4).forEach((id) => prefetchImage(id));
}

/* 空列表必须说清「为什么空」：只有一句「暂无未作业图」的话，分不清是真没有还是被筛选藏了 */
function emptyStateHtml(ctx) {
  const rawCount = (ctx && ctx.rawCount) || 0;
  const lines = [];
  const acts = [];
  if (rawCount > 0) {
    lines.push('服务端返回 ' + rawCount + ' 张，当前筛选后 0 张。');
    acts.push(['clear-filter', '清空筛选']);
  } else if (filtersActive()) {
    lines.push('当前有筛选条件，在筛选范围内没有命中。');
    acts.push(['clear-filter', '清空筛选']);
  }
  return '<div class="empty"><div>' + esc(statusEmptyText()) + '</div>' +
    lines.map((t) => '<div class="empty-sub">' + esc(t) + '</div>').join('') +
    (acts.length
      ? '<div class="empty-action">' + acts.map(([a, label]) =>
          '<button class="btn" data-empty-action="' + a + '">' + esc(label) + '</button>').join('') + '</div>'
      : '') +
    '</div>';
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
    if (myToken === listToken && !opts.silent) {
      clearCounts();   // 失败时不留上一个项目的数字（否则就是「小圈有数字 + 列表空」）
      showListError('网络异常，请点「刷新」重试');
    }
    return [];
  }
  if (myToken !== listToken) return [];   // 期间又切了页签/项目，丢弃过期结果
  if (!r || !r.ok) {
    if (!opts.silent) {
      clearCounts();
      showListError((r && r.error) || '加载失败');
    }
    return [];
  }

  const boxCounts = r.box_counts || {};
  const rawItems = r.items || [];
  const items = orderItems(applyFilters(rawItems, boxCounts));
  const sig = listSignature(items, boxCounts);
  // 签名没变 → DOM 里就是这份 items，可以安全地把徽标对齐过来
  if (sig === lastListSig) {
    renderCounts(r.counts, items.length);
    if (opts.autoSelect && !state.currentImage && items.length) loadImage(items[0]);
    return items;
  }
  // 弹窗开着：不重建列表，也**不更新徽标**（徽标必须与列表同源）
  if (opts.silent && uiBusy()) return items;

  const prevScroll = $('annoList').scrollTop;
  rebuildList(items, boxCounts, rawItems.length);
  lastListSig = sig;
  $('annoList').scrollTop = prevScroll;   // 保留滚动位置
  renderCounts(r.counts, items.length);

  if (opts.autoSelect) {
    if (items.length) loadImage(items[0]);
    else clearViewer();
  } else if (items.indexOf(state.currentImage) >= 0) {
    highlightListItem(state.currentImage);
  }
  // 自动刷新不动当前图，避免丢掉正在画的框
  return items;
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

/* ============ 数量统计（徽标由 refresh() 与列表同源渲染） ============ */

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
  v.innerHTML = '<div class="empty">左侧列表暂无可显示的图</div>';
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
let submitting = false;   // 防重入：按住 C 会连发 keydown，重复提交会把下一张图的框覆盖成 0

async function save() {
  if (submitting) return;
  if (!state.currentImage) { toast('请先选择图片'); return; }
  submitting = true;
  try {
    const imageId = state.currentImage;
    const r = await api('/api/qc/save', { method: 'POST', body: { pid: pid(), image_id: imageId, boxes: currentBoxes } });
    if (!r || !r.ok) { toast((r && r.error) || '保存失败'); return; }
    toast('已保存 ' + r.box_count + ' 框');
    // 记录最近提交（最新在前），用于「已提交」排序（持久化到浏览器，刷新后仍在最上面）
    recordRecentSubmit(imageId);

    if (state.status === 'submitted') {
      // 已提交页签：该图保留，重新排序到顶部（refresh 会同时更新徽标与列表）
      lastListSig = '';
      await refresh({});
      highlightListItem(imageId);
    } else {
      // 未作业/被打回：从列表移除，并自动加载下一张；徽标用同源刷新对齐
      refresh({ silent: true });
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
  } finally {
    submitting = false;
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
    input.readOnly = true;             // 只能按出来，避免手打出 ¥ 这种脏值
    input.placeholder = '按键设置';
    label.appendChild(input);
    body.appendChild(label);
  });
  const sub = document.createElement('label');
  sub.innerHTML = '<span>提交键</span>';
  const sinput = document.createElement('input');
  sinput.className = 'key-input';
  sinput.id = 'annoSubmitKey';
  sinput.value = state.shortcuts.submit || DEFAULT_SHORTCUTS.submit;
  sinput.readOnly = true;
  sinput.placeholder = '按键设置';
  sub.appendChild(sinput);
  body.appendChild(sub);
  const hide = document.createElement('label');
  hide.innerHTML = '<span>隐藏属性键</span>';
  const hinput = document.createElement('input');
  hinput.className = 'key-input';
  hinput.id = 'annoHideKey';
  hinput.value = state.shortcuts.hideLabels || DEFAULT_SHORTCUTS.hideLabels;
  hinput.readOnly = true;
  hinput.placeholder = '按键设置';
  hide.appendChild(hinput);
  body.appendChild(hide);
  body.querySelectorAll('.key-input').forEach((el) => el.addEventListener('keydown', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (e.key === 'Escape') { el.blur(); return; }                    // Esc：不改动，退出
    if (e.key === 'Delete' || e.key === 'Backspace') {                // Delete：删除这个快捷键
      el.value = '';
      el.blur();
      return;
    }
    const lbl = keyLabel(e);
    if (lbl) { el.value = lbl; el.blur(); }
  }));
}

function saveSettings() {
  const catKeys = {};
  $('annoSettingsBody').querySelectorAll('input[data-cat]').forEach((el) => {
    catKeys[el.dataset.cat] = normalizeKeyLabel(el.value);   // 属性键允许留空
  });
  // 功能键不允许没有：清空后回落到默认值
  const submit = normalizeKeyLabel($('annoSubmitKey').value) || DEFAULT_SHORTCUTS.submit;
  const hideLabels = normalizeKeyLabel($('annoHideKey').value) || DEFAULT_SHORTCUTS.hideLabels;
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
/* 一律以 e.code（物理键）为准，字母大写、数字用阿拉伯数字。
   故意不看 e.key —— 不同键盘布局下 Shift+4 的 e.key 是 ¥、Shift+3 是 #，
   把符号记成快捷键既看不懂也按不出来。 */
function keyLabel(e) {
  const code = e.code || '';
  if (code === 'Escape' || e.key === 'Escape') return null;   // Esc 用来取消
  if (['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'].indexOf(code) >= 0 ||
      ['Shift', 'Control', 'Alt', 'Meta'].indexOf(e.key) >= 0) return null;   // 单独的修饰键不算
  let k = '';
  if (code.indexOf('Digit') === 0) k = code.slice(5);                       // Digit4 -> 4
  else if (code.indexOf('Numpad') === 0 && code.length === 7) k = 'Numpad' + code.slice(6);
  else if (code.indexOf('Key') === 0) k = code.slice(3).toUpperCase();      // KeyA -> A
  else if (code === 'Space') k = 'Space';
  else if (code) k = code;                                                  // Delete / Enter / ArrowLeft / F5 …
  else if (e.key && e.key.length > 1) k = e.key;                            // 兜底：只接受命名键
  if (!k) return null;                                                      // 拿不到 code 的单字符（¥）宁可不记
  const mods = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
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
  if (e.repeat) return;   // 按住不放的重复触发忽略，避免连续保存把下一张图的框覆盖成 0
  const k = keyLabel(e);
  if (!k) return;
  const submit = state.shortcuts.submit || DEFAULT_SHORTCUTS.submit;
  if (k === submit) { save(); e.preventDefault(); return; }
  if (k === (state.shortcuts.hideLabels || DEFAULT_SHORTCUTS.hideLabels)) { toggleHideLabels(); e.preventDefault(); return; }
  const cat = state.categories.find((c) => state.shortcuts.catKeys[c] === k);
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
$('annoBoxFilter').onchange = () => { state.boxFilter = $('annoBoxFilter').value; refresh({}); };
$('annoRefresh').onclick = onManualRefresh;
// 空列表里的「清空筛选 / 重试」按钮（列表内容是动态重建的，所以用事件委托）
$('annoList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-empty-action]');
  if (!b) return;
  const act = b.dataset.emptyAction;
  if (act === 'clear-filter') { resetFilters(); refresh({ force: true }); }
  else if (act === 'retry') { onManualRefresh(); }
});
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
