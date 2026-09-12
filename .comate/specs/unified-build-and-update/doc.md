# 统一开发/发布 + 发布版自更新

## 1. 需求场景

现在 `label-auto-dashboard`（开发版）和 `label-auto-v2`（发布版）是两份独立代码，每次出新功能都要「复制 dashboard → 删看板 → 删内置账号 → 改登录 → 改切换逻辑」，无法统一。

目标：**只保留一份代码**，通过构建开关区分两个版本；发布版额外带「自更新」能力。

### 两个版本的差异（发布版相对开发版）

| 维度 | 开发版 dashboard | 发布版 v2 |
|---|---|---|
| 首页 `/` | 外接看板 | 登录页 |
| 看板路由 | 有 | 无 |
| 内置账号 `_QC_LOGIN` | 一批 | 清空 |
| 登录方式 | 内置自动登录 | 登录自己账号（作业员/质检员） |
| 切换质检员 | 能 | 不能 |
| 切换作业员 | 能 | 不能 |
| 切换平台按钮（看板/质检/作业互跳） | 能 | 不能（按角色进入） |
| 内置管理员（于荣华） | 全局默认 | 仅保留，供「质检平台修改功能」用其权限 |
| 自更新 | 无 | 每 10 分钟检测，有新版本弹窗（更新内容 + 更新按钮） |

## 2. 架构与技术方案

### 2.1 单代码库 + `RELEASE_MODE` 开关

- 后端 `dashboard.py` 一份，加 `RELEASE_MODE` 标志（构建时注入）。
- 前端 qc/anno 用同一套，通过 `/api/config` 判断是否发布版，据此隐藏切换入口/按钮。
- 首页两份都打包：`index.html`（看板）+ `login.html`（登录页），后端按模式返回。
- 两个 spec 产出两个 exe。

**RELEASE_MODE 注入方式**：用 PyInstaller `runtime_hooks` 设置环境变量，`dashboard.py` 启动时读取。

### 2.2 发布版自更新

- GitHub 上放 `version.json`（版本号 + 下载地址 + 更新内容）与新版 exe。
- 发布版 exe 启动后，后台线程每 10 分钟拉取 `version.json` 比对版本。
- 无新版 → 静默；有新版 → 弹窗显示更新内容 + 「更新」按钮。
- 点「更新」→ 下载新 exe 到临时文件 → 用一个辅助脚本（等待进程退出后）替换并提示重启。

## 3. 影响文件

| 文件 | 改动 |
|---|---|
| `label-auto-dashboard/dashboard.py` | 加 `RELEASE_MODE`；按模式开关看板路由、`_QC_LOGIN`、登录、`qc_setup/anno_setup`、`/` 首页选择；加 `/api/config`；加自更新线程（仅发布版） |
| `label-auto-dashboard/static/login.html` | 新增（发布版登录页，复用 v2 现有登录页） |
| `label-auto-dashboard/static/qc.js` / `anno.js` | 读 `/api/config` 控制切换入口/按钮显隐 |
| `label-auto-dashboard/static/qc.html` / `anno.html` | 切换入口加 id，便于 JS 控制 |
| `label-auto-dashboard/hooks/dev.py` / `hooks/release.py` | 新增 runtime hooks，注入 RELEASE_MODE |
| `label-auto-dashboard/label-auto-dashboard.spec` | dev 版（hook=dev） |
| `label-auto-dashboard/label-auto-v2.spec` | 发布版（hook=release） |
| `label-auto-v2/` | 弃用（其 dashboard.py/login.html 逻辑合并回 dashboard） |

## 4. 实现细节

### 4.1 RELEASE_MODE 注入

```python
# dashboard.py 顶部
import os
RELEASE_MODE = os.environ.get("LABEL_AUTO_RELEASE") == "1"
```

```python
# hooks/dev.py
import os; os.environ["LABEL_AUTO_RELEASE"] = "0"
# hooks/release.py
import os; os.environ["LABEL_AUTO_RELEASE"] = "1"
```

### 4.2 后端按模式分支

- 看板路由（monitoring/query/leak/distribution/search/export/query_progress/images/batch_qc）：仅 `not RELEASE_MODE` 时注册。
- `_QC_LOGIN`：`{} if RELEASE_MODE else {…}`
- `qc_setup`/`anno_setup`：发布版锁定当前登录用户（admin 仍可切换，其余锁 self）。
- `/` 首页：`_serve_static` 里发布版返回 `login.html`，开发版返回 `index.html`。
- 新增 `/api/config` 返回 `{release: RELEASE_MODE}`。

### 4.3 前端

- `qc.js`/`anno.js` 启动时 `api('/api/config')`，若 release 则：
  - 隐藏「质检员/作业员」下拉（admin 例外保留）；
  - 隐藏「看板/作业平台/质检平台」切换按钮（按角色只留当前平台 + 退出）。
- 登录逻辑：发布版走 `login.html`（登录自己账号 + 于荣华内置登录）；开发版维持自动登录。

### 4.4 自更新（仅发布版）

```python
if RELEASE_MODE:
    threading.Thread(target=_update_check_loop, daemon=True).start()

def _update_check_loop():
    while True:
        _check_update()
        time.sleep(600)   # 10 分钟
```

- `_check_update()`：GET GitHub `version.json`，与本地版本比对。
- 弹窗：用 `tkinter` 简单对话框展示「更新内容」+「更新」按钮（或 pystray 通知 + 托盘菜单）。
- 下载替换：下载到 `xxx.exe.new` → 写一个 `update.bat`（等待旧进程退出后 `move` 替换）→ 提示重启。

## 5. 边界条件与异常处理

- 无网络/拉取失败：静默跳过，不影响使用。
- 版本号格式：用 `version.json` 里的整数/字符串版本号比对，本地版本写死一个常量。
- 开发版不启动自更新线程。
- 替换失败（exe 被占用）：提示用户手动更新，不破坏原 exe。

## 6. 数据流

1. 构建：两个 spec + 各自 hook → 产出 `label-auto-dashboard.exe`（dev）/ `label-auto-v2.exe`（release）。
2. 发布版启动：登录 → 进入质检/作业（按角色）→ 每 10 分钟检查 GitHub `version.json` → 有新版弹窗 → 点更新 → 下载替换重启。

## 7. 预期结果

- 开发只在一份代码里进行，一键产出两个 exe，不再复制删改。
- 发布版：登录账号、无看板、不能切平台/切质检员/切作业员、只留一个内置管理员账号（用于改属性权限）、每 10 分钟自检更新。
