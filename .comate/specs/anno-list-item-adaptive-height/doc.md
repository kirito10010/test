# 作业平台右侧列表：长文件名换行时自适应高度

## 现象

作业平台右侧「已提交/未作业/被打回」列表里，有些照片文件名很长会换行，换行后文件名把条目「撑爆」——文字溢出到条目外，和相邻条目叠在一起。

## 根因

列表容器 `.anno-list-items` 是纵向 flex 布局：

```css
.anno-list-items { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
.anno-item {
  padding: 10px 12px; ... word-break: break-all; min-height: 42px;
}
```

`.anno-item` 是 flex 子项，默认 `flex-shrink: 1`。当列表条数很多（如 2000+ 条）时，所有条目会被压缩到容器高度内。`.anno-item` 上设置的 `min-height: 42px` 只保证「不低于 42px」，而 2 行文件名需要约 59px，于是条目被压到 42px，多出来的第二行文字就溢出条目边界。

（文件名本身已 `word-break: break-all`，换行是正常的；问题只是条目高度没跟着内容长高。）

## 修复方案

给 `.anno-item` 加 `flex-shrink: 0`，禁止条目被压缩到低于其内容高度：

- 一行能放下：内容高约 39.5px，`min-height: 42px` 生效，条目仍是 42px（和现在一样，不会主动变高）。
- 换行（2 行及以上）：条目高度随内容自动撑到实际行高，文字完整显示。
- 容器 `overflow-y: auto` 照常滚动，不受影响。

## 影响文件

- `d:\Project\test\label-auto-app\static\anno.css` —— 改 `.anno-item`，加 `flex-shrink: 0;`
- `d:\Project\test\label-auto-dashboard\static\anno.css` —— 同样改 `.anno-item`

两处 CSS 的 `.anno-item` 定义完全一致，改法相同。

## 预期结果

- 短文件名：条目保持原来的单行高度，外观不变。
- 长文件名换行：条目自动长高，文字完整可见，不再溢出重叠。
