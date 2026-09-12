# 统一开发/发布 + 发布版自更新 实施任务

- [x] Task 1: 后端 RELEASE_MODE 注入机制
    - 1.1: `dashboard.py` 顶部加 `RELEASE_MODE = os.environ.get("LABEL_AUTO_RELEASE") == "1"`
    - 1.2: 新增 `hooks/dev.py`（置 0）
    - 1.3: 新增 `hooks/release.py`（置 1）

- [x] Task 2: 后端按 RELEASE_MODE 分支
    - 2.1: 看板路由仅在 `not RELEASE_MODE` 时注册
    - 2.2: `_QC_LOGIN` 在 release 时清空
    - 2.3: `qc_setup`/`anno_setup` release 时锁当前登录用户（admin 保留切换）
    - 2.4: `/` 首页按模式返回 `login.html` / `index.html`
    - 2.5: 新增 `/api/config` 返回 `{release: RELEASE_MODE}`
    - 2.6: `compile()` 校验语法

- [x] Task 3: 前端登录页 login.html
    - 3.1: 新增 `static/login.html`（复用 v2 登录页：登录自己账号 + 于荣华内置登录）

- [x] Task 4: 前端 qc.js/anno.js 读 config 控制显隐
    - 4.1: `qc.js` 读 `/api/config`，release 时隐藏质检员下拉 + 切换平台按钮
    - 4.2: `anno.js` 同理
    - 4.3: `qc.html`/`anno.html` 切换入口加 id
    - 4.4: `node --check` 校验

- [x] Task 5: 两个 spec 挂 hook
    - 5.1: `label-auto-dashboard.spec` 挂 `hooks/dev.py`
    - 5.2: 新增/改 `label-auto-v2.spec` 挂 `hooks/release.py`

- [x] Task 6: 发布版自更新（仅 release）
    - 6.1: 后台线程每 10 分钟检查一次
    - 6.2: 拉取 GitHub `version.json` 与本地版本比对
    - 6.3: 有新版本弹窗（更新内容 + 更新按钮）
    - 6.4: 点更新下载新 exe → `update.bat` 替换 → 提示重启
    - 6.5: `compile()` 校验语法

- [x] Task 7: 打包两个 exe 并验证
    - 7.1: 打包 `label-auto-dashboard.exe`（dev）
    - 7.2: 打包 `label-auto-v2.exe`（release）
    - 7.3: 确认两个 `dist/*.exe` 生成
