# 外接看板 · 标签巡检「未作业」筛选 + 「漏标告警」更名

## 1. 需求场景与处理逻辑

### 1.1 标签巡检新增「未作业」状态

**现状问题**

状态筛选只有 `全部 / 已通过 / 待质检 / 已打回`，看不到「作业员还没做」的图。

根因：标签巡检的结果来自平台导出（`/export?format=json`），导出里只有**人工已提交标注**的图。实测项目「车信箭头标注11」(`dafbede75eaa`)：

| 口径 | 数量 | 平台字段 |
|---|---|---|
| 项目总图 | 10614 | `/images` → `total` |
| 人工已提交（可在标签巡检里看到） | 389 | `annotated=true, pre_annotated=false` |
| **未作业（看板完全看不到）** | 10225 | `annotated=false, pre_annotated=true`（只有模型预标注框） |

所以「未作业」不是加一个下拉项就完事——结果集本身必须包含整批图。

**口径（用户确认）**

> 「就是作业员没有做的那个状态未作业的那个状态」

即 `annotated=false`，与作业平台「未作业」页签同义（`anno_assigned` 里 `status == "unannotated"` 的判定口径一致）。

**处理逻辑**

1. 不选标签（查全部）时：结果集 = 导出命中图（人工已标注）+ `/images` 中 `annotated=false` 的图，后者的 `qc_status` 统一记为 `unannotated`。
   - 此时「全部」能看到整批 10614 张，「未作业」能筛出 10225 张。
2. 选了具体标签时：结果集仍只来自导出——未作业图没有任何人工标注，不可能命中标签。
   - 若此时再选「未作业」，结果必然为空。界面**必须明确提示原因**（「未作业的图没有人工标注，无法命中标签，清空标签可查看全部未作业图」），不能让人以为功能坏了。
3. 未作业行的「框坐标」列显示 `预标注 N 框`（`/images` 的 `box_count` 对未作业图 = 模型预标注框数），无框时显示 `无标注`。
4. 结果小结在未选标签时补一个未作业数量：`命中 N 张图（未作业 U），筛选后 M 张（框数 K）`，便于直接看这批还剩多少没做。
5. 平台请求量不增加：未作业信息复用已有的 `/images` 快照（本来就要拉），且**排序 / 通过时间过滤时只对有人工标注的行拉 `/annotation`**——否则 1 万张未作业图会触发上万次上游请求。

**验证过的事实（2026-09-18 实测）**

- `/images` 单图字段：`{image_id, annotated, box_count, qc_status, qc_reason, pre_annotated}`；未作业图 `qc_status=null`、`box_count` 为预标注框数。
- 平台**没有**批量预标注接口：`/annotation` 必须传 `image_id`（不传返回 `400 缺少 image_id`）；`/annotations`、`/labels`、`/pre_annotations` 均 404；`/images?include_pre/with_pre/full`、`/export?only=pre|all` 参数无效（返回与不带参数相同）。所以「选标签 + 未作业」不可能低成本实现，本次不做逐图预标注扫描。

### 1.2 「漏标告警」更名为「误通过核查」

**现状问题**：名字不准。功能不是查标注员漏标，而是查「这批数据里不允许出现的标签，有没有被质检放行通过」。

用户原话：

> 这批数据不能有某个标签，但是质检通过了，所以我到最后会查一查有没有把不能有的照片给通过了。

**改动（用户已选定新名：误通过核查）**

- 功能逻辑**不变**：输入标签集合 → 输出「`qc_status=passed` 且带这些标签」的图。
- 文案更名，并把输入框口径改成「禁止出现的标签」，贴合「这批数据不能有这个标签」：
  - 页签「漏标告警」→「误通过核查」
  - 按钮「扫描漏标」→「开始核查」
  - toast「扫描漏标中…」→「核查中…」
  - 小结「质检通过但带异常标签的图：N 张」→「含禁止标签且已质检通过的图：N 张」
  - 输入框 label「异常标签（逗号分隔）」→「禁止出现的标签（逗号分隔）」
- 代码内一并更名（前后端都在本仓库，不留旧名残留）：`leak_images` → `false_pass_images`，路由 `/api/projects/{id}/leak` → `/false_pass`，前端 `leak*` → `fp*`，`doLeak` → `doFalsePass`。
- 文档同步：`label-auto-dashboard/README.md` 功能表、`LabelAuto数据查询操作文档.md` 第 9 节里的「漏标」用词。

## 2. 架构与技术方案

数据源不变（平台导出 + `/images` 快照），不改动平台，不新增上游接口。

### 后端（`label-auto-dashboard/dashboard.py`）

- 新增 `_image_info_map(pid)`：把 `/images` 转成 `image_id -> {annotated, box_count, qc_status, pre_annotated}`。
- `query_images`：
  - 用 `_image_info_map` + `build_qc_owner_map` 取代原来的 `_status_and_owner_maps`（后者只在此处使用，直接重构掉，不留废弃函数）。
  - 导出循环保持原样；不选标签时把 `annotated=false` 的图补成 `qc_status="unannotated"` 的行。
  - `sort="reviewed_desc"` / `passed_minutes` 的 `fetch_annotations` 只传有人工标注的 image_id；排序键改用 `r.get("reviewed_at") or ""`（未作业行没有 `reviewed_at`，排最后，与现有「空时间排最后」一致）。
- `leak_images` → `false_pass_images`（实现不变），路由 `/leak` → `/false_pass`。

### 前端

- `static/index.html`：状态下拉在「全部」后插入 `<option value="unannotated">未作业</option>`；「漏标告警」页签相关文案与 id 更名。
- `static/app.js`：`statusText` 增加 `unannotated: '未作业'`；新增 `boxesText(r)` 统一表格/CSV 的框列文案；`renderQuery` 增加「未作业 + 已选标签」的提示分支；小结加未作业数量；`doLeak` → `doFalsePass` 并改请求路径。
- `static/style.css`：`.badge.unannotated`（灰底，复用 `--muted`）；`input#leakCats` 选择器随 id 更名。

## 3. 影响文件

| 文件 | 改动类型 | 影响函数 / 位置 |
|---|---|---|
| `label-auto-dashboard/dashboard.py` | 修改 | 新增 `_image_info_map`；重写 `query_images` 的取数与补行逻辑；删除 `_status_and_owner_maps`；`leak_images`→`false_pass_images`；路由 `/leak`→`/false_pass` |
| `label-auto-dashboard/static/index.html` | 修改 | `#queryStatus` 新增 option；状态列/页签文案；`leak*` id 更名 |
| `label-auto-dashboard/static/app.js` | 修改 | `statusText`、新增 `boxesText`、`renderQuery`、`exportQueryCsv`、`doLeak`→`doFalsePass`、事件绑定 |
| `label-auto-dashboard/static/style.css` | 修改 | `.badge.unannotated`；`input#leakCats` → `input#fpCats` |
| `label-auto-dashboard/README.md` | 修改 | 功能表「漏标告警」行 |
| `LabelAuto数据查询操作文档.md` | 修改 | 第 9 节「漏标」用词 |

## 4. 实现细节

### 4.1 后端：新增 `_image_info_map`

放在 `_status_and_owner_maps` 位置（替换它）：

```python
def _image_info_map(pid):
    """image_id -> {annotated, box_count, qc_status, pre_annotated}（来自 /images 快照）

    未作业图（annotated=False）的 box_count 是模型预标注框数，qc_status 为 null。
    """
    info = {}
    for im in get_images(pid).get("images", []):
        iid = im.get("image_id")
        if not iid:
            continue
        info[iid] = {
            "annotated": bool(im.get("annotated")),
            "box_count": im.get("box_count") or 0,
            "qc_status": im.get("qc_status") or "",
            "pre_annotated": bool(im.get("pre_annotated")),
        }
    return info
```

### 4.2 后端：`query_images` 取数与补行

```python
def query_images(pid, cat_names, sort=None, passed_minutes=None):
    """按分类名查命中图；cat_names 为空时返回全部图片
    （人工已标注的取导出，未作业的取 /images 并记 unannotated）
    passed_minutes>0 时只返回时间窗内新通过且当前仍 passed 的图，按通过时间倒序"""
    proj = get_project(pid)
    if not proj:
        raise RuntimeError("项目不存在：" + pid)
    idxs = set()
    for c in cat_names:
        i = category_to_export_idx(proj, c)
        if i is not None:
            idxs.add(i)
    force_export = bool(sort == "reviewed_desc" or passed_minutes)
    _PROGRESS["phase"] = "export"
    _PROGRESS["total"] = 0
    _PROGRESS["done"] = 0
    labels = get_export_labels(pid, force=force_export)
    img_info = _image_info_map(pid)
    owner_map = build_qc_owner_map(pid)
    results = []
    seen_bases = set()
    for item in labels.get("labels", []):
        pic = item.get("pic_id", "")
        base = _base_name(pic)
        if idxs:
            boxes = []
            for b in item.get("bboxes", []):
                if len(b) >= 5 and b[4] in idxs:
                    boxes.append({"x": b[0], "y": b[1], "w": b[2], "h": b[3]})
            if not boxes:
                continue
            box_count = len(boxes)
        else:
            boxes = []
            box_count = len(item.get("bboxes", []))
        info = img_info.get(_image_id(pic)) or {}
        results.append({
            "image_id": _image_id(pic),
            "boxes": boxes,
            "box_count": box_count,
            "qc_status": info.get("qc_status") or "?",
            "qc_owner": owner_map.get(base, ""),
        })
        seen_bases.add(base)
    if not idxs:
        # 未作业图：只在「不选标签」时补进来（未作业图没有人工标注，命中不了任何标签）
        for iid, info in img_info.items():
            if info["annotated"] or _base_name(iid) in seen_bases:
                continue
            results.append({
                "image_id": iid,
                "boxes": [],
                "box_count": info["box_count"],
                "qc_status": "unannotated",
                "qc_owner": owner_map.get(_base_name(iid), ""),
                "pre_annotated": info["pre_annotated"],
            })
    if passed_minutes:
        cutoff = _fmt_ts(time.time() - passed_minutes * 60)
        ann = fetch_annotations(pid, [r["image_id"] for r in results if r["qc_status"] != "unannotated"])
        filtered = []
        for r in results:
            a = ann.get(r["image_id"], {})
            r["qc_status"] = a.get("qc_status") or r.get("qc_status")
            r["reviewed_at"] = a.get("reviewed_at") or ""
            if r["qc_status"] == "passed" and r["reviewed_at"] >= cutoff:
                filtered.append(r)
        filtered.sort(key=lambda r: r["reviewed_at"], reverse=True)
        return filtered
    if sort == "reviewed_desc":
        ann = fetch_annotations(pid, [r["image_id"] for r in results if r["qc_status"] != "unannotated"])
        for r in results:
            a = ann.get(r["image_id"])
            if not a:
                continue
            r["qc_status"] = a.get("qc_status") or r.get("qc_status")
            r["reviewed_at"] = a.get("reviewed_at") or ""
        results.sort(key=lambda r: r.get("reviewed_at") or "", reverse=True)
    return results
```

### 4.3 后端：更名

```python
def false_pass_images(pid, cat_names):
    """误通过：已质检通过、但仍带这些（禁止出现的）标签的图"""
    return [r for r in query_images(pid, cat_names) if r["qc_status"] == "passed"]
```

> 实施时追加：标签是手填的，写错时必须报错——否则「一个都没命中」会被 `query_images` 当成「查全部」，
> 把「所有已通过的图」当成本次核查结果（假阳性）。实际实现先校验标签是否属于本项目分类，不属于则抛错，
> 路由返回 400 +「标签不存在：xxx（本项目分类：…）」。


路由：

```python
# /api/projects/{id}/false_pass?cats=a,b
m = re.match(r"^/api/projects/([^/]+)/false_pass$", path)
```

### 4.4 前端 `index.html`

```html
<select id="queryStatus">
  <option value="">全部</option>
  <option value="unannotated">未作业</option>
  <option value="passed">已通过</option>
  <option value="pending">待质检</option>
  <option value="rejected">已打回</option>
</select>
```

```html
<button data-tab="falsePass">误通过核查</button>
...
<!-- 误通过核查 -->
<section id="tab-falsePass" class="tab-panel hidden">
  <div class="toolbar">
    <label>禁止出现的标签（逗号分隔）：</label>
    <input id="fpCats" value="前挡玻璃遮挡" placeholder="前挡玻璃遮挡,车辆遮挡">
    <button id="fpBtn" class="btn primary">开始核查</button>
  </div>
  <div class="summary" id="fpSummary"></div>
  <div class="table-wrap">
    <table id="fpTable" class="hidden"> ... </table>
  </div>
</section>
```

### 4.5 前端 `app.js`

```js
function statusText(s) {
  return { unannotated: '未作业', passed: '已通过', pending: '待质检', rejected: '已打回' }[s] || s || '未知';
}

// 表格与 CSV 共用的框列文案：未作业行显示预标注框数
function boxesText(r) {
  if (r.qc_status === 'unannotated') {
    return r.box_count > 0 ? `预标注 ${r.box_count} 框` : '无标注';
  }
  return (r.boxes && r.boxes.length)
    ? r.boxes.map(b => `(${b.x},${b.y},${b.w},${b.h})`).join('；')
    : `${r.box_count != null ? r.box_count : r.boxes.length} 框`;
}
```

`renderQuery` 里：

```js
const unannotated = results.filter(r => r.qc_status === 'unannotated').length;
const totalBoxes = rows.reduce((s, r) => s + (r.box_count != null ? r.box_count : r.boxes.length), 0);
$('querySummary').innerHTML =
  `命中 <strong>${results.length}</strong> 张图` +
  (unannotated ? `（未作业 ${unannotated}）` : '') +
  `，筛选后 <strong>${rows.length}</strong> 张（框数 ${totalBoxes}）`;

// 未作业 + 选了标签：结果必然为空，说明原因而不是让人以为坏了
if (status === 'unannotated' && selectedLabels.size && !rows.length) {
  $('querySummary').innerHTML += '<div class="hint">未作业的图还没有人工标注，无法命中标签；清空标签后可查看本项目全部未作业图。</div>';
}
```

表格行与 `exportQueryCsv` 都改用 `boxesText(r)`。

`doLeak` → `doFalsePass`（请求路径 `/false_pass`、toast「核查中…」、小结「含禁止标签且已质检通过的图：N 张」、id `fpCats/fpBtn/fpSummary/fpTable`）。

### 4.6 `style.css`

```css
.badge.unannotated { background: var(--muted); }
.toolbar input#fpCats { min-width: 300px; }
```

## 5. 边界条件与异常处理

- **未选标签 + 全部**：结果从「只有人工已标注」变为「整批图」，行数从 389 涨到 10614（该项目）。大项目下与现状一致（如「限速标牌标注4」查全部本来就是 2 万多行）。
- **选标签 + 未作业**：恒为空，界面给出原因提示（见 4.5）。
- **排序 / 通过时间**：未作业行不参与 `fetch_annotations`，上游请求次数与改动前一致；未作业行没有 `reviewed_at`，按时间排序时排在最后。
- **导出与 `/images` 不同步**：导出缓存 30 分钟、`/images` 180 秒。若某图在导出里但 `/images` 还没标记 `annotated`，该图仍按导出行显示、状态落回 `?`（未知），不会被错标成「未作业」——补行时用 `seen_bases` 去重，导出里已有的图不会被重复补成未作业。
- **平台 409（图片目录不存在，如 `限速标牌标注1/2`）**：`/images` 直接报错，查询报错文案与现状一致，不缓存坏数据。
- **未作业行可被勾选做批量通过/打回**：平台允许，但给没有人工标注的图下「通过」结论属于误操作。本次不加额外拦截（避免过度设计），仅在文档中说明。
- **旧的 `/api/projects/{id}/leak` 路由被删除**：前端同步改名，exe 打包时前后端一致；若浏览器缓存了旧 `app.js` 调旧路由会 404，强刷即可（与既有「首次打开无数据需强刷」同类问题）。

## 6. 数据流

1. 前端 `doQuery` → `GET /api/projects/{pid}/query?cat=…&sort=…&passed_minutes=…`
2. 后端 `query_images` → `get_export_labels`（人工标注，30 分钟缓存）+ `_image_info_map`（`/images` 快照，180 秒 stale-while-revalidate）+ `build_qc_owner_map`
3. 组装 results（含 `qc_status="unannotated"` 行）→ 返回
4. 前端 `renderQuery` 按状态/质检员前端过滤 → 表格渲染（未作业行 = 灰色「未作业」徽标 + 「预标注 N 框」）
5. 「误通过核查」：`GET /api/projects/{pid}/false_pass?cats=…` → `false_pass_images` → 表格

## 7. 预期结果

- 状态下拉出现「未作业」；项目「车信箭头标注11」不选标签 + 未作业 → 约 1 万张（当前 10225，随作业推进减少）。
- 选标签 + 未作业 → 0 张 + 明确提示。
- 页签为「误通过核查」，按钮「开始核查」，小结「含禁止标签且已质检通过的图：N 张」，功能结果与改动前一致。
- 对平台请求量不增加；`node --check` / `python -c "import ast…"` 语法校验通过。

## 8. 待确认（不影响本次编码）

- 是否要顺带升版本号（`VERSION` 1.2.1 → 1.2.2）并重新用 PyInstaller 打包 `label-auto-dashboard.exe` / `label-auto-v2.exe` 提交（上一版提交里有 dist + version.json，发版动作按你的流程来）。
- 「选标签 + 未作业」如需按**模型预标注**匹配，需要逐图调 `/annotation`（该项目约 10225 次，1~3 分钟），平台压力较大，本次未做。后续需要可单独排一个 spec。
