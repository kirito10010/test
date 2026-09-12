#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Label Auto 外接看板 —— 本地服务
双击 启动看板.bat 或运行 `python dashboard.py` 即可。
零依赖，仅用 Python 标准库。
"""
import http.server
import collections
import json
import os
import io
import re
import time
import threading
import webbrowser
import zipfile
import urllib.request
import urllib.parse
import urllib.error
import concurrent.futures
import sys
import pystray
from PIL import Image

BASE = "http://172.21.205.141:8771"      # Label Auto 平台地址
PORT_START = 5221                         # 监听端口
SORT_CONCURRENCY = 16                     # 查询时并发拉取实时 annotation 的并发上限
QC_EMAIL = "v_yuronghua@baidu.com"       # 质检平台默认登录账号（owner/admin）
QC_PASSWORD = "pw123456"
# 打包成 exe（PyInstaller 冻结）时：静态文件在临时解压目录 _MEIPASS 里。
if getattr(sys, "frozen", False):
    HERE = os.path.dirname(os.path.abspath(sys.executable))
    STATIC_DIR = os.path.join(getattr(sys, "_MEIPASS", HERE), "static")
else:
    HERE = os.path.dirname(os.path.abspath(__file__))
    STATIC_DIR = os.path.join(HERE, "static")

# 构建模式：由 PyInstaller runtime hook 注入环境变量区分。
#   dev     → 开发版（三合一：看板 + 质检 + 作业，内置账号，可切换质检员/作业员/平台）
#   release → 发布版（登录自己账号，无看板，不能切换，内置管理员仅用于改属性权限）
RELEASE_MODE = os.environ.get("LABEL_AUTO_RELEASE") == "1"
VERSION = "1.1.2"   # 发布版自更新用：当前版本号
UPDATE_URL = "https://raw.githubusercontent.com/kirito10010/test/main/version.json"

# ---------- 会话状态 ----------
TOKEN = None
USER = None
_CACHE = {}   # key -> (expire_ts, data)

# 查询进度（供前端轮询显示）
_PROGRESS = {"phase": "", "total": 0, "done": 0}

# 最近提交记录（仅内存，不落盘；供「最近提交」页与快照滞后纠正用）
_RECENT_GROUPS = []

# 保存标注后，该图在平台侧会被重置为 pending，但 /images 快照有滞后；
# 记录 pid -> set(image_id)，用于在 counts/assigned 里把它当 pending 纠正。
_SAVE_PENDING = {}

# 质检员/作业员登录凭据（用于以其本人 token 提交 /qc，使平台按 token 正确归属质检结果；
# 也用于局域网访问时按「是否有内置账号」决定是否弹登录框）。
# 发布版（release）清空：只留于荣华一个内置管理员（QC_EMAIL/QC_PASSWORD），供「改属性」等用其权限。
_QC_LOGIN = {} if RELEASE_MODE else {
    # 质检员
    "68f4d0965cb3": {"email": "v_lijin10@baidu.com", "password": "pw123456"},              # 李劲
    "d82165faee87": {"email": "v_liqingguang01@baidu.com", "password": "pw123456"},        # 李庆广
    "5ae7790e0793": {"email": "v_zhanghongchao01@baidu.com", "password": "huiyi4956.."},   # 张洪超（超子）
    # 作业员
    "373ef86dae05": {"email": "v_guoyanan@baidu.com", "password": "123456"},               # 郭雅楠
    "7d716942e23d": {"email": "v_limin30@baidu.com", "password": "pw123456"},              # 李敏
    "5e6a072c2a0c": {"email": "v_liyaping05@baidu.com", "password": "123456"},             # 李亚萍（呆柠）
    "78ca63ae51b1": {"email": "v_lvyixin@baidu.com", "password": "123456"},                # 吕一鑫
    "e77b61dfe6b3": {"email": "v_haotiantian01@baidu.com", "password": "123456"},          # 郝田田
    "f0619e1562e9": {"email": "v_niqingge@baidu.com", "password": "pw123456"},             # 倪庆阁
}
_QC_TOKENS = {}   # uid -> token（登录后缓存）


def _get_qc_token(uid):
    """返回该质检员自己的 token；未配置或登录失败返回 None（调用方回退 owner token）"""
    if not uid:
        return None
    if uid in _QC_TOKENS:
        return _QC_TOKENS[uid]
    cfg = _QC_LOGIN.get(uid)
    if not cfg:
        return None
    s, h, raw = upstream("POST", "/api/login",
                         body={"email": cfg["email"], "password": cfg["password"]})
    if s == 200:
        try:
            d = json.loads(raw.decode("utf-8"))
            tok = d.get("token")
            if tok:
                _QC_TOKENS[uid] = tok
                return tok
        except Exception:
            pass
    return None


def _current_uid():
    """当前登录用户 uid（发布版登录自己账号后，由请求头写入 USER）"""
    return (USER or {}).get("id") or ""


# ======================================================================
# 转发 Label Auto API
# ======================================================================
# 限制对上游的并发请求数，避免多人同时使用时把原平台拖慢
_UPSTREAM_SEM = threading.Semaphore(8)


def upstream(method, path, query=None, body=None, raw_body=None, extra_headers=None, token=None):
    """把请求转发到 Label Auto，自动附带 Bearer token。返回 (status, headers, bytes)

    token 参数可指定用某个用户的 token（如质检员本人），缺省用全局 owner TOKEN。
    """
    url = BASE + path
    if query:
        url += "?" + urllib.parse.urlencode(query)
    headers = {}
    tok = token or TOKEN
    if tok:
        headers["Authorization"] = "Bearer " + tok
    if extra_headers:
        headers.update(extra_headers)
    data = raw_body
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers.setdefault("Content-Type", "application/json")
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with _UPSTREAM_SEM:
        try:
            resp = urllib.request.urlopen(req, timeout=180)
            return resp.status, dict(resp.headers), resp.read()
        except urllib.error.HTTPError as e:
            return e.code, dict(e.headers), e.read()
        except Exception as e:
            return 502, {}, json.dumps(
                {"ok": False, "error": "无法连接平台 %s：%s" % (BASE, e)},
                ensure_ascii=False).encode("utf-8")


def json_bytes(obj):
    return json.dumps(obj, ensure_ascii=False).encode("utf-8")


# ---------- 缓存 ----------
def cache_get(key, ttl=60):
    if key in _CACHE:
        exp, data = _CACHE[key]
        if time.time() < exp:
            return data
    return None


def cache_set(key, data, ttl=60):
    _CACHE[key] = (time.time() + ttl, data)


def _clear_cache_keep_stable():
    """写操作后清缓存，但保留 images_* 与 projects。

    状态纠正在 qc_counts/qc_assigned 里由 _SAVE_PENDING + _recent_verdict_overrides
    完成，无需重拉全量 /images；若连 images 缓存也清掉，提交/保存后刷新会因
    重新拉全量图片列表而明显变慢。
    """
    for k in list(_CACHE.keys()):
        if not k.startswith("images_") and k != "projects":
            _CACHE.pop(k, None)
    clear_overrides_cache()   # 提交/保存后旧的 rejected 复核结果已失效，清掉立即可见


# ======================================================================
# 数据获取
# ======================================================================
def get_projects(force=False):
    data = None if force else cache_get("projects", ttl=1800)
    if data is None:
        status, h, raw = upstream("GET", "/api/projects", token=_get_owner_token())
        if status != 200:
            raise RuntimeError("拉取项目列表失败 HTTP %s" % status)
        data = json.loads(raw.decode("utf-8"))
        cache_set("projects", data, ttl=1800)
    return data


def get_project(pid):
    proj = get_projects()
    for p in proj.get("projects", []):
        if p.get("id") == pid:
            return p
    # 缓存里没有（可能是刚新建的项目，快照滞后）→ 强制刷新一次再找
    proj = get_projects(force=True)
    for p in proj.get("projects", []):
        if p.get("id") == pid:
            return p
    return None


def get_export_labels(pid, force=False):
    """全量导出（zip 内一个 labels json），默认缓存 30 分钟；force=True 时强制拉最新"""
    data = None if force else cache_get("export_" + pid, ttl=1800)
    if data is None:
        status, h, raw = upstream("GET", "/api/projects/%s/export" % pid,
                                  query={"format": "json"}, token=_get_owner_token())
        if status != 200:
            raise RuntimeError("导出失败 HTTP %s：%s" % (status, raw[:200].decode('utf-8', 'ignore')))
        zf = zipfile.ZipFile(io.BytesIO(raw))
        name = zf.namelist()[0]
        data = json.loads(zf.read(name).decode("utf-8"))
        cache_set("export_" + pid, data, ttl=1800)
    return data


_IMAGES_LOCK = threading.Lock()
_IMAGES_REFRESHING = set()   # 正在后台刷新的 pid，避免重复刷新


def get_images(pid):
    """图片列表（滞后快照）。stale-while-revalidate：
    缓存过期也先返回旧数据，同时后台异步刷新，前台永不阻塞；
    只有冷启动（完全无缓存）时才同步拉取一次。"""
    key = "images_" + pid
    ent = _CACHE.get(key)
    if ent is not None:
        expire_ts, data = ent
        if time.time() >= expire_ts:
            _refresh_images_async(pid)
        return data
    return _fetch_images_sync(pid)


def _fetch_images_sync(pid):
    key = "images_" + pid
    with _IMAGES_LOCK:
        ent = _CACHE.get(key)
        if ent is not None:
            return ent[1]
        status, h, raw = upstream("GET", "/api/projects/%s/images" % pid,
                                  token=_get_owner_token())
        if status != 200:
            # 拉取失败（token 失效/上游异常）时绝不缓存坏数据，否则会把列表/打回全部清空
            raise RuntimeError("拉取图片列表失败 HTTP %s" % status)
        data = json.loads(raw.decode("utf-8"))
        cache_set(key, data, ttl=180)
        return data


def _refresh_images_async(pid):
    """后台刷新图片列表缓存，不阻塞前台请求。"""
    with _IMAGES_LOCK:
        if pid in _IMAGES_REFRESHING:
            return
        _IMAGES_REFRESHING.add(pid)

    def _run():
        try:
            status, h, raw = upstream("GET", "/api/projects/%s/images" % pid,
                                      token=_get_owner_token())
            if status == 200:
                data = json.loads(raw.decode("utf-8"))
                cache_set("images_" + pid, data, ttl=180)
        except Exception:
            pass
        finally:
            with _IMAGES_LOCK:
                _IMAGES_REFRESHING.discard(pid)

    threading.Thread(target=_run, daemon=True).start()


# 图片缓存：图片内容不可变（上游带 Cache-Control: immutable），缓存可大幅减少对上游的
# 重复请求，多人同时使用时尤其重要。用 OrderedDict 做简单的 LRU 淘汰。
_IMAGE_CACHE = collections.OrderedDict()   # pid/image_id -> (expire_ts, content_type, bytes)
_IMAGE_CACHE_MAX = 100
_IMAGE_CACHE_LOCK = threading.Lock()

# 同一张图并发请求时只拉一次上游（预加载与实际展示可能同时请求同一张图）
_IMAGE_INFLIGHT = {}
_IMAGE_INFLIGHT_LOCK = threading.Lock()


def _image_cache_get(pid, image_id):
    key = pid + "/" + image_id
    with _IMAGE_CACHE_LOCK:
        ent = _IMAGE_CACHE.get(key)
        if ent and time.time() < ent[0]:
            _IMAGE_CACHE.move_to_end(key)
            return ent[1], ent[2]
        if ent:
            _IMAGE_CACHE.pop(key, None)
        return None


def _image_cache_put(pid, image_id, content_type, body):
    key = pid + "/" + image_id
    with _IMAGE_CACHE_LOCK:
        _IMAGE_CACHE[key] = (time.time() + 3600, content_type, body)
        _IMAGE_CACHE.move_to_end(key)
        while len(_IMAGE_CACHE) > _IMAGE_CACHE_MAX:
            _IMAGE_CACHE.popitem(last=False)


_OWNER_TOKEN = None
_OWNER_TOKEN_LOCK = threading.Lock()


def _get_owner_token():
    """登录 owner（于荣华）并缓存 token；用于拉取 admin 接口（名字映射等）"""
    global _OWNER_TOKEN
    if _OWNER_TOKEN:
        return _OWNER_TOKEN
    with _OWNER_TOKEN_LOCK:
        if _OWNER_TOKEN:
            return _OWNER_TOKEN
        s, h, raw = upstream("POST", "/api/login",
                             body={"email": QC_EMAIL, "password": QC_PASSWORD})
        if s == 200:
            try:
                d = json.loads(raw.decode("utf-8"))
                _OWNER_TOKEN = d.get("token")
                return _OWNER_TOKEN
            except Exception:
                pass
    return None


def get_monitoring():
    data = cache_get("monitoring", ttl=60)
    if data is None:
        status, h, raw = upstream("GET", "/api/admin/monitoring", token=_get_owner_token())
        data = json.loads(raw.decode("utf-8"))
        cache_set("monitoring", data, ttl=60)
    return data


def get_users():
    """全部用户 id -> display_name（来自 /api/admin/users），供名字映射"""
    data = cache_get("users", ttl=300)
    if data is None:
        status, h, raw = upstream("GET", "/api/admin/users", token=_get_owner_token())
        data = json.loads(raw.decode("utf-8"))
        cache_set("users", data, ttl=300)
    return data


def build_uid_name_map():
    """uid -> 名字，来自 /api/admin/users（display_name）"""
    m = {}
    try:
        d = get_users()
        for u in d.get("users", []):
            if isinstance(u, dict) and u.get("id"):
                m[u["id"]] = u.get("display_name") or u.get("email") or u["id"]
    except Exception:
        pass
    return m


def build_qc_owner_map(pid):
    """pic_base -> 质检员名字"""
    proj = get_project(pid)
    names = build_uid_name_map()
    result = {}
    if proj:
        qa = proj.get("qc_assignments") or {}
        for uid, files in qa.items():
            nm = names.get(uid, uid)
            for f in files:
                base = os.path.splitext(os.path.basename(f))[0]
                result[base] = nm
    return result


def category_to_export_idx(proj, cat_name):
    """分类名 -> 导出用的 1-based 编号"""
    cats = proj.get("categories", []) or []
    for i, c in enumerate(cats):
        if c == cat_name:
            return i + 1
    return None


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


# ======================================================================
# 查询逻辑
# ======================================================================
def _base_name(pic):
    return os.path.splitext(os.path.basename(pic))[0]


def _image_id(pic):
    return pic if pic.endswith(".jpg") else pic + ".jpg"


def _fmt_ts(epoch):
    return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(epoch))


# annotation 状态缓存：qc_status/reviewed_at 短时间不变，缓存 30s。
# _reconcile_rejected 会对所有 rejected 图逐张拉 annotation，若每次都现查，
# 累计打回图多时会拖慢列表/计数请求（首屏与提交后卡顿的主因之一）。
_ANNOTATION_CACHE = {}
_ANNOTATION_CACHE_LOCK = threading.Lock()


def fetch_annotations(pid, image_ids, max_workers=SORT_CONCURRENCY):
    """并发拉取每张图的 qc_status + reviewed_at（带 30s 短缓存）"""
    data = {}
    _PROGRESS["phase"] = "annotation"
    _PROGRESS["total"] = len(image_ids)
    _PROGRESS["done"] = 0
    def _one(img):
        key = (pid, img)
        with _ANNOTATION_CACHE_LOCK:
            ent = _ANNOTATION_CACHE.get(key)
            if ent and time.time() < ent[0]:
                return img, ent[1]
        s, h, raw = upstream("GET", "/api/projects/%s/annotation" % pid,
                             query={"image_id": img}, token=_get_owner_token())
        try:
            d = json.loads(raw.decode("utf-8"))
            v = {"qc_status": d.get("qc_status") or "",
                 "reviewed_at": d.get("reviewed_at") or ""}
        except Exception:
            v = {"qc_status": "", "reviewed_at": ""}
        with _ANNOTATION_CACHE_LOCK:
            _ANNOTATION_CACHE[key] = (time.time() + 30, v)
        return img, v
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as ex:
        for img, v in ex.map(_one, image_ids):
            data[img] = v
            _PROGRESS["done"] += 1
    return data


def _reconcile_rejected(pid, overrides):
    """对被本地判定为 rejected 的图，用 /annotation 实时状态复核。

    本地 override 记录的是「质检员打回」这一动作，但它没有失效机制；
    作业员重新提交标注后平台真实 qc_status 已变回 pending。此处对 reject 图逐张实时复核：
    - 仍 rejected：保留打回纠正
    - 已 pending：撤销打回、标记为 pending，让该图立刻回到「待质检」
    - 已 passed：撤销打回、标记为 passed
    """
    reject_ids = [k for k, v in overrides.items() if v == "reject"]
    if not reject_ids:
        return overrides
    fresh = fetch_annotations(pid, reject_ids)
    for k in reject_ids:
        st = (fresh.get(k) or {}).get("qc_status") or ""
        if st == "pending":
            overrides[k] = "pending"
        elif st == "passed":
            overrides[k] = "pass"
        elif not st:
            continue  # 拿不到状态，保留原 reject
        # st == "rejected"：保留 reject
    return overrides


# 复核结果缓存：_reconcile_rejected 会对所有 rejected 图逐张拉 annotation（最多 400 张），
# 而它每次列表/计数请求都会跑一遍，是首屏与提交后「卡 2~3 秒」的主因。给它一个短 TTL 缓存。
_OVERRIDES_CACHE = {}
_OVERRIDES_CACHE_LOCK = threading.Lock()


def get_overrides(pid, uid):
    key = (pid, uid)
    with _OVERRIDES_CACHE_LOCK:
        ent = _OVERRIDES_CACHE.get(key)
        if ent and time.time() < ent[0]:
            return ent[1]
    overrides = _recent_verdict_overrides(pid, uid)
    overrides = _reconcile_rejected(pid, overrides)
    with _OVERRIDES_CACHE_LOCK:
        _OVERRIDES_CACHE[key] = (time.time() + 15, overrides)
    return overrides


def clear_overrides_cache():
    with _OVERRIDES_CACHE_LOCK:
        _OVERRIDES_CACHE.clear()


def _status_and_owner_maps(pid):
    imgs = get_images(pid)
    status_map = {}
    for im in imgs.get("images", []):
        status_map[_base_name(im.get("image_id", ""))] = im.get("qc_status")
    owner_map = build_qc_owner_map(pid)
    return status_map, owner_map


def query_images(pid, cat_names, sort=None, passed_minutes=None):
    """按一个或多个分类名查命中图；cat_names 为空时返回全部已标注图
    passed_minutes>0 时，只返回该时间窗内新通过、且当前仍为 passed 的图，按通过时间倒序"""
    proj = get_project(pid)
    if not proj:
        raise RuntimeError("项目不存在：" + pid)
    idxs = set()
    for c in cat_names:
        i = category_to_export_idx(proj, c)
        if i is not None:
            idxs.add(i)
    # 排序/通过时间查询需要最新图列表（刚新分配到质检员的图会出现在导出里），强制刷新导出
    force_export = bool(sort == "reviewed_desc" or passed_minutes)
    _PROGRESS["phase"] = "export"
    _PROGRESS["total"] = 0
    _PROGRESS["done"] = 0
    labels = get_export_labels(pid, force=force_export)
    status_map, owner_map = _status_and_owner_maps(pid)
    results = []
    for item in labels.get("labels", []):
        pic = item.get("pic_id", "")
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
        base = _base_name(pic)
        results.append({
            "image_id": _image_id(pic),
            "boxes": boxes,
            "box_count": box_count,
            "qc_status": status_map.get(base, "?"),
            "qc_owner": owner_map.get(base, ""),
        })
    if passed_minutes:
        # 通过时间过滤：用实时 annotation 判断「N 分钟内通过且当前仍 passed」
        cutoff = _fmt_ts(time.time() - passed_minutes * 60)
        ann = fetch_annotations(pid, [r["image_id"] for r in results])
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
        # 用实时 annotation 的 reviewed_at + qc_status，避免 /images 快照延迟
        ann = fetch_annotations(pid, [r["image_id"] for r in results])
        for r in results:
            a = ann.get(r["image_id"], {})
            r["qc_status"] = a.get("qc_status") or r.get("qc_status")
            r["reviewed_at"] = a.get("reviewed_at") or ""
        # 新→旧；空时间（待质检）排最后
        results.sort(key=lambda r: r["reviewed_at"], reverse=True)
    return results


def leak_images(pid, cat_names):
    """漏标：passed 但仍带这些标签的图"""
    return [r for r in query_images(pid, cat_names) if r["qc_status"] == "passed"]


def distribution(pid):
    proj = get_project(pid)
    if not proj:
        raise RuntimeError("项目不存在：" + pid)
    cats = proj.get("categories", []) or []
    counts = {c: 0 for c in cats}
    labels = get_export_labels(pid)
    for item in labels.get("labels", []):
        for b in item.get("bboxes", []):
            if len(b) >= 5:
                idx = b[4] - 1
                if 0 <= idx < len(cats):
                    counts[cats[idx]] += 1
    return [{"category": c, "count": counts[c]} for c in cats]


def search_images(pid, q):
    """按文件名子串搜索图片（含 qc_status / box_count / 质检员）"""
    ql = (q or "").lower()
    imgs = get_images(pid)
    owner_map = build_qc_owner_map(pid)
    results = []
    for im in imgs.get("images", []):
        iid = im.get("image_id", "")
        if ql in iid.lower():
            base = os.path.splitext(os.path.basename(iid))[0]
            results.append({
                "image_id": iid,
                "qc_status": im.get("qc_status"),
                "box_count": im.get("box_count"),
                "annotated": im.get("annotated"),
                "qc_owner": owner_map.get(base, ""),
            })
    return results


# ======================================================================
# 质检平台
# ======================================================================
def qc_setup():
    """返回项目与各项目质检员（uid/name），供质检平台初始化。
    发布版（release）按当前登录用户锁定（admin 保留切换）。"""
    proj_data = get_projects()
    names = build_uid_name_map()
    if RELEASE_MODE:
        uid = _current_uid()
        role = (USER or {}).get("role") or ""
        is_admin = (role == "admin")
        out = []
        for p in proj_data.get("projects", []):
            pid = p.get("id")
            qc_assignees = p.get("qc_assignees") or []
            if not is_admin and uid not in qc_assignees and uid not in (p.get("qc_assignments") or {}):
                continue
            reviewers = ([{"uid": u, "name": names.get(u, u), "has_login": False} for u in qc_assignees]
                         if is_admin else
                         [{"uid": uid, "name": names.get(uid, uid), "has_login": False}])
            out.append({"id": pid, "name": p.get("name"), "reviewers": reviewers,
                        "categories": p.get("categories") or []})
        return out
    out = []
    for p in proj_data.get("projects", []):
        pid = p.get("id")
        reviewers = [{"uid": uid, "name": names.get(uid, uid), "has_login": uid in _QC_LOGIN}
                     for uid in p.get("qc_assignees") or []]
        out.append({"id": pid, "name": p.get("name"), "reviewers": reviewers,
                    "categories": p.get("categories") or []})
    return out


def _recent_verdict_overrides(pid, uid):
    """返回最近提交的 image_id -> verdict 映射（用于纠正 /images 的状态滞后，最新提交优先）"""
    overrides = {}
    for g in _RECENT_GROUPS:
        if g.get("pid") == pid and g.get("uid") == uid:
            for k, v in (g.get("verdicts") or {}).items():
                overrides.setdefault(k, v)  # 最新的组优先
    return overrides


def qc_counts(pid, uid):
    """返回某质检员的实时数量：总数 / 作业中 / 待质检 / 已通过 / 已打回"""
    proj = get_project(pid)
    if not proj:
        raise RuntimeError("项目不存在：" + pid)
    files = (proj.get("qc_assignments") or {}).get(uid) or []
    imgs = get_images(pid)
    status_map = {}
    for im in imgs.get("images", []):
        iid = im.get("image_id")
        if iid:
            status_map[iid] = im.get("qc_status")
    overrides = get_overrides(pid, uid)
    save_pending = _SAVE_PENDING.get(pid) or set()
    total = len(files)
    pending = passed = rejected = 0
    for f in files:
        st = status_map.get(f)
        if f in overrides:
            v = overrides[f]
            if v == "pass":
                st = "passed"
            elif v == "pending":
                st = "pending"
            else:
                st = "rejected"
        elif f in save_pending:
            st = "pending"
        if st == "pending":
            pending += 1
        elif st == "passed":
            passed += 1
        elif st == "rejected":
            rejected += 1
    annotating = total - pending - passed - rejected
    return {"total": total, "annotating": annotating, "pending": pending,
            "passed": passed, "rejected": rejected}


def qc_recent(pid, uid):
    """返回该质检员最近提交的照片（按提交顺序，最新在前，最多 3 组=12 张）"""
    out = []
    for g in _RECENT_GROUPS:
        if g.get("pid") == pid and g.get("uid") == uid:
            out.extend(g.get("image_ids") or [])
    return {"items": out[:12]}


def qc_save(pid, image_id, boxes):
    """保存某张图的标注框（整体替换）。返回 {ok, box_count} 或 {ok, error}"""
    s, h, raw = upstream("POST", "/api/projects/%s/save" % pid,
                         body={"image_id": image_id, "boxes": boxes})
    try:
        d = json.loads(raw.decode("utf-8"))
    except Exception:
        d = {}
    if s == 200 and d.get("ok"):
        _clear_cache_keep_stable()
        # 该图标注已变更，平台会重置为 pending；清除本地最近提交里对它的状态纠正，
        # 否则「已打回」等列表仍会按旧 verdict 显示它
        for g in _RECENT_GROUPS:
            if g.get("pid") == pid:
                (g.get("verdicts") or {}).pop(image_id, None)
        # 记录「保存后应为 pending」的纠正，弥补 /images 快照滞后
        _SAVE_PENDING.setdefault(pid, set()).add(image_id)
        return {"ok": True, "box_count": d.get("box_count", len(boxes))}
    return {"ok": False, "error": d.get("error") or ("HTTP %s" % s)}


def qc_assigned(pid, uid, status, offset, limit, cat_names=None):
    """返回某质检员在指定 qc_status 下的图片列表（分页）；cat_names 非空时按属性过滤"""
    proj = get_project(pid)
    if not proj:
        raise RuntimeError("项目不存在：" + pid)
    files = (proj.get("qc_assignments") or {}).get(uid) or []
    imgs = get_images(pid)
    status_map = {}
    for im in imgs.get("images", []):
        iid = im.get("image_id")
        if iid:
            status_map[iid] = im.get("qc_status")
    overrides = get_overrides(pid, uid)
    save_pending = _SAVE_PENDING.get(pid) or set()
    cat_bases = category_match_bases(pid, cat_names) if cat_names else None
    matched = []
    for f in files:
        if cat_bases is not None and _base_name(f) not in cat_bases:
            continue
        st = status_map.get(f)
        if f in overrides:
            v = overrides[f]
            if v == "pass":
                st = "passed"
            elif v == "pending":
                st = "pending"
            else:
                st = "rejected"
        elif f in save_pending:
            st = "pending"
        if st == status:
            matched.append(f)
    total = len(matched)
    items = matched[offset:offset + limit]
    return {"total": total, "items": items}


def anno_setup():
    """返回项目与各项目作业员（uid/name/has_login），供作业平台初始化。
    发布版（release）按当前登录用户锁定（admin 保留切换）。"""
    proj_data = get_projects()
    names = build_uid_name_map()
    if RELEASE_MODE:
        uid = _current_uid()
        role = (USER or {}).get("role") or ""
        is_admin = (role == "admin")
        out = []
        for p in proj_data.get("projects", []):
            pid = p.get("id")
            assignees = p.get("assignees") or []
            if not is_admin and uid not in assignees and uid not in (p.get("assignments") or {}):
                continue
            annotators = ([{"uid": u, "name": names.get(u, u), "has_login": False} for u in assignees]
                          if is_admin else
                          [{"uid": uid, "name": names.get(uid, uid), "has_login": False}])
            out.append({"id": pid, "name": p.get("name"), "annotators": annotators,
                        "categories": p.get("categories") or []})
        return out
    out = []
    for p in proj_data.get("projects", []):
        pid = p.get("id")
        annotators = [{"uid": uid, "name": names.get(uid, uid), "has_login": uid in _QC_LOGIN}
                      for uid in p.get("assignees") or []]
        out.append({"id": pid, "name": p.get("name"), "annotators": annotators,
                    "categories": p.get("categories") or []})
    return out


def daily_stats(uid):
    """每日标注量/质检量。发布版用当前登录用户 token；开发版用所选内置账号 token。"""
    if RELEASE_MODE:
        if not TOKEN:
            return {"ok": True, "has_login": False}
        tok = TOKEN
    else:
        if not uid or uid not in _QC_LOGIN:
            return {"ok": True, "has_login": False}
        tok = _get_qc_token(uid)
        if not tok:
            return {"ok": False, "error": "无法登录该账号"}
    s, h, raw = upstream("GET", "/api/my_daily_stats", token=tok)
    try:
        d = json.loads(raw.decode("utf-8"))
    except Exception:
        d = {}
    if s != 200 or not d.get("ok"):
        return {"ok": False, "error": d.get("error") or ("HTTP %s" % s)}
    return {"ok": True, "has_login": True,
            "annotated_days": d.get("annotated_days") or [],
            "qc_days": d.get("qc_days") or []}


def anno_qc_owners(pid, uid):
    """返回某作业员名下每张图归哪个质检员：qc_of(image_id -> {uid,name}) + qcs(去重质检员列表)"""
    proj = get_project(pid)
    if not proj:
        raise RuntimeError("项目不存在：" + pid)
    files = (proj.get("assignments") or {}).get(uid) or []
    names = build_uid_name_map()
    qc_uid_of = {}
    for qc_uid, flist in (proj.get("qc_assignments") or {}).items():
        for f in flist:
            qc_uid_of[os.path.splitext(os.path.basename(f))[0]] = qc_uid
    qc_of = {}
    qcs = {}
    for f in files:
        base = os.path.splitext(os.path.basename(f))[0]
        qc_uid = qc_uid_of.get(base) or ""
        if qc_uid:
            nm = names.get(qc_uid, qc_uid)
            qc_of[f] = {"uid": qc_uid, "name": nm}
            qcs.setdefault(qc_uid, nm)
    return {"qc_of": qc_of, "qcs": [{"uid": u, "name": n} for u, n in qcs.items()]}


def qc_annotator_owners(pid, uid):
    """返回某质检员名下每张图由哪个作业员标注：ann_of(image_id -> {uid,name}) + anns(去重作业员列表)"""
    proj = get_project(pid)
    if not proj:
        raise RuntimeError("项目不存在：" + pid)
    files = (proj.get("qc_assignments") or {}).get(uid) or []
    names = build_uid_name_map()
    ann_uid_of = {}
    for a_uid, flist in (proj.get("assignments") or {}).items():
        for f in flist:
            ann_uid_of[os.path.splitext(os.path.basename(f))[0]] = a_uid
    ann_of = {}
    anns = {}
    for f in files:
        base = os.path.splitext(os.path.basename(f))[0]
        a_uid = ann_uid_of.get(base) or ""
        if a_uid:
            nm = names.get(a_uid, a_uid)
            ann_of[f] = {"uid": a_uid, "name": nm}
            anns.setdefault(a_uid, nm)
    return {"ann_of": ann_of, "anns": [{"uid": u, "name": n} for u, n in anns.items()]}


def anno_rejected_bases(pid):
    """返回当前被质检打回的图 base_name 集合（跨所有质检员，含实时复核撤销已重提交的）。
    用于作业平台的「被打回」页，弥补 /images 快照滞后导致打回图不显示的问题。"""
    overrides = {}
    for g in _RECENT_GROUPS:
        if g.get("pid") == pid:
            for k, v in (g.get("verdicts") or {}).items():
                overrides.setdefault(k, v)   # 最新组优先
    if not overrides:
        return set()
    overrides = _reconcile_rejected(pid, overrides)
    return {_base_name(k) for k, v in overrides.items() if v == "reject"}


def anno_assigned(pid, uid, status, offset, limit):
    """返回某作业员在指定作业状态下的图片列表（分页）。
    status: 'unannotated'（未作业）| 'submitted'（已提交）| 'rejected'（被打回）
    """
    proj = get_project(pid)
    if not proj:
        raise RuntimeError("项目不存在：" + pid)
    files = (proj.get("assignments") or {}).get(uid) or []
    imgs = get_images(pid)
    info = {}
    for im in imgs.get("images", []):
        iid = im.get("image_id")
        if iid:
            info[iid] = {"annotated": im.get("annotated"), "qc_status": im.get("qc_status")}
    save_pending = _SAVE_PENDING.get(pid) or set()
    rejected_bases = anno_rejected_bases(pid)
    matched = []
    for f in files:
        d = info.get(f) or {}
        annotated = d.get("annotated")
        st = d.get("qc_status")
        if f in save_pending:
            # 本地刚保存过 → 回到 pending，不再算「未作业」
            annotated = True
            st = "pending"
        elif _base_name(f) in rejected_bases:
            # 最近被质检打回（/images 快照滞后），立即按 rejected 显示
            annotated = True
            st = "rejected"
        if status == "unannotated":
            if not annotated and st != "rejected":
                matched.append(f)
        elif status == "submitted":
            if annotated and st != "rejected":
                matched.append(f)
        elif status == "rejected":
            if st == "rejected":
                matched.append(f)
    total = len(matched)
    items = matched[offset:offset + limit]
    return {"total": total, "items": items}


def anno_counts(pid, uid):
    """返回某作业员的数量：总数 / 未作业 / 已提交 / 被打回"""
    proj = get_project(pid)
    if not proj:
        raise RuntimeError("项目不存在：" + pid)
    files = (proj.get("assignments") or {}).get(uid) or []
    imgs = get_images(pid)
    info = {}
    for im in imgs.get("images", []):
        iid = im.get("image_id")
        if iid:
            info[iid] = {"annotated": im.get("annotated"), "qc_status": im.get("qc_status")}
    save_pending = _SAVE_PENDING.get(pid) or set()
    rejected_bases = anno_rejected_bases(pid)
    total = len(files)
    unannotated = submitted = rejected = 0
    for f in files:
        d = info.get(f) or {}
        annotated = d.get("annotated")
        st = d.get("qc_status")
        if f in save_pending:
            annotated = True
            st = "pending"
        elif _base_name(f) in rejected_bases:
            annotated = True
            st = "rejected"
        if st == "rejected":
            rejected += 1
        elif annotated:
            submitted += 1
        else:
            unannotated += 1
    return {"total": total, "unannotated": unannotated, "submitted": submitted, "rejected": rejected}


# ======================================================================
# HTTP Handler
# ======================================================================
class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "LabelAutoDashboard/1.0"

    def log_message(self, format, *args):
        pass  # 静默，避免刷屏

    # ---- 基础响应 ----
    def _send(self, status, headers, body):
        try:
            self.send_response(status)
            for k, v in headers.items():
                self.send_header(k, v)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except ConnectionError:
            # 客户端中途断开（翻页/关页面等），静默忽略，避免刷屏
            pass

    def _send_json(self, obj, status=200):
        self._send(status, {"Content-Type": "application/json; charset=utf-8"},
                   json_bytes(obj))

    def _serve_image(self, pid, query):
        """带内存缓存的图片转发：命中缓存直接返回，未命中拉取上游并缓存，减少对上游的重复请求。"""
        image_id = query.get("image_id", "")
        if image_id:
            cached = _image_cache_get(pid, image_id)
            if cached:
                ct, body = cached
                return self._send(200, {"Content-Type": ct,
                                        "Cache-Control": "public, max-age=3600, immutable"}, body)
        key = pid + "/" + image_id
        with _IMAGE_INFLIGHT_LOCK:
            evt = _IMAGE_INFLIGHT.get(key)
            if evt is None:
                evt = threading.Event()
                _IMAGE_INFLIGHT[key] = evt
                is_owner = True
            else:
                is_owner = False
        if not is_owner:
            evt.wait(timeout=10)
            cached = _image_cache_get(pid, image_id)
            if cached:
                ct, body = cached
                return self._send(200, {"Content-Type": ct,
                                        "Cache-Control": "public, max-age=3600, immutable"}, body)
        try:
            s, h, raw = upstream("GET", "/api/projects/%s/image" % pid, query=query)
            ct = h.get("Content-Type") or "image/jpeg"
            if s == 200 and image_id:
                _image_cache_put(pid, image_id, ct, raw)
            headers = {"Content-Type": ct}
            if h.get("Cache-Control"):
                headers["Cache-Control"] = h["Cache-Control"]
            return self._send(s, headers, raw)
        finally:
            if is_owner:
                with _IMAGE_INFLIGHT_LOCK:
                    _IMAGE_INFLIGHT.pop(key, None)
                evt.set()

    def _read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(length) if length else b""

    def _is_local(self):
        """请求是否来自本机（127.0.0.1 / ::1）。本机不做登录限制。"""
        return self.client_address[0] in ("127.0.0.1", "::1")

    def _qc_gated(self, uid):
        """质检/作业数据访问门槛。发布版只检查是否登录；开发版按内置/本地判断。"""
        if RELEASE_MODE:
            if TOKEN:
                return None
            return self._send_json({"ok": False, "need_login": True,
                                    "error": "请先登录"}, 401)
        if self._is_local():
            return None
        if uid in _QC_LOGIN:
            return None  # 内置登录，_get_qc_token 会自动登录
        if _QC_TOKENS.get(uid):
            return None  # 已手动登录过
        return self._send_json({"ok": False, "need_login": True,
                                "error": "该质检员需要登录后才能查看数据"}, 401)

    # ---- 路由 ----
    def do_GET(self):
        self._route("GET")

    def do_POST(self):
        self._route("POST")

    def _route(self, method):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)

        # 登录态由前端 localStorage 随请求头传来（发布版登录自己账号时用）
        global TOKEN, USER
        auth = self.headers.get("Authorization") or ""
        if auth.startswith("Bearer "):
            TOKEN = auth[len("Bearer "):]
        uid_h = self.headers.get("X-User-Id") or ""
        role_h = self.headers.get("X-User-Role") or ""
        if uid_h or role_h:
            USER = {"id": uid_h, "role": role_h}

        # 静态文件
        if path in ("/", "/index.html", "/qc", "/anno") or path.startswith("/static/"):
            return self._serve_static(path)

        # 登录 / 登出
        if path == "/api/login" and method == "POST":
            return self._handle_login()
        if path == "/api/logout" and method == "POST":
            TOKEN = None
            USER = None
            _CACHE.clear()
            return self._send_json({"ok": True})

        if path == "/api/me" and method == "GET":
            return self._send_json({"ok": True, "user": USER})

        if path == "/api/config" and method == "GET":
            return self._send_json({"ok": True, "release": RELEASE_MODE})

        if path == "/api/projects" and method == "GET":
            s, h, raw = upstream("GET", "/api/projects")
            return self._send(s, self._pick_headers(h), raw)

        if not RELEASE_MODE and path == "/api/monitoring" and method == "GET":
            if qs.get("force"):
                _CACHE.pop("monitoring", None)
            s, h, raw = upstream("GET", "/api/admin/monitoring")
            return self._send(s, self._pick_headers(h), raw)

        if not RELEASE_MODE and path == "/api/query_progress" and method == "GET":
            return self._send_json({"ok": True, "progress": _PROGRESS})

        # ---- 自动登录（于荣华，看板与质检平台共用） ----
        if path in ("/api/qc/autologin", "/api/autologin") and method == "GET":
            s, h, raw = upstream("POST", "/api/login",
                                 body={"email": QC_EMAIL, "password": QC_PASSWORD})
            if s == 200:
                data = json.loads(raw.decode("utf-8"))
                TOKEN = data.get("token")
                USER = data.get("user")
                return self._send_json({"ok": True, "user": USER})
            return self._send_json({"ok": False, "error": "自动登录失败 HTTP %s" % s}, 500)

        if path == "/api/qc/setup" and method == "GET":
            try:
                return self._send_json({"ok": True, "projects": qc_setup()})
            except Exception as e:
                return self._send_json({"ok": False, "error": str(e)}, 500)

        if path == "/api/anno/setup" and method == "GET":
            try:
                return self._send_json({"ok": True, "projects": anno_setup()})
            except Exception as e:
                return self._send_json({"ok": False, "error": str(e)}, 500)

        if path == "/api/daily_stats" and method == "GET":
            uid = qs.get("uid", [""])[0]
            return self._send_json(daily_stats(uid))

        if path == "/api/anno/qc_owners" and method == "GET":
            pid = qs.get("pid", [""])[0]
            uid = qs.get("uid", [""])[0]
            gate = self._qc_gated(uid)
            if gate:
                return gate
            try:
                return self._send_json({"ok": True, **anno_qc_owners(pid, uid)})
            except RuntimeError as e:
                return self._send_json({"ok": False, "error": str(e)}, 400)

        if path == "/api/qc/annotators" and method == "GET":
            pid = qs.get("pid", [""])[0]
            uid = qs.get("uid", [""])[0]
            gate = self._qc_gated(uid)
            if gate:
                return gate
            try:
                return self._send_json({"ok": True, **qc_annotator_owners(pid, uid)})
            except RuntimeError as e:
                return self._send_json({"ok": False, "error": str(e)}, 400)

        m = re.match(r"^/api/anno/assigned$", path)
        if m and method == "GET":
            pid = qs.get("pid", [""])[0]
            uid = qs.get("uid", [""])[0]
            status = qs.get("status", ["unannotated"])[0]
            try:
                offset = int(qs.get("offset", ["0"])[0] or 0)
                limit = int(qs.get("limit", ["20"])[0] or 20)
            except ValueError:
                return self._send_json({"ok": False, "error": "分页参数非法"}, 400)
            gate = self._qc_gated(uid)
            if gate:
                return gate
            try:
                return self._send_json({"ok": True, **anno_assigned(pid, uid, status, offset, limit)})
            except RuntimeError as e:
                return self._send_json({"ok": False, "error": str(e)}, 400)

        m = re.match(r"^/api/anno/counts$", path)
        if m and method == "GET":
            pid = qs.get("pid", [""])[0]
            uid = qs.get("uid", [""])[0]
            gate = self._qc_gated(uid)
            if gate:
                return gate
            try:
                return self._send_json({"ok": True, "counts": anno_counts(pid, uid)})
            except RuntimeError as e:
                return self._send_json({"ok": False, "error": str(e)}, 400)

        # 质检员手动登录（局域网访问且未内置登录时）
        if path == "/api/qc/reviewer_login" and method == "POST":
            raw = self._read_body()
            try:
                body = json.loads(raw.decode("utf-8"))
            except Exception:
                return self._send_json({"ok": False, "error": "请求体不是合法 JSON"}, 400)
            uid = body.get("uid") or ""
            email = body.get("email") or ""
            password = body.get("password") or ""
            if not uid or not email or not password:
                return self._send_json({"ok": False, "error": "参数非法"}, 400)
            s, h, raw2 = upstream("POST", "/api/login", body={"email": email, "password": password})
            if s == 200:
                try:
                    d = json.loads(raw2.decode("utf-8"))
                    tok = d.get("token")
                    if tok:
                        _QC_TOKENS[uid] = tok
                        return self._send_json({"ok": True})
                except Exception:
                    pass
            return self._send_json({"ok": False, "error": "登录失败，请检查账号密码"}, 401)

        m = re.match(r"^/api/qc/assigned$", path)
        if m and method == "GET":
            pid = qs.get("pid", [""])[0]
            uid = qs.get("uid", [""])[0]
            status = qs.get("status", ["pending"])[0]
            cat = qs.get("cat", [""])[0]
            cat_names = [c for c in cat.split(",") if c] if cat else None
            try:
                offset = int(qs.get("offset", ["0"])[0] or 0)
                limit = int(qs.get("limit", ["20"])[0] or 20)
            except ValueError:
                return self._send_json({"ok": False, "error": "分页参数非法"}, 400)
            gate = self._qc_gated(uid)
            if gate:
                return gate
            try:
                return self._send_json({"ok": True, **qc_assigned(pid, uid, status, offset, limit, cat_names)})
            except RuntimeError as e:
                return self._send_json({"ok": False, "error": str(e)}, 400)

        m = re.match(r"^/api/qc/counts$", path)
        if m and method == "GET":
            pid = qs.get("pid", [""])[0]
            uid = qs.get("uid", [""])[0]
            gate = self._qc_gated(uid)
            if gate:
                return gate
            try:
                return self._send_json({"ok": True, "counts": qc_counts(pid, uid)})
            except RuntimeError as e:
                return self._send_json({"ok": False, "error": str(e)}, 400)

        m = re.match(r"^/api/qc/recent$", path)
        if m and method == "GET":
            pid = qs.get("pid", [""])[0]
            uid = qs.get("uid", [""])[0]
            gate = self._qc_gated(uid)
            if gate:
                return gate
            return self._send_json({"ok": True, **qc_recent(pid, uid)})

        m = re.match(r"^/api/qc/submit$", path)
        if m and method == "POST":
            return self._handle_qc_submit()

        m = re.match(r"^/api/qc/fix$", path)
        if m and method == "POST":
            return self._handle_qc_fix()

        m = re.match(r"^/api/qc/save$", path)
        if m and method == "POST":
            raw = self._read_body()
            try:
                body = json.loads(raw.decode("utf-8"))
            except Exception:
                return self._send_json({"ok": False, "error": "请求体不是合法 JSON"}, 400)
            pid = body.get("pid") or ""
            iid = body.get("image_id") or ""
            boxes = body.get("boxes")
            if not pid or not iid or not isinstance(boxes, list):
                return self._send_json({"ok": False, "error": "参数非法"}, 400)
            r = qc_save(pid, iid, boxes)
            return self._send_json(r, 200 if r.get("ok") else 400)

        # /api/projects/{id}/images
        if not RELEASE_MODE:
            m = re.match(r"^/api/projects/([^/]+)/images$", path)
            if m and method == "GET":
                s, h, raw = upstream("GET", "/api/projects/%s/images" % m.group(1))
                return self._send(s, self._pick_headers(h), raw)

        # /api/projects/{id}/image  /annotation
        m = re.match(r"^/api/projects/([^/]+)/(image|annotation)$", path)
        if m and method == "GET":
            pid = m.group(1)
            kind = m.group(2)
            query = {k: v[0] for k, v in qs.items()}
            if kind == "image":
                return self._serve_image(pid, query)
            s, h, raw = upstream("GET", "/api/projects/%s/annotation" % pid, query=query)
            return self._send(s, self._pick_headers(h), raw)

        if not RELEASE_MODE:
            # /api/projects/{id}/query?cat=a,b&sort=reviewed_desc
            m = re.match(r"^/api/projects/([^/]+)/query$", path)
            if m and method == "GET":
                cats = [c for c in (qs.get("cat", [""])[0]).split(",") if c] if qs.get("cat") else []
                sort = qs.get("sort", [""])[0] or None
                pm_raw = qs.get("passed_minutes", [""])[0]
                try:
                    passed_minutes = int(pm_raw) if pm_raw else 0
                except ValueError:
                    passed_minutes = 0
                try:
                    return self._send_json({"ok": True, "results": query_images(m.group(1), cats, sort, passed_minutes)})
                except RuntimeError as e:
                    return self._send_json({"ok": False, "error": str(e)}, 400)

            # /api/projects/{id}/leak?cats=a,b
            m = re.match(r"^/api/projects/([^/]+)/leak$", path)
            if m and method == "GET":
                cats = [c for c in (qs.get("cats", [""])[0]).split(",") if c] if qs.get("cats") else []
                try:
                    return self._send_json({"ok": True, "results": leak_images(m.group(1), cats)})
                except RuntimeError as e:
                    return self._send_json({"ok": False, "error": str(e)}, 400)

            # /api/projects/{id}/distribution
            m = re.match(r"^/api/projects/([^/]+)/distribution$", path)
            if m and method == "GET":
                try:
                    return self._send_json({"ok": True, "distribution": distribution(m.group(1))})
                except RuntimeError as e:
                    return self._send_json({"ok": False, "error": str(e)}, 400)

            # /api/projects/{id}/search?q=文件名子串
            m = re.match(r"^/api/projects/([^/]+)/search$", path)
            if m and method == "GET":
                q = qs.get("q", [""])[0]
                if not q:
                    return self._send_json({"ok": False, "error": "缺少 q 参数"}, 400)
                try:
                    return self._send_json({"ok": True, "results": search_images(m.group(1), q)})
                except RuntimeError as e:
                    return self._send_json({"ok": False, "error": str(e)}, 400)

            # /api/projects/{id}/preload  (GET，无操作，保留以兼容前端切换项目时的调用)
            m = re.match(r"^/api/projects/([^/]+)/preload$", path)
            if m and method == "GET":
                return self._send_json({"ok": True})

            # /api/export/{id}?mode=passed|full|yolo
            m = re.match(r"^/api/export/([^/]+)$", path)
            if m and method == "GET":
                return self._export(m.group(1), qs.get("mode", ["full"])[0])

            # /api/projects/{id}/batch_qc  (POST)
            m = re.match(r"^/api/projects/([^/]+)/batch_qc$", path)
            if m and method == "POST":
                return self._handle_batch_qc(m.group(1))

        return self._send_json({"ok": False, "error": "未知接口: " + path}, 404)

    # ---- 登录 ----
    def _handle_login(self):
        raw = self._read_body()
        try:
            body = json.loads(raw.decode("utf-8"))
        except Exception:
            return self._send_json({"ok": False, "error": "请求体不是合法 JSON"}, 400)
        s, h, raw2 = upstream("POST", "/api/login", body=body)
        if s == 200:
            global TOKEN, USER
            data = json.loads(raw2.decode("utf-8"))
            TOKEN = data.get("token")
            USER = data.get("user")
            return self._send_json(data)
        return self._send(s, self._pick_headers(h), raw2)

    # ---- 批量打回 / 通过 ----
    def _handle_batch_qc(self, pid):
        raw = self._read_body()
        try:
            body = json.loads(raw.decode("utf-8"))
        except Exception:
            return self._send_json({"ok": False, "error": "请求体不是合法 JSON"}, 400)
        image_ids = body.get("image_ids") or []
        verdict = body.get("verdict", "reject")
        reason = body.get("reason", "") or ""
        if not isinstance(image_ids, list) or not image_ids:
            return self._send_json({"ok": False, "error": "image_ids 为空"}, 400)
        if verdict not in ("reject", "pass"):
            return self._send_json({"ok": False, "error": "verdict 只能是 reject 或 pass"}, 400)

        succeeded = 0
        failed = []
        for img in image_ids:
            s, h, raw2 = upstream("POST", "/api/projects/%s/qc" % pid,
                                  body={"image_id": img, "verdict": verdict, "reason": reason})
            try:
                d = json.loads(raw2.decode("utf-8"))
            except Exception:
                d = {}
            if s == 200 and d.get("ok"):
                succeeded += 1
            else:
                failed.append({"image_id": img,
                               "error": d.get("error") or ("HTTP %s" % s)})
        # 写操作后清空缓存，保证下次查询是打回后的新状态
        _CACHE.clear()
        return self._send_json({
            "ok": True,
            "total": len(image_ids),
            "succeeded": succeeded,
            "failed": failed,
        })

    # ---- 质检平台批量提交（每张独立 verdict） ----
    def _handle_qc_submit(self):
        raw = self._read_body()
        try:
            body = json.loads(raw.decode("utf-8"))
        except Exception:
            return self._send_json({"ok": False, "error": "请求体不是合法 JSON"}, 400)
        pid = body.get("pid") or ""
        uid = body.get("uid") or ""
        verdicts = body.get("verdicts") or []
        if not isinstance(verdicts, list) or not verdicts:
            return self._send_json({"ok": False, "error": "verdicts 为空"}, 400)
        # 用质检员本人 token 提交，使平台按 token 正确归属质检结果（拿不到则回退 owner）
        qc_tok = _get_qc_token(uid)
        succeeded = 0
        failed = []
        for v in verdicts:
            iid = v.get("image_id")
            verdict = v.get("verdict")
            reason = v.get("reason") or ""
            if verdict not in ("pass", "reject"):
                failed.append({"image_id": iid, "error": "verdict 非法"})
                continue
            s, h, raw2 = upstream("POST", "/api/projects/%s/qc" % pid,
                                  body={"image_id": iid, "verdict": verdict, "reason": reason},
                                  token=qc_tok)
            try:
                d = json.loads(raw2.decode("utf-8"))
            except Exception:
                d = {}
            if s == 200 and d.get("ok"):
                succeeded += 1
            else:
                failed.append({"image_id": iid, "error": d.get("error") or ("HTTP %s" % s)})
        _clear_cache_keep_stable()
        # 提交会改变这些图的 qc_status，清掉 annotation 缓存，避免 _reconcile_rejected 读到旧的 pending
        with _ANNOTATION_CACHE_LOCK:
            for v in verdicts:
                _ANNOTATION_CACHE.pop((pid, v.get("image_id")), None)
        # 本地记录最近提交（最新在前）。verdict 用于纠正 /images 状态滞后，
        # 保留足够多组（100 组≈400 张），避免提交较多后早期纠正丢失、已通过图
        # 又因快照滞后被当成 pending；「最近提交」页仍只取前 12 张。
        if succeeded:
            _RECENT_GROUPS.insert(0, {
                "ts": time.time(),
                "pid": pid,
                "uid": uid,
                "image_ids": [v.get("image_id") for v in verdicts if v.get("image_id")],
                "verdicts": {v.get("image_id"): v.get("verdict")
                             for v in verdicts if v.get("image_id") and v.get("verdict") in ("pass", "reject")},
            })
            _RECENT_GROUPS[:] = _RECENT_GROUPS[:100]
            # 已提交 verdict，保存时的 pending 纠正不再需要
            sp = _SAVE_PENDING.get(pid)
            if sp:
                for v in verdicts:
                    sp.discard(v.get("image_id"))
        return self._send_json({
            "ok": True,
            "total": len(verdicts),
            "succeeded": succeeded,
            "failed": failed,
        })

    # ---- 历史归属修复：用质检员本人 token 重放已 passed/rejected 的 verdict ----
    def _handle_qc_fix(self):
        raw = self._read_body()
        try:
            body = json.loads(raw.decode("utf-8"))
        except Exception:
            return self._send_json({"ok": False, "error": "请求体不是合法 JSON"}, 400)
        pid = body.get("pid") or ""
        uid = body.get("uid") or ""
        if not pid or not uid:
            return self._send_json({"ok": False, "error": "参数非法"}, 400)
        qc_tok = _get_qc_token(uid)
        if not qc_tok:
            return self._send_json({"ok": False, "error": "该质检员未配置登录凭据或登录失败"}, 400)
        # qc 角色调 /images 只返回自己名下的图（含 qc_status）
        s, h, raw2 = upstream("GET", "/api/projects/%s/images" % pid, token=qc_tok)
        try:
            d = json.loads(raw2.decode("utf-8"))
        except Exception:
            d = {}
        if s != 200:
            return self._send_json({"ok": False, "error": "拉取名下图片失败 HTTP %s" % s}, 400)
        images = d.get("images", [])
        targets = [im.get("image_id") for im in images
                   if im.get("qc_status") in ("passed", "rejected")]
        if not targets:
            return self._send_json({"ok": True, "total": 0, "succeeded": 0, "failed": []})

        status_map = {im.get("image_id"): im.get("qc_status") for im in images}
        succeeded = 0
        failed = []
        def _one(iid):
            st = status_map.get(iid)
            verdict = "pass" if st == "passed" else "reject"
            s2, h2, raw3 = upstream("POST", "/api/projects/%s/qc" % pid,
                                    body={"image_id": iid, "verdict": verdict, "reason": ""},
                                    token=qc_tok)
            try:
                dd = json.loads(raw3.decode("utf-8"))
            except Exception:
                dd = {}
            return iid, (s2 == 200 and dd.get("ok"))
        with concurrent.futures.ThreadPoolExecutor(max_workers=16) as ex:
            for iid, ok in ex.map(_one, targets):
                if ok:
                    succeeded += 1
                else:
                    failed.append(iid)
        return self._send_json({
            "ok": True,
            "total": len(targets),
            "succeeded": succeeded,
            "failed": failed,
        })

    # ---- 导出下载 ----
    def _export(self, pid, mode):
        query = {"format": "json"}
        if mode == "passed":
            query["only"] = "passed"
        elif mode == "yolo":
            query["format"] = "yolo"
        s, h, raw = upstream("GET", "/api/projects/%s/export" % pid, query=query)
        cd = h.get("Content-Disposition") or ('attachment; filename="%s_%s.zip"' % (pid, mode))
        return self._send(s, {"Content-Type": h.get("Content-Type", "application/zip"),
                              "Content-Disposition": cd}, raw)

    # ---- 静态文件 ----
    def _serve_static(self, path):
        if path == "/":
            path = "/login.html" if RELEASE_MODE else "/index.html"
        elif path == "/qc":
            path = "/qc.html"
        elif path == "/anno":
            path = "/anno.html"
        rel = path[len("/static/"):] if path.startswith("/static/") else path.lstrip("/")
        fp = os.path.normpath(os.path.join(STATIC_DIR, rel))
        if not fp.startswith(STATIC_DIR) or not os.path.isfile(fp):
            return self._send_json({"ok": False, "error": "文件不存在"}, 404)
        ext = os.path.splitext(fp)[1].lower().lstrip(".")
        ctype = {"html": "text/html; charset=utf-8", "js": "application/javascript; charset=utf-8",
                 "css": "text/css; charset=utf-8", "png": "image/png", "jpg": "image/jpeg",
                 "jpeg": "image/jpeg", "svg": "image/svg+xml", "json": "application/json"}.get(ext, "application/octet-stream")
        with open(fp, "rb") as f:
            body = f.read()
        return self._send(200, {"Content-Type": ctype}, body)

    @staticmethod
    def _pick_headers(h):
        out = {}
        if h.get("Content-Type"):
            out["Content-Type"] = h["Content-Type"]
        if h.get("Content-Disposition"):
            out["Content-Disposition"] = h["Content-Disposition"]
        return out


def _tray_image():
    if getattr(sys, "frozen", False):
        p = os.path.join(getattr(sys, "_MEIPASS", HERE), "eternal-night-studio.ico")
    else:
        p = os.path.join(HERE, "eternal-night-studio.ico")
    return Image.open(p)


def _run_tray(httpd, url):
    """启动托盘；成功返回 True，失败（缺依赖/图标）返回 False，由调用方回退 serve_forever。"""
    try:
        icon = pystray.Icon(
            "label_auto",
            _tray_image(),
            "Label Auto",
            pystray.Menu(
                pystray.MenuItem("打开平台", lambda icon, item: webbrowser.open(url)),
                pystray.MenuItem("退出", lambda icon, item: icon.stop()),
            ),
        )
    except Exception:
        return False
    icon.run()
    httpd.shutdown()
    return True


# ======================================================================
# 发布版自更新（每 10 分钟检查一次）
# ======================================================================
def _version_tuple(v):
    parts = re.findall(r"\d+", str(v or ""))
    return tuple(int(x) for x in parts) or (0,)


def _check_update():
    if not UPDATE_URL:
        return
    try:
        req = urllib.request.Request(UPDATE_URL, headers={"User-Agent": "label-auto-updater"})
        d = json.loads(urllib.request.urlopen(req, timeout=15).read().decode("utf-8"))
        new_ver = d.get("version") or ""
        if _version_tuple(new_ver) > _version_tuple(VERSION):
            _prompt_update(new_ver, d.get("notes") or "", d.get("download_url") or "")
    except Exception:
        pass  # 无网络/拉取失败静默跳过


def _prompt_update(version, notes, url):
    if not url:
        return
    try:
        import ctypes
        msg = "发现新版本 %s\n\n%s\n\n是否立即更新？" % (version, notes or "（无更新说明）")
        MB_YESNO = 0x04
        MB_ICONQUESTION = 0x20
        r = ctypes.windll.user32.MessageBoxW(0, msg, "标注平台更新", MB_YESNO | MB_ICONQUESTION)
        if r == 6:  # IDYES
            _do_update(url)
    except Exception:
        pass


def _msgbox(title, text, flags=0):
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(0, str(text), str(title), flags)
    except Exception:
        pass


def _download_with_progress(url, new_path):
    """下载新版本并显示进度条窗口；返回 (ok, error)。"""
    import tkinter as tk
    from tkinter import ttk
    import queue

    q = queue.Queue()

    def _worker():
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "label-auto-updater"})
            resp = urllib.request.urlopen(req, timeout=300)
            total = int(resp.headers.get("Content-Length") or 0)
            done = 0
            with open(new_path, "wb") as f:
                while True:
                    chunk = resp.read(65536)
                    if not chunk:
                        break
                    f.write(chunk)
                    done += len(chunk)
                    q.put(("progress", done, total))
            q.put(("done", True, None))
        except Exception as e:
            q.put(("done", False, e))

    root = tk.Tk()
    root.title("更新")
    root.resizable(False, False)
    root.attributes("-topmost", True)
    label = tk.Label(root, text="正在下载更新…", width=26)
    label.pack(padx=24, pady=(16, 8))
    progress = ttk.Progressbar(root, length=380, mode="determinate")
    progress.pack(padx=24, pady=(0, 16))
    root.update_idletasks()
    w = root.winfo_reqwidth()
    h = root.winfo_reqheight()
    x = (root.winfo_screenwidth() - w) // 2
    y = (root.winfo_screenheight() - h) // 2
    root.geometry("+%d+%d" % (x, y))

    final = {"ok": False, "error": None}

    def _poll():
        try:
            while True:
                msg = q.get_nowait()
                if msg[0] == "progress":
                    _, done, total = msg
                    if total:
                        progress.configure(maximum=total)
                        progress.configure(value=done)
                        label.configure(text="正在下载更新… %d%%" % int(done * 100 / total))
                elif msg[0] == "done":
                    _, ok, err = msg
                    final["ok"] = ok
                    final["error"] = err
                    root.destroy()
                    return
        except queue.Empty:
            pass
        root.after(60, _poll)

    threading.Thread(target=_worker, daemon=True).start()
    root.after(60, _poll)
    root.mainloop()
    return final["ok"], final["error"]


def _do_update(url):
    try:
        exe_path = sys.executable
        new_path = exe_path + ".new"
        ok, err = _download_with_progress(url, new_path)
        if not ok:
            _msgbox("更新失败", "下载新版本失败：\n%s" % err, 0x10)  # MB_ICONERROR
            return
        # 写「安装完成」标记，新版本启动时据此提示
        try:
            with open(exe_path + ".updated", "w", encoding="utf-8") as f:
                f.write("1")
        except Exception:
            pass
        # 替换脚本：路径经参数传入（%~1/%~2），bat 本身纯 ASCII，避免中文路径乱码
        bat = exe_path + ".update.bat"
        with open(bat, "w", encoding="ascii") as f:
            f.write('@echo off\n')
            f.write('timeout /t 3 /nobreak >nul\n')
            f.write('move /y "%~1" "%~2"\n')
            f.write('if errorlevel 1 goto fail\n')
            f.write('start "" "%~2"\n')
            f.write('del "%~f0"\n')
            f.write('exit\n')
            f.write(':fail\n')
            f.write('del "%~f0"\n')
        import subprocess
        # DETACHED_PROCESS：bat 在后台静默执行，不闪黑窗
        subprocess.Popen(['cmd.exe', '/c', bat, new_path, exe_path], creationflags=0x00000008)
        os._exit(0)
    except Exception as e:
        _msgbox("更新失败", str(e), 0x10)


def _update_loop():
    while True:
        _check_update()
        time.sleep(600)


def _maybe_show_updated_notice():
    """更新完成后的首次启动：提示「安装完成」，并清理标记文件。"""
    try:
        flag = sys.executable + ".updated"
        if os.path.exists(flag):
            try:
                os.remove(flag)
            except Exception:
                pass
            _msgbox("更新完成", "已更新到版本 %s" % VERSION, 0x40)  # MB_ICONINFORMATION
    except Exception:
        pass


def main():
    _maybe_show_updated_notice()
    httpd = None
    port = PORT_START
    for p in range(PORT_START, PORT_START + 30):
        try:
            # 绑定所有网卡，支持局域网访问
            httpd = http.server.ThreadingHTTPServer(("0.0.0.0", p), Handler)
            port = p
            break
        except OSError:
            continue
    if httpd is None:
        return
    base = "http://127.0.0.1:%d" % port
    url = base + "/qc"
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    if RELEASE_MODE:
        threading.Thread(target=_update_loop, daemon=True).start()
    threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    if not _run_tray(httpd, url):
        # 托盘不可用时回退：阻塞服务（Ctrl+C 或任务管理器结束）
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
