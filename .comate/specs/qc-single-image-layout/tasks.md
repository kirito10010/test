# 质检平台改成和作业平台一致的三栏布局

- [x] Task 1: 重写 qc.html 为三栏布局
    - 1.1: 顶栏加「通过/打回」按钮，保留项目/质检员/统计/每日质检量/设置/跳转
    - 1.2: 三栏结构：左 #qcCats、中 #qcViewer、右 #qcList + 页签
    - 1.3: 保留质检员登录弹窗、设置弹窗、toast

- [x] Task 2: 重写 qc.js 为单图流程
    - 2.1: state/初始化/项目与质检员选择/登录门槛/每日质检量（复用现有逻辑）
    - 2.2: 左侧属性按钮 renderCategoryButtons/setActiveCategory
    - 2.3: 右侧列表 switchStatus/loadList/makeListItem/loadCounts（含最近提交打回）
    - 2.4: 中间单图 loadImage/clearViewer（pending/rejected 可编辑）
    - 2.5: 通过/打回/保存（verdict/saveBoxes + 自动切下一张）
    - 2.6: 快捷键（属性键 + C 通过 + R 打回 + shift+3 隐藏）+ 设置弹窗
    - 2.7: 事件绑定

- [x] Task 3: 重写 qc.css 为三栏样式
    - 3.1: qc-side / qc-main / qc-list-panel / qc-cats / qc-list-items / qc-item
    - 3.2: 去掉网格与 lightbox 相关样式

- [x] Task 4: 校验并重新打包 label-auto-dashboard.exe
    - 4.1: node --check qc.js
    - 4.2: PyInstaller 重新打包，确认 dist 只含 label-auto-dashboard.exe
