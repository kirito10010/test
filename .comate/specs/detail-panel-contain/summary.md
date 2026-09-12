# 详情面板常驻 + 照片完整显示 —— 总结

## 完成内容

1. 详情面板改为常驻：不再 `hidden`，打开看板即占右侧 2/5 位置，无图时为占位态。
2. 照片完整显示：`object-fit: cover` → `contain`，竖图上下顶格、横图左右顶格，另一方向留黑边，不再裁切。
3. 框叠加对齐 contain：`drawBoxes` 的 scale 从 `Math.max`（cover）改为 `Math.min`（contain），框与图精确对齐。
4. 关闭按钮 `×` 改为「清空」，清空图片/画布/信息，面板仍常驻。

## 改动文件

- `static/index.html`：`detailPanel` 移除 `hidden`；标题/信息加默认文案；按钮改为「清空」。
- `static/style.css`：`.detail-image-wrap img` 的 `object-fit` 改为 `contain`。
- `static/app.js`：新增 `clearPreview()`；`$('detailClose').onclick` 改绑 `clearPreview`；`drawBoxes` 的 scale 改为 `Math.min`。
