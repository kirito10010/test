# Label Auto 外接看板（label-auto-dashboard）

## 1. 需求背景

用户是 Label Auto 标注平台（`http://172.21.205.141:8771/`）的质检员/运营，需要一个**外接看板网站**，方便实时做这些事（现在都是手工或让 AI 临时查）：

1. 按标签名检索：某标签（如「前挡玻璃遮挡」）出现在哪些图、框坐标、当前质检状态、归属哪个质检员。
2. 漏标自动告警：已「质检通过(passed)」但仍带指定异常标签的图。
3. 质检进度/质量看板：各项目、各质检员的通过数/打回数/通过率/打回率。
4. 标签分布统计：每个项目各分类框的数量分布。
5. 图片预览：点开看图 + 框。
6. 一键批量导出。

**关键约束**：平台 API **没有返回 CORS 头**，纯浏览器跨域访问会被拦截 → 采用「本地 Python 服务代理」方案。

## 2. 架构与技术方案

- **本地服务**：Python 3.14 **标准库**（`http.server` + `urllib.request`），零第三方依赖，无需 pip install。
- 监听 `127.0.0.1:8090`，启动后自动打开浏览器到 `http://127.0.0.1:8090`。
- **前端**：单页应用，原生 HTML + CSS + JS（无框架），通过同源接口调用本地服务。
- **代理层**：本地服务把请求转发给 Label Auto API，解决 CORS。
- **认证**：在页面上用 owner 账号（`v_yuronghua@baidu.com`）登录，token 存在服务端内存，所有转发请求带 `Authorization: Bearer <token>`。

```
浏览器(127.0.0.1:8090)  →  本地服务 dashboard.py  →  Label Auto API(172.21.205.141:8771)
```

## 3. 功能清单

| # | 功能 | 交互 |
|---|------|------|
| 1 | 登录 | 页面顶部输入账号密码，默认预填 owner 账号；显示当前角色 |
| 2 | 标签巡检器 | 选项目 + 输入/选择标签名 → 列表展示命中图（文件名、框坐标、qc_status、质检员），可按状态/质检员筛选，一键导出 CSV |
| 3 | 漏标告警 | 选项目 + 配置「异常标签」集合 → 列出 `passed` 但仍带这些标签的图 |
| 4 | 质检进度看板 | 汇总各项目/各质检员：分配数、通过数、打回数、通过率、打回率、标注员 valid_rate |
| 5 | 标签分布 | 每个项目 20 类框的数量分布（横向条形图，纯 CSS/JS 绘制） |
| 6 | 图片预览 | 点击某图 → 加载图片 + 叠加框（标注类别着色） |
| 7 | 一键导出 | 按项目导出 全量/仅通过/ yolo，触发浏览器下载 |

## 4. 本地服务 API 设计（前端 ↔ dashboard.py）

| 本地端点 | 方法 | 说明 |
|---|---|---|
| `/api/login` | POST | 转发登录，保存 token |
| `/api/me` | GET | 当前用户信息 |
| `/api/projects` | GET | 项目列表（id/name/分类/统计），内部转调 Label Auto `/api/projects` |
| `/api/monitoring` | GET | 质检进度原始数据，内部转调 `/api/admin/monitoring` |
| `/api/projects/{id}/images` | GET | 图片列表（含 qc_status），转调 `/api/projects/{id}/images` |
| `/api/projects/{id}/labels` | GET | 导出并解析全部标注，内部转调 `/api/projects/{id}/export?format=json` |
| `/api/projects/{id}/query?cat=前挡玻璃遮挡` | GET | 标签巡检：命中图列表（文件名+框坐标+qc_status+质检员） |
| `/api/projects/{id}/leak?cats=a,b,c` | GET | 漏标：passed 且带异常标签的图 |
| `/api/projects/{id}/distribution` | GET | 各分类框数量分布 |
| `/api/projects/{id}/image?image_id=` | GET | 代理图片二进制 |
| `/api/projects/{id}/annotation?image_id=` | GET | 代理单图标注（预览用） |
| `/api/export/{id}?mode=passed\|full\|yolo` | GET | 代理导出下载 |

服务端对 `/api/projects/{id}/export` 结果做**内存缓存**（按项目 id，带 60s TTL），避免反复拉大文件。

## 5. 关键数据逻辑（易错点，实现时严格遵守）

1. **分类编号 1-based vs 0-based**：导出 `labels[].bboxes` 每框是 `[x,y,w,h,分类编号]`，`分类编号` 从 **1** 起；而项目 `categories` 数组从 **0** 起。转换：`分类名 = categories[导出编号 - 1]`。
2. **「前挡玻璃遮挡」= 导出编号 2**（categories 0-based 索引 1）。别和「车辆遮挡」(导出 17) 混。
3. **image_id 必须带 `.jpg`**（不带返回「图片不存在」）。
4. **JSON 是 UTF-8**：Python 用 `response.read().decode('utf-8')`；前端 `fetch` 正常。
5. **质检员归属**：来自 `/api/projects` 的 `qc_assignments`（键 = 质检员 uid，值 = 分配给他的图片文件名数组，文件名带 `.jpg`）。命中图与它取交集得到「归属质检员」。
6. **qc_status**：来自 `/api/projects/{id}/images` 的 `images[].qc_status`（passed/pending/rejected）。
7. **导出 bbox 是像素坐标** `[x,y,w,h]`；annotation 接口的 bbox 是**归一化** `[x1,y1,x2,y2]`，预览时按图片自然尺寸换算成像素。
8. **监控数据**：`/api/admin/monitoring` 需要 admin/root（owner 于荣华是 admin，可用），返回各项目 `assignees`/`qc_assignees` 的统计。

## 6. 文件清单（都在 `d:\Project\test\label-auto-dashboard\` 下）

| 文件 | 作用 |
|---|---|
| `dashboard.py` | 本地服务 + 代理 + 数据解析逻辑（Python 标准库） |
| `static/index.html` | 单页结构 |
| `static/app.js` | 前端逻辑（调用本地服务、渲染） |
| `static/style.css` | 样式 |
| `启动看板.bat` | 双击启动：`python dashboard.py` |
| `README.md` | 使用说明 |

## 7. 边界条件与异常处理

- 登录失败（账号密码错）→ 前端提示，不进入主界面。
- token 过期/未登录 → 代理返回 401，前端提示重新登录。
- 项目无权限（如用 root 账号）→ 提示改用 owner/admin 账号。
- 端口 `8090` 被占用 → 自动尝试下一个端口并提示。
- 目标服务不可达（平台挂了）→ 代理返回明确错误信息，前端显示。
- 图片加载失败（image_id 不存在）→ 预览区显示占位提示。
- 大数据量（上万张图）→ 前端列表分页/虚拟滚动，避免卡死。

## 8. 预期结果

双击 `启动看板.bat` → 浏览器打开本地看板 → 用 owner 账号登录 → 6 个功能模块可正常查询/预览/导出，全程无需再手写 PowerShell 或让 AI 临时查数。
