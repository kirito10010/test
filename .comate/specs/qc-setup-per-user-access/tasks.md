# 修复：质检平台「有时候」提示「该账号暂无质检权限的项目」

- [x] Task 1: 在 label-auto-app/dashboard.py 新增权限判断并改造 setup
    - 1.1: 新增 _current_uid()（返回当前登录用户 id）
    - 1.2: qc_setup() 改为按 qc_assignees / qc_assignments 判断，不再用缓存 is_qc
    - 1.3: anno_setup() 改为按 assignees / assignments 判断，不再用缓存 is_assigned

- [x] Task 2: 校验并重新打包 label-auto-app.exe
    - 2.1: 语法检查 dashboard.py（python -m py_compile）
    - 2.2: 停掉占用 5221 端口的旧进程（如有）
    - 2.3: PyInstaller 重新打包，确认 dist 只含 label-auto-app.exe
