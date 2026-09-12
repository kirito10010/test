# 总结：三合一平台显示所选人员的每日工作量

## 需求

在质检/作业平台选中某个质检员/作业员时，用其本人 token 拉平台新增的 `/api/my_daily_stats`，轮询显示该人的每日数量；未内置账号的人不显示（仍可管理员身份操作）。

## 改动

### 后端 `label-auto-dashboard/dashboard.py`
- 新增 `daily_stats(uid)`：无内置账号返回 `has_login:false`；否则用 `_get_qc_token(uid)` 调 `/api/my_daily_stats`，返回 `annotated_days` / `qc_days`。
- 新增路由 `GET /api/daily_stats?uid=xxx`。

### 质检平台
- `qc.html`：`#qcCounts` 后加 `#qcDailyStats`。
- `qc.js`：新增 `loadDailyStats()`（渲染 `qc_days`）+ `formatDailyStats()` + `startDailyPoll()`（10s）；`onReviewerChange()`、`init()` 里接入。
- `qc.css`：加 `.qc-daily-stats` 样式。

### 作业平台
- `anno.html`：`#annoCounts` 后加 `#annoDailyStats`。
- `anno.js`：新增 `loadDailyStats()`（渲染 `annotated_days`）+ 轮询；`onAnnotatorChange()`、`init()` 接入。
- `anno.css`：加 `.anno-daily-stats` 样式。

## 校验

- `dashboard.py` + 两个 JS 语法检查通过。
- `daily_stats()` 自测：李劲返回 `has_login:true` + `qc_days`（1567/2164/0）；郭雅楠返回 `annotated_days`（684/1999/0）；未知 uid 返回 `has_login:false`。

## 结果

- 质检平台选中李劲等内置质检员 → 显示「质检量 今天/昨天/前天」，每 10s 更新。
- 作业平台选中郭雅楠等内置作业员 → 显示「标注量 今天/昨天/前天」。
- 未内置账号 → 不显示每日数量，质检/作业功能照常。
