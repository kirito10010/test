/* ============================================================
   label_auto v3 — 多用户 + Sidebar + Projects/Editor
   ============================================================ */
'use strict';

const S = {
  user: null,
  authMode: 'login',
  view: 'projects',              // 'auth' | 'projects' | 'editor'
  sidebarCollapsed: false,

  projects: [], projectsSearch: '',
  currentProject: null,

  // Editor
  images: [], filtered: [],
  filter: 'all', search: '',
  currentIdx: -1, currentImageId: null,
  boxes: [],
  history: [], future: [],
  currentCat: null,
  selectedIdx: -1, hoverIdx: -1,
  dragging: null,
  scale: 1, offsetX: 0, offsetY: 0,
  img: null,
  tool: 'rect',
  showRaw: false,
  spacePressed: false,
  isDirty: false,
  activeTab: 'labels',
};

const $ = (id) => document.getElementById(id);
function escape(s) { return String(s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c])); }

function toast(msg, type = 'ok') {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'ls-toast show ' + type;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.className = 'ls-toast'; }, 1800);
}

// 会话 token 存放在 sessionStorage（**每个标签页独立**，从而支持同一浏览器
// 里两个标签分别登录不同账号；F5 刷新仍保留）
const TOKEN_KEY = 'la_token';
function getToken() { return sessionStorage.getItem(TOKEN_KEY) || ''; }
function setToken(t) {
  if (t) sessionStorage.setItem(TOKEN_KEY, t);
  else   sessionStorage.removeItem(TOKEN_KEY);
}

async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const tk = getToken();
  if (tk) headers['Authorization'] = 'Bearer ' + tk;
  // 'omit' 表示 fetch 不带 Cookie。这样多个标签互不影响：
  //   每个标签自己 sessionStorage 里的 token 才是它当前身份
  const opt = { method, headers, credentials: 'omit' };
  if (body) opt.body = JSON.stringify(body);
  const r = await fetch(path, opt);
  return { status: r.status, ...(await r.json()) };
}

// ========================================================
// 认证 Modal
// ========================================================
function openAuthModal(mode = 'login') {
  setAuthMode(mode);
  $('authEmail').value = '';
  $('authPassword').value = '';
  $('authDisplayName').value = '';
  $('authErr').textContent = '';
  $('authModal').classList.remove('hidden');
  setTimeout(() => $('authEmail').focus(), 30);
}
function closeAuthModal() {
  $('authModal').classList.add('hidden');
}
$('authModalClose').onclick = closeAuthModal;

function setAuthMode(mode) {
  S.authMode = mode;
  document.querySelectorAll('.ls-auth-tab').forEach(t => {
    t.classList.toggle('ls-auth-tab-active', t.dataset.mode === mode);
  });
  $('authNameGroup').style.display = mode === 'register' ? '' : 'none';
  $('authSubmitBtn').textContent = mode === 'register' ? '注册并登录' : '登录';
  $('authPwdHint').textContent = mode === 'register' ? '至少 6 位' : '';
  $('authErr').textContent = '';
}
document.querySelectorAll('.ls-auth-tab').forEach(t => t.onclick = () => setAuthMode(t.dataset.mode));

$('authSubmitBtn').onclick = doAuth;
$('authPassword').onkeydown = (e) => { if (e.key === 'Enter') doAuth(); };
$('authEmail').onkeydown = (e) => { if (e.key === 'Enter') $('authPassword').focus(); };
$('guestLoginBtn').onclick = () => openAuthModal('login');

async function doAuth() {
  const email = $('authEmail').value.trim();
  const pwd = $('authPassword').value;
  const name = $('authDisplayName').value.trim();
  if (!email) return ($('authErr').textContent = '请输入邮箱');
  if (!pwd) return ($('authErr').textContent = '请输入密码');

  const path = S.authMode === 'register' ? '/api/register' : '/api/login';
  const r = await api('POST', path, { email, password: pwd, display_name: name });
  if (!r.ok) return ($('authErr').textContent = r.error || '失败');
  if (r.token) setToken(r.token);         // 该标签的独立身份
  S.user = r.user;
  closeAuthModal();
  applyAuthState();
  toast(S.authMode === 'register' ? '注册成功' : '登录成功', 'ok');
  // 登录后自动刷新项目列表
  if (S.view === 'projects') loadProjects();
}

async function doLogout() {
  await api('POST', '/api/logout');
  setToken('');                            // 清除本标签 token
  S.user = null;
  S.projects = []; S.currentProject = null;
  $('userMenu').classList.add('hidden');
  applyAuthState();
  goProjects();
  toast('已退出登录', 'ok');
}
$('logoutBtn').onclick = doLogout;

function applyAuthState() {
  const logged = !!S.user;
  $('guestLoginBtn').classList.toggle('hidden', logged);
  $('accountWrap').classList.toggle('hidden', !logged);
  if (logged) renderUserInfo();
  applyRoleVisibility();
}

/** 根据当前用户角色控制 Sidebar 「用户管理」入口的可见性 */
function applyRoleVisibility() {
  const item = $('adminNavItem');
  const monitor = $('monitorNavItem');
  const qc = $('qcNavItem');
  const role = S.user && S.user.role;
  const canSeeAdmin = role === 'root' || role === 'admin';
  // 质检入口：Admin/Root 可见，或该用户是任一项目的 qc_assignees
  const isQCer = !!(S.projects || []).some(p => p.is_qc ||
      (p.qc_assignees || []).includes(S.user && S.user.id));
  const canSeeQC = canSeeAdmin || isQCer;
  if (item) item.classList.toggle('hidden', !canSeeAdmin);
  if (monitor) monitor.classList.toggle('hidden', !canSeeAdmin);
  if (qc) qc.classList.toggle('hidden', !canSeeQC);
  // 创建项目按钮：仅 Admin/Root 可见
  const createBtn = $('createProjectBtn');
  if (createBtn) createBtn.classList.toggle('hidden', !(role === 'root' || role === 'admin'));
  // 未登录或降级后若正在 admin/monitor 页，回退到项目页
  if (!canSeeAdmin && (S.view === 'admin' || S.view === 'monitor')) goProjects();
}

function renderUserInfo() {
  const u = S.user;
  if (!u) return;
  const initial = (u.display_name || u.email).charAt(0).toUpperCase();
  $('userAvatar').textContent = initial;
  $('userName').textContent = u.display_name || u.email;
  $('userEmail').textContent = u.email;
  $('userMenuName').textContent = u.display_name || u.email;
  $('userMenuEmail').textContent = u.email;
}

/** 需要登录才能做的操作 → 未登录先弹 Modal，返回 true 表示已阻止 */
function requireLogin(msg) {
  if (S.user) return false;
  toast(msg || '请先登录', 'err');
  openAuthModal('login');
  return true;
}

// ========================================================
// Sidebar
// ========================================================
$('sidebarToggle').onclick = () => {
  S.sidebarCollapsed = !S.sidebarCollapsed;
  $('sidebar').classList.toggle('collapsed', S.sidebarCollapsed);
  try { localStorage.setItem('la_sidebar_collapsed', S.sidebarCollapsed ? '1' : '0'); } catch (e) {}
  if (S.view === 'editor') setTimeout(fitCanvasToStage, 200);
};

// User menu
$('userMenuBtn').onclick = (e) => {
  e.stopPropagation();
  $('userMenu').classList.toggle('hidden');
};
document.addEventListener('click', (e) => {
  const menu = $('userMenu');
  if (!menu.classList.contains('hidden') &&
      !menu.contains(e.target) && !$('userMenuBtn').contains(e.target)) {
    menu.classList.add('hidden');
  }
});

document.querySelectorAll('.ls-sidebar-item[data-nav]').forEach(item => {
  item.onclick = () => {
    if (item.disabled) return;
    const nav = item.dataset.nav;
    if (nav === 'admin' && item.classList.contains('hidden')) return;
    if (nav === 'monitor' && item.classList.contains('hidden')) return;
    if (nav === 'qc' && item.classList.contains('hidden')) return;
    document.querySelectorAll('.ls-sidebar-item').forEach(i => i.classList.remove('ls-sidebar-item-active'));
    item.classList.add('ls-sidebar-item-active');
    if (nav === 'projects') goProjects();
    else if (nav === 'admin') goAdmin();
    else if (nav === 'monitor') goMonitor();
    else if (nav === 'qc') goQC();
  };
});

// ========================================================
// 页面切换
// ========================================================
function goProjects() {
  S.view = 'projects';
  S.projectsFilterMode = 'all';
  $('projectsPage').classList.remove('hidden');
  $('editorPage').classList.add('hidden');
  const ap = $('adminPage'); if (ap) ap.classList.add('hidden');
  const mp = $('monitorPage'); if (mp) mp.classList.add('hidden');
  const cp = $('projectConfigPage'); if (cp) cp.classList.add('hidden');
  // 同步 sidebar 高亮
  document.querySelectorAll('.ls-sidebar-item').forEach(i => i.classList.remove('ls-sidebar-item-active'));
  const pItem = document.querySelector('.ls-sidebar-item[data-nav="projects"]');
  if (pItem) pItem.classList.add('ls-sidebar-item-active');
  loadProjects();
}

async function goAdmin() {
  if (requireLogin('请先登录')) return;
  const role = S.user && S.user.role;
  if (role !== 'root' && role !== 'admin') {
    toast('无权限访问', 'err');
    return goProjects();
  }
  S.view = 'admin';
  $('projectsPage').classList.add('hidden');
  $('editorPage').classList.add('hidden');
  $('adminPage').classList.remove('hidden');
  const mp = $('monitorPage'); if (mp) mp.classList.add('hidden');
  const cp = $('projectConfigPage'); if (cp) cp.classList.add('hidden');
  // 同步 sidebar 高亮
  document.querySelectorAll('.ls-sidebar-item').forEach(i => i.classList.remove('ls-sidebar-item-active'));
  const aItem = document.querySelector('.ls-sidebar-item[data-nav="admin"]');
  if (aItem) aItem.classList.add('ls-sidebar-item-active');
  await loadAdminUsers();
}

async function goMonitor() {
  if (requireLogin('请先登录')) return;
  const role = S.user && S.user.role;
  if (role !== 'root' && role !== 'admin') {
    toast('无权限访问', 'err');
    return goProjects();
  }
  S.view = 'monitor';
  $('projectsPage').classList.add('hidden');
  $('editorPage').classList.add('hidden');
  const ap = $('adminPage'); if (ap) ap.classList.add('hidden');
  $('monitorPage').classList.remove('hidden');
  const cp = $('projectConfigPage'); if (cp) cp.classList.add('hidden');
  document.querySelectorAll('.ls-sidebar-item').forEach(i => i.classList.remove('ls-sidebar-item-active'));
  const mItem = document.querySelector('.ls-sidebar-item[data-nav="monitor"]');
  if (mItem) mItem.classList.add('ls-sidebar-item-active');
  await loadMonitoring();
}

// ============ 项目配置（Admin/Root 点击项目卡片进入这里，而不是标注器）=============
async function goProjectConfig(project) {
  if (requireLogin('请先登录')) return;
  S.view = 'project_config';
  S.currentProject = project;
  $('projectsPage').classList.add('hidden');
  $('editorPage').classList.add('hidden');
  const ap = $('adminPage'); if (ap) ap.classList.add('hidden');
  const mp = $('monitorPage'); if (mp) mp.classList.add('hidden');
  $('projectConfigPage').classList.remove('hidden');
  // sidebar 高亮维持"项目"
  document.querySelectorAll('.ls-sidebar-item').forEach(i => i.classList.remove('ls-sidebar-item-active'));
  const pItem = document.querySelector('.ls-sidebar-item[data-nav="projects"]');
  if (pItem) pItem.classList.add('ls-sidebar-item-active');
  await loadProjectConfig();
}

async function loadProjectConfig() {
  const p = S.currentProject; if (!p) return;
  // 项目基本信息（先用本地已有的填充；进度需要从监测接口取）
  $('pcTitle').textContent = p.name || '项目配置';
  $('pcName').textContent = p.name || '-';
  $('pcMeta').textContent = `${p.task_type || ''} · 创建于 ${p.created_at || '-'}`;
  $('pcPath').textContent = '图片目录：' + (p.image_dir || '-');
  // 拉当前项目的分配进度
  const r = await api('GET', '/api/admin/monitoring');
  let entry = null;
  if (r.ok) entry = (r.projects || []).find(x => x.id === p.id);
  renderProjectConfig(entry || {
    id: p.id, total_images: 0, total_annotated: 0, progress: 0, assignees: [],
  });
  renderPcCategories();
}

function renderProjectConfig(entry) {
  const list = entry.assignees || [];
  $('pcAssigneeMeta').textContent = list.length ? `共 ${list.length} 名标注员` : '暂未分配标注员';
  const tbody = $('pcAssigneesRows');
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="ls-admin-loading" style="padding:20px">暂未分配标注员</td></tr>';
  } else {
    tbody.innerHTML = list.map(m => `
      <tr>
        <td><div class="ls-admin-user-cell">
          <span class="ls-admin-avatar">${escape((m.name || '?').charAt(0).toUpperCase())}</span>
          <span class="ls-admin-name">${escape(m.name || '')}</span>
        </div></td>
        <td class="ls-admin-email">${escape(m.email || '')}</td>
        <td class="ls-monitor-num">${m.assigned}</td>
        <td>
          <button class="ls-btn ls-btn-sm" style="color:#B42318;border-color:#F5C2C0"
            data-remove-assignee="${escape(m.uid)}" title="移除标注员，其名下的图会平均分给剩下的人">移除</button>
        </td>
      </tr>`).join('');
    tbody.querySelectorAll('[data-remove-assignee]').forEach(btn => {
      btn.onclick = () => removeProjectMember(btn.dataset.removeAssignee, 'assignee');
    });
  }

  const qcList = entry.qc_assignees || [];
  const qcMeta = $('pcQCMeta');
  if (qcMeta) qcMeta.textContent = qcList.length ? `共 ${qcList.length} 名质检员` : '暂未分配质检员';
  const qcTbody = $('pcQCRows');
  if (qcTbody) {
    if (!qcList.length) {
      qcTbody.innerHTML = '<tr><td colspan="4" class="ls-admin-loading" style="padding:20px">暂未分配质检员</td></tr>';
    } else {
      qcTbody.innerHTML = qcList.map(q => `
        <tr>
          <td><div class="ls-admin-user-cell">
            <span class="ls-admin-avatar">${escape((q.name || '?').charAt(0).toUpperCase())}</span>
            <span class="ls-admin-name">${escape(q.name || '')}</span>
          </div></td>
          <td class="ls-admin-email">${escape(q.email || '')}</td>
          <td class="ls-monitor-num">${q.assigned || 0}</td>
          <td>
            <button class="ls-btn ls-btn-sm" style="color:#B42318;border-color:#F5C2C0"
              data-remove-qc="${escape(q.uid)}" title="移除质检员，其名下的图会平均分给剩下的人">移除</button>
          </td>
        </tr>`).join('');
      qcTbody.querySelectorAll('[data-remove-qc]').forEach(btn => {
        btn.onclick = () => removeProjectMember(btn.dataset.removeQc, 'qc');
      });
    }
  }
}

async function removeProjectMember(memberId, roleKind) {
  if (!S.currentProject) return;
  const label = roleKind === 'qc' ? '质检员' : '标注员';
  if (!confirm(`确定要移除这名${label}吗？TA 名下所有图片（包括已标注/已通过/被打回/待处理）都会平均分给剩下的${label}；若已无剩余${label}，这些图会变成"未分配"。`)) return;
  const r = await api('DELETE', '/api/projects/' + S.currentProject.id + '/members/' + memberId + '?role=' + roleKind);
  if (r.ok) {
    S.currentProject = r.project;
    toast(`已移除该${label}，图片已重新分配`, 'ok');
    await loadProjectConfig();
  } else {
    toast(r.error || '移除失败', 'err');
  }
}

function renderPcCategories() {
  const p = S.currentProject; if (!p) return;
  const el = $('pcCategories'); if (!el) return;
  const cats = p.categories || [];
  if (!cats.length) {
    el.innerHTML = '<div class="ls-form-hint">还没有标签类别。点击右上角"添加标签"</div>';
    return;
  }
  el.innerHTML = cats.map((cat, i) => {
    const color = (p.colors || {})[cat] || '#888';
    return `<div class="ls-assignee-chip on" data-cat="${escape(cat)}">
      <span class="ls-tag-created-dot" style="background:${color}"></span>
      <span class="ls-assignee-name">${escape(cat)}</span>
      <button class="ls-tag-created-x" data-idx="${i}" title="删除">
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>`;
  }).join('');
  el.querySelectorAll('.ls-tag-created-x').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const idx = +btn.dataset.idx;
      const cat = (p.categories || [])[idx];
      if (!cat) return;
      if (!confirm(`确定要删除标签 "${cat}" 吗？`)) return;
      const newCats = (p.categories || [])
        .filter((_, i) => i !== idx)
        .map(name => ({ name, color: (p.colors || {})[name] || '#4C6EF5' }));
      const r = await api('PATCH', '/api/projects/' + p.id, { categories: newCats });
      if (r.ok && r.project) {
        S.currentProject = r.project;
        renderPcCategories();
        toast('已删除', 'ok');
      } else {
        toast(r.error || '删除失败', 'err');
      }
    };
  });
}

// 事件：项目配置页
document.addEventListener('DOMContentLoaded', () => {
  const bk = document.getElementById('pcBackBtn');
  if (bk) bk.onclick = () => goProjects();
  const rf = document.getElementById('pcRefreshBtn');
  if (rf) rf.onclick = () => loadProjectConfig();
  const del = document.getElementById('pcDeleteBtn');
  if (del) del.onclick = async () => {
    const p = S.currentProject; if (!p) return;
    if (!confirm(`确定要删除项目 "${p.name}" 吗？此操作不可恢复。`)) return;
    const r = await api('DELETE', '/api/projects/' + p.id);
    if (r.ok) { toast('项目已删除', 'ok'); goProjects(); await loadProjects(); }
    else toast(r.error || '删除失败', 'err');
  };
  const add = document.getElementById('pcAddTagBtn');
  if (add) add.onclick = () => {
    // 复用已有的 tagModal 项目模式
    if (!S.currentProject) return;
    _tagModalMode = 'project';
    _createTags = S.currentProject.categories.map(name => ({
      name, color: (S.currentProject.colors || {})[name] || '#4C6EF5',
    }));
    _tagEditIndex = -1;
    _tagSelectedColor = null;
    $('tagModalTitle').textContent = '添加标签（当前项目）';
    $('tagSubmitBtn').textContent = '添加';
    $('tagName').value = '';
    $('tagErr').textContent = '';
    renderColorGrid();
    renderCreatedTags();
    $('tagModal').classList.remove('hidden');
    setTimeout(() => $('tagName').focus(), 30);
  };

  // ---- 临时追加标注员 ----
  const addAssigneeBtn = document.getElementById('pcAddAssigneeBtn');
  const addAssigneePanel = document.getElementById('pcAddAssigneePanel');
  const addAssigneeList = document.getElementById('pcAddAssigneeList');
  let _pcNewAssignees = [];
  if (addAssigneeBtn) {
    addAssigneeBtn.onclick = async () => {
      if (!S.currentProject) return;
      _pcNewAssignees = [];
      await loadMyMembersForPicker();
      const existing = new Set(S.currentProject.assignees || []);
      const existingQC = new Set(S.currentProject.qc_assignees || []);
      const candidates = _availableMembers.filter(m =>
        (m.role || 'member') === 'member' && !existing.has(m.id) && !existingQC.has(m.id));
      if (!candidates.length) {
        addAssigneeList.innerHTML = '<div class="ls-form-hint">没有可追加的标注员（组下的标注员都已在本项目里，或还没有标注员组员）</div>';
      } else {
        addAssigneeList.innerHTML = candidates.map(m => `
          <label class="ls-assignee-chip">
            <input type="checkbox" data-uid="${escape(m.id)}">
            <span class="ls-assignee-avatar">${escape((m.display_name || m.email || '?').charAt(0).toUpperCase())}</span>
            <span class="ls-assignee-name">${escape(m.display_name || m.email || '')}</span>
          </label>`).join('');
        addAssigneeList.querySelectorAll('input[type=checkbox]').forEach(cb => {
          cb.onchange = () => {
            const uid = cb.dataset.uid;
            if (cb.checked) { if (!_pcNewAssignees.includes(uid)) _pcNewAssignees.push(uid); }
            else { _pcNewAssignees = _pcNewAssignees.filter(x => x !== uid); }
            cb.closest('.ls-assignee-chip').classList.toggle('on', cb.checked);
          };
        });
      }
      addAssigneePanel.classList.remove('hidden');
    };
  }
  const addAssigneeCancel = document.getElementById('pcAddAssigneeCancel');
  if (addAssigneeCancel) addAssigneeCancel.onclick = () => addAssigneePanel.classList.add('hidden');
  const addAssigneeSubmit = document.getElementById('pcAddAssigneeSubmit');
  if (addAssigneeSubmit) {
    addAssigneeSubmit.onclick = async () => {
      if (!S.currentProject) return;
      if (!_pcNewAssignees.length) return toast('请至少选择一名标注员', 'err');
      const r = await api('POST', '/api/projects/' + S.currentProject.id + '/members',
        { assignees: _pcNewAssignees });
      if (r.ok) {
        S.currentProject = r.project;
        addAssigneePanel.classList.add('hidden');
        toast(`已添加 ${(r.added_assignees || []).length} 名标注员`, 'ok');
        await loadProjectConfig();
      } else {
        toast(r.error || '添加失败', 'err');
      }
    };
  }

  // ---- 临时追加质检员 ----
  const addQCBtn = document.getElementById('pcAddQCBtn');
  const addQCPanel = document.getElementById('pcAddQCPanel');
  const addQCList = document.getElementById('pcAddQCList');
  let _pcNewQC = [];
  if (addQCBtn) {
    addQCBtn.onclick = async () => {
      if (!S.currentProject) return;
      _pcNewQC = [];
      await loadMyMembersForPicker();
      const existing = new Set(S.currentProject.assignees || []);
      const existingQC = new Set(S.currentProject.qc_assignees || []);
      const candidates = _availableMembers.filter(m =>
        m.role === 'qc' && !existing.has(m.id) && !existingQC.has(m.id));
      if (!candidates.length) {
        addQCList.innerHTML = '<div class="ls-form-hint">没有可追加的质检员（组下的质检员都已在本项目里，或还没有质检员组员）</div>';
      } else {
        addQCList.innerHTML = candidates.map(m => `
          <label class="ls-assignee-chip">
            <input type="checkbox" data-uid="${escape(m.id)}">
            <span class="ls-assignee-avatar">${escape((m.display_name || m.email || '?').charAt(0).toUpperCase())}</span>
            <span class="ls-assignee-name">${escape(m.display_name || m.email || '')}</span>
          </label>`).join('');
        addQCList.querySelectorAll('input[type=checkbox]').forEach(cb => {
          cb.onchange = () => {
            const uid = cb.dataset.uid;
            if (cb.checked) { if (!_pcNewQC.includes(uid)) _pcNewQC.push(uid); }
            else { _pcNewQC = _pcNewQC.filter(x => x !== uid); }
            cb.closest('.ls-assignee-chip').classList.toggle('on', cb.checked);
          };
        });
      }
      addQCPanel.classList.remove('hidden');
    };
  }
  const addQCCancel = document.getElementById('pcAddQCCancel');
  if (addQCCancel) addQCCancel.onclick = () => addQCPanel.classList.add('hidden');
  const addQCSubmit = document.getElementById('pcAddQCSubmit');
  if (addQCSubmit) {
    addQCSubmit.onclick = async () => {
      if (!S.currentProject) return;
      if (!_pcNewQC.length) return toast('请至少选择一名质检员', 'err');
      const r = await api('POST', '/api/projects/' + S.currentProject.id + '/members',
        { qc_assignees: _pcNewQC });
      if (r.ok) {
        S.currentProject = r.project;
        addQCPanel.classList.add('hidden');
        toast(`已添加 ${(r.added_qc || []).length} 名质检员`, 'ok');
        await loadProjectConfig();
      } else {
        toast(r.error || '添加失败', 'err');
      }
    };
  }
});

async function goQC() {
  if (requireLogin('请先登录')) return;
  S.view = 'projects';
  S.projectsFilterMode = 'qc';
  $('projectsPage').classList.remove('hidden');
  $('editorPage').classList.add('hidden');
  const ap = $('adminPage'); if (ap) ap.classList.add('hidden');
  const mp = $('monitorPage'); if (mp) mp.classList.add('hidden');
  const cp = $('projectConfigPage'); if (cp) cp.classList.add('hidden');
  document.querySelectorAll('.ls-sidebar-item').forEach(i => i.classList.remove('ls-sidebar-item-active'));
  const qi = document.querySelector('.ls-sidebar-item[data-nav="qc"]');
  if (qi) qi.classList.add('ls-sidebar-item-active');
  await loadProjects();
}

// ============ 项目监测 =============
async function loadMonitoring(silent = false) {
  const list = $('monitorList');
  const tag = $('monitorRoleTag');
  const cnt = $('monitorCount');
  // 静默刷新（SSE 触发）时不清空列表，避免整页闪烁；仅首次/手动刷新时显示“加载中…”
  if (!silent) list.innerHTML = '<div class="ls-admin-loading">加载中…</div>';
  const r = await api('GET', '/api/admin/monitoring');
  if (!r.ok) {
    if (!silent) list.innerHTML = `<div class="ls-admin-loading">${escape(r.error || '加载失败')}</div>`;
    return;
  }
  tag.textContent = ROLE_LABEL[r.current_role] || r.current_role;
  tag.className = 'ls-role-tag ls-role-' + r.current_role;
  const projs = r.projects || [];
  cnt.textContent = `共 ${projs.length} 个项目`;
  renderMonitoring(projs, r.current_role);
  ensureMonitorStream();   // 首次进入监测页时懒启动 SSE 订阅
}

function renderMonitoring(projects, myRole) {
  const list = $('monitorList');
  if (!projects.length) {
    list.innerHTML = '<div class="ls-admin-loading">还没有项目</div>';
    return;
  }
  const STAGES = [
    { key: 'created',   label: '创建标注' },
    { key: 'annotated', label: '图片标注' },
    { key: 'qc',        label: '图片质检' },
    { key: 'exported',  label: '标注导出' },
  ];
  list.innerHTML = projects.map(p => {
    const progPct = p.progress.toFixed(1);
    const st = p.stages || {};
    const pipeline = STAGES.map((s, i) => {
      const done = !!st[s.key];
      const connector = i < STAGES.length - 1
        ? `<div class="ls-pipe-connector ${done && st[STAGES[i+1].key] ? 'on' : ''}"></div>`
        : '';
      return `
        <div class="ls-pipe-step ${done ? 'on' : ''}">
          <span class="ls-pipe-dot"></span>
          <span class="ls-pipe-label">${s.label}</span>
        </div>${connector}`;
    }).join('');

    const memberRows = (p.assignees || []).map(m => {
      const mp = m.progress.toFixed(1);
      const vr = (m.valid_rate || 0).toFixed(1);
      return `
        <tr>
          <td>
            <div class="ls-admin-user-cell">
              <span class="ls-admin-avatar">${escape((m.name || '?').charAt(0).toUpperCase())}</span>
              <span class="ls-admin-name">${escape(m.name || '')}</span>
            </div>
          </td>
          <td class="ls-admin-email">${escape(m.email || '')}</td>
          <td class="ls-monitor-num">${m.assigned}</td>
          <td class="ls-monitor-num">${m.annotated}</td>
          <td class="ls-monitor-num" style="color:#16a34a">${m.qc_passed || 0}</td>
          <td class="ls-monitor-num" style="color:#dc2626">${m.qc_rejected || 0}</td>
          <td class="ls-monitor-num" style="color:#2563eb">${vr}%</td>
          <td class="ls-monitor-progress-cell">
            <div class="ls-monitor-bar">
              <div class="ls-monitor-bar-fill" style="width:${mp}%"></div>
            </div>
            <span class="ls-monitor-pct">${mp}%</span>
          </td>
        </tr>`;
    }).join('');

    const qcRows = (p.qc_assignees || []).map(q => {
      const qp = (q.progress || 0).toFixed(1);
      return `
      <tr>
        <td>
          <div class="ls-admin-user-cell">
            <span class="ls-admin-avatar">${escape((q.name || '?').charAt(0).toUpperCase())}</span>
            <span class="ls-admin-name">${escape(q.name || '')}</span>
          </div>
        </td>
        <td class="ls-admin-email">${escape(q.email || '')}</td>
        <td class="ls-monitor-num">${q.assigned || 0}</td>
        <td class="ls-monitor-num">${q.reviewed || 0}</td>
        <td class="ls-monitor-num" style="color:#16a34a">${q.passed || 0}</td>
        <td class="ls-monitor-num" style="color:#dc2626">${q.rejected || 0}</td>
        <td class="ls-monitor-num"></td>
        <td class="ls-monitor-progress-cell">
          <div class="ls-monitor-bar">
            <div class="ls-monitor-bar-fill" style="width:${qp}%;background:#16a34a"></div>
          </div>
          <span class="ls-monitor-pct">${qp}%</span>
        </td>
      </tr>`;
    }).join('');

    // 质检自动完成：passed == total_images 时监测面板自动显示"质检已完成"
    const canExport = !!st.qc;
    // 「部分导出」按钮：只要已有质检通过的图就可点击（无需全部通过）
    // 「导出并归档」按钮：始终显示，允许多次点击；如果曾经导出过，同时显示「已导出」标签作为提示
    const canPartial = (p.total_qc_passed || 0) > 0;
    const partialBtn = `<button class="ls-btn ls-btn-sm" data-act="export_partial" data-pid="${p.id}" ${canPartial ? '' : 'disabled'} title="仅导出已质检通过的图片">部分导出</button>`;
    const expBtn = `${st.exported ? '<span class="ls-pipe-badge on" style="margin-right:6px">已导出</span>' : ''}`
      + `<button class="ls-btn ls-btn-sm ls-btn-primary" data-act="export" data-pid="${p.id}" ${canExport ? '' : 'disabled'}>导出并归档</button>`;
    const exportRow = `${partialBtn}${expBtn}`;

    const qcPct = (p.qc_progress || 0).toFixed(1);

    return `
      <section class="ls-monitor-card">
        <header class="ls-monitor-card-head">
          <div class="ls-monitor-card-title">
            <span class="ls-monitor-name">${escape(p.name)}</span>
            <span class="ls-form-hint ls-monitor-meta">${escape(p.task_type || '')} · ${escape(p.created_at || '')}</span>
          </div>
          <div class="ls-monitor-card-stat">
            <div class="ls-monitor-stat-row">
              <span class="ls-monitor-stat-label">标注</span>
              <div class="ls-monitor-total">
                <span class="ls-monitor-num-big">${p.total_annotated}</span> / <span>${p.total_images}</span>
              </div>
              <div class="ls-monitor-bar ls-monitor-bar-lg">
                <div class="ls-monitor-bar-fill" style="width:${progPct}%"></div>
              </div>
              <span class="ls-monitor-pct">${progPct}%</span>
            </div>
            <div class="ls-monitor-stat-row" style="margin-top:6px">
              <span class="ls-monitor-stat-label">质检</span>
              <div class="ls-monitor-total">
                <span class="ls-monitor-num-big" style="color:#16a34a">${p.total_qc_passed}</span> / <span>${p.total_images}</span>
              </div>
              <div class="ls-monitor-bar ls-monitor-bar-lg">
                <div class="ls-monitor-bar-fill" style="width:${qcPct}%;background:#16a34a"></div>
              </div>
              <span class="ls-monitor-pct">${qcPct}%</span>
            </div>
          </div>
        </header>
        ${myRole === 'root' ? `<div class="ls-form-hint ls-monitor-owner">创建者：${escape(p.owner_name)}</div>` : ''}
        <div class="ls-pipeline">${pipeline}</div>
        <div class="ls-pipeline-actions">${exportRow}</div>
        <div class="ls-monitor-table-wrap">
          <table class="ls-admin-table ls-monitor-table" style="table-layout:fixed">
            <thead>
              <tr>
                <th style="width:90px">标注员</th>
                <th style="width:120px">邮箱</th>
                <th style="width:60px">分配</th>
                <th style="width:70px">已标注</th>
                <th style="width:60px">通过</th>
                <th style="width:60px">打回</th>
                <th style="width:70px">有效率</th>
                <th style="width:140px">进度</th>
              </tr>
            </thead>
            <tbody>
              ${memberRows || '<tr><td colspan="8" class="ls-admin-loading" style="padding:20px">未分配标注员</td></tr>'}
            </tbody>
          </table>
        </div>
        <div class="ls-monitor-table-wrap" style="margin-top:12px">
          <table class="ls-admin-table ls-monitor-table" style="table-layout:fixed">
            <thead>
              <tr>
                <th style="width:90px">质检员</th>
                <th style="width:120px">邮箱</th>
                <th style="width:60px">分配</th>
                <th style="width:70px">已质检</th>
                <th style="width:60px">通过</th>
                <th style="width:60px">打回</th>
                <th style="width:70px"></th>
                <th style="width:140px">进度</th>
              </tr>
            </thead>
            <tbody>
              ${qcRows || '<tr><td colspan="8" class="ls-admin-loading" style="padding:20px">未分配质检员</td></tr>'}
            </tbody>
          </table>
        </div>
      </section>`;
  }).join('');

  // 绑定阶段操作按钮
  list.querySelectorAll('button[data-act]').forEach(btn => {
    btn.onclick = async () => {
      const pid = btn.dataset.pid;
      const act = btn.dataset.act;
      if (act === 'export' || act === 'export_partial') {
        // 部分导出：只拿质检通过的图（后端 ?only=passed），不推进"已导出"状态
        const isPartial = act === 'export_partial';
        const url = '/api/projects/' + pid + '/export?format=json'
                  + (isPartial ? '&only=passed' : '');
        try {
          const tk = getToken();
          const headers = tk ? { 'Authorization': 'Bearer ' + tk } : {};
          const resp = await fetch(url, { credentials: 'omit', headers });
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          const blob = await resp.blob();
          // 服务器实际返回 zip；文件名尽量取 Content-Disposition，否则用 .zip 兜底
          let filename = pid + (isPartial ? '_labels_passed.zip' : '_labels.zip');
          const disp = resp.headers.get('Content-Disposition') || '';
          const m = disp.match(/filename\*=UTF-8''([^;]+)/i) || disp.match(/filename="?([^";]+)"?/i);
          if (m) { try { filename = decodeURIComponent(m[1]); } catch (_) { filename = m[1]; } }
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = filename;
          document.body.appendChild(a); a.click(); a.remove();
          toast(isPartial ? '部分导出完成（仅质检通过）' : '导出成功', 'ok');
          loadMonitoring();
        } catch (e) {
          toast('导出失败: ' + e.message, 'err');
        }
      }
    };
  });
}

// 刷新按钮 + SSE 事件驱动（有更新才刷新，无轮询）
let _monitorSSE = null;
let _monitorRefreshTimer = null;
// SSE 更新事件做防抖：标注/质检高频写入时，多条 update 合并成一次静默刷新，避免整页反复重绘导致闪烁
function scheduleMonitorRefresh() {
  if (_monitorRefreshTimer) return;
  _monitorRefreshTimer = setTimeout(() => {
    _monitorRefreshTimer = null;
    const page = document.getElementById('monitorPage');
    if (page && !page.classList.contains('hidden')) loadMonitoring(true);
  }, 1500);
}
function ensureMonitorStream() {
  if (_monitorSSE) return;
  const role = S.user && S.user.role;
  if (role !== 'root' && role !== 'admin') return;
  const tk = getToken();
  const url = '/api/admin/monitor/stream' + (tk ? ('?token=' + encodeURIComponent(tk)) : '');
  try {
    _monitorSSE = new EventSource(url);
    _monitorSSE.addEventListener('update', () => {
      scheduleMonitorRefresh();
    });
    // 浏览器会自动重连，出错时不清除引用，避免疯狂重开
  } catch (e) { /* ignore */ }
}

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('monitorRefreshBtn');
  if (btn) btn.onclick = () => loadMonitoring();
});

// ========================================================
// 用户管理（仅 root/admin）
// ========================================================
const ROLE_LABEL = { root: 'Root', admin: '管理', member: '标注员', qc: '质检员' };

// 展开/折叠状态（跨渲染保留）
const ADMIN_EXPANDED = new Set();
// 当前选中的行 uid（点击行 → 展示 添加/移除 按钮）
let SELECTED_UID = null;
let ADMIN_USERS_CACHE = [];
let ADMIN_MY_ROLE = null;

async function loadAdminUsers() {
  const tag = $('adminRoleTag');
  const tip = $('adminReadonlyTip');
  const cnt = $('adminUserCount');
  const chart = $('adminOrgChart');
  if (chart) chart.innerHTML = '<div class="ls-admin-loading">加载中…</div>';
  const r = await api('GET', '/api/admin/users');
  if (!r.ok) {
    if (chart) chart.innerHTML = `<div class="ls-admin-loading">${escape(r.error || '加载失败')}</div>`;
    return;
  }
  const myRole = r.current_role;
  tag.textContent = ROLE_LABEL[myRole] || myRole;
  tag.className = 'ls-role-tag ls-role-' + myRole;
  tip.classList.toggle('hidden', myRole !== 'admin');
  cnt.textContent = `共 ${r.users.length} 位用户`;

  ADMIN_USERS_CACHE = r.users;
  ADMIN_MY_ROLE = myRole;
  renderAdminOrgChart(r.users, myRole);
}

// 判断某行是否可点击（用于点击选中触发添加/移除按钮）
function canSelectRow(u, myRole, mine) {
  const role = u.role || 'member';
  if (u.id === mine) return false;
  if (role === 'root') return false;
  if (myRole === 'root') {
    // Root 可点击任意 Admin/Member/QC 节点（用于设为/取消管理员、删除等）
    return true;
  }
  if (myRole === 'admin') {
    if (role !== 'member' && role !== 'qc') return false;
    const parent = u.created_by || '';
    return !parent || parent === mine;
  }
  return false;
}

// 计算某行应该显示什么动作按钮（Admin 视角下对 member/qc 的添加/移除 + 岗位切换）。
// Root 视角走 nodeEl 里的"设为/取消管理员 + 删除"分支，不走这里。
function rowActionForMember(u, myRole, mine) {
  const role = u.role || 'member';
  if ((role !== 'member' && role !== 'qc') || u.id === mine) return null;
  if (myRole === 'admin') {
    const parent = u.created_by || '';
    if (!parent) return { kind: 'adopt', label: '添加' };
    if (parent === mine) {
      // 已在自己组下：允许 移除 + 岗位切换
      return {
        kind: 'release',
        label: '移除',
        toggleTo: role === 'qc' ? 'member' : 'qc',
        toggleLabel: role === 'qc' ? '切换为标注员' : '切换为质检员',
      };
    }
  }
  return null;
}

// ==== 组织架构图（Root → Admin → Member）====
function renderAdminOrgChart(users, myRole) {
  const chart = $('adminOrgChart');
  if (!chart) return;
  chart.innerHTML = '';
  if (!users.length) {
    chart.innerHTML = '<div class="ls-admin-loading">暂无用户</div>';
    return;
  }
  const mine = S.user && S.user.id;

  // 分层：member 和 qc 都属于组员层，只是岗位不同
  const roots   = users.filter(u => (u.role || 'member') === 'root');
  const admins  = users.filter(u => (u.role || 'member') === 'admin');
  const members = users.filter(u => ((u.role || 'member') === 'member' || u.role === 'qc'));

  // 分组 Members
  const membersByAdmin = {};
  const orphanMembers = [];
  members.forEach(m => {
    const parent = m.created_by || '';
    if (parent && admins.some(a => a.id === parent)) {
      (membersByAdmin[parent] = membersByAdmin[parent] || []).push(m);
    } else if (parent && roots.some(r => r.id === parent)) {
      (membersByAdmin[parent] = membersByAdmin[parent] || []).push(m);
    } else {
      orphanMembers.push(m);
    }
  });

  // 构建 DOM
  const buildTier = (title, list, extraCls='') => {
    const t = document.createElement('div');
    t.className = 'ls-org-tier ' + extraCls;
    t.innerHTML = '';
    const row = document.createElement('div');
    row.className = 'ls-org-row';
    list.forEach(node => row.appendChild(node));
    t.appendChild(row);
    return t;
  };
  const nodeEl = (u) => {
    const role = u.role || 'member';
    const isSelf = u.id === mine;
    const canClick = canSelectRow(u, myRole, mine);
    const selected = SELECTED_UID === u.id;
    const wrap = document.createElement('div');
    wrap.className = [
      'ls-org-node',
      `ls-node-${role}`,
      canClick ? 'ls-node-clickable' : '',
      selected ? 'ls-node-selected' : '',
      isSelf ? 'ls-node-self' : '',
    ].filter(Boolean).join(' ');
    wrap.dataset.uid = u.id;
    wrap.dataset.role = role;
    if (u.created_by) wrap.dataset.parent = u.created_by;
    const initial = (u.display_name || u.email || '?').charAt(0).toUpperCase();
    wrap.innerHTML = `
      <div class="ls-node-avatar">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <circle cx="12" cy="8" r="4"/>
          <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>
        </svg>
        <span class="ls-node-initial">${escape(initial)}</span>
      </div>
      <div class="ls-node-label">${escape(u.display_name || u.email || '?')}${isSelf ? ' <span class="ls-admin-self">(我)</span>' : ''}</div>
      <div class="ls-node-role">${ROLE_LABEL[role] || role}</div>
    `;
    // 选中时的动作按钮浮层
    if (selected && myRole === 'root' && role !== 'root') {
      // Root 选中 Admin/Member：可以 设为/取消管理员 + 删除
      const group = document.createElement('div');
      group.className = 'ls-node-action-group';
      const roleBtn = document.createElement('button');
      roleBtn.className = 'ls-btn ls-btn-sm ' + (role === 'admin' ? 'ls-btn-ghost' : 'ls-btn-primary');
      roleBtn.textContent = role === 'admin' ? '取消管理员' : '设为管理员';
      roleBtn.onclick = (ev) => { ev.stopPropagation(); setUserRole(u.id, role === 'admin' ? 'demote' : 'promote'); };
      const delBtn = document.createElement('button');
      delBtn.className = 'ls-btn ls-btn-sm ls-btn-danger';
      delBtn.textContent = '删除';
      delBtn.onclick = (ev) => { ev.stopPropagation(); deleteUser(u.id, u.display_name || u.email || ''); };
      group.appendChild(roleBtn);
      group.appendChild(delBtn);
      wrap.appendChild(group);
    } else if (selected && (role === 'member' || role === 'qc')) {
      // Admin 选中 Member/QC：添加/移除 + 岗位切换
      const act = rowActionForMember(u, myRole, mine);
      if (act) {
        const group = document.createElement('div');
        group.className = 'ls-node-action-group';
        const btnCls = act.kind === 'release' ? 'ls-btn-danger' : 'ls-btn-primary';
        const actBtn = document.createElement('button');
        actBtn.className = `ls-btn ls-btn-sm ${btnCls} ls-node-action`;
        actBtn.textContent = act.label;
        actBtn.onclick = (ev) => {
          ev.stopPropagation();
          if (act.kind === 'adopt') adoptUser(u.id, u.display_name || u.email || '');
          else if (act.kind === 'release') releaseUser(u.id, u.display_name || u.email || '');
        };
        group.appendChild(actBtn);
        if (act.toggleTo) {
          const tgBtn = document.createElement('button');
          tgBtn.className = 'ls-btn ls-btn-sm ls-btn-ghost';
          tgBtn.textContent = act.toggleLabel;
          tgBtn.onclick = (ev) => {
            ev.stopPropagation();
            toggleMemberRole(u.id, act.toggleTo,
              u.display_name || u.email || '');
          };
          group.appendChild(tgBtn);
        }
        wrap.appendChild(group);
      }
    }
    // 点击选中
    if (canClick || (myRole === 'root' && role !== 'root' && !isSelf)) {
      wrap.style.cursor = 'pointer';
      wrap.addEventListener('click', () => {
        SELECTED_UID = (SELECTED_UID === u.id) ? null : u.id;
        renderAdminOrgChart(users, myRole);
      });
    }
    return wrap;
  };

  // Root 层
  chart.appendChild(buildTier('Root', roots.map(nodeEl), 'ls-org-tier-root'));
  // Admin 层
  chart.appendChild(buildTier('管理员', admins.map(nodeEl), 'ls-org-tier-admin'));
  // Member 层：按 admin 顺序排列成员；orphan 单独一组
  const memberRow = [];
  admins.forEach(a => {
    (membersByAdmin[a.id] || []).forEach(m => memberRow.push(nodeEl(m)));
  });
  const orphanRow = orphanMembers.map(nodeEl);
  const memberTier = document.createElement('div');
  memberTier.className = 'ls-org-tier ls-org-tier-member';
  memberTier.innerHTML = '';
  const row1 = document.createElement('div');
  row1.className = 'ls-org-row';
  memberRow.forEach(n => row1.appendChild(n));
  memberTier.appendChild(row1);
  if (orphanRow.length) {
    const label = document.createElement('div');
    label.className = 'ls-org-tier-sub';
    label.textContent = '未归属（可点击加入你的组）';
    const row2 = document.createElement('div');
    row2.className = 'ls-org-row ls-org-row-orphan';
    orphanRow.forEach(n => row2.appendChild(n));
    memberTier.appendChild(label);
    memberTier.appendChild(row2);
  }
  chart.appendChild(memberTier);

  // SVG 连线（叠在层之上，pointer-events: none）
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'ls-org-lines');
  chart.appendChild(svg);

  // 布局完成后再绘线
  requestAnimationFrame(() => drawOrgLines(chart, svg, users));
}

function drawOrgLines(chart, svg, users) {
  const chartRect = chart.getBoundingClientRect();
  svg.setAttribute('width', chartRect.width);
  svg.setAttribute('height', chartRect.height);
  svg.style.width = chartRect.width + 'px';
  svg.style.height = chartRect.height + 'px';

  const getAnchor = (uid, which) => {
    const el = chart.querySelector(`.ls-org-node[data-uid="${CSS.escape(uid)}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      x: r.left - chartRect.left + r.width / 2,
      y: (which === 'top' ? r.top : r.bottom) - chartRect.top,
    };
  };

  // Root → Admin
  const roots = users.filter(u => (u.role || 'member') === 'root');
  const admins = users.filter(u => (u.role || 'member') === 'admin');
  const members = users.filter(u => ((u.role || 'member') === 'member' || u.role === 'qc'));

  const paths = [];
  roots.forEach(r => {
    admins.forEach(a => {
      const s = getAnchor(r.id, 'bottom');
      const e = getAnchor(a.id, 'top');
      if (s && e) paths.push({ s, e, cls: 'ls-line-root' });
    });
  });
  // Admin → Member（有归属的）
  members.forEach(m => {
    if (!m.created_by) return;
    const s = getAnchor(m.created_by, 'bottom');
    const e = getAnchor(m.id, 'top');
    if (s && e) paths.push({ s, e, cls: 'ls-line-admin' });
  });

  // 绘曲线（用三次贝塞尔，控制点竖向偏移 → 弧形）
  svg.innerHTML = paths.map(p => {
    const dy = Math.max(30, (p.e.y - p.s.y) * 0.55);
    const c1x = p.s.x, c1y = p.s.y + dy;
    const c2x = p.e.x, c2y = p.e.y - dy;
    return `<path class="${p.cls}"
              d="M ${p.s.x} ${p.s.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p.e.x} ${p.e.y}"
              fill="none"/>`;
  }).join('');
}

// 窗口缩放 → 重绘连线
window.addEventListener('resize', () => {
  if ($('adminPage') && !$('adminPage').classList.contains('hidden') && ADMIN_USERS_CACHE.length) {
    renderAdminOrgChart(ADMIN_USERS_CACHE, ADMIN_MY_ROLE);
  }
});

async function setUserRole(uid, action) {
  const newRole = action === 'promote' ? 'admin' : 'member';
  let confirmMsg;
  if (action === 'promote') {
    confirmMsg = '确认将该用户设为管理员？';
  } else {
    confirmMsg = '确认取消该用户的管理员权限？\n\n注意：TA 名下的所有组员会一并被释放为"未归属"，组织图上的连线也会随之消失。';
  }
  if (!confirm(confirmMsg)) return;
  const r = await api('POST', `/api/admin/users/${encodeURIComponent(uid)}/role`, { role: newRole });
  if (!r.ok) return toast(r.error || '操作失败', 'err');
  if (action === 'promote') {
    toast('已设为管理员', 'ok');
  } else {
    const released = r.released_members || 0;
    toast(released > 0
      ? `已取消管理员；释放 ${released} 位组员到未归属`
      : '已取消管理员', 'ok');
  }
  SELECTED_UID = null;
  loadAdminUsers();
}

async function deleteUser(uid, name) {
  const label = name || uid;
  if (!confirm(`确认永久删除用户「${label}」？\n\n将同时删除该用户的所有项目和标注记录，且不可恢复！`)) return;
  const r = await api('DELETE', `/api/admin/users/${encodeURIComponent(uid)}`);
  if (!r.ok) return toast(r.error || '删除失败', 'err');
  toast('用户已删除', 'ok');
  loadAdminUsers();
}

// ========== 组员归属：添加 / 移除 ==========
async function adoptUser(uid, name) {
  const label = name || uid;
  if (!confirm(`确认将「${label}」添加到你的组下？`)) return;
  const r = await api('POST', `/api/admin/users/${encodeURIComponent(uid)}/adopt`);
  if (!r.ok) return toast(r.error || '添加失败', 'err');
  toast('已加入你的组', 'ok');
  SELECTED_UID = null;
  // 自动展开自己的子树，便于看到刚加入的成员
  if (S.user && S.user.id) ADMIN_EXPANDED.add(S.user.id);
  loadAdminUsers();
}

async function releaseUser(uid, name) {
  const label = name || uid;
  if (!confirm(`确认将「${label}」从你的组中移除？（不会删除该用户）`)) return;
  const r = await api('POST', `/api/admin/users/${encodeURIComponent(uid)}/release`);
  if (!r.ok) return toast(r.error || '移除失败', 'err');
  toast('已移除', 'ok');
  SELECTED_UID = null;
  loadAdminUsers();
}

// 岗位切换：member ↔ qc
async function toggleMemberRole(uid, newRole, name) {
  const label = name || uid;
  const toName = newRole === 'qc' ? '质检员' : '标注员';
  if (!confirm(`确认把「${label}」切换为${toName}？`)) return;
  const r = await api('POST', `/api/admin/users/${encodeURIComponent(uid)}/role`, { role: newRole });
  if (!r.ok) return toast(r.error || '切换失败', 'err');
  toast('已切换为' + toName, 'ok');
  loadAdminUsers();
}

function goEditor(project) {
  S.view = 'editor';
  S.currentProject = project;
  Object.assign(S, {
    currentIdx: -1, currentImageId: null,
    boxes: [], history: [], future: [],
    selectedIdx: -1, isDirty: false,
    currentCat: project.categories[0] || null,
    qcStatus: null,   // 当前图片的 qc_status（若我是质检员）
  });
  $('projectsPage').classList.add('hidden');
  $('editorPage').classList.remove('hidden');
  const ap = $('adminPage'); if (ap) ap.classList.add('hidden');
  const mp = $('monitorPage'); if (mp) mp.classList.add('hidden');
  const cp = $('projectConfigPage'); if (cp) cp.classList.add('hidden');
  const qcp = $('qcPage'); if (qcp) qcp.classList.add('hidden');
  $('editorProjectName').textContent = project.name;
  $('editorProjectPath').textContent = project.image_dir;
  $('editorProjectPath').title = project.image_dir;
  const uid = S.user && S.user.id;
  const isOwner = uid && project.owner_id === uid;
  const isQCer = !isOwner && (project.qc_assignees || []).includes(uid);
  S.isQCMode = isQCer;
  // QC 模式下把左侧图片列表的筛选芯片文案换成质检语义
  document.querySelectorAll('.ls-chip-group .ls-chip').forEach(c => {
    const f = c.dataset.filter;
    if (isQCer) {
      if (f === 'all')       c.textContent = '全部';
      if (f === 'pending')   c.textContent = '未质检';
      if (f === 'annotated') c.textContent = '已通过';
      if (f === 'rejected')  c.textContent = '已打回';
    } else {
      if (f === 'all')       c.textContent = '全部';
      if (f === 'pending')   c.textContent = '待标';
      if (f === 'annotated') c.textContent = '已标';
      if (f === 'rejected')  c.textContent = '被打回';
    }
  });
  const addBtn = $('addTagBtn');
  if (addBtn) addBtn.classList.toggle('hidden', !isOwner);
  // QC 模式：整个编辑器加上 .qc-mode，CSS 会把底部标签栏隐掉、把 QC 操作条挂到底部
  $('editorPage').classList.toggle('qc-mode', !!isQCer);
  // 工具栏「下一张」按钮：仅标注员显示
  const nb = document.getElementById('nextImgBtn');
  if (nb) nb.classList.toggle('hidden', !!isQCer);
  renderQCBarInEditor();  // 装载/清除 QC 顶栏
  _labelPage = 0;         // 轮转模式：进入项目从第 1 组开始
  renderCategories();
  // 默认筛选：标注员进入项目默认「待标」，质检员进入项目默认「未质检」
  S.filter = 'pending';
  document.querySelectorAll('.ls-chip-group .ls-chip').forEach(c => {
    c.classList.toggle('ls-chip-active', c.dataset.filter === S.filter);
  });
  refreshImages();
  setTimeout(fitCanvasToStage, 50);
}

// 在编辑器底部（原标签栏位置）挂一个"通过/打回"操作栏（仅质检员）
function renderQCBarInEditor() {
  let bar = document.getElementById('qcActionBar');
  if (!S.isQCMode) { if (bar) bar.remove(); return; }
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'qcActionBar';
    bar.className = 'ls-qc-bar';
    const passKey = keyDisplay(SHORTCUTS.qc_pass);
    const rejectKey = keyDisplay(SHORTCUTS.qc_reject);
    bar.innerHTML = `
      <span class="ls-qc-status" id="qcStatusChip">待质检</span>
      <button class="ls-btn ls-btn-sm" id="qcPassBtn" style="border-color:#86EFAC;color:#166534" title="快捷键 ${escape(passKey)}">通过 (${escape(passKey)})</button>
      <button class="ls-btn ls-btn-sm" id="qcRejectBtn" style="border-color:#FCA5A5;color:#B91C1C" title="快捷键 ${escape(rejectKey)}">打回 (${escape(rejectKey)})</button>`;
    // 挂到 editorPage 里，CSS 用绝对定位钉在底部
    $('editorPage').appendChild(bar);
    document.getElementById('qcPassBtn').onclick = () => submitQC('pass');
    document.getElementById('qcRejectBtn').onclick = () => submitQC('reject');
  }
}

function updateQCChip() {
  const chip = document.getElementById('qcStatusChip');
  if (!chip) return;
  const s = S.qcStatus || 'pending';
  chip.className = 'ls-qc-status ls-qc-' + s;
  chip.textContent = s === 'passed' ? '已通过' : s === 'rejected' ? '已打回' : '待质检';
  // 规则：已打回的图片不能被 QC 直接改为"通过"（需等待标注员重新标注）
  const passBtn = document.getElementById('qcPassBtn');
  if (passBtn) {
    const disabled = (s === 'rejected');
    passBtn.disabled = disabled;
    passBtn.style.opacity = disabled ? '0.4' : '';
    passBtn.style.cursor = disabled ? 'not-allowed' : '';
    passBtn.title = disabled ? '已打回：需标注员重新标注后才能通过' : '';
  }
}

async function submitQC(verdict, reason) {
  if (!S.currentProject || !S.currentImageId) return;
  // 规则：已打回的图片不能直接改为"通过"
  if (verdict === 'pass' && S.qcStatus === 'rejected') {
    toast('已打回的图片需标注员重新标注后才能通过', 'err');
    return;
  }
  // 预期结论：verdict=='pass' -> passed；verdict=='reject' -> rejected
  const expectedQC = verdict === 'pass' ? 'passed' : 'rejected';
  const _qcImgId = S.currentImageId;
  // 提前打乐观标记，覆盖请求 in-flight 期间的轮询，防止服务端旧快照把它闪回"待质检"
  (S._recentQC = S._recentQC || new Map()).set(_qcImgId,
    { ts: Date.now(), qcStatus: expectedQC });
  const r = await api('POST', '/api/projects/' + S.currentProject.id + '/qc', {
    image_id: S.currentImageId, verdict, reason: reason || '',
  });
  if (r.ok) {
    // 用服务端确认的 qc_status 覆盖标记（一般就是 expectedQC）
    S._recentQC.set(_qcImgId, { ts: Date.now(), qcStatus: r.qc_status });
    S.qcStatus = r.qc_status;
    updateQCChip();
    // 同步更新本地图片列表里当前图片的 qc_status，让左侧点变色
    const idx = S.images.findIndex(x => x.image_id === S.currentImageId);
    if (idx >= 0) S.images[idx].qc_status = r.qc_status;
    applyFilter();  // 重新过滤 + renderImageList
    // 本地立刻更新进度条 —— 语义与后端 _api_images 一致：
    //   质检员：已完成 = qc_status === 'passed'
    //   标注员/owner：已完成 = annotated 且未被打回
    {
      const total = S.images.length;
      let annotatedCnt;
      if (S.isQCMode) {
        annotatedCnt = S.images.filter(x => x.qc_status === 'passed').length;
      } else {
        annotatedCnt = S.images.filter(
          x => x.annotated && x.qc_status !== 'rejected').length;
      }
      updateProgress(annotatedCnt, total);
    }
    toast(verdict === 'pass' ? '已通过' : '已打回', 'ok');
    // 质检员在「未质检」列表下完成判定后，自动跳到下一张未质检
    if (S.isQCMode && S.filter === 'pending') {
      if (S.filtered.length > 0) {
        // applyFilter 已把当前图移出 filtered，选第一张即"下一张未质检"
        await selectImage(0);
      } else {
        toast('所有图片已质检完成', 'ok');
      }
    }
  } else {
    // 撤销乐观标记
    S._recentQC && S._recentQC.delete(_qcImgId);
    toast(r.error || '操作失败', 'err');
  }
}

// ========================================================
// Projects 列表
// ========================================================
async function loadProjects() {
  if (!S.user) {
    // 未登录：清空并显示空状态提示
    S.projects = [];
    renderProjectsGrid();
    return;
  }
  const r = await api('GET', '/api/projects');
  if (!r.ok) {
    if (r.status === 401) {
      S.user = null; applyAuthState();
      openAuthModal('login');
      return;
    }
    return toast('加载失败', 'err');
  }
  S.projects = r.projects;
  applyRoleVisibility();   // 若发现自己是某项目质检员，此时才能显示 QC 入口
  renderProjectsGrid();
}
function renderProjectsGrid() {
  const grid = $('projectsGrid'), empty = $('projectsEmpty');
  const q = S.projectsSearch.toLowerCase();
  const uid = S.user && S.user.id;
  let list = S.projects.filter(p =>
    !q || p.name.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q));
  // 若在"质检"模式，只显示当前用户作为质检员的项目
  if (S.projectsFilterMode === 'qc') {
    list = list.filter(p => p.is_qc || (p.qc_assignees || []).includes(uid));
  }
  grid.innerHTML = '';
  if (list.length === 0) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  list.forEach(p => {
    const isQCer = p.is_qc || (p.qc_assignees || []).includes(uid);
    const total = p.task_count || 0, done = p.annotated_count || 0;
    const pct = total > 0 ? Math.round(done / total * 100) : 0;
    const updated = (p.updated_at || '').split(' ')[0] || '';
    const card = document.createElement('div');
    card.className = 'ls-project-card';
    const roleTag = isQCer
      ? '<span class="ls-project-tag" style="background:#FEF3C7;color:#92400E">质检</span>'
      : '';
    card.innerHTML = `
      <div class="ls-project-card-accent"></div>
      <div class="ls-project-name">${escape(p.name)} ${roleTag}</div>
      <div class="ls-project-desc">${escape(p.description || '（无描述）')}</div>
      <div class="ls-project-path" title="${escape(p.image_dir)}">${escape(p.image_dir)}</div>
      <div class="ls-project-stats">
        <span class="ls-project-stat">
          <span class="ls-project-stat-value">${done}</span> / <span class="ls-project-stat-value">${total}</span> 已标注
        </span>
        <span class="ls-project-stat-value">${pct}%</span>
      </div>
      <div class="ls-project-progress"><div class="ls-project-progress-fill" style="width: ${pct}%"></div></div>
      <div class="ls-project-footer">
        <span class="ls-project-tag">${p.categories.length} labels</span>
        <span>Updated ${updated}</span>
      </div>`;
    card.onclick = () => {
      // QC 优先：如果我是这个项目的 QC，进入 QC 模式的编辑器（不进 config）
      if (isQCer) return goEditor(p);
      // Admin / Root：进入项目配置页；Member：进入标注编辑器
      const role = S.user && S.user.role;
      if (role === 'admin' || role === 'root') goProjectConfig(p);
      else goEditor(p);
    };
    grid.appendChild(card);
  });
}
$('projectsSearch').oninput = (e) => { S.projectsSearch = e.target.value; renderProjectsGrid(); };

// ========================================================
// 自定义 Dropdown（标注类型）
// ========================================================
function initDropdown(rootId) {
  const root = $(rootId);
  if (!root) return;
  const trigger = root.querySelector('.ls-dropdown-trigger');
  const menu = root.querySelector('.ls-dropdown-menu');
  const valueEl = root.querySelector('.ls-dropdown-value');

  function open() {
    root.classList.add('open');
    menu.classList.remove('hidden');
  }
  function close() {
    root.classList.remove('open');
    menu.classList.add('hidden');
  }
  trigger.onclick = (e) => {
    e.stopPropagation();
    if (root.classList.contains('open')) close();
    else open();
  };
  menu.querySelectorAll('.ls-dropdown-item').forEach(item => {
    item.onclick = (e) => {
      e.stopPropagation();
      const val = item.dataset.value;
      root.dataset.value = val;
      valueEl.textContent = item.textContent.trim();
      valueEl.classList.remove('ls-dropdown-placeholder');
      menu.querySelectorAll('.ls-dropdown-item').forEach(i =>
        i.classList.toggle('selected', i === item));
      close();
    };
  });
  document.addEventListener('click', (e) => {
    if (root.classList.contains('open') && !root.contains(e.target)) close();
  });
  return {
    getValue: () => root.dataset.value,
    setValue: (val) => {
      const item = menu.querySelector(`.ls-dropdown-item[data-value="${val}"]`);
      if (item) { item.click(); return; }
      // 清空
      root.dataset.value = '';
      valueEl.textContent = '请选择';
      valueEl.classList.add('ls-dropdown-placeholder');
      menu.querySelectorAll('.ls-dropdown-item').forEach(i => i.classList.remove('selected'));
    },
    close,
  };
}
const _taskDropdown = initDropdown('fTaskDropdown');
let _createTags = [];      // [{name, color}]
// ========================================================
// 调色板生成（macOS 风格：色相 × 明度网格）
// ========================================================
function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  const toHex = v => v.toString(16).padStart(2, '0').toUpperCase();
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

function buildFullPalette() {
  const colors = [];
  // 第一行：15 个高饱和纯色
  colors.push(
    "#FF3B30", "#FF6B35", "#FF9500", "#FFCC00", "#FFEB3B",
    "#7ED321", "#4CD964", "#00C853", "#009688", "#5AC8FA",
    "#00BCD4", "#2196F3", "#007AFF", "#5856D6", "#AF52DE"
  );
  // 主体：15 色相 × 8 明度阶梯
  const hues = [0, 15, 30, 45, 60, 90, 120, 150, 180, 200, 220, 240, 270, 300, 330];
  const lightSteps = [92, 82, 72, 62, 52, 42, 32, 22];
  for (const l of lightSteps) {
    for (const h of hues) {
      colors.push(hslToHex(h, 70, l));
    }
  }
  // 灰阶行：15 阶
  const grays = [];
  for (let i = 0; i < 15; i++) {
    const l = Math.round(95 - i * (95 / 14));
    grays.push(hslToHex(0, 0, l));
  }
  colors.push(...grays);
  return colors;
}
let _palette = buildFullPalette();     // 覆盖之前的 _palette


let _createAssignees = [];        // 创建时选中的组员 uid
let _createQCAssignees = [];      // 创建时选中的质检员 uid
let _availableMembers = [];       // 当前用户名下的组员

$('createProjectBtn').onclick = async () => {
  if (requireLogin('请先登录后再创建项目')) return;
  const d = await api('GET', '/api/defaults');
  // 前端调色板已是 150+ 色的完整网格，不再覆盖
  $('fName').value = '';
  $('fDesc').value = '';
  _taskDropdown && _taskDropdown.setValue('');   // 默认空
  $('fImageDir').value = '';
  if ($('fCocoName')) $('fCocoName').value = '';   // 清空上一次选中的 COCO 路径，保证轮询/事件能重新触发
  _createTags = [];        // 默认为空
  renderCreateTags();
  _createAssignees = [];
  _createQCAssignees = [];
  await loadMyMembersForPicker();
  renderAssigneesPicker();
  renderQCAssigneesPicker();
  $('createErr').textContent = '';
  $('createModal').classList.remove('hidden');
  setTimeout(() => $('fName').focus(), 30);
};

async function loadMyMembersForPicker() {
  _availableMembers = [];
  const r = await api('GET', '/api/admin/my_members');
  if (r && r.ok) _availableMembers = r.members || [];
}

function renderAssigneesPicker() {
  const el = $('fAssigneesList');
  const grp = $('fAssigneesGroup');
  const lbl = $('fAssigneesLabel');
  const hlp = $('fAssigneesHelp');
  if (!el || !grp) return;
  const isAdmin = S.user && S.user.role === 'admin';
  // 只显示 role=member 的组员作为标注员候选
  const list = _availableMembers.filter(m => (m.role || 'member') === 'member');
  if (!list.length) {
    if (isAdmin) {
      grp.classList.remove('hidden');
      if (lbl) lbl.innerHTML = '分配给组员 <span class="ls-form-req">*</span>';
      if (hlp) hlp.textContent = '你还没有标注员组员。请先到"用户管理"页把成员加到自己组下（默认为标注员）';
      el.innerHTML = '';
    } else {
      grp.classList.add('hidden');
    }
    return;
  }
  grp.classList.remove('hidden');
  if (lbl) lbl.innerHTML = isAdmin
    ? '分配给组员 <span class="ls-form-req">*</span>'
    : '分配给组员';
  if (hlp) hlp.textContent = isAdmin
    ? '按顺序均分图片给所选组员（至少选择一名）'
    : '按顺序均分图片；不选则默认全部归自己';
  el.innerHTML = list.map(m => {
    const on = _createAssignees.includes(m.id);
    return `<label class="ls-assignee-chip ${on ? 'on' : ''}">
      <input type="checkbox" data-uid="${escape(m.id)}" ${on ? 'checked' : ''}>
      <span class="ls-assignee-avatar">${escape((m.display_name || m.email || '?').charAt(0).toUpperCase())}</span>
      <span class="ls-assignee-name">${escape(m.display_name || m.email || '')}</span>
    </label>`;
  }).join('');
  el.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.onchange = () => {
      const uid = cb.dataset.uid;
      if (cb.checked) {
        if (!_createAssignees.includes(uid)) _createAssignees.push(uid);
      } else {
        _createAssignees = _createAssignees.filter(x => x !== uid);
      }
      cb.closest('.ls-assignee-chip').classList.toggle('on', cb.checked);
    };
  });
}

function renderQCAssigneesPicker() {
  const el = $('fQCAssigneesList');
  const grp = $('fQCAssigneesGroup');
  const lbl = $('fQCAssigneesLabel');
  const hlp = $('fQCAssigneesHelp');
  if (!el || !grp) return;
  const isAdmin = S.user && S.user.role === 'admin';
  // 只显示 role=qc 的组员作为质检员候选
  const list = _availableMembers.filter(m => m.role === 'qc');
  if (!list.length) {
    if (isAdmin) {
      grp.classList.remove('hidden');
      if (lbl) lbl.innerHTML = '分配给质检员 <span class="ls-form-req">*</span>';
      if (hlp) hlp.textContent = '你还没有质检员。到"用户管理"页把已有组员的岗位切换为「质检员」再回来创建项目';
      el.innerHTML = '';
    } else {
      grp.classList.add('hidden');
    }
    return;
  }
  grp.classList.remove('hidden');
  // Admin：必填；Root：可选
  if (lbl) lbl.innerHTML = isAdmin
    ? '分配给质检员 <span class="ls-form-req">*</span>'
    : '分配给质检员';
  if (hlp) hlp.textContent = isAdmin
    ? '至少选择一名质检员（每张标注完成后由 TA 打通过/打回）'
    : '质检员可查看所有已标注图片，对每张给出"通过"或"打回"结论';
  el.innerHTML = list.map(m => {
    const on = _createQCAssignees.includes(m.id);
    return `<label class="ls-assignee-chip ${on ? 'on' : ''}">
      <input type="checkbox" data-uid="${escape(m.id)}" ${on ? 'checked' : ''}>
      <span class="ls-assignee-avatar">${escape((m.display_name || m.email || '?').charAt(0).toUpperCase())}</span>
      <span class="ls-assignee-name">${escape(m.display_name || m.email || '')}</span>
    </label>`;
  }).join('');
  el.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.onchange = () => {
      const uid = cb.dataset.uid;
      if (cb.checked) {
        if (!_createQCAssignees.includes(uid)) _createQCAssignees.push(uid);
      } else {
        _createQCAssignees = _createQCAssignees.filter(x => x !== uid);
      }
      cb.closest('.ls-assignee-chip').classList.toggle('on', cb.checked);
    };
  });
}
const closeCreate = () => $('createModal').classList.add('hidden');
$('createModalClose').onclick = closeCreate;
$('createCancelBtn').onclick = closeCreate;

function renderCreateTags() {
  const el = $('fTagList'); el.innerHTML = '';
  _createTags.forEach((tag, i) => {
    const chip = document.createElement('span');
    chip.className = 'ls-tag-chip';
    chip.innerHTML = `
      <span class="ls-tag-chip-dot" style="background:${tag.color}"></span>
      <span>${escape(tag.name)}</span>
      <button class="ls-tag-chip-del" title="删除" data-i="${i}">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>`;
    chip.querySelector('.ls-tag-chip-del').onclick = () => {
      _createTags.splice(i, 1);
      renderCreateTags();
    };
    el.appendChild(chip);
  });
  // + 按钮
  const add = document.createElement('button');
  add.className = 'ls-tag-add';
  add.title = '添加标签';
  add.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>`;
  add.onclick = () => openTagModal();
  el.appendChild(add);
}

// 预标注：保存已选 COCO 文件对象（供提交时读取）
// 预标注：COCO 文件的服务器绝对路径存于 #fCocoName（由目录浏览器写入）

// 从服务器解析当前 #fCocoName 指向的 COCO JSON，把 categories 灌进标签列表
async function loadCocoCategoriesIntoTagList() {
  const nameBox = document.getElementById('fCocoName');
  const p = (nameBox && nameBox.value || '').trim();
  if (!p) return;
  const r = await api('GET', '/api/coco_meta?path=' + encodeURIComponent(p));
  if (!r || !r.ok) {
    toast((r && r.error) || 'COCO 解析失败', 'err');
    return;
  }
  if (!Array.isArray(r.categories) || !r.categories.length) {
    toast('COCO 文件里没有 categories', 'err');
    return;
  }
  _createTags = r.categories.map(c => ({ name: c.name, color: c.color }));
  if (typeof renderCreateTags === 'function') renderCreateTags();
  toast(`已从 COCO 载入 ${r.categories.length} 个类别，可再编辑`, 'ok');
}

$('createSubmitBtn').onclick = async () => {
  const name = $('fName').value.trim();
  const desc = $('fDesc').value.trim();
  const task_type = (_taskDropdown && _taskDropdown.getValue()) || '';
  const image_dir = $('fImageDir').value.trim();
  if (!name) return ($('createErr').textContent = '请填写项目名称');
  if (!task_type) return ($('createErr').textContent = '请选择标注类型');
  if (!image_dir) return ($('createErr').textContent = '请填写图片目录');
  const isPre = task_type === '预标注';
  const cocoPath = ($('fCocoName') && $('fCocoName').value || '').trim();
  if (isPre) {
    if (!cocoPath) return ($('createErr').textContent = '请选择 COCO 格式 JSON 文件（应位于图片目录中）');
  }
  if (_createTags.length === 0) {
    return ($('createErr').textContent = isPre
      ? '标签类别为空。请先选择 COCO 文件，或点击 + 手动添加'
      : '至少添加一个标签类别（点击 + 添加）');
  }
  // Admin 必须至少选择一名组员（Root 不参与分配）
  if (S.user && S.user.role === 'admin' && _createAssignees.length === 0) {
    return ($('createErr').textContent = '请至少选择一名组员分配任务');
  }
  // Admin 必须至少选择一名质检员
  if (S.user && S.user.role === 'admin' && _createQCAssignees.length === 0) {
    return ($('createErr').textContent = '请至少选择一名质检员');
  }

  const payload = {
    name, description: desc, task_type, image_dir,
    // 无论是不是预标注，都把 admin 编辑后的标签发过去（预标注：后端会用它覆盖 COCO 原始名）
    categories: _createTags,
    assignees: _createAssignees,
    qc_assignees: _createQCAssignees,
  };
  if (isPre) payload.coco_path = cocoPath;
  const r = await api('POST', '/api/projects', payload);
  if (!r.ok) return ($('createErr').textContent = r.error || '创建失败');
  closeCreate();
  toast('项目已创建', 'ok');
  await loadProjects();
  // Admin/Root 进入项目配置；Member 进入标注（保留旧行为兜底）
  const role = S.user && S.user.role;
  if (role === 'admin' || role === 'root') goProjectConfig(r.project);
  else goEditor(r.project);
};

// 预标注：COCO 文件选择器（用服务器目录浏览器，起始目录=图片目录）+ 任务类型切换显隐控制
document.addEventListener('DOMContentLoaded', () => {
  const pickBtn = document.getElementById('fCocoPickBtn');
  const nameBox = document.getElementById('fCocoName');
  if (pickBtn && nameBox) {
    pickBtn.onclick = () => {
      // 起始目录：优先图片目录，否则默认根目录
      const imgDir = ($('fImageDir').value || '').trim();
      openBrowseModal('fCocoName', {
        mode: 'file',
        ext: 'json',
        startDir: imgDir,
      });
    };
    // 监听 #fCocoName 变化（浏览器选中一个 .json 文件后写入并 dispatch('change')）
    // 立即拉一次 categories，灌入标签编辑区，让 admin 可再改
    nameBox.addEventListener('change', () => {
      if ((nameBox.value || '').trim()) loadCocoCategoriesIntoTagList();
    });
  }
  // 监听 task_type 变化：预标注 → 显示 COCO 输入；标签类别区域**始终显示**（可编辑）
  const applyPreVisibility = () => {
    const tt = (_taskDropdown && _taskDropdown.getValue && _taskDropdown.getValue()) || '';
    const isPre = tt === '预标注';
    const cocoGroup = document.getElementById('fCocoGroup');
    const tagGroup  = document.getElementById('fTagGroup');
    if (cocoGroup) cocoGroup.classList.toggle('hidden', !isPre);
    // 预标注也需要标签区可见，让用户改名/换色
    if (tagGroup)  tagGroup.classList.remove('hidden');
  };
  // hook 到下拉菜单每个选项的 click 上
  document.querySelectorAll('#fTaskMenu .ls-dropdown-item').forEach(it => {
    it.addEventListener('click', () => setTimeout(applyPreVisibility, 0));
  });
  // 打开"创建项目"弹窗时也应用一次
  const createBtn = document.getElementById('createProjectBtn');
  if (createBtn) createBtn.addEventListener('click', () => setTimeout(applyPreVisibility, 0));
});

// ========================================================
// 添加/编辑标签 Modal（含"已创建"区域）
// ========================================================
let _tagSelectedColor = null;    // 未选颜色（必选）
let _tagEditIndex = -1;          // -1 = 添加模式，>=0 = 编辑第 N 个已创建

function openTagModal() {
  _tagEditIndex = -1;
  _tagSelectedColor = null;
  $('tagModalTitle').textContent = '添加标签';
  $('tagSubmitBtn').textContent = '添加';
  $('tagName').value = '';
  $('tagErr').textContent = '';
  renderColorGrid();
  renderCreatedTags();
  $('tagModal').classList.remove('hidden');
  setTimeout(() => $('tagName').focus(), 30);
}

function renderColorGrid() {
  const g = $('tagColorGrid'); g.innerHTML = '';
  _palette.forEach(c => {
    const cl = c.toLowerCase();
    const isSelected = _tagSelectedColor && cl === _tagSelectedColor.toLowerCase();
    // 是否被其他标签占用（编辑模式排除自己）
    const usedByOther = _createTags.some((t, i) =>
      i !== _tagEditIndex && t.color.toLowerCase() === cl);

    const sw = document.createElement('div');
    sw.className = 'ls-color-swatch'
      + (isSelected ? ' selected' : '')
      + (usedByOther ? ' used' : '');
    sw.style.background = c;
    sw.title = usedByOther ? c + '（已被其他标签使用）' : c;
    sw.onclick = () => {
      if (usedByOther) {
        $('tagErr').textContent = '该颜色已被其他标签使用，请选择另一种颜色';
        return;
      }
      _tagSelectedColor = c;
      $('tagErr').textContent = '';
      renderColorGrid();
    };
    g.appendChild(sw);
  });
}

function renderCreatedTags() {
  const el = $('tagCreatedList'); el.innerHTML = '';
  $('tagCreatedCount').textContent = _createTags.length;
  if (_createTags.length === 0) {
    el.innerHTML = '<div class="ls-tag-created-empty">还没有已创建的标签，输入名称并选择颜色，点击"添加"</div>';
    return;
  }
  _createTags.forEach((t, i) => {
    const item = document.createElement('div');
    item.className = 'ls-tag-created-item' + (i === _tagEditIndex ? ' editing' : '');
    item.title = '点击编辑';
    item.innerHTML = `
      <span class="ls-tag-created-dot" style="background:${t.color}"></span>
      <span>${escape(t.name)}</span>
      <button class="ls-tag-created-x" title="删除">
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>`;
    // 点击删除按钮
    item.querySelector('.ls-tag-created-x').onclick = (e) => {
      e.stopPropagation();
      _createTags.splice(i, 1);
      if (_tagEditIndex === i) {
        _tagEditIndex = -1;
        $('tagName').value = '';
        _tagSelectedColor = null;
        $('tagModalTitle').textContent = '添加标签';
        $('tagSubmitBtn').textContent = '添加';
      } else if (_tagEditIndex > i) {
        _tagEditIndex -= 1;
      }
      $('tagErr').textContent = '';
      renderCreatedTags();
      renderColorGrid();
      renderCreateTags();
      toast('已删除', 'ok');
    };
    // 点击 chip 主体：进入编辑模式
    item.onclick = () => {
      _tagEditIndex = i;
      $('tagModalTitle').textContent = '编辑标签';
      $('tagSubmitBtn').textContent = '保存';
      $('tagName').value = t.name;
      _tagSelectedColor = t.color;
      $('tagErr').textContent = '';
      renderColorGrid();
      renderCreatedTags();
      setTimeout(() => $('tagName').focus(), 20);
    };
    el.appendChild(item);
  });
}

const closeTagModal = () => $('tagModal').classList.add('hidden');
$('tagModalClose').onclick = closeTagModal;
$('tagCancelBtn').onclick = closeTagModal;

$('tagSubmitBtn').onclick = () => {
  const name = $('tagName').value.trim();
  if (!name) return ($('tagErr').textContent = '请输入标签名称');
  if (!_tagSelectedColor) return ($('tagErr').textContent = '请选择颜色');

  const sc = _tagSelectedColor.toLowerCase();
  // 颜色冲突（排除编辑对象自身）
  const colorConflict = _createTags.findIndex((t, i) =>
    i !== _tagEditIndex && t.color.toLowerCase() === sc);
  if (colorConflict !== -1) {
    const other = _createTags[colorConflict].name;
    $('tagErr').textContent = `该颜色已被"${other}"使用，无法创建。请选择另一种颜色`;
    toast(`颜色已被"${other}"使用`, 'err');
    return;
  }
  // 名称冲突
  const nameConflict = _createTags.findIndex((t, i) =>
    i !== _tagEditIndex && t.name === name);
  if (nameConflict !== -1) {
    $('tagErr').textContent = '标签名称已存在';
    toast('标签名称已存在', 'err');
    return;
  }

  if (_tagEditIndex >= 0) {
    _createTags[_tagEditIndex] = { name, color: _tagSelectedColor };
    toast('标签已更新', 'ok');
  } else {
    _createTags.push({ name, color: _tagSelectedColor });
    toast('标签已添加', 'ok');
  }

  // 重置为"添加"模式，允许继续加下一个
  _tagEditIndex = -1;
  _tagSelectedColor = null;
  $('tagName').value = '';
  $('tagModalTitle').textContent = '添加标签';
  $('tagSubmitBtn').textContent = '添加';
  $('tagErr').textContent = '';
  renderColorGrid();
  renderCreatedTags();
  renderCreateTags();
  setTimeout(() => $('tagName').focus(), 20);
};

$('tagName').onkeydown = (e) => { if (e.key === 'Enter') $('tagSubmitBtn').click(); };

// ========================================================
// 浏览目录 Modal
// ========================================================
let _browseCurrentPath = null;
let _browseTargetInputId = 'fImageDir';   // 结果写入哪个 input
let _browseMode = 'dir';                  // 'dir' | 'file'
let _browseExt = '';                      // 文件模式下的扩展名过滤（不带点）

function openBrowseModal(targetInputId = 'fImageDir', opts = {}) {
  _browseTargetInputId = targetInputId;
  _browseMode = opts.mode === 'file' ? 'file' : 'dir';
  _browseExt = (opts.ext || '').replace(/^\./, '').toLowerCase();  // 例：'json'
  // 始终从固定根目录开始，避免打开到已断开的挂载点
  const DEFAULT_ROOT = '/Users/yangkun16/Desktop/label_auto';
  // 文件模式下，若指定了起始目录，用它；否则用目标输入框已有的值 or DEFAULT_ROOT
  const start = opts.startDir || $(targetInputId).value.trim();
  const initial = start || DEFAULT_ROOT;
  browseTo(initial);
  // 显示模态；隐/显"选择此目录"按钮
  $('browseModal').classList.remove('hidden');
  const selBtn = $('browseSelectBtn');
  if (selBtn) selBtn.classList.toggle('hidden', _browseMode === 'file');
}
const closeBrowse = () => $('browseModal').classList.add('hidden');
$('browseModalClose').onclick = closeBrowse;
$('browseCancelBtn').onclick = closeBrowse;

async function browseTo(path) {
  const extParam = _browseExt ? ('&ext=.' + _browseExt) : '';
  const r = await api('GET', '/api/browse?path=' + encodeURIComponent(path) + extParam);
  if (!r.ok) return toast(r.error || '无法打开目录', 'err');
  _browseCurrentPath = r.path;
  $('browsePath').value = r.path;
  const dirEntries = r.entries.filter(e => e.is_dir);
  const fileEntries = r.entries.filter(e => !e.is_dir);
  let status = `${dirEntries.length} 个子目录 · ${r.image_count} 张图片`;
  if (_browseMode === 'file') {
    status += ` · ${fileEntries.length} 个 .${_browseExt} 文件（点击文件即可选中）`;
  } else {
    if (_browseExt && fileEntries.length) {
      status += ` · ${fileEntries.length} 个 .${_browseExt} 文件（点击文件即可选中）`;
    }
    if (r.image_count > 0) status += '（可选中此目录）';
  }
  if (r.skipped) status += `  ·  跳过 ${r.skipped} 项无法访问`;
  $('browseStatus').textContent = status;

  const list = $('browseList');
  list.innerHTML = '';
  if (r.entries.length === 0) {
    list.innerHTML = `<div class="ls-browse-empty">该目录下没有子目录${r.image_count > 0 ? '。点击"选择此目录"即可' : ''}</div>`;
    return;
  }
  r.entries.forEach(e => {
    const item = document.createElement('div');
    item.className = 'ls-browse-item';
    const icon = e.is_dir
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
    item.innerHTML = `<span class="ls-browse-icon">${icon}</span><span class="ls-browse-name">${escape(e.name)}</span>`;
    const child = r.path.replace(/\/$/, '') + '/' + e.name;
    if (e.is_dir) {
      item.onclick = () => browseTo(child);
    } else {
      // 文件模式下：点击文件即选中并关闭
      item.onclick = () => {
        const el = $(_browseTargetInputId);
        el.value = child;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        closeBrowse();
        toast('已选择：' + child, 'ok');
      };
    }
    list.appendChild(item);
  });
}

$('browseUpBtn').onclick = async () => {
  if (!_browseCurrentPath) return;
  const r = await api('GET', '/api/browse?path=' + encodeURIComponent(_browseCurrentPath));
  if (r.ok && r.parent) browseTo(r.parent);
};
$('browseGoBtn').onclick = () => browseTo($('browsePath').value.trim());
$('browsePath').onkeydown = (e) => { if (e.key === 'Enter') browseTo($('browsePath').value.trim()); };

$('browseSelectBtn').onclick = () => {
  if (!_browseCurrentPath) return;
  $(_browseTargetInputId).value = _browseCurrentPath;
  closeBrowse();
  toast('已选择：' + _browseCurrentPath, 'ok');
};

$('fBrowseBtn').onclick = () => openBrowseModal('fImageDir', { ext: 'txt' });

// Settings 里也支持浏览按钮（如果 HTML 里有 sBrowseBtn 就绑定）
if ($('sBrowseBtn')) $('sBrowseBtn').onclick = () => openBrowseModal('sImageDir');

// ========================================================
// Project Settings Modal
// ========================================================
$('settingsBtn').onclick = () => {
  const p = S.currentProject; if (!p) return;
  $('sName').value = p.name;
  $('sDesc').value = p.description || '';
  $('sImageDir').value = p.image_dir;
  $('sCategories').value = p.categories.join(', ');
  $('settingsErr').textContent = '';
  $('settingsModal').classList.remove('hidden');
};
const closeSettings = () => $('settingsModal').classList.add('hidden');
$('settingsModalClose').onclick = closeSettings;
$('settingsCancelBtn').onclick = closeSettings;
$('settingsSaveBtn').onclick = async () => {
  const p = S.currentProject; if (!p) return;
  const patch = {
    name: $('sName').value.trim(),
    description: $('sDesc').value.trim(),
    image_dir: $('sImageDir').value.trim(),
    categories: $('sCategories').value.split(/[,，\n]/).map(s => s.trim()).filter(Boolean),
  };
  const r = await api('PATCH', '/api/projects/' + p.id, patch);
  if (!r.ok) return ($('settingsErr').textContent = r.error || '保存失败');
  S.currentProject = r.project;
  $('editorProjectName').textContent = r.project.name;
  $('editorProjectPath').textContent = r.project.image_dir;
  $('editorProjectPath').title = r.project.image_dir;
  renderCategories();
  await refreshImages();
  closeSettings();
  toast('已保存', 'ok');
};
$('settingsDeleteBtn').onclick = async () => {
  const p = S.currentProject; if (!p) return;
  if (!confirm(`确认删除项目 "${p.name}"？所有标注也会被删除且不可恢复。`)) return;
  const r = await api('DELETE', '/api/projects/' + p.id);
  if (!r.ok) return toast(r.error || '删除失败', 'err');
  closeSettings(); toast('项目已删除', 'ok');
  goProjects();
};
$('backToProjectsBtn').onclick = () => {
  if (S.isDirty && !confirm('当前有未保存的修改，返回将丢失。继续？')) return;
  goProjects();
};

// ========================================================
// Editor: 图片列表
// ========================================================
// 最近保存的乐观窗口：30 秒内本地已 save 过的图不允许被服务端旧快照打回"未标"
const _RECENT_SAVE_WINDOW_MS = 30000;

// 把服务端返回的 images 列表和本地 _recentSaves / _recentQC 合并；防止服务端
// 在版本推进 / 并发写入 / 请求 in-flight 的短窗口内返回旧快照时，让 UI 闪回。
//   _recentSaves: image_id -> ts (标注员保存过)
//   _recentQC:    image_id -> {ts, qcStatus} (质检员刚判定过)
function _mergeImagesWithRecentSaves(serverImages) {
  const now = Date.now();
  const recent = (S._recentSaves = S._recentSaves || new Map());
  const recentQC = (S._recentQC = S._recentQC || new Map());
  for (const [id, ts] of recent) {
    if (now - ts > _RECENT_SAVE_WINDOW_MS) recent.delete(id);
  }
  for (const [id, v] of recentQC) {
    if (now - v.ts > _RECENT_SAVE_WINDOW_MS) recentQC.delete(id);
  }
  return serverImages.map(srv => {
    let out = srv;
    // 本地刚 save 过 → 强制"已标注 + 未打回"
    const savedAt = recent.get(srv.image_id);
    if (savedAt !== undefined
        && !srv.annotated
        && srv.qc_status !== 'rejected'
        && (now - savedAt) <= _RECENT_SAVE_WINDOW_MS) {
      out = { ...out, annotated: true, pre_annotated: false,
              qc_status: out.qc_status || 'pending' };
    }
    // 本地刚做过质检判定 → 强制以本地 qc_status 为准
    const qcRec = recentQC.get(srv.image_id);
    if (qcRec && (now - qcRec.ts) <= _RECENT_SAVE_WINDOW_MS
        && srv.qc_status !== qcRec.qcStatus) {
      out = { ...out, qc_status: qcRec.qcStatus };
      // 若本地 qc 是 rejected，同步把 annotated 拉下（annotator 那边应该显示"被打回"）
      if (qcRec.qcStatus === 'rejected') out.annotated = false;
      // 若本地 qc 是 passed，annotated 显然是 true
      if (qcRec.qcStatus === 'passed') { out.annotated = true; out.pre_annotated = false; }
    }
    return out;
  });
}

async function refreshImages() {
  if (!S.currentProject) return;
  const r = await api('GET', '/api/projects/' + S.currentProject.id + '/images');
  if (!r.ok) return toast(r.error || '加载失败', 'err');
  _dropChangedPrefetch(r.images);
  S.images = _mergeImagesWithRecentSaves(r.images);
  applyFilter();
  updateProgress(r.annotated, r.total);
  if (S.currentIdx < 0 && S.filtered.length > 0) selectImage(0);
}

// 静默刷新：只更新左侧图片列表 + 状态色，不清空选中、不重定位、不弹 toast
// 用于自动轮询，让标注员/质检员能及时看到对方对图片状态的改动（比如被打回）
async function refreshImagesSilent() {
  if (!S.currentProject || S.view !== 'editor') return;
  try {
    const r = await api('GET', '/api/projects/' + S.currentProject.id + '/images');
    if (!r.ok) return;
    _dropChangedPrefetch(r.images);
    S.images = _mergeImagesWithRecentSaves(r.images);
    applyFilter();
    updateProgress(r.annotated, r.total);
    // 同步一下当前图片的 qc_status，让顶栏/QC 徽章跟上
    if (S.currentImageId) {
      const cur = S.images.find(x => x.image_id === S.currentImageId);
      if (cur && cur.qc_status !== S.qcStatus) {
        S.qcStatus = cur.qc_status || 'pending';
        updateQCChip && updateQCChip();
      }
    }
  } catch (_) { /* ignore */ }
}

// 编辑器视图下每 12s 轮询一次；窗口重新获得焦点时也刷新一次
setInterval(() => { if (S.view === 'editor') refreshImagesSilent(); }, 12000);
window.addEventListener('focus', () => { if (S.view === 'editor') refreshImagesSilent(); });
function applyFilter() {
  const q = S.search.toLowerCase();
  const qc = !!S.isQCMode;
  S.filtered = S.images.filter(img => {
    if (qc) {
      // 质检语义：未质检=qc_status pending, 已通过=passed, 已打回=rejected
      if (S.filter === 'pending' && img.qc_status !== 'pending') return false;
      if (S.filter === 'annotated' && img.qc_status !== 'passed') return false;
      if (S.filter === 'rejected' && img.qc_status !== 'rejected') return false;
    } else {
      // 标注员语义：
      //   待标 = 未标注 且 未被打回（真正没动过的图）
      //   已标 = 已标注 且 未被打回
      //   被打回 = qc_status === 'rejected'（不出现在待标里，专属自己的一栏）
      if (S.filter === 'annotated' && !img.annotated) return false;
      if (S.filter === 'pending' && (img.annotated || img.qc_status === 'rejected')) return false;
      if (S.filter === 'rejected' && img.qc_status !== 'rejected') return false;
    }
    if (q && !img.image_id.toLowerCase().includes(q)) return false;
    return true;
  });
  renderImageList(); updateTaskCounter(); updateChipBadges();
}

// 待标 / 被打回 数量红点徽章
function updateChipBadges() {
  const qc = !!S.isQCMode;
  let pending = 0, rejected = 0;
  for (const img of (S.images || [])) {
    if (qc) {
      if (img.qc_status === 'pending') pending++;
    } else {
      // 标注员：待标 = 未标注 且 未被打回（rejected 只出现在被打回徽章里，不重复计入待标）
      if (!img.annotated && img.qc_status !== 'rejected') pending++;
    }
    if (img.qc_status === 'rejected') rejected++;
  }
  document.querySelectorAll('.ls-chip-group .ls-chip').forEach(chip => {
    const old = chip.querySelector('.ls-chip-badge');
    if (old) old.remove();
    const f = chip.dataset.filter;
    let count = 0;
    if (f === 'pending') count = pending;
    else if (f === 'rejected') count = rejected;
    if (count > 0) {
      chip.style.position = 'relative';
      const b = document.createElement('span');
      b.className = 'ls-chip-badge';
      b.textContent = count > 99 ? '99+' : count;
      b.style.cssText = 'position:absolute;top:-6px;right:-6px;background:#ef4444;color:#fff;font-size:10px;line-height:14px;min-width:14px;height:14px;border-radius:50% 50% 50% 0;padding:0 4px;box-shadow:0 1px 2px rgba(0,0,0,.15);text-align:center;pointer-events:none;font-weight:600;transform:rotate(-45deg);';
      // 内部再套一层反向旋转，让数字保持正向
      const inner = document.createElement('span');
      inner.textContent = b.textContent;
      inner.style.cssText = 'display:inline-block;transform:rotate(45deg);';
      b.textContent = '';
      b.appendChild(inner);
      chip.appendChild(b);
    }
  });
  updateFinishBtn(pending, rejected);
}

// 完成标注按钮：
// - 显示：标注员模式，且「待标 <= 1 且 被打回 <= 1」（接近尾声时给出提示）
// - 可点：剩余待处理正好为 1 张（sum == 1）；全部为 0 视为已完成，无需再点
function updateFinishBtn(pending, rejected) {
  const btn = document.getElementById('finishBtn');
  if (!btn) return;
  const isLabeler = !S.isQCMode;
  // 待标 和 被打回 现在是不重叠的两个集合，未完成 = pending + rejected
  const p = pending || 0, r = rejected || 0;
  const remaining = p + r;
  const showable = isLabeler && remaining <= 1;
  if (!showable) {
    btn.classList.add('hidden');
    btn.disabled = true;
    return;
  }
  btn.classList.remove('hidden');
  btn.disabled = !(remaining === 1);
}
// 与 S.filtered 同序的行元素，切图时只改 active 类，不重建整个列表
let _imgRowEls = [];
let _activeRowIdx = -1;
function renderImageList() {
  const el = $('imageList'); el.innerHTML = '';
  _imgRowEls = [];
  _activeRowIdx = -1;
  const qc = !!S.isQCMode;
  const frag = document.createDocumentFragment();
  S.filtered.forEach((img, idx) => {
    const row = document.createElement('div');
    const isActive = img.image_id === S.currentImageId;
    if (isActive) _activeRowIdx = idx;
    row.className = 'ls-file-item' + (isActive ? ' active' : '');
    // 质检员：未质检灰 / 已通过绿 / 打回黄
    // 标注员：未标注灰 / 打回黄 / 已标注绿
    let statusCls = '';
    if (qc) {
      if (img.qc_status === 'passed') statusCls = 'done';
      else if (img.qc_status === 'rejected') statusCls = 'rejected';
      // pending 保持灰
    } else {
      if (img.qc_status === 'rejected') statusCls = 'rejected';
      else if (img.annotated) statusCls = 'done';
    }
    const rejTag = img.qc_status === 'rejected'
      ? '<span class="ls-file-reject-tag" title="被打回">打回</span>' : '';
    row.innerHTML = `
      <span class="ls-file-idx">${idx + 1}</span>
      <span class="ls-file-status ${statusCls}"></span>
      <span class="ls-file-name" title="${escape(img.image_id)}">${escape(img.image_id)}</span>
      ${rejTag}
      ${img.box_count > 0 ? `<span class="ls-file-count">${img.box_count}</span>` : ''}`;
    row.onclick = () => selectImage(idx);
    _imgRowEls.push(row);
    frag.appendChild(row);
  });
  el.appendChild(frag);
}
// 切图只需要挪动高亮：几千行的列表全量重建会在主线程上卡住几百毫秒，
// 表现就是"按下一张后画面/框迟迟不出来"。
function updateImageListActive() {
  if (_imgRowEls.length !== S.filtered.length) { renderImageList(); return; }
  if (_activeRowIdx >= 0 && _imgRowEls[_activeRowIdx]) {
    _imgRowEls[_activeRowIdx].classList.remove('active');
  }
  _activeRowIdx = S.currentIdx;
  const cur = _imgRowEls[_activeRowIdx];
  if (cur) {
    cur.classList.add('active');
    cur.scrollIntoView({ block: 'nearest' });
  }
}
function updateProgress(annotated, total) {
  $('progressText').textContent = `${annotated}/${total}`;
  const pct = total > 0 ? Math.round(annotated / total * 100) : 0;
  $('progressFill').style.width = pct + '%';
}
function updateTaskCounter() {
  const total = S.filtered.length, cur = S.currentIdx + 1;
  $('taskCounter').textContent = total > 0 ? `${cur} / ${total}` : '— / —';
  // TopBar 位置显示当前标注的图片名（未选图则显示项目路径）
  const pathEl = $('editorProjectPath');
  if (pathEl) {
    if (S.currentImageId) {
      pathEl.textContent = S.currentImageId;
      pathEl.title = S.currentImageId;
    } else if (S.currentProject) {
      pathEl.textContent = S.currentProject.image_dir;
      pathEl.title = S.currentProject.image_dir;
    }
  }
}

document.querySelectorAll('.ls-chip-group .ls-chip').forEach(chip => {
  chip.onclick = () => {
    document.querySelectorAll('.ls-chip-group .ls-chip').forEach(c => c.classList.remove('ls-chip-active'));
    chip.classList.add('ls-chip-active');
    S.filter = chip.dataset.filter;
    applyFilter();
  };
});
$('searchInput').oninput = (e) => { S.search = e.target.value; applyFilter(); };

// ========================================================
// Editor: 类别
// ========================================================
function renderCategories() {
  const p = S.currentProject; if (!p) return;
  const el = $('categoryList'); el.innerHTML = '';
  const km = labelKeyMap();
  p.categories.forEach((cat, i) => {
    const color = p.colors[cat] || '#888';
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'ls-label-strip-item' + (cat === S.currentCat ? ' active' : '');
    item.style.setProperty('--cat-color', color);
    item.title = cat + (km[cat] ? `（快捷键 ${keyDisplay(km[cat])}）` : '');
    const key = km[cat]
      ? `<span class="ls-label-strip-key">${escape(keyDisplay(km[cat]))}</span>` : '';
    item.innerHTML = `<span class="ls-label-strip-name">${escape(cat)}</span>${key}`;
    item.onclick = () => selectCategory(cat);
    el.appendChild(item);
  });
  if (!S.currentCat && p.categories.length) S.currentCat = p.categories[0];
}
function selectCategory(cat) {
  S.currentCat = cat;
  renderCategories();
  if (S.selectedIdx >= 0) {
    if (S.isLocked) { toast('此图已提交给质检，不可修改', 'err'); return; }
    pushHistory();
    S.boxes[S.selectedIdx].category = cat;
    S.isDirty = true;
    renderRegions(); renderDetails(); redraw();
  }
}

// ========================================================
// 侧栏折叠/展开
// ========================================================
function setSideCollapsed(side, collapsed) {
  const asideId = side === 'left' ? 'sideLeft' : 'sideRight';
  const btnId = side === 'left' ? 'sideLeftExpand' : 'sideRightExpand';
  const aside = $(asideId);
  const expandBtn = $(btnId);
  if (!aside || !expandBtn) return;
  aside.classList.toggle('collapsed', collapsed);
  expandBtn.classList.toggle('hidden', !collapsed);
  try {
    localStorage.setItem('la_side_' + side + '_collapsed', collapsed ? '1' : '0');
  } catch (e) {}
  setTimeout(() => { if (S.view === 'editor') fitCanvasToStage(); }, 220);
}
$('sideLeftCollapse').onclick = () => setSideCollapsed('left', true);
$('sideRightCollapse').onclick = () => setSideCollapsed('right', true);
$('sideLeftExpand').onclick = () => setSideCollapsed('left', false);
$('sideRightExpand').onclick = () => setSideCollapsed('right', false);
// 恢复上次状态
try {
  if (localStorage.getItem('la_side_left_collapsed') === '1') setSideCollapsed('left', true);
  if (localStorage.getItem('la_side_right_collapsed') === '1') setSideCollapsed('right', true);
} catch (e) {}

// ========================================================
// 底栏 + 号：在当前项目里添加标签
// ========================================================
let _tagModalMode = 'create';   // 'create' | 'project'

$('addTagBtn').onclick = () => {
  if (!S.currentProject) return;
  _tagModalMode = 'project';
  // 把当前项目的 categories 载入 _createTags
  _createTags = S.currentProject.categories.map(name => ({
    name, color: (S.currentProject.colors || {})[name] || '#4C6EF5',
  }));
  _tagEditIndex = -1;
  _tagSelectedColor = null;
  $('tagModalTitle').textContent = '添加标签（当前项目）';
  $('tagSubmitBtn').textContent = '添加';
  $('tagName').value = '';
  $('tagErr').textContent = '';
  renderColorGrid();
  renderCreatedTags();
  $('tagModal').classList.remove('hidden');
  setTimeout(() => $('tagName').focus(), 30);
};

// 关闭 tagModal 时若是 project 模式则 PATCH 项目
async function persistTagsToProjectIfNeeded() {
  if (_tagModalMode !== 'project' || !S.currentProject) return;
  const patch = { categories: _createTags };
  const r = await api('PATCH', '/api/projects/' + S.currentProject.id, patch);
  if (r.ok && r.project) {
    S.currentProject = r.project;
    if (S.view === 'editor') renderCategories();
    if (S.view === 'project_config') renderPcCategories();
    toast('标签已更新到项目', 'ok');
  } else if (r.error) {
    toast(r.error, 'err');
  }
  _tagModalMode = 'create';
}

// 覆写关闭按钮，在 project 模式下先保存
$('tagModalClose').onclick = async () => {
  await persistTagsToProjectIfNeeded();
  $('tagModal').classList.add('hidden');
};
$('tagCancelBtn').onclick = async () => {
  await persistTagsToProjectIfNeeded();
  $('tagModal').classList.add('hidden');
};

// ========================================================
// Editor: Canvas
// ========================================================
const canvas = $('canvas');
const ctx = canvas.getContext('2d');
const stage = $('stage');

// 取图 -> blob -> 解码完成后才 resolve，返回 {img, url}
// 走 fetch 带 Bearer，再转 blob URL 塞给 <img>；这样身份用的是本标签的 token，
// 而不是浏览器全局的 cookie
function _loadImageForId(pid, imageId) {
  const headers = {};
  const tk = getToken();
  if (tk) headers['Authorization'] = 'Bearer ' + tk;
  return fetch(`/api/projects/${pid}/image?image_id=` + encodeURIComponent(imageId),
               { credentials: 'omit', headers })
    .then(resp => { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.blob(); })
    .then(blob => new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const im = new Image();
      im.onload = () => resolve({ img: im, url });
      im.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片解码失败')); };
      im.src = url;
    }));
}

async function selectImage(idx) {
  if (idx < 0 || idx >= S.filtered.length) return;
  // 若点到的是同一张图，直接忽略
  const target = S.filtered[idx];
  if (target && target.image_id === S.currentImageId) return;
  // 注意：不再在切换时自动保存——只有在标注员点击工具栏「下一张」按钮时才自动保存当前图
  const idx2 = S.filtered.findIndex(x => x.image_id === target.image_id);
  if (idx2 < 0) return;
  const curImg = S.filtered[idx2];
  const myId = curImg.image_id;         // 本次切换的目标，用于丢弃过期结果
  const pid = S.currentProject.id;
  S.currentIdx = idx2;
  S.currentImageId = myId;
  S.selectedIdx = -1; S.hoverIdx = -1;
  S.history = []; S.future = [];
  S.isDirty = false;
  // 只挪高亮，不重建列表（列表内容在筛选/保存后才需要重建）
  updateImageListActive(); updateTaskCounter();

  // 图片和 annotation 并行取，两者都就绪后再一次性换画面。
  // 关键：不能先换图后换框——图片往往先到（走 HTTP 缓存），框还在路上，
  // 画出来就是"新图配上一张的框"，过一会儿框才被替换掉（用户看到的闪烁）。
  // 预取结果要先过期/一致性校验，否则别人刚改过的图会显示成旧的框
  const hit = _takePrefetchedAnn(pid, myId, curImg);
  const annP = hit
    ? Promise.resolve(hit)
    : api('GET', `/api/projects/${pid}/annotation?image_id=` + encodeURIComponent(myId));
  let loaded, r;
  try {
    [loaded, r] = await Promise.all([_loadImageForId(pid, myId), annP]);
  } catch (e) {
    toast('图片加载失败: ' + e.message, 'err');
    return;
  }
  // 期间用户又切到别的图：丢弃这次结果，并回收刚创建的 blob URL
  if (S.currentImageId !== myId) { URL.revokeObjectURL(loaded.url); return; }

  // ---- 原子替换：图、框、状态一起生效，中间不存在不一致的帧 ----
  if (S._imgBlobUrl) URL.revokeObjectURL(S._imgBlobUrl);
  S._imgBlobUrl = loaded.url;
  S.img = loaded.img;
  S.boxes = (r && r.ok && r.boxes) || [];
  S.qcStatus = (r && r.ok && r.qc_status) || 'pending';
  S.preAnnotated = !!(r && r.ok && r.pre_annotated);
  // 标注员在"已标注且未被打回"的图片上是只读的（防止误改已提交给质检的结果）
  S.isLocked = !S.isQCMode && !!curImg.annotated && S.qcStatus !== 'rejected';
  fitCanvasToStage();
  updateQCChip();
  renderRegions(); renderDetails(); redraw();
  // 画面已经出来了，再悄悄预取相邻的几张，让下次切图零延迟
  _prefetchNextImages(idx2);
}

// 预取列表中下一张 / 再下一张的图片，仅把响应写进浏览器 HTTP 缓存
// （服务端返 Cache-Control: public, max-age=3600, immutable），
// 用户真点下一张时 selectImage 里的 fetch 直接命中缓存，切图无感。
// annotation JSON 无法走 HTTP 缓存（带 Bearer、无缓存头），改为在前端内存里缓存预取结果。
const _annPrefetch = new Map();   // key: `${pid}|${image_id}` -> { ts, resp }
// 预取结果最多信任这么久：别人（标注员/质检员）随时可能改同一张图，
// 缓存里的框会变成旧的。TTL 只是兜底，主要依靠下面两处校验。
const _ANN_PREFETCH_TTL = 30000;

// 取用预取结果：过期、或与列表里的最新状态不一致就丢弃，让调用方走实时请求。
// 典型场景：质检员打回一张图 -> 标注员改完保存（qc_status 由 rejected 变 pending，
// box_count 也可能变）-> 质检员再看这张图。若直接用早先预取的结果，看到的还是
// 打回前那份错误的框。
function _takePrefetchedAnn(pid, imageId, item) {
  const key = pid + '|' + imageId;
  const e = _annPrefetch.get(key);
  if (!e) return null;
  _annPrefetch.delete(key);
  if (!e.resp || (Date.now() - e.ts) > _ANN_PREFETCH_TTL) return null;
  if (item) {
    const n = (e.resp.boxes || []).length;
    if (typeof item.box_count === 'number' && item.box_count !== n) return null;
    if (item.qc_status && e.resp.qc_status && item.qc_status !== e.resp.qc_status) return null;
  }
  return e.resp;
}

// 轮询拿到新列表时，把状态有变化的那些图的预取缓存丢掉（多为别人改动导致）
function _dropChangedPrefetch(newImages) {
  if (!S.currentProject || !S.images || !S.images.length) return;
  const pid = S.currentProject.id;
  const old = new Map(S.images.map(x => [x.image_id, x]));
  for (const it of newImages) {
    const o = old.get(it.image_id);
    if (!o) continue;
    if (o.box_count !== it.box_count || o.qc_status !== it.qc_status ||
        o.annotated !== it.annotated || o.pre_annotated !== it.pre_annotated) {
      _annPrefetch.delete(pid + '|' + it.image_id);
    }
  }
}
function _prefetchNextImages(idx) {
  if (!S.currentProject) return;
  const tk = getToken();
  const headers = tk ? { 'Authorization': 'Bearer ' + tk } : {};
  const pid = S.currentProject.id;
  // 前两张 + 后一张：标注员会上下来回切，只预取后面会让"上一张"每次都要等一个来回
  for (const k of [1, 2, -1]) {
    const nxt = S.filtered[idx + k];
    if (!nxt) continue;
    fetch(
      `/api/projects/${pid}/image?image_id=` + encodeURIComponent(nxt.image_id),
      { credentials: 'omit', headers }
    ).catch(() => {});
    // 预取 annotation JSON 并缓存在内存里，切图时直接取用，预标注框秒出
    const key = pid + '|' + nxt.image_id;
    if (!_annPrefetch.has(key)) {
      api('GET', `/api/projects/${pid}/annotation?image_id=` + encodeURIComponent(nxt.image_id))
        .then(rr => {
          if (rr && rr.ok) {
            _annPrefetch.set(key, { ts: Date.now(), resp: rr });
            // 限制缓存规模，避免长时间标注后无限增长
            if (_annPrefetch.size > 20) _annPrefetch.delete(_annPrefetch.keys().next().value);
          }
        })
        .catch(() => {});
    }
  }
}

function fitCanvasToStage() {
  if (!S.img) return;
  const rect = stage.getBoundingClientRect();
  const scale = Math.min(rect.width / S.img.width, rect.height / S.img.height) * 0.96;
  S.scale = scale;
  S.offsetX = (rect.width - S.img.width * scale) / 2;
  S.offsetY = (rect.height - S.img.height * scale) / 2;
  canvas.width = rect.width; canvas.height = rect.height;
  redraw();
}
function redraw() {
  if (!canvas.width) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  $('emptyHint').style.display = S.img ? 'none' : 'flex';
  if (!S.img) return;
  ctx.drawImage(S.img, S.offsetX, S.offsetY, S.img.width * S.scale, S.img.height * S.scale);
  if (S.showRaw) return;
  S.boxes.forEach((b, i) => { if (!b.hidden) drawBox(b, i); });
  if (S.dragging && S.dragging.type === 'new') {
    drawBox({ category: S.currentCat, bbox: S.dragging.bbox }, -1, true);
  }
}
function drawBox(box, idx, isPreview = false) {
  const color = (S.currentProject && S.currentProject.colors[box.category]) || '#888';
  const x = S.offsetX + box.bbox.x1 * S.img.width * S.scale;
  const y = S.offsetY + box.bbox.y1 * S.img.height * S.scale;
  const w = (box.bbox.x2 - box.bbox.x1) * S.img.width * S.scale;
  const h = (box.bbox.y2 - box.bbox.y1) * S.img.height * S.scale;
  ctx.fillStyle = color + '20'; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = color;
  ctx.lineWidth = (idx === S.selectedIdx) ? 2.5 : 1.5;
  if (idx === S.hoverIdx && idx !== S.selectedIdx) ctx.lineWidth = 2;
  ctx.setLineDash(isPreview ? [4, 4] : []);
  ctx.strokeRect(x, y, w, h); ctx.setLineDash([]);
  const label = `${idx >= 0 ? '#' + (idx + 1) + ' ' : ''}${box.category || '?'}`;
  ctx.font = '600 11px system-ui, sans-serif';
  const tw = ctx.measureText(label).width;
  ctx.fillStyle = color; ctx.fillRect(x, y - 17, tw + 10, 17);
  ctx.fillStyle = '#fff'; ctx.fillText(label, x + 5, y - 5);
  if (idx === S.selectedIdx && !isPreview) {
    const hs = 6;
    ctx.fillStyle = '#fff'; ctx.strokeStyle = color; ctx.lineWidth = 1.5;
    [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].forEach(([hx, hy]) => {
      ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
      ctx.strokeRect(hx - hs / 2, hy - hs / 2, hs, hs);
    });
  }
}

function screenToNorm(sx, sy) {
  if (!S.img) return { x: 0, y: 0 };
  const x = (sx - S.offsetX) / (S.img.width * S.scale);
  const y = (sy - S.offsetY) / (S.img.height * S.scale);
  return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
}
function normToScreen(nx, ny) {
  return { x: S.offsetX + nx * S.img.width * S.scale, y: S.offsetY + ny * S.img.height * S.scale };
}
function hitTest(sx, sy) {
  const HS = 8;
  for (let i = S.boxes.length - 1; i >= 0; i--) {
    const b = S.boxes[i];
    const p1 = normToScreen(b.bbox.x1, b.bbox.y1);
    const p2 = normToScreen(b.bbox.x2, b.bbox.y2);
    if (i === S.selectedIdx) {
      if (near(sx, sy, p1.x, p1.y, HS)) return { boxIdx: i, handle: 'nw' };
      if (near(sx, sy, p2.x, p1.y, HS)) return { boxIdx: i, handle: 'ne' };
      if (near(sx, sy, p1.x, p2.y, HS)) return { boxIdx: i, handle: 'sw' };
      if (near(sx, sy, p2.x, p2.y, HS)) return { boxIdx: i, handle: 'se' };
    }
    if (sx >= p1.x && sx <= p2.x && sy >= p1.y && sy <= p2.y) return { boxIdx: i, handle: null };
  }
  return { boxIdx: -1, handle: null };
}
const near = (x, y, tx, ty, r) => Math.abs(x - tx) < r && Math.abs(y - ty) < r;

// 鼠标事件
canvas.addEventListener('mousedown', (e) => {
  if (!S.img) return;
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
  if (S.spacePressed || e.button === 1 || S.tool === 'pan') {
    S.dragging = { type: 'pan', startX: sx, startY: sy, offsetX: S.offsetX, offsetY: S.offsetY };
    canvas.style.cursor = 'grabbing';
    return;
  }
  // QC 模式 / 标注员在已提交的图上：不允许任何画/移/缩，只允许高亮已有框
  if (S.isQCMode || S.isLocked) {
    const hit = hitTest(sx, sy);
    S.selectedIdx = hit.boxIdx;
    renderRegions(); renderDetails(); redraw();
    return;
  }
  const hit = hitTest(sx, sy);
  if (hit.handle) {
    S.selectedIdx = hit.boxIdx;
    S.dragging = { type: 'resize', boxIdx: hit.boxIdx, handle: hit.handle };
  } else if (hit.boxIdx >= 0) {
    S.selectedIdx = hit.boxIdx;
    const p = screenToNorm(sx, sy);
    const b = S.boxes[hit.boxIdx].bbox;
    S.dragging = { type: 'move', boxIdx: hit.boxIdx, startNx: p.x, startNy: p.y,
                   orig: { x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 } };
  } else {
    if (!S.currentCat) { toast('请先选择 Label', 'err'); return; }
    const p = screenToNorm(sx, sy);
    S.selectedIdx = -1;
    S.dragging = { type: 'new', startNx: p.x, startNy: p.y,
                   bbox: { x1: p.x, y1: p.y, x2: p.x, y2: p.y } };
  }
  renderRegions(); renderDetails(); redraw();
});

canvas.addEventListener('mousemove', (e) => {
  if (!S.img) return;
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
  if (!S.dragging) {
    const hit = hitTest(sx, sy);
    S.hoverIdx = hit.boxIdx;
    if (hit.handle === 'nw' || hit.handle === 'se') canvas.style.cursor = 'nwse-resize';
    else if (hit.handle === 'ne' || hit.handle === 'sw') canvas.style.cursor = 'nesw-resize';
    else if (hit.boxIdx >= 0) canvas.style.cursor = 'move';
    else canvas.style.cursor = (S.spacePressed || S.tool === 'pan') ? 'grab' : 'crosshair';
    redraw(); return;
  }
  if (S.dragging.type === 'pan') {
    S.offsetX = S.dragging.offsetX + (sx - S.dragging.startX);
    S.offsetY = S.dragging.offsetY + (sy - S.dragging.startY);
    redraw(); return;
  }
  const p = screenToNorm(sx, sy);
  if (S.dragging.type === 'new') {
    S.dragging.bbox = {
      x1: Math.min(S.dragging.startNx, p.x), y1: Math.min(S.dragging.startNy, p.y),
      x2: Math.max(S.dragging.startNx, p.x), y2: Math.max(S.dragging.startNy, p.y),
    };
    redraw();
  } else if (S.dragging.type === 'move') {
    const dx = p.x - S.dragging.startNx, dy = p.y - S.dragging.startNy;
    const b = S.boxes[S.dragging.boxIdx].bbox, o = S.dragging.orig;
    const w = o.x2 - o.x1, h = o.y2 - o.y1;
    b.x1 = Math.max(0, Math.min(1 - w, o.x1 + dx));
    b.y1 = Math.max(0, Math.min(1 - h, o.y1 + dy));
    b.x2 = b.x1 + w; b.y2 = b.y1 + h;
    renderDetails(); redraw();
  } else if (S.dragging.type === 'resize') {
    const b = S.boxes[S.dragging.boxIdx].bbox;
    if (S.dragging.handle.includes('w')) b.x1 = Math.min(p.x, b.x2 - 0.001);
    if (S.dragging.handle.includes('e')) b.x2 = Math.max(p.x, b.x1 + 0.001);
    if (S.dragging.handle.includes('n')) b.y1 = Math.min(p.y, b.y2 - 0.001);
    if (S.dragging.handle.includes('s')) b.y2 = Math.max(p.y, b.y1 + 0.001);
    renderDetails(); redraw();
  }
});

canvas.addEventListener('mouseup', () => {
  if (!S.dragging) return;
  if (S.dragging.type === 'new') {
    const b = S.dragging.bbox;
    if (b.x2 - b.x1 > 0.003 && b.y2 - b.y1 > 0.003) {
      pushHistory();
      S.boxes.push({ category: S.currentCat, bbox: b, source: 'manual' });
      // 画完框后不选中，处于不可编辑状态；点一下该框才会选中并可编辑（切换类别只影响被选中的框）
      S.selectedIdx = -1;
      S.isDirty = true;
      renderRegions(); renderDetails();
    }
  } else if (S.dragging.type === 'move' || S.dragging.type === 'resize') {
    S.isDirty = true;
  }
  S.dragging = null;
  canvas.style.cursor = (S.spacePressed || S.tool === 'pan') ? 'grab' : 'crosshair';
  redraw();
});

canvas.addEventListener('dblclick', (e) => {
  if (!S.img) return;
  const rect = canvas.getBoundingClientRect();
  const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top);
  if (hit.boxIdx >= 0) deleteRegion(hit.boxIdx);
});

canvas.addEventListener('wheel', (e) => {
  if (!S.img) return;
  e.preventDefault();
  zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.1 : 1 / 1.1);
}, { passive: false });

function zoomAt(clientX, clientY, factor) {
  const rect = canvas.getBoundingClientRect();
  const sx = clientX - rect.left, sy = clientY - rect.top;
  const before = screenToNorm(sx, sy);
  S.scale = Math.max(0.05, Math.min(20, S.scale * factor));
  S.offsetX = sx - before.x * S.img.width * S.scale;
  S.offsetY = sy - before.y * S.img.height * S.scale;
  redraw();
}

// Regions / Details 面板
function renderRegions() {
  const el = $('regionList'); el.innerHTML = '';
  $('regionsEmpty').style.display = S.boxes.length === 0 ? '' : 'none';
  $('regionCount').textContent = S.boxes.length;
  const p = S.currentProject;
  S.boxes.forEach((b, i) => {
    const item = document.createElement('div');
    item.className = 'ls-region-item' + (i === S.selectedIdx ? ' active' : '')
                    + (b.hidden ? ' hidden-box' : '');
    const color = (p && p.colors[b.category]) || '#888';
    const eyeSvg = b.hidden
      ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
      : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    item.innerHTML = `
      <span class="ls-region-idx" style="background:${color}">${i + 1}</span>
      <div class="ls-region-info">
        <div class="ls-region-cat" title="${escape(b.category)}">${escape(b.category)}</div>
      </div>
      <div class="ls-region-actions">
        <button class="ls-region-action ls-region-action-eye" data-act="visibility" title="${b.hidden ? '显示' : '隐藏'}">${eyeSvg}</button>
        <button class="ls-region-action ls-region-action-info" data-act="info" title="详细信息">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        </button>
        ${S.isQCMode ? '' : `<button class="ls-region-action ls-region-action-danger" data-act="del" title="删除">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/></svg>
        </button>`}
      </div>`;
    item.onclick = (e) => {
      const btn = e.target.closest('.ls-region-action');
      if (btn) {
        e.stopPropagation();
        const act = btn.dataset.act;
        if (act === 'del') {
          if (S.isQCMode) return;   // 质检员不能删
          deleteRegion(i); return;
        }
        if (act === 'info') { openBboxPopover(i, btn); return; }
        if (act === 'visibility') {
          S.boxes[i].hidden = !S.boxes[i].hidden;
          renderRegions(); redraw();
          return;
        }
        if (act === 'focus') {
          S.selectedIdx = i; renderRegions(); redraw();
          return;
        }
      }
      S.selectedIdx = i; renderRegions(); redraw();
    };
    el.appendChild(item);
  });
}
function boxSizeText(bb) {
  if (!S.img) return '';
  const w = Math.round((bb.x2 - bb.x1) * S.img.width);
  const h = Math.round((bb.y2 - bb.y1) * S.img.height);
  return `${w} × ${h} px`;
}

// bbox 详细信息 popover
function openBboxPopover(idx, anchor) {
  const b = S.boxes[idx];
  if (!b) return;
  const w = S.img ? Math.round((b.bbox.x2 - b.bbox.x1) * S.img.width) : 0;
  const h = S.img ? Math.round((b.bbox.y2 - b.bbox.y1) * S.img.height) : 0;
  const color = (S.currentProject && S.currentProject.colors[b.category]) || '#888';
  const body = `
    <div class="ls-details-row"><span class="ls-details-key">编号</span><span class="ls-details-val">#${idx + 1}</span></div>
    <div class="ls-details-row"><span class="ls-details-key">标签</span><span class="ls-details-val" style="color:${color}">${escape(b.category)}</span></div>
    <div class="ls-details-row"><span class="ls-details-key">来源</span><span class="ls-details-val">${b.source || 'manual'}</span></div>
    <div class="ls-details-row"><span class="ls-details-key">置信度</span><span class="ls-details-val">${b.confidence != null ? b.confidence.toFixed(2) : '—'}</span></div>
    <div class="ls-details-row"><span class="ls-details-key">尺寸</span><span class="ls-details-val">${w} × ${h} px</span></div>
    <div class="ls-details-row"><span class="ls-details-key">X1, Y1</span><span class="ls-details-val">${b.bbox.x1.toFixed(3)}, ${b.bbox.y1.toFixed(3)}</span></div>
    <div class="ls-details-row"><span class="ls-details-key">X2, Y2</span><span class="ls-details-val">${b.bbox.x2.toFixed(3)}, ${b.bbox.y2.toFixed(3)}</span></div>`;
  $('bboxPopoverBody').innerHTML = body;

  const pop = $('bboxPopover');
  pop.classList.remove('hidden');
  // 定位到 anchor 左侧（popover 弹在右侧栏的左边）
  const rect = anchor.getBoundingClientRect();
  const popRect = pop.getBoundingClientRect();
  let left = rect.left - popRect.width - 8;
  if (left < 8) left = rect.right + 8;
  let top = rect.top - 4;
  if (top + popRect.height > window.innerHeight - 12) {
    top = window.innerHeight - popRect.height - 12;
  }
  if (top < 8) top = 8;
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
}
function closeBboxPopover() { $('bboxPopover').classList.add('hidden'); }
$('bboxPopoverClose').onclick = closeBboxPopover;
document.addEventListener('click', (e) => {
  const pop = $('bboxPopover');
  if (pop.classList.contains('hidden')) return;
  if (!pop.contains(e.target) && !e.target.closest('.ls-region-action-info')) {
    closeBboxPopover();
  }
});
// renderDetails 已废弃：详情改为点击 Region 的 info 图标弹 popover 显示
function renderDetails() { /* deprecated, kept as no-op */ }
function deleteRegion(idx) {
  if (S.isQCMode) return;   // 质检员不能删除任何 bbox
  if (S.isLocked) { toast('此图已提交给质检，不可修改', 'err'); return; }
  pushHistory();
  S.boxes.splice(idx, 1);
  if (S.selectedIdx === idx) S.selectedIdx = -1;
  else if (S.selectedIdx > idx) S.selectedIdx--;
  S.isDirty = true;
  renderRegions(); renderDetails(); redraw();
}

// Undo / Redo / Save
function pushHistory() {
  S.history.push(JSON.parse(JSON.stringify(S.boxes)));
  if (S.history.length > 50) S.history.shift();
  S.future = [];
}
function undo() {
  if (S.history.length === 0) return;
  S.future.push(JSON.parse(JSON.stringify(S.boxes)));
  S.boxes = S.history.pop();
  S.selectedIdx = -1; S.isDirty = true;
  renderRegions(); renderDetails(); redraw();
}
function redo() {
  if (S.future.length === 0) return;
  S.history.push(JSON.parse(JSON.stringify(S.boxes)));
  S.boxes = S.future.pop();
  S.isDirty = true;
  renderRegions(); renderDetails(); redraw();
}
async function save(silent = false) {
  if (!S.currentImageId || !S.currentProject) return;
  setAutosaveStatus('saving');
  // 提前把本图标记为"刚保存过"，覆盖窗口 30s；这样即便保存请求排队 1-2 秒，
  // 期间的 12s 轮询拿到并发写入前的旧快照，也不会把该图闪回"待标"
  const _savedImgId = S.currentImageId;
  const _savedPid = S.currentProject.id;
  const _savedBoxes = S.boxes;
  (S._recentSaves = S._recentSaves || new Map()).set(_savedImgId, Date.now());
  const r = await api('POST', `/api/projects/${_savedPid}/save`,
    { image_id: _savedImgId, boxes: _savedBoxes });
  if (!r.ok) {
    // 服务端拒绝了这次保存，撤销刚才的乐观标记，让状态回到真实
    S._recentSaves && S._recentSaves.delete(_savedImgId);
    setAutosaveStatus('error');
    if (!silent) toast(r.error || '保存失败', 'err');
    return;
  }
  // 只有仍停在这张图上时才把"未修改"状态落回去；否则用户已经切走了，
  // 不能把新图的 isDirty 一起清掉
  if (S.currentImageId === _savedImgId) S.isDirty = false;
  setAutosaveStatus('saved');
  // 该图已变更：删掉可能存在的旧预取缓存，防止下次回看时用到过期的框
  _annPrefetch.delete(_savedPid + '|' + _savedImgId);
  if (!silent) {
    toast(`已保存 ${r.box_count} 个标注`, 'ok');
  }
  // 保存成功后再刷新一次时间戳（覆盖窗口从"成功那一刻"重新计时）
  S._recentSaves.set(_savedImgId, Date.now());
  // 性能：不再调 refreshImages()（大项目下 12k+ annotation 扫描过慢），改为本地增量更新
  const cur = S.images && S.images.find(x => x.image_id === _savedImgId);
  if (cur) {
    const wasAnnotated = !!cur.annotated && !cur.pre_annotated;
    cur.annotated = true;
    cur.qc_status = 'pending';
    cur.pre_annotated = false;
    cur.qc_reason = null;
    cur.box_count = r.box_count || (_savedBoxes ? _savedBoxes.length : 0);
    // 进度条：只在原来不是"真已标注"时 +1
    if (!wasAnnotated) {
      const total = S.images.length;
      const annotated = S.images.filter(x => x.annotated && !x.pre_annotated).length;
      updateProgress(annotated, total);
    }
    applyFilter();          // 刷新左侧列表 + 状态色
    if (S.currentImageId === _savedImgId) {
      S.qcStatus = 'pending';
      if (typeof updateQCChip === 'function') updateQCChip();
    }
  }
}

function setAutosaveStatus(state) {
  const el = $('autosaveStatus'); if (!el) return;
  el.classList.remove('saving', 'error');
  if (state === 'saving') {
    el.classList.add('saving');
    el.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg> 保存中';
  } else if (state === 'error') {
    el.classList.add('error');
    el.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> 保存失败';
  } else {
    el.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> 已保存';
  }
}

// 定时自动保存已取消：改为"切换到下一张时保存上一张"（见 selectImage）

// 工具栏按钮
document.querySelectorAll('.ls-tool[data-tool]').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.ls-tool[data-tool]').forEach(b => b.classList.remove('ls-tool-active'));
    btn.classList.add('ls-tool-active');
    S.tool = btn.dataset.tool;
    canvas.style.cursor = S.tool === 'pan' ? 'grab' : 'crosshair';
  };
});
$('fitBtn').onclick = fitCanvasToStage;
$('zoomInBtn').onclick = () => {
  const rect = canvas.getBoundingClientRect();
  zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1.2);
};
$('zoomOutBtn').onclick = () => {
  const rect = canvas.getBoundingClientRect();
  zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1 / 1.2);
};
$('viewRawBtn').onclick = () => {
  S.showRaw = !S.showRaw;
  $('viewRawBtn').classList.toggle('ls-tool-active', S.showRaw);
  redraw();
};
// AI 辅助标注（占位）
if ($('aiToolBtn')) $('aiToolBtn').onclick = () => {
  toast('AI 辅助标注 · 即将上线', 'ok');
};
$('prevBtn').onclick = () => selectImage(S.currentIdx - 1);
$('nextBtn').onclick = () => selectImage(S.currentIdx + 1);
// 工具栏「下一张」按钮：先自动保存当前图（有未保存改动，或当前是被打回的图），再切到下一张
const _nextImgBtn = document.getElementById('nextImgBtn');
if (_nextImgBtn) {
  _nextImgBtn.onclick = async () => {
    if (_nextImgBtn.disabled) return;
    // 若当前是被打回、或是仅有预标注（还未升级）的图，即使没有改动也要保存一次
    const needSaveRejected = S.qcStatus === 'rejected' && !S.isQCMode;
    const needSavePre = !!S.preAnnotated && !S.isQCMode;
    const needSave = (S.isDirty || needSaveRejected || needSavePre)
      && S.currentImageId && S.currentProject && !S.isQCMode;
    // 立刻给出点击反馈：保存要走一次网络往返，不置灰的话用户会以为"点了没反应"
    const _label = _nextImgBtn.textContent;
    if (needSave) {
      _nextImgBtn.disabled = true;
      _nextImgBtn.textContent = '保存中…';
    }
    try {
      if (needSave) await save(true);   // 静默保存；后端会把 qc_status 置为 pending
    } finally {
      if (needSave) {
        _nextImgBtn.disabled = false;
        _nextImgBtn.textContent = _label;
      }
    }
    // 保存后 S.filtered 可能已经变化。
    //   情况 A：当前图仍在新 filtered 里（筛选=全部 或 筛选=已标）
    //          → 下一张就是它右边一位，nextIdx = curIdx + 1
    //   情况 B：当前图已从新 filtered 移出（筛选=待标，保存后它变成已标被过滤掉）
    //          → 新 filtered 的第 S.currentIdx 项就是"原来的下一张"，不能再 +1，
    //            否则会跳过一张（用户报的问题就是这个 off-by-one）
    const curIdx = S.filtered.findIndex(x => x.image_id === S.currentImageId);
    const nextIdx = curIdx >= 0 ? curIdx + 1 : S.currentIdx;
    if (nextIdx >= 0 && nextIdx < S.filtered.length) selectImage(nextIdx);
    else toast('已是最后一张', 'ok');
  };
}
// 完成标注：标注到最后一张、且待标注和被打回都清零时可点击
$('finishBtn').onclick = async () => {
  const btn = $('finishBtn');
  if (btn.disabled || btn.classList.contains('hidden')) return;
  // 找到那"最后一张"仍待处理的图：待标注（未标注）或被打回
  const target = (S.images || []).find(x => !x.annotated || x.qc_status === 'rejected');
  if (!target) {
    toast('已无待处理图片', 'err');
    return;
  }
  // 若当前不是那张，跳过去让用户先完成标注，再回来点完成
  if (S.currentImageId !== target.image_id) {
    const idx = S.filtered.findIndex(x => x.image_id === target.image_id);
    if (idx >= 0) await selectImage(idx);
    else {
      // 该图不在当前筛选中：切到「全部」再定位
      S.filter = 'all';
      document.querySelectorAll('.ls-chip-group .ls-chip').forEach(c => {
        c.classList.toggle('ls-chip-active', c.dataset.filter === 'all');
      });
      applyFilter();
      const idx2 = S.filtered.findIndex(x => x.image_id === target.image_id);
      if (idx2 >= 0) await selectImage(idx2);
    }
    toast('请先完成这张图的标注，再点"完成标注"', 'ok');
    return;
  }
  // 已经在最后一张上：保存并送入质检
  await save(true);   // 后端 _api_save 会把 qc_status 置为 pending —— 相当于送入质检
  toast('已送入质检', 'ok');
  goProjects();
};
$('undoBtn').onclick = () => { if (S.isLocked) return toast('此图已提交给质检，不可修改', 'err'); undo(); };
$('redoBtn').onclick = () => { if (S.isLocked) return toast('此图已提交给质检，不可修改', 'err'); redo(); };
$('clearBtn').onclick = () => {
  if (S.isLocked) return toast('此图已提交给质检，不可修改', 'err');
  if (!S.boxes.length) return;
  if (!confirm(`清除全部 ${S.boxes.length} 个 Region？`)) return;
  pushHistory();
  S.boxes = []; S.selectedIdx = -1; S.isDirty = true;
  renderRegions(); renderDetails(); redraw();
};
// saveBtn 已移除（改为自动保存）
$('exportBtn').onclick = () => {
  if (S.currentProject) {
    window.open(`/api/projects/${S.currentProject.id}/export?format=yolo`, '_blank');
  }
};

// ========================================================
// 快捷键设置（可自定义，保存在浏览器 localStorage）
// ========================================================
// scope: 'both' 两种角色通用 | 'annotate' 仅标注界面 | 'qc' 仅质检界面
const SHORTCUT_ACTIONS = [
  { id: 'prev_image',   label: '上一张',              scope: 'both' },
  { id: 'next_image',   label: '下一张',              scope: 'both' },
  { id: 'fit_view',     label: '适应画布',            scope: 'both' },
  { id: 'toggle_raw',   label: '显示/隐藏所有框',      scope: 'both' },
  { id: 'confirm_next', label: '确认并下一张',         scope: 'annotate' },
  { id: 'rect_tool',    label: '矩形工具',            scope: 'annotate' },
  { id: 'del_box',      label: '删除选中框',          scope: 'annotate' },
  { id: 'qc_pass',      label: '质检通过',            scope: 'qc' },
  { id: 'qc_reject',    label: '质检打回',            scope: 'qc' },
];
const SHORTCUT_DEFAULTS = {
  prev_image: 'ArrowLeft', next_image: 'ArrowRight', confirm_next: 'c',
  qc_pass: 'c', qc_reject: 'v', rect_tool: 'r', toggle_raw: 'h',
  fit_view: '0', del_box: 'Delete',
};
let SHORTCUTS = { ...SHORTCUT_DEFAULTS };
function loadShortcuts() {
  try {
    const raw = localStorage.getItem('la_shortcuts');
    SHORTCUTS = raw ? { ...SHORTCUT_DEFAULTS, ...JSON.parse(raw) } : { ...SHORTCUT_DEFAULTS };
  } catch (e) { SHORTCUTS = { ...SHORTCUT_DEFAULTS }; }
}
function saveShortcuts() {
  try { localStorage.setItem('la_shortcuts', JSON.stringify(SHORTCUTS)); } catch (e) {}
}
// 归一化按键：统一小写，便于大小写无关比较（含 ArrowLeft/Delete 等功能键）
function normKey(k) { return (k || '').toLowerCase(); }
function keyMatches(e, actionId) {
  const key = SHORTCUTS[actionId];
  if (!key) return false;
  const k = normKey(e.key);
  const nk = normKey(key);
  if (actionId === 'del_box') {
    // 默认绑定 Delete 时，Delete/Backspace 均可触发；若自定义为其它键则按该键匹配
    if (nk === 'delete' || nk === 'backspace') return (k === 'delete' || k === 'backspace');
  }
  return nk === k;
}
function keyDisplay(k) {
  if (!k) return '未设置';
  const map = { ' ': 'Space', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
                Delete: 'Del', Backspace: '⌫', Escape: 'Esc', Enter: 'Enter', Tab: 'Tab' };
  return map[k] || (k.length === 1 ? k.toUpperCase() : k);
}

// ---------- 标签（类别）快捷键 ----------
// 固定占用、不允许被标签或操作快捷键占用的按键
const RESERVED_KEYS = new Set([' ', 's', 'escape', 'enter', 'tab', 'z']);
// 轮转模式的十个「槽位」按键，按此顺序映射当前标签组；可自定义
const ROTATE_KEYS_DEFAULT = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
const ROTATE_SLOTS = ROTATE_KEYS_DEFAULT.length;
let LABEL_ROTATE_KEYS = [...ROTATE_KEYS_DEFAULT];
// 'normal' 普通模式：每个标签单独绑定按键
// 'rotate' 轮转模式：十个槽位键映射当前 10 个标签，按切换键翻到下一组
let LABEL_SHORTCUT_MODE = 'normal';
let LABEL_ROTATE_KEY = 'x';
let _labelPage = 0;   // 轮转模式下当前是第几组（0 开始）
// { [projectId]: { [类别名]: 按键 } }，普通模式用，按项目分别保存，换项目不串
let LABEL_SHORTCUTS = {};
function loadLabelShortcuts() {
  try { LABEL_SHORTCUTS = JSON.parse(localStorage.getItem('la_label_shortcuts') || '{}') || {}; }
  catch (e) { LABEL_SHORTCUTS = {}; }
  try {
    const cfg = JSON.parse(localStorage.getItem('la_label_shortcut_mode') || '{}') || {};
    if (cfg.mode === 'rotate' || cfg.mode === 'normal') LABEL_SHORTCUT_MODE = cfg.mode;
    if (cfg.rotateKey) LABEL_ROTATE_KEY = cfg.rotateKey;
    if (Array.isArray(cfg.slotKeys)) {
      LABEL_ROTATE_KEYS = ROTATE_KEYS_DEFAULT.map((d, i) =>
        (typeof cfg.slotKeys[i] === 'string') ? cfg.slotKeys[i] : d);
    }
  } catch (e) {}
}
function saveLabelShortcuts() {
  try { localStorage.setItem('la_label_shortcuts', JSON.stringify(LABEL_SHORTCUTS)); } catch (e) {}
}
function saveLabelShortcutMode() {
  try {
    localStorage.setItem('la_label_shortcut_mode', JSON.stringify({
      mode: LABEL_SHORTCUT_MODE, rotateKey: LABEL_ROTATE_KEY, slotKeys: LABEL_ROTATE_KEYS,
    }));
  } catch (e) {}
}
function labelPageCount() {
  const p = S.currentProject;
  const n = p ? p.categories.length : 0;
  return Math.max(1, Math.ceil(n / ROTATE_SLOTS));
}
// 当前项目的「类别 -> 按键」映射
// 普通模式：未自定义时前 9 个类别沿用数字键 1-9
// 轮转模式：只有当前组的 10 个类别有按键（十个槽位键），其余为空
function labelKeyMap() {
  const p = S.currentProject;
  if (!p) return {};
  const out = {};
  if (LABEL_SHORTCUT_MODE === 'rotate') {
    if (_labelPage >= labelPageCount()) _labelPage = 0;
    const start = _labelPage * ROTATE_SLOTS;
    p.categories.slice(start, start + ROTATE_SLOTS).forEach((cat, i) => {
      if (LABEL_ROTATE_KEYS[i]) out[cat] = LABEL_ROTATE_KEYS[i];
    });
    return out;
  }
  const saved = LABEL_SHORTCUTS[p.id] || {};
  p.categories.forEach((cat, i) => {
    const k = Object.prototype.hasOwnProperty.call(saved, cat) ? saved[cat] : (i < 9 ? String(i + 1) : '');
    if (k) out[cat] = k;
  });
  return out;
}
// 返回冲突描述（无冲突返回 null）。opts: { excludeCat, excludeAction, isRotateKey, excludeSlot }
function findConflict(key, opts) {
  opts = opts || {};
  const nk = normKey(key);
  if (RESERVED_KEYS.has(nk)) return '系统固定按键';
  const mode = S.isQCMode ? 'qc' : 'annotate';
  const act = SHORTCUT_ACTIONS.find(a => a.id !== opts.excludeAction &&
    (a.scope === 'both' || a.scope === mode) && normKey(SHORTCUTS[a.id]) === nk);
  if (act) return `操作「${act.label}」`;
  if (LABEL_SHORTCUT_MODE === 'rotate') {
    // 轮转模式下十个槽位键恒被标签组占用，切换键也不能被别人占
    const slot = LABEL_ROTATE_KEYS.findIndex((k, i) =>
      i !== opts.excludeSlot && k && normKey(k) === nk);
    if (slot >= 0) return `标签组第 ${slot + 1} 个按键`;
    if (!opts.isRotateKey && nk === normKey(LABEL_ROTATE_KEY)) return '标签组切换键';
    return null;
  }
  const km = labelKeyMap();
  const cat = Object.keys(km).find(c => c !== opts.excludeCat && normKey(km[c]) === nk);
  if (cat) return `标签「${cat}」`;
  return null;
}
// 切到轮转模式时，十个槽位键会被标签组独占，清掉占用这些键的操作快捷键
function clearRotateKeyActionShortcuts() {
  const occupied = new Set(LABEL_ROTATE_KEYS.filter(Boolean).map(normKey));
  const cleared = [];
  SHORTCUT_ACTIONS.forEach(a => {
    if (SHORTCUTS[a.id] && occupied.has(normKey(SHORTCUTS[a.id]))) {
      SHORTCUTS[a.id] = '';
      cleared.push(a.label);
    }
  });
  if (cleared.length) {
    saveShortcuts();
    toast(`「${cleared.join('、')}」的按键与轮转模式的标签组按键冲突，已清除`, 'err');
  }
}

// 普通模式：正在录制的类别名；轮转模式：ROTATE_RECORD_ID（切换键）或 '__slot__:N'（第 N 个槽位）
let _recordingLabel = null;
const ROTATE_RECORD_ID = '__rotate__';
const SLOT_RECORD_PREFIX = '__slot__:';
function renderLabelShortcutList() {
  const box = $('labelShortcutList');
  const p = S.currentProject;
  if (!box || !p) return;
  // 模式切换按钮
  document.querySelectorAll('#labelShortcutModal .ls-mode-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.mode === LABEL_SHORTCUT_MODE);
  });
  const km = labelKeyMap();
  if (LABEL_SHORTCUT_MODE === 'rotate') {
    const pages = labelPageCount();
    const rows = [`
      <div class="ls-shortcut-row">
        <span class="ls-shortcut-label">标签组切换键（切到下一组）</span>
        <button class="ls-shortcut-key${_recordingLabel === ROTATE_RECORD_ID ? ' recording' : ''}" data-rotate="1">
          ${_recordingLabel === ROTATE_RECORD_ID ? '按下按键…' : escape(keyDisplay(LABEL_ROTATE_KEY))}
        </button>
      </div>`];
    for (let pg = 0; pg < pages; pg++) {
      const start = pg * ROTATE_SLOTS;
      const group = p.categories.slice(start, start + ROTATE_SLOTS);
      rows.push(`<div class="ls-shortcut-group-title">第 ${pg + 1} 组${pg === _labelPage ? '（当前）' : ''}</div>`);
      group.forEach((cat, i) => {
        const rec = _recordingLabel === (SLOT_RECORD_PREFIX + i);
        rows.push(`
          <div class="ls-shortcut-row${pg === _labelPage ? '' : ' ls-shortcut-row-dim'}">
            <span class="ls-shortcut-label">
              <span class="ls-shortcut-dot" style="background:${p.colors[cat] || '#888'}"></span>${escape(cat)}
            </span>
            <button class="ls-shortcut-key${rec ? ' recording' : ''}" data-slot="${i}">
              ${rec ? '按下按键…' : escape(LABEL_ROTATE_KEYS[i] ? keyDisplay(LABEL_ROTATE_KEYS[i]) : '未设置')}
            </button>
          </div>`);
      });
    }
    box.innerHTML = rows.join('');
  } else {
    box.innerHTML = p.categories.map((cat, i) => `
      <div class="ls-shortcut-row">
        <span class="ls-shortcut-label">
          <span class="ls-shortcut-dot" style="background:${p.colors[cat] || '#888'}"></span>${escape(cat)}
        </span>
        <button class="ls-shortcut-key${_recordingLabel === cat ? ' recording' : ''}" data-idx="${i}">
          ${_recordingLabel === cat ? '按下按键…' : escape(km[cat] ? keyDisplay(km[cat]) : '未设置')}
        </button>
      </div>`).join('');
  }
  box.querySelectorAll('button.ls-shortcut-key').forEach(btn => {
    btn.onclick = () => {
      if (btn.dataset.rotate) _recordingLabel = ROTATE_RECORD_ID;
      else if (btn.dataset.slot !== undefined) _recordingLabel = SLOT_RECORD_PREFIX + btn.dataset.slot;
      else _recordingLabel = p.categories[+btn.dataset.idx];
      renderLabelShortcutList();
    };
  });
  const hint = document.getElementById('labelShortcutHint');
  if (hint) {
    hint.textContent = LABEL_SHORTCUT_MODE === 'rotate'
      ? `轮转模式：每 10 个标签一组，用十个组内按键选择标签；按「${keyDisplay(LABEL_ROTATE_KEY)}」切到下一组（共 ${labelPageCount()} 组，循环）。切换键和十个组内按键都可点击修改，同一位置的按键各组共用。`
      : '普通模式：点击某一项后按下新按键即可设置；按 Del/⌫ 清除，按 Esc 取消。与操作快捷键或其它标签重复时会被拒绝。';
  }
}
function openLabelShortcutModal() {
  if (!S.currentProject) { toast('请先打开一个项目', 'err'); return; }
  _recordingLabel = null;
  renderLabelShortcutList();
  $('labelShortcutModal').classList.remove('hidden');
}
function closeLabelShortcutModal() {
  _recordingLabel = null;
  $('labelShortcutModal').classList.add('hidden');
  renderCategories();   // 刷新标签条上的按键角标
}
// 录制标签/切换键：捕获阶段拦截，优先于编辑器快捷键
window.addEventListener('keydown', (e) => {
  if (!_recordingLabel) return;
  const m = document.getElementById('labelShortcutModal');
  if (!m || m.classList.contains('hidden')) return;
  e.preventDefault(); e.stopPropagation();
  if (e.key === 'Escape') { _recordingLabel = null; renderLabelShortcutList(); return; }
  if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
  const p = S.currentProject;
  if (!p) return;
  const key = (e.key.length === 1) ? e.key.toLowerCase() : e.key;
  // 轮转模式：「标签组切换键」
  if (_recordingLabel === ROTATE_RECORD_ID) {
    const c = findConflict(key, { isRotateKey: true });
    if (c) { toast(`${keyDisplay(key)} 已被${c}占用`, 'err'); return; }
    LABEL_ROTATE_KEY = key;
    saveLabelShortcutMode();
    _recordingLabel = null; renderLabelShortcutList();
    return;
  }
  // 轮转模式：十个组内按键（按位置，各组共用）
  if (_recordingLabel.startsWith(SLOT_RECORD_PREFIX)) {
    const slot = parseInt(_recordingLabel.slice(SLOT_RECORD_PREFIX.length), 10);
    if (e.key === 'Delete' || e.key === 'Backspace') {
      LABEL_ROTATE_KEYS[slot] = '';   // 该位置的标签不再有快捷键
    } else {
      const c = findConflict(key, { excludeSlot: slot });
      if (c) { toast(`${keyDisplay(key)} 已被${c}占用`, 'err'); return; }
      LABEL_ROTATE_KEYS[slot] = key;
    }
    saveLabelShortcutMode();
    _recordingLabel = null; renderLabelShortcutList();
    return;
  }
  // Delete/Backspace 用于清除该标签的快捷键
  if (e.key === 'Delete' || e.key === 'Backspace') {
    LABEL_SHORTCUTS[p.id] = { ...(LABEL_SHORTCUTS[p.id] || {}), [_recordingLabel]: '' };
    saveLabelShortcuts();
    _recordingLabel = null; renderLabelShortcutList();
    return;
  }
  const conflict = findConflict(key, { excludeCat: _recordingLabel });
  if (conflict) { toast(`${keyDisplay(key)} 已被${conflict}占用`, 'err'); return; }
  LABEL_SHORTCUTS[p.id] = { ...(LABEL_SHORTCUTS[p.id] || {}), [_recordingLabel]: key };
  saveLabelShortcuts();
  _recordingLabel = null;
  renderLabelShortcutList();
}, true);
document.addEventListener('DOMContentLoaded', () => {
  const open = document.getElementById('labelShortcutBtn');
  if (open) open.onclick = openLabelShortcutModal;
  const close = document.getElementById('labelShortcutModalClose');
  if (close) close.onclick = closeLabelShortcutModal;
  const done = document.getElementById('labelShortcutModalDone');
  if (done) done.onclick = closeLabelShortcutModal;
  document.querySelectorAll('#labelShortcutModal .ls-mode-tab').forEach(tab => {
    tab.onclick = () => {
      LABEL_SHORTCUT_MODE = tab.dataset.mode;
      _recordingLabel = null;
      _labelPage = 0;
      if (LABEL_SHORTCUT_MODE === 'rotate') {
        clearRotateKeyActionShortcuts();
        // 切换键本身若与操作快捷键撞了，给出提示（不自动改，交给用户）
        const c = findConflict(LABEL_ROTATE_KEY, { isRotateKey: true });
        if (c) toast(`当前切换键 ${keyDisplay(LABEL_ROTATE_KEY)} 与${c}冲突，请改一个`, 'err');
      }
      saveLabelShortcutMode();
      renderLabelShortcutList();
      renderCategories();
    };
  });
  const reset = document.getElementById('labelShortcutResetBtn');
  if (reset) reset.onclick = () => {
    const p = S.currentProject; if (!p) return;
    if (LABEL_SHORTCUT_MODE === 'rotate') {
      LABEL_ROTATE_KEY = 'x';
      LABEL_ROTATE_KEYS = [...ROTATE_KEYS_DEFAULT];   // 回到 1-9、0
      _labelPage = 0;
      clearRotateKeyActionShortcuts();
      saveLabelShortcutMode();
    } else {
      delete LABEL_SHORTCUTS[p.id];   // 回到默认：前 9 个类别 1-9
      saveLabelShortcuts();
    }
    renderLabelShortcutList();
  };
});

let _recordingAction = null;
function renderShortcutList() {
  const box = $('shortcutList');
  if (!box) return;
  // 按当前界面角色过滤：质检界面只显示质检相关，标注界面只显示标注相关，通用项两者都显示
  const mode = S.isQCMode ? 'qc' : 'annotate';
  const actions = SHORTCUT_ACTIONS.filter(a => a.scope === 'both' || a.scope === mode);
  const titleEl = document.getElementById('shortcutModalTitle');
  if (titleEl) titleEl.textContent = S.isQCMode ? '快捷键设置（质检）' : '快捷键设置（标注）';
  box.innerHTML = actions.map(a => `
    <div class="ls-shortcut-row">
      <span class="ls-shortcut-label">${escape(a.label)}</span>
      <button class="ls-shortcut-key${_recordingAction === a.id ? ' recording' : ''}" data-act="${a.id}">
        ${_recordingAction === a.id ? '按下按键…' : escape(keyDisplay(SHORTCUTS[a.id]))}
      </button>
    </div>`).join('');
  box.querySelectorAll('.ls-shortcut-key').forEach(btn => {
    btn.onclick = () => { _recordingAction = btn.dataset.act; renderShortcutList(); };
  });
}
function openShortcutModal() { _recordingAction = null; renderShortcutList(); $('shortcutModal').classList.remove('hidden'); }
function closeShortcutModal() {
  _recordingAction = null;
  $('shortcutModal').classList.add('hidden');
  // 快捷键可能已变化：重建 QC 顶栏以刷新按钮上的按键提示
  const bar = document.getElementById('qcActionBar');
  if (bar) { bar.remove(); renderQCBarInEditor(); }
}

// 录制按键：捕获阶段拦截，优先于编辑器快捷键
window.addEventListener('keydown', (e) => {
  if (!_recordingAction) return;
  const sm = document.getElementById('shortcutModal');
  if (!sm || sm.classList.contains('hidden')) return;
  e.preventDefault(); e.stopPropagation();
  if (e.key === 'Escape') { _recordingAction = null; renderShortcutList(); return; }
  if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;  // 忽略纯修饰键
  const newKey = (e.key.length === 1) ? e.key.toLowerCase() : e.key;
  // 与固定键、其它操作、标签快捷键（含轮转模式的 1-9/0 和切换键）都不能重复
  const c = findConflict(newKey, { excludeAction: _recordingAction });
  if (c) { toast(`${keyDisplay(newKey)} 已被${c}占用`, 'err'); return; }
  SHORTCUTS[_recordingAction] = newKey;
  saveShortcuts();
  _recordingAction = null;
  renderShortcutList();
}, true);

document.addEventListener('DOMContentLoaded', () => {
  const open = document.getElementById('shortcutBtn');
  if (open) open.onclick = openShortcutModal;
  const close = document.getElementById('shortcutModalClose');
  if (close) close.onclick = closeShortcutModal;
  const done = document.getElementById('shortcutModalDone');
  if (done) done.onclick = closeShortcutModal;
  const reset = document.getElementById('shortcutResetBtn');
  if (reset) reset.onclick = () => {
    // 仅恢复当前界面（标注/质检）可见的那些快捷键，避免影响另一角色的设置
    const mode = S.isQCMode ? 'qc' : 'annotate';
    SHORTCUT_ACTIONS.forEach(a => {
      if (a.scope === 'both' || a.scope === mode) SHORTCUTS[a.id] = SHORTCUT_DEFAULTS[a.id];
    });
    saveShortcuts(); renderShortcutList();
  };
});

// 键盘
window.addEventListener('keydown', (e) => {
  if (S.view !== 'editor') return;
  if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
  // 快捷键设置弹窗打开时，交给录制逻辑处理，编辑器不响应
  const sm = document.getElementById('shortcutModal');
  if (sm && !sm.classList.contains('hidden')) return;
  const lsm = document.getElementById('labelShortcutModal');
  if (lsm && !lsm.classList.contains('hidden')) return;

  // 标签快捷键：默认前 9 个类别为数字键 1-9，可在标签条的快捷键设置里改
  if (!e.ctrlKey && !e.metaKey && !e.altKey) {
    const cats = S.currentProject ? S.currentProject.categories : [];
    // 轮转模式：切换键翻到下一组标签
    if (LABEL_SHORTCUT_MODE === 'rotate' && cats.length &&
        normKey(e.key) === normKey(LABEL_ROTATE_KEY)) {
      const pages = labelPageCount();
      _labelPage = (_labelPage + 1) % pages;
      renderCategories();
      toast(`标签组 ${_labelPage + 1}/${pages}`);
      e.preventDefault(); return;
    }
    if (cats.length) {
      const km = labelKeyMap();
      const k = normKey(e.key);
      const hit = cats.find(c => km[c] && normKey(km[c]) === k);
      if (hit) { selectCategory(hit); e.preventDefault(); return; }
    }
  }

  // 组合键（固定）：撤销/重做/保存
  if (e.ctrlKey || e.metaKey) {
    if (e.key === 'z' || e.key === 'Z') { if (e.shiftKey) redo(); else undo(); e.preventDefault(); return; }
    if (e.key === 's' || e.key === 'S') { save(); e.preventDefault(); return; }
    if (e.key === 'Enter') { save(); e.preventDefault(); return; }
  }
  // 固定键：空格平移、Esc 取消选中
  if (e.key === ' ') { S.spacePressed = true; canvas.style.cursor = 'grab'; e.preventDefault(); return; }
  if (e.key === 'Escape') { S.selectedIdx = -1; renderRegions(); renderDetails(); redraw(); return; }
  if ((e.key === 's' || e.key === 'S')) { save(); return; }  // 单键 s 也保存（保留原行为）

  // 质检模式优先：通过 / 打回
  if (S.isQCMode) {
    if (keyMatches(e, 'qc_pass'))   { submitQC('pass'); e.preventDefault(); return; }
    if (keyMatches(e, 'qc_reject')) { submitQC('reject'); e.preventDefault(); return; }
  }

  // 可自定义快捷键
  if (keyMatches(e, 'prev_image')) { selectImage(S.currentIdx - 1); e.preventDefault(); return; }
  if (keyMatches(e, 'next_image')) { selectImage(S.currentIdx + 1); e.preventDefault(); return; }
  if (keyMatches(e, 'del_box'))    { if (S.selectedIdx >= 0) { deleteRegion(S.selectedIdx); e.preventDefault(); } return; }
  if (keyMatches(e, 'fit_view'))   { fitCanvasToStage(); e.preventDefault(); return; }
  if (keyMatches(e, 'toggle_raw')) {
    S.showRaw = !S.showRaw;
    $('viewRawBtn').classList.toggle('ls-tool-active', S.showRaw);
    redraw(); e.preventDefault(); return;
  }
  if (keyMatches(e, 'rect_tool'))  {
    const t = document.querySelector('.ls-tool[data-tool="rect"]');
    if (t) t.click();
    e.preventDefault(); return;
  }
  // 标注模式下的“确认并下一张”（质检模式已在上面拦截 qc_pass）
  if (!S.isQCMode && keyMatches(e, 'confirm_next')) {
    const btn = document.getElementById('nextImgBtn');
    if (btn) btn.click();
    e.preventDefault(); return;
  }
});
window.addEventListener('keyup', (e) => {
  if (e.key === ' ') {
    S.spacePressed = false;
    canvas.style.cursor = S.tool === 'pan' ? 'grab' : 'crosshair';
  }
});
window.addEventListener('resize', () => { if (S.view === 'editor') fitCanvasToStage(); });

// ========================================================
// 启动
// ========================================================
async function boot() {
  // 恢复 sidebar 状态
  try {
    if (localStorage.getItem('la_sidebar_collapsed') === '1') {
      S.sidebarCollapsed = true;
      $('sidebar').classList.add('collapsed');
    }
  } catch (e) {}

  loadShortcuts();
  loadLabelShortcuts();

  const r = await api('GET', '/api/me');
  S.user = (r.ok && r.user) ? r.user : null;
  applyAuthState();
  goProjects();

  if (!S.user) {
    // 未登录 → 自动弹出登录 Modal，但主界面已可见
    setTimeout(() => openAuthModal('login'), 100);
  }
}
boot();
