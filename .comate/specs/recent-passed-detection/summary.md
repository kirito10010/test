# 最近通过检测 + 通过时间过滤 —— 总结

## 完成内容

实现了「快速定位最近新通过的数据并打回」的功能，核心是**状态差量检测**而非逐张拉取时间戳。

## 后端（dashboard.py）

1. 新增常量 `RECENT_PASSED_MAX_AGE`（6 小时）、`RECENT_PASSED_MAX_LEN`（500 条）。
2. 新增全局状态：`_PASS_SNAPSHOT`、`_RECENT_PASSED`、`_WATCHED`。
3. 新增函数：
   - `_fmt_ts()`：时间格式化。
   - `_active_pids()`：返回 top3 ∪ watched 项目 id。
   - `_scan_recent_passed()`：对比前后两轮「已通过集合」差值，记录新通过数据；首次只建基线。
4. `background_refresh_loop()`：遍历 `_active_pids()`，刷新 images 后调用 `_scan_recent_passed`；reviewed_at 增量仍只对最新 3 个项目做。
5. `/preload` 路由：加入 `_WATCHED.add(pid)`，切换项目即开始持续扫描。
6. `query_images()` 新增 `passed_minutes` 参数：过滤出该时间窗内新通过、且当前仍 passed 的图，按通过时间倒序。
7. `/query` 路由：解析并传入 `passed_minutes`。

## 前端（index.html + app.js）

1. 「标签巡检」工具栏新增「通过时间」下拉（全部/最近10/30/60分钟/6小时）。
2. `doQuery()` 读取并追加 `passed_minutes` 参数；复用现有「批量打回」按钮。

## 校验

`python -m py_compile dashboard.py` 语法通过。

## 使用方式

看板运行期间，在「标签巡检」选「通过时间=最近30分钟」+ 状态「已通过」，即可看到最近 30 分钟内新通过的数据（最新在上），勾选后批量打回。

## 已知局限（设计如此）

- 只检测看板启动/切换项目之后新通过的数据；启动前已通过的不算（符合「刚刚」语义）。
- 时间显示为「看板发现通过的时刻」，误差 ≤ 30 秒。
- 重启看板（`启动看板.bat`）后生效。
