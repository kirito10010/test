# 看板批量打回功能 · 完成总结

## 结论先行

**owner（于荣华 admin）账号可以通过 API 执行打回操作**——前端只是把按钮藏了，后端接口是放行的（实测 `POST /api/projects/{id}/qc` 返回 `{"ok":true}`）。因此看板走 API 即可给 owner 提供批量打回能力。

## 交付改动

| 文件 | 改动 |
|---|---|
| `dashboard.py` | 新增 `POST /api/projects/{id}/batch_qc` 端点（循环调平台 `/qc`，汇总成功/失败，写后清缓存） |
| `static/index.html` | 标签巡检结果表加复选框列（表头全选）+「批量打回」按钮 |
| `static/app.js` | 全选/勾选计数、批量打回逻辑（确认弹窗 → 调接口 → 刷新） |
| `static/style.css` | 复选框列宽、danger 按钮样式 |

## 验证结果

- 后端语法检查通过，`app.js` 语法检查通过。
- 空 `image_ids` → 返回 `image_ids 为空`。
- 非法 `verdict` → 返回 `verdict 只能是 reject 或 pass`。
- 对一张已 passed 图提交 pass（无副作用）→ `{"ok":true,"total":1,"succeeded":1,"failed":[]}`。
- 前端元素确认存在（`querySelectAll`、`batchRejectBtn`）。

## 使用方式

「标签巡检」筛出「前挡玻璃遮挡」→ 勾选多张（或表头全选）→ 点「批量打回」→ 确认 → 这些图 qc_status 变为 rejected，结果自动刷新。

## 备注

- 实测过程中为不污染生产数据，未对真实图片执行打回，只用了「对已通过图重复 pass」做无副作用验证；真实的打回由你在看板里勾选执行。
- 清理了上一轮残留的 Python 进程（旧服务占 8090 端口导致新代码不生效），现已正常。
