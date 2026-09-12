# 总结：作业平台文件名搜索 + 显示归谁质检 + 按质检员筛选

## 需求

在 label-auto-app（给别人用的合并版）的作业平台右侧列表，加文件名搜索、显示每张图归谁质检、并按质检员筛选。

## 改动

### 后端 `label-auto-app/dashboard.py`
- 新增 `anno_qc_owners(pid, uid)`：返回 `qc_of`（image_id -> {uid,name}）与 `qcs`（去重质检员列表）。
- 新增路由 `GET /api/anno/qc_owners?pid=xxx`（uid 从当前登录 USER 取）。

### 前端
- `anno.html`：在三个 tab 上方加 `.anno-filters`（`#annoSearch` 输入框 + `#annoQcFilter` 下拉）。
- `anno.js`：state 增加 search/qcFilter/qcOf/qcs；项目切换时拉取 qc_owners 并渲染下拉；`loadList()` 客户端按文件名+质检员过滤；`makeListItem(id, qcName)` 显示「质检：名字」；绑定搜索/筛选事件。
- `anno.css`：加 `.anno-filters`、`.anno-qc-tag` 等样式。

## 校验

- `dashboard.py` + `anno.js` 语法检查通过。
- `anno_qc_owners('9367e30f2211','373ef86dae05')` 实测：2684 张图全部归属李劲，`qcs=[{"uid":"68f4d0965cb3","name":"李劲"}]`。
- PyInstaller 重新打包 `dist/label-auto-app.exe`（带图标），dist 仅此一个文件；已清理 `build/`。

## 结果

- 三个 tab 上方出现搜索框 + 质检员下拉。
- 每条照片显示「质检：名字」。
- 输入文件名可过滤；选某个质检员可只看他的任务。
