# 修复：重启 exe 后质检员「编辑保存」又失效（角色判断丢失）

- [x] Task 1: 前端 qc.js / anno.js 的 api() 增加 X-User-Role 头
    - 1.1: qc.js api() 里，auth.user.role 存在时加 opts.headers['X-User-Role']
    - 1.2: anno.js api() 里，同样加 X-User-Role 头

- [x] Task 2: 后端 dashboard.py 读取角色并用于 qc_save
    - 2.1: _route() 读取 X-User-Role，写入 USER（{"id", "role"}）
    - 2.2: qc_save() 角色改从 USER["role"] 取，_LOGIN_SESSIONS 作兜底

- [x] Task 3: 校验并重新打包 label-auto-app.exe
    - 3.1: 语法检查 dashboard.py + node --check 两个 js
    - 3.2: 停掉占用 5221 端口的旧进程（如有）
    - 3.3: PyInstaller 重新打包，确认 dist 只含 label-auto-app.exe
