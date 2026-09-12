# 作业平台：文件名搜索 + 显示归谁质检 + 按质检员筛选

## 定位

选中的元素是作业平台右侧列表的「未作业/已提交/被打回」三个 tab（`div.anno-list-tabs`），DOM 路径 `main#appMain > aside.anno-list-panel > div.anno-list-tabs`。`appMain` 只在 **`label-auto-app`（给别人用的合并版）** 的 `anno.html` 里存在，所以本改动作用于 label-auto-app 的作业平台。

## 需求

1. 在三个 tab 上方加一个「搜索照片文件名」输入框。
2. 每条照片显示「归谁质检」（该图分配给了哪个质检员）。
3. 加一个质检员筛选下拉，选中某个质检员后只显示他的任务，便于先做某个质检员的作业。

## 数据可行性（已实测）

平台 `/api/projects` 返回的每个项目里带 `qc_assignments`（质检员 uid -> 图片列表），且作业员（member）token 也能看到完整 `qc_assignments`。所以后端能算出「某作业员名下每张图归哪个质检员」。

## 方案

### 后端 `label-auto-app/dashboard.py`

新增函数 + 路由：

- `anno_qc_owners(pid, uid)`：对该作业员 `assignments[uid]` 里的每张图，查它在哪个 `qc_assignments` 里，返回：
  - `qc_of`: `{image_id: {uid, name}}`（每张图归谁质检）
  - `qcs`: `[{uid, name}]`（去重后的质检员列表，供筛选下拉）
- 路由 `GET /api/anno/qc_owners?pid=xxx`（uid 从当前登录 `USER` 取，与现有 anno 接口一致）。

### 前端 `label-auto-app/static/anno.html`

在 `.anno-list-tabs` 上方（`.anno-list-panel` 内）加：

```html
<div class="anno-filters">
  <input id="annoSearch" placeholder="搜索文件名" ...>
  <select id="annoQcFilter"><option value="">全部质检员</option></select>
</div>
```

### 前端 `label-auto-app/static/anno.js`

- state 增加 `search` / `qcFilter` / `qcOf` / `qcs`。
- 项目切换时调 `/api/anno/qc_owners`，填充 `qcOf`/`qcs` 并渲染质检员下拉。
- `loadList()`：在渲染前按 `search`（文件名子串）和 `qcFilter`（质检员 uid）做**客户端过滤**（列表已全量加载 limit=100000）。
- `makeListItem(id)` 改为 `makeListItem(id, qcName)`：文件名下方/旁边显示质检员名（无归属则不显示）。
- 绑定搜索框 `input` 和质检员下拉 `change` 触发重新过滤（不清空当前选中图，仅刷新列表）。

### 前端 `label-auto-app/static/anno.css`

加 `.anno-filters`、搜索框、`.anno-qc-tag` 样式。

## 边界与异常

- 图片没分配质检员：`qc_of` 无该图，不显示质检员标签，筛选中归「无归属」；下拉仍可选全部。
- 搜索/筛选是纯客户端，不增加后端压力；列表已全量加载。
- 搜索匹配用文件名（image_id）大小写不敏感子串。

## 预期结果

- 三个 tab 上方出现搜索框 + 质检员下拉。
- 每条照片显示「归谁质检」。
- 输入文件名可过滤；选某个质检员可只看他的任务，从而能先做该质检员的作业。
