# 修复「新旧排序 / 通过时间」的 8 分钟延迟 —— 总结

## 根因

平台 `/images` 的 `qc_status` 与监控一样是约 8 分钟快照（滞后），而 `/annotation?image_id=X` 是实时的（精确到秒）。旧的排序逻辑先用 `/images` 判断「非 pending」再拉 `reviewed_at`，导致刚通过的图仍显示 pending、被排除，表现为 8 分钟延迟。

## 改动（dashboard.py）

1. 新增 `fetch_annotations(pid, image_ids, max_workers=SORT_CONCURRENCY)`：并发拉 `/annotation`，取实时 `qc_status` + `reviewed_at`，带 60 秒短缓存 `_ANNOT`。
2. `query_images` 的 `sort=reviewed_desc` 与 `passed_minutes` 分支：改为用 `fetch_annotations` 的实时数据覆盖 `qc_status`、赋值 `reviewed_at`，再排序/过滤。
3. 移除已废弃的滞后检测：`_scan_recent_passed`、`_RECENT_PASSED`、`_PASS_SNAPSHOT`、`fetch_reviewed_at`、`get_cached_reviewed`、`preload_reviewed_async`、`_PRELOADING`、`REVIEW_CONCURRENCY`、`RECENT_PASSED_MAX_AGE/LEN`。
4. `background_refresh_loop` 简化为只刷新 images；`/preload` 只做 `_WATCHED.add`。

## 校验

`python -m py_compile dashboard.py` 通过。

## 效果

- 排序/通过时间查询改为实时 `/annotation`，不再有 8 分钟延迟；本次查询即能看到刚通过的图排在最上。
- 状态列显示实时 `qc_status`。
- 代价：每次这类查询会拉结果集的 `/annotation`（筛完约 976 张，约 10~20 秒，界面有提示），60 秒内连续查询秒回。

## 注意

重启看板（`启动看板.bat`）后生效。
