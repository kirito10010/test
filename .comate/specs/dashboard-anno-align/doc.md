# 三合一作业平台对齐 label-auto-app：加文件名搜索 + 筛选质检员 + 归谁质检显示

## 背景

三合一（label-auto-dashboard）的作业平台相比 label-auto-app 少了三样：文件名搜索、按质检员筛选、每条照片显示「归谁质检」。本次把这三样补上，与 label-auto-app 对齐。

（每日「标注量」显示、图标，之前已经做过/已放到三合一里了，本次不重复。）

## 与 label-auto-app 的差异

三合一里 owner 会在作业平台选一个「作业员」（`annoReviewer`），作业列表按该作业员 `uid` 加载。所以：

- 质检归属、筛选都依赖「当前选中的作业员 uid」。
- 后端名字映射直接复用 `build_uid_name_map()`（owner 自动登录，有 admin 权限，能访问 monitoring）。

## 方案

### 后端 `label-auto-dashboard/dashboard.py`

1. 新增 `anno_qc_owners(pid, uid)`：对该作业员 `assignments[uid]` 里每张图，查它在 `qc_assignments` 里的归属，返回：
   - `qc_of`: `{image_id: {uid, name}}`
   - `qcs`: `[{uid, name}]`（去重质检员列表）
2. 新增路由 `GET /api/anno/qc_owners?pid=xxx&uid=xxx`（uid 从 query 取，与现有三合一 anno 接口一致）。

### 前端 `label-auto-dashboard/static/anno.html`

在 `.anno-list-tabs` 上方加：

```html
<div class="anno-filters">
  <input id="annoSearch" placeholder="搜索文件名">
  <select id="annoQcFilter"><option value="">全部质检员</option></select>
</div>
```

### 前端 `label-auto-dashboard/static/anno.js`

- state 增加 `search` / `qcFilter` / `qcOf` / `qcs`。
- 新增 `loadQcOwners()` / `renderQcFilter()` / `applyFilters()`。
- `onAnnotatorChange()`：切换作业员时重置 `qcFilter` 并 `loadQcOwners()`。
- `loadList()`：渲染前按 `search` + `qcFilter` 客户端过滤。
- `makeListItem(id)` 改为 `makeListItem(id, qcName)`，显示「质检：名字」。
- 绑定 `#annoSearch` input 与 `#annoQcFilter` change。

### 前端 `label-auto-dashboard/static/anno.css`

加 `.anno-filters` / 搜索框 / `.anno-qc-tag` 样式。

## 影响文件

- `label-auto-dashboard/dashboard.py`
- `label-auto-dashboard/static/anno.html` / `anno.js` / `anno.css`

## 边界与异常

- 图片无质检归属：`qc_of` 无该图，不显示质检标签；筛选不受影响。
- 搜索/筛选纯客户端，列表已全量加载（limit=100000）。
- 无内置登录的作业员仍可管理员身份操作；质检归属信息不受登录限制（来自 owner token 的 monitoring）。

## 预期结果

- 三合一作业平台右侧列表上方出现搜索框 + 质检员下拉。
- 每条照片显示「质检：名字」。
- 可输入文件名过滤、可按质检员筛选，与 label-auto-app 行为一致。
