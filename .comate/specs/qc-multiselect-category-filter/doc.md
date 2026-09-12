# 质检平台 · 多选属性筛选

## 1. 需求场景与处理逻辑

质检员在质检平台右侧图片列表，除了现有的「文件名搜索」「作业员筛选」，新增一种搜索方式：**按属性（标注分类）多选筛选**。

- 属性来源：项目分类 `state.categories`（与左侧属性面板一致，如「前挡玻璃遮挡」「车灯」等）。
- 多选：勾选多个属性。
- 匹配规则：**并集（OR）** —— 一张图只要包含「所选属性中的任意一个」就命中（用户已确认）。
- 留空：不筛选，行为与现在完全一致。
- 与现有筛选叠加：文件名搜索、作业员筛选仍是「与」关系（三个条件同时满足）。

## 2. 架构与技术方案

属性筛选需要知道「每张图标注了哪些分类」。这个信息在质检列表接口里没有，需要后端用**导出标签**来判定（复用数据看板 `get_export_labels` 的能力）。

### 后端
- 新增辅助函数 `category_match_bases(pid, cat_names)`：把分类名转成导出编号，从 `get_export_labels` 里找出「任意一个 bbox 命中所选分类」的图片 base_name 集合。
- 扩展 `qc_assigned(pid, uid, status, offset, limit, cat_names=None)`：在遍历 `files` 时，若 `cat_names` 非空，跳过不在命中集合里的图。
- 扩展路由 `/api/qc/assigned`：解析 query 参数 `cat`（逗号分隔的分类名）。

### 前端
- 复用数据看板的「label-picker 多选下拉」交互模式，在筛选区新增一个属性多选控件。
- `loadList` 在拉列表时，把已选属性作为 `cat` 参数传给后端（属性筛选走后端），文件名/作业员仍在 `applyFilters` 前端过滤。

## 3. 影响文件

| 文件 | 改动类型 | 影响函数/位置 |
|---|---|---|
| `label-auto-dashboard/dashboard.py` | 修改 | 新增 `category_match_bases`；修改 `qc_assigned`；修改 `/api/qc/assigned` 路由 |
| `label-auto-dashboard/static/qc.html` | 修改 | 筛选区新增属性多选控件 |
| `label-auto-dashboard/static/qc.css` | 修改 | 新增 label-picker 相关样式 |
| `label-auto-dashboard/static/qc.js` | 修改 | 新增 `state.catFilter`、渲染/切换/显示函数；`loadList` 传 `cat` |

## 4. 实现细节

### 4.1 后端 `dashboard.py`

新增辅助函数（放在 `category_to_export_idx` 之后）：

```python
def category_match_bases(pid, cat_names):
    """返回命中任一分类的图 base_name 集合；cat_names 为空或全无效时返回 None（不过滤）"""
    proj = get_project(pid)
    if not proj:
        raise RuntimeError("项目不存在：" + pid)
    idxs = set()
    for c in (cat_names or []):
        i = category_to_export_idx(proj, c)
        if i is not None:
            idxs.add(i)
    if not idxs:
        return None
    labels = get_export_labels(pid)
    bases = set()
    for item in labels.get("labels", []):
        pic = item.get("pic_id", "")
        for b in item.get("bboxes", []):
            if len(b) >= 5 and b[4] in idxs:
                bases.add(_base_name(pic))
                break
    return bases
```

修改 `qc_assigned`（签名加 `cat_names=None`）：

```python
def qc_assigned(pid, uid, status, offset, limit, cat_names=None):
    ...
    cat_bases = category_match_bases(pid, cat_names) if cat_names else None
    matched = []
    for f in files:
        if cat_bases is not None and _base_name(f) not in cat_bases:
            continue
        st = status_map.get(f)
        ...
```

修改路由（解析 `cat`）：

```python
m = re.match(r"^/api/qc/assigned$", path)
if m and method == "GET":
    ...
    cat = qs.get("cat", [""])[0]
    cat_names = [c for c in cat.split(",") if c] if cat else None
    ...
    return self._send_json({"ok": True, **qc_assigned(pid, uid, status, offset, limit, cat_names)})
```

### 4.2 前端 `qc.html`

在筛选区（`qc-filters`）新增属性多选控件（放在搜索框与作业员筛选之后）：

```html
<div class="label-picker" id="qcCatPicker">
  <div class="label-picker-field" id="qcCatPickerField">
    <span class="placeholder">按属性筛选（可多选）</span>
  </div>
  <div class="label-picker-dropdown hidden" id="qcCatPickerDropdown"></div>
</div>
```

### 4.3 前端 `qc.css`

复用数据看板样式，新增 `.label-picker*` 相关规则（`.label-picker`、`.label-picker-field`、`.label-picker-tag`、`.label-picker-dropdown`、`.label-picker-option`）。控件放在 `qc-filters` 内，宽度自适应。

### 4.4 前端 `qc.js`

状态：`state.catFilter = []`（存分类名数组）。

新增函数：

```js
function renderCatPicker() {
  const dd = $('qcCatPickerDropdown');
  dd.innerHTML = '';
  state.categories.forEach((c) => {
    const lab = document.createElement('label');
    lab.className = 'label-picker-option';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = c;
    cb.checked = state.catFilter.includes(c);
    cb.onchange = () => {
      if (cb.checked) state.catFilter.push(c);
      else state.catFilter = state.catFilter.filter((x) => x !== c);
      updateCatPickerField();
      refreshList(false);   // 属性筛选走后端，重新拉列表
    };
    lab.appendChild(cb);
    lab.appendChild(document.createTextNode(c));
    dd.appendChild(lab);
  });
  updateCatPickerField();
}

function updateCatPickerField() {
  const el = $('qcCatPickerField');
  el.innerHTML = state.catFilter.length
    ? state.catFilter.map((c) => '<span class="label-picker-tag">' + esc(c) + '</span>').join('')
    : '<span class="placeholder">按属性筛选（可多选）</span>';
}

function toggleCatPicker() {
  const dd = $('qcCatPickerDropdown');
  dd.classList.toggle('hidden');
}
```

`loadList` 传 `cat`（仅非 recent 页签）：

```js
if (state.status === 'recent') {
  r = await api('/api/qc/recent?...');
} else {
  const catParam = state.catFilter.length ? '&cat=' + encodeURIComponent(state.catFilter.join(',')) : '';
  r = await api('/api/qc/assigned?pid=...&uid=...&status=' + state.status + '&offset=0&limit=100000' + catParam);
}
```

初始化/切项目时：`renderCatPicker()` 需在 `state.categories` 就绪后调用（`renderCategoryButtons` 之后）；切项目/切质检员时清空 `state.catFilter = []` 并重绘。

## 5. 边界条件与异常处理

- 未选任何属性：`cat_names` 为空 → 后端不过滤，行为不变。
- 选中属性但该项目无此分类：`category_to_export_idx` 返回 None → 忽略该分类；若全部无效 → 不过滤。
- 命中集合为空：列表显示「暂无…」空态。
- recent 页签：不走 `/api/qc/assigned`，属性筛选不生效（该页签数据量小，无需筛选）。
- `get_export_labels` 首次调用会拉取导出（较慢），已有 30 分钟缓存；后续筛选命中缓存。
- 与文件名搜索、作业员筛选叠加：三者 AND。

## 6. 数据流

1. 用户勾选属性 → 更新 `state.catFilter` → `refreshList(false)`。
2. `loadList` 拼 `cat` 参数 → 请求 `/api/qc/assigned?...&cat=前挡玻璃遮挡,车灯`。
3. 后端 `qc_assigned` → `category_match_bases` → 用导出标签算命中集合 → 过滤 `files` → 返回命中图 id 列表。
4. 前端 `applyFilters` 再叠加文件名/作业员过滤 → 渲染列表 → 自动选中第一张。

## 7. 预期结果

- 质检平台筛选区新增「按属性筛选（可多选）」下拉。
- 勾选一个或多个属性后，右侧列表只显示包含所选任一属性的图。
- 取消全部勾选后恢复全部。
- 与文件名搜索、作业员筛选可叠加使用。
