# Label Auto 外接看板 · 完成总结

## 交付内容

在 `d:\Project\test\label-auto-dashboard\` 下交付一个零依赖的本地看板：

| 文件 | 说明 |
|------|------|
| `dashboard.py` | 本地服务（Python 标准库），代理 Label Auto API + 数据解析 |
| `static/index.html` | 单页结构 |
| `static/app.js` | 前端逻辑 |
| `static/style.css` | 样式 |
| `启动看板.bat` | 双击启动 |
| `README.md` | 使用说明 |

## 已实现功能

1. **登录**：默认预填 owner 账号，显示当前角色。
2. **标签巡检器**：按标签名查命中图（文件名、框坐标、qc_status、质检员），可按状态/质检员筛选，一键导出 CSV。
3. **漏标告警**：扫出「已通过(passed)但仍带异常标签」的图。
4. **质检进度看板**：项目进度、质检员通过/打回、标注员合格率。
5. **标签分布**：各分类框数量横向条形图。
6. **图片预览**：点击图片放大并叠加标注框（按分类着色）。
7. **一键导出**：全量 / 仅通过 / YOLO 三种模式。

## 验证结果（端到端）

- 静态页 `http://127.0.0.1:8090/` → 200
- 登录 owner → `ok:true`，角色 admin
- `query?cat=前挡玻璃遮挡` → 命中图列表正确，归属质检员（李劲/王哲）正确
- `distribution` → 20 类计数正确（前挡玻璃遮挡=204 框）
- `monitoring` → 5 个项目统计
- `leak` → 当前漏标图正确
- `image` / `annotation` 代理 → 图片二进制、归一化标注正常

## 关键实现要点

- 分类编号 1-based（导出）→ categories 0-based 的转换已封装。
- `qc_assignments` 交叉出质检员归属；`images` 交叉出 qc_status。
- 导出结果 60s 内存缓存，避免重复拉大文件。
- 用 Python 标准库实现代理，绕过平台无 CORS 头的问题。

## 使用方式

双击 `启动看板.bat`，浏览器自动打开，用 owner 账号登录即可。
