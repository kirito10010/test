# 只加载最新 3 个项目（减轻压力）

## 需求场景

账号（于荣华 / 当前登录账号）的项目列表里有很多项目，每个项目都带有 `created_at`（项目创建时间）和 `task_type`（如「预标注」）。

目前看板在**登录预加载**（`preload_all`）和**后台定期刷新**（`background_refresh_loop`）两处，都是遍历**全部项目**，对每个项目都拉取 export / images / reviewed_at。项目多了之后，后台每 15 秒刷新一次会把所有项目都打一遍平台接口，压力大。

用户诉求：**每次启动只加载创建时间最新的前 3 个项目**，其余老项目不主动预加载、不主动后台刷新，减轻对平台的请求压力。

## 处理逻辑

1. 项目对象结构（来自 `/api/projects`，见 `新建文本文档.json` 样例）：
   ```json
   {
     "id": "72284c4b8322",
     "name": "车信箭头标牌标注3",
     "task_type": "预标注",
     "created_at": "2026-08-24 14:56:34",
     ...
   }
   ```
   `created_at` 是字符串，格式 `YYYY-MM-DD HH:MM:SS`，零填充，可直接按字符串字典序比较（越晚越大）。

2. 新增常量 `TOP_PROJECTS = 3`，放在 `dashboard.py` 顶部常量区（`REFRESH_INTERVAL` 附近）。

3. 新增辅助函数 `get_top_projects(n=TOP_PROJECTS)`：
   - 调用 `get_projects()` 拿全量项目列表
   - 按 `created_at` 倒序排序（缺字段的视为空串排最后）
   - 返回前 `n` 个项目

4. 两处改动：
   - `preload_all()`：`for p in proj.get("projects", [])` → `for p in get_top_projects()`
   - `background_refresh_loop()`：`for p in proj.get("projects", [])` → `for p in get_top_projects()`

## 架构与技术方案

保持现有缓存与增量拉取逻辑不变，仅收窄「主动刷新范围」。老项目仍可通过用户在页面下拉选择后**按需**加载（`onProjectChange` → `/preload` → `preload_reviewed_async`；以及查询时 `get_images` 带 60s TTL 的按需拉取），只是不再被后台每 15 秒主动刷新。

## 受影响文件

- `d:\Project\test\label-auto-dashboard\dashboard.py`（唯一改动文件）
  - 顶部常量区：新增 `TOP_PROJECTS = 3`
  - `get_projects()` 之后：新增 `get_top_projects(n=TOP_PROJECTS)`
  - `preload_all()`（约 line 180-194）：循环改用 `get_top_projects()`
  - `background_refresh_loop()`（约 line 216-240）：循环改用 `get_top_projects()`

## 边界条件与异常处理

- 项目列表为空：`get_top_projects()` 返回空列表，两处循环自然跳过。
- `created_at` 缺失/为 None：排序 key 用 `p.get("created_at") or ""`，空串排最后。
- 项目数 < 3：`ps[:n]` 返回全部，等价于原有行为。
- 老项目被用户手动选中：仍按需加载，不受影响。

## 预期结果

- 登录后与后台每 15 秒刷新，只处理创建时间最新的 3 个项目，显著减少平台请求次数。
- 页面项目下拉仍显示全部项目（项目列表本身很轻、TTL 1800 秒，不受影响）。
