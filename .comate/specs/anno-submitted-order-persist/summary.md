# 总结：修复「已提交」列表刷新后刚提交的图掉到下面

## 问题

作业平台（作业员视角）「已提交」页签里，刚提交的图刷新后从最上面掉到中间位置。

根因：刚提交的图靠前端内存数组 `state.recentSubmits` 钉在最上面，该数组刷新即丢失；后端 `anno_assigned()` 返回的是固定的分配顺序，与提交时间无关。

## 改动内容

### 1. `label-auto-app/static/anno.js`
- 新增 localStorage 持久化 helper（键 `anno_recent_submits`，按项目隔离，上限 300）。
- `onProjectChange()` 读回当前项目 `recentSubmits`。
- `save()` 改为调用 `recordRecentSubmit(imageId)`（更新内存 + 写回 localStorage）。

### 2. `label-auto-dashboard/static/anno.js`
- 同样的三处改动。

### 3. 清理与打包
- `label-auto-app/dashboard.py`：修正过时的注释（token/最近提交不再落盘）。
- 删除遗留的 `label-auto-app/recent_submits.json`（2 字节空数组）。
- 停掉运行中的两个 `label-auto-app.exe` 实例（PID 15232、16676，端口 5221）。
- 用 PyInstaller 重新打包 `dist/label-auto-app.exe`（10,171,461 字节），dist 目录仅此一个文件。
- 删除 `build/` 目录与临时探针脚本。

## 验证
- 两个 `anno.js` 均通过 `node --check` 语法检查。
- `dist` 目录只含 `label-auto-app.exe`，无多余文件。

## 结果
作业员提交图片后，切到「已提交」显示在最上面；刷新后仍从 localStorage 读回，保持最上面；换项目互不串数据；不产生任何本地多余文件。
