# 只加载最新 3 个项目（减轻压力）—— 总结

## 完成内容

在 `d:\Project\test\label-auto-dashboard\dashboard.py` 中实现了「后台只主动加载创建时间最新的前 3 个项目」，其余老项目按需加载，减轻对平台接口的压力。

## 具体改动

1. 顶部常量区新增：
   ```python
   TOP_PROJECTS = 3  # 后台只主动刷新创建时间最新的前 N 个项目
   ```

2. `get_project()` 之后新增辅助函数：
   ```python
   def get_top_projects(n=TOP_PROJECTS):
       """按创建时间倒序，取最新的前 n 个项目（缺字段排最后）"""
       proj = get_projects()
       ps = list(proj.get("projects", []))
       ps.sort(key=lambda p: p.get("created_at") or "", reverse=True)
       return ps[:n]
   ```

3. `preload_all()`：遍历对象从全部项目改为 `get_top_projects()`。

4. `background_refresh_loop()`：遍历对象从全部项目改为 `get_top_projects()`。

## 校验

`python -m py_compile dashboard.py` 语法通过。

## 效果

- 登录预加载与后台每 15 秒刷新，只处理创建时间最新的 3 个项目，请求量显著下降。
- 页面项目下拉仍显示全部项目；用户手动选中老项目时仍按需加载，功能不受影响。
