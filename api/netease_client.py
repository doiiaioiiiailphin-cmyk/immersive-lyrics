# -*- coding: utf-8 -*-
"""网易云适配层 —— 唯一接触 music.163.com 的模块。

设计目标: 任何网易云故障都不应影响本地播放器。
          网易云内部接口变化时，只需改这一个文件。

注意: NeteaseCloudMusicApi 项目 2024 年已归档停止维护，
      接口路径可能随时失效。这里保留候选 provider 以便快速替换。

关键安全点:
    - 所有出站请求设连接超时 5s + 读取超时 15s
    - 用完整 CookieJar（不只 MUSIC_U）
    - 扫码状态机完整处理 800/801/802/803/网络错误
"""
import os
import json
import time
import threading
import urllib.request
import urllib.parse
import urllib.error
import http.cookiejar
import base64
import copy
import requests
from http.cookies import SimpleCookie

# ============================================================
# 配置
# ============================================================
NETEASE_BASE = 'https://music.163.com'
NETEASE_UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
              'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36')
# 桌面客户端 UA（weapi 接口必须用这个，来自 chaunsin/netease-cloud-music）
NETEASE_DESKTOP_UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                      'AppleWebKit/605.1.15 (KHTML, like Gecko) '
                      'NeteaseMusicDesktop/2.3.17.1034')

CONNECT_TIMEOUT = 5
READ_TIMEOUT = 15

DATA_DIR = os.environ.get('PLAYER_DATA_DIR') or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data')
COOKIES_FILE = os.path.join(DATA_DIR, 'cookies.txt')
ACCOUNT_FILE = os.path.join(DATA_DIR, 'account.json')
NETEASE_AUTH_COOKIE = 'netease_auth'
NETEASE_AUTH_CHUNK_COOKIE = 'netease_auth_'
NETEASE_AUTH_CHUNK_SIZE = 3000
NETEASE_AUTH_MAX_CHUNKS = 16

os.makedirs(DATA_DIR, exist_ok=True)

_lyrics_cache = {}
_lyrics_cache_lock = threading.Lock()
_search_cache = {}
_search_cache_lock = threading.Lock()
_search_cache_ttl = 60
_song_url_cache = {}
_song_url_cache_lock = threading.Lock()
_song_url_cache_ttl = 300


# ============================================================
# 会话管理（完整 CookieJar + 持久化）
# ============================================================
class NeteaseSession:
    """网易云登录会话。

    使用 MozillaCookieJar 持久化完整 Cookie（MUSIC_U/__csrf/NMTID/...）。
    重启 serve.py 后自动加载，由 /api/status 实时验证有效性。
    """

    def __init__(self):
        self._lock = threading.Lock()
        # MozillaCookieJar 可直接 load/save 到文件
        self.cookiejar = http.cookiejar.MozillaCookieJar(COOKIES_FILE)
        # NetEase auth is carried by the user's browser cookie, not persisted on disk.
        # 账号 UI 信息（nickname 等，非敏感）
        self.nickname = None
        self._load_account()
        # 登录态缓存（/api/status 30s 缓存，避免频繁访问网易云）
        self._valid_cache = None  # (bool, timestamp)
        self._valid_cache_ttl = 300
        self._login_grace_until = 0
        self._browser_auth_value = None
        self._http_auth = requests.Session()
        self._http_auth.cookies = self.cookiejar
        self._http_public = requests.Session()
        adapter = requests.adapters.HTTPAdapter(pool_connections=8, pool_maxsize=16, max_retries=0)
        self._http_auth.mount('https://', adapter)
        self._http_public.mount('https://', adapter)

    # ---------- Cookie 持久化 ----------
    def _load_cookies(self):
        try:
            if os.path.exists(COOKIES_FILE):
                self.cookiejar.load(ignore_discard=True, ignore_expires=True)
        except Exception as e:
            print('[netease] 加载 cookies.txt 失败: %s' % e)

    def _save_cookies(self):
        return

    # ---------- 账号信息持久化 ----------
    def _load_account(self):
        try:
            if os.path.exists(ACCOUNT_FILE):
                with open(ACCOUNT_FILE, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    self.nickname = data.get('nickname')
        except Exception as e:
            print('[netease] 加载 account.json 失败: %s' % e)

    def _save_account(self):
        try:
            with open(ACCOUNT_FILE, 'w', encoding='utf-8') as f:
                json.dump({'nickname': self.nickname}, f, ensure_ascii=False)
        except Exception as e:
            print('[netease] 保存 account.json 失败: %s' % e)

    # ---------- Cookie 操作 ----------
    def has_music_u(self):
        """是否有 MUSIC_U cookie（登录过）。注意：存在≠有效。"""
        for c in self.cookiejar:
            if c.name in ('MUSIC_U', 'MUSIC_A') and c.value:
                return True
        return False

    def _store_cookie_string(self, cookie_text):
        """Store cookies returned in QR-login JSON into the CookieJar.

        NetEase QR login commonly returns cookies in a JSON `cookie` field
        instead of, or in addition to, Set-Cookie headers.
        """
        if not cookie_text:
            return
        parsed = SimpleCookie()
        try:
            parsed.load(cookie_text)
        except Exception as e:
            print('[netease] 解析 QR cookie 失败: %s' % e)
            return
        for morsel in parsed.values():
            domain = morsel['domain'] or '.music.163.com'
            path = morsel['path'] or '/'
            expires = None
            self.cookiejar.set_cookie(http.cookiejar.Cookie(
                version=0,
                name=morsel.key,
                value=morsel.value,
                port=None,
                port_specified=False,
                domain=domain,
                domain_specified=bool(domain),
                domain_initial_dot=domain.startswith('.'),
                path=path,
                path_specified=bool(path),
                secure=bool(morsel['secure']),
                expires=expires,
                discard=True,
                comment=None,
                comment_url=None,
                rest={},
                rfc2109=False,
            ))

    def _merge_public_login_cookies(self):
        """Move QR-login Set-Cookie values captured by the public session into the auth jar."""
        copied = 0
        with self._lock:
            for c in self._http_public.cookies:
                if c.name in ('MUSIC_U', 'MUSIC_A', '__csrf', '__csrf_token', 'NMTID') and c.value:
                    self.cookiejar.set_cookie(copy.copy(c))
                    copied += 1
            if copied:
                self._http_auth.cookies = self.cookiejar
                self._valid_cache = None
        return copied

    def load_from_browser_cookie(self, cookie_header):
        """Load NetEase cookies from this browser's HttpOnly app cookie."""
        if not cookie_header or (NETEASE_AUTH_COOKIE not in cookie_header and NETEASE_AUTH_CHUNK_COOKIE not in cookie_header):
            return
        cookies = {}
        for part in cookie_header.split(';'):
            part = part.strip()
            if '=' not in part:
                continue
            k, v = part.split('=', 1)
            cookies[k.strip()] = v.strip()
        value = cookies.get(NETEASE_AUTH_COOKIE, '')
        if not value:
            chunks = []
            idx = 0
            while True:
                name = NETEASE_AUTH_CHUNK_COOKIE + str(idx)
                if name not in cookies:
                    break
                chunks.append(cookies[name])
                idx += 1
            value = ''.join(chunks)
        if not value:
            return
        with self._lock:
            if value == self._browser_auth_value:
                return
        try:
            padding = '=' * (-len(value) % 4)
            cookie_text = base64.urlsafe_b64decode((value + padding).encode('ascii')).decode('utf-8')
        except Exception as e:
            print('[netease] 浏览器 cookie 解析失败: %s' % e)
            return
        with self._lock:
            self.cookiejar.clear()
            self._store_cookie_string(cookie_text)
            self._browser_auth_value = value
            self._valid_cache = None

    def browser_cookie_headers(self, max_age=60 * 60 * 24 * 30):
        names = {'MUSIC_U', '__csrf', '__csrf_token', 'NMTID', 'MUSIC_A'}
        pairs = []
        for c in self.cookiejar:
            if c.name in names and c.value:
                pairs.append('%s=%s' % (c.name, c.value))
        raw = '; '.join(pairs)
        value = base64.urlsafe_b64encode(raw.encode('utf-8')).decode('ascii').rstrip('=')
        with self._lock:
            self._browser_auth_value = value
        headers = [
            '%s=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' % NETEASE_AUTH_COOKIE
        ]
        chunks = [value[i:i + NETEASE_AUTH_CHUNK_SIZE] for i in range(0, len(value), NETEASE_AUTH_CHUNK_SIZE)] or ['']
        for idx, chunk in enumerate(chunks):
            headers.append('%s%d=%s; Path=/; HttpOnly; SameSite=Strict; Max-Age=%d' % (
                NETEASE_AUTH_CHUNK_COOKIE, idx, chunk, max_age))
        for idx in range(len(chunks), NETEASE_AUTH_MAX_CHUNKS):
            headers.append('%s%d=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' % (
                NETEASE_AUTH_CHUNK_COOKIE, idx))
        return headers

    def browser_cookie_header(self, max_age=60 * 60 * 24 * 30):
        headers = self.browser_cookie_headers(max_age=max_age)
        return headers[1] if len(headers) > 1 else headers[0]

    def clear_browser_cookie_headers(self):
        headers = ['%s=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' % NETEASE_AUTH_COOKIE]
        for idx in range(NETEASE_AUTH_MAX_CHUNKS):
            headers.append('%s%d=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' % (
                NETEASE_AUTH_CHUNK_COOKIE, idx))
        return headers

    def clear_browser_cookie_header(self):
        return self.clear_browser_cookie_headers()[0]

    def clear(self):
        """退出登录：清空 cookiejar + 删文件。"""
        with self._lock:
            self.cookiejar.clear()
            self.nickname = None
            self._valid_cache = (False, time.monotonic())
            self._login_grace_until = 0
            self._browser_auth_value = None
            # 删除持久化文件
            for f in (COOKIES_FILE, ACCOUNT_FILE):
                try:
                    if os.path.exists(f):
                        os.remove(f)
                except OSError:
                    pass
            # 重建空 jar
            self.cookiejar = http.cookiejar.MozillaCookieJar(COOKIES_FILE)
            self._http_auth.cookies = self.cookiejar

    def invalidate(self):
        """置登录态失效（网易云返回未登录时调用）。"""
        with self._lock:
            self._valid_cache = (False, time.monotonic())
            self._login_grace_until = 0

    # ---------- 登录态验证（带缓存） ----------
    def is_valid(self, force=False):
        """实际调网易云账号接口验证登录态。

        30s 缓存，force=True 强制重新验证。
        返回 bool。
        """
        with self._lock:
            if not force and self._valid_cache is not None:
                cached_valid, ts = self._valid_cache
                if time.monotonic() - ts < self._valid_cache_ttl:
                    return cached_valid
        # 没登录过直接 False（不发请求）
        if not self.has_music_u():
            with self._lock:
                self._valid_cache = (False, time.monotonic())
                self._login_grace_until = 0
            return False
        with self._lock:
            if time.monotonic() < self._login_grace_until:
                self._valid_cache = (True, time.monotonic())
                return True
        # 实际验证
        valid = self._verify_with_account_api()
        with self._lock:
            self._valid_cache = (valid, time.monotonic())
        return valid

    def _verify_with_account_api(self):
        """调网易云账号信息接口验证 cookie 是否有效。

        用 /api/nuser/account/get （轻量，返回用户基本信息）。
        失败或返回未登录标记 → False。
        """
        try:
            data = self.request(
                '/api/nuser/account/get', method='GET', authenticated=True,
            )
            # 有效的登录态会有 account 或 profile 字段
            if data and (data.get('code') == 200):
                account = data.get('account') or {}
                profile = data.get('profile') or {}
                nickname = account.get('userName') or profile.get('nickname')
                if nickname:
                    self.nickname = nickname
                    self._save_account()
                return True
            return False
        except Exception as e:
            print('[netease] 验证登录态失败: %s' % e)
            return False

    # ---------- 统一请求 ----------
    def request(self, endpoint, method='GET', params=None, data=None,
                authenticated=True, timeout=READ_TIMEOUT, crypto='api'):
        """发起到网易云的请求。

        endpoint: '/api/...' 或完整 URL
        method: GET / POST
        params: dict，拼到 query
        data: dict，作为 POST form body（api 模式）或加密载荷（weapi 模式）
        authenticated: 是否带 cookiejar
        crypto: 'api'（明文 /api/）| 'weapi'（加密 /weapi/）

        返回解析后的 JSON dict。
        超时/网络错误抛 NetEaseError。

        登录相关接口必须用 weapi（明文 /api/ 在授权环节返回 8821）。
        """
        url = endpoint if endpoint.startswith('http') else NETEASE_BASE + endpoint

        # weapi 模式：替换路径 + 加密
        if crypto == 'weapi':
            from .weapi_crypto import weapi_encrypt
            url = url.replace('/api/', '/weapi/').replace('/weapi/weapi/', '/weapi/')
            csrf = ''
            for c in self.cookiejar:
                if c.name in ('__csrf', '__csrf_token'):
                    csrf = c.value
            url += ('&' if '?' in url else '?') + 'csrf_token=' + csrf
            encrypted = weapi_encrypt(data or {})
            body = urllib.parse.urlencode(encrypted).encode('utf-8')
            headers = {
                'User-Agent': NETEASE_DESKTOP_UA,
                'Referer': NETEASE_BASE + '/',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': '*/*',
                'Accept-Language': 'zh-CN,zh-Hans;q=0.9',
            }
            req = urllib.request.Request(url, data=body, headers=headers, method='POST')
        else:
            # 明文 /api/ 模式
            if params:
                url += ('&' if '?' in url else '?') + urllib.parse.urlencode(params)
            body = None
            headers = {
                'User-Agent': NETEASE_UA,
                'Referer': NETEASE_BASE + '/',
            }
            if method == 'POST':
                headers['Content-Type'] = 'application/x-www-form-urlencoded'
                if data:
                    body = urllib.parse.urlencode(data).encode('utf-8')
            req = urllib.request.Request(url, data=body, headers=headers, method=method)

        try:
            session = self._http_auth if authenticated else self._http_public
            response = session.request(
                req.get_method(),
                url,
                data=body,
                headers=dict(req.header_items()),
                timeout=(CONNECT_TIMEOUT, timeout),
            )
            if response.status_code >= 400:
                raise NetEaseError(
                    'upstream-http-%d' % response.status_code,
                    '网易云返回 HTTP %d' % response.status_code,
                )
            return response.json()
        except requests.Timeout:
            raise NetEaseError('upstream-timeout', '网易云请求超时', retryable=True)
        except requests.RequestException as e:
            raise NetEaseError('upstream-network', '网络错误: %s' % e, retryable=True)
        except (json.JSONDecodeError, ValueError, requests.JSONDecodeError):
            raise NetEaseError('upstream-parse', '网易云响应解析失败', retryable=True)

    # ---------- 扫码登录 ----------
    def create_qr(self):
        """生成扫码登录 key 和二维码图片（base64 PNG）。

        网易云二维码登录（必须用 weapi 加密，明文 /api/ 在授权时返回 8821）:
            - /weapi/login/qrcode/unikey 生成 unikey
            - 二维码内容为 https://music.163.com/login?codekey={unikey}
            - 前端用 <img src="data:image/png;base64,..."> 显示

        返回 {'unikey': str, 'qrcode_b64': str}
        失败抛 NetEaseError。
        """
        data = self.request(
            '/api/login/qrcode/unikey', method='POST',
            data={'type': 1}, authenticated=False, crypto='weapi',
        )
        if data.get('code') != 200 or not data.get('unikey'):
            raise NetEaseError('qr-create-failed', '生成二维码失败')
        unikey = data['unikey']
        # 生成二维码图片
        qr_content = NETEASE_BASE + '/login?codekey=' + unikey
        qrcode_b64 = self._make_qrcode_base64(qr_content)
        return {
            'unikey': unikey,
            'qrcode_b64': qrcode_b64,
        }

    def _make_qrcode_base64(self, content):
        """生成二维码 PNG 的 base64 字符串。"""
        import io, base64, qrcode
        qr = qrcode.QRCode(
            version=1,
            error_correction=qrcode.constants.ERROR_CORRECT_M,
            box_size=8,
            border=2,
        )
        qr.add_data(content)
        qr.make(fit=True)
        img = qr.make_image(fill_color='black', back_color='white')
        buf = io.BytesIO()
        img.save(buf, format='PNG')
        return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode('ascii')

    def check_qr(self, unikey):
        """轮询扫码状态。

        注意: /api/login/qrcode/client/login 必须用 POST + type=1，
              GET 请求会返回"参数错误"（code 400）。

        返回 {'code': int, 'message': str, 'nickname': str?}
        状态码:
            800 二维码过期（停止轮询，需刷新）
            801 等待扫码
            802 已扫码，等待手机确认
            803 授权成功（此时 cookie 已写入 cookiejar）
        """
        data = self.request(
            '/api/login/qrcode/client/login', method='POST',
            data={'key': unikey, 'type': 1}, authenticated=False, crypto='weapi',
        )
        self._merge_public_login_cookies()
        code = data.get('code', 0)
        result = {'code': code}

        if code == 800:
            result['message'] = '二维码已过期'
        elif code == 801:
            result['message'] = '等待扫码'
        elif code == 802:
            result['message'] = '已扫码，等待手机上确认'
        elif code == 803:
            # 成功！JSON 里通常会带 cookie 字符串，urllib 不一定能自动捕获。
            self._store_cookie_string(data.get('cookie'))
            self._save_cookies()
            # 803 已代表授权成功；账号信息接口偶尔会短暂不可用，不能马上把登录态打回 false。
            if self.has_music_u():
                now = time.monotonic()
                with self._lock:
                    self._valid_cache = (True, now)
                    self._login_grace_until = now + 60
            # 尝试补昵称，失败也不影响刚拿到的授权态。
            self._verify_with_account_api()
            result['message'] = '登录成功'
            result['nickname'] = self.nickname
            self._save_account()
        elif code == 8821:
            # 明文 /api/ 接口在授权环节被拒（8821）
            # weapi 加密模式下不应再出现；若仍出现说明加密有问题
            result['message'] = '登录验证失败（8821），请刷新二维码重试'
        else:
            result['message'] = '状态码 %s' % code
        return result


class NetEaseError(Exception):
    """网易云请求异常。"""
    def __init__(self, code, message, retryable=False):
        self.code = code
        self.retryable = retryable
        super().__init__(message)


# ============================================================
# 业务接口（搜索/歌词/歌曲详情/音频URL）
# 这些方法都通过 netease.request() 发起，自动带 cookie。
# ============================================================

def search_songs(keyword, page=1, limit=30):
    """搜索歌曲。返回简化后的结果列表。

    用 /api/cloudsearch/pc 接口（比 /api/search/get 信息更全）。
    需要登录态（cloudsearch 部分结果需要 cookie）。
    """
    cache_key = (keyword.strip().casefold(), int(page), int(limit))
    with _search_cache_lock:
        cached = _search_cache.get(cache_key)
        if cached and time.monotonic() - cached[1] < _search_cache_ttl:
            return cached[0]
    data = netease.request(
        '/api/cloudsearch/pc', method='POST',
        data={
            's': keyword,
            'type': 1,          # 1=歌曲
            'offset': (page - 1) * limit,
            'limit': limit,
            'total': 'true',
        },
        authenticated=True,
    )
    if data.get('code') != 200:
        raise NetEaseError('search-failed', '搜索失败: code=%s' % data.get('code'))
    songs = data.get('result', {}).get('songs', [])
    result = [_simplify_song(s) for s in songs]
    with _search_cache_lock:
        if len(_search_cache) >= 100:
            oldest = min(_search_cache, key=lambda key: _search_cache[key][1])
            _search_cache.pop(oldest, None)
        _search_cache[cache_key] = (result, time.monotonic())
    return result


def get_song_detail(song_id):
    """获取单首歌详情（封面/时长/歌手）。

    封面 URL 公开，不强制要求登录态（authenticated=False）。
    """
    data = netease.request(
        '/api/v3/song/detail', method='POST',
        data={'c': json.dumps([{'id': int(song_id)}]), 'v': 'v1'},
        authenticated=False,
    )
    if data.get('code') != 200:
        raise NetEaseError('detail-failed', '获取详情失败')
    songs = data.get('songs', [])
    if not songs:
        raise NetEaseError('not-found', '歌曲不存在', retryable=False)
    return _simplify_song(songs[0])


def get_lyrics(song_id, duration=None):
    """获取歌词（yrc 优先，降级 lrc）。

    返回 {mode, lines} 结构（见 lyrics_parser）。
    无任何歌词时 mode='none', lines=[]。
    """
    cache_key = (str(song_id), round(float(duration or 0), 3))
    with _lyrics_cache_lock:
        cached = _lyrics_cache.get(cache_key)
        if cached is not None:
            return cached
    data = netease.request(
        '/api/song/lyric', method='GET',
        params={
            'id': str(song_id),
            'lv': 1, 'kv': 1, 'tv': -1, 'yv': 1, 'yvtc': 1,
        },
        authenticated=True,
    )
    lrc_txt = data.get('lrc', {}).get('lyric', '')
    yrc_txt = data.get('yrc', {}).get('lyric', '')
    trans_txt = data.get('tlyric', {}).get('lyric', '')

    from .lyrics_parser import parse_netease_lyrics
    parsed = parse_netease_lyrics(lrc_txt, yrc_txt, trans_txt, duration=duration)
    with _lyrics_cache_lock:
        _lyrics_cache[cache_key] = parsed
    return parsed


def _simplify_song(raw):
    """把网易云原始歌曲结构简化为前端需要的格式。"""
    artists = raw.get('ar') or raw.get('artists') or []
    artist_name = ' / '.join(a.get('name', '') for a in artists) if artists else ''
    album = raw.get('al') or raw.get('album') or {}
    vip = _song_vip_meta(raw)
    quality = _song_quality_meta(raw)
    return {
        'id': str(raw.get('id', '')),
        'name': raw.get('name', ''),
        'artist': artist_name,
        'album': album.get('name', ''),
        'cover': album.get('picUrl', ''),
        'duration': (raw.get('dt') or raw.get('duration') or 0) / 1000,  # 秒
        'vip': vip,
        'quality': quality,
    }


def _song_vip_meta(raw):
    privilege = raw.get('privilege') or {}
    fee = privilege.get('fee', raw.get('fee', 0))
    pl = privilege.get('pl')
    pl_level = privilege.get('plLevel') or raw.get('plLevel')
    locked_standard = fee in (1, 4) and (
        pl == 0 or pl_level == 'none' or privilege.get('sp') == 0
    )
    label = ''
    reason = ''
    if locked_standard:
        label = 'VIP'
        reason = '该歌曲需要%s播放权限' % label
    return {
        'required': bool(locked_standard),
        'label': label,
        'reason': reason,
        'fee': fee,
        'play_level': pl_level,
        'play_bitrate': pl,
    }


def _song_quality_meta(raw):
    privilege = raw.get('privilege') or {}
    levels = [
        privilege.get('playMaxbrLevel'),
        privilege.get('downloadMaxbrLevel'),
        privilege.get('maxBrLevel'),
        privilege.get('flLevel'),
        raw.get('flLevel'),
        raw.get('plLevel'),
    ]
    label = ''
    for level in levels:
        if level in ('sky', 'jymaster'):
            label = '超清母带'
            break
        if level in ('hires', 'jyeffect'):
            label = '母带'
            break
        if level == 'lossless':
            label = '无损'
    return {
        'label': label,
    }


# ============================================================
# 音频 URL 获取（候选 provider，避免写死单一接口）
# ============================================================

def get_song_url(song_id, level='exhigh'):
    """获取歌曲播放 URL。

    用候选 provider 逐个尝试（网易云接口会变，不写死单一接口）:
        - v1: /api/song/enhance/player/url/v1 （新版，带 levels）
        - legacy: /api/song/enhance/player/url （旧版）

    level: standard / higher / exhigh / lossless / hires
    返回: {url, type, size, level, trial} 或 None（无版权/付费）
    """
    cache_key = (str(song_id), level or 'exhigh')
    with _song_url_cache_lock:
        cached = _song_url_cache.get(cache_key)
        if cached and time.monotonic() - cached[1] < _song_url_cache_ttl:
            return cached[0]
    providers = [_get_song_url_v1, _get_song_url_legacy]
    last_error = None
    for provider in providers:
        try:
            result = provider(song_id, level)
            if result and result.get('url'):
                with _song_url_cache_lock:
                    _song_url_cache[cache_key] = (result, time.monotonic())
                return result
        except NetEaseError as e:
            last_error = e
            continue
    if last_error:
        raise last_error
    return None


def _get_song_url_v1(song_id, level):
    """新版接口 /api/song/enhance/player/url/v1。"""
    data = netease.request(
        '/api/song/enhance/player/url/v1', method='POST',
        data={
            'ids': json.dumps([int(song_id)]),
            'level': level,
            'encodeType': 'flac',
        },
        authenticated=True,
    )
    if data.get('code') != 200:
        raise NetEaseError('song-url-failed', '获取播放URL失败: code=%s' % data.get('code'))
    urls = data.get('data', [])
    if not urls:
        return None
    item = urls[0]
    return _parse_song_url_item(item, level)


def _get_song_url_legacy(song_id, level):
    """旧版接口 /api/song/enhance/player/url。"""
    # 旧接口用 br（bitrate）而非 level
    br_map = {'standard': 128000, 'higher': 192000, 'exhigh': 320000,
              'lossless': 999000, 'hires': 1999000}
    br = br_map.get(level, 320000)
    data = netease.request(
        '/api/song/enhance/player/url', method='POST',
        data={
            'ids': '[' + str(int(song_id)) + ']',
            'br': br,
        },
        authenticated=True,
    )
    if data.get('code') != 200:
        raise NetEaseError('song-url-failed', '获取播放URL失败(legacy): code=%s' % data.get('code'))
    urls = data.get('data', [])
    if not urls:
        return None
    return _parse_song_url_item(urls[0], level)


def _parse_song_url_item(item, requested_level):
    """解析单个 song url 条目。"""
    if not item or not item.get('url'):
        return None
    return {
        'url': item.get('url'),
        'type': item.get('type', 'mp3'),
        'size': item.get('size', 0),
        'br': item.get('br', 0),
        # 实际品质（可能因版权降级）
        'level': item.get('level') or requested_level,
        'requested_level': requested_level,
        # 试听片段（freeTrialInfo 非空表示只能试听）
        'trial': bool(item.get('freeTrialInfo')),
        'code': item.get('code', 200),
    }


# 全局单例
netease = NeteaseSession()
