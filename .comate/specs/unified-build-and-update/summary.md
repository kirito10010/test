# 统一开发/发布 + 发布版自更新 完成总结

## 目标
把 `label-auto-dashboard`（开发版）和 `label-auto-v2`（发布版）合并成一个代码库，用 `RELEASE_MODE` 开关区分，一套代码一键出两个 exe；发布版带自更新。

## 完成内容

### 后端 `label-auto-dashboard/dashboard.py`
- 顶部新增 `RELEASE_MODE`（由 runtime hook 注入环境变量）、`VERSION`、`UPDATE_URL`。
- `_QC_LOGIN` 发布版清空。
- 看板路由（monitoring/query_progress/images/query/leak/distribution/search/preload/export/batch_qc）仅开发版注册。
- `qc_setup`/`anno_setup` 发布版按当前登录用户锁定（admin 保留切换）。
- `/` 首页按模式返回 `login.html` / `index.html`；新增 `/api/config`。
- `_route` 解析 Authorization/X-User-Id/X-User-Role；`_qc_gated` 发布版检查 token。
- 发布版自更新：后台线程每 10 分钟检查 `version.json`，有新版本用 MessageBox 弹窗（更新内容 + 更新按钮），下载到 `.new` 后用 `update.bat` 替换重启。

### 前端
- 新增 `static/login.html`（发布版登录页）。
- `qc.js`/`anno.js`：加 auth helpers、`RELEASE` 标志、`/api/config` 判断；发布版登录校验 + 隐藏切换入口（下拉/平台按钮）+ 退出。
- `qc.html`/`anno.html`：切换按钮加 id + 新增退出链接。

### 构建
- `hooks/dev.py` / `hooks/release.py` 注入 RELEASE_MODE。
- `label-auto-dashboard.spec`（dev）、`label-auto-v2.spec`（release）两个 spec。

## 验证
- `dashboard.py` `compile()` 通过。
- `qc.js`/`anno.js` `node --check` 通过。
- 两个 exe 打包成功：`dist/label-auto-dashboard.exe`、`dist/label-auto-v2.exe`。

## 待用户确认 / 后续
- 自更新的 `UPDATE_URL` 还是占位空串，等 GitHub 仓库/`version.json` 地址定了之后填入。
- 旧的 `label-auto-v2/` 目录已弃用，可删除（其逻辑已合并回 dashboard）。
- 建议实际跑一遍：开发版有看板/可切换；发布版需登录、无看板、不能切换。
