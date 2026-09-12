# 总结：质检平台（三合一）优化

## 需求

1. 顶栏「共 N 条 / 质检量」位置修正。
2. 通过后下一张图的标注框加载快。
3. 右侧列表显示每条照片的作业员。
4. 支持文件名搜索。
5. 支持按作业员筛选。

## 改动

### 后端 `dashboard.py`
- 新增 `qc_annotator_owners(pid, uid)`（返回 `ann_of` + `anns`）。
- 新增路由 `GET /api/qc/annotators?pid=xxx&uid=xxx`。

### 前端 qc.html
- 顶栏 `.qc-spacer` 移到统计/质检量之前，靠右显示。
- 右侧列表 tab 上方加 `.qc-filters`（`#qcSearch` + `#qcAnnotatorFilter`）。

### 前端 qc.js
- 新增 `boxCache` + `prefetchBoxes`；`loadList`/`loadImage` 预加载标注框，`loadImage` 优先用缓存。
- state 增加 search/annotatorFilter/annOf/anns；加载作业员归属并渲染筛选下拉。
- `loadList` 按 search + annotatorFilter 过滤；`makeListItem` 显示「标注：名字」。
- 绑定搜索/筛选事件。

### 前端 qc.css
- 加 `.qc-filters`、`.qc-item-name`、`.qc-ann-tag` 样式。

## 校验与打包

- `dashboard.py` + `qc.js` 语法检查通过。
- `qc_annotator_owners('9367e30f2211','68f4d0965cb3')` 实测：6711 张图归属 3 个作业员（吕一鑫/郭雅楠/倪庆阁）。
- PyInstaller 重新打包 `dist/label-auto-dashboard.exe`（带图标），dist 仅此一个文件；已清理 `build/`。

## 结果

顶栏统计/质检量靠右；下一张图的框预加载后近乎即时显示；每条照片显示作业员，支持文件名搜索和按作业员筛选。
