# 作业平台（标注端）— 完成总结

## 目标

在已有「质检平台」「数据看板」之外，新增第三个平台「作业平台」，供作业员/标注员做框标注，并在被打回后重新标注再提交。

## 改动文件

- `dashboard.py`：新增 `anno_setup()`、`anno_assigned()`，新增路由 `/api/anno/setup`、`/api/anno/assigned`、`/anno` 静态页；登录门槛复用 `_qc_gated` 与 `/api/qc/reviewer_login`。
- `static/viewer.js`（新增）：从 qc.js 抽出的 `colorFor` + `createViewer`（画框/移动/四角四边缩放/双击删除全逻辑），两平台共用。
- `static/qc.js`：移除 `colorFor` + `createViewer`（改由 viewer.js 提供）。
- `static/qc.html`：引入 `viewer.js`，并加「作业平台」入口链接。
- `static/anno.html` / `anno.css` / `anno.js`（新增）：三栏布局 + 顶栏 + 属性按钮 + 图片列表 + 设置面板 + 登录框。

## 实现要点

- 三栏布局：左属性、中照片、右列表；顶栏左项目/作业员、右设置。
- 属性快捷键按项目隔离，存 `anno_shortcuts`，与质检的 `qc_shortcuts` 完全独立；默认数字键+字母，切项目自动载入，设置可改、可恢复默认。
- 照片操作复用 `createViewer`（editable），画框/移动/缩放/删除与质检一致。
- C 提交（可改）→ `POST /api/qc/save` 保存并回到未质检，自动从列表移除并加载下一张。
- 登录门槛：局域网 + 未内置账号弹登录，127.0.0.1 豁免，逻辑与质检一致。

## 验证

- `node --check` 通过（anno.js / viewer.js / qc.js），`py_compile` 通过（dashboard.py）。
- 后端数据探测确认：`/api/projects` 的 `assignees`/`assignments` 结构正确；`/images` 的 `annotated`（bool）/`qc_status` 用于区分未作业与已提交被打回。
