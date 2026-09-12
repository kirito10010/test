# 质检平台（QC Platform）—— 总结

## 完成内容

在现有看板基础上新增了一个独立的质检工作台页面（`/qc`），支持：

1. 打开即自动登录**于荣华**账号（admin/owner）。
2. 选项目 → 选质检员 → 开始质检。
3. 一次显示 **4 张未质检图**（2×2 占满屏幕），每张带标注框 + 通过/打回切换。
4. 点「提交」一次性质检这 4 张。
5. 图片支持：滚轮以鼠标为中心缩放、右键拖动平移；点开看全屏大图同样支持。
6. 可切页签浏览该质检员的**已通过 / 已打回**（分页加载）。

## 改动文件

- `dashboard.py`：新增常量 `QC_EMAIL`/`QC_PASSWORD`；新增 `qc_setup()`、`qc_assigned()`；新增路由 `/api/qc/autologin`、`/api/qc/setup`、`/api/qc/assigned`、`/api/qc/submit`；`/qc` 返回 `static/qc.html`；新增 `_handle_qc_submit()`。
- `static/qc.html`（新增）：页面骨架。
- `static/qc.css`（新增）：布局与查看器样式。
- `static/qc.js`（新增）：逻辑 + 图片缩放平移组件。

## 校验

- `python -m py_compile dashboard.py` 通过。
- `node --check qc.js` 通过。
- 用真实数据验证了 `qc_assigned` 的状态归类逻辑（pending/passed/rejected 正确，未提交的图不出现）。

## 使用方式

启动看板后访问 `http://127.0.0.1:5221/qc`（端口可能因占用自动 +1）。

## 说明

- 「未质检」= 平台 `qc_status == pending`（作业员已提交、待质检）；作业员尚未提交的图不会出现（它们还不算待质检）。
- 已打回是当前态（作业员修复后会回到未质检）。
- 于荣华凭证目前内置在后端 `QC_EMAIL`/`QC_PASSWORD`，可后续抽到配置文件。
