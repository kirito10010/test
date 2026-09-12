# 看板 · 恢复任务归属

## 1. 需求场景与处理逻辑

在外接看板（`/`）新增一个「归属修复」页签，用于把某个质检员名下**已通过/已打回**的图，用质检员本人 token 重新提交一次 verdict，使平台把这些图的质检结果正确归属到该质检员名下。

- 选择项目（复用顶部 `projectSel`）。
- 选择质检员（下拉，来自 monitoring 的 `qc_assignees`）。
- 点「恢复任务归属」→ POST `/api/qc/fix` `{pid, uid}`。
- 显示结果：总数 / 成功 / 失败。

## 2. 架构与技术方案

- 后端 `/api/qc/fix`（`_handle_qc_fix`）**已存在**，无需改后端。
- 前端：
  - `index.html` 新增页签按钮 + `#tab-fix` 面板。
  - `app.js` 在 `loadMonitoring` 时顺带保存当前项目的 `qc_assignees`（uid+name），渲染到下拉；点按钮调 `/api/qc/fix`。

## 3. 影响文件

| 文件 | 改动 |
|---|---|
| `label-auto-dashboard/static/index.html` | 新增页签 + 面板 |
| `label-auto-dashboard/static/app.js` | 保存 qc_assignees、渲染下拉、调接口 |

## 4. 实现细节

### 4.1 index.html
```html
<button data-tab="fix">归属修复</button>   <!-- 加到 #tabs -->

<section id="tab-fix" class="tab-panel hidden">
  <div class="toolbar">
    <label>质检员：</label>
    <select id="fixOwner"></select>
    <button id="fixBtn" class="btn primary">恢复任务归属</button>
  </div>
  <div class="summary" id="fixSummary"></div>
</section>
```

### 4.2 app.js
- `state.qcReviewers = []`（`{uid,name}`）。
- `loadMonitoring()` 里：
```js
state.qcReviewers = [];
(r.projects || []).forEach(p => {
  if (p.id === state.currentProjectId) {
    (p.qc_assignees || []).forEach(a => {
      if (a && a.uid) state.qcReviewers.push({ uid: a.uid, name: a.name || a.uid });
    });
  }
});
renderFixOwner();
```
- `renderFixOwner()`：填 `#fixOwner`。
- `doFix()`：
```js
const uid = $('fixOwner').value;
if (!uid) { toast('请先选择质检员'); return; }
const r = await api('/api/qc/fix', { method:'POST', body:{ pid: state.currentProjectId, uid } });
$('fixSummary').textContent = r.ok
  ? '共 ' + r.total + ' 张，成功 ' + r.succeeded + '，失败 ' + (r.failed || []).length
  : ((r.error) || '操作失败');
```

## 5. 边界条件与异常处理

- 未选质检员：toast 提示。
- 该质检员无内置登录（`_get_qc_token` 返回 None）：后端返回「该质检员未配置登录凭据或登录失败」。
- 无 passed/rejected 图：返回 total=0，前端显示「共 0 张」。

## 6. 数据流

选项目 + 选质检员 → 点按钮 → POST `/api/qc/fix` → 后端用质检员 token 拉其名下图 → 对 passed/rejected 重放 verdict → 返回 total/succeeded/failed → 前端显示。

## 7. 预期结果

看板新增「归属修复」页签，选择质检员后一键恢复其名下已通过/已打回图的归属，并显示处理数量。
