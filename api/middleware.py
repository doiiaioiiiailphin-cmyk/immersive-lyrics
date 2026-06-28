# -*- coding: utf-8 -*-
"""安全中间件：双重鉴权（Token / Cookie 分类）、同源校验、CSP。

鉴权分类（定稿方案关键修正）:
    - api 路由 (/api/status /search /lyrics /qr /logout /song):
        必须 Session Cookie + 必须 X-Player-Token
    - media 路由 (/api/stream /cover):
        必须 Session Cookie + Sec-Fetch-Site: same-origin
        （<audio>/<img> 无法加自定义头）

CORS 全部移除 *，整个服务器默认只允许同源。
"""
import hmac
import json
import os
import re
import secrets

EXPECTED_HOST = '127.0.0.1:8765'
EXPECTED_ORIGIN = 'http://127.0.0.1:8765'

CSP_HEADER = (
    "default-src 'self'; "
    "img-src 'self' data:; "
    "media-src 'self'; "
    "connect-src 'self'; "
    "object-src 'none'; "
    "base-uri 'none'"
)

SESSION_COOKIE_NAME = 'player_session'
TOKEN_HEADER = 'X-Player-Token'
DATA_DIR = os.environ.get('PLAYER_DATA_DIR') or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data')
SECURITY_STATE_FILE = os.path.join(DATA_DIR, 'security_state.json')
SESSION_MAX_AGE = 60 * 60 * 24 * 30


class SecurityState:
    """进程级安全状态（内存）。

    - api_token: serve.py 启动时随机生成，注入首页，重启失效
    - session_value: 首次访问时生成的 HttpOnly SameSite=Strict cookie 值
    """
    def __init__(self):
        state = self._load_or_create_state()
        self.api_token = state['api_token']
        self.session_value = state['session_value']

    def _load_or_create_state(self):
        try:
            with open(SECURITY_STATE_FILE, 'r', encoding='utf-8') as fh:
                state = json.load(fh)
            api_token = str(state.get('api_token') or '')
            session_value = str(state.get('session_value') or '')
            if len(api_token) >= 24 and len(session_value) >= 24:
                return {'api_token': api_token, 'session_value': session_value}
        except (OSError, ValueError, TypeError):
            pass
        state = {
            'api_token': secrets.token_urlsafe(32),
            'session_value': secrets.token_urlsafe(32),
        }
        self._save_state(state)
        return state

    def _save_state(self, state):
        try:
            os.makedirs(DATA_DIR, exist_ok=True)
            tmp = SECURITY_STATE_FILE + '.tmp'
            with open(tmp, 'w', encoding='utf-8') as fh:
                json.dump(state, fh, ensure_ascii=False)
            os.replace(tmp, SECURITY_STATE_FILE)
        except OSError as e:
            print('[security] 保存本地会话状态失败: %s' % e)

    def verify_token(self, header_value):
        if not header_value:
            return False
        return hmac.compare_digest(header_value, self.api_token)

    def verify_session(self, cookie_header):
        if not cookie_header:
            return False
        # 解析 Cookie 头
        for part in cookie_header.split(';'):
            part = part.strip()
            if '=' in part:
                k, v = part.split('=', 1)
                if k.strip() == SESSION_COOKIE_NAME:
                    return hmac.compare_digest(v.strip(), self.session_value)
        return False


sec = SecurityState()


def inject_token_into_html(html_bytes, api_token=None):
    """把 API token 注入首页 HTML 的 <head>，供前端读取。

    在 </title> 后插入 <meta name="api-token" content="xxx">。
    api_token: 显式传入（serve.py 传 sec.api_token），默认用模块级 sec。
    """
    tok = api_token if api_token is not None else sec.api_token
    token_meta = (
        '<meta name="api-token" content="' + tok + '">'
    ).encode('utf-8')
    # 在 </title> 后插入
    marker = b'</title>'
    idx = html_bytes.find(marker)
    if idx >= 0:
        return html_bytes[:idx + len(marker)] + token_meta + html_bytes[idx + len(marker):]
    # 兜底：在 <head> 后插入
    marker2 = b'<head>'
    idx2 = html_bytes.find(marker2)
    if idx2 >= 0:
        return html_bytes[:idx2 + len(marker2)] + token_meta + html_bytes[idx2 + len(marker2):]
    return html_bytes


def check_same_origin(handler):
    """校验请求是否来自同源（防 DNS Rebinding / CSRF）。

    校验项:
        - Host 头必须是 EXPECTED_HOST
    返回 True 通过，False 拒绝。
    """
    host = handler.headers.get('Host', '')
    return host == EXPECTED_HOST


def authenticate(handler, auth_kind, sec_state=None):
    """按路由类型鉴权。

    auth_kind: 'api' | 'media'
    sec_state: 可选，传入 SecurityState（默认用模块级 sec）
    返回 (passed: bool, reason: str)
    """
    s = sec_state if sec_state is not None else sec
    cookie_header = handler.headers.get('Cookie', '')

    # 1. 所有 /api 路由都要求 Session Cookie
    if not s.verify_session(cookie_header):
        return False, 'no-session'

    # 2. media 路由额外校验 Sec-Fetch-Site（<audio>/<img> 无法加 token）
    if auth_kind == 'media':
        sfs = handler.headers.get('Sec-Fetch-Site', '')
        # same-origin 直接通过；无该头（旧浏览器）则校验 Referer 同源
        if sfs == 'same-origin':
            return True, 'ok'
        if sfs == '':
            referer = handler.headers.get('Referer', '')
            if referer.startswith(EXPECTED_ORIGIN + '/'):
                return True, 'ok-referer'
            return False, 'no-fetch-site'
        # cross-site / same-site(不同子域) 都拒绝
        return False, 'cross-site'

    # 3. api 路由要求 X-Player-Token
    token = handler.headers.get(TOKEN_HEADER, '')
    if not s.verify_token(token):
        return False, 'no-token'

    return True, 'ok'


def send_security_headers(handler, is_html=False):
    """发送安全相关响应头。

    移除所有 CORS:* —— 整个服务器默认只允许同源。
    """
    # 不发送任何 Access-Control-Allow-Origin（默认同源）
    if is_html:
        handler.send_header('Content-Security-Policy', CSP_HEADER)
        handler.send_header('X-Content-Type-Options', 'nosniff')
        handler.send_header('X-Frame-Options', 'DENY')
        handler.send_header('Referrer-Policy', 'same-origin')


def set_session_cookie(handler, sec_state=None):
    """在响应中设置 HttpOnly SameSite=Strict session cookie。"""
    s = sec_state if sec_state is not None else sec
    handler.send_header(
        'Set-Cookie',
        SESSION_COOKIE_NAME + '=' + s.session_value +
        '; Path=/; HttpOnly; SameSite=Strict; Max-Age=%d' % SESSION_MAX_AGE
    )
