# 保存即通过 & 工具栏 UI 重构实施任务（qc-save-pass）

- [x] Task 1: openLightbox 增加来源参数并改造保存逻辑
    - 1.1: `openLightbox(id, boxes, source)`，按 source 计算 editable 并记录到 lightboxSession
    - 1.2: `makeCell` 传 `'pending'`
    - 1.3: `makeBrowseCell` 传 `state.tab`（'passed'/'rejected'）
    - 1.4: `makeRecentCell` 传 `'recent'`
    - 1.5: `editSave` 保存后按 source==='pending' 追加 `/api/qc/submit`（verdict=pass）
    - 1.6: pending 保存失败（save 成功但 pass 失败）时不关闭大图并提示，允许重试

- [x] Task 2: 工具栏 UI 重构
    - 2.1: `qc.html` 重构 `lightboxBar` 结构（左：画框/分类，中：提示，右：删除/保存/关闭）
    - 2.2: `qc.css` 重做工具栏样式（深色半透明底、分组、统一间距）
    - 2.3: 保存按钮显式绿色 primary 样式，修复白字白底 bug
    - 2.4: `node --check qc.js` 语法自检

- [x] Task 3: 联调与自检
    - 3.1: `node --check qc.js` 通过
    - 3.2: 验证未质检保存 = 保存框 + 通过 + 进最近提交 + 关闭刷新
    - 3.3: 验证已打回保存 = 只保存框 + 关闭刷新 + 列表消失
    - 3.4: 验证已通过/最近提交大图只读，左键关闭
    - 3.5: 验证保存按钮文字始终可见
