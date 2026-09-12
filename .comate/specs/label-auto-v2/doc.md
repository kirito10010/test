# 第二版正式版（label-auto-v2）

## 1. 需求场景与处理逻辑

以 `label-auto-dashboard`（主线开发版）为基底，复制出一份「第二版正式版」`label-auto-v2`，与第一版（`label-auto-app`）一样采用**先登录再进入**，并做如下裁剪：

- **去掉看板平台**（数据看板首页及其查询/导出/监控前端）。
- **去掉内置账号**：`_QC_LOGIN` 清空，仅保留于荣华账号的内置自动登录（`QC_EMAIL`/`QC_PASSWORD`）。
- **登录方式**：登录页输入自己的作业员/质检员账号密码；于荣华账号内置一键登录。
- 登录后按角色路由：`member` → `/anno`（作业平台），`qc`/`admin` → `/qc`（质检平台）。

## 2. 架构与技术方案

### 2.1 复制目录
把 `d:\Project\test\label-auto-dashboard` 整体复制为 `d:\Project\test\label-auto-v2`，后续所有改动在新目录进行，主线版不受影响。

### 2.2 登录优先
- 新增登录页 `static/index.html`（复用第一版 `label-auto-app/static/index.html` 的登录页样式与逻辑，另加「于荣华一键登录」按钮）。
- `qc.html` / `anno.html` 的 JS 启动时：从 localStorage 读取登录态（`la_auth`），无 token 则 `location.href = '/'` 跳登录页。
- 后端复用现有 `/api/login`（通用登录）、`/api/me`、`/api/logout`、`/api/qc/autologin`（于荣华内置登录）。

### 2.3 去掉看板平台
- 删除 `static/app.js`、`static/style.css`。
- `index.html` 从「数据看板」改为「登录页」。
- 后端去掉看板专属路由：`/api/projects/{id}/query`、`/api/export/{id}`；**保留** `/api/monitoring`（用于 uid→名字映射）和 `get_export_labels`（用于质检平台「多选属性筛选」）。

### 2.4 去掉内置账号
- `_QC_LOGIN = {}`（清空）。保留 `QC_EMAIL`/`QC_PASSWORD`（于荣华内置登录）与 `/api/qc/autologin`。

### 2.5 QC/anno 平台改为「以当前登录用户身份」
- 后端 `qc_setup()` / `anno_setup()`：按当前登录用户 uid（从 `Authorization`/`X-User-Id` 头解析，参考第一版 `_current_uid()`）返回其有权限的项目，而不是「项目 + 质检员列表」。
- 前端：
  - 质检平台去掉「质检员」下拉，直接用当前登录用户 uid 拉取列表/计数。
  - 作业平台去掉「作业员」下拉，直接用当前登录用户 uid。
  - 于荣华（admin）保留「质检员」下拉用于巡查/改属性（切换时用 owner token 兜底）。

## 3. 影响文件（均在 `label-auto-v2` 内）

| 文件 | 改动类型 |
|---|---|
| `dashboard.py` | 修改：清空 `_QC_LOGIN`；`qc_setup`/`anno_setup` 按当前用户；去掉看板路由 |
| `static/index.html` | 重写：登录页（含于荣华一键登录） |
| `static/app.js` | 删除 |
| `static/style.css` | 删除 |
| `static/qc.html` | 修改：去掉「质检员」下拉（admin 保留） |
| `static/qc.js` | 修改：登录态检查、跳转；按当前用户 uid 操作 |
| `static/anno.html` | 修改：去掉「作业员」下拉（admin 保留） |
| `static/anno.js` | 修改：登录态检查、跳转；按当前用户 uid 操作 |
| `static/qc.css` / `anno.css` | 可能微调（隐藏下拉样式） |
| `label-auto-v2.spec` | 修改：spec 文件名/图标（打包用） |

## 4. 实现细节

### 4.1 后端 `dashboard.py`

```python
# 1) 清空内置账号
_QC_LOGIN = {}

# 2) 当前登录用户 uid（复用第一版思路）
def _current_uid():
    return (USER or {}).get("id") or ""
```

`qc_setup()` 改为返回「当前用户有质检权限的项目」：
```python
def qc_setup():
    uid = _current_uid()
    proj_data = get_projects()
    out = []
    for p in proj_data.get("projects", []):
        if uid not in (p.get("qc_assignees") or []) and uid not in (p.get("qc_assignments") or {}):
            continue
        out.append({"id": p.get("id"), "name": p.get("name"),
                    "categories": p.get("categories") or []})
    return out
```

`anno_setup()` 同理（按 `assignees`/`assignments` 判断）。

路由层去掉看板专属分支（`/api/projects/{id}/query`、`/api/export/{id}`）。

### 4.2 前端登录页 `index.html`

复用第一版登录页，额外加「于荣华登录」按钮，点击调用 `/api/qc/autologin` 后按角色跳转。

### 4.3 前端 `qc.js` / `anno.js`

- 顶部加登录态读取与跳转：
```js
const auth = getAuth();
if (!auth.token) { location.href = '/'; }
```
- `api()` 统一带 `Authorization` / `X-User-Id` / `X-User-Role` 头（同第一版）。
- 去掉「质检员/作业员」下拉，列表/计数直接传当前登录用户 uid。

## 5. 边界条件与异常处理

- 未登录访问 `/qc` 或 `/anno`：跳转 `/` 登录页。
- 登录账号无质检/作业权限：页面显示「该账号暂无质检/作业权限」。
- 于荣华登录：进入 `/qc`，可切换质检员巡查、改属性。
- 去掉看板后，`/` 不再是看板，而是登录页。
- 属性筛选依赖的 `get_export_labels` 保留，不受看板删除影响。

## 6. 数据流

1. 用户打开 `/` → 登录页 → 输入账号密码（或于荣华一键）→ `/api/login`/`/api/qc/autologin` 返回 token+user。
2. 前端存 localStorage，按 role 跳 `/anno` 或 `/qc`。
3. `/qc` 启动 → `/api/qc/setup`（按当前 uid 返回项目）→ 加载列表/计数（uid=当前用户）。

## 7. 预期结果

- `label-auto-v2` 独立成第二版正式版，无看板，登录优先，仅保留于荣华内置登录。
- 质检平台、作业平台按「当前登录用户」各自操作自己的队列。
- 于荣华可登录质检平台巡查并修改属性。
