# 质检平台 · 多选属性筛选 实施任务

- [x] Task 1: 后端新增 `category_match_bases` 辅助函数
    - 1.1: 在 `dashboard.py` 的 `category_to_export_idx` 之后新增函数
    - 1.2: 分类名转导出编号集合，全部无效时返回 None
    - 1.3: 用 `get_export_labels` 遍历 bboxes，命中任一分类则收集 base_name
    - 1.4: 用 `python -c "import ast; ast.parse(...)"` 校验语法

- [x] Task 2: 后端扩展 `qc_assigned` 支持属性过滤
    - 2.1: 函数签名加 `cat_names=None`
    - 2.2: 在遍历 `files` 前计算 `cat_bases`
    - 2.3: 遍历时按 `_base_name(f)` 过滤不在命中集合的图
    - 2.4: 校验语法

- [x] Task 3: 后端扩展 `/api/qc/assigned` 路由解析 `cat` 参数
    - 3.1: 从 `qs` 解析 `cat`，拆成逗号分隔列表
    - 3.2: 传入 `qc_assigned(..., cat_names)`
    - 3.3: 校验语法

- [x] Task 4: 前端 `qc.html` 新增属性多选控件
    - 4.1: 在 `.qc-filters` 内新增 `#qcCatPicker` 结构（field + dropdown）

- [x] Task 5: 前端 `qc.css` 新增 label-picker 样式
    - 5.1: 新增 `.label-picker` / `.label-picker-field` / `.label-picker-tag` / `.label-picker-dropdown` / `.label-picker-option`
    - 5.2: 适配 `qc-filters` 内布局（宽度自适应）

- [x] Task 6: 前端 `qc.js` 接入属性筛选逻辑
    - 6.1: `state` 新增 `catFilter: []`
    - 6.2: 新增 `renderCatPicker` / `updateCatPickerField` / `toggleCatPicker`
    - 6.3: `loadList` 非 recent 页签拼 `cat` 参数
    - 6.4: 项目/质检员切换时清空 `catFilter` 并重绘
    - 6.5: 绑定控件点击/外部关闭事件
    - 6.6: `node --check` 校验语法

- [x] Task 7: 重新打包并验证
    - 7.1: 结束运行中的 exe
    - 7.2: `python -m PyInstaller --clean --noconfirm label-auto-dashboard.spec`
    - 7.3: 确认 `dist` 生成 `label-auto-dashboard.exe`
