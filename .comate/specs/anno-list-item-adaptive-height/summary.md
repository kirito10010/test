# 总结：作业平台右侧列表长文件名换行时自适应高度

## 问题

作业平台右侧列表里，长文件名换行后文字溢出条目、与相邻条目重叠。

## 根因

`.anno-list-items` 是纵向 flex 布局，`.anno-item` 默认 `flex-shrink: 1`，条目多时被压缩到容器高度内；`min-height: 42px` 只保证最低 42px，2 行文件名需要约 59px，于是第二行文字溢出。

## 改动

给两处 `.anno-item` 增加 `flex-shrink: 0`，禁止条目被压缩到低于内容高度：

- `label-auto-app/static/anno.css`
- `label-auto-dashboard/static/anno.css`

短文件名仍保持原 42px 单行高度不变；长文件名换行时条目自动长高，文字完整显示。

## 打包

- 5221 端口无残留进程。
- PyInstaller 重新打包 `dist/label-auto-app.exe`，dist 目录只含这一个文件。
- 已清理 `build/` 目录。
