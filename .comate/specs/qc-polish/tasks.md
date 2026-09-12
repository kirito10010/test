# 质检平台（三合一）优化：顶栏布局 + 框预加载 + 显示作业员/搜索/筛选

- [x] Task 1: 后端新增作业员归属接口
    - 1.1: 新增 qc_annotator_owners(pid, uid)，返回 ann_of（image_id -> {uid,name}）与 anns（去重作业员列表）
    - 1.2: 新增路由 GET /api/qc/annotators?pid=xxx&uid=xxx

- [x] Task 2: qc.html 调整
    - 2.1: 顶栏把 .qc-spacer 移到 .qc-counts/.qc-daily-stats 之前
    - 2.2: 右侧列表 tab 上方加 .qc-filters（#qcSearch + #qcAnnotatorFilter）

- [x] Task 3: qc.js 优化与接入
    - 3.1: 新增 boxCache + prefetchBoxes，loadList/loadImage 预加载，loadImage 优先用缓存
    - 3.2: state 增加 search/annotatorFilter/annOf/anns，加载作业员归属并渲染筛选下拉
    - 3.3: loadList 按 search + annotatorFilter 过滤；makeListItem 显示「标注：名字」
    - 3.4: 绑定搜索/筛选事件

- [x] Task 4: qc.css 加样式
    - 4.1: .qc-filters / 搜索框 / .qc-ann-tag 样式

- [x] Task 5: 校验并重新打包 label-auto-dashboard.exe
    - 5.1: python -m py_compile dashboard.py + node --check qc.js
    - 5.2: 接口自测 /api/qc/annotators
    - 5.3: PyInstaller 重新打包，确认 dist 只含 label-auto-dashboard.exe
