# 修复「已提交」列表刷新后刚提交的图掉到下面

## 背景与现象

作业平台（作业员视角）的「已提交」页签，提交后刚做完的图会显示在最上面；但一刷新网页，它们就掉到往下好几十/几百个位置。

复现数据（郭雅楠，项目 `9367e30f2211 车信箭头标注8`）：

- 图片 `20260817678711ra00000195.jpg`、`...196`、`...197`
- 在 `assignments["373ef86dae05"]` 里的下标分别是 1845 / 1846 / 1847（共 2684 条）

## 根因分析

`anno.js` 的 `loadList()` 里，「已提交」的排序逻辑是：

```js
if (state.status === 'submitted') {
  items = items.slice().reverse();                       // 反转后端返回的固定顺序
  if (state.recentSubmits.length) {                      // 仅本会话内存里记住的「刚提交」
    const recent = state.recentSubmits.filter((id) => items.indexOf(id) >= 0);
    const rest = items.filter((id) => recent.indexOf(id) < 0);
    items = recent.concat(rest);                          // 刚提交的提到最前
  }
}
```

关键点：

1. 后端 `anno_assigned()` 返回的顺序是 `assignments[uid]` 的**固定分配顺序**，和「提交时间」无关。实测该项目分配列表不是按图片序号严格递增（尾部跳变），所以反转后顺序是「无意义的固定顺序」。
2. 刚提交后能排在最前面，全靠 `state.recentSubmits` 这个**前端内存数组**（`save()` 里 `state.recentSubmits = [imageId, ...]`）。
3. `state.recentSubmits` 只在 JS 内存里，**刷新即丢失**。丢失后 `recentSubmits` 为空，列表退回「反转分配顺序」，于是刚提交的图掉到固定顺序里的中间位置。

这与用户此前的诉求一致：`recent_submits` 本应存浏览器（当时把 `recent_submits.json` 去掉了，但改成了纯内存，而不是 localStorage）。

## 修复方案

把「最近提交」列表持久化到浏览器 `localStorage`（按项目隔离），刷新后从 localStorage 读回，让刚提交的图持续钉在最上面。

- 新增 localStorage 键 `anno_recent_submits`，值为 `{ [projectId]: [imageId, ...] }`，数组最新在前，上限 300 条。
- `onProjectChange()`（切项目/初始化）时从 localStorage 读回当前项目的 `recentSubmits`。
- `save()` 提交成功后，把 `imageId` 前置并写回 localStorage。

选择 localStorage 而不是后端按 `reviewed_at` 排序，理由：

- 平台 `/images` 快照接口没有「标注提交时间」字段；只有 `/annotation`（逐张请求）里有 `reviewed_at`，但「已提交」列表有 2000+ 张，逐张拉取排序代价过高、且「已提交」页需要秒开。
- localStorage 方案与用户明确要求一致（数据存浏览器、不落盘、不出多余文件），且 `loadList()` 已有过滤逻辑，会把不在当前「已提交」列表里的陈旧 ID 自动丢弃，不会误伤。

## 影响文件与改动点

均为前端 JS，不涉及后端 `dashboard.py`。

### 1. `d:\Project\test\label-auto-app\static\anno.js`

- 在 `state` 对象及 `let currentBoxes/currentViewer` 声明之后，新增 4 个 helper：
  - `RECENT_KEY = 'anno_recent_submits'`
  - `loadRecentSubmits()` / `saveRecentSubmits(all)`
  - `loadProjectRecent(pid_)` / `saveProjectRecent(pid_, list)`
- `onProjectChange()`：在设置 `state.projectId` 后加入 `state.recentSubmits = loadProjectRecent(state.projectId);`
- `save()`：把 `state.recentSubmits = [imageId, ...]...` 这行替换为调用 `recordRecentSubmit(imageId)`（该函数同时更新内存并写 localStorage）。

### 2. `d:\Project\test\label-auto-dashboard\static\anno.js`

同样的三处改动。注意该文件用 `uid()` 且有「作业员选择器」，但 `recentSubmits` 仍按 `projectId` 隔离即可——因为 `loadList()` 会用当前 uid 的「已提交」列表去过滤，其他作业员/陈旧 ID 会被自动丢弃。

## 边界与异常处理

- `localStorage` 读写包在 `try/catch`（隐私模式/容量满时静默失败，不影响主流程）。
- JSON 解析失败返回空对象/空数组。
- `recentSubmits` 上限 300，避免 localStorage 无限增长。
- 已提交列表里已不存在的图（被打回、被 QC 通过等），由现有 `loadList()` 过滤逻辑自动剔除，不影响显示。

## 预期结果

- 作业员提交 3 张图后，切到「已提交」，它们在最上面。
- 刷新网页后，这 3 张图仍在「已提交」最上面（从 localStorage 读回）。
- 换项目后各自独立，不串数据。
- 不新增任何本地文件。
