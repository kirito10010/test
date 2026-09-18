# 外接看板 · 标签巡检「未作业」筛选 + 「漏标告警」更名 完成总结

## 结论

两个问题都已修好，并在真实项目数据上验证、重新打包了发布版 exe。

1. **标签巡检看不到「未作业」** —— 根因是结果集来自平台导出的「人工已提交标注」，未作业图根本不在里面。现已把结果集改成整批图，状态筛选新增「未作业」。
2. **「漏标告警」名字不准** —— 已更名为「误通过核查」，并把输入框口径改成「禁止出现的标签」；功能逻辑不变。

## 关键事实（先查证再动手）

- 平台项目「车信箭头标注11」(`dafbede75eaa`)：10614 张图，只有 389 张是人工已提交（`annotated=true, pre_annotated=false`），另外 10225 张是 `annotated=false, pre_annotated=true`——即只有模型预标注框、作业员还没做的图。看板此前完全看不到这 10225 张。
- `/images` 的单图字段 `{image_id, annotated, box_count, qc_status, pre_annotated}` 是判定「未作业」的唯一可靠来源：未作业图 `qc_status=null`。
- 平台**没有**批量读取预标注的接口（`/annotation` 必须带 `image_id`，其余候选接口 404，`/images`、`/export` 的相关参数无效），所以「选标签 + 未作业」无法低成本实现，本次未做逐图扫描。
- 顺带发现：`车信箭头标注11` 的分类里叫「**前挡风玻璃遮挡**」，而老的「车信箭头标牌标注3」叫「前挡玻璃遮挡」，两个项目命名不同——误通过核查里手填标签时要注意。

## 改动清单

| 文件 | 改动 |
|---|---|
| `label-auto-dashboard/dashboard.py` | 新增 `_image_info_map`（替换 `_status_and_owner_maps`）；`query_images` 不选标签时补 `qc_status="unannotated"` 的未作业行；排序/时间窗只对人工已标注行拉 `/annotation`；`leak_images`→`false_pass_images`（+标签名校验）；路由 `/leak`→`/false_pass`；`VERSION` 1.2.1→1.2.2 |
| `label-auto-dashboard/static/index.html` | 状态下拉新增「未作业」；页签「漏标告警」→「误通过核查」；label/按钮文案、`leak*`→`fp*` id |
| `label-auto-dashboard/static/app.js` | `statusText` 加「未作业」；新增 `boxesText`（未作业行显示「预标注 N 框」/「无标注」）；小结显示未作业数量；「未作业 + 选标签 → 空」的原因提示； `doLeak`→`doFalsePass` |
| `label-auto-dashboard/static/style.css` | `.badge.unannotated`（灰底）；`input#fpCats` |
| `label-auto-dashboard/README.md`、`LabelAuto数据查询操作文档.md` | 同步名称与说明 |
| `version.json` | 1.2.2 + notes + 新下载地址 |
| `label-auto-dashboard/dist/*.exe` | 两个 exe 均已重新打包 |

## 验证结果（真实数据）

后端直调（项目 `dafbede75eaa`）：

- `query_images(pid, [])` → 10613 行，其中 `unannotated` 9968 行，其余为 `pending/passed`；未作业行的 `box_count` 是预标注框数（246 张预标注框数为 0）。
- `query_images(pid, ['前挡风玻璃遮挡'])` → 46 行，全部是 `passed/pending`，**没有**未作业行（符合预期：未作业图没有人工标注）。
- `false_pass_images(pid, ['前挡风玻璃遮挡'])` → 5 张（含该标签却被质检通过的图）。这就是这个功能要抓的「不该放行却被通过」。
- 标签写错（如写成「前挡玻璃遮挡」）→ 明确报错并列出本项目分类，不再静默返回「所有已通过图」。

HTTP 层（本地起服务实测）：

- `GET /api/projects/{id}/query` → 200，10613 行 / 9968 未作业。
- `GET /api/projects/{id}/false_pass?cats=前挡风玻璃遮挡` → 200，5 行；错误标签 → 400 + 「标签不存在：…」。
- 旧路由 `GET /api/projects/{id}/leak` → 404（已按计划删除，前端同步改名）。
- `node --check static/app.js`、`python -c "import ast…"` 语法校验通过。

打包验证：启动新打的 `label-auto-dashboard.exe`，`http://127.0.0.1:5221/static/app.js` 返回的内容已包含「未作业」「误通过核查」「false_pass」，`index.html` 含 `unannotated` 选项与 `falsePass` 页签、且不再含 `leak`。验证后已把所有测试进程杀掉（5221 只剩 TIME_WAIT，无残留监听）。

## 额外做的一处加固（超出原 doc.md 的「功能逻辑不变」）

`false_pass_images` 增加标签名校验：标签是手填的，写错时若静默返回空命中，`query_images` 会把「查全部」的结果当核查结果，输出「所有已通过的图」——这是假阳性最危险的形态（用户会去逐张核对一堆本来没问题的图）。现在写错直接报错。doc.md 4.3 已补充说明。

## 已知行为 / 注意点

- 未作业行也可以被勾选做「批量通过/打回」。给没有人工标注的图下通过结论属于误操作，本次未加拦截（按 doc.md 记录在案）。如果实际会误点，可以再加一道「未作业图不可批量通过」的保护。
- 「选标签 + 未作业」恒为空，界面会提示原因（未作业图没有人工标注）。若以后真要按**模型预标注**匹配（例如「模型预标了 X、作业员还没做」的图），需要逐图调 `/annotation`（该项目约 1 万次，1~3 分钟，平台压力较大），要单独排一个 spec 来做。
- 「查全部」在未作业项目上的行数会明显变大（该项目从 389 行变成 10613 行），这是「看到整批」的必然结果；大项目本来就是几万行。
- **发版还没做**：`version.json` 已指向 `v1.2.2` 的下载地址，需要你在 GitHub 上建 `v1.2.2` release 并上传 `label-auto-v2.exe`，否则别人点「更新」会下不到文件（`VERSION` 与 `version.json` 都已改好，本地 exe 已重新打包）。
