# 质检平台（三合一）优化：顶栏布局 + 框预加载 + 显示作业员/搜索/筛选

## 问题清单

1. 顶栏「共 N 条：作业中 N」「质检量」位置不对。
2. 通过后下一张图显示快，但标注框加载慢。
3. 右侧列表看不到每条照片的「作业员」是谁。
4. 没有搜索照片名。
5. 没有按作业员筛选数据。

## 方案

### 1. 顶栏布局（qc.html）

把 `.qc-spacer` 移到 `.qc-counts` / `.qc-daily-stats` 之前，让统计和每日质检量靠右、与作业平台一致：

```
质检平台 | 项目 | 质检员 | spacer | 共N条 | 质检量 | 通过 | 打回 | 保存 | 设置 | 作业平台 | 数据看板
```

### 2. 标注框预加载（qc.js）

- 新增前端 `boxCache`（imageId -> boxes）+ `prefetchBoxes(id)`。
- `loadList` 后预加载前 4 张的标注框；`loadImage` 里预加载下一张的标注框。
- `loadImage` 优先用缓存框，命中则立即 `redraw`，避免「图快框慢」。

### 3. 显示作业员 / 搜索 / 筛选

- 后端新增 `qc_annotator_owners(pid, uid)`：返回某质检员名下每张图由哪个作业员标注（`ann_of` + `anns` 去重作业员列表）。名字复用 `build_uid_name_map()`。
- 后端新增路由 `GET /api/qc/annotators?pid=xxx&uid=xxx`。
- 前端 qc.html：右侧列表 tab 上方加搜索框 + 作业员筛选下拉。
- 前端 qc.js：加载作业员归属，每条列表显示「标注：名字」，按文件名 + 作业员做客户端过滤。

## 影响文件

- `label-auto-dashboard/dashboard.py`
- `label-auto-dashboard/static/qc.html`
- `label-auto-dashboard/static/qc.js`
- `label-auto-dashboard/static/qc.css`

## 边界与异常

- 无作业员归属的图：不显示「标注」，筛选中归「无归属」。
- `boxCache` 随项目切换清空；接口失败静默降级为按需拉取。
- 搜索/筛选纯客户端，列表已全量加载（limit=100000）。

## 预期结果

- 顶栏统计/质检量位置正确。
- 通过后下一张图的框近乎即时显示。
- 每条照片显示作业员；支持文件名搜索和按作业员筛选。
