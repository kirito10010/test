# 详情面板常驻 + 照片完整显示

- [x] Task 1: 让详情面板常驻（不点击也占 2/5）
    - 1.1: `index.html` 中 `detailPanel` 移除 `hidden` 类
    - 1.2: `detailTitle` 加默认文案「照片详情」，`detailInfo` 加占位文案「点击左侧图片查看详情」
    - 1.3: 关闭按钮 `×` 改为「清空」

- [x] Task 2: 照片完整显示（contain 不裁切）
    - 2.1: `style.css` 中 `.detail-image-wrap img` 的 `object-fit: cover` 改为 `contain`

- [x] Task 3: 画布框叠加对齐 contain 并支持清空
    - 3.1: `app.js` 新增 `clearPreview()`（清空标题/图片/画布/信息，面板不隐藏）
    - 3.2: `$('detailClose').onclick` 改绑定 `clearPreview`
    - 3.3: `drawBoxes()` 中 `const scale = Math.max(...)` 改为 `Math.min(...)`
