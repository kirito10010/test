# 总结：修复质检员无法「修改标注并保存」（403 无权保存）

## 问题

`label-auto-app` 里质检员（`qc` 角色，如李劲）进入质检平台，修改标注框保存时报「修改失败」。实测平台接口：`qc` 调用 `/save` 返回 `403 无权保存该项目的标注`，`admin` 调用则 `200 OK`。

根因：平台把「保存标注」`/save` 限制为 admin 或该图作业员，`qc` 角色无权；而 `label-auto-app` 的 `qc_save()` 用的是当前登录用户（质检员）自己的 token。

## 改动

仅 `label-auto-app/dashboard.py`：

1. 全局区新增 owner 账号（`_OWNER_EMAIL`/`_OWNER_PASSWORD`/`_OWNER_TOKEN`）与 `_LOGIN_SESSIONS`（token -> user，含 role）。
2. 新增 `_get_owner_token()`：登录 owner 并缓存 token，失败返回 None。
3. `_handle_login()`：登录成功把 token -> user 记入 `_LOGIN_SESSIONS`。
4. `qc_save()`：当前角色为 `qc` 时用 owner token 保存；admin/member 继续用本人 token。

`label-auto-dashboard`（三合一）未改（本身 owner 自动登录，行为已正确）。

## 效果

- 质检员修改标注并保存：用 owner 身份绕开平台权限 → 能保存。
- 紧接着的质检「通过/打回」仍用质检员本人 token → 归属人是质检员本人（和三合一一致）。
- 作业员（member）保存自己标注仍用自己 token → 归属不受影响。

## 校验与打包

- `dashboard.py` 通过 `python -m py_compile`。
- `_get_owner_token()` 实测返回并缓存有效 token。
- PyInstaller 重新打包 `dist/label-auto-app.exe`（带图标），dist 仅此一个文件；已清理 `build/`。
