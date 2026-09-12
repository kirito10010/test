# 总结：label-auto-app 质检/作业平台显示自己的每日工作量

## 需求

给 label-auto-app（别人用的合并版）质检/作业平台各加一个「每天作业量/质检量」显示。

## 改动

### 后端 `label-auto-app/dashboard.py`
- 新增代理路由 `GET /api/my_daily_stats`：用当前登录 token 转发平台同名接口，原样返回 `annotated_days` / `qc_days`。

### 质检平台
- `qc.html`：`#qcCounts` 后加 `#qcDailyStats`。
- `qc.js`：新增 `loadDailyStats()`（渲染 `qc_days` → 「质检量 …」）+ `formatDailyStats()` + `startDailyPoll()`（10s），`loadSetup` 里启动。
- `qc.css`：加 `.qc-daily-stats` 样式。

### 作业平台
- `anno.html`：`#annoCounts` 后加 `#annoDailyStats`。
- `anno.js`：新增 `loadDailyStats()`（渲染 `annotated_days` → 「标注量 …」）+ 轮询。
- `anno.css`：加 `.anno-daily-stats` 样式。

## 校验与打包

- `dashboard.py` + 两个 JS 语法检查通过。
- PyInstaller 重新打包 `dist/label-auto-app.exe`（带图标），dist 仅此一个文件；已清理 `build/`。

## 结果

- 质检员/管理员进质检平台 → 顶部显示「质检量 今天/昨天/前天」，每 10s 更新。
- 作业员进作业平台 → 顶部显示「标注量 今天/昨天/前天」，每 10s 更新。
