# 修复「新旧排序 / 通过时间」的 8 分钟延迟（改用实时 /annotation）

## 需求场景

标签巡检里按「质检通过时间新→旧」排序，或按「通过时间」过滤时，最新数据始终停在约 8 分钟前，刚通过的图看不到。

## 根因

平台两套数据源新鲜度不同：

- `/images`：每张图的 `qc_status`，但和监控一样是**约 8 分钟的快照**（滞后）。
- `/annotation?image_id=X`：**实时**返回 `qc_status` 和 `reviewed_at`（质检通过时间，精确到秒）。

当前排序逻辑先按 `/images` 的 `qc_status` 筛「非 pending」的图，只给这些图拉 `reviewed_at`。刚通过的图在 `/images` 里仍显示 `pending`（滞后 8 分钟），于是被排除、`reviewed_at` 没拉到 → 排序/状态里看不到它 → 表现为 8 分钟延迟。

## 处理逻辑

改为以 `/annotation` 的实时数据为准：

1. 新增 `fetch_annotations(pid, image_ids, max_workers=SORT_CONCURRENCY)`：
   - 并发拉 `/annotation`，取每张图的实时 `qc_status` + `reviewed_at`。
   - 带 60 秒短缓存（`_ANNOT`：pid → {_ts, data:{image_id:{qc_status,reviewed_at}}}），减少连续查询对平台的压力。

2. `query_images` 的 `sort=reviewed_desc` 分支：
   - 对结果集**全部**图调 `fetch_annotations`（不再按 lagged qc_status 排除 pending）。
   - 用实时 `qc_status` 覆盖 `r["qc_status"]`，用实时 `reviewed_at` 赋值 `r["reviewed_at"]`。
   - 按 `reviewed_at` 倒序。

3. `query_images` 的 `passed_minutes` 分支：
   - 同样用 `fetch_annotations` 的实时数据。
   - 过滤条件：实时 `qc_status == "passed"` 且 `reviewed_at >= now - passed_minutes*60`。
   - 按 `reviewed_at` 倒序。

4. 移除已被取代的滞后检测：
   - 删除 `_scan_recent_passed`、`_RECENT_PASSED`、`_PASS_SNAPSHOT`、`RECENT_PASSED_MAX_AGE/LEN`。
   - `background_refresh_loop` 恢复为只刷新 images（供普通查询用），不再做差量检测。
   - `_WATCHED` / `_active_pids` 保留（用于刷新当前选中项目的 images），`/preload` 的 `_WATCHED.add` 保留。

## 架构与技术方案

- 排序/通过时间这类「需要精确通过时间」的功能，改走实时 `/annotation`；普通浏览（不排序）仍用 `/images`（可接受 8 分钟滞后，因为只看状态、不追求秒级）。
- 60 秒短缓存：连续点查询秒回、且不频繁打平台；最多 60 秒后就能看到新通过。

## 受影响文件

- `d:\Project\test\label-auto-dashboard\dashboard.py`
  - 新增全局 `_ANNOT`、常量 `ANNOT_TTL = 60`。
  - 新增 `fetch_annotations()`。
  - 修改 `query_images()` 的 `sort` 与 `passed_minutes` 分支。
  - 删除 `_scan_recent_passed` 及相关状态/常量；简化 `background_refresh_loop`。

## 边界条件与异常处理

- `/annotation` 拉取失败：单张返回空 `qc_status`/`reviewed_at`，不中断整体；排序时空时间排最后。
- 待质检图：实时 `qc_status= pending`、`reviewed_at` 为空，排序时排最后；通过时间过滤时不命中。
- 已打回图：实时 `qc_status= rejected`，通过时间过滤要求 `passed` 会排除。
- 结果集很大（查全部）：拉取耗时长，但用户通常先按标签筛选；界面已有「拉取中」提示。

## 预期结果

- 质检员通过一张后，用户点「新旧排序」或「通过时间=最近N分钟」，能立即（本次查询的实时结果）看到它排在最上，不再有 8 分钟延迟。
- 状态列显示实时 `qc_status`，不再是滞后值。
