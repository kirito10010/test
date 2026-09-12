# 修复「按质检时间排序」时间不显示 + 第二次查询无反应

- [x] Task 1: 改造 fetch_reviewed_at 支持并发可调 + 缓存进度即时可见
    - 1.1: 顶部常量区新增 `SORT_CONCURRENCY = 8`
    - 1.2: `fetch_reviewed_at` 增加 `max_workers=None` 参数，默认用 `REVIEW_CONCURRENCY`
    - 1.3: `fetch_reviewed_at` 在循环前先 `cache_set` 共享 cached dict，实现原地填充、进度可见

- [x] Task 2: 让排序查询同步补齐时间
    - 2.1: `query_images` 的 `sort=reviewed_desc` 分支，把 `preload_reviewed_async(pid)` 改为同步 `fetch_reviewed_at(pid, missing, max_workers=SORT_CONCURRENCY)`
    - 2.2: 拉取后重新读取 `get_cached_reviewed` 再给每条结果赋 `reviewed_at`，然后排序
    - 2.3: 用 `python -m py_compile dashboard.py` 校验语法
