# 降低看板对平台的请求压力（突发 + 持续都修）

- [x] Task 1: 去掉登录 export 预下载
    - 1.1: `preload_all()` 删除 `get_export_labels(pid)`，只保留 `get_images(pid)`
    - 1.2: 更新 `preload_all` 的 docstring

- [x] Task 2: annotation 限流降并发
    - 2.1: 顶部常量区新增 `REVIEW_CONCURRENCY = 4`
    - 2.2: `fetch_reviewed_at()` 的 `max_workers=12` 改为 `max_workers=REVIEW_CONCURRENCY`

- [x] Task 3: 后台刷新间隔回调
    - 3.1: `REFRESH_INTERVAL = 15` 改为 `30`
    - 3.2: 用 `python -m py_compile dashboard.py` 校验语法
