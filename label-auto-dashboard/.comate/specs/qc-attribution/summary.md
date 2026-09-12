# 按质检员归属质检结果 总结（qc-attribution）

## 完成内容

### 后端 token 池
- 新增 `_QC_LOGIN`（李劲、李庆广的邮箱/密码）与 `_QC_TOKENS` 缓存。
- 新增 `_get_qc_token(uid)`：登录对应质检员并缓存 token，未配置/失败返回 None。
- `upstream()` 增加 `token=None` 参数，默认用全局 owner TOKEN，传入时用指定 token。

### 提交质检按人归属
- `_handle_qc_submit` 用 `_get_qc_token(uid)` 取质检员本人 token 调 `/qc`；拿不到（如王哲）回退 owner token。
- verdict 记录 / 最近提交 / 缓存清理逻辑不变。

### 历史归属修复
- 新增 `POST /api/qc/fix`（body `{pid, uid}`）：
  - 用质检员 token 拉名下 `/images`，筛 `passed/rejected`。
  - 并发 8 路重放对应 verdict（passed→pass，rejected→reject），返回 total/succeeded/failed。

## 验证
- `py_compile dashboard.py` 通过。
- 独立脚本实测：李劲 token 幂等 pass 返回 200；李劲名下 passed/rejected 共 993 张可重放。`_get_qc_token` + `upstream(token=)` 逻辑正确。
- 王哲未配置凭据，提交回退 owner（行为同现状）。

## 使用方式
- 质检平台选李劲/李庆广质检通过/打回，平台监控里 passed/rejected 会正确累加。
- 修复李劲历史归属：`POST /api/qc/fix` body `{"pid":"2e264cd3eaca","uid":"68f4d0965cb3"}`（前端按钮未加，可先用接口/后续补按钮）。
