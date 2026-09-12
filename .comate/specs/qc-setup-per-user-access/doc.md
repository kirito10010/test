# 修复：质检平台「有时候」提示「该账号暂无质检权限的项目」

## 背景与现象

`label-auto-app` 里质检员（`qc` 角色）进入质检平台，**有时候**（不是每次）提示「该账号暂无质检权限的项目」。

## 根因

`/api/projects` 接口返回的每个项目带有 `is_qc` / `is_assigned` 两个字段，这俩是**按当前调用者 token 计算的**（每人不同）：

- 李劲（qc）→ 9 个项目的 `is_qc=true`
- 管理员（admin）→ 所有项目 `is_qc=false`

而 `get_projects()` 把这个响应缓存在**共享键 `"projects"`** 下（30 分钟）：

```python
def get_projects():
    data = cache_get("projects", ttl=1800)
    if data is None:
        status, h, raw = upstream("GET", "/api/projects")   # 用当前 TOKEN 拉，含每人不同的 is_qc
        data = json.loads(raw.decode("utf-8"))
        cache_set("projects", data, ttl=1800)
    return data
```

`qc_setup()` 再用缓存里的 `is_qc` 过滤。于是：

- 如果管理员（或别的账号）先把 `/api/projects` 拉进缓存（它的 `is_qc` 全是 false），
- 之后质检员刷新页面（前端用 localStorage 里存的 token 直接调 `/api/qc/setup`，**不再走登录、不清缓存**），
- `qc_setup()` 拿到的是缓存里别人的 `is_qc` → 过滤后为空 → 提示「暂无质检权限」。

因为缓存是共享的、且 30 分钟才过期，所以表现为「有时候」。

## 修复方案

不依赖缓存的 per-user `is_qc` / `is_assigned`，改为**用项目里的分配表实时判断当前用户是否有权限**：

- 质检权限：当前 uid 在项目的 `qc_assignees` 或 `qc_assignments` 里。
- 作业权限：当前 uid 在项目的 `assignees` 或 `assignments` 里。

`qc_assignments` / `assignments` 是完整分配表（所有用户都在），不是 per-user，**缓存安全**。

已实测验证：用 `uid in qc_assignees/qc_assignments`、`uid in assignees/assignments` 计算出来的权限，与平台返回的 `is_qc`/`is_assigned` 对李劲、郭雅楠在全部项目上**完全一致**。

## 影响文件

仅 `d:\Project\test\label-auto-app\dashboard.py`：

1. 新增 `_current_uid()`：返回当前登录用户 id（来自 `USER`，`_route` 里已从 `X-User-Id` 头写入）。
2. `qc_setup()`：改成按 `qc_assignees` / `qc_assignments` 判断，不再看缓存里的 `is_qc`。
3. `anno_setup()`：改成按 `assignees` / `assignments` 判断，不再看缓存里的 `is_assigned`。

## 边界与异常

- 管理员（admin）不在任何 `qc_assignments` 里 → 仍返回空（与平台 `is_qc` 一致，也符合现状：admin 用三合一平台做质检，不靠 label-auto-app）。
- 前端不需要改动；uid 已经通过现有 `X-User-Id` 头传到后端。
- 项目分配表本身会随 `projects` 缓存 30 分钟，属正常（分配关系变化频率低）。

## 预期结果

- 质检员进入质检平台，稳定显示自己有质检权限的项目，不再「有时候」空掉。
- 作业员（member）的作业平台同理不再因缓存串号而空掉。
