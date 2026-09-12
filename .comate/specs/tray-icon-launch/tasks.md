# exe 托盘运行 实施任务

- [x] Task 1: 安装托盘依赖
    - 1.1: `pip install pystray`
    - 1.2: 验证 `import pystray` / `from PIL import Image` 成功

- [x] Task 2: label-auto-dashboard 后端改托盘模式
    - 2.1: 新增 `_tray_image()`（按 frozen 定位 ico）
    - 2.2: 新增 `_run_tray(httpd, url)`（打开平台/退出菜单）
    - 2.3: `main()` 改为 httpd 守护线程 + 托盘主循环
    - 2.4: `python -c "compile()"` 校验语法

- [x] Task 3: label-auto-dashboard spec 改隐藏窗口
    - 3.1: `datas` 追加打包 `eternal-night-studio.ico`
    - 3.2: `console=False`

- [x] Task 4: label-auto-v2 后端改托盘模式
    - 4.1: 同 Task 2 的三处改动
    - 4.2: `compile()` 校验语法

- [x] Task 5: label-auto-v2 spec 改隐藏窗口
    - 5.1: `datas` 追加打包 ico
    - 5.2: `console=False`

- [x] Task 6: 重新打包两个 exe
    - 6.1: 结束运行中的 dashboard/v2 进程
    - 6.2: `python -m PyInstaller --clean --noconfirm label-auto-dashboard.spec`
    - 6.3: `python -m PyInstaller --clean --noconfirm label-auto-v2.spec`
    - 6.4: 确认两个 `dist/*.exe` 生成
