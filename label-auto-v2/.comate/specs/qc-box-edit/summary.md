# 大图框编辑重构 总结（qc-box-edit v2）

## 完成内容

将框编辑能力从「网格小图」整体迁移到「大图」，并新增画框与已打回编辑。

### 后端 `dashboard.py`
- `qc_save()` 保存成功后，清除 `_RECENT_GROUPS` 中该 `image_id` 的 verdict 记录并持久化，确保已打回图改框保存后不再被本地历史 verdict 纠回 rejected。

### 前端 `qc.html` / `qc.css` / `qc.js`
- 删除顶栏「框编辑」开关（`qcEditToggle`）与旧浮动编辑面板 `editPanel`。
- 大图 `lightbox` 内新增顶部工具栏 `lightboxBar`（画框 / 分类 / 删除 / 保存 / 关闭）。
- 新增「画框后选择分类」弹窗 `catPicker`。
- `createViewer` 重构为 `createViewer(container, imageUrl, boxes, opts)`：
  - 命中容错提升：手柄半径 8→12px，新增「边线外扩 8px」命中，细框易点中。
  - 新增画框模式 `setDrawMode`，拖拽绘制虚线预览，松手回调 `onBoxDrawn`。
  - 编辑态空白点击触发 `onEmptyClick` 关闭大图。
- `openLightbox(id, boxes, editable)`：未质检/已打回可编辑（显示工具栏），已通过/最近提交只读。
- 保存成功 → 关闭大图 → `loadCounts()` + `loadCurrentTab()` 刷新。

## 调用点
- 未质检小图：`{onOpen: openLightbox(id,boxes,true), zoomable:true}`
- 已通过/已打回小图：`{onOpen: openLightbox(id,boxes, state.tab==='rejected'), zoomable:false}`
- 最近提交小图：`{onOpen: openLightbox(id,boxes,false), zoomable:false}`

## 验证
- `py_compile dashboard.py`、`node --check qc.js` 均通过。
- 服务已重启，`qc.html` 含 `lightboxBar`/`catPicker`、无 `qcEditToggle`；`qc.js` 含 `setDrawMode`/`openCatPicker`/`onBoxDrawn`、无 `toggleEditMode`。
- `/api/qc/autologin` 正常。

## 关键语义
- 编辑只在大图进行；网格小图只读。
- 画框后需点「保存」才整体写回平台；保存会把该图 `qc_status` 重置为 pending（已打回图因此转入未质检并消失）。
- 已通过/最近提交大图只读，左键单击关闭（编辑态点击空白也关闭）。
