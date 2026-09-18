# 外接看板 · 标签巡检「未作业」筛选 + 「漏标告警」更名 实施任务

- [x] Task 1: 后端新增 `_image_info_map`，替换 `_status_and_owner_maps`
    - 1.1: 删除 `dashboard.py` 里的 `_status_and_owner_maps`
    - 1.2: 新增 `_image_info_map(pid)`，用 `get_images(pid)` 生成 `image_id -> {annotated, box_count, qc_status, pre_annotated}`
    - 1.3: 用 `python -c "import ast; ast.parse(open(...).read())"` 校验语法

- [x] Task 2: 后端 `query_images` 结果集补「未作业」行
    - 2.1: 取数改为 `_image_info_map` + `build_qc_owner_map`
    - 2.2: 导出行状态改取 `img_info`，无值时仍落回 `?`（保持原行为）
    - 2.3: 不选标签时，把 `annotated=False` 的图补成 `qc_status="unannotated"` 行（带 `box_count`、`pre_annotated`），用 `seen_bases` 去重
    - 2.4: `passed_minutes` / `sort=reviewed_desc` 的 `fetch_annotations` 只传非未作业行；排序键改 `r.get("reviewed_at") or ""`
    - 2.5: 校验语法

- [x] Task 3: 后端「漏标」更名
    - 3.1: `leak_images` → `false_pass_images`（实现不变，改 docstring）
    - 3.2: 路由 `/api/projects/{id}/leak` → `/false_pass`，同步注释
    - 3.3: 校验语法
    - 3.4: 追加：标签名写错时明确报错（避免空命中被当成「查全部」而把全部已通过图当核查结果）

- [x] Task 4: 前端 `index.html`
    - 4.1: `#queryStatus` 在「全部」后新增 `<option value="unannotated">未作业</option>`
    - 4.2: 页签 `data-tab="leak">漏标告警` → `data-tab="falsePass">误通过核查`
    - 4.3: 区块 id/注释改 `tab-falsePass`；label 改「禁止出现的标签（逗号分隔）」；输入框 id `leakCats`→`fpCats`；按钮文案「扫描漏标」→「开始核查」、id `leakBtn`→`fpBtn`
    - 4.4: `leakSummary`→`fpSummary`、`leakTable`→`fpTable`

- [x] Task 5: 前端 `app.js`
    - 5.1: `statusText` 增加 `unannotated: '未作业'`
    - 5.2: 新增 `boxesText(r)`（未作业行显示「预标注 N 框」/「无标注」），表格行与 `exportQueryCsv` 都改用它
    - 5.3: `renderQuery` 小结加未作业数量；新增「未作业 + 已选标签 → 空结果」的原因提示
    - 5.4: `doLeak` → `doFalsePass`：请求 `/false_pass`、toast「核查中…」、小结「含禁止标签且已质检通过的图：N 张」、DOM id 换 `fp*`
    - 5.5: 事件绑定 `$('leakBtn')` → `$('fpBtn')`
    - 5.6: `node --check static/app.js` 校验语法

- [x] Task 6: 前端 `style.css`
    - 6.1: 新增 `.badge.unannotated { background: var(--muted); }`
    - 6.2: `input#leakCats` → `input#fpCats`

- [x] Task 7: 文档同步
    - 7.1: `label-auto-dashboard/README.md` 功能表：标签巡检补「未作业」状态说明；「漏标告警」行改为「误通过核查」并改描述
    - 7.2: `LabelAuto数据查询操作文档.md` 第 9 节「漏标」用词改为「误通过」

- [x] Task 8: 实测验证
    - 8.1: 直接调 `dashboard.query_images('dafbede75eaa', [])`，确认总行数 ≈ `/images` 总数、未作业行 `qc_status="unannotated"`、导出行的状态取自 `/images`
    - 8.2: 调 `query_images('dafbede75eaa', ['前挡玻璃遮挡'])`，确认结果里没有未作业行
    - 8.3: 调 `false_pass_images(...)` 与旧 `leak_images` 对比，确认结果一致（更名不改行为）
    - 8.4: 起本地 HTTP 服务（不走托盘）验证 `/api/projects/{id}/false_pass?cats=` 路由与新 `/query` 返回；确认旧 `/leak` 已 404

- [x] Task 9: 打包与版本号（**需你确认后再执行**）
    - 9.1: 确认是否升 `VERSION` 1.2.1 → 1.2.2 并更新 `version.json`
    - 9.2: `python -m PyInstaller --clean --noconfirm label-auto-dashboard.spec` 与 `label-auto-v2.spec`
    - 9.3: 确认 `dist/` 下两个 exe 已更新
