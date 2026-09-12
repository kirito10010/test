# 修复：质检员无法「修改标注并保存」（403 无权保存）

## 背景与现象

`label-auto-app`（给别人用的合并版）里，质检员账号（如 `v_lijin10@baidu.com`，角色 `qc`）进入质检平台，打开照片修改标注框后点保存，显示「修改失败」。

实测平台接口：

- 李劲（`qc`）调用 `POST /api/projects/{pid}/save` → `403 {"error":"无权保存该项目的标注"}`
- 管理员（`admin`）调用同样接口 → `200 OK`
- 作业员（`member`，如郭雅楠）保存自己的图 → 正常（因为他是该图 assignee）

## 根因

平台把「保存标注」`/save` 限制为 **admin 或该图作业员（member）**，`qc` 角色没有该权限。

而 `label-auto-app` 的 `qc_save()` 用的是当前登录用户自己的 token（`upstream` 缺省用全局 `TOKEN`），质检员 token 自然被 403。

对比：三合一版 `label-auto-dashboard` 里 `qc_save()` 也走全局 `TOKEN`，但那是 owner 自动登录，`TOKEN` 本身就是 admin，所以能保存——这就是用户要的「和三合一平台那样」。

注意：「通过/打回」走的是另一个接口 `/qc`，`qc` 角色是允许的，质检提交（归属质检员本人）目前正常，不需要动。

## 修复方案

在 `label-auto-app` 里内嵌 owner（管理员）账号，`qc_save()` 在**当前用户是 `qc` 角色时**改用 owner 的 token 去保存标注；其余角色（admin/member）继续用自己 token，保证：

- `qc`（质检员）：保存标注用 owner token → 能保存。
- `member`（作业员）：继续用自己 token 保存 → 归属不受影响。
- `admin`：用自己 token → 正常。
- 质检「通过/打回」`/qc` 仍用质检员本人 token → 归属人是质检员（和三合一一致）。

角色判断：登录接口已返回 `user.role`（`admin`/`qc`/`member`），在登录时把 `token -> user` 存入内存 `_LOGIN_SESSIONS`，`qc_save()` 里据此判断。

## 影响文件

仅 `d:\Project\test\label-auto-app\dashboard.py`：

1. 全局区新增：`_OWNER_EMAIL` / `_OWNER_PASSWORD` / `_OWNER_TOKEN` / `_LOGIN_SESSIONS`。
2. 新增 `_get_owner_token()`：登录 owner 并缓存 token（失败返回 None）。
3. `_handle_login()`：登录成功后把 `token -> user`（含 role）记入 `_LOGIN_SESSIONS`。
4. `qc_save()`：`role == "qc"` 时用 owner token，否则用当前登录 token。

`label-auto-dashboard`（三合一）**不改**——它已经是 owner 自动登录，行为正确。

## 边界与异常

- `_get_owner_token()` 失败（网络/账号异常）返回 None，`upstream` 自动回退当前登录 token（退化为现状，只是 qc 仍会 403，但不崩溃）。
- `_LOGIN_SESSIONS` 只在内存，重启服务后需重新登录（与现有 token 会话一致）。
- owner 密码内嵌进 exe：仅限内部可信环境，和三合一版现状一致；请勿把 exe 发给不受信任的人。

## 预期结果

- 质检员李劲登录后能打开照片、修改标注框、保存成功。
- 质检「通过/打回」的归属人仍是质检员本人（不是 owner）。
- 作业员保存自己标注的行为与归属不受影响。
