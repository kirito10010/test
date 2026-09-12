# Label Auto 标注平台 · 数据查询操作文档

> 目的：以后不用靠记忆，照着这份文档就能拿到平台里的标注数据（例如「前挡玻璃遮挡」等分类框的分布）。
> 更新时间：2026-08-27

---

## 1. 平台与登录

- 地址：`http://172.21.205.141:8771/`
- 登录接口：`POST /api/login`，body 为 `{"email":"...","password":"..."}`
- 登录成功后返回 `{"ok":true,"user":{...},"token":"..."}`，之后所有请求带请求头：
  `Authorization: Bearer <token>`

### 账号（角色）

| 账号 | 密码 | 角色 | 用途 |
|------|------|------|------|
| admin@local.com | admin123 | root | 最高管理员；只能看统计，**不能**直接读项目标注 |
| v_yuronghua@baidu.com | pw123456 | admin（owner 于荣华） | **查项目数据首选**，能导出标注 |
| v_liqingguang01@baidu.com | pw123456 | qc（李庆广） | 质检员，只能看自己质检范围内的图 |

> ⚠️ 项目数据接口（images / annotation / export）**要求项目成员身份**。root 不是项目成员，会返回 `无权访问该项目` / `未登录`。所以查数据统一用 **于荣华（owner）** 账号。

---

## 2. 核心接口速查

| 接口 | 说明 |
|------|------|
| `GET /api/projects` | 项目列表（含 categories 分类、assignments 标注分配、qc_assignments 质检分配） |
| `GET /api/projects/{id}/images` | 图片列表（`image_id` **带 .jpg**，含 `qc_status` / `box_count`） |
| `GET /api/projects/{id}/annotation?image_id=<文件名.jpg>` | 单图标注（`category` 是**字符串名**，bbox 是**归一化** `x1,y1,x2,y2`，带 `source`） |
| `GET /api/projects/{id}/export?format=json` | 全量标注导出（zip，内含一个 `<项目名>_labels.json`） |
| `GET /api/projects/{id}/export?format=json&only=passed` | 只导出**质检通过(passed)**的标注 |
| `GET /api/admin/monitoring` | 各项目统计（root/admin 可看，能拿到项目 id、质检进度等） |

---

## 3. 导出 JSON 格式（重点）

导出 zip 里解压出的 `<项目名>_labels.json` 结构：

```json
{
  "pic_num": 11310,
  "label_num": 11222,
  "time": "2026-08-27 11:57:39",
  "labels": [
    { "pic_id": "20260301122550ra00000100", "bboxes": [[632,112,14,12,18]] }
  ]
}
```

- `bboxes` 每个框是 `[x, y, w, h, 分类编号]`，坐标为**像素**坐标。
- **分类编号是 1-based**（从 1 开始），而 `categories` 数组是 0-based。两者差 1。

---

## 4. 分类列表（车信箭头标牌标注3，共 20 类）

| 0-based 索引 | 导出编号(1-based) | 分类名 |
|:---:|:---:|------|
| 0 | 1 | 其他 |
| **1** | **2** | **前挡玻璃遮挡** |
| 2 | 3 | 右向前箭头 |
| 3 | 4 | 右转 |
| 4 | 5 | 左向前箭头 |
| 5 | 6 | 左掉头 |
| 6 | 7 | 左转 |
| 7 | 8 | 左转或右转 |
| 8 | 9 | 左转或掉头 |
| 9 | 10 | 掉头或右转 |
| 10 | 11 | 直行 |
| 11 | 12 | 直行或右转 |
| 12 | 13 | 直行或左转 |
| 13 | 14 | 直行或左转或右转 |
| 14 | 15 | 直行或左转或掉头 |
| 15 | 16 | 直行或掉头 |
| 16 | 17 | 车辆遮挡 |
| 17 | 18 | 车信标牌 |
| 18 | 19 | 独立车信标牌 |
| 19 | 20 | 空车道 |

> 查「前挡玻璃遮挡」时，导出 bbox 分类编号要取 **2**（不是 1）。
> 注意区分「前挡玻璃遮挡」(=2) 和「车辆遮挡」(=17)，两者不同。

---

## 5. 项目 id 对照

| 项目名 | id |
|------|------|
| 车信箭头标牌标注3 | `72284c4b8322` |
| 车信箭头标牌标注2 | `4228abaa5a34` |
| 车信箭头标牌标注 | `7d4f601380fd` |
| 车信箭头标注 | `4275deced427` |

（项目 id 也可从 `/api/admin/monitoring` 或 `/api/projects` 里取，以实机为准）

---

## 6. 五个「坑」（务必先看，否则会得到错误结果）

1. **PowerShell 发 JSON 别用 `-d "{\"..\"}"`**：PowerShell 里 `\` 不是转义符，会发出坏 JSON，导致登录误报「邮箱或密码错误」。正确做法见下面第 7 节（用 `--data-binary @file`）。
2. **导出 bbox 分类编号是 1-based**，`categories` 数组是 0-based，差 1。搞错会把「其他」当成「前挡玻璃遮挡」。
3. **annotation 接口的 `image_id` 必须带 `.jpg` 后缀**（不带会返回 `图片不存在`）。
4. **JSON 是 UTF-8**，PowerShell 读文件要用 `[System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)`，否则中文乱码。
5. **数据是实时的**：质检员会持续改标注/打回，导出只是一个时间点的快照，结果会随时间变化。

---

## 7. 完整可复制命令（PowerShell）

下面直接复制粘贴即可，以「查询项目 72284c4b8322 里 质检通过 + 前挡玻璃遮挡 的图片」为例：

```powershell
# ===== 第1步：登录 owner，拿 token =====
$body = '{"email":"v_yuronghua@baidu.com","password":"pw123456","display_name":""}'
$body | Out-File -FilePath "$env:TEMP\login.json" -Encoding ascii -NoNewline
$resp = curl.exe -s -m 15 -X POST "http://172.21.205.141:8771/api/login" `
        -H "Content-Type: application/json" --data-binary "@$env:TEMP\login.json"
$tok = (($resp -replace '[\u4e00-\u9fa5]','') | ConvertFrom-Json).token   # 简单取 token
# 更稳的取法（避免中文干扰）：
$tok = (curl.exe -s -m 15 -X POST "http://172.21.205.141:8771/api/login" `
        -H "Content-Type: application/json" --data-binary "@$env:TEMP\login.json" | ConvertFrom-Json).token

# ===== 第2步：导出质检通过的标注（zip） =====
$projId = "72284c4b8322"
curl.exe -s -m 120 "http://172.21.205.141:8771/api/projects/$projId/export?format=json&only=passed" `
        -H "Authorization: Bearer $tok" -o "$env:TEMP\labels.zip"
Expand-Archive -Path "$env:TEMP\labels.zip" -DestinationPath "$env:TEMP\labels_out" -Force

# ===== 第3步：解析，筛出 前挡玻璃遮挡(导出编号=2) =====
$f = Get-ChildItem -Recurse "$env:TEMP\labels_out" | Select-Object -First 1
$json = [System.IO.File]::ReadAllText($f.FullName, [System.Text.Encoding]::UTF8)
$data = $json | ConvertFrom-Json

$hits = @()
foreach ($item in $data.labels) {
    foreach ($b in $item.bboxes) {
        if ($b[4] -eq 2) {          # 2 = 前挡玻璃遮挡
            $hits += ("{0}.jpg  bbox({1},{2},{3},{4})" -f $item.pic_id, $b[0], $b[1], $b[2], $b[3])
        }
    }
}
$hits.Count
$hits
```

### 若要「按质检员拆分」谁名下有哪些图

在 `/api/projects` 返回的项目对象里有 `qc_assignments`（键 = 质检员 uid，值 = 分配给他的图片文件名数组）。用它与上面的命中集合做交集即可。

质检员 uid 对照（车信箭头标牌标注3）：
- 李劲 = `68f4d0965cb3`
- 李庆广 = `d82165faee87`
- 王哲 = `6d3ed4e0042c`

---

## 8. 单图复核（确认某张图到底标了什么）

```powershell
$tok = "..."   # 上面登录拿到的 token
curl.exe -s -m 15 "http://172.21.205.141:8771/api/projects/72284c4b8322/annotation?image_id=20260301137371ra00001071_best.jpg" `
        -H "Authorization: Bearer $tok"
```

返回里 `boxes[].category` 是字符串分类名（如 `前挡玻璃遮挡`），`bbox` 是归一化坐标，`source=pre` 表示预标注、`manual` 表示人工改过，`qc_status` 是质检状态（`passed`/`pending`/`rejected`）。

---

## 9. 常见结果含义

- `qc_status=passed`：质检通过（若还带「前挡玻璃遮挡」框 = 漏标，需关注）
- `qc_status=pending`：待质检（还没处理）
- `qc_status=rejected`：已打回（质检员已发现问题打回）
