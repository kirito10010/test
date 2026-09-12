# 质检平台：保存即通过 & 工具栏 UI 重构（qc-save-pass）

## 1. 需求

### 1.1 保存语义（核心变更）

用户点开一张照片既能看又能改，改完点「保存」。期望按来源页签区分行为：

- **未质检（pending）页签**点开编辑后保存：
  - 同时完成「保存框 + 质检通过（pass）」。
  - 自动关闭大图，重新获取未质检的四张（该图已通过，不再出现）。
  - 该图进入「最近提交」（12 张最新提交里能看到它）。
- **已打回（rejected）页签**点开编辑后保存：
  - 只保存框（平台会把 qc_status 重置为 pending，即「回到质检状态」）。
  - 自动关闭大图，重新获取已打回数据（该图从已打回列表消失）。

已通过 / 最近提交 大图仍只读，无保存。

### 1.2 工具栏 UI 优化

大图顶部工具栏（`lightboxBar`）现在很难看，重做：深色半透明底、分组布局、间距统一、主次按钮分明、提示文案可读。

### 1.3 保存按钮「保存」文字不显示的 bug

**根因**：`qc.css` 里 `.lightbox-bar .btn { background: #fff; }` 的特异性与 `.btn.primary` 相同但源码位置更靠后，把 primary 按钮的蓝色背景覆盖成了白色；而 `.btn.primary { color: #fff; }` 的白色文字还在 → **白字配白底，文字看不见**。

修复：重做工具栏样式时，为 primary 按钮写显式规则（背景/文字/禁用态都明确），不再被 `.lightbox-bar .btn` 误伤。

## 2. 技术方案

### 2.1 后端（dashboard.py）

**无需改动**。复用现有两个路由：

- `POST /api/qc/save`：保存框（整体替换），成功后清 recent verdicts。
- `POST /api/qc/submit`：提交 verdict（pass/reject），成功后记入 `_RECENT_GROUPS`（最近提交）。

前端按来源决定调用顺序：
- pending：先 `/api/qc/save`，再 `/api/qc/submit`（verdict=pass）→ 既保存又通过，且进入最近提交。
- rejected：只 `/api/qc/save`（平台自动回 pending）。

### 2.2 前端（qc.js / qc.html / qc.css）

#### openLightbox 增加来源参数
`openLightbox(id, boxes, source)`，`source ∈ {pending, passed, rejected, recent}`：
- `editable = (source === 'pending' || source === 'rejected')`。
- `lightboxSession` 记录 `source`。

调用点改为传 source：
- `makeCell`（未质检）：`openLightbox(id, boxes, 'pending')`
- `makeBrowseCell`（已通过/已打回）：`openLightbox(id, boxes, state.tab)`（tab 即 'passed'/'rejected'）
- `makeRecentCell`（最近提交）：`openLightbox(id, boxes, 'recent')`

#### editSave 保存逻辑
```js
$('editSave').onclick = async () => {
  const { imageId, boxes, source } = lightboxSession;
  const r = await api('/api/qc/save', { body: { pid, image_id, boxes } });
  if (!r || !r.ok) { toast(r.error || '保存失败'); return; }
  if (source === 'pending') {
    const p = await api('/api/qc/submit', { body: { pid, uid, verdicts:[{image_id, verdict:'pass'}] } });
    // p.ok 且 succeeded>0 → 已保存并通过；否则提示
  }
  closeLightbox();
  loadCounts();
  loadCurrentTab();
};
```

#### 工具栏 UI（qc.html + qc.css）
重构 `lightboxBar` 结构：
- 左侧：画框按钮（toggle）、分类下拉。
- 右侧：删除框、保存（primary，绿色）、关闭。
- 中间：提示文案。
- 保存按钮 primary 用显式样式（绿色背景 + 白字 + 禁用灰），彻底解决白字白底 bug。

## 3. 受影响文件

| 文件 | 改动 |
|------|------|
| `static/qc.js` | `openLightbox` 加 source 参数；`editSave` 按 source 决定是否 pass；三个调用点传 source |
| `static/qc.html` | `lightboxBar` 结构重构（画框/分类 | 提示 | 删除/保存/关闭） |
| `static/qc.css` | 工具栏样式重做；修复 primary 按钮被覆盖的 bug |

## 4. 边界与异常

- **pending 保存 = 保存 + pass**：两步都成功才算完整；若 save 成功但 submit 失败，toast 提示「已保存但通过失败」，不关闭大图，允许重试。
- **rejected 保存**：只 save，平台自动回 pending，刷新后从已打回消失。
- **保存失败**：toast 报错，不关闭大图。
- **只读大图**（passed/recent）：无工具栏，左键单击关闭（沿用现有 `onOpen: closeLightbox`）。
- **最近提交去重**：`/api/qc/submit` 记录到 `_RECENT_GROUPS`，`qc_recent` 已按 pid+uid 过滤并取最新 12 张。

## 5. 预期结果

- 未质检改框点保存 → 框已改 + 已通过，大图关闭，未质检刷新，该图出现在最近提交。
- 已打回改框点保存 → 框已改，大图关闭，已打回刷新，该图消失（转未质检）。
- 工具栏 UI 清爽、保存按钮文字始终可见。
