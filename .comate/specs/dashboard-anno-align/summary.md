# 总结：三合一作业平台对齐 label-auto-app

## 需求

三合一（label-auto-dashboard）作业平台补上 label-auto-app 已有的三样：文件名搜索、按质检员筛选、每条照片显示「归谁质检」。图标和每日标注量此前已就绪。

## 改动

### 后端 `label-auto-dashboard/dashboard.py`
- 新增 `anno_qc_owners(pid, uid)`（返回 `qc_of` + `qcs`，名字用 owner token 的 `build_uid_name_map`）。
- 新增路由 `GET /api/anno/qc_owners?pid=xxx&uid=xxx`（带 `_qc_gated`）。

### 前端
- `anno.html`：三个 tab 上方加 `.anno-filters`（`#annoSearch` + `#annoQcFilter`）。
- `anno.js`：state 增加 search/qcFilter/qcOf/qcs；新增 loadQcOwners/renderQcFilter/applyFilters；`onAnnotatorChange` 重置筛选并拉归属；`loadList` 客户端过滤；`makeListItem(id, qcName)` 显示「质检：名字」；绑定搜索/筛选事件。
- `anno.css`：加 `.anno-filters`、`.anno-qc-tag` 等样式。

## 校验与打包

- `dashboard.py` + `anno.js` 语法检查通过。
- `anno_qc_owners('9367e30f2211','373ef86dae05')` 实测：2684 张图全部归属李劲。
- PyInstaller 重新打包 `dist/label-auto-dashboard.exe`（带图标），dist 仅此一个文件；已清理 `build/`。

## 结果

三合一作业平台与 label-auto-app 对齐：顶部有搜索框 + 质检员下拉，每条照片显示「质检：名字」，可输入文件名过滤、可按质检员筛选。
