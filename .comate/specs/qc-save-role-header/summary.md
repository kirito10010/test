# 总结：修复重启 exe 后质检员「编辑保存」又失效

## 问题

上一轮用 owner token 修复质检员保存后，重启 exe 再刷新页面，编辑保存又失败（403）。

## 根因

`qc_save()` 用内存 `_LOGIN_SESSIONS` 判断角色，但该表只在登录时写入；刷新页面不走登录，重启后为空 → 取不到 `qc` 角色 → 退回用质检员本人 token → 403。

## 改动

1. 前端 `qc.js` / `anno.js` 的 `api()` 新增请求头 `X-User-Role: auth.user.role`。
2. 后端 `_route()` 读取 `X-User-Role`，写入 `USER`（`{"id", "role"}`）。
3. `qc_save()` 角色改从 `USER["role"]` 取，`_LOGIN_SESSIONS` 作兜底。

角色现在随每次请求传来，登录/刷新/重启 exe 都能正确拿到。

## 校验与打包

- `dashboard.py` 语法检查通过；两个 JS 通过 `node --check`。
- PyInstaller 重新打包 `dist/label-auto-app.exe`（带图标），dist 仅此一个文件；已清理 `build/`。
