# 大图框编辑重构实施任务（qc-box-edit v2）

- [x] Task 1: 后端保存后清除本地 recent verdicts
    - 1.1: `qc_save()` 保存成功后，遍历 `_RECENT_GROUPS` 清除该 `image_id` 的 verdict 记录
    - 1.2: 调用 `_save_recent_groups()` 持久化
    - 1.3: `py_compile dashboard.py` 语法自检

- [x] Task 2: 前端 HTML/CSS 结构调整
    - 2.1: 删除顶栏 `qcEditToggle` 按钮
    - 2.2: 删除旧 `editPanel` 面板 DOM
    - 2.3: lightbox 内新增 `lightboxBar` 工具栏（画框、分类下拉、删除、保存、关闭）
    - 2.4: 新增 `catPicker` 分类选择弹窗
    - 2.5: `qc.css` 新增 `lightboxBar`、`catPicker` 样式，清理旧编辑面板样式

- [x] Task 3: createViewer 重构为 options 参数
    - 3.1: 签名改为 `createViewer(container, imageUrl, boxes, opts)`
    - 3.2: 提取 `onOpen/zoomable/editable/onSelect/onDeselect/onBoxesChange/onBoxDrawn/onEmptyClick`
    - 3.3: `hitTest` 提高容错（手柄半径 12px、边线外扩 8px 命中）
    - 3.4: 新增 `drawMode` 与 `drawRect` 虚线预览绘制
    - 3.5: 编辑态左键：画框模式拖拽画框，否则命中选中/移动/缩放，空白触发 `onEmptyClick`
    - 3.6: `viewerApi` 暴露 `setDrawMode`、`setSelected`、`redraw`、`getSelected`

- [x] Task 4: openLightbox 改造与工具栏交互
    - 4.1: `openLightbox(id, boxes, editable)`，按 editable 显示/隐藏工具栏
    - 4.2: 选中/取消选中/框增删回调更新工具栏（分类下拉、删除、保存禁用态）
    - 4.3: 画框完成回调弹出 `catPicker`，确定后 push 新框并选中
    - 4.4: 保存成功后关闭大图 + `loadCounts()` + `loadCurrentTab()`
    - 4.5: 关闭按钮与 `onEmptyClick` 关闭大图

- [x] Task 5: 调用点调整与清理
    - 5.1: `makeCell` 改为 `createViewer(..., {onOpen, zoomable:true})`，删除 editMode 传参
    - 5.2: `makeBrowseCell` 按 `state.tab==='rejected'` 决定大图是否可编辑
    - 5.3: `makeRecentCell` 传只读大图
    - 5.4: 删除 `toggleEditMode`、`showEditPanel`/`hideEditPanel`、`state.editMode` 等旧逻辑
    - 5.5: `node --check qc.js` 语法自检

- [x] Task 6: 联调与自检
    - 6.1: `node --check qc.js` 与 `py_compile dashboard.py` 均通过
    - 6.2: 启动服务，验证未质检大图编辑：选中/移动/缩放/改分类/画框/删除/保存
    - 6.3: 验证已打回大图编辑保存后，从已打回列表消失（转未质检）
    - 6.4: 验证已通过/最近提交大图只读
    - 6.5: 验证保存后平台 `/annotation` 框数据一致、数量刷新
