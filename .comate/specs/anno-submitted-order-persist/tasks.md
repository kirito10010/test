# 修复「已提交」列表刷新后刚提交的图掉到下面

- [x] Task 1: 在 label-auto-app 的 anno.js 增加 recentSubmits 的 localStorage 持久化
    - 1.1: 在 state 声明后新增 RECENT_KEY 与 loadRecentSubmits/saveRecentSubmits/loadProjectRecent/saveProjectRecent 四个 helper
    - 1.2: 新增 recordRecentSubmit(imageId) 函数（更新内存 + 写回 localStorage，上限 300）
    - 1.3: onProjectChange() 中读回当前项目的 recentSubmits
    - 1.4: save() 中把内存赋值替换为调用 recordRecentSubmit(imageId)

- [x] Task 2: 在 label-auto-dashboard 的 anno.js 应用同样修复
    - 2.1: 新增同样的 localStorage helper 与 recordRecentSubmit
    - 2.2: onProjectChange() 中读回当前项目的 recentSubmits
    - 2.3: save() 中调用 recordRecentSubmit(imageId)

- [x] Task 3: 校验改动并重新打包 label-auto-app.exe
    - 3.1: 检查两个 anno.js 语法与逻辑（node --check 或人工复核）
    - 3.2: 用 PyInstaller 重新打包 label-auto-app.exe
    - 3.3: 确认 dist 目录只含 label-auto-app.exe，无多余文件
