# 质检平台（QC Platform）

- [x] Task 1: 后端新增 QC 相关路由
    - 1.1: `GET /api/qc/autologin`：服务端用于荣华账号登录并设置全局 TOKEN
    - 1.2: `GET /api/qc/setup`：合并 projects + monitoring，返回项目与质检员（uid/name/计数）
    - 1.3: `GET /api/qc/assigned`：按 pid+uid+status 分页返回该质检员的 image_id 列表
    - 1.4: `POST /api/qc/submit`：循环调 `/qc` 批量提交 verdict
    - 1.5: `GET /qc`：返回 `static/qc.html`

- [x] Task 2: 前端页面骨架与样式
    - 2.1: 新建 `static/qc.html`（项目/质检员下拉 + 状态页签 + 工作区 + 提交按钮）
    - 2.2: 新建 `static/qc.css`（2×2 网格、viewer/stage、页签、按钮、全屏遮罩样式）

- [x] Task 3: 前端逻辑与图片缩放平移
    - 3.1: 新建 `static/qc.js`：自动登录、加载 setup、切换项目/质检员
    - 3.2: 实现单图组件（滚轮以鼠标为中心缩放、右键拖动平移、标注框叠加、点开大图）
    - 3.3: 未质检工作区：一次显示 4 张，每张通过/打回切换，提交后刷新拉下 4 张
    - 3.4: 已通过/已打回页签浏览（分页加载）
    - 3.5: 校验：`python -m py_compile dashboard.py` + 浏览器走查
