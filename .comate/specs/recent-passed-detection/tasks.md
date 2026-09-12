# 最近通过检测 + 通过时间过滤

- [x] Task 1: 后端新增最近通过检测状态与辅助函数
    - 1.1: 顶部常量区新增 `RECENT_PASSED_MAX_AGE`、`RECENT_PASSED_MAX_LEN`
    - 1.2: 新增全局 `_PASS_SNAPSHOT`、`_RECENT_PASSED`、`_WATCHED`
    - 1.3: 新增 `_fmt_ts(epoch)` 时间格式化
    - 1.4: 新增 `_scan_recent_passed(pid, imgs)` 快照差量检测
    - 1.5: 新增 `_active_pids()` 返回 top3 ∪ watched

- [x] Task 2: 接入后台刷新循环与项目切换
    - 2.1: `background_refresh_loop` 改为遍历 `_active_pids()`，并在 `get_images` 后调用 `_scan_recent_passed`
    - 2.2: reviewed_at 增量拉取仍只对最新 3 个项目执行
    - 2.3: `/api/projects/{id}/preload` 路由加入 `_WATCHED.add(pid)`

- [x] Task 3: 查询接口支持 passed_minutes 过滤
    - 3.1: `query_images` 增加 `passed_minutes=None` 参数，实现时间窗过滤 + 按 passed_at 倒序
    - 3.2: `/query` 路由解析 `passed_minutes` 参数并传入

- [x] Task 4: 前端新增「通过时间」下拉并传参
    - 4.1: `index.html` 查询工具栏新增 `queryPassedMinutes` 下拉
    - 4.2: `app.js` 的 `doQuery` 读取并追加 `passed_minutes` 参数
    - 4.3: 用 `python -m py_compile dashboard.py` 校验后端语法
