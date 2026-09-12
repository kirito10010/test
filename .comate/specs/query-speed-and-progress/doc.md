# 查询提速 + 进度显示

## 需求场景

「标签巡检」里用「通过时间」或「新旧排序」查询时很慢（查全部要几分钟），且等待过程中看不到进度，不知道是否还在跑、会不会成功。

## 为什么慢

每张图的 `reviewed_at` / `qc_status` 只能通过**逐张请求 `/annotation`** 拿到，平台没有批量接口。于是：

- 查全部（不选标签）→ 要逐张拉项目里所有标注图（约 1 万张）→ O(N) 个请求，几 10 秒到几分钟。
- 加上每次强制刷新导出（全量 ZIP），也是一笔固定开销。

当前并发是 8，1 万张约 4 分钟。

## 优化方案

1. **提高并发**：`SORT_CONCURRENCY` 8 → 16，约 2 倍提速（并发再高会增加平台压力，16 是平衡点，可再调）。
2. **加进度反馈**：
   - 后端维护一个全局进度 `_PROGRESS = {phase, total, done}`，在「下载导出」和「逐张拉 annotation」两个阶段更新。
   - 新增接口 `/api/query_progress` 返回当前进度。
   - 前端查询时用独立轮询每 1.5 秒读一次，把「拉取中 done/total」显示在查询摘要区，查询结束再替换成结果统计。

## 受影响文件

- `d:\Project\test\label-auto-dashboard\dashboard.py`
  - `SORT_CONCURRENCY` 8 → 16。
  - 新增全局 `_PROGRESS`。
  - `fetch_annotations` 内更新进度（done/total）。
  - `query_images` 下载导出前设置 phase=export。
  - 新增路由 `/api/query_progress`。
- `d:\Project\test\label-auto-dashboard\static\app.js`
  - `doQuery` 查询期间启动进度轮询，更新 `querySummary`，结束后停止。

## 边界与异常

- 进度是「已完成/总数」近似值，随完成量递增；查询失败时轮询自然停止并弹出失败提示。
- 并发提高只作用于「点查询」这种按需路径，不是后台持续请求，不影响日常压力。

## 预期结果

- 查全部从约 4 分钟降到约 2 分钟（并发 16）。
- 查询过程中能看到「拉取中 1234/10455」，不再干等、不知道是否在跑。
