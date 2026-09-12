# exe 托盘运行（不显示窗口，右键托盘退出）

## 1. 需求场景与处理逻辑

`label-auto-dashboard.exe` 与 `label-auto-v2.exe` 双击启动后：

- **不弹出控制台窗口**，服务在后台运行，右下角系统托盘出现图标。
- 启动后仍自动打开浏览器进入平台（dashboard 打开看板，v2 打开质检平台）。
- 托盘图标**右键菜单**：`打开平台`（重新打开浏览器）、`退出`（停止服务并退出程序）。

## 2. 架构与技术方案

### 2.1 托盘库
- 使用 `pystray`（托盘） + `Pillow`（图标图片，环境已装 12.2.0）。
- 需 `pip install pystray`（Windows 后端走 ctypes，无额外运行时依赖）。

### 2.2 进程模型
- HTTP 服务 `httpd.serve_forever()` 放到**守护线程**里跑。
- 主线程跑 `icon.run()`（托盘消息循环，阻塞直到「退出」）。
- 「退出」回调里 `icon.stop()` 后 `httpd.shutdown()`，进程自然结束。

### 2.3 隐藏窗口
- 两个 `.spec` 的 `EXE(..., console=True)` 改为 `console=False`。

### 2.4 托盘图标
- 复用项目内 `eternal-night-studio.ico`：PyInstaller 里通过 `datas` 打进包，运行时用 `sys._MEIPASS` 定位，`PIL.Image.open()` 加载。
- 开发态直接读 `HERE/eternal-night-studio.ico`。

## 3. 影响文件

| 文件 | 改动 |
|---|---|
| `label-auto-dashboard/dashboard.py` | `main()` 改为托盘模式 |
| `label-auto-dashboard/label-auto-dashboard.spec` | `console=False` + datas 打包 ico |
| `label-auto-v2/dashboard.py` | `main()` 改为托盘模式 |
| `label-auto-v2/label-auto-v2.spec` | `console=False` + datas 打包 ico |

## 4. 实现细节

```python
import pystray
from PIL import Image

def _tray_image():
    if getattr(sys, "frozen", False):
        p = os.path.join(sys._MEIPASS, "eternal-night-studio.ico")
    else:
        p = os.path.join(HERE, "eternal-night-studio.ico")
    return Image.open(p)

def _run_tray(httpd, url):
    def on_open(icon, item):
        webbrowser.open(url)
    def on_quit(icon, item):
        icon.stop()
    icon = pystray.Icon("label_auto", _tray_image(), "Label Auto",
                        pystray.Menu(pystray.MenuItem("打开平台", on_open),
                                     pystray.MenuItem("退出", on_quit)))
    icon.run()
    httpd.shutdown()

def main():
    # ... 找端口、建 httpd ...
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    _run_tray(httpd, url)
```

spec 改动：
```python
a = Analysis(..., datas=[('static', 'static'), ('eternal-night-studio.ico', '.')], ...)
exe = EXE(..., name='label-auto-dashboard', icon='eternal-night-studio.ico', console=False, ...)
```

## 5. 边界条件与异常处理

- 端口占用：仍按 `PORT_START..+30` 依次尝试；全占用则 `return`（无窗口，用户无感知，可看日志）。
- 图标文件缺失：`Image.open` 失败会抛异常，进程退出；用 try 包裹，失败时退化为无托盘直接 serve（可保留一个最小兜底）。
- 无控制台后错误不可见：托盘图标创建失败时，回退到直接 `serve_forever()`（仍可通过浏览器访问，用任务管理器结束）。

## 6. 数据流

双击 exe → `main()` → 起 httpd 线程 → 建托盘图标 → 自动开浏览器 → `icon.run()` 阻塞 → 右键「退出」→ `icon.stop()` → `httpd.shutdown()` → 退出。

## 7. 预期结果

- 双击 exe：无黑框，托盘出现图标，浏览器自动打开平台。
- 右键托盘：可「打开平台」「退出」；退出后服务停止、图标消失。
