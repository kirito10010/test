# 质检大图编辑交互重构 — 完成总结

## 目标

把质检平台大图编辑从「画框开关 + 分类下拉 + 拖角缩放 + 拖框移动 + 画框后弹窗选分类」重构为类标注工具的标准交互：

- 最左侧为所有属性（分类）按钮，点选后画出的框自动带该属性。
- 取消画框开关：左键拖动 = 画框，右键拖动 = 平移，单击 = 选中，双击 = 删除，C = 保存。
- 每画完/改完/删完一个框自动取消选中，杜绝误改。

## 改动文件

- `label-auto-dashboard/static/qc.html`：删除 `lightboxBar`、`drawToggle`、`editCategory`、`catPicker` 模态框，新增左侧 `lightboxSidebar`（`lbCats` 属性按钮容器 + 提示 + 删除/保存/关闭按钮）。
- `label-auto-dashboard/static/qc.css`：`.lightbox` 由纵向改横向；新增 `.lightbox-sidebar`、`.lb-cats`、`.cat-btn`（含 `.active`）、`.lb-actions` 样式。
- `label-auto-dashboard/static/qc.js`：
  - `createViewer`：删除 `drawMode`/`setDrawMode`/`boxDrag`/四角手柄/`near`/`HANDLE`/`copyBox`，改为「左键按下记起点 → 移动超 3px 判定为画框 → 未超阈值判定为单击选中/取消选中」，新增 `dblclick` 删除与 `onDelete` 回调。
  - 新增模块级 `activeCategory`、`renderCategoryButtons`、`highlightActiveCategory`、`clickCategory`。
  - 重写 `openLightbox`（按 editable 显隐侧栏、生成属性按钮、`onBoxDrawn` 用 activeCategory push 后自动取消选中）。
  - `onBoxSelect`/`onBoxDeselect` 仅控制删除按钮禁用态；新增 `deleteBoxAt`；抽取 `saveLightbox`；新增大图 keydown（Delete/Backspace 删除、C 保存、Escape 关闭）。
  - 清理 `fillCategorySelect`、`openCatPicker`、`pendingNewBox`、`drawToggle`/`editCategory`/`catPicker` 事件。

## 验证

- `node --check` 通过（qc.js 无语法错误）。
- 全局搜索确认无 `drawMode`/`setDrawMode`/`boxDrag`/`onEmptyClick`/`fillCategorySelect`/`openCatPicker`/`pendingNewBox`/`catPicker`/`drawToggle`/`editCategory`/`lightboxBar` 残留引用。
- HTML 中已无 `lightboxBar`/`drawToggle`/`editCategory`/`catPicker`，`lightboxSidebar`/`lbCats`/`editDelete`/`editSave`/`lightboxClose`/`lightboxViewer` 齐全。

## 关键行为确认

- 保存语义未变：未质检=保存并质检通过；已打回=仅保存回未质检；保存后关闭大图并刷新。
- 左键拖动即画框（含从已有框上拖动画新框）；不再支持拖框移动/拖角缩放，改错可双击删除重画。

## 待确认 / 未决

- 「移除拖框移动/拖角缩放」为本次交互的直接实现；若后续仍需调整框几何，可在 doc.md 所述方案（Alt 拖动移动 / 拖角缩放）基础上再议。
