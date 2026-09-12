# 看板 · 恢复任务归属 实施任务

- [x] Task 1: index.html 新增「归属修复」页签
    - 1.1: `#tabs` 加 `<button data-tab="fix">归属修复</button>`
    - 1.2: 新增 `<section id="tab-fix">`（质检员下拉 + 按钮 + 结果）

- [x] Task 2: app.js 接入归属修复逻辑
    - 2.1: `state.qcReviewers = []`
    - 2.2: `loadMonitoring` 里收集当前项目 `qc_assignees`（uid+name）
    - 2.3: 新增 `renderFixOwner()` 填下拉
    - 2.4: 新增 `doFix()` 调 `/api/qc/fix` 并显示结果
    - 2.5: 绑定 `#fixBtn` 点击
    - 2.6: `node --check` 校验

- [x] Task 3: 重新打包并验证
    - 3.1: 结束运行中的 dashboard 进程
    - 3.2: `python -m PyInstaller --clean --noconfirm label-auto-dashboard.spec`
    - 3.3: 确认 `dist/label-auto-dashboard.exe` 生成
