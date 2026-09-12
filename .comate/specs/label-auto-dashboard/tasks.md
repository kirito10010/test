# Label Auto 外接看板 · 任务计划

- [x] Task 1: 搭建项目骨架与启动脚本
    - 1.1: 创建目录 `label-auto-dashboard/` 及 `static/` 子目录
    - 1.2: 创建 `dashboard.py` 骨架（`http.server` 服务 + 静态文件分发 + 端口自动递增）
    - 1.3: 创建 `启动看板.bat`（双击启动 `python dashboard.py`）
    - 1.4: 创建 `README.md`（使用说明）

- [x] Task 2: 实现后端代理与认证（dashboard.py）
    - 2.1: 实现通用转发函数：把请求代理到 Label Auto API（`http://172.21.205.141:8771`），保留路径与查询参数
    - 2.2: 实现 `/api/login`：转发登录并保存 token 到服务端内存
    - 2.3: 实现 Bearer token 注入：所有转发请求带 `Authorization: Bearer <token>`
    - 2.4: 实现 `/api/me` 与错误处理（401 → 提示重新登录；目标不可达 → 明确报错）
    - 2.5: 实现 `export` 结果内存缓存（按项目 id + 60s TTL），供 query/leak/distribution 复用

- [x] Task 3: 实现后端数据解析与查询端点
    - 3.1: 解析导出 `labels[].bboxes`，把 1-based 分类编号映射为分类名（`categories[idx-1]`）
    - 3.2: 交叉 `/api/projects` 的 `qc_assignments` 得到每张图的质检员归属
    - 3.3: 交叉 `/api/projects/{id}/images` 得到每张图的 `qc_status`
    - 3.4: 实现 `/api/projects/{id}/query?cat=`（标签巡检：命中图 + 框坐标 + 状态 + 质检员）
    - 3.5: 实现 `/api/projects/{id}/leak?cats=`（漏标：passed 且带异常标签）
    - 3.6: 实现 `/api/projects/{id}/distribution`（各分类框数量分布）
    - 3.7: 实现 `/api/monitoring`（转发 `/api/admin/monitoring`）

- [x] Task 4: 前端骨架与登录
    - 4.1: 创建 `static/index.html`（顶部登录栏 + 标签页导航 + 内容区）
    - 4.2: 创建 `static/style.css`（基础布局、表格、状态色 passed/pending/rejected）
    - 4.3: 创建 `static/app.js`：登录流程、token 保存、未登录拦截
    - 4.4: 登录后加载项目列表并渲染到项目下拉框

- [x] Task 5: 前端「标签巡检器」
    - 5.1: 项目 + 标签选择（标签从项目 categories 动态生成）
    - 5.2: 调用 `/query` 渲染结果表（文件名、框坐标、qc_status、质检员）
    - 5.3: 按状态 / 质检员筛选
    - 5.4: 一键导出 CSV（前端生成并下载）

- [x] Task 6: 前端「漏标告警」
    - 6.1: 配置异常标签集合（默认含「前挡玻璃遮挡」，可增删）
    - 6.2: 调用 `/leak` 并渲染漏标清单（文件名、框坐标、归属质检员）

- [x] Task 7: 前端「质检进度看板」
    - 7.1: 调用 `/monitoring` 渲染项目汇总（总图/已标/已通过/已打回/进度）
    - 7.2: 渲染各质检员统计（分配/通过/打回/通过率/打回率）与标注员 valid_rate

- [x] Task 8: 前端「标签分布」
    - 8.1: 调用 `/distribution` 并用纯 CSS/JS 渲染横向条形图（每分类框数量）

- [x] Task 9: 前端「图片预览」
    - 9.1: 点击查询结果中的图 → 通过 `/image` 加载图片
    - 9.2: 通过 `/annotation` 获取框，把归一化 bbox 换算成像素并叠加绘制（按分类着色）

- [x] Task 10: 前端「一键导出」
    - 10.1: 导出面板（选择项目 + 模式：全量/仅通过/yolo）
    - 10.2: 触发 `/api/export/{id}?mode=` 下载

- [x] Task 11: 端到端联调与验证
    - 11.1: 用 owner 账号登录 → 走通「标签巡检/漏标/看板/分布/预览/导出」全流程
    - 11.2: 验证边界：登录失败、token 过期、端口占用、图片不存在、项目无权限的提示
