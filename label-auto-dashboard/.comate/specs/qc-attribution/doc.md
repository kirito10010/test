# 质检平台：按质检员归属质检结果（qc-attribution）

## 1. 需求背景

之前质检平台（/qc）和 dashboard 统一用 owner 于荣华的 token 调平台 `/qc` 提交质检，导致平台按「调用者 token」归属质检结果时，所有通过/打回都算到于荣华名下。监控里李劲等质检员的 passed/rejected 一直是 0，而 total 与各质检员之和存在差额（"无主"通过数）。

已实测确认根因：平台 `/qc` 按 token 归属，而非按图归属。用李劲自己的 token 提交 pass 后，监控里李劲 passed 从 0→1；且重新 pass 幂等、`reviewed_at` 不变。

## 2. 需求

1. **新提交正确归属**：在质检平台选中李劲质检时，通过/打回算李劲名下；选李庆广算李庆广。王哲暂跳过（密码未知，回退 owner 代检）。
2. **修复历史错归属**：把之前由于荣华提交、实际属于李劲/李庆广名下的 passed/rejected 图，重新归属回正确质检员。

## 3. 技术方案

### 3.1 后端 token 池（dashboard.py）

新增全局映射与登录函数：

```python
_QC_LOGIN = {
    "68f4d0965cb3": {"email": "v_lijin10@baidu.com", "password": "pw123456"},      # 李劲
    "d82165faee87": {"email": "v_liqingguang01@baidu.com", "password": "pw123456"}, # 李庆广
}
_QC_TOKENS = {}   # uid -> token（登录后缓存）
```

```python
def _get_qc_token(uid):
    """返回该质检员自己的 token；未配置或登录失败返回 None（调用方回退 owner token）"""
    if uid in _QC_TOKENS:
        return _QC_TOKENS[uid]
    cfg = _QC_LOGIN.get(uid)
    if not cfg:
        return None
    s, h, raw = upstream("POST", "/api/login",
                         body={"email": cfg["email"], "password": cfg["password"]})
    if s == 200:
        d = json.loads(raw.decode("utf-8"))
        tok = d.get("token")
        if tok:
            _QC_TOKENS[uid] = tok
            return tok
    return None
```

### 3.2 upstream 支持指定 token

`upstream()` 增加 `token=None` 参数，默认用全局 `TOKEN`；传入时用传入 token：

```python
def upstream(method, path, query=None, body=None, raw_body=None, extra_headers=None, token=None):
    ...
    tok = token or TOKEN
    if tok:
        headers["Authorization"] = "Bearer " + tok
```

### 3.3 提交质检时按人选择 token

`_handle_qc_submit` 中，对每个 verdict 用 `_get_qc_token(uid)` 提交；拿不到 token（如王哲）回退全局 owner token：

```python
tok = _get_qc_token(uid)
s, h, raw2 = upstream("POST", "/api/projects/%s/qc" % pid,
                      body={"image_id": iid, "verdict": verdict, "reason": reason},
                      token=tok)
```

### 3.4 历史归属修复接口

新增 `POST /api/qc/fix`，body `{pid, uid}`：

1. 用该质检员 token 调 `/api/projects/{pid}/images`（qc 角色返回自己名下全部图，含 qc_status）。
2. 筛出 `qc_status in ("passed", "rejected")` 的图。
3. 对每张用该质检员 token 重新提交对应 verdict（passed→pass，rejected→reject），并发 8 路。
4. 返回 `{ok, total, succeeded, failed}`，供前端提示。

> 说明：重新提交是幂等的，`reviewed_at` 不变（已实测），不污染「按质检时间排序」。只重放「当前已 passed/rejected」的图，pending/None 不动，不会误改未检图。

### 3.5 前端

- 质检平台保存/提交逻辑不变（`/api/qc/submit` 已带 uid）。
- 可选：在「最近提交」页或设置里加一个「修复历史归属」按钮，触发 `/api/qc/fix`。本次先提供接口，前端按钮后续按需加。

## 4. 受影响文件

| 文件 | 改动 |
|------|------|
| `dashboard.py` | 新增 `_QC_LOGIN`/`_QC_TOKENS`/`_get_qc_token`；`upstream` 加 token 参数；`_handle_qc_submit` 按 uid 选 token；新增 `/api/qc/fix` 路由与 `_handle_qc_fix` |

## 5. 边界与异常

- **王哲跳过**：`_QC_LOGIN` 不含王哲 uid，`_get_qc_token` 返回 None，提交回退 owner token（行为同现状，归属到于荣华）。
- **token 过期**：`_get_qc_token` 缓存后若某次提交返回 401，可重新登录重试一次（本次先做简单版：失败直接算 failed，不自动重登）。
- **修复接口幂等**：重复调用无副作用；只动已 passed/rejected 图。
- **历史修复规模**：李劲名下约 993 张（passed 989 + rejected 4），并发重放约几十秒到 1 分钟，接口同步返回结果，前端需提示「进行中」。

## 6. 预期结果

- 质检平台选李劲质检通过/打回，平台监控里李劲 passed/rejected 正确累加。
- 选李庆广同理。
- 调用 `/api/qc/fix` 后，之前错归于荣华的历史通过/打回数，归回到李劲/李庆广名下；于荣华名下"无主"数归零。
