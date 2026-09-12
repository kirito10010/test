# 总结：外接看板照片详情改弹窗 + 顶栏优化

## 需求

1. 去掉看板右侧常驻照片详情面板，改成点击数据行弹窗显示。
2. 顶栏补「作业平台」按钮。
3. 去掉顶栏登录/退出框（默认自动登录于荣华）。
4. 作业平台按钮放在质检平台前面。

## 改动

### index.html
- 顶栏去掉 `.auth`，改为 `.topbar-links`（作业平台在前、质检平台在后）。
- 删除 `#detailPanel` 侧边面板。
- 新增 `#previewModal` 弹窗（标题/图片/canvas/信息/关闭按钮）。

### app.js
- 删除 `doLogin`/`doLogout`/`applyAuth` 及登录事件绑定；`boot()` 自动登录后直接显示 `projectBar` 并加载项目。
- `openPreview` 改用弹窗元素；`clearPreview` 改为 `closePreview`（隐藏弹窗）；`drawBoxes` 改用 `#previewCanvas`/`#previewImageWrap`。
- 绑定 `#previewClose` 与点击弹窗背景关闭。

### style.css
- 新增 `.topbar-links`、`.preview-image-wrap`（img/canvas）样式；删除 `.auth` 样式。

## 校验与打包

- `app.js` 通过 `node --check`；`index.html` 无残留旧元素引用。
- PyInstaller 重新打包 `dist/label-auto-dashboard.exe`（带图标），dist 仅此一个文件；已清理 `build/`。

## 结果

- 看板点击数据行弹出照片详情弹窗，无常驻侧边面板。
- 顶栏只有「作业平台」「质检平台」两个按钮（作业平台在前），无登录框，默认自动登录于荣华账号。
