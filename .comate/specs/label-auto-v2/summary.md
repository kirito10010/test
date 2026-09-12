# 第二版正式版 label-auto-v2 完成总结

## 目标
以 `label-auto-dashboard`（主线版）为基底，复制出第二版正式版 `label-auto-v2`：登录优先、去掉看板、去掉内置账号（仅保留于荣华内置登录）、QC/anno 按当前登录用户身份操作。

## 完成内容

### 后端 `label-auto-v2/dashboard.py`
- `_QC_LOGIN = {}` 清空内置账号。
- 新增 `_current_uid()`。
- `qc_setup()` / `anno_setup()` 按当前登录用户返回有权限的项目（admin 返回全部并附质检员/作业员列表供巡查）。
- 去掉看板路由（monitoring/query_progress/images/query/leak/distribution/search/preload/export/batch_qc），保留 `get_monitoring`/`get_export_labels` 供名字映射与属性筛选。
- `_route` 解析 `Authorization`/`X-User-Id`/`X-User-Role` 请求头，`_qc_gated` 改为检查 token。
- `/api/qc/autologin` 返回 token（供于荣华一键登录）。

### 前端
- `index.html` 重写为登录页（邮箱/密码 + 于荣华一键登录），按角色跳转。
- 删除 `app.js`、`style.css`。
- `qc.js`/`anno.js`：登录态检查跳转、`api()` 带登录头、去掉质检员/作业员下拉（非 admin 隐藏）、退出登录。
- `qc.html`/`anno.html`：看板链接改为「退出」。

## 验证
- `dashboard.py` `compile()` 通过。
- `qc.js`/`anno.js` `node --check` 通过。
- PyInstaller 打包成功，生成 `dist/label-auto-v2.exe`。

## 待用户确认
- 打开 `label-auto-v2.exe`，登录页用作业员/质检员账号登录 → 按角色进入对应平台。
- 于荣华一键登录 → 进入质检平台，可切换质检员巡查/改属性。
- 无看板、无内置账号（仅于荣华）。
