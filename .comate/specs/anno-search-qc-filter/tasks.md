# 作业平台：文件名搜索 + 显示归谁质检 + 按质检员筛选

- [x] Task 1: 后端新增质检归属接口
    - 1.1: 新增 anno_qc_owners(pid, uid)，返回 qc_of（image_id -> {uid,name}）与 qcs（去重质检员列表）
    - 1.2: 新增路由 GET /api/anno/qc_owners?pid=xxx（uid 从当前登录 USER 取）

- [x] Task 2: 前端 anno.html 加搜索框与质检员下拉
    - 2.1: 在 .anno-list-tabs 上方加 .anno-filters（#annoSearch + #annoQcFilter）

- [x] Task 3: 前端 anno.js 接入搜索/筛选/归属显示
    - 3.1: state 增加 search / qcFilter / qcOf / qcs
    - 3.2: 项目切换时调 /api/anno/qc_owners 并渲染质检员下拉
    - 3.3: loadList() 按 search + qcFilter 客户端过滤
    - 3.4: makeListItem 显示归谁质检（.anno-qc-tag）
    - 3.5: 绑定搜索框 input 与质检员下拉 change

- [x] Task 4: 前端 anno.css 加样式
    - 4.1: .anno-filters / 搜索框 / .anno-qc-tag 样式

- [x] Task 5: 校验并重新打包 label-auto-app.exe
    - 5.1: python -m py_compile dashboard.py + node --check anno.js
    - 5.2: 接口自测 /api/anno/qc_owners
    - 5.3: PyInstaller 重新打包，确认 dist 只含 label-auto-app.exe
