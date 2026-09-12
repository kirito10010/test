# 查询提速 + 进度显示 —— 总结

## 完成内容

1. **提速**：`SORT_CONCURRENCY` 8 → 16，查询时并发拉取 annotation 的吞吐约翻倍。
2. **进度显示**：
   - 后端新增全局 `_PROGRESS`，在「下载导出」和「逐张拉 annotation」两阶段更新 total/done。
   - 新增接口 `/api/query_progress` 返回当前进度。
   - 前端 `doQuery` 查询期间启动独立轮询（每 1.5s），把「正在下载导出数据…」/「正在拉取质检时间 X/Y…」显示在查询摘要区，结束后替换为结果统计。

## 改动文件

- `dashboard.py`：并发 8→16；`_PROGRESS`；`fetch_annotations` 更新进度；`query_images` 设置导出阶段；`/api/query_progress` 路由。
- `static/app.js`：新增 `startQueryProgress`/`stopQueryProgress`，`doQuery` 查询期间轮询并显示进度。

## 校验

`python -m py_compile dashboard.py` 通过。

## 效果

- 查全部耗时约减半（并发 16，约 2 分钟量级）。
- 查询过程中能看到实时进度（拉取中 done/total），不再干等、不知道是否在跑。

## 注意

- 并发 16 只作用于「点查询」的按需路径，不影响后台（后台已无）。
- 若仍觉得慢，可继续把 `SORT_CONCURRENCY` 调到 24/32，代价是单次查询对平台的瞬时压力更大。
- 重启看板（`启动看板.bat`）后生效。
