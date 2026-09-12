# 拆分为两个独立端 + 账号登录改造任务清单

- [x] Task 1: 复制项目为两个副本
    - 1.1: 复制 `label-auto-dashboard` → `label-auto-qc`
    - 1.2: 复制 `label-auto-dashboard` → `label-auto-anno`

- [x] Task 2: 后端认证改造（两个副本通用）
    - 2.1: 删除内置账号（QC_EMAIL/QC_PASSWORD/_QC_LOGIN/_QC_TOKENS）与 `账号.md`、autologin、登录门槛
    - 2.2: 加 token 持久化：`token.json` 启动加载 / 登录写入 / 登出删除
    - 2.3: `/api/login` 登录、`/api/me` 判登录态、`/api/logout` 登出
    - 2.4: `qc_setup`/`anno_setup` 按 `is_qc`/`is_assigned` 过滤项目，uid 改用登录用户

- [x] Task 3: 质检副本（label-auto-qc）前端改造
    - 3.1: qc.html 加登录框 + 退出按钮，删质检员下拉与跨平台链接
    - 3.2: qc.js 加登录/登出逻辑，接口不再带 uid，删除下拉/登录门槛逻辑
    - 3.3: 删除 index.html、anno.* 等无关文件

- [x] Task 4: 作业副本（label-auto-anno）前端改造
    - 4.1: anno.html 加登录框 + 退出按钮，删作业员下拉与跨平台链接
    - 4.2: anno.js 加登录/登出逻辑，接口不再带 uid，删除下拉/登录门槛逻辑
    - 4.3: 删除 index.html、qc.* 等无关文件

- [x] Task 5: 启动脚本与收尾
    - 5.1: 各副本的启动 .bat（启动对应平台）
    - 5.2: 语法校验（py_compile + node --check）
