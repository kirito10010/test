# exe 托盘运行 完成总结

## 目标
`label-auto-dashboard.exe` 与 `label-auto-v2.exe` 双击启动后：不显示控制台窗口，服务在系统托盘运行；右键托盘可「打开平台」「退出」。

## 完成内容

### 依赖
- 安装 `pystray` 0.19.5（`Pillow` 环境已有 12.2.0）。

### 后端（两个 `dashboard.py`）
- 新增 `_tray_image()`：按 frozen/开发态定位 `eternal-night-studio.ico`。
- 新增 `_run_tray(httpd, url)`：创建 `pystray.Icon`，菜单含「打开平台」「退出」；`icon.run()` 后 `httpd.shutdown()`。
- `main()`：`serve_forever()` 放守护线程，主线程跑托盘；托盘创建失败时回退 `serve_forever()`。

### spec（两个）
- `datas` 追加打包 `eternal-night-studio.ico`。
- `console=False`（隐藏控制台窗口）。

## 验证
- 两个 `dashboard.py` `compile()` 通过。
- 两个 exe 打包成功：`dist/label-auto-dashboard.exe`、`dist/label-auto-v2.exe`。

## 待用户确认
- 双击 exe：无黑框，托盘出现图标，浏览器自动打开平台。
- 右键托盘：可「打开平台」「退出」；退出后服务停止、图标消失。
