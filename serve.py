# -*- coding: utf-8 -*-
"""Immersive Lyrics 后端服务器。

P0 修复版：
    - 静态路径白名单（P0-1）：只允许 / /index.html /js/* /css/* /assets/*
      拒绝 .git/data/源码/%2f/%5c/反斜杠/../空字节/点文件
    - HTML 注入只限首页（P0-2），no-store 缓存
    - 真实 Range 支持（P0-6）：本地音频严格 Range，不伪造 Accept-Ranges
    - 端口动态生成 Host（P0-7）
    - Host + Origin + Sec-Fetch-Site 完整校验（P0-8/9），所有请求都过校验
    - 线程上限（P0-14）：全局请求 semaphore

用法: python serve.py [port]
浏览器打开 http://127.0.0.1:8765/
"""
import os
import re
import sys
import html as html_lib
import http.server
import socketserver
import threading
from http import HTTPStatus
from urllib.parse import unquote, urlsplit

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from api import routes  # noqa: F401
import api.middleware as middleware
from api.router import match_route, send_json, send_api_error, error, ApiError
from api.netease_client import NetEaseError, netease
from api.qq_client import QQMusicError, qq
from api.bilibili_client import BilibiliError, bilibili
from api.middleware import (
    SecurityState, inject_token_into_html, set_session_cookie, authenticate,
)

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
WEB_ROOT = os.path.dirname(os.path.abspath(__file__))

# P0-7: 端口动态生成期望 Host/Origin
EXPECTED_HOST = '127.0.0.1:%d' % PORT
EXPECTED_ORIGIN = 'http://%s' % EXPECTED_HOST
middleware.EXPECTED_HOST = EXPECTED_HOST
middleware.EXPECTED_ORIGIN = EXPECTED_ORIGIN

# P0-1: 静态路径白名单
STATIC_WHITELIST = [
    re.compile(r'^/$'),
    re.compile(r'^/index\.html?$'),
    re.compile(r'^/js/.+$'),
    re.compile(r'^/css/.+$'),
    re.compile(r'^/assets/.+$'),
]

CSP_HEADER = ("default-src 'self'; "
              "style-src 'self' 'unsafe-inline'; "  # 允许内联 style 属性（JS 动态样式）
              "img-src 'self' data:; "
              "media-src 'self'; "
              "connect-src 'self'; "
              "object-src 'none'; base-uri 'none'")

# P0-14: 线程上限
REQUEST_SEMAPHORE = threading.Semaphore(32)


def _is_safe_static_path(raw_path):
    """P0-1: 校验静态路径是否安全。

    拒绝: 编码斜杠 %2f/%5c、反斜杠、..、空字节、点文件/目录、非白名单路径。
    raw_path 是未解码的原始路径。
    """
    # 拒绝编码斜杠（防 /api%2F... 绕过）
    if '%2f' in raw_path.lower() or '%5c' in raw_path.lower():
        return False
    if '\\\\' in raw_path:
        return False
    # 拒绝空字节
    if '\\x00' in raw_path or '\x00' in raw_path:
        return False
    # 取 path 部分（不含 query）
    path = raw_path.split('?', 1)[0].split('#', 1)[0]
    # 拒绝 ..
    if '..' in path:
        return False
    # 白名单匹配
    for pat in STATIC_WHITELIST:
        if pat.match(path):
            # 拒绝路径中任何点文件段（.git, .env 等）
            for seg in path.split('/'):
                if seg.startswith('.') and seg not in ('.', '..'):
                    return False
            return True
    return False


def check_host(handler):
    """P0-8: Host 精确匹配。"""
    return handler.headers.get('Host', '') == EXPECTED_HOST


def check_origin(handler):
    """P0-8: Origin 存在时必须精确匹配；Sec-Fetch-Site 只能 same-origin/none。"""
    origin = handler.headers.get('Origin', '')
    if origin and origin != EXPECTED_ORIGIN:
        return False
    sfs = handler.headers.get('Sec-Fetch-Site', '')
    if sfs and sfs not in ('same-origin', 'none'):
        return False
    return True


# 全局安全状态（token 在内存，重启失效）
sec = SecurityState()


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = 'PlayerServer/1.0'
    sys_version = ''

    # ------------------------------------------------------------

    def log_message(self, fmt, *args):
        """P0-112: 脱敏日志，只记录方法+路径前缀+状态。"""
        path = self.path.split('?', 1)[0]
        sys.stderr.write('[serve] %s %s\n' % (self.command, path))

    def handle_one_request(self):
        try:
            super().handle_one_request()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, TimeoutError):
            self.close_connection = True

    # ------------------------------------------------------------

    def do_GET(self):
        self._handle_request('GET')

    def do_POST(self):
        self._handle_request('POST')

    def do_DELETE(self):
        self._handle_request('DELETE')

    def do_HEAD(self):
        self._handle_request('HEAD')

    def do_OPTIONS(self):
        self.send_response(HTTPStatus.NO_CONTENT)
        self.end_headers()

    def _handle_request(self, method):
        """统一请求入口：所有请求（含静态）都过 Host 校验。"""
        try:
            # P0-14: 线程上限
            if not REQUEST_SEMAPHORE.acquire(timeout=30):
                self._send_simple(503, '服务器繁忙')
                return
            try:
                self._dispatch(method)
            finally:
                REQUEST_SEMAPHORE.release()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            self.close_connection = True

    def _dispatch(self, method):
        raw_path = self.path
        path_only = raw_path.split('?', 1)[0]

        # P0-9: 所有请求都校验 Host
        if not check_host(self):
            self._send_simple(403, 'FORBIDDEN')
            return

        # API 路由
        if path_only.startswith('/api/'):
            self._handle_api(method, path_only)
            return

        # favicon
        if path_only == '/favicon.ico':
            self._send_simple(204)
            return

        # GET/HEAD 静态文件
        if method in ('GET', 'HEAD'):
            self._serve_static(path_only, head_only=(method == 'HEAD'))
            return

        self._send_simple(405, 'Method Not Allowed')

    # ---------- API ----------
    def _handle_api(self, method, clean_path):
        try:
            # P0-8: Origin + Sec-Fetch-Site 校验
            if not check_origin(self):
                send_json(self, error('FORBIDDEN', '非法来源', False), status=403)
                return
            # 路由匹配（用剥掉 query 的路径）
            matched = match_route(method, clean_path)
            if matched is None:
                # P0-13: 检查是否路径存在但方法不支持
                any_method = match_route_for_path(clean_path)
                if any_method:
                    send_json(self, error('BAD_REQUEST',
                              'Method Not Allowed, supported: ' + ', '.join(any_method),
                              False), status=405)
                else:
                    send_json(self, error('NOT_FOUND', '接口不存在: ' + clean_path, False), status=404)
                return
            handler_fn, auth_kind, match = matched
            # 鉴权
            passed, reason = authenticate(self, auth_kind, sec)
            if not passed:
                if reason in ('no-session', 'no-token'):
                    send_json(self, error('LOGIN_REQUIRED',
                              '会话失效，请刷新页面' if reason == 'no-session' else '缺少安全凭证，请刷新页面',
                              False), status=401)
                else:
                    send_json(self, error('FORBIDDEN', '非法请求来源', False), status=403)
                return
            cookie_header = self.headers.get('Cookie', '')
            netease.load_from_browser_cookie(cookie_header)
            qq.load_from_browser_cookie(cookie_header)
            bilibili.load_from_browser_cookie(cookie_header)
            handler_fn(self, match)
        except ApiError as e:
            send_api_error(self, e)
        except NetEaseError as e:
            from api.router import error as api_err
            if e.code == 'upstream-timeout':
                send_json(self, api_err('UPSTREAM_TIMEOUT', '网易云请求超时', True), status=504)
            else:
                send_json(self, api_err('UPSTREAM_ERROR', str(e), e.retryable), status=502)
        except QQMusicError as e:
            from api.router import error as api_err
            if e.code == 'upstream-timeout':
                send_json(self, api_err('UPSTREAM_TIMEOUT', 'QQ音乐请求超时', True), status=504)
            else:
                send_json(self, api_err('UPSTREAM_ERROR', str(e), e.retryable), status=502)
        except BilibiliError as e:
            from api.router import error as api_err
            if e.code in ('bad-input', 'bad-id', 'bad-url', 'bad-cookie'):
                send_json(self, api_err('BAD_REQUEST', e.message, False), status=400)
            elif e.code == 'not-found':
                send_json(self, api_err('NOT_FOUND', e.message, False), status=404)
            elif e.code == 'upstream-denied':
                send_json(self, api_err('UPSTREAM_ERROR', e.message, False), status=403)
            elif e.code == 'upstream-timeout':
                send_json(self, api_err('UPSTREAM_TIMEOUT', 'B站请求超时', True), status=504)
            else:
                send_json(self, api_err('UPSTREAM_ERROR', str(e), e.retryable), status=502)
        except Exception as e:
            import logging
            logging.exception('[api] Unhandled: %s %s', method, clean_path)
            try:
                send_json(self, error('INTERNAL', '服务器内部错误', True), status=500)
            except Exception:
                self.close_connection = True

    # ---------- 静态文件 ----------
    def _serve_static(self, path_only, head_only=False):
        """P0-1: 白名单静态文件服务。P0-6: 真实 Range。"""
        # P0-1: 路径白名单
        if not _is_safe_static_path(path_only):
            self._send_simple(404, 'Not Found')
            return
        # 解码路径（白名单已拒绝 %2f）
        decoded = unquote(path_only)
        # 安全：解码后再检查 ..
        if '..' in decoded:
            self._send_simple(404, 'Not Found')
            return
        # 映射到文件系统
        if decoded == '/':
            decoded = '/index.html'
        fs_path = os.path.normpath(os.path.join(WEB_ROOT, decoded.lstrip('/')))
        # 确保在 WEB_ROOT 内
        if not fs_path.startswith(WEB_ROOT + os.sep) and fs_path != WEB_ROOT:
            self._send_simple(404, 'Not Found')
            return
        if not os.path.isfile(fs_path):
            self._send_simple(404, 'Not Found')
            return

        # P0-2: 只有首页注入 token，其它 HTML 按普通静态文件（不注入）
        if fs_path.endswith(('.html', '.htm')):
            is_index = os.path.basename(fs_path).lower().startswith('index')
            if is_index:
                self._serve_index_html(fs_path, head_only)
                return
            # 其它 HTML：作为普通静态文件，加 CSP 但不注入 token
            self._serve_file_with_range(fs_path, head_only, extra_headers={
                'Content-Security-Policy': CSP_HEADER,
                'X-Frame-Options': 'DENY',
            })
            return

        # 普通静态文件（JS/CSS/图片/音频）
        self._serve_file_with_range(fs_path, head_only)

    def _serve_index_html(self, fs_path, head_only):
        """P0-2: 首页注入 token + no-store + CSP + session cookie。"""
        try:
            with open(fs_path, 'rb') as f:
                content = f.read()
        except OSError:
            self._send_simple(404, 'Not Found')
            return
        content = inject_token_into_html(content, sec.api_token)
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(content)))
        self.send_header('Content-Security-Policy', CSP_HEADER)
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Referrer-Policy', 'same-origin')
        # P0-10: 首页含 token，禁止缓存
        self.send_header('Cache-Control', 'no-store, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        set_session_cookie(self, sec)
        self.end_headers()
        if not head_only:
            try:
                self.wfile.write(content)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                self.close_connection = True

    def _serve_file_with_range(self, fs_path, head_only, extra_headers=None):
        """P0-6: 真实 Range 支持。P0-42: 不伪造 Accept-Ranges。"""
        try:
            file_size = os.path.getsize(fs_path)
        except OSError:
            self._send_simple(404, 'Not Found')
            return

        # 判断 MIME
        ctype = self._guess_type(fs_path)

        # P0-6: 解析 Range
        range_header = self.headers.get('Range')
        is_audio = ctype.startswith('audio/') or ctype.startswith('video/')

        if range_header and is_audio:
            # 严格解析单段 Range
            rng = self._parse_range(range_header, file_size)
            if rng is None:
                # Range 不可用
                self.send_response(416)
                self.send_header('Content-Range', 'bytes */%d' % file_size)
                self.end_headers()
                return
            start, end = rng
            length = end - start + 1
            self.send_response(206)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(length))
            self.send_header('Content-Range', 'bytes %d-%d/%d' % (start, end, file_size))
            self.send_header('Accept-Ranges', 'bytes')
            if extra_headers:
                for k, v in extra_headers.items():
                    self.send_header(k, v)
            self.end_headers()
            if not head_only:
                self._send_file_range(fs_path, start, length)
        else:
            # 完整文件
            self.send_response(200)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(file_size))
            # P0-42: 只有音频/视频声称 Accept-Ranges（实际支持）
            if is_audio:
                self.send_header('Accept-Ranges', 'bytes')
            if extra_headers:
                for k, v in extra_headers.items():
                    self.send_header(k, v)
            self.end_headers()
            if not head_only:
                self._send_file_range(fs_path, 0, file_size)

    def _parse_range(self, range_header, file_size):
        """P0-37: 严格解析单段 bytes Range。
        只接受 bytes=start- 或 bytes=start-end。
        返回 (start, end) 或 None。
        """
        m = re.match(r'^bytes=(\d+)-(\d*)$', range_header.strip())
        if not m:
            return None
        start = int(m.group(1))
        end = int(m.group(2)) if m.group(2) else file_size - 1
        if start > end or start >= file_size:
            return None
        if end >= file_size:
            end = file_size - 1
        return (start, end)

    def _send_file_range(self, fs_path, start, length):
        """分块发送文件区间。"""
        CHUNK = 65536
        remaining = length
        try:
            with open(fs_path, 'rb') as f:
                f.seek(start)
                while remaining > 0:
                    read = min(CHUNK, remaining)
                    data = f.read(read)
                    if not data:
                        break
                    self.wfile.write(data)
                    remaining -= len(data)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            self.close_connection = True

    def _guess_type(self, fs_path):
        """简单 MIME 判断。"""
        ext = os.path.splitext(fs_path)[1].lower()
        types = {
            '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
            '.js': 'application/javascript; charset=utf-8',
            '.css': 'text/css; charset=utf-8',
            '.json': 'application/json; charset=utf-8',
            '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4',
            '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
            '.webp': 'image/webp', '.svg': 'image/svg+xml',
            '.ico': 'image/x-icon', '.woff2': 'font/woff2',
        }
        return types.get(ext, 'application/octet-stream')

    def _send_simple(self, status, message=''):
        self.send_response(status)
        if message:
            body = message.encode('utf-8')
            self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
        else:
            body = b''
            self.send_header('Content-Length', '0')
        self.end_headers()
        if body:
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                self.close_connection = True


def match_route_for_path(clean_path):
    """P0-13: 返回支持该路径的所有方法（用于 405）。"""
    methods = []
    from api.router import ROUTES
    for m, pattern, fn, auth in ROUTES:
        # 精确
        if not pattern.endswith('*') and pattern == clean_path and m not in methods:
            methods.append(m)
        elif pattern.endswith('*') and clean_path.startswith(pattern[:-1]) and m not in methods:
            methods.append(m)
    return methods


class ReusableServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    data_dir = os.path.join(WEB_ROOT, 'data')
    os.makedirs(data_dir, exist_ok=True)
    server = ReusableServer(('127.0.0.1', PORT), Handler)
    print('Player server on http://127.0.0.1:%d/  (Ctrl+C to stop)' % PORT)
    print('  Expected Host: %s' % EXPECTED_HOST)
    print('  API token: %s... (内存，重启失效)' % sec.api_token[:8])
    print('  静态白名单: / /index.html /js/* /css/* /assets/*')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nshutting down...')
        server.shutdown()


if __name__ == '__main__':
    main()
