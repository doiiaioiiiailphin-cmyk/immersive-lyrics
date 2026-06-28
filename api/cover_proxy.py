# -*- coding: utf-8 -*-
"""封面图片代理。

关键安全点（定稿方案）:
    - 精确域名白名单（非 endswith('163.com')，防 evil163.com）
        music.163.com / *.music.163.com
        music.126.net / *.music.126.net
        y.qq.com / *.qq.com / *.qqmusic.qq.com
    - 每次重定向都重新校验域名（不只查第一次）
    - 限制最大体积（5MB）
    - 设 Cache-Control 让浏览器缓存
    - 失败返回默认占位图

作用: 保证 <img> 同源加载，Canvas getImageData() 不被污染，
      丝绸背景的封面取色才能正常工作。
"""
import urllib.request
import urllib.error
from urllib.parse import urlparse

MAX_COVER_SIZE = 5 * 1024 * 1024  # 5MB
CACHE_MAX_AGE = 86400  # 1天

# 默认占位封面（1x1 透明 PNG，避免 broken image）
_PLACEHOLDER_PNG = bytes.fromhex(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4'
    '890000000d49444154789c63000100000005000100'
    '0d0a2db400000000494541ea90000000'[:0]  # 截断，用更短的
) or (
    b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01'
    b'\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\x00'
    b'\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82'
)


def allowed_cover_host(host):
    """精确判断封面域名是否在白名单内。

    不用 host.endswith('163.com') —— 那 evil163.com 也会过。
    """
    if not host:
        return False
    return (
        host == 'music.163.com' or host.endswith('.music.163.com')
        or host == 'music.126.net' or host.endswith('.music.126.net')
        or host == 'p1.music.126.net' or host == 'p2.music.126.net'
        or host == 'p3.music.126.net' or host == 'p4.music.126.net'
        or host == 'y.qq.com' or host.endswith('.qq.com')
        or host.endswith('.qqmusic.qq.com')
        or host.endswith('.biliimg.com') or host.endswith('.hdslb.com')
        or host.endswith('.bilibili.com')
    )


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    """不自动跟随重定向，手动校验每次跳转的域名。"""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # 不自动重定向


def proxy_cover(cover_url, handler):
    """代理封面图片。

    流程:
        1. 校验初始 URL 域名
        2. 发起请求（手动处理重定向，每次校验域名）
        3. 读取（限 5MB）
        4. 转发给客户端（设 Cache-Control）

    返回 None（直接写 handler 响应）。
    """
    if not _validate_url(cover_url):
        _send_placeholder(handler)
        return

    try:
        # 用不自动重定向的 opener，手动校验每次跳转
        opener = urllib.request.build_opener(_NoRedirectHandler())
        current_url = cover_url
        redirects = 0
        while redirects < 5:
            if not _validate_url(current_url):
                _send_placeholder(handler)
                return
            req = urllib.request.Request(current_url, headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': 'https://music.163.com/',
            })
            try:
                resp = opener.open(req, timeout=10)
                break
            except urllib.error.HTTPError as e:
                if e.code in (301, 302, 303, 307, 308):
                    location = e.headers.get('Location')
                    if not location:
                        _send_placeholder(handler)
                        return
                    current_url = location
                    redirects += 1
                    continue
                raise
        else:
            _send_placeholder(handler)
            return

        # 读取（限大小，分块读避免超大文件耗内存）
        content_type = resp.headers.get('Content-Type', 'image/jpeg')
        if not content_type.startswith('image/'):
            content_type = 'image/jpeg'

        data = b''
        while True:
            chunk = resp.read(65536)
            if not chunk:
                break
            data += chunk
            if len(data) > MAX_COVER_SIZE:
                _send_placeholder(handler)
                return

        _send_image(handler, data, content_type)

    except Exception as e:
        print('[cover_proxy] 获取失败 %s: %s' % (cover_url[:60], e))
        _send_placeholder(handler)


def _validate_url(url):
    """校验 URL scheme + 域名白名单。"""
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ('http', 'https'):
            return False
        return allowed_cover_host(parsed.hostname)
    except Exception:
        return False


def _send_image(handler, data, content_type):
    """发送图片响应。"""
    handler.send_response(200)
    handler.send_header('Content-Type', content_type)
    handler.send_header('Content-Length', str(len(data)))
    handler.send_header('Cache-Control', 'public, max-age=%d' % CACHE_MAX_AGE)
    handler.send_header('X-Content-Type-Options', 'nosniff')
    handler.end_headers()
    try:
        handler.wfile.write(data)
    except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
        handler.close_connection = True


def _send_placeholder(handler):
    """发送默认占位图。"""
    _send_image(handler, _PLACEHOLDER_PNG, 'image/png')
