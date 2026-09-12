# 质检大图编辑交互重构任务清单

- [x] Task 1: 重构大图 HTML 结构
    - 1.1: 删除 `lightboxBar`、`drawToggle`、`editCategory`、`catPicker` 模态框
    - 1.2: 新增左侧 `lightboxSidebar`，内含 `lbCats`（属性按钮容器）、提示文案、`editDelete`/`editSave`/`lightboxClose` 按钮
    - 1.3: 保留 `lightboxViewer` 与 `photo-name` 逻辑不变

- [x] Task 2: 新增侧栏与属性按钮 CSS
    - 2.1: `.lightbox` 由 column 改为 row 布局
    - 2.2: 新增 `.lightbox-sidebar`、`.lb-cats`、`.cat-btn`（含 `.active`）、`.lb-actions` 样式

- [x] Task 3: 重构 createViewer 鼠标与双击逻辑
    - 3.1: 删除 `drawMode`、`setDrawMode`、`boxDrag` 相关状态与分支
    - 3.2: `mousedown`（左键 editable）只记录 `drawStart` 起点
    - 3.3: `mousemove` 中 `drawStart` 超过 3px 阈值才判定为画框并更新 `drawRect`
    - 3.4: `mouseup` 区分「画框 / 无效拖动 / 单击选中或取消选中」
    - 3.5: `hitTest` 移除 handle 分支，仅返回 `{type:'box', index}` 或 `null`
    - 3.6: `drawOverlay` 移除四角手柄绘制，保留选中加粗高亮
    - 3.7: 新增 `dblclick` 删除（仅 editable），通过 `onDelete(index)` 回调
    - 3.8: 新增 `onDelete` 到 `opts`/`viewerApi`，移除 `onEmptyClick`

- [x] Task 4: 重写 openLightbox 与左侧属性面板逻辑
    - 4.1: `openLightbox` 按 editable 显示/隐藏侧栏，生成属性按钮，设置默认 `activeCategory`
    - 4.2: 新增模块级 `activeCategory`、`renderCategoryButtons`、`highlightActiveCategory`、`clickCategory`
    - 4.3: `clickCategory` 同时设置画框属性、并在有选中框时修改其分类后取消选中
    - 4.4: `onBoxDrawn` 用 `activeCategory` push 新框并自动取消选中

- [x] Task 5: 删除、保存与大图快捷键
    - 5.1: 简化 `onBoxSelect`/`onBoxDeselect` 只控制删除按钮禁用态
    - 5.2: 新增 `deleteBoxAt(idx)`，绑定 `editDelete` 按钮与双击/Delete 键
    - 5.3: 将保存逻辑抽取为 `saveLightbox()`，绑定 `editSave` 按钮与 C 键
    - 5.4: 新增大图 keydown 监听（Delete/Backspace 删除、C 保存、Escape 关闭）

- [x] Task 6: 清理废弃代码
    - 6.1: 删除 `fillCategorySelect`、`openCatPicker`、`pendingNewBox` 及 catPicker 相关事件
    - 6.2: 删除 `drawToggle`、`editCategory` 事件绑定
    - 6.3: 通读 qc.js 确认无残留引用与语法错误
