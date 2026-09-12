# 详情面板常驻 + 照片完整显示

## 需求场景

当前右侧照片详情面板初始是 `hidden`，只有点击左侧某条数据后才会出现（占 2/5 宽度）。用户希望：

1. **不点击就预留出 2/5 位置**：详情面板始终可见，不随点击显隐。
2. **照片要完整显示（不被裁切）**：
   - 竖图 → 上下顶格（填满高度），左右留黑边；
   - 横图 → 左右顶格（填满宽度），上下留黑边；
   - 不能出现「一个方向顶格、另一个方向溢出」的裁切。

## 处理逻辑

当前用的是 `object-fit: cover`（裁切式铺满），且画布框叠加用的是 cover 变换（`scale = Math.max(...)`）。需改为 **contain**（完整显示、等比缩放、留边）：

1. **面板常驻**
   - `index.html`：去掉 `detailPanel` 上的 `hidden` 类；给标题/信息区加默认占位文案。
   - `app.js`：`openPreview` 里 `panel.classList.remove('hidden')` 变为无害 no-op（保留亦可）。
   - 关闭按钮 `×` 改为「清空」：不再 `classList.add('hidden')`，改为清空图片/画布/信息，面板仍占位。

2. **照片完整显示**
   - `style.css`：`.detail-image-wrap img` 的 `object-fit: cover` → `object-fit: contain`。

3. **画布框叠加对齐 contain**
   - `app.js` `drawBoxes()`：`const scale = Math.max(Wc / Wi, Hc / Hi)` → `Math.min(Wc / Wi, Hc / Hi)`。
     - contain 下 `dw/dh` 是等比缩放后的实际显示尺寸，`ox/oy` 是居中偏移，与 `object-fit: contain` 的 letterbox 完全一致。

## 架构与技术方案

- 保持 flex 布局不变（`content-col` flex:3 + `detail-panel` flex:2，即右侧 2/5）。
- `object-fit: contain` 让 `<img>` 元素仍占满 `detail-image-wrap`，图片内容在其中等比居中、完整可见；`<canvas>` 绝对定位铺满同一容器，按 contain 变换绘制框，保证框与图对齐。

## 受影响文件

- `d:\Project\test\label-auto-dashboard\static\index.html`
  - `detailPanel` 移除 `hidden`；`detailTitle`/`detailInfo` 加默认占位文案；关闭按钮文案改为「清空」。
- `d:\Project\test\label-auto-dashboard\static\style.css`
  - `.detail-image-wrap img` 的 `object-fit: cover` → `contain`。
- `d:\Project\test\label-auto-dashboard\static\app.js`
  - 新增 `clearPreview()`（清空标题/图片/画布/信息，面板不隐藏）。
  - `$('detailClose').onclick` 改绑定 `clearPreview`。
  - `drawBoxes()` 的 scale 由 `Math.max` → `Math.min`。

## 边界条件与异常处理

- 未选中图片时：`<img>` 无 `src`，画布清空，信息区显示「点击左侧图片查看详情」。
- `naturalWidth`/`naturalHeight` 为 0（图片未加载/失败）：`drawBoxes` 现有提前返回逻辑保持不变，不画框。
- 竖图/横图/方图：contain 统一处理，框叠加始终与图片对齐。

## 预期结果

- 打开看板即看到右侧常驻的 2/5 详情面板（无图时为占位态）。
- 点击数据后，照片完整显示：竖图上下顶格左右留黑，横图左右顶格上下留黑，框与图精确对齐。
