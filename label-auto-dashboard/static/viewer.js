/* 公共照片查看器（缩放平移 + 框叠加 + 框编辑/画框），供质检平台与作业平台共用 */
'use strict';

function colorFor(cat) {
  let h = 0;
  for (let i = 0; i < (cat || '').length; i++) h = (h * 31 + cat.charCodeAt(i)) % 360;
  return 'hsl(' + h + ',70%,45%)';
}

/* 复制到剪贴板（带 execCommand 兜底），返回 Promise 供调用方提示成功 */
function copyTextToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).catch(() => fallbackCopyText(text));
  }
  return Promise.resolve(fallbackCopyText(text));
}
function fallbackCopyText(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (e) {}
  document.body.removeChild(ta);
}

/* ============ 图片查看器（缩放平移 + 框叠加 + 框编辑/画框） ============ */
function createViewer(container, imageUrl, boxes, opts) {
  opts = opts || {};
  const onOpen = opts.onOpen;
  const zoomable = opts.zoomable;
  const editable = opts.editable;
  const onSelect = opts.onSelect;
  const onDeselect = opts.onDeselect;
  const onBoxDrawn = opts.onBoxDrawn;
  const onDelete = opts.onDelete;

  const viewer = document.createElement('div');
  viewer.className = 'viewer';
  const stage = document.createElement('div');
  stage.className = 'stage';
  const img = document.createElement('img');
  img.draggable = false;
  const overlay = document.createElement('canvas');
  overlay.className = 'overlay';
  stage.appendChild(img);
  viewer.appendChild(stage);
  viewer.appendChild(overlay);
  container.appendChild(viewer);

  let scale = 1, tx = 0, ty = 0;
  let naturalW = 0, naturalH = 0;
  let selectedIndex = -1;
  let drawRect = null;    // 画框预览 {x1,y1,x2,y2} 归一化
  let drawStart = null;   // 画框起始屏幕坐标 {mx,my,started}
  let boxDrag = null;     // 拖动/缩放 {mode, index, corner?, edge?, startBox, startMx, startMy}
  let hideLabels = false; // 隐藏框/属性标签（只看原图）
  let detachMove = null;  // 销毁时移除 window mousemove/mouseup 监听，避免每次换图累积监听器
  let detachUp = null;

  const MIN_BOX = 0.002; // 最小归一化尺寸（约 0.2%，允许画小框）
  const HANDLE = 8;      // 手柄/边线命中半径（屏幕像素）

  function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }

  function apply() {
    stage.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
    drawOverlay();
  }

  function boxScreenRect(b) {
    const bb = b.bbox || {};
    return {
      x: bb.x1 * naturalW * scale + tx,
      y: bb.y1 * naturalH * scale + ty,
      w: (bb.x2 - bb.x1) * naturalW * scale,
      h: (bb.y2 - bb.y1) * naturalH * scale,
    };
  }

  // 命中检测：四角手柄 > 四条边 > 框内部（后画在上层，反向遍历）
  function hitTest(mx, my) {
    for (let i = boxes.length - 1; i >= 0; i--) {
      const r = boxScreenRect(boxes[i]);
      const corners = [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]];
      for (let c = 0; c < 4; c++) {
        if (Math.abs(mx - corners[c][0]) <= HANDLE && Math.abs(my - corners[c][1]) <= HANDLE)
          return { type: 'corner', index: i, corner: c };
      }
      if (Math.abs(my - r.y) <= HANDLE && mx >= r.x - HANDLE && mx <= r.x + r.w + HANDLE) return { type: 'edge', index: i, edge: 'top' };
      if (Math.abs(my - (r.y + r.h)) <= HANDLE && mx >= r.x - HANDLE && mx <= r.x + r.w + HANDLE) return { type: 'edge', index: i, edge: 'bottom' };
      if (Math.abs(mx - r.x) <= HANDLE && my >= r.y - HANDLE && my <= r.y + r.h + HANDLE) return { type: 'edge', index: i, edge: 'left' };
      if (Math.abs(mx - (r.x + r.w)) <= HANDLE && my >= r.y - HANDLE && my <= r.y + r.h + HANDLE) return { type: 'edge', index: i, edge: 'right' };
      if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) return { type: 'box', index: i };
    }
    return null;
  }

  function toNorm(mx, my) {
    if (!naturalW || !naturalH) return null;
    return { x: (mx - tx) / (naturalW * scale), y: (my - ty) / (naturalH * scale) };
  }

  function setSelected(i) {
    selectedIndex = i;
    drawOverlay();
    if (editable) {
      if (i >= 0 && boxes[i]) onSelect && onSelect(i);
      else onDeselect && onDeselect();
    }
  }

  function getSelected() { return selectedIndex; }

  function setHideLabels(on) {
    hideLabels = on;
    drawOverlay();
  }

  const viewerApi = {
    setSelected,
    redraw: drawOverlay,
    getSelected,
    setHideLabels,
    el: viewer,   // DOM 引用，供外部 appendChild / 布局
    destroy() {   // 移除全局监听，避免换图后监听器越积越多导致卡顿
      if (detachMove) { detachMove(); detachMove = null; }
      if (detachUp) { detachUp(); detachUp = null; }
    },
  };

  // 覆盖层：独立于缩放，恒定线宽/字号，文字带底色（矢量式、不随缩放变大）
  function drawOverlay() {
    const vw = viewer.clientWidth, vh = viewer.clientHeight;
    if (!vw || !vh) return;
    overlay.width = vw;
    overlay.height = vh;
    overlay.style.width = vw + 'px';
    overlay.style.height = vh + 'px';
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, vw, vh);
    if (hideLabels) return;
    if (!naturalW || !naturalH) return;
    (boxes || []).forEach((b, idx) => {
      const bb = b.bbox || {};
      if (bb.x1 == null) return;
      const x = bb.x1 * naturalW * scale + tx;
      const y = bb.y1 * naturalH * scale + ty;
      const w = (bb.x2 - bb.x1) * naturalW * scale;
      const h = (bb.y2 - bb.y1) * naturalH * scale;
      if (x + w < 0 || y + h < 0 || x > vw || y > vh) return;  // 屏幕外裁剪
      const color = colorFor(b.category || '');
      ctx.strokeStyle = color;
      ctx.lineWidth = (idx === selectedIndex) ? 3 : 2;   // 选中加粗
      ctx.strokeRect(x, y, w, h);

      // 选中框显示四角 + 四边中点手柄，提示可拖动调整大小
      if (idx === selectedIndex) {
        ctx.fillStyle = color;
        const hs = 5;
        [[x, y], [x + w, y], [x, y + h], [x + w, y + h],
         [x + w / 2, y], [x + w / 2, y + h], [x, y + h / 2], [x + w, y + h / 2]].forEach(([cx, cy]) => {
          ctx.fillRect(cx - hs, cy - hs, hs * 2, hs * 2);
        });
      }

      const label = b.category || '';
      ctx.font = '13px sans-serif';         // 恒定字号
      const tw = ctx.measureText(label).width;
      let bgY = y - 4 - 13;                 // 文字底色矩形顶部
      let textY = y - 4;                    // 文字基线
      if (bgY < 0) { bgY = y; textY = y + 13; }  // 框太靠上时放到框内顶部
      ctx.fillStyle = color;
      ctx.fillRect(x, bgY, tw + 6, 15);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, x + 3, textY);
    });

    // 画框预览（虚线）
    if (drawRect) {
      const x = drawRect.x1 * naturalW * scale + tx;
      const y = drawRect.y1 * naturalH * scale + ty;
      const w = (drawRect.x2 - drawRect.x1) * naturalW * scale;
      const h = (drawRect.y2 - drawRect.y1) * naturalH * scale;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
    }
  }

  img.onload = () => {
    const vw = viewer.clientWidth, vh = viewer.clientHeight;
    naturalW = img.naturalWidth;
    naturalH = img.naturalHeight;
    if (!naturalW || !naturalH || !vw || !vh) return;
    const s = Math.min(vw / naturalW, vh / naturalH);
    scale = s;
    tx = (vw - naturalW * s) / 2;
    ty = (vh - naturalH * s) / 2;
    apply();
  };
  img.onerror = () => { viewer.textContent = '图片加载失败'; };
  img.src = imageUrl;

  // 滚轮缩放（以鼠标为中心）
  if (zoomable !== false) {
    viewer.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = viewer.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const ns = Math.min(Math.max(scale * factor, 0.05), 30);
      const sx = (mx - tx) / scale, sy = (my - ty) / scale;
      tx = mx - sx * ns;
      ty = my - sy * ns;
      scale = ns;
      apply();
    }, { passive: false });

    // 右键拖动平移 + （编辑态）左键选中/拖动/画框
    viewer.addEventListener('contextmenu', (e) => e.preventDefault());
    let drag = null;
    viewer.addEventListener('mousedown', (e) => {
      const rect = viewer.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      if (e.button === 2) {
        drag = { x: e.clientX, y: e.clientY, tx: tx, ty: ty };
        e.preventDefault();
      } else if (e.button === 0 && editable) {
        const hit = hitTest(mx, my);
        if (hit) {
          // 点在已有框上：选中，并准备拖动（内部）或缩放（角/边）
          setSelected(hit.index);
          const bb = boxes[hit.index].bbox || {};
          boxDrag = {
            mode: hit.type === 'corner' ? 'resize-corner' : (hit.type === 'edge' ? 'resize-edge' : 'move'),
            index: hit.index,
            corner: hit.corner,
            edge: hit.edge,
            startBox: { x1: bb.x1, y1: bb.y1, x2: bb.x2, y2: bb.y2 },
            startMx: mx,
            startMy: my,
          };
          e.preventDefault();
          e.stopPropagation();
        } else {
          // 空白处：左键按下准备画框
          drawStart = { mx, my, started: false };
          drawRect = null;
          e.preventDefault();
        }
      }
    });
    const onMove = (e) => {
      if (drag) {
        tx = drag.tx + (e.clientX - drag.x);
        ty = drag.ty + (e.clientY - drag.y);
        apply();
      } else if (boxDrag) {
        const rect = viewer.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        const bb = boxes[boxDrag.index] && boxes[boxDrag.index].bbox;
        if (!bb || !naturalW || !naturalH) return;
        const dnx = (mx - boxDrag.startMx) / (naturalW * scale);
        const dny = (my - boxDrag.startMy) / (naturalH * scale);
        const s = boxDrag.startBox;
        if (boxDrag.mode === 'move') {
          const w = s.x2 - s.x1, h = s.y2 - s.y1;
          bb.x1 = clamp(s.x1 + dnx, 0, 1 - w);
          bb.y1 = clamp(s.y1 + dny, 0, 1 - h);
          bb.x2 = bb.x1 + w;
          bb.y2 = bb.y1 + h;
        } else if (boxDrag.mode === 'resize-corner') {
          const c = boxDrag.corner;
          if (c === 0) { bb.x1 = clamp(s.x1 + dnx, 0, s.x2 - MIN_BOX); bb.y1 = clamp(s.y1 + dny, 0, s.y2 - MIN_BOX); }
          else if (c === 1) { bb.x2 = clamp(s.x2 + dnx, s.x1 + MIN_BOX, 1); bb.y1 = clamp(s.y1 + dny, 0, s.y2 - MIN_BOX); }
          else if (c === 2) { bb.x1 = clamp(s.x1 + dnx, 0, s.x2 - MIN_BOX); bb.y2 = clamp(s.y2 + dny, s.y1 + MIN_BOX, 1); }
          else { bb.x2 = clamp(s.x2 + dnx, s.x1 + MIN_BOX, 1); bb.y2 = clamp(s.y2 + dny, s.y1 + MIN_BOX, 1); }
        } else { // resize-edge
          const ed = boxDrag.edge;
          if (ed === 'left') bb.x1 = clamp(s.x1 + dnx, 0, s.x2 - MIN_BOX);
          else if (ed === 'right') bb.x2 = clamp(s.x2 + dnx, s.x1 + MIN_BOX, 1);
          else if (ed === 'top') bb.y1 = clamp(s.y1 + dny, 0, s.y2 - MIN_BOX);
          else bb.y2 = clamp(s.y2 + dny, s.y1 + MIN_BOX, 1);
        }
        apply();
      } else if (drawStart) {
        const rect = viewer.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        if (!drawStart.started) {
          if (Math.abs(mx - drawStart.mx) < 3 && Math.abs(my - drawStart.my) < 3) return;
          drawStart.started = true;
        }
        const a = toNorm(drawStart.mx, drawStart.my);
        const b = toNorm(mx, my);
        if (!a || !b) return;
        drawRect = {
          x1: clamp(Math.min(a.x, b.x), 0, 1),
          y1: clamp(Math.min(a.y, b.y), 0, 1),
          x2: clamp(Math.max(a.x, b.x), 0, 1),
          y2: clamp(Math.max(a.y, b.y), 0, 1),
        };
        apply();
      }
    };
    window.addEventListener('mousemove', onMove);
    detachMove = () => window.removeEventListener('mousemove', onMove);
    const onUp = (e) => {
      drag = null;
      if (boxDrag) {
        // 拖动/缩放结束，保持选中（方便继续调整）
        boxDrag = null;
        apply();
      }
      if (drawStart) {
        const rect = viewer.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        const valid = drawRect && (drawRect.x2 - drawRect.x1) >= MIN_BOX && (drawRect.y2 - drawRect.y1) >= MIN_BOX;
        if (drawStart.started && valid) {
          const box = { x1: drawRect.x1, y1: drawRect.y1, x2: drawRect.x2, y2: drawRect.y2 };
          drawStart = null;
          drawRect = null;
          apply();
          if (onBoxDrawn) onBoxDrawn(box);
        } else if (drawStart.started) {
          drawStart = null;
          drawRect = null;
          apply();
          setSelected(-1);
        } else {
          drawStart = null;
          drawRect = null;
          apply();
          const hit = hitTest(mx, my);
          if (hit) setSelected(hit.index);
          else setSelected(-1);
        }
      }
    };
    window.addEventListener('mouseup', onUp);
    detachUp = () => window.removeEventListener('mouseup', onUp);
  }

  if (editable) {
    viewer.addEventListener('dblclick', (e) => {
      const rect = viewer.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const hit = hitTest(mx, my);
      if (hit) onDelete && onDelete(hit.index);
    });
  }

  if (onOpen && !editable) viewer.addEventListener('click', onOpen);

  return viewerApi;
}
