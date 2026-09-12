# 看板 · 恢复任务归属 完成总结

## 目标
在外接看板（`/`）新增「归属修复」页签，选择质检员后一键恢复其名下已通过/已打回图的归属（用质检员本人 token 重放 verdict）。

## 完成内容
- `index.html`：`#tabs` 新增「归属修复」页签按钮；新增 `#tab-fix` 面板（质检员下拉 + 按钮 + 结果区）。
- `app.js`：
  - `state.qcReviewers` 保存当前项目的 `qc_assignees`（uid+name）。
  - `loadMonitoring` 时填充 `qcReviewers` 并调用 `renderFixOwner`。
  - 新增 `renderFixOwner()` / `doFix()`；`doFix` 调 POST `/api/qc/fix` 并显示 total/succeeded/failed。
  - 绑定 `#fixBtn`。

## 验证
- `app.js` `node --check` 通过。
- PyInstaller 打包成功，`dist/label-auto-dashboard.exe` 生成。

## 待用户确认
- 看板顶部出现「归属修复」页签。
- 选项目 + 选质检员后点「恢复任务归属」，能显示处理数量。
