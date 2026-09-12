# 修复：质检员无法「修改标注并保存」（403 无权保存）

- [x] Task 1: 在 label-auto-app/dashboard.py 增加 owner 登录与会话记录
    - 1.1: 全局区新增 _OWNER_EMAIL / _OWNER_PASSWORD / _OWNER_TOKEN / _LOGIN_SESSIONS
    - 1.2: 新增 _get_owner_token()（登录 owner 并缓存 token，失败返回 None）
    - 1.3: _handle_login() 登录成功后把 token -> user（含 role）记入 _LOGIN_SESSIONS

- [x] Task 2: 修改 qc_save 用 owner token（仅 qc 角色）
    - 2.1: qc_save() 里判断当前角色，role == "qc" 时传 token=_get_owner_token()，否则不传（回退当前登录 token）

- [x] Task 3: 校验并重新打包 label-auto-app.exe
    - 3.1: 语法检查 dashboard.py（python -m py_compile）
    - 3.2: 停掉占用 5221 端口的旧进程（如有）
    - 3.3: PyInstaller 重新打包，确认 dist 只含 label-auto-app.exe
