# 第二版正式版 label-auto-v2 实施任务

- [x] Task 1: 复制目录 label-auto-v2
    - 1.1: 复制 `label-auto-dashboard` → `label-auto-v2`
    - 1.2: 删除复制出的 `build/`、`dist/`（避免陈旧产物）

- [x] Task 2: 后端账号与当前用户改造
    - 2.1: `_QC_LOGIN = {}` 清空内置账号
    - 2.2: 新增 `_current_uid()`（取 USER.id）
    - 2.3: `qc_setup()` 改为按当前用户返回有质检权限的项目
    - 2.4: `anno_setup()` 改为按当前用户返回有作业权限的项目
    - 2.5: `ast.parse` 校验语法

- [x] Task 3: 后端去掉看板路由
    - 3.1: 删除 `/api/projects/{id}/query` 路由
    - 3.2: 删除 `/api/export/{id}` 路由
    - 3.3: 保留 `/api/monitoring` 与 `get_export_labels`
    - 3.4: `ast.parse` 校验语法

- [x] Task 4: 前端登录页 index.html
    - 4.1: 重写 `index.html` 为登录页（邮箱/密码 + 于荣华一键登录）
    - 4.2: 登录后按角色跳 `/anno`（member）或 `/qc`（qc/admin）

- [x] Task 5: 删除看板前端文件
    - 5.1: 删除 `static/app.js`
    - 5.2: 删除 `static/style.css`

- [x] Task 6: 前端 qc.js 登录态 + 当前用户
    - 6.1: 顶部加登录态检查，无 token 跳 `/`
    - 6.2: `api()` 统一带 `Authorization` / `X-User-Id` / `X-User-Role` 头
    - 6.3: `uid()` 改为当前登录用户 id；去掉质检员下拉（admin 保留）
    - 6.4: 退出登录跳 `/`
    - 6.5: `node --check` 校验

- [x] Task 7: 前端 anno.js 登录态 + 当前用户
    - 7.1: 顶部加登录态检查，无 token 跳 `/`
    - 7.2: `api()` 统一带登录头
    - 7.3: 作业员 uid 改为当前登录用户；去掉作业员下拉（admin 保留）
    - 7.4: 退出登录跳 `/`
    - 7.5: `node --check` 校验

- [x] Task 8: 前端 html/css 调整
    - 8.1: `qc.html` 去掉/条件显示「质检员」下拉
    - 8.2: `anno.html` 去掉/条件显示「作业员」下拉
    - 8.3: `qc.css`/`anno.css` 微调（隐藏下拉样式）

- [x] Task 9: 打包并验证
    - 9.1: 新增 `label-auto-v2.spec`（含 static 与图标）
    - 9.2: `python -m PyInstaller --clean --noconfirm label-auto-v2.spec`
    - 9.3: 确认 `dist/label-auto-v2.exe` 生成
