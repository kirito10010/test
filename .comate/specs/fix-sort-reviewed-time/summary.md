# 修复「按质检时间排序」时间不显示 + 第二次查询无反应 —— 总结

## 完成内容

在 `dashboard.py` 中修复「查询新→旧（质检通过时间）」的两个问题：

1. **时间不显示**：`query_images` 的 `sort=reviewed_desc` 分支改为**同步**补齐缺失的 `reviewed_at`，再返回结果，时间列不再空。
2. **第二次查询没动静**：因缓存只在全部拉完后写入一次导致进度不可见，现改为**原地共享、渐进写入**，且排序查询同步完成，第二次查询直接命中缓存秒出带时间结果。

## 具体改动

1. 新增常量 `SORT_CONCURRENCY = 8`（排序查询专用并发；后台预加载仍用 `REVIEW_CONCURRENCY = 4`）。
2. `fetch_reviewed_at(pid, image_ids, max_workers=None)`：
   - 增加可选 `max_workers`，默认 `REVIEW_CONCURRENCY`。
   - 循环前先 `cache_set` 共享 `cached` dict，原地填充，进度即时可见并自动去重。
3. `query_images` 的 `sort=reviewed_desc` 分支：`preload_reviewed_async(pid)` → 同步 `fetch_reviewed_at(pid, missing, max_workers=SORT_CONCURRENCY)`，拉完重新读缓存再赋值排序。

## 校验

`python -m py_compile dashboard.py` 语法通过。

## 说明

- 首次「查全部图」按时间排序是冷启动，需同步拉取几千张，会等待一段时间（前端已有「首次会拉取质检时间，请稍候…」提示）；之后有 24 小时缓存，秒出。
- 后台持续请求压力不回弹（30s 刷新 + 并发 4 保持）。
- 重启看板（`启动看板.bat`）后生效。
