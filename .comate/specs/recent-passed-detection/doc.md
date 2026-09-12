# 最近通过检测 + 通过时间过滤（快速定位刚通过并打回）

## 需求场景

多人并行作业一个项目时，已通过数据没有按「通过时间」排序，用户难以从几千条已通过数据里找到「刚刚通过的几条」并打回。本质需求：**看板持续运行期间，快速查出最近（N 分钟内）新通过的数据，并批量打回。**

## 核心思路（状态差量检测，而非拉时间戳）

平台 `/images` 接口每张图带 `qc_status`（passed/pending/rejected），看板后台本来就在每 30 秒刷新一次。只要对比**前后两轮的「已通过集合」差值**，就能精确得到「这 30 秒内新通过」的图，并记录发现时间。这样：

- 不额外逐张拉 `/annotation`（避免几千张的昂贵请求）。
- 实时性误差 ≤ 30 秒（= 刷新间隔）。
- 只检测「看板运行后」新通过的数据（看板启动前已通过的不算，符合「刚刚」语义，也避免启动误报）。

## 处理逻辑

### 1. 后台增量检测（dashboard.py）

新增内存状态：

```python
_PASS_SNAPSHOT = {}   # pid -> set(已通过图片 base_name)
_RECENT_PASSED = {}   # pid -> [{"image_id": base, "passed_at": epoch}]，新→旧
_WATCHED = set()      # 需要持续扫描的额外项目 id（用户切到的项目）
RECENT_PASSED_MAX_AGE = 6 * 3600   # 保留 6 小时
RECENT_PASSED_MAX_LEN = 500        # 每项目最多保留条数
```

新增 `_scan_recent_passed(pid, imgs)`：
- 从 `imgs` 计算当前 `passed` 集合（base_name）。
- 若 `pid` 无快照：只建基线（不记录，避免启动把历史全算新通过）。
- 否则 `new = passed - 旧快照`，把每条 `new` 插入 `_RECENT_PASSED[pid]` 头部（`passed_at=now`）。
- 更新快照；按 `RECENT_PASSED_MAX_AGE` / `RECENT_PASSED_MAX_LEN` 清理旧记录。

新增 `_active_pids()`：返回 `get_top_projects()` 的 id ∪ `_WATCHED`（去重）。

修改 `background_refresh_loop()`：
- 遍历 `_active_pids()`，每轮 `get_images` 后调用 `_scan_recent_passed(pid, imgs)`。
- `reviewed_at` 增量拉取仍只对最新 3 个项目做（保持原逻辑，不给新关注项目带来几千张爆发）。

修改 `/api/projects/{id}/preload` 路由：加入 `_WATCHED.add(pid)`（用户切换项目即开始持续扫描该项目）。

### 2. 查询接口支持通过时间过滤

`query_images(pid, cat_names, sort=None, passed_minutes=None)`：
- 新增 `passed_minutes`（0/None 表示不过滤）。
- 当 `passed_minutes > 0`：
  - `cutoff = now - passed_minutes*60`。
  - 从 `_RECENT_PASSED[pid]` 取 `passed_at >= cutoff` 且**当前 qc_status == passed** 的图片集合。
  - 过滤 `results` 只留这些图，给每条 `r["reviewed_at"] = 格式化(passed_at)`（复用现有「质检时间」列显示）。
  - 按 `passed_at` 倒序返回。
  - 该模式优先级高于 `sort`（本身就是「新→旧」）。

`/api/projects/{id}/query` 路由：解析 `passed_minutes` 参数传入。

### 3. 前端（index.html + app.js）

- 「标签巡检」工具栏新增下拉：

```html
<label>通过时间：</label>
<select id="queryPassedMinutes">
  <option value="">全部</option>
  <option value="10">最近10分钟</option>
  <option value="30">最近30分钟</option>
  <option value="60">最近1小时</option>
  <option value="360">最近6小时</option>
</select>
```

- `doQuery()`：读取 `queryPassedMinutes.value`，非空则追加 `passed_minutes=<值>`。
- 复用现有「批量打回」按钮，无需新增打回逻辑。

## 架构与技术方案

- 「最近通过」检测复用已有的 30s images 轮询，平台持续压力不回弹（只比原来多扫描用户当前切换到的项目）。
- 查询过滤在服务端完成，前端零额外渲染逻辑（复用「质检时间」列）。
- 时间语义：显示的是「看板发现该图通过的时刻」，误差 ≤ 30 秒，足够定位「刚通过的那几条」。

## 受影响文件

- `d:\Project\test\label-auto-dashboard\dashboard.py`
  - 顶部常量区：新增 `RECENT_PASSED_MAX_AGE`、`RECENT_PASSED_MAX_LEN`。
  - 新增全局：`_PASS_SNAPSHOT`、`_RECENT_PASSED`、`_WATCHED`。
  - 新增函数：`_fmt_ts()`、`_scan_recent_passed()`、`_active_pids()`。
  - 修改 `background_refresh_loop()`、`/preload` 路由、`query_images()`、`/query` 路由。
- `d:\Project\test\label-auto-dashboard\static\index.html`
  - 查询工具栏新增「通过时间」下拉。
- `d:\Project\test\label-auto-dashboard\static\app.js`
  - `doQuery()` 读取并传递 `passed_minutes`。

## 边界条件与异常处理

- 首次快照只建基线不记录：避免启动时把历史已通过全当「新通过」。
- 已被用户打回的图：当前 `qc_status` 不再是 passed，会被过滤掉，不干扰。
- 看板关闭期间通过的数据：不会补标（已知局限，符合「刚刚」语义）。
- 项目数多：`_WATCHED` 只随用户切换累加，数量可控；`_RECENT_PASSED` 有年龄/条数上限。
- `image_id` 用 `_base_name` 归一化匹配，兼容带/不带 `.jpg`。

## 预期结果

- 看板运行期间，用户在「标签巡检」选「通过时间=最近30分钟」+ 状态「已通过」，即可看到最近 30 分钟内新通过的数据（最新在上），勾选后批量打回。
- 后台持续请求压力基本不变；该功能不再依赖昂贵的逐张 `reviewed_at` 拉取。
