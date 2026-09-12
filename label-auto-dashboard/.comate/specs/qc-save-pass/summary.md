# 保存即通过 & 工具栏 UI 重构 总结（qc-save-pass）

## 完成内容

### 保存语义（核心）
`openLightbox(id, boxes, source)` 按来源页签区分保存行为：

- **未质检（pending）**：保存 = `/api/qc/save`（改框）+ `/api/qc/submit`（verdict=pass）→ 既改框又通过，进入最近提交，关闭大图并刷新未质检四张。
- **已打回（rejected）**：保存 = 只 `/api/qc/save` → 平台自动回 pending，关闭大图刷新，该图从已打回消失。
- **已通过 / 最近提交**：只读大图，左键单击关闭。

调用点：
- `makeCell` → `'pending'`
- `makeBrowseCell` → `state.tab`（'passed'/'rejected'）
- `makeRecentCell` → `'recent'`

### 工具栏 UI
- 重构 `lightboxBar`：左组（画框/分类）、中间提示、右组（删除/保存/关闭）。
- 深色半透明底 + 分组 + 统一间距。
- 保存按钮显式绿色 `lb-primary`，禁用态灰字灰底。

### bug 修复
「保存」文字白字白底问题根因是 `.lightbox-bar .btn { background:#fff }` 覆盖了 primary 蓝色背景、而 `.btn.primary` 白字还在。已用独立 `.lb-btn`/`.lb-primary` 类重做，不再被误伤。

## 验证
- `node --check qc.js`、`py_compile dashboard.py` 均通过。
- 后端无改动（复用 `/api/qc/save`、`/api/qc/submit`）。
- 按用户约定未自行启动服务，用户需自行启动后 Ctrl+F5 刷新验证。
