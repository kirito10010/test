# 按质检员归属质检结果实施任务（qc-attribution）

- [x] Task 1: 后端 token 池与 upstream 指定 token
    - 1.1: 新增 `_QC_LOGIN` 映射（李劲/李庆广）与 `_QC_TOKENS` 缓存
    - 1.2: 新增 `_get_qc_token(uid)` 登录并缓存 token
    - 1.3: `upstream()` 增加 `token=None` 参数，默认全局 TOKEN
    - 1.4: `py_compile dashboard.py` 语法自检

- [x] Task 2: 提交质检按人选择 token
    - 2.1: `_handle_qc_submit` 内按 uid 取 token，拿不到回退 owner token
    - 2.2: 保持 verdicts 记录/最近提交逻辑不变
    - 2.3: `py_compile` 自检

- [x] Task 3: 历史归属修复接口
    - 3.1: 新增 `_handle_qc_fix`：用质检员 token 拉名下 images，筛 passed/rejected
    - 3.2: 并发 8 路重放 verdict，返回 total/succeeded/failed
    - 3.3: `_route` 增加 `POST /api/qc/fix` 路由并做参数校验
    - 3.4: `py_compile` 自检

- [x] Task 4: 联调与自检
    - 4.1: `py_compile dashboard.py` 通过
    - 4.2: 验证选李劲质检通过后监控李劲 passed 累加
    - 4.3: 验证 `/api/qc/fix` 修复李劲历史归属，返回 succeeded 正确
