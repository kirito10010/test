# 降低看板对平台的请求压力（突发 + 持续都修）

## 需求场景

看板一直开着后，作业/质检侧出现卡顿。经分析，看板对 Label Auto 平台的请求分两类：

1. **突发型**：登录时 `preload_all()` 对最新 3 个项目各下载一次完整标注包（`/export?format=json`，平台最重接口）；切换项目/首次按时间排序时 `preload_reviewed_async` → `fetch_reviewed_at` 对该项目所有已通过图并发拉 `/annotation`（当前 `max_workers=12`，几千张一次打出去）。
2. **持续型**：`background_refresh_loop` 每 15 秒强制刷新最新 3 个项目的 `/images` 列表（约 12 次/分钟）。

用户选择「突发 + 持续都修」：去掉登录 export 预下载、annotation 限流降并发、后台刷新间隔 15s 调回 30s。

## 处理逻辑

1. **去掉登录 export 预下载**
   - `preload_all()`：删除 `get_export_labels(pid)` 调用，只保留 `get_images(pid)` 预热。
   - export 改为用户真正查询/导出时按需拉取（已有 30 分钟缓存，不受影响）。
   - 同步更新 docstring。

2. **annotation 限流降并发**
   - 顶部常量区新增 `REVIEW_CONCURRENCY = 4`。
   - `fetch_reviewed_at()`：`ThreadPoolExecutor(max_workers=12)` → `max_workers=REVIEW_CONCURRENCY`。
   - 效果：几千张并发峰值从 12 降到 4，峰值压力约降 3 倍；不影响正确性，只是预加载耗时变长（可接受，因为是后台预取）。

3. **后台刷新间隔回调**
   - 顶部 `REFRESH_INTERVAL = 15` → `30`。
   - 效果：`/images` 列表刷新从约 12 次/分钟降到 6 次/分钟；代价是新通过数据出现稍慢（最多约 30 秒），符合用户「8 分钟后时间无所谓」的偏好。

## 架构与技术方案

保持缓存结构与增量拉取逻辑不变，只降低请求频率/并发/去掉最重的一次性下载。所有改动集中在 `dashboard.py`。

## 受影响文件

- `d:\Project\test\label-auto-dashboard\dashboard.py`
  - 顶部常量区：`REFRESH_INTERVAL` 15→30；新增 `REVIEW_CONCURRENCY = 4`。
  - `preload_all()`（约 line 189-201）：删除 `get_export_labels(pid)`，保留 `get_images(pid)`，改 docstring。
  - `fetch_reviewed_at()`（约 line 270-290）：`max_workers=12` → `max_workers=REVIEW_CONCURRENCY`。

## 边界条件与异常处理

- `preload_all` 去掉 export 后，登录不再触发最重接口；用户查标签/导出时仍按需拉取（30 分钟缓存命中）。
- `fetch_reviewed_at` 并发降为 4，`need` 为空时仍直接返回，无额外请求。
- 刷新间隔 30s 仍是常量，后续可再调。

## 预期结果

- 登录：不再下载 3 个完整标注包，登录瞬间请求量大幅下降。
- 切项目/首次排序：annotation 并发从 12 降到 4，峰值打压力显著降低。
- 后台：`/images` 刷新频率减半（6 次/分钟）。
- 功能不变：查询、导出、按时间排序均照常，仅预加载变慢、新数据出现最多延迟约 30 秒。
