# 质检平台：大图框编辑重构（qc-box-edit v2）

## 1. 需求背景

上一版（v1）在未质检网格小图上直接开关「框编辑」并编辑，存在体验问题：

1. 小图空间小、框细，很难精准点到框。
2. 编辑开关和「通过/打回」切换并存，容易误操作（开关编辑会重置判定）。
3. 用户希望**只有点开大图才出现编辑功能**，网格小图保持只读。
4. 需要**画框**能力：拖拽画新框 → 弹出分类选择赋值。
5. **已打回面板也要能编辑**：放大编辑、保存后自动关闭大图刷新，且该图会从「已打回」变成「未质检」（平台语义：保存标注会把 qc_status 重置为 pending）。

## 2. 功能范围

- 网格小图（未质检/已通过/已打回/最近提交）全部**只读**，点击小图打开大图。
- **大图（lightbox）进入编辑态**（针对未质检、已打回），顶部出现编辑工具栏：
  - 「画框」按钮：拖拽画新矩形框。
  - 分类下拉：选中框时改其分类。
  - 「删除框」：删除选中框。
  - 「保存」：整体保存该图 boxes，成功后**关闭大图 + 刷新当前页签数据**。
  - 「关闭」：关闭大图。
- **画框流程**：点「画框」→ 拖拽绘制虚线预览 → 松手弹出「选择分类」弹窗 → 确定后新框加入并选中（分类赋值），随后点「保存」生效。
- **命中容错**：提高四角手柄半径，并支持「框边线外扩命中」，细框也能轻松点中。
- **已通过 / 最近提交** 大图保持**只读**（不显示编辑工具栏），左键单击关闭。

## 3. 架构与技术方案

沿用「本地 Python 代理 + 前端 canvas 覆盖层」。后端仅新增一处小修正（见 3.1）。

### 3.1 后端（dashboard.py）

**修正已打回编辑后的状态显示**：保存标注后平台把该图重置为 pending，但本地 `_RECENT_GROUPS` 里可能残留该图的历史 verdict（最近打回的记录），会让 `qc_counts`/`qc_assigned` 继续把它当 rejected，导致「已打回」列表不消失。

在 `qc_save()` 保存成功后，清除 `_RECENT_GROUPS` 中该 `image_id` 的 verdict 记录：

```python
if s == 200 and d.get("ok"):
    _CACHE.clear()
    # 该图已被改回 pending，清除本地最近提交里对它的状态纠正
    for g in _RECENT_GROUPS:
        if g.get("pid") == pid and (g.get("verdicts") or {}).pop(image_id, None) is not None:
            pass
    _save_recent_groups()
    return {"ok": True, "box_count": d.get("box_count", len(boxes))}
```

（`qc_save` 需能访问 `pid`；路由里已有 pid 参数。）

### 3.2 前端（qc.html / qc.js / qc.css）

#### 结构调整
- 删除顶栏「框编辑」开关按钮（`qcEditToggle`）及其逻辑。
- 删除旧浮动编辑面板 `editPanel`。
- 大图 `lightbox` 内新增顶部工具栏 `lightboxBar`（画框、分类下拉、删除、保存、关闭）。
- 新增「选择分类」弹窗 `catPicker`（画框后弹出）。

#### createViewer 重构为 options 参数
`createViewer(container, imageUrl, boxes, opts)`，`opts` 字段：
- `onOpen`：只读态单击打开（关闭）大图。
- `zoomable`：是否可缩放（browse 小图传 false）。
- `editable`：编辑态。
- `onSelect(index)`：选中框回调。
- `onDeselect()`：取消选中回调。
- `onBoxesChange()`：框增删后回调（更新工具栏）。
- `onBoxDrawn(bbox)`：画框完成回调（弹分类选择）。
- `onEmptyClick()`：编辑态点击空白回调（关闭大图）。

编辑态核心逻辑：
- `hitTest` 提高容错：手柄半径 12px；框边线外扩 8px 内也算命中（细框友好）。
- 选中/移动/四角缩放逻辑沿用 v1（clamp [0,1]、MIN_BOX 0.01）。
- 新增 `drawMode`：开启后左键拖拽绘制虚线矩形，松手若尺寸够大回调 `onBoxDrawn`，退出画框模式。
- `drawOverlay` 绘制选中框加粗 + 手柄；画框模式绘制虚线预览矩形。

#### 大图 openLightbox 改造
`openLightbox(id, boxes, editable)`：
- 大图 viewer 用 `editable` 创建；`editable` 为真时挂编辑工具栏，否则隐藏。
- 编辑态：`onEmptyClick`/「关闭」→ 关闭；`onSelect`/`onDeselect`/`onBoxesChange` 更新工具栏；`onBoxDrawn` 弹分类选择。
- 保存成功后：关闭大图 → `loadCounts()` + `loadCurrentTab()`（未质检/已打回刷新，已打回图会消失）。

#### 调用点调整
- `makeCell`（未质检）：`createViewer(..., { onOpen: openLightbox(id,boxes,true), zoomable:true })`。
- `makeBrowseCell`（已通过/已打回）：`createViewer(..., { onOpen: openLightbox(id,boxes, state.tab==='rejected'), zoomable:false })`。
- `makeRecentCell`（最近提交）：`createViewer(..., { onOpen: openLightbox(id,boxes,false), zoomable:false })`。

#### 画框后分类弹窗
- `onBoxDrawn(bbox)` → 弹出 `catPicker`（分类下拉）。
- 确定：`boxes.push({category, bbox, source:'manual'})`，`viewerApi.setSelected(newIndex)`，更新工具栏，关闭弹窗。
- 取消：丢弃新框。

## 4. 受影响文件

| 文件 | 改动类型 | 位置/函数 |
|------|---------|----------|
| `dashboard.py` | 修改 | `qc_save()` 保存成功后清除 recent verdicts |
| `static/qc.html` | 修改 | 删 `qcEditToggle`、`editPanel`；lightbox 内加 `lightboxBar`；新增 `catPicker` |
| `static/qc.js` | 修改 | `createViewer` 重构为 opts；`openLightbox` 改造；删除 `toggleEditMode`/旧面板逻辑；新增画框、分类弹窗、工具栏逻辑；调用点调整 |
| `static/qc.css` | 修改 | `lightboxBar`、`catPicker` 样式；删除旧编辑面板样式（可保留复用） |

## 5. 实现细节

### 5.1 createViewer 签名与编辑核心（伪代码）

```js
function createViewer(container, imageUrl, boxes, opts) {
  opts = opts || {};
  const onOpen = opts.onOpen, zoomable = opts.zoomable, editable = opts.editable;
  // ... stage/img/overlay、scale/tx/ty、naturalW/H ...
  let selectedIndex = -1, boxDrag = null, drawMode = false, drawRect = null;

  function hitTest(mx, my) {
    const H = 12, TOL = 8;   // 手柄半径、边线容错
    for (let i = boxes.length - 1; i >= 0; i--) {
      const r = boxScreenRect(boxes[i]);
      const cx = [[r.x,r.y],[r.x+r.w,r.y],[r.x,r.y+r.h],[r.x+r.w,r.y+r.h]];
      for (let c=0;c<4;c++) if (near(cx[c], mx, my, H)) return {type:'handle',index:i,corner:c};
      const inX = mx>=r.x && mx<=r.x+r.w, inY = my>=r.y && my<=r.y+r.h;
      const inGutter = mx>=r.x-TOL && mx<=r.x+r.w+TOL && my>=r.y-TOL && my<=r.y+r.h+TOL;
      const onEdge = Math.abs(mx-r.x)<=TOL || Math.abs(mx-(r.x+r.w))<=TOL
                  || Math.abs(my-r.y)<=TOL || Math.abs(my-(r.y+r.h))<=TOL;
      if ((inX&&inY) || (inGutter&&onEdge)) return {type:'box',index:i};
    }
    return null;
  }
  // 选中回调、画框回调、拖动逻辑（move/resize 沿用 v1）
  // drawMode：mousedown 记录 drawRect 起点；mousemove 更新；mouseup 尺寸够大则 onBoxDrawn(norm rect)
}
```

### 5.2 工具栏与弹窗交互

- 选中框 → `onSelect(index)`：填充分类下拉当前值、启用删除/保存。
- 取消选中 → `onDeselect()`：禁用删除/保存、清空下拉。
- 删除 → `boxes.splice(index,1)` → `onBoxesChange()`。
- 保存 → POST `/api/qc/save` → 成功关闭大图 + 刷新。
- 画框完成 → 弹 `catPicker` → 确定 push 新框并选中。

## 6. 边界条件与异常处理

- **整体替换语义**：保存始终回传当前完整 boxes；画框/删除都在同一内存数组上操作。
- **坐标越界**：移动/缩放/画框 clamp 到 [0,1]，最小框 0.01。
- **画框过小**：松手时若归一化宽高 < 0.01，视为无效，丢弃并提示。
- **未选中保存**：保存按钮无选中框时禁用（但画框后会自动选中新框，保存可用）。
- **已打回保存后消失**：后端清除 recent verdicts 后，`qc_assigned('rejected')` 不再返回该图。
- **编辑态点击空白**：`onEmptyClick` 关闭大图（符合用户「左键单击关闭」习惯）；点击框则选中，不关闭。
- **只读大图**（已通过/最近提交）：不挂工具栏，单击关闭。
- **source 保留**：编辑/移动/缩放只改 category/bbox；新画框 source='manual'。
- **保存失败**：toast 报错，不关闭大图，允许重试。

## 7. 数据流路径

```
用户点开小图（未质检/已打回）
  → openLightbox(id, boxes, editable=true) 创建编辑态大图
  → 选中框改分类 / 拖动移动缩放 / 点「画框」拖拽 → 弹分类选择确定
  → 点「保存」
  → POST /api/qc/save {pid, image_id, boxes}
  → qc_save() 转发平台 /save，成功后清 recent verdicts + _CACHE
  → 前端关闭大图 → loadCounts() + loadCurrentTab()
  → 未质检：该图仍在待质检区（框已更新）；已打回：该图从列表消失（状态变 pending）
```

## 8. 预期结果

- 网格小图全部只读，点击打开大图。
- 未质检/已打回的大图出现编辑工具栏：选中、拖动、缩放、改分类、画框、删除、保存、关闭。
- 细框通过边线容错 + 手柄半径提高，可轻松点中。
- 画框后弹分类选择，赋值后保存生效。
- 保存成功自动关闭大图并刷新；已打回图编辑保存后从列表消失（转未质检）。
- 已通过/最近提交大图仍只读，左键单击关闭。
