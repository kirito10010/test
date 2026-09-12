# 拆分为两个独立端 + 账号登录改造 — 完成总结

## 目标

从三合一 `label-auto-dashboard` 复制出两个独立副本，各自只保留一个平台，并改为「本人账号登录」。

## 产物

```
d:\Project\test\
├── label-auto-dashboard\   （保留，未动）
├── label-auto-qc\          （质检平台，独立）
│   ├── dashboard.py
│   ├── 启动看板.bat / 关闭看板.bat
│   └── static\{viewer.js, qc.html, qc.css, qc.js}
└── label-auto-anno\        （作业平台，独立）
    ├── dashboard.py
    ├── 启动看板.bat / 关闭看板.bat
    └── static\{viewer.js, anno.html, anno.css, anno.js}
```

## 改动要点

### 后端（两个副本各自的 dashboard.py）

- 删除全部内置账号：`QC_EMAIL`/`QC_PASSWORD`/`_QC_LOGIN`/`_QC_TOKENS`/`_get_qc_token`、`账号.md`、`/api/autologin`、`/api/qc/reviewer_login`、`/api/qc/fix`、登录门槛 `_is_local`/`_qc_gated`。
- 新增 token 持久化：`token.json`（登录写入、登出删除、启动加载），重启不掉登录。
- `/api/login` 登录写入 token；`/api/me` 判断登录态；`/api/logout` 登出清 token；数据接口未登录返回 `need_login`。
- `qc_setup`/`anno_setup` 按登录用户的 `is_qc`/`is_assigned` 过滤项目。
- 质检/作业的 uid 改用登录用户 `USER["id"]`，不再由前端传 `uid`。

### 前端（qc.js / anno.js + 对应 html/css）

- 新增登录视图（邮箱/密码 + 登录按钮），顶栏加「退出登录」和当前用户名。
- 打开先 `/api/me`：已登录进主界面，未登录显示登录页。
- 移除「质检员/作业员」下拉与相关登录门槛逻辑，接口不再带 uid。
- 删除跨平台链接、数据看板与另一平台文件。

## 验证

- `py_compile` 通过（两份 dashboard.py），`node --check` 通过（qc.js / anno.js / viewer.js）。
- 目录结构核对：每个副本只含对应平台的静态文件 + 公共 viewer.js。

## 说明

- 两个副本都监听 `0.0.0.0:5221`，默认双击 `启动看板.bat` 即可；qc 打开 `/qc`，anno 打开 `/anno`。
- 登录 token 存于各副本目录下 `token.json`，退出登录即删除。
- 上游 `/api/projects` 用本人 token 返回全部项目并带 `is_qc`/`is_assigned` 标记，据此过滤「账号下的项目」。
