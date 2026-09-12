# 外接看板：照片详情改弹窗 + 顶栏加作业平台按钮 + 去掉登录框

- [x] Task 1: index.html 改顶栏并加弹窗、删侧边面板
    - 1.1: 顶栏删 .auth，加 .topbar-links（作业平台在前、质检平台在后）
    - 1.2: 删除 #detailPanel 侧边面板
    - 1.3: 新增 #previewModal 弹窗（#previewTitle/#previewImageWrap/#previewImg/#previewCanvas/#previewInfo/#previewClose）

- [x] Task 2: app.js 接入弹窗并去掉登录逻辑
    - 2.1: 删除 doLogin / doLogout / applyAuth 及登录相关事件绑定
    - 2.2: boot() 自动登录后直接显示 projectBar 并 loadProjects
    - 2.3: openPreview 改用弹窗元素
    - 2.4: clearPreview 改为 closePreview（隐藏弹窗）
    - 2.5: drawBoxes 改用 #previewCanvas / #previewImageWrap
    - 2.6: 绑定 #previewClose 与点击弹窗背景关闭

- [x] Task 3: style.css 加样式
    - 3.1: 新增 .topbar-links
    - 3.2: 新增 .preview-image-wrap（img/canvas）

- [x] Task 4: 校验并重新打包 label-auto-dashboard.exe
    - 4.1: node --check app.js
    - 4.2: PyInstaller 重新打包，确认 dist 只含 label-auto-dashboard.exe
