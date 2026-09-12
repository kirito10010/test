# 三合一平台：质检/作业平台显示所选人员的每日工作量

- [x] Task 1: 后端新增每日统计接口
    - 1.1: 新增 daily_stats(uid)（无内置账号返回 has_login:false；否则用 _get_qc_token 调 /api/my_daily_stats）
    - 1.2: 新增路由 GET /api/daily_stats?uid=xxx

- [x] Task 2: 质检平台前端显示每日质检量
    - 2.1: qc.html 在 #qcCounts 后加 #qcDailyStats 容器
    - 2.2: qc.js 新增 loadDailyStats()（渲染 qc_days），onReviewerChange() 里调用，并加 10s 轮询
    - 2.3: qc.css 加 .qc-daily-stats 样式

- [x] Task 3: 作业平台前端显示每日标注量
    - 3.1: anno.html 在 #annoCounts 后加 #annoDailyStats 容器
    - 3.2: anno.js 新增 loadDailyStats()（渲染 annotated_days），onAnnotatorChange() 里调用，并加 10s 轮询
    - 3.3: anno.css 加 .anno-daily-stats 样式

- [x] Task 4: 校验
    - 4.1: python -m py_compile dashboard.py + node --check 两个 js
    - 4.2: 接口自测 /api/daily_stats 返回结构
