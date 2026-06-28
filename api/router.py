# -*- coding: utf-8 -*-
"""路由表 + 统一响应格式。

所有 /api/* JSON 接口统一返回:
    {"ok": true,  "data": {...}}
    {"ok": false, "error": {"code": "...", "message": "...", "retryable": bool}}

HTTP 状态码规范:
    400 参数错误          404 不存在
    401 未登录            409 重复操作
    403 无权限            429 限流
    502 网易云上游异常     504 上游超时
"""
import json
import time
from http import HTTPStatus


# 错误码 → HTTP 状态映射
ERROR_HTTP_STATUS = {
    'BAD_REQUEST':               400,
    'LOGIN_REQUIRED':            401,
    'FORBIDDEN':                 403,
    'NOT_FOUND':                 404,
    'CONFLICT':                  409,
    'RATE_LIMITED':              429,
    'UPSTREAM_ERROR':            502,
    'UPSTREAM_TIMEOUT':          504,
    'UPSTREAM_RANGE_UNSUPPORTED':416,
    'INTERNAL':                  500,
}


class ApiError(Exception):
    """带错误码的 API 异常，由中间件统一捕获转 JSON。"""
    def __init__(self, code, message, retryable=False, http_status=None):
        self.code = code
        self.message = message
        self.retryable = retryable
        self.http_status = http_status or ERROR_HTTP_STATUS.get(code, 500)
        super().__init__(message)


def ok(data=None):
    """构造成功响应体 (dict)。"""
    return {'ok': True, 'data': data if data is not None else {}}


def error(code, message, retryable=False):
    """构造失败响应体 (dict)。"""
    return {'ok': False, 'error': {'code': code, 'message': message, 'retryable': retryable}}


def send_json(handler, payload, status=200, extra_headers=None):
    """发送 JSON 响应。"""
    body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    handler.send_response(status)
    handler.send_header('Content-Type', 'application/json; charset=utf-8')
    handler.send_header('Content-Length', str(len(body)))
    handler.send_header('Cache-Control', 'no-store')
    if extra_headers:
        if isinstance(extra_headers, dict):
            header_items = extra_headers.items()
        else:
            header_items = extra_headers
        for k, v in header_items:
            if isinstance(v, (list, tuple)):
                for item in v:
                    handler.send_header(k, item)
            else:
                handler.send_header(k, v)
    handler.end_headers()
    try:
        handler.wfile.write(body)
    except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
        handler.close_connection = True


def send_api_error(handler, err):
    """从 ApiError 构造并发送错误响应。"""
    send_json(handler, error(err.code, err.message, err.retryable), status=err.http_status)


# ============================================================
# 路由表
# 路由匹配优先级: 精确路径 > 前缀路径
# 每个 route: (method, path_pattern, handler_fn, auth_kind)
#   path_pattern: 精确字符串，或以 '*' 结尾表示前缀匹配
#   auth_kind: 'api' (需 Token+Cookie) | 'media' (仅 Cookie+Sec-Fetch-Site)
#   handler_fn(handler, match) -> None (直接写响应) 或 raise ApiError
# ============================================================

ROUTES = []  # 由各模块注册


def register(method, pattern, auth_kind):
    """路由注册装饰器。"""
    def deco(fn):
        ROUTES.append((method.upper(), pattern, fn, auth_kind))
        return fn
    return deco


def match_route(method, path):
    """匹配路由，返回 (handler_fn, auth_kind, match_obj) 或 None。

    match_obj: 精确匹配为 None；前缀匹配为去掉前缀的剩余路径。
    """
    method = method.upper()
    # 优先精确匹配
    for m, pattern, fn, auth in ROUTES:
        if m == method and not pattern.endswith('*') and pattern == path:
            return fn, auth, None
    # 再前缀匹配
    for m, pattern, fn, auth in ROUTES:
        prefix = pattern[:-1]  # 去掉末尾 '*'
        if m == method and pattern.endswith('*') and path.startswith(prefix):
            return fn, auth, path[len(prefix):]
    return None
