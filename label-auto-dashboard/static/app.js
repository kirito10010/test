/* Label Auto 看板 前端逻辑 */
'use strict';

const state = {
  user: null,
  projects: [],
  currentProjectId: null,
  categories: [],
  colors: {},
  queryResults: [],
  qcOwners: [],
  qcReviewers: [],
};

const $ = (id) => document.getElementById(id);

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 2200);
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[<>&"']/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

async function api(path, options) {
  const opts = Object.assign({ headers: {} }, options || {});
  if (opts.body && typeof opts.body === 'object') {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  const r = await fetch(path, opts);
  const ct = r.headers.get('Content-Type') || '';
  if (ct.includes('application/json')) {
    return await r.json();
  }
  return r;
}

/* ============ 项目 ============ */
async function loadProjects() {
  const r = await api('/api/projects');
  if (!r || !r.ok) return toast((r && r.error) || '加载项目失败');
  state.projects = r.projects || [];
  const sel = $('projectSel');
  sel.innerHTML = '';
  state.projects.forEach(p => {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.name;
    sel.appendChild(o);
  });
  if (state.projects.length) {
    state.currentProjectId = state.projects[0].id;
    await onProjectChange();
  }
}

async function onProjectChange() {
  state.currentProjectId = $('projectSel').value;
  const p = state.projects.find(x => x.id === state.currentProjectId);
  if (!p) return;
  state.categories = p.categories || [];
  state.colors = p.colors || {};
  // 渲染标签多选下拉（切项目后清空已选标签）
  selectedLabels.clear();
  renderLabelPicker();
  // 渲染质检员下拉（来自 monitoring）
  await loadMonitoring();
  // 项目切换后，若当前在「标签分布」页，重新渲染分布
  if (!$('tab-dist').classList.contains('hidden')) doDist();
  // 后台预加载该项目的质检时间，加速后续「按时间排序」
  api('/api/projects/' + state.currentProjectId + '/preload');
}

/* ============ 质检看板数据 ============ */
async function loadMonitoring(force) {
  const r = await api('/api/monitoring' + (force ? '?force=1' : ''));
  if (!r || !r.ok) return;
  state.qcOwners = [];
  state.qcReviewers = [];
  const owners = new Set();
  (r.projects || []).forEach(p => {
    if (p.id === state.currentProjectId) {
      (p.qc_assignees || []).forEach(a => {
        if (a && a.name) owners.add(a.name);
        if (a && a.uid) state.qcReviewers.push({ uid: a.uid, name: a.name || a.uid });
      });
    }
  });
  state.qcOwners = Array.from(owners);
  const osel = $('queryOwner');
  const cur = osel.value;
  osel.innerHTML = '<option value="">全部</option>';
  state.qcOwners.forEach(n => {
    const o = document.createElement('option');
    o.value = n; o.textContent = n; osel.appendChild(o);
  });
  osel.value = cur;
  renderFixOwner();
  const t = $('monitorTime');
  if (t) t.textContent = '快照时间：' + (r.generated_at || '未知');
  renderMonitor(r);
}

let monitorTimer = null;
function startMonitorAuto() {
  stopMonitorAuto();
  monitorTimer = setInterval(() => {
    if (!$('tab-monitor').classList.contains('hidden')) loadMonitoring();
  }, 30000);
}
function stopMonitorAuto() {
  if (monitorTimer) { clearInterval(monitorTimer); monitorTimer = null; }
}

/* ============ 归属修复 ============ */
function renderFixOwner() {
  const sel = $('fixOwner');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">请选择质检员</option>';
  state.qcReviewers.forEach(r => {
    const o = document.createElement('option');
    o.value = r.uid;
    o.textContent = r.name;
    sel.appendChild(o);
  });
  if (cur && state.qcReviewers.some(r => r.uid === cur)) sel.value = cur;
}
async function doFix() {
  if (!state.currentProjectId) { toast('请先选择项目'); return; }
  const uid = $('fixOwner').value;
  if (!uid) { toast('请先选择质检员'); return; }
  const btn = $('fixBtn');
  btn.disabled = true;
  $('fixSummary').textContent = '正在恢复归属…';
  let r;
  try {
    r = await api('/api/qc/fix', { method: 'POST', body: { pid: state.currentProjectId, uid } });
  } catch (e) {
    btn.disabled = false;
    $('fixSummary').textContent = '操作失败（网络或服务异常）';
    return;
  }
  btn.disabled = false;
  if (r && r.ok) {
    $('fixSummary').textContent = '共 ' + r.total + ' 张，成功 ' + r.succeeded + '，失败 ' + (r.failed || []).length;
  } else {
    $('fixSummary').textContent = (r && r.error) || '操作失败';
  }
}

/* ============ 标签页切换 ============ */
document.querySelectorAll('#tabs button').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('#tabs button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
    $('tab-' + tab).classList.remove('hidden');
    if (tab === 'monitor') { loadMonitoring(); startMonitorAuto(); }
    else stopMonitorAuto();
    if (tab === 'dist') doDist();
  };
});

/* ============ 标签巡检 ============ */
const selectedLabels = new Set();

function renderLabelPicker() {
  const dd = $('labelPickerDropdown');
  dd.innerHTML = '';
  (state.categories || []).forEach(c => {
    const lab = document.createElement('label');
    lab.className = 'label-picker-option';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = c;
    cb.checked = selectedLabels.has(c);
    cb.onchange = () => { cb.checked ? selectedLabels.add(c) : selectedLabels.delete(c); updateLabelPickerField(); };
    lab.appendChild(cb);
    lab.appendChild(document.createTextNode(c));
    dd.appendChild(lab);
  });
  updateLabelPickerField();
}

function updateLabelPickerField() {
  const el = $('labelPickerField');
  const labels = Array.from(selectedLabels);
  el.innerHTML = labels.length
    ? labels.map(l => `<span class="label-picker-tag">${escapeHtml(l)}</span>`).join('')
    : '<span class="placeholder">选择标签（可多选，留空查全部）</span>';
}

let _progressTimer = null;
function startQueryProgress() {
  const summary = $('querySummary');
  const update = async () => {
    try {
      const r = await api('/api/query_progress');
      if (r && r.ok && r.progress) {
        const p = r.progress;
        if (p.phase === 'export') {
          summary.textContent = '正在下载导出数据…';
        } else if (p.phase === 'annotation' && p.total) {
          summary.textContent = '正在拉取质检时间 ' + p.done + '/' + p.total + '…';
        }
      }
    } catch (e) { /* 忽略轮询错误 */ }
  };
  update();
  _progressTimer = setInterval(update, 1500);
}
function stopQueryProgress() {
  if (_progressTimer) { clearInterval(_progressTimer); _progressTimer = null; }
}

async function doQuery() {
  if (!state.currentProjectId) return toast('请先选择项目');
  const cat = Array.from(selectedLabels).join(',');
  const sort = $('querySort').value;
  const pm = $('queryPassedMinutes').value;
  const params = [];
  if (cat) params.push('cat=' + encodeURIComponent(cat));
  if (sort) params.push('sort=' + sort);
  if (pm) params.push('passed_minutes=' + pm);
  const url = '/api/projects/' + state.currentProjectId + '/query' + (params.length ? '?' + params.join('&') : '');
  toast(pm ? '查询最近通过的数据…' : (sort ? '按质检时间排序中，请稍候…' : (cat ? '查询中，请稍候…' : '加载全部图片中…')));
  startQueryProgress();
  let r;
  try {
    r = await api(url);
  } finally {
    stopQueryProgress();
  }
  if (!r || !r.ok) { $('querySummary').textContent = ''; toast((r && r.error) || '查询失败'); return; }
  state.queryResults = r.results || [];
  renderQuery(state.queryResults);
}

function renderQuery(results) {
  const status = $('queryStatus').value;
  const owner = $('queryOwner').value;
  let rows = results;
  if (status) rows = rows.filter(r => r.qc_status === status);
  if (owner) rows = rows.filter(r => r.qc_owner === owner);

  const totalBoxes = rows.reduce((s, r) => s + (r.box_count != null ? r.box_count : r.boxes.length), 0);
  $('querySummary').innerHTML =
    `命中 <strong>${results.length}</strong> 张图，筛选后 <strong>${rows.length}</strong> 张（框数 ${totalBoxes}）`;

  const tbody = $('queryTable').querySelector('tbody');
  tbody.innerHTML = '';
  $('queryTable').classList.toggle('hidden', rows.length === 0);
  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.className = 'clickable';
    tr.onclick = () => openPreview(r.image_id);
    const boxes = (r.boxes && r.boxes.length)
      ? r.boxes.map(b => `(${b.x},${b.y},${b.w},${b.h})`).join('；')
      : `${r.box_count != null ? r.box_count : r.boxes.length} 框`;
    tr.innerHTML = `<td class="ck"><input type="checkbox" class="rowCheck" data-id="${escapeHtml(r.image_id)}"></td>` +
      `<td>${escapeHtml(r.image_id)}</td><td>${escapeHtml(boxes)}</td>` +
      `<td><span class="badge ${escapeHtml(r.qc_status || 'unknown')}">${statusText(r.qc_status)}</span></td>` +
      `<td>${escapeHtml(r.qc_owner || '-')}</td>` +
      `<td>${escapeHtml(r.reviewed_at || '-')}</td>`;
    tr.querySelector('.rowCheck').onclick = e => { e.stopPropagation(); updateQueryCount(); };
    tbody.appendChild(tr);
  });
  $('querySelectAll').checked = false;
  updateQueryCount();
}

function getSelectedIds(scope) {
  return Array.from(document.querySelectorAll((scope || '#queryTable') + ' .rowCheck:checked'))
    .map(c => c.dataset.id);
}

function updateSelectedCount(scope, btn, label) {
  const n = getSelectedIds(scope).length;
  btn.textContent = n > 0 ? `${label} (${n})` : label;
}

async function batchQc(scope, verdict, afterFn) {
  const ids = getSelectedIds(scope);
  if (!ids.length) return toast('请先勾选图片');
  if (!state.currentProjectId) return toast('请先选择项目');
  const act = verdict === 'pass' ? '通过' : '打回';
  if (!confirm(`确定将 ${ids.length} 张图${act}吗？`)) return;
  toast(`批量${act}中…`);
  const r = await api('/api/projects/' + state.currentProjectId + '/batch_qc', {
    method: 'POST', body: { image_ids: ids, verdict, reason: '' }
  });
  if (!r || !r.ok) { toast((r && r.error) || `批量${act}失败`); return; }
  const failedN = (r.failed && r.failed.length) || 0;
  toast(`${act}成功 ${r.succeeded} 张` + (failedN ? `，失败 ${failedN} 张` : ''));
  if (afterFn) afterFn();
}

function updateQueryCount() {
  updateSelectedCount('#queryTable', $('batchRejectBtn'), '批量打回');
  updateSelectedCount('#queryTable', $('batchPassBtn'), '批量通过');
}

function updateSearchCount() {
  updateSelectedCount('#searchTable', $('searchBatchRejectBtn'), '批量打回');
  updateSelectedCount('#searchTable', $('searchBatchPassBtn'), '批量通过');
}

function statusText(s) {
  return { passed: '已通过', pending: '待质检', rejected: '已打回' }[s] || s || '未知';
}

/* ============ 漏标 ============ */
async function doLeak() {
  const cats = $('leakCats').value.split(/[,，]/).map(s => s.trim()).filter(Boolean);
  if (!cats.length) return toast('请填写异常标签');
  if (!state.currentProjectId) return toast('请先选择项目');
  toast('扫描漏标中…');
  const r = await api('/api/projects/' + state.currentProjectId + '/leak?cats=' + encodeURIComponent(cats.join(',')));
  if (!r || !r.ok) { toast((r && r.error) || '扫描失败'); return; }
  const results = r.results || [];
  $('leakSummary').innerHTML = `质检通过但带异常标签的图：<strong>${results.length}</strong> 张`;
  const tbody = $('leakTable').querySelector('tbody');
  tbody.innerHTML = '';
  $('leakTable').classList.toggle('hidden', results.length === 0);
  results.forEach(r => {
    const tr = document.createElement('tr');
    tr.className = 'clickable';
    tr.onclick = () => openPreview(r.image_id);
    const boxes = r.boxes.map(b => `(${b.x},${b.y},${b.w},${b.h})`).join('；');
    tr.innerHTML = `<td>${escapeHtml(r.image_id)}</td><td>${escapeHtml(boxes)}</td><td>${escapeHtml(r.qc_owner || '-')}</td>`;
    tbody.appendChild(tr);
  });
}

/* ============ 质检看板 ============ */
function renderMonitor(data) {
  if (!data || !data.projects) return;
  const p = data.projects.find(x => x.id === state.currentProjectId) || data.projects[0];
  if (!p) return;

  $('monitorSummary').innerHTML =
    `项目「${escapeHtml(p.name)}」：总图 ${p.total_images}，已标注 ${p.total_annotated}，` +
    `质检通过 <strong>${p.total_qc_passed}</strong>，打回 <strong>${p.total_qc_rejected}</strong>，` +
    `标注进度 ${(p.progress || 0).toFixed(1)}%，质检进度 ${(p.qc_progress || 0).toFixed(1)}%`;

  let html = '<div class="panel"><h3>质检员统计</h3><div class="table-wrap"><table>' +
    '<thead><tr><th>质检员</th><th>分配</th><th>已通过</th><th>已打回</th><th>进度</th></tr></thead><tbody>';
  (p.qc_assignees || []).forEach(a => {
    const passed = a.passed || 0, rejected = a.rejected || 0, assigned = a.assigned || 0;
    html += `<tr><td>${escapeHtml(a.name || a.email || a.uid)}</td><td>${assigned}</td>` +
      `<td>${passed}</td><td>${rejected}</td><td>${(a.progress || 0).toFixed(1)}%</td></tr>`;
  });
  html += '</tbody></table></div></div>';

  html += '<div class="panel"><h3>标注员统计</h3><div class="table-wrap"><table>' +
    '<thead><tr><th>标注员</th><th>分配</th><th>已标注</th><th>进度</th><th>质检通过</th><th>打回</th><th>有效率</th></tr></thead><tbody>';
  (p.assignees || []).forEach(a => {
    html += `<tr><td>${escapeHtml(a.name || a.email || a.uid)}</td><td>${a.assigned || 0}</td>` +
      `<td>${a.annotated || 0}</td><td>${(a.progress != null ? a.progress.toFixed(1) : '-')}%</td>` +
      `<td>${a.qc_passed || 0}</td><td>${a.qc_rejected || 0}</td>` +
      `<td>${(a.valid_rate != null ? a.valid_rate.toFixed(1) : '-')}%</td></tr>`;
  });
  html += '</tbody></table></div></div>';

  $('monitorContent').innerHTML = html;
}

/* ============ 标签分布 ============ */
async function doDist() {
  const el = $('distContent');
  if (!state.currentProjectId) {
    el.innerHTML = '<div class="hint">请先登录并选择项目。</div>';
    return;
  }
  el.innerHTML = '<div class="hint">加载中…</div>';
  const r = await api('/api/projects/' + state.currentProjectId + '/distribution');
  if (!r || !r.ok) {
    el.innerHTML = '<div class="hint">加载失败：' + escapeHtml((r && r.error) || '未知错误') + '</div>';
    return;
  }
  const dist = r.distribution || [];
  const max = Math.max(1, ...dist.map(d => d.count));
  let html = '<div class="panel"><h3>标签分布</h3>';
  dist.forEach(d => {
    const w = (d.count / max * 100).toFixed(1);
    html += `<div class="bar-row"><div class="cat">${escapeHtml(d.category)}</div>` +
      `<div class="bar-track"><div class="bar-fill" style="width:${w}%"></div></div>` +
      `<div class="cnt">${d.count}</div></div>`;
  });
  html += '</div>';
  el.innerHTML = html;
}

/* ============ 图片搜索 ============ */
async function doSearch() {
  const q = $('searchInput').value.trim();
  if (!q) return toast('请输入文件名');
  if (!state.currentProjectId) return toast('请先选择项目');
  const r = await api('/api/projects/' + state.currentProjectId + '/search?q=' + encodeURIComponent(q));
  if (!r || !r.ok) { toast((r && r.error) || '搜索失败'); return; }
  const results = r.results || [];
  $('searchSummary').innerHTML = `匹配 <strong>${results.length}</strong> 张图`;
  const tbody = $('searchTable').querySelector('tbody');
  tbody.innerHTML = '';
  $('searchTable').classList.toggle('hidden', results.length === 0);
  results.forEach(x => {
    const tr = document.createElement('tr');
    tr.className = 'clickable';
    tr.onclick = () => openPreview(x.image_id);
    tr.innerHTML = `<td class="ck"><input type="checkbox" class="rowCheck" data-id="${escapeHtml(x.image_id)}"></td>` +
      `<td>${escapeHtml(x.image_id)}</td><td>${x.box_count ?? '-'}</td>` +
      `<td><span class="badge ${escapeHtml(x.qc_status || 'unknown')}">${statusText(x.qc_status)}</span></td>` +
      `<td>${escapeHtml(x.qc_owner || '-')}</td>`;
    tr.querySelector('.rowCheck').onclick = e => { e.stopPropagation(); updateSearchCount(); };
    tbody.appendChild(tr);
  });
  $('searchSelectAll').checked = false;
  updateSearchCount();
}

/* ============ 照片详情面板 ============ */
let detailToken = 0;
async function openPreview(imageId) {
  const myToken = ++detailToken;
  const modal = $('previewModal');
  modal.classList.remove('hidden');
  $('previewTitle').textContent = imageId;
  $('previewInfo').innerHTML = '<div class="row">加载中…</div>';

  const img = $('previewImg');
  img.onload = async () => {
    if (myToken !== detailToken) return;
    drawBoxes(img, []);
    try {
      const ann = await api('/api/projects/' + state.currentProjectId + '/annotation?image_id=' + encodeURIComponent(imageId));
      if (myToken !== detailToken) return;
      if (ann && ann.ok && ann.boxes) {
        drawBoxes(img, ann.boxes);
        const cats = ann.boxes.map(b => b.category + (b.source === 'pre' ? '[预]' : '')).join('、');
        $('previewInfo').innerHTML =
          `<div class="row"><b>状态：</b>${statusText(ann.qc_status)}</div>` +
          `<div class="row"><b>框数：</b>${ann.boxes.length}</div>` +
          `<div class="row"><b>标签：</b>${escapeHtml(cats) || '无'}</div>`;
      }
    } catch (e) { /* 忽略 */ }
  };
  img.onerror = () => { if (myToken === detailToken) $('previewInfo').innerHTML = '<div class="row">图片加载失败</div>'; };
  img.src = '/api/projects/' + state.currentProjectId + '/image?image_id=' + encodeURIComponent(imageId);
}

function colorFor(cat) {
  if (state.colors && state.colors[cat]) return state.colors[cat];
  let h = 0;
  for (let i = 0; i < cat.length; i++) h = (h * 31 + cat.charCodeAt(i)) % 360;
  return `hsl(${h},70%,45%)`;
}

function closePreview() {
  detailToken++;
  $('previewTitle').textContent = '照片详情';
  const img = $('previewImg');
  img.onload = img.onerror = null;
  img.removeAttribute('src');
  const c = $('previewCanvas');
  c.getContext('2d').clearRect(0, 0, c.width, c.height);
  $('previewInfo').textContent = '点击图片查看详情';
  $('previewModal').classList.add('hidden');
}

function drawBoxes(img, boxes) {
  const c = $('previewCanvas');
  const wrap = $('previewImageWrap');
  const Wc = wrap.clientWidth;
  const Hc = wrap.clientHeight;
  const Wi = img.naturalWidth;
  const Hi = img.naturalHeight;
  if (!Wi || !Hi || !Wc || !Hc) return;
  c.width = Wc;
  c.height = Hc;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, Wc, Hc);
  if (!boxes || !boxes.length) return;
  const scale = Math.min(Wc / Wi, Hc / Hi);
  const dw = Wi * scale, dh = Hi * scale;
  const ox = (Wc - dw) / 2, oy = (Hc - dh) / 2;
  boxes.forEach(b => {
    const bb = b.bbox || {};
    const x1 = ox + (bb.x1 || 0) * dw;
    const y1 = oy + (bb.y1 || 0) * dh;
    const x2 = ox + (bb.x2 || 0) * dw;
    const y2 = oy + (bb.y2 || 0) * dh;
    const color = colorFor(b.category || '');
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, dw / 400);
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    ctx.fillStyle = color;
    ctx.font = Math.max(12, dw / 60) + 'px sans-serif';
    const label = `${b.category || ''}${b.source === 'pre' ? ' [预]' : ''}`;
    ctx.fillText(label, x1, Math.max(y1 - 4, 14));
  });
}

/* ============ 导出 ============ */
function doExport() {
  if (!state.currentProjectId) return toast('请先选择项目');
  const mode = $('exportMode').value;
  toast('导出生成中，请稍候…');
  const a = document.createElement('a');
  a.href = '/api/export/' + state.currentProjectId + '?mode=' + mode;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/* ============ CSV 导出 ============ */
function exportQueryCsv() {
  if (!state.queryResults.length) return toast('没有可导出的结果');
  const rows = [['图片', '框坐标', '状态', '质检员']];
  state.queryResults.forEach(r => {
    const boxes = (r.boxes && r.boxes.length)
      ? r.boxes.map(b => `${b.x},${b.y},${b.w},${b.h}`).join(' | ')
      : `${r.box_count != null ? r.box_count : r.boxes.length} 框`;
    rows.push([r.image_id, boxes, statusText(r.qc_status), r.qc_owner || '']);
  });
  const csv = '\uFEFF' + rows.map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '标签巡检结果.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ============ 事件绑定 ============ */
$('projectSel').onchange = onProjectChange;
$('refreshBtn').onclick = () => { loadProjects(); loadMonitoring(); };
$('monitorRefreshBtn').onclick = () => loadMonitoring(true);
$('searchBtn').onclick = doSearch;
$('searchInput').onkeydown = e => { if (e.key === 'Enter') doSearch(); };
$('searchSelectAll').onchange = e => {
  document.querySelectorAll('#searchTable .rowCheck').forEach(c => { c.checked = e.target.checked; });
  updateSearchCount();
};
$('searchBatchRejectBtn').onclick = () => batchQc('#searchTable', 'reject', doSearch);
$('searchBatchPassBtn').onclick = () => batchQc('#searchTable', 'pass', doSearch);
$('queryBtn').onclick = doQuery;
$('labelPickerField').onclick = e => { e.stopPropagation(); $('labelPickerDropdown').classList.toggle('hidden'); };
document.addEventListener('click', e => {
  if (!$('labelPicker').contains(e.target)) $('labelPickerDropdown').classList.add('hidden');
});
$('queryStatus').onchange = () => renderQuery(state.queryResults);
$('queryOwner').onchange = () => renderQuery(state.queryResults);
$('queryExportBtn').onclick = exportQueryCsv;
$('querySelectAll').onchange = e => {
  document.querySelectorAll('#queryTable .rowCheck').forEach(c => { c.checked = e.target.checked; });
  updateQueryCount();
};
$('batchRejectBtn').onclick = () => batchQc('#queryTable', 'reject', () => { if (state.queryResults.length) doQuery(); });
$('batchPassBtn').onclick = () => batchQc('#queryTable', 'pass', () => { if (state.queryResults.length) doQuery(); });
$('leakBtn').onclick = doLeak;
$('exportBtn').onclick = doExport;
$('fixBtn').onclick = doFix;
$('previewClose').onclick = closePreview;
$('previewModal').onclick = e => { if (e.target === $('previewModal')) closePreview(); };

/* ============ 启动 ============ */
(async function boot() {
  let me = await api('/api/me');
  if (me && me.user) {
    state.user = me.user;
  } else {
    // 未登录则自动登录（于荣华）
    const r = await api('/api/autologin');
    if (r && r.ok) state.user = r.user;
  }
  $('projectBar').classList.remove('hidden');
  await loadProjects();
})();
