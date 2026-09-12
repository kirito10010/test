# 三合一平台：质检/作业平台显示所选人员的每日工作量

## 背景

平台新增了接口 `GET /api/my_daily_stats`，按当前 token 返回「本人」最近几天的每日统计：

```json
{
  "ok": true, "role": "qc",
  "annotated_days": [{"date":"2026-09-04","count":52}, ...],   // 标注量（作业员视角）
  "qc_days":       [{"date":"2026-09-04","count":1483}, ...]   // 质检量（质检员视角）
}
```

三合一平台已内置了多数质检员/作业员的账号密码（`_QC_LOGIN`）。需求：在质检/作业平台**选中某个人**时，用他本人的 token 拉 `/api/my_daily_stats`，轮询显示他本人的每日数量；没有内置账号的人，仍可管理员身份操作，但**不显示**每日数量（拿不到他本人 token）。

## 方案

### 后端（label-auto-dashboard/dashboard.py）

1. 新增 `daily_stats(uid)`：
   - uid 不在 `_QC_LOGIN` → `{"ok": true, "has_login": false}`。
   - 用 `_get_qc_token(uid)` 拿该账号 token，调 `GET /api/my_daily_stats`（`token=` 参数），成功返回 `{"ok": true, "has_login": true, "annotated_days": [...], "qc_days": [...]}`；失败返回 `{"ok": false, "error": ...}`。

2. 新增路由 `GET /api/daily_stats?uid=xxx`。

### 前端（质检平台 qc）

- `qc.html`：在 `#qcCounts` 后加 `<div id="qcDailyStats" class="qc-daily-stats"></div>`。
- `qc.js`：
  - 新增 `loadDailyStats()`：当前质检员 `has_login` 为真时请求 `/api/daily_stats?uid=...`，把 `qc_days` 渲染成「质检量 今天 N / MM-DD M / …」；无登录或失败则清空。
  - `onReviewerChange()` 里调用 `loadDailyStats()`。
  - 启动一个 10s 轮询定时器（复用/新增），持续刷新当天数量。

### 前端（作业平台 anno）

- `anno.html`：在 `#annoCounts` 后加 `<div id="annoDailyStats" class="anno-daily-stats"></div>`。
- `anno.js`：
  - 新增 `loadDailyStats()`：当前作业员 `has_login` 为真时请求并渲染 `annotated_days`（「标注量 …」）；否则清空。
  - `onAnnotatorChange()` 里调用，并加 10s 轮询。

### 样式

- `qc.css` / `anno.css`：加 `.qc-daily-stats` / `.anno-daily-stats` 的轻量样式（小号灰字，今天的数字可加粗）。

## 影响文件

- `d:\Project\test\label-auto-dashboard\dashboard.py`
- `d:\Project\test\label-auto-dashboard\static\qc.html` / `qc.js` / `qc.css`
- `d:\Project\test\label-auto-dashboard\static\anno.html` / `anno.js` / `anno.css`

## 边界与异常

- 未内置账号（`has_login=false`）：前端不请求、不显示；后端返回 `has_login:false` 兜底。
- `_get_qc_token` 登录失败：`daily_stats` 返回 `ok:false`，前端静默清空。
- 轮询间隔 10s，与现有待质检轮询一致；`_get_qc_token` 有 token 缓存，不会反复登录。
- 三合一不需要打包，改完重启 `python dashboard.py` 生效。

## 预期结果

- 质检平台选中李劲等内置质检员 → 显示「质检量 今天/昨天/前天」并随操作每 10s 更新。
- 作业平台选中郭雅楠等内置作业员 → 显示「标注量 今天/昨天/前天」。
- 选中未内置账号（如 root 建的非内置成员）→ 不显示每日数量，但质检/作业功能照常（管理员身份）。
