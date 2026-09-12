# 总结：修复质检平台「有时候」提示「该账号暂无质检权限的项目」

## 问题

`label-auto-app` 质检员（`qc` 角色）进入质检平台，有时提示「该账号暂无质检权限的项目」。

## 根因

`/api/projects` 返回的 `is_qc` / `is_assigned` 是按调用者 token 计算的（每人不同），但 `get_projects()` 把它缓存在共享键 `"projects"`（30 分钟）。当缓存里是别人（如 admin，`is_qc` 全 false）的结果时，质检员刷新（前端用 localStorage token 直接调 `/api/qc/setup`，不清缓存）就会拿到错的 `is_qc`，过滤后为空。

## 改动

仅 `label-auto-app/dashboard.py`：

1. 新增 `_current_uid()`（返回当前登录用户 id）。
2. `qc_setup()` 改为按 `qc_assignees` / `qc_assignments` 判断当前用户是否有质检权限，不再看缓存的 `is_qc`。
3. `anno_setup()` 改为按 `assignees` / `assignments` 判断，不再看缓存的 `is_assigned`。

分配表是完整数据（非 per-user），缓存安全。

## 校验与打包

- 实测：李劲 `qc_setup` 返回 9 个项目、admin 返回 0、郭雅楠 `anno_setup` 返回 5 个项目，均与平台 `is_qc`/`is_assigned` 一致。
- `dashboard.py` 语法检查通过。
- PyInstaller 重新打包 `dist/label-auto-app.exe`（带图标），dist 仅此一个文件；已清理 `build/`。
