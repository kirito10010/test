# 外接看板：照片详情改弹窗 + 顶栏加作业平台按钮 + 去掉登录框

## 需求（4 点）

1. 去掉看板右侧（常驻）照片详情面板，改成**点击一条数据后弹窗**显示照片详情。
2. 顶栏补一个「作业平台」按钮（现在只有「质检平台」）。
3. 去掉顶栏右侧的邮箱/密码/登录/退出（访问时默认已自动登录于荣华账号）。
4. 调整按钮位置：作业平台按钮放在质检平台按钮**前面**。

## 定位

`label-auto-dashboard/static/` 下的数据看板：`index.html` + `app.js` + `style.css`。

现状：

- `index.html` 顶栏有 `#detailPanel`（右侧详情面板）和 `.auth`（登录框）。
- `app.js` 里 `openPreview()` 打开右侧面板、`doLogin/doLogout/applyAuth` 处理登录。
- `style.css` 已存在 `.modal` / `.modal-box` 等弹窗样式（可复用）。

## 方案

### index.html

1. 顶栏改为：

```html
<header class="topbar">
  <div class="brand">Label Auto <span>外接看板</span></div>
  <div class="topbar-links">
    <a class="btn link-btn" href="/anno">作业平台</a>
    <a class="btn link-btn" href="/qc">质检平台</a>
  </div>
</header>
```

（删掉 `.auth`，新增作业平台按钮，且在质检平台前面。）

2. 删除 `#detailPanel` 整个 `<aside>`。

3. 在 `#toast` 前加照片预览弹窗：

```html
<div id="previewModal" class="modal hidden">
  <div class="modal-box">
    <div class="modal-head">
      <span id="previewTitle">照片详情</span>
      <button id="previewClose" class="icon-btn" title="关闭">×</button>
    </div>
    <div id="previewImageWrap" class="preview-image-wrap">
      <img id="previewImg" alt="">
      <canvas id="previewCanvas"></canvas>
    </div>
    <div id="previewInfo" class="detail-info">点击图片查看详情</div>
  </div>
</div>
```

### app.js

- 删除 `doLogin` / `doLogout` / `applyAuth`，以及 `loginBtn/logoutBtn/email/password` 的事件绑定；`boot()` 里自动登录后直接显示 `projectBar` 并 `loadProjects()`。
- `openPreview(imageId)`：改用 `#previewModal`/`#previewTitle`/`#previewImg`/`#previewCanvas`/`#previewImageWrap`/`#previewInfo`，打开弹窗。
- `clearPreview()` → `closePreview()`：隐藏弹窗并复位。
- `drawBoxes(img, boxes)`：改用 `#previewCanvas` / `#previewImageWrap`。
- 事件绑定：`#previewClose` 关闭；点弹窗背景（`#previewModal`）也关闭。

### style.css

- 新增 `.topbar-links { display:flex; gap:8px; align-items:center; }`。
- 新增 `.preview-image-wrap`（含 img/canvas）样式，尺寸 `width: min(80vw, 1000px); height: min(72vh, 640px);`，img `object-fit: contain`，canvas 绝对定位铺满。
- 删除 `.auth` 相关样式（或保留无害）。

## 边界与异常

- 弹窗打开时 `drawBoxes` 依赖图片加载完成后的 `naturalWidth/Height`，沿用现有逻辑。
- 弹窗关闭/清空时取消未完成的异步回填（现有 `detailToken` 机制保留）。
- 自动登录失败：仍显示看板但 `projectBar` 隐藏（维持可恢复性）。

## 预期结果

- 看板不再有常驻右侧详情面板，点击表格某条数据弹出照片详情弹窗。
- 顶栏只有「作业平台」「质检平台」两个按钮（作业平台在前），无登录框，默认于荣华账号自动登录。
