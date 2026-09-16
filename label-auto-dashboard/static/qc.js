/* 质检平台前端逻辑（单图三栏布局，与作业平台一致） */
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
let RELEASE = false;   // 发布版标志，由 /api/config 决定

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 2200);
}

async function api(path, options) {
  const opts = Object.assign({ headers: {} }, options || {});
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

/* ============ 状态 ============ */
const state = {
  setup: [],
  projectId: null,
  reviewerUid: null,
  reviewers: [],
  categories: [],
  status: 'pending',   // 'pending' | 'passed' | 'rejected' | 'recent'
  activeCategory: null,
  currentImage: null,
  hideLabels: false,
  shortcuts: { catKeys: {}, pass: 'c', reject: 'r', hideLabels: 'shift+3' },
  search: '',
  annotatorFilter: '',
  catFilter: [],       // 已选属性（分类名数组），用于右侧列表按属性筛选
  annOf: {},
  anns: [],
};

let currentBoxes = [];
let currentViewer = null;
let dirty = false;   // 当前图是否被编辑过（决定提交前是否需要保存框）
const boxCache = {};   // imageId -> boxes，用于预加载标注框，避免「图快框慢」
let imageToken = 0;    // 换图自增，丢弃过期的异步标注框结果，避免串图
let listEls = [];      // 右侧列表 DOM 项缓存，避免每次通过/换图都全量 querySelectorAll 扫描

function pid() { return state.projectId; }
function uid() { return state.reviewerUid; }
function isEditable() { return state.status === 'pending' || state.status === 'rejected'; }

function imageUrl(id) {
  return '/api/projects/' + encodeURIComponent(pid()) + '/image?image_id=' + encodeURIComponent(id);
}
function prefetchImage(id) {
  const img = new Image();
  img.src = imageUrl(id);
}
function prefetchBoxes(id) {
  if (!id || boxCache[id]) return;
  api('/api/projects/' + encodeURIComponent(pid()) + '/annotation?image_id=' + encodeURIComponent(id))
    .then((ann) => { if (ann && ann.ok) boxCache[id] = ann.boxes || []; })
    .catch(() => {});
}
function isLocalHost() {
  return ['127.0.0.1', 'localhost', '::1'].indexOf(location.hostname) >= 0;
}

/* ============ 快捷键（按项目隔离，独立 localStorage） ============ */
const QC_KEY = 'qc_keys';
const DEFAULT_KEYS = '1234567890qwertyuiopasdfghjklzxcvbnm'.split('');

function loadShortcuts() {
  try { const raw = localStorage.getItem(QC_KEY); if (raw) return JSON.parse(raw); } catch (e) {}
  return {};
}
function saveShortcuts(data) {
  try { localStorage.setItem(QC_KEY, JSON.stringify(data)); } catch (e) {}
}
function loadProjectShortcuts(pid_) {
  const all = loadShortcuts();
  const cur = (all[pid_] && all[pid_].catKeys) || {};
  const catKeys = {};
  state.categories.forEach((c, i) => {
    catKeys[c] = (cur[c] !== undefined && cur[c] !== null) ? cur[c] : (DEFAULT_KEYS[i] || '');
  });
  const pass = (all[pid_] && all[pid_].pass) || 'c';
  const reject = (all[pid_] && all[pid_].reject) || 'r';
  const hideLabels = (all[pid_] && all[pid_].hideLabels) || 'shift+3';
  state.shortcuts = { catKeys, pass, reject, hideLabels };
}

/* ============ 每日质检量（内置账号才显示，10s 轮询） ============ */
let _dailyTimer = null;
function startDailyPoll() {
  if (_dailyTimer) return;
  _dailyTimer = setInterval(loadDailyStats, 10000);
}
function loadDailyStats() {
  const el = $('qcDailyStats');
  if (!el) return;
  if (!uid()) { el.innerHTML = ''; el.classList.add('hidden'); return; }
  api('/api/daily_stats?uid=' + encodeURIComponent(uid())).then((res) => {
    if (res && res.ok && res.has_login) {
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

/* ============ 初始化 ============ */
async function init() {
  // 判断是否发布版
  try {
    const c = await api('/api/config');
    RELEASE = !!(c && c.release);
  } catch (e) {}
  if (RELEASE) {
    if (!getAuth().token) { location.href = '/'; return; }
    applyReleaseUI();
  } else {
    const r = await api('/api/qc/autologin');
    if (!r || !r.ok) { toast((r && r.error) || '自动登录失败'); return; }
  }
  const s = await api('/api/qc/setup');
  if (!s || !s.ok) { toast('加载项目失败'); return; }
  state.setup = s.projects || [];
  renderProjectSelect();
  startDailyPoll();
}

function applyReleaseUI() {
  // 发布版：去掉切换平台按钮，只留「退出」
  const linkAnno = $('linkAnno');
  const linkDashboard = $('linkDashboard');
  const linkLogout = $('linkLogout');
  if (linkAnno) linkAnno.classList.add('hidden');
  if (linkDashboard) linkDashboard.classList.add('hidden');
  if (linkLogout) linkLogout.classList.remove('hidden');
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
  if (prefs.projectId && state.setup.some((p) => p.id === prefs.projectId)) {
    sel.value = prefs.projectId;
  }
  onProjectChange();
}

function onProjectChange() {
  state.projectId = $('qcProject').value;
  const p = state.setup.find((x) => x.id === state.projectId);
  state.categories = (p && p.categories) || [];
  state.activeCategory = null;
  loadProjectShortcuts(state.projectId);
  renderCategoryButtons();
  state.catFilter = [];
  renderCatPicker();
  renderReviewerSelect(p ? p.reviewers : []);
  savePrefs();
  for (const k in boxCache) delete boxCache[k];   // 切项目清空标注框缓存
}

function renderReviewerSelect(reviewers) {
  const sel = $('qcReviewer');
  sel.innerHTML = '';
  const prefs = loadPrefs();
  state.reviewers = reviewers || [];
  // 发布版：非 admin 只有一个质检员（当前用户）时，隐藏「质检员」下拉
  const field = sel.closest('.qc-field');
  if (field) field.classList.toggle('hidden', RELEASE && reviewers.length <= 1);
  reviewers.forEach((r) => {
    const o = document.createElement('option');
    o.value = r.uid;
    o.textContent = r.name;
    sel.appendChild(o);
  });
  if (reviewers.length) {
    if (prefs.reviewerUid && reviewers.some((r) => r.uid === prefs.reviewerUid)) {
      sel.value = prefs.reviewerUid;
    }
    state.reviewerUid = sel.value;
    onReviewerChange();
  } else {
    state.reviewerUid = null;
    listEls = [];
    $('qcList').innerHTML = '<div class="empty">该项目暂无质检员</div>';
    clearViewer();
    $('qcCounts').textContent = '';
    $('badgePending').textContent = '';
    $('badgePassed').textContent = '';
    $('badgeRejected').textContent = '';
  }
}

function onReviewerChange() {
  state.reviewerUid = $('qcReviewer').value;
  state.currentImage = null;
  clearViewer();
  savePrefs();
  loadDailyStats();
  state.annotatorFilter = '';
  state.catFilter = [];
  updateCatPickerField();
  loadAnnotatorOwners();

  if (!RELEASE) {
    const r = state.reviewers.find((x) => x.uid === state.reviewerUid);
    if (!isLocalHost() && r && !r.has_login) {
      probeReviewerLogin();
      return;
    }
  }
  $('reviewerLogin').classList.add('hidden');
  loadCounts();
  refreshList(true);
}

async function probeReviewerLogin() {
  const res = await api('/api/qc/counts?pid=' + encodeURIComponent(pid()) + '&uid=' + encodeURIComponent(uid()));
  if (res && res.ok) {
    $('reviewerLogin').classList.add('hidden');
    loadCounts();
    refreshList(true);
  } else if (res && res.need_login) {
    $('qcCounts').textContent = '';
    $('badgePending').textContent = '';
    $('badgePassed').textContent = '';
    $('badgeRejected').textContent = '';
    listEls = [];
    $('qcList').innerHTML = '<div class="empty">该质检员需登录后查看</div>';
    openReviewerLogin(state.reviewers.find((x) => x.uid === state.reviewerUid));
  } else {
    toast((res && res.error) || '加载失败，请重试');
  }
}

/* ============ 质检员登录（局域网且未内置登录时） ============ */
function openReviewerLogin(reviewer) {
  $('reviewerLoginName').textContent = reviewer ? reviewer.name : '';
  $('reviewerLoginEmail').value = '';
  $('reviewerLoginPassword').value = '';
  $('reviewerLogin').classList.remove('hidden');
}
function closeReviewerLogin() {
  $('reviewerLogin').classList.add('hidden');
}
async function submitReviewerLogin() {
  const email = $('reviewerLoginEmail').value.trim();
  const password = $('reviewerLoginPassword').value;
  if (!email || !password) { toast('请输入邮箱和密码'); return; }
  const btn = $('reviewerLoginOk');
  btn.disabled = true;
  let r;
  try {
    r = await api('/api/qc/reviewer_login', { method: 'POST', body: { uid: state.reviewerUid, email, password } });
  } catch (e) {
    btn.disabled = false; toast('登录失败（网络或服务异常）'); return;
  }
  btn.disabled = false;
  if (r && r.ok) {
    closeReviewerLogin(); toast('登录成功'); loadCounts(); refreshList(true);
  } else {
    toast((r && r.error) || '登录失败，请检查账号密码');
  }
}

/* ============ 左侧属性按钮 ============ */
function renderCategoryButtons() {
  const wrap = $('qcCats');
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
  Array.from($('qcCats').querySelectorAll('.cat-btn')).forEach((b) => {
    b.classList.toggle('active', b.dataset.cat === state.activeCategory);
  });
}
function setActiveCategory(cat) {
  state.activeCategory = cat;
  highlightCategory();
  if (currentViewer && isEditable()) {
    const idx = currentViewer.getSelected();
    if (idx >= 0 && currentBoxes[idx]) {
      currentBoxes[idx].category = cat;
      currentViewer.redraw();
      currentViewer.setSelected(-1);
      dirty = true;
      toast('已修改分类为 ' + cat + '（未保存）');
    }
  }
}

/* ============ 作业员归属 / 筛选 ============ */
let annotatorToken = 0;

function loadAnnotatorOwners() {
  const myToken = ++annotatorToken;
  state.annOf = {};
  state.anns = [];
  if (!pid() || !uid()) return;
  api('/api/qc/annotators?pid=' + encodeURIComponent(pid()) + '&uid=' + encodeURIComponent(uid())).then((r) => {
    if (myToken !== annotatorToken) return;   // 已切到别的质检员，丢弃过期结果
    if (!r || !r.ok) return;
    state.annOf = r.ann_of || {};
    state.anns = r.anns || [];
    renderAnnotatorFilter();
    updateListAnnotatorTags();   // 只补全列表里的「标注：名字」，不重拉列表（避免打断初始加载）
  }).catch(() => {});
}

function updateListAnnotatorTags() {
  listEls.forEach((el) => {
    const a = state.annOf[el.dataset.id];
    let tag = el.querySelector('.qc-ann-tag');
    if (a) {
      if (!tag) {
        tag = document.createElement('div');
        tag.className = 'qc-ann-tag';
        el.appendChild(tag);
      }
      tag.textContent = '标注：' + a.name;
    } else if (tag) {
      tag.remove();
    }
  });
}

function renderAnnotatorFilter() {
  const sel = $('qcAnnotatorFilter');
  const cur = state.annotatorFilter;
  sel.innerHTML = '<option value="">全部作业员</option>';
  state.anns.forEach((a) => {
    const o = document.createElement('option');
    o.value = a.uid;
    o.textContent = a.name;
    sel.appendChild(o);
  });
  if (cur && state.anns.some((a) => a.uid === cur)) sel.value = cur;
  else state.annotatorFilter = '';
}

/* ============ 属性多选筛选 ============ */
function renderCatPicker() {
  const dd = $('qcCatPickerDropdown');
  dd.innerHTML = '';
  state.categories.forEach((c) => {
    const lab = document.createElement('label');
    lab.className = 'label-picker-option';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = c;
    cb.checked = state.catFilter.includes(c);
    cb.onchange = () => {
      if (cb.checked) state.catFilter.push(c);
      else state.catFilter = state.catFilter.filter((x) => x !== c);
      updateCatPickerField();
      refreshList(false);   // 属性筛选走后端，重新拉列表
    };
    lab.appendChild(cb);
    const span = document.createElement('span');
    span.textContent = c;
    lab.appendChild(span);
    dd.appendChild(lab);
  });
  updateCatPickerField();
}

function updateCatPickerField() {
  const el = $('qcCatPickerField');
  const n = state.catFilter.length;
  if (!n) {
    el.innerHTML = '<span class="placeholder">按属性筛选（可多选）</span>';
  } else if (n <= 2) {
    el.innerHTML = state.catFilter.map((c) => '<span class="label-picker-tag">' + esc(c) + '</span>').join('');
  } else {
    el.innerHTML = state.catFilter.slice(0, 2).map((c) => '<span class="label-picker-tag">' + esc(c) + '</span>').join('')
      + '<span class="label-picker-tag label-picker-more">+' + (n - 2) + '</span>';
  }
}

function toggleCatPicker() {
  $('qcCatPickerDropdown').classList.toggle('hidden');
}

function applyFilters(items) {
  const kw = state.search.trim().toLowerCase();
  return items.filter((id) => {
    if (kw && id.toLowerCase().indexOf(kw) < 0) return false;
    if (state.annotatorFilter) {
      const a = state.annOf[id];
      if (!a || a.uid !== state.annotatorFilter) return false;
    }
    return true;
  });
}

/* ============ 右侧列表 ============ */
let listToken = 0;   // 切页签/刷新时自增，丢弃过期的异步结果，避免竞态

function switchStatus(status) {
  state.status = status;
  document.querySelectorAll('.qc-tab').forEach((b) => b.classList.toggle('active', b.dataset.status === status));
  refreshList(true);
  updateActionButtons();
}

async function refreshList(autoSelect) {
  const myToken = ++listToken;
  const items = await loadList(myToken);
  if (myToken !== listToken) return;   // 期间又切了页签/搜索，丢弃过期结果
  if (autoSelect) {
    if (items.length) loadImage(items[0]);
    else clearViewer();
  }
}

async function loadList(token) {
  if (!pid() || !uid()) return [];
  const listEl = $('qcList');
  listEl.innerHTML = '<div class="empty">加载中…</div>';
  let r;
  if (state.status === 'recent') {
    r = await api('/api/qc/recent?pid=' + encodeURIComponent(pid()) + '&uid=' + encodeURIComponent(uid()));
  } else {
    const catParam = state.catFilter.length ? '&cat=' + encodeURIComponent(state.catFilter.join(',')) : '';
    r = await api('/api/qc/assigned?pid=' + encodeURIComponent(pid()) + '&uid=' + encodeURIComponent(uid()) + '&status=' + state.status + '&offset=0&limit=100000' + catParam);
  }
  if (token !== listToken) return [];   // 过期，不再渲染列表
  listEl.innerHTML = '';
  listEls = [];
  lastActiveId = null;
  let items = (r && r.items) || [];
  items = applyFilters(items);
  if (!items.length) {
    listEl.innerHTML = '<div class="empty">' + statusEmptyText() + '</div>';
  }
  const boxCounts = (r && r.box_counts) || {};
  items.forEach((id) => makeListItem(id, (state.annOf[id] || {}).name, boxCounts[id]));
  // 不在这里批量预加载：初始只加载当前一张，避免 10+ 张图/框并发抢带宽，
  // 拖慢首屏（LCP）。后续由 loadImage 滚动预加载紧接着的几张。
  return items;
}

function statusEmptyText() {
  if (state.status === 'pending') return '暂无未质检图';
  if (state.status === 'passed') return '暂无已通过图';
  if (state.status === 'rejected') return '暂无已打回图';
  return '暂无最近提交';
}

function loadCounts() {
  $('qcCounts').textContent = '';
  $('badgePending').textContent = '';
  $('badgePassed').textContent = '';
  $('badgeRejected').textContent = '';
  if (!pid() || !uid()) return;
  api('/api/qc/counts?pid=' + encodeURIComponent(pid()) + '&uid=' + encodeURIComponent(uid())).then((r) => {
    if (!r || !r.ok) return;
    const c = r.counts || {};
    $('qcCounts').textContent = '共 ' + c.total + ' 条：作业中 ' + c.annotating;
    $('badgePending').textContent = c.pending;
    $('badgePassed').textContent = c.passed;
    $('badgeRejected').textContent = c.rejected;
  }).catch(() => {});
}

function makeListItem(id, annName, boxCount) {
  const item = document.createElement('div');
  item.className = 'qc-item';
  item.dataset.id = id;

  // 第一行：文件名（超长缩略 + 悬浮显示全名）+ 框数 + 复制按钮
  const row1 = document.createElement('div');
  row1.className = 'qc-item-row';
  const nameEl = document.createElement('span');
  nameEl.className = 'qc-item-name';
  nameEl.textContent = id;
  nameEl.title = id;   // 鼠标悬浮显示完整文件名
  row1.appendChild(nameEl);
  if (boxCount != null) {
    const bc = document.createElement('span');
    bc.className = 'qc-box-count';
    bc.textContent = boxCount + ' 框';
    row1.appendChild(bc);
  }
  const copyBtn = document.createElement('button');
  copyBtn.className = 'qc-copy-btn';
  copyBtn.type = 'button';
  copyBtn.textContent = '复制';
  copyBtn.title = '复制文件名';
  copyBtn.onclick = (e) => {
    e.stopPropagation();
    copyTextToClipboard(id).then(() => toast('已复制文件名'));
  };
  row1.appendChild(copyBtn);
  item.appendChild(row1);

  // 第二行：标注人
  if (annName) {
    const tag = document.createElement('div');
    tag.className = 'qc-ann-tag';
    tag.textContent = '标注：' + annName;
    item.appendChild(tag);
  }

  item.onclick = () => loadImage(id);
  $('qcList').appendChild(item);
  listEls.push(item);
}

let lastActiveId = null;   // 当前高亮的列表项 id，避免每次全量 toggle 几千条

function highlightListItem(id) {
  if (lastActiveId === id) return;
  if (lastActiveId) {
    const p = listEls.find((el) => el.dataset.id === lastActiveId);
    if (p) p.classList.remove('active');
  }
  const c = listEls.find((el) => el.dataset.id === id);
  if (c) c.classList.add('active');
  lastActiveId = id;
}

/* ============ 中间照片 ============ */
function clearViewer() {
  imageToken++;   // 使在途的标注框加载失效
  const v = $('qcViewer');
  if (currentViewer) { currentViewer.destroy(); currentViewer = null; }
  v.innerHTML = '<div class="empty">请选择图片</div>';
  currentBoxes = [];
  state.currentImage = null;
  dirty = false;
  updateActionButtons();
}

function loadImage(id) {
  if (!id) return;
  const myToken = ++imageToken;
  state.currentImage = id;
  dirty = false;
  highlightListItem(id);
  const v = $('qcViewer');
  if (currentViewer) { currentViewer.destroy(); currentViewer = null; }
  v.innerHTML = '';
  currentBoxes = [];
  const editable = isEditable();
  currentViewer = createViewer(v, imageUrl(id), currentBoxes, {
    editable: editable,
    onBoxDrawn: (bbox) => {
      const cat = state.activeCategory || state.categories[0];
      if (!cat) { toast('请先在左侧选择属性'); return; }
      currentBoxes.push({ category: cat, bbox: bbox, source: 'manual' });
      currentViewer.redraw();
      currentViewer.setSelected(-1);
      dirty = true;
    },
    onDelete: (idx) => {
      currentBoxes.splice(idx, 1);
      currentViewer.setSelected(-1);
      currentViewer.redraw();
      dirty = true;
    },
  });
  currentViewer.setHideLabels(state.hideLabels);
  // 只预加载紧接着的几张图（不预加载标注框，与可用版本一致，避免上游 /annotation 抢信号量拖慢图）
  const curIdx = listEls.findIndex((el) => el.dataset.id === id);
  for (let i = 1; i <= 3; i++) {
    const it = listEls[curIdx + i];
    if (it && it.dataset.id) prefetchImage(it.dataset.id);
  }
  // 当前图的框按需异步拉取（图片先显示，框稍后填充）
  if (boxCache[id]) {
    // 深拷贝，避免后续编辑框时反向污染缓存
    boxCache[id].forEach((b) => currentBoxes.push(JSON.parse(JSON.stringify(b))));
    currentViewer.redraw();
  } else {
    api('/api/projects/' + encodeURIComponent(pid()) + '/annotation?image_id=' + encodeURIComponent(id))
      .then((ann) => {
        if (myToken !== imageToken) return;   // 已切到别的图，丢弃过期结果
        currentBoxes.length = 0;
        ((ann && ann.boxes) || []).forEach((b) => currentBoxes.push(b));
        currentViewer.redraw();
      })
      .catch(() => {});
  }
  updateActionButtons();
}

/* ============ 通过 / 打回 / 保存 ============ */
let submitting = false;

async function verdict(v) {
  if (submitting) return;   // 防止双击/按键重复触发，避免 advanceAfter 竞态把查看器清空
  if (!state.currentImage) { toast('请先选择图片'); return; }
  submitting = true;
  try {
    const imageId = state.currentImage;
    if (dirty && isEditable()) {
      const r = await api('/api/qc/save', { method: 'POST', body: { pid: pid(), image_id: imageId, boxes: currentBoxes } });
      if (!r || !r.ok) { toast((r && r.error) || '保存失败'); return; }
      dirty = false;
    }
    const p = await api('/api/qc/submit', { method: 'POST', body: { pid: pid(), uid: uid(), verdicts: [{ image_id: imageId, verdict: v }] } });
    if (!p || !p.ok || p.succeeded < 1) { toast((p && p.error) || (v === 'pass' ? '通过失败' : '打回失败')); return; }
    toast(v === 'pass' ? '已通过' : '已打回');
    loadCounts();
    advanceAfter(imageId);
  } finally {
    submitting = false;
  }
}

async function saveBoxes() {
  if (submitting) return;
  if (!state.currentImage) { toast('请先选择图片'); return; }
  submitting = true;
  try {
    const imageId = state.currentImage;
    const r = await api('/api/qc/save', { method: 'POST', body: { pid: pid(), image_id: imageId, boxes: currentBoxes } });
    if (!r || !r.ok) { toast((r && r.error) || '保存失败'); return; }
    toast('已保存 ' + r.box_count + ' 框');
    dirty = false;
    loadCounts();
    advanceAfter(imageId);
  } finally {
    submitting = false;
  }
}

function advanceAfter(id) {
  const idx = listEls.findIndex((el) => el.dataset.id === id);
  const item = idx >= 0 ? listEls[idx] : null;
  const next = item ? listEls[idx + 1] : null;   // 用数组下标找下一个，避免全量 DOM 扫描
  if (item) { item.remove(); listEls.splice(idx, 1); }
  if (next && next.dataset.id) {
    loadImage(next.dataset.id);
  } else {
    clearViewer();
    if (!listEls.length) {
      $('qcList').innerHTML = '<div class="empty">' + statusEmptyText() + '</div>';
    }
  }
}

function updateActionButtons() {
  const s = state.status;
  const hasImage = !!state.currentImage;
  $('qcPass').classList.toggle('hidden', s !== 'pending');
  $('qcReject').classList.toggle('hidden', s !== 'pending' && s !== 'recent');
  $('qcSave').classList.toggle('hidden', s !== 'rejected');
  $('qcPass').disabled = !hasImage;
  $('qcReject').disabled = !hasImage;
  $('qcSave').disabled = !hasImage;
}

/* ============ 快捷键按键处理 ============ */
function keyLabel(e) {
  if (e.key === 'Escape') return null;
  if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return null;
  const code = e.code || '';
  let k;
  if (code.startsWith('Digit')) k = code.slice(5);
  else if (code.startsWith('Key')) k = code.slice(3).toLowerCase();
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
  if (e.repeat) return;   // 按住不放的重复触发忽略，避免连续通过/打回
  if (!$('settings').classList.contains('hidden')) return;
  if (!$('reviewerLogin').classList.contains('hidden')) return;
  const k = keyLabel(e);
  if (!k) return;
  if (k === (state.shortcuts.pass || 'c')) {
    if (state.status === 'pending') { verdict('pass'); e.preventDefault(); }
    else if (state.status === 'rejected') { saveBoxes(); e.preventDefault(); }
    return;
  }
  if (k === (state.shortcuts.reject || 'r')) {
    if (state.status === 'pending' || state.status === 'recent') { verdict('reject'); e.preventDefault(); }
    return;
  }
  if (k === (state.shortcuts.hideLabels || 'shift+3')) { toggleHideLabels(); e.preventDefault(); return; }
  const cat = state.categories.find((c) => (state.shortcuts.catKeys[c] || '').toLowerCase() === k);
  if (cat) { setActiveCategory(cat); e.preventDefault(); }
});

/* ============ 设置 ============ */
function openSettings() {
  renderSettings();
  $('settings').classList.remove('hidden');
}
function closeSettings() { $('settings').classList.add('hidden'); }

function renderSettings() {
  const body = $('settingsBody');
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
  const pass = document.createElement('label');
  pass.innerHTML = '<span>通过键</span>';
  const passInput = document.createElement('input');
  passInput.className = 'key-input';
  passInput.id = 'qcPassKey';
  passInput.value = state.shortcuts.pass || 'c';
  pass.appendChild(passInput);
  body.appendChild(pass);
  const reject = document.createElement('label');
  reject.innerHTML = '<span>打回键</span>';
  const rejectInput = document.createElement('input');
  rejectInput.className = 'key-input';
  rejectInput.id = 'qcRejectKey';
  rejectInput.value = state.shortcuts.reject || 'r';
  reject.appendChild(rejectInput);
  body.appendChild(reject);
  const hide = document.createElement('label');
  hide.innerHTML = '<span>隐藏属性键</span>';
  const hideInput = document.createElement('input');
  hideInput.className = 'key-input';
  hideInput.id = 'qcHideKey';
  hideInput.value = state.shortcuts.hideLabels || 'shift+3';
  hide.appendChild(hideInput);
  body.appendChild(hide);
  body.querySelectorAll('.key-input').forEach((el) => el.addEventListener('keydown', (e) => {
    e.preventDefault(); e.stopPropagation();
    const lbl = keyLabel(e);
    if (lbl) { el.value = lbl; el.blur(); }
  }));
}

function saveSettings() {
  const catKeys = {};
  $('settingsBody').querySelectorAll('input[data-cat]').forEach((el) => {
    catKeys[el.dataset.cat] = el.value.trim().toLowerCase() || '';
  });
  const pass = ($('qcPassKey').value || '').trim().toLowerCase() || 'c';
  const reject = ($('qcRejectKey').value || '').trim().toLowerCase() || 'r';
  const hideLabels = ($('qcHideKey').value || '').trim().toLowerCase() || 'shift+3';
  const all = loadShortcuts();
  all[state.projectId] = { catKeys, pass, reject, hideLabels };
  saveShortcuts(all);
  state.shortcuts = { catKeys, pass, reject, hideLabels };
  renderCategoryButtons();
  closeSettings();
  toast('快捷键已保存');
}

function resetSettings() {
  const all = loadShortcuts();
  delete all[state.projectId];
  saveShortcuts(all);
  loadProjectShortcuts(state.projectId);
  renderSettings();
  renderCategoryButtons();
  toast('已恢复默认快捷键');
}

/* ============ 偏好持久化 ============ */
const PREFS_KEY = 'qc_prefs';
function loadPrefs() {
  try { const raw = localStorage.getItem(PREFS_KEY); if (raw) { const p = JSON.parse(raw); if (p && typeof p === 'object') return p; } } catch (e) {}
  return {};
}
function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ projectId: state.projectId, reviewerUid: state.reviewerUid })); } catch (e) {}
}

/* ============ 事件绑定 ============ */
$('qcProject').onchange = onProjectChange;
$('qcReviewer').onchange = onReviewerChange;
$('qcSearch').addEventListener('input', () => { state.search = $('qcSearch').value; refreshList(false); });
$('qcAnnotatorFilter').onchange = () => { state.annotatorFilter = $('qcAnnotatorFilter').value; refreshList(false); };
$('qcCatPickerField').addEventListener('click', (e) => { e.stopPropagation(); toggleCatPicker(); });
document.addEventListener('click', (e) => {
  if (!$('qcCatPicker').contains(e.target)) $('qcCatPickerDropdown').classList.add('hidden');
});
$('qcPass').onclick = () => verdict('pass');
$('qcReject').onclick = () => verdict('reject');
$('qcSave').onclick = saveBoxes;
$('qcSettings').onclick = openSettings;
$('settingsClose').onclick = closeSettings;
$('settingsSave').onclick = saveSettings;
$('settingsReset').onclick = resetSettings;
$('settings').onclick = (e) => { if (e.target === $('settings')) closeSettings(); };
$('reviewerLoginClose').onclick = closeReviewerLogin;
$('reviewerLoginCancel').onclick = closeReviewerLogin;
$('reviewerLoginOk').onclick = submitReviewerLogin;
$('reviewerLogin').onclick = (e) => { if (e.target === $('reviewerLogin')) closeReviewerLogin(); };
document.querySelectorAll('.qc-tab').forEach((b) => { b.onclick = () => switchStatus(b.dataset.status); });

init();
