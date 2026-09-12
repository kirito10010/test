# 查询提速 + 进度显示

- [x] Task 1: 提高 annotation 拉取并发
    - 1.1: `SORT_CONCURRENCY` 从 8 改为 16

- [x] Task 2: 后端进度跟踪与接口
    - 2.1: 新增全局 `_PROGRESS = {"phase": "", "total": 0, "done": 0}`
    - 2.2: `fetch_annotations` 内更新 `_PROGRESS` 的 total/done
    - 2.3: `query_images` 下载导出前设置 `_PROGRESS` phase=export
    - 2.4: 新增路由 `/api/query_progress` 返回当前进度

- [x] Task 3: 前端进度轮询显示
    - 3.1: `app.js` 的 `doQuery` 查询期间启动独立轮询 `/api/query_progress`，更新 `querySummary`，结束后停止
    - 3.2: 用 `python -m py_compile dashboard.py` 校验后端语法
