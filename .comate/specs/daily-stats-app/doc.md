# label-auto-app 质检/作业平台：显示自己的每日工作量

## 需求

给 `label-auto-app`（别人用的合并版）的质检平台和作业平台，各加一个「每天作业量/质检量」显示。

## 与三合一的区别

三合一里是 owner 选某个人、用那人 token 拉数据。而 label-auto-app 是**每人登录自己**，所以直接用当前登录人自己的 token 调平台 `/api/my_daily_stats` 即可（返回本人 `annotated_days` / `qc_days`）。

- 质检平台：显示本人 `qc_days`（质检量）。
- 作业平台：显示本人 `annotated_days`（标注量）。

## 方案

### 后端 `label-auto-app/dashboard.py`

新增代理路由 `GET /api/my_daily_stats`：用当前登录 token 转发到平台同名接口，把响应原样返回。

### 前端 质检平台 qc

- `qc.html`：topbar 的 `#qcCounts` 后加 `<div id="qcDailyStats" class="qc-daily-stats"></div>`。
- `qc.js`：新增 `loadDailyStats()`（拉 `/api/my_daily_stats`，渲染 `qc_days` 成「质检量 今天 N / MM-DD M / …」）+ 10s 轮询；`loadSetup()` 里启动并首次加载。
- `qc.css`：加 `.qc-daily-stats` 样式。

### 前端 作业平台 anno

- `anno.html`：`#annoCounts` 后加 `<div id="annoDailyStats" class="anno-daily-stats"></div>`。
- `anno.js`：新增 `loadDailyStats()`（渲染 `annotated_days` 成「标注量 …」）+ 10s 轮询；初始化后启动。
- `anno.css`：加 `.anno-daily-stats` 样式。

## 影响文件

- `label-auto-app/dashboard.py`
- `label-auto-app/static/qc.html` / `qc.js` / `qc.css`
- `label-auto-app/static/anno.html` / `anno.js` / `anno.css`

## 边界与异常

- 接口失败或返回空 → 隐藏/清空该元素，不影响主流程。
- 轮询 10s；`/api/my_daily_stats` 无缓存，轻量。
- 打包 exe 需要停掉正在运行的旧实例。

## 预期结果

- 质检员/管理员进质检平台 → 顶部显示「质检量 今天/昨天/前天」，每 10s 更新。
- 作业员进作业平台 → 顶部显示「标注量 今天/昨天/前天」，每 10s 更新。
