# 修复「新旧排序 / 通过时间」的 8 分钟延迟（改用实时 /annotation）

- [x] Task 1: 新增实时 annotation 拉取函数
    - 1.1: 顶部常量区新增 `ANNOT_TTL = 60`
    - 1.2: 新增全局 `_ANNOT = {}`
    - 1.3: 新增 `fetch_annotations(pid, image_ids, max_workers=SORT_CONCURRENCY)`：并发拉 `/annotation`，取实时 `qc_status` + `reviewed_at`，带 60 秒短缓存

- [x] Task 2: 改造 query_images 的排序与通过时间分支
    - 2.1: `sort=reviewed_desc` 分支改用 `fetch_annotations` 取全部结果的实时数据，覆盖 qc_status、赋值 reviewed_at、排序
    - 2.2: `passed_minutes` 分支改用 `fetch_annotations`，按实时 qc_status==passed 且 reviewed_at 在时间窗内过滤、倒序

- [x] Task 3: 移除被取代的滞后差量检测
    - 3.1: 删除 `_scan_recent_passed`、`_RECENT_PASSED`、`_PASS_SNAPSHOT`、`RECENT_PASSED_MAX_AGE`、`RECENT_PASSED_MAX_LEN`
    - 3.2: `background_refresh_loop` 去掉 `_scan_recent_passed` 调用，只刷新 images
    - 3.3: 用 `python -m py_compile dashboard.py` 校验语法
