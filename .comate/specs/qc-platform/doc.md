# 质检平台（QC Platform）

## 需求场景

在现有外接看板（`label-auto-dashboard`）基础上，新增一个独立的**质检工作台**页面：

1. 默认登录**于荣华**账号（admin/owner）。
2. 选项目 → 选该项目的某个**质检员** → 开始质检。
3. 一次显示 **4 张未质检图**，尽量占满屏幕空间（2×2）。
4. 每张图上有**通过/打回**切换按钮。
5. 检查完 4 张、选好 verdict 后点**提交**，一次性质检这 4 张。
6. 图片支持：点开看大图；大图与缩略图都支持**鼠标滚轮以鼠标位置为中心缩放**、**右键拖动平移**。
7. 同时能看该质检员的**全部数据**：未质检 / 已通过 / 已打回。

## 关键数据源（已探测确认）

- 登录 `POST /api/login`（于荣华 admin）。
- `GET /api/projects`：项目列表；`qc_assignees` = uid 列表，`qc_assignments` = `{uid: [文件]}`。
- `GET /api/admin/monitoring`：`qc_assignees` 带 `{uid, name, assigned, passed, rejected, reviewed}`（用于 uid→姓名 + 计数）。
- `GET /api/projects/{id}/images`（**owner 登录返回全项目图**，含每张 `qc_status`）。
- `GET /api/projects/{id}/image?image_id=X`：图片字节（JPEG）。
- `GET /api/projects/{id}/annotation?image_id=X`：`boxes:[{category, bbox:{x1,y1,x2,y2} 归一化, source}]` + `qc_status`。
- `POST /api/projects/{id}/qc` `{image_id, verdict:"pass"|"reject", reason}`（owner 可调，一张一调，批量=循环）。

## 后端设计（扩展 dashboard.py）

新增路由：

1. `GET /api/qc/autologin`：服务端用**于荣华**账号登录，设置全局 TOKEN，返回 `{ok, user}`。
2. `GET /api/qc/setup`：返回 `{projects:[{id,name,reviewers:[{uid,name,assigned,passed,rejected}]}]}`（合并 projects + monitoring 的姓名/计数）。
3. `GET /api/qc/assigned?pid=&uid=&status=pending|passed|rejected&offset=&limit=`：
   - 从 `qc_assignments[uid]` 取该质检员的文件列表，按 `/images` 的 `qc_status` 归类，返回 `{total, items:[image_id]}`（分页）。
4. `POST /api/qc/submit` `{pid, verdicts:[{image_id, verdict}]}`：循环调 `/qc`，返回成功/失败列表。
5. 复用现有 `/api/projects/{id}/image`、`/annotation` 路由（图片与框）。
6. `GET /qc`：返回 `static/qc.html`（质检页）。

复用现有 `/image`、`/annotation` 路由（图片与框）。

## 前端设计

新增 `static/qc.html` + `static/qc.js` + `static/qc.css`：

**布局**
- 顶部：项目下拉、质检员下拉、状态页签（未质检 / 已通过 / 已打回）。
- 未质检页签 = **质检工作区**：2×2 四张图占满可用空间；底部「提交」按钮。
- 已通过/已打回页签 = 浏览网格（每行 4 张，点开看大图），支持「加载更多」。

**单图组件（可缩放平移 + 标注框叠加）**
- 每张图一个 `.viewer`（overflow:hidden，固定区域），内部 `.stage` 用 `transform: scale(s) translate(tx,ty)`（`transform-origin:0 0`）承载 `<img>` 和 `<canvas>`（框层）。
- 滚轮缩放：以鼠标位置为中心，`scale` 变化时同步调整 `tx/ty` 使光标下点不动。
- 右键拖动平移：改 `tx/ty`；右键菜单禁用。
- 框叠加：把归一化 bbox × 图片自然尺寸画在 canvas 上（与图同在一个 stage，自动随缩放平移）。
- 点开大图 = 全屏遮罩层放同一组件（更大容器）。

**交互**
- 每张未质检图：右上角「通过 / 打回」切换（默认通过），框随图显示。
- 提交：把所有 4 张当前 verdict 一次性 POST `/api/qc/submit`；成功后刷新，拉下 4 张未质检。
- 切换质检员/项目时重新加载 setup 与该员数据。

## 边界与异常

- 未质检不足 4 张：显示剩余张数；0 张时提示「该质检员暂无未质检图」。
- 提交中禁止重复点击；提交失败逐条提示。
- 图片加载失败：显示占位。
- 于荣华凭证内置在后端（内部工具），可后续抽到配置。
- `rejected` 是当前态（作业员修复后会回到 pending），计数会动态变化。

## 受影响文件

- `d:\Project\test\label-auto-dashboard\dashboard.py`：新增上述路由。
- `d:\Project\test\label-auto-dashboard\static\qc.html`（新增）
- `d:\Project\test\label-auto-dashboard\static\qc.js`（新增）
- `d:\Project\test\label-auto-dashboard\static\qc.css`（新增）

## 预期结果

- 打开 `/qc` 自动以于荣华登录 → 选项目 → 选质检员 → 看到 4 张未质检图（带框），每张可切通过/打回，点提交一次质检 4 张；可缩放平移看图；可切页签浏览该员的已通过/已打回。
