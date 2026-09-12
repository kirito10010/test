# 看板批量打回功能（batch-qc）

## 1. 需求

在「标签巡检」结果列表中，支持**多选图片**并**一键批量打回（reject）**。典型场景：筛出「前挡玻璃遮挡」的图 → 全选 → 批量打回。

## 2. 现状与依据

- 平台打回接口：`POST /api/projects/{id}/qc`，body `{"image_id": "...jpg", "verdict": "reject", "reason": ""}`。
- 已实测：owner（于荣华 admin）账号调用该接口返回 `{"ok": true, ...}`，即**后端放行 owner 打回**（前端只是把按钮藏了）。
- 接口一次只能处理一张图 → 批量 = 循环调用。

## 3. 实现方案

### 后端（dashboard.py）
新增端点 `POST /api/projects/{id}/batch_qc`：
- 入参 `{"image_ids": ["a.jpg","b.jpg"], "verdict": "reject", "reason": ""}`
- 循环对每个 image_id 调 `POST /api/projects/{id}/qc`
- 返回 `{"ok": true, "total": N, "succeeded": M, "failed": [{image_id, error}]}`
- 单个失败不影响整体（记入 failed 列表）
- 调用后清空该项目相关缓存（images / export），保证下次查询是打回后的新状态

### 前端（index.html / app.js / style.css）
- 「标签巡检」结果表加**复选框列**（含表头「全选」）
- 加「批量打回」按钮：收集勾选的 image_id → confirm 确认 → 调 batch_qc → 显示成功/失败数 → 自动刷新结果
- 结果表头部显示已勾选数量

## 4. 边界与异常

- 未勾选任何图 → 提示「请先勾选」
- 对已打回(rejected)的图再打回 → 后端按平台返回计为 failed（或忽略），不影响其它
- 部分失败 → 提示「成功 M 张，失败 K 张」并列出失败原因
- 确认弹窗写清「将打回 N 张图」，防止误操作

## 5. 文件清单

| 文件 | 改动 |
|---|---|
| `dashboard.py` | 新增 `/api/projects/{id}/batch_qc` 端点 |
| `static/index.html` | 结果表加复选框列 + 批量打回按钮 |
| `static/app.js` | 全选/多选/批量打回逻辑 |
| `static/style.css` | 复选框与按钮样式 |

## 6. 预期结果

在「标签巡检」筛出「前挡玻璃遮挡」→ 全选 → 点「批量打回」→ 这些图的 qc_status 变为 rejected（打回），结果列表随之刷新。
