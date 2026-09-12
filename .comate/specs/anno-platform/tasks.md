# 作业平台任务清单

- [x] Task 1: 后端新增作业平台接口
    - 1.1: 新增 `anno_setup()`，返回项目 + 作业员（uid/name/has_login）+ 分类
    - 1.2: 新增 `anno_assigned(pid, uid, status, offset, limit)`，按 `unannotated`（未作业）/ `rejected`（已提交被打回）过滤
    - 1.3: 新增路由 `/api/anno/setup`、`/api/anno/assigned`，并支持 `/anno` 静态页

- [x] Task 2: 抽离公共照片查看器
    - 2.1: 新建 `static/viewer.js`，从 qc.js 抽出 `colorFor` + `createViewer`
    - 2.2: qc.js 移除这两个函数，qc.html 在 qc.js 之前引入 viewer.js

- [x] Task 3: 作业平台页面骨架与样式
    - 3.1: `anno.html`：顶栏（项目/作业员/设置）+ 左侧属性 + 中间照片 + 右侧列表 + 设置面板 + 登录框
    - 3.2: `anno.css`：三栏布局、属性按钮、列表、设置面板样式

- [x] Task 4: 作业平台前端逻辑
    - 4.1: init 自动登录 + setup，项目/作业员渲染与 localStorage 持久化
    - 4.2: 左侧属性按钮渲染与选中，中间照片加载（复用 createViewer）
    - 4.3: 右侧列表（未作业/已提交被打回切换、点击加载、分页）
    - 4.4: 登录门槛（局域网未内置账号弹登录，127.0.0.1 豁免）

- [x] Task 5: 属性快捷键与提交
    - 5.1: 属性快捷键按项目隔离、独立 localStorage（anno_shortcuts），按键选中属性
    - 5.2: 提交键（默认 C，可改）保存框并刷新列表
    - 5.3: 设置面板保存/恢复默认，切项目自动载入该项目快捷键
