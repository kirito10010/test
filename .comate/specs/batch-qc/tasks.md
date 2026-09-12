# 看板批量打回功能 · 任务计划

- [x] Task 1: 后端新增批量打回端点
    - 1.1: 在 `dashboard.py` 新增 `POST /api/projects/{id}/batch_qc` 路由
    - 1.2: 解析入参 `{image_ids, verdict, reason}` 并做基本校验（非空、verdict 合法）
    - 1.3: 循环调用平台 `POST /api/projects/{id}/qc`，汇总 succeeded / failed
    - 1.4: 打回后清除该项目 images / export 缓存，保证下次查询是打回后的新状态
    - 1.5: 返回 `{ok, total, succeeded, failed}`，单个失败不影响整体

- [x] Task 2: 前端结果表加多选与批量打回按钮
    - 2.1: `index.html` 结果表加复选框列（表头全选），加「批量打回」按钮
    - 2.2: `app.js` 实现全选/取消全选、勾选计数
    - 2.3: 实现批量打回：收集选中 image_id → 确认弹窗 → 调 batch_qc → 显示结果 → 刷新
    - 2.4: `style.css` 补充复选框与按钮样式

- [x] Task 3: 端到端验证
    - 3.1: 筛选「前挡玻璃遮挡」→ 勾选多张 → 批量打回 → 验证 qc_status 变为 rejected
    - 3.2: 验证边界：未勾选提示、部分失败提示、打回后缓存刷新
