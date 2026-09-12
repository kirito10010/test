# 质检平台 · 多选属性筛选 完成总结

## 目标
在质检平台右侧图片列表新增「按属性（标注分类）多选筛选」，选中多个属性时命中任一即可（并集），留空恢复全部，并与文件名搜索、作业员筛选叠加使用。

## 完成的改动

### 后端 `dashboard.py`
1. 新增 `category_match_bases(pid, cat_names)`：分类名 → 导出编号 → 用 `get_export_labels` 找出命中任一分类的图 base_name 集合；无有效分类时返回 None。
2. `qc_assigned(..., cat_names=None)` 扩展：在遍历 `files` 时按 `_base_name(f)` 过滤不在命中集合的图。
3. `/api/qc/assigned` 路由解析 `cat` 参数（逗号分隔）并传入 `qc_assigned`。

### 前端
- `qc.html`：筛选区新增 `#qcCatPicker` 多选控件（field + dropdown）。
- `qc.css`：新增 `.label-picker*` 系列样式，适配 `qc-filters`。
- `qc.js`：
  - `state.catFilter` 状态。
  - `renderCatPicker` / `updateCatPickerField` / `toggleCatPicker`。
  - `loadList` 非 recent 页签拼 `cat` 参数。
  - 切项目清空并重绘，切质检员清空并刷新显示。
  - 控件点击展开、点击外部关闭。

## 验证
- `dashboard.py`：`ast.parse` 语法校验通过。
- `qc.js`：`node --check` 语法校验通过。
- PyInstaller 打包成功，`dist/label-auto-dashboard.exe` 已重新生成。

## 待用户确认
- 重新打开 exe，勾选一个或多个属性后，右侧列表是否只显示包含所选任一属性的图；取消勾选是否恢复全部。
- 与文件名搜索、作业员筛选叠加是否正常。
