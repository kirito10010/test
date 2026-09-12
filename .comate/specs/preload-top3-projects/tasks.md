# 只加载最新 3 个项目（减轻压力）

- [x] Task 1: 新增 TOP_PROJECTS 常量与 get_top_projects 辅助函数
    - 1.1: 在 dashboard.py 顶部常量区（REFRESH_INTERVAL 附近）新增 `TOP_PROJECTS = 3`
    - 1.2: 在 `get_projects()` 之后新增 `get_top_projects(n=TOP_PROJECTS)`：按 `created_at` 倒序排序，缺字段按空串处理，返回前 n 个

- [x] Task 2: 收窄 preload_all 与 background_refresh_loop 的遍历范围
    - 2.1: `preload_all()` 的循环 `for p in proj.get("projects", [])` 改为 `for p in get_top_projects()`
    - 2.2: `background_refresh_loop()` 的循环 `for p in proj.get("projects", [])` 改为 `for p in get_top_projects()`
    - 2.3: 用 `python -m py_compile dashboard.py` 校验语法
