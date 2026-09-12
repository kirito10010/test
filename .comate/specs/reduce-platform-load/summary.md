# 降低看板对平台的请求压力 —— 总结

## 完成内容

在 `d:\Project\test\label-auto-dashboard\dashboard.py` 中实施了「突发 + 持续」两方面的减压：

1. **去掉登录 export 预下载**：`preload_all()` 不再调用 `get_export_labels(pid)`，登录时只预热 `get_images(pid)`；export 留到用户真正查询/导出时按需拉取（30 分钟缓存不变）。

2. **annotation 限流降并发**：新增常量 `REVIEW_CONCURRENCY = 4`，`fetch_reviewed_at()` 的 `max_workers` 从 12 降到 4，几千张并发峰值压力约降 3 倍。

3. **后台刷新间隔回调**：`REFRESH_INTERVAL` 从 15 秒调到 30 秒，`/images` 列表刷新从约 12 次/分钟降到 6 次/分钟。

## 校验

`python -m py_compile dashboard.py` 语法通过。

## 效果与代价

- 登录瞬间不再下载 3 个完整标注包，请求量大幅下降。
- 切项目/首次按时间排序时 annotation 并发峰值降低。
- 后台持续刷新频率减半。
- 代价：预加载（尤其按时间排序）变慢、新通过数据出现最多延迟约 30 秒，符合「8 分钟后时间无所谓」的偏好。

重启看板（`启动看板.bat`）后生效。
