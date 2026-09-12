# label-auto-app 质检/作业平台：显示自己的每日工作量

- [x] Task 1: 后端新增 /api/my_daily_stats 代理路由
    - 1.1: 路由 GET /api/my_daily_stats，用当前 token 转发平台同名接口并原样返回

- [x] Task 2: 质检平台前端显示每日质检量
    - 2.1: qc.html 在 #qcCounts 后加 #qcDailyStats
    - 2.2: qc.js 新增 loadDailyStats()（渲染 qc_days）+ 10s 轮询，loadSetup 里启动
    - 2.3: qc.css 加 .qc-daily-stats 样式

- [x] Task 3: 作业平台前端显示每日标注量
    - 3.1: anno.html 在 #annoCounts 后加 #annoDailyStats
    - 3.2: anno.js 新增 loadDailyStats()（渲染 annotated_days）+ 10s 轮询
    - 3.3: anno.css 加 .anno-daily-stats 样式

- [x] Task 4: 校验并重新打包 label-auto-app.exe
    - 4.1: python -m py_compile dashboard.py + node --check 两个 js
    - 4.2: 停掉旧 exe，PyInstaller 重新打包，确认 dist 只含 label-auto-app.exe
