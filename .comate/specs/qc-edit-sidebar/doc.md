# 质检大图编辑交互重构（左侧属性面板 + 常开画框）

## 背景与目标

当前大图编辑（`openLightbox`）的交互模型是「画框开关 + 分类下拉 + 拖角缩放 + 拖框移动」，存在两个核心问题：

1. 分类需要通过顶部下拉框选择，且每次画框后还会弹出一个 `catPicker` 模态框，操作繁琐、打断流程。
2. 画框需要先点「画框」开关；切换分类时若上一框仍处于选中态，容易被误改。

本次重构把编辑交互改为**类标注工具的标准交互**：

- 大图最左侧是**所有属性（分类）按钮**，点击即选中该属性，之后画出的所有框都自动带此属性。
- **取消「画框」开关**，画框永远开启：**鼠标左键按住拖动 = 画框**，**右键按住拖动 = 平移照片**（沿用现有）。
- **每画完一个框自动取消选中**，防止切换属性时误改上一个框。
- 删除：**双击框**删除，或**单击选中后按 Delete/Backspace** 删除。
- 修改：**单击框激活（选中）**，再**点左侧属性按钮**即改好，改完自动取消选中。
- 保存：**按 C 键**（同时保留左侧「保存」按钮），语义与现状一致。

## 关键设计决策（需确认）

- **移除「拖框移动 / 拖角缩放」**：新交互下左键拖动一律是「画新框」。若需要改框的几何位置/大小，用「双击删除 + 重新画」代替。这是对「左键按住拖动就是画」的直接实现，也是标注工具的常见做法。若你仍需要保留移动/缩放，请在此处提出，我再调整（例如改为按住 Alt 拖动移动、或拖动四角缩放）。
- **属性选择持久化**：左侧选中的属性（`activeCategory`）在画完一个框后**不会**取消，可连续画多个同属性框；「每画完一个取消选中」指的是**框的选中态**（高亮），不是属性。

## 架构与技术方案

纯前端改动，后端 `/api/qc/save`、`/api/qc/submit`、`/api/qc/annotation` 接口不变。

交互状态划分：
- `activeCategory`（模块级变量）：左侧当前选中的分类，用于新画框。
- `selectedIndex`（`createViewer` 内部）：当前高亮/激活的框，画完、改完、删除后都清为 `-1`。
- `lightboxSession`（模块级，不变）：`{ imageId, boxes, viewer, source, editable }`。

`createViewer` 的鼠标逻辑由「drawMode 门控 + boxDrag 移动/缩放」改为「左键按下记录起点 → 移动超阈值判定为画框 → 未超阈值判定为单击选中/取消选中」，并新增 `dblclick` 删除。

## 受影响文件

| 文件 | 修改类型 | 关键函数/区块 |
|---|---|---|
| `d:\Project\test\label-auto-dashboard\static\qc.html` | 修改 | 大图结构：删除 `lightboxBar`、`drawToggle`、`editCategory`、`catPicker`，新增左侧 `lightboxSidebar` + `lbCats` |
| `d:\Project\test\label-auto-dashboard\static\qc.js` | 修改 | `createViewer`（鼠标/双击逻辑）、`openLightbox`、`onBoxSelect/onBoxDeselect`、`clickCategory`、`renderCategoryButtons`、`deleteBoxAt`、`saveLightbox`、新增大图快捷键处理；删除 `fillCategorySelect`、`openCatPicker`、`drawToggle`/`editCategory` 相关 |
| `d:\Project\test\label-auto-dashboard\static\qc.css` | 修改 | `.lightbox` 改横向布局，新增 `.lightbox-sidebar`、`.lb-cats`、`.cat-btn` 样式 |

## 实现细节

### 1. HTML：大图结构（`qc.html` 52–88 行区块替换）

```html
<div id="lightbox" class="lightbox hidden">
  <div id="lightboxSidebar" class="lightbox-sidebar hidden">
    <div class="lb-cats" id="lbCats"></div>
    <div class="lb-hint">左键拖动画框 · 右键拖动平移 · 单击选中 · 双击删除 · C保存</div>
    <div class="lb-actions">
      <button id="editDelete" class="btn lb-btn lb-danger" disabled>删除框 (Del)</button>
      <button id="editSave" class="btn lb-btn lb-primary">保存 (C)</button>
      <button id="lightboxClose" class="btn lb-btn">关闭</button>
    </div>
  </div>
  <div id="lightboxViewer" class="viewer full"></div>
</div>
```

删除原 `catPicker` 模态框（71–88 行）与 `lightboxBar`（54–67 行）。

### 2. CSS：布局（`qc.css`）

- `.lightbox` 由 `flex-direction: column` 改为 `row`，使侧栏在左、查看器在右。
- 新增：

```css
.lightbox-sidebar {
  flex: none; width: 200px; display: flex; flex-direction: column;
  gap: 12px; padding: 14px;
  background: rgba(24,28,36,0.95);
  border-right: 1px solid rgba(255,255,255,0.08);
  overflow-y: auto;
}
.lb-cats { display: flex; flex-direction: column; gap: 8px; }
.cat-btn {
  padding: 9px 10px; border-radius: 6px; font-size: 13px;
  background: rgba(255,255,255,0.1); color: #e5e9ef;
  border: 1px solid rgba(255,255,255,0.18); cursor: pointer; text-align: left;
}
.cat-btn:hover { background: rgba(255,255,255,0.2); }
.cat-btn.active { background: #2b6de8; color: #fff; border-color: #2b6de8; }
.lb-actions { display: flex; flex-direction: column; gap: 8px; margin-top: auto; }
```

### 3. `createViewer` 鼠标/双击逻辑重构（`qc.js`）

- 删除 `drawMode`、`setDrawMode`、`boxDrag` 及 `hitTest` 中的 `handle` 分支、`drawOverlay` 中的四角手柄绘制。
- `mousedown`（左键、editable）只记录起点：

```js
} else if (e.button === 0 && editable) {
  drawStart = { mx, my, started: false };
  drawRect = null;
  e.preventDefault();
}
```

- `mousemove` 中 `drawStart` 分支增加「超阈值才判定为画框」：

```js
} else if (drawStart) {
  const rect = viewer.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  if (!drawStart.started) {
    if (Math.abs(mx - drawStart.mx) < 3 && Math.abs(my - drawStart.my) < 3) return;
    drawStart.started = true;
  }
  const a = toNorm(drawStart.mx, drawStart.my);
  const b = toNorm(mx, my);
  if (!a || !b) return;
  drawRect = { x1: clamp(Math.min(a.x,b.x),0,1), y1: clamp(Math.min(a.y,b.y),0,1),
               x2: clamp(Math.max(a.x,b.x),0,1), y2: clamp(Math.max(a.y,b.y),0,1) };
  apply();
}
```

- `mouseup` 区分「画框 / 太小的拖动 / 单击」：

```js
window.addEventListener('mouseup', (e) => {
  drag = null;
  if (drawStart) {
    const rect = viewer.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const valid = drawRect && (drawRect.x2-drawRect.x1) >= MIN_BOX && (drawRect.y2-drawRect.y1) >= MIN_BOX;
    if (drawStart.started && valid) {
      const box = { x1: drawRect.x1, y1: drawRect.y1, x2: drawRect.x2, y2: drawRect.y2 };
      drawStart = null; drawRect = null; apply();
      if (onBoxDrawn) onBoxDrawn(box);
    } else if (drawStart.started) {
      drawStart = null; drawRect = null; apply(); setSelected(-1);
    } else {
      drawStart = null; drawRect = null; apply();
      const hit = hitTest(mx, my);
      if (hit) setSelected(hit.index); else setSelected(-1);
    }
  }
});
```

- `hitTest` 仅返回 `{ type:'box', index }` 或 `null`（删除 handle 检测）。
- 新增双击删除（`dblclick`，仅 editable）：

```js
if (editable) {
  viewer.addEventListener('dblclick', (e) => {
    const rect = viewer.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const hit = hitTest(mx, my);
    if (hit) onDelete && onDelete(hit.index);
  });
}
```

- 新增 `onDelete` 回调到 `viewerApi`/`opts`。

### 4. `openLightbox` 重写（`qc.js`）

```js
function openLightbox(id, boxes, source) {
  const editable = (source === 'pending' || source === 'rejected');
  $('lightbox').classList.remove('hidden');
  const v = $('lightboxViewer');
  v.innerHTML = '';
  if (editable) {
    $('lightboxSidebar').classList.remove('hidden');
    renderCategoryButtons();
    if (!activeCategory) activeCategory = (state.categories && state.categories[0]) || null;
    highlightActiveCategory();
    $('editDelete').disabled = true;
    $('editSave').disabled = false;
    toast('左键拖动画框 · 右键拖动平移 · 单击选中 · 双击删除 · C保存');
  } else {
    $('lightboxSidebar').classList.add('hidden');
  }
  const viewer = createViewer(v, imageUrl(id), boxes, {
    editable,
    onOpen: () => closeLightbox(),
    onSelect: onBoxSelect,
    onDeselect: onBoxDeselect,
    onBoxDrawn: (bbox) => {
      const cat = activeCategory || (state.categories && state.categories[0]);
      if (!cat) { toast('请先在左侧选择属性'); return; }
      boxes.push({ category: cat, bbox, source: 'manual' });
      viewer.redraw();
      viewer.setSelected(-1);            // 每画完一个取消选中
      toast('已添加框（未保存）');
    },
    onDelete: deleteBoxAt,
  });
  lightboxSession = { imageId: id, boxes, viewer, source, editable };
  const name = document.createElement('div');
  name.className = 'photo-name';
  name.textContent = id;
  viewer.el.appendChild(name);
}
```

### 5. 左侧属性按钮与修改（`qc.js`）

模块级 `let activeCategory = null;`

```js
function renderCategoryButtons() {
  const wrap = $('lbCats');
  wrap.innerHTML = '';
  (state.categories || []).forEach((c) => {
    const b = document.createElement('button');
    b.className = 'cat-btn';
    b.textContent = c;
    b.onclick = () => clickCategory(c);
    wrap.appendChild(b);
  });
  highlightActiveCategory();
}
function highlightActiveCategory() {
  Array.from($('lbCats').querySelectorAll('.cat-btn')).forEach((b) =>
    b.classList.toggle('active', b.textContent === activeCategory));
}
function clickCategory(cat) {
  activeCategory = cat;
  highlightActiveCategory();
  if (!lightboxSession) return;
  const idx = lightboxSession.viewer.getSelected();
  if (idx >= 0 && lightboxSession.boxes[idx]) {
    lightboxSession.boxes[idx].category = cat;
    lightboxSession.viewer.redraw();
    lightboxSession.viewer.setSelected(-1);   // 改完一次取消选中
    toast('已修改分类为 ' + cat + '（未保存）');
  }
}
```

### 6. 选中/取消选中回调（`qc.js`）

```js
function onBoxSelect() { $('editDelete').disabled = false; }
function onBoxDeselect() { $('editDelete').disabled = true; }
```

### 7. 删除（`qc.js`）

```js
function deleteBoxAt(idx) {
  if (!lightboxSession || idx < 0 || !lightboxSession.boxes[idx]) return;
  lightboxSession.boxes.splice(idx, 1);
  lightboxSession.viewer.setSelected(-1);
  lightboxSession.viewer.redraw();
  toast('已删除框（未保存）');
}
$('editDelete').onclick = () => {
  if (lightboxSession) deleteBoxAt(lightboxSession.viewer.getSelected());
};
```

### 8. 保存（`qc.js`）

把原 `$('editSave').onclick = async () => {...}` 抽取为 `saveLightbox()`，按钮与 C 键共用；语义不变（`source==='pending'` 时保存并质检通过，`source==='rejected'` 时仅保存回未质检；关闭大图并刷新）。

### 9. 大图快捷键（`qc.js`）

现有全局 `keydown` 在大图打开时直接 `return`，因此新增独立监听：

```js
document.addEventListener('keydown', (e) => {
  if ($('lightbox').classList.contains('hidden')) return;
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (lightboxSession) deleteBoxAt(lightboxSession.viewer.getSelected());
    e.preventDefault();
  } else if ((e.key || '').toLowerCase() === 'c') {
    saveLightbox(); e.preventDefault();
  } else if (e.key === 'Escape') {
    closeLightbox(); e.preventDefault();
  }
});
```

### 10. 清理

删除 `fillCategorySelect`、`openCatPicker`、`pendingNewBox`、`$('drawToggle').onclick`、`$('editCategory').onchange`、`$('catPickerClose/Cancel/Ok').onclick`、`onEmptyClick` 相关引用。

## 边界条件与异常处理

- **未选属性就画框**：`activeCategory` 默认取第一个分类；若分类列表为空则 `toast('请先在左侧选择属性')` 且不 push 框。
- **拖动距离太小**（< 3px）：判定为单击而非画框，走「选中/取消选中」。
- **画框尺寸 < MIN_BOX**：`mouseup` 判定为无效拖动，取消选中、不 commit。
- **双击空白处**：`hitTest` 返回 `null`，不触发删除。
- **Delete 键无选中框**：`deleteBoxAt(-1)` 直接 `return`。
- **C 键 / Escape 在设置框或输入框内**：被 `tag`/修饰键判断拦截。
- **非编辑态（已通过/最近提交）**：侧栏隐藏，无画框/删除/修改能力，仅查看、关闭。

## 数据流

1. 打开大图 → `openLightbox` → `renderCategoryButtons` 生成属性按钮，`activeCategory` 默认首个。
2. 左键拖动 → `createViewer` 产生归一化 bbox → `onBoxDrawn` → `boxes.push({category:activeCategory, bbox, source:'manual'})` → 自动取消选中。
3. 单击框 → `setSelected(i)` → `onBoxSelect` 启用删除按钮；点属性按钮 → `clickCategory` 改 `boxes[i].category` → 自动取消选中。
4. 双击框 / Delete → `deleteBoxAt` → `boxes.splice` → 自动取消选中。
5. C 键 / 保存按钮 → `saveLightbox` → `POST /api/qc/save`（整表替换 boxes）→ 若 `pending` 再 `POST /api/qc/submit`（pass）→ 关闭大图、重置分页、刷新计数与列表。

## 预期结果

- 左侧为属性按钮面板，点击高亮即生效，画出的框自动带该属性；画完/改完/删完均自动取消框选中，杜绝误改。
- 无「画框」开关：左键拖动即画、右键拖动即平移、单击即选中、双击即删除、C 即保存。
- 保存语义不变：未质检=保存并质检通过；已打回=仅保存回到未质检。
