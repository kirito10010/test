# 修复：重启 exe 后质检员「编辑保存」又失效（角色判断丢失）

## 现象

上一个修复里，质检员「修改标注并保存」是当角色为 `qc` 时改用 owner token。但重启 exe 后再刷新页面，编辑保存又失败（403 无权保存）。

## 根因

`qc_save()` 判断角色用的是内存里的 `_LOGIN_SESSIONS`（token -> user），它**只在登录时写入**：

```python
role = ((_LOGIN_SESSIONS.get(TOKEN) or {}).get("role") or "")
```

但前端刷新页面时，直接用 localStorage 里存的 token 调接口，**不再走 `/api/login`**，所以重启后的新进程里 `_LOGIN_SESSIONS` 是空的 → `role` 取不到 → 不等于 `"qc"` → 又退回用质检员本人 token → 被平台 403。

## 修复方案

让前端每次请求都带上角色（它本来就把 `user.role` 存在 localStorage 里），后端据此判断角色，不再依赖内存会话：

1. 前端 `qc.js` / `anno.js` 的 `api()`：新增请求头 `X-User-Role: auth.user.role`。
2. 后端 `_route()`：读取 `X-User-Role`，把角色写入全局 `USER`（`{"id": uid, "role": role}`）。
3. `qc_save()`：角色改从 `USER["role"]` 取，`_LOGIN_SESSIONS` 只作兜底。

这样登录后、刷新后、甚至重启 exe 后，角色都能正确拿到。

## 影响文件

- `d:\Project\test\label-auto-app\dashboard.py`：`_route()` 读角色；`qc_save()` 改用 `USER["role"]`。
- `d:\Project\test\label-auto-app\static\qc.js`：`api()` 加 `X-User-Role` 头。
- `d:\Project\test\label-auto-app\static\anno.js`：`api()` 加 `X-User-Role` 头。

## 边界与异常

- 作业员（member）保存仍用自己 token（role != "qc"），归属不变。
- 若请求头缺失（手动调接口），回退 `_LOGIN_SESSIONS`，再退化为空 → 用本人 token（与现状一致，不崩溃）。

## 预期结果

- 质检员登录/刷新/重启 exe 后，编辑保存都能稳定成功（走 owner token）。
- 通过/打回仍用质检员本人 token，归属正确。
