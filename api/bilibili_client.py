# -*- coding: utf-8 -*-
"""Bilibili provider.

This module talks to Bilibili web endpoints directly. The endpoints are not a
stable public music API, so every media lookup is best-effort and returns a
clear unavailable reason when Bilibili denies the stream.
"""
import base64
import hashlib
import http.cookiejar
import json
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from http.cookies import SimpleCookie


BILI_BASE = 'https://www.bilibili.com'
BILI_API_BASE = 'https://api.bilibili.com'
READ_TIMEOUT = 15
BILI_AUTH_COOKIE = 'bilibili_auth'
BILI_AUTH_CHUNK_COOKIE = 'bilibili_auth_'
BILI_AUTH_CHUNK_SIZE = 3000
BILI_AUTH_MAX_CHUNKS = 16
SAFE_BVID_RE = re.compile(r'^BV[0-9A-Za-z]{10}$')
SAFE_TRACK_RE = re.compile(r'^(BV[0-9A-Za-z]{10}):([0-9]{1,20})$')
BVID_FIND_RE = re.compile(r'BV[0-9A-Za-z]{10}')
ALLOWED_INPUT_HOSTS = {
    'bilibili.com',
    'www.bilibili.com',
    'm.bilibili.com',
    'b23.tv',
}
MIXIN_KEY_ENC_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32,
    15, 50, 10, 31, 58, 3, 45, 35,
    27, 43, 5, 49, 33, 9, 42, 19,
    29, 28, 14, 39, 12, 38, 41, 13,
    37, 48, 7, 16, 24, 55, 40, 61,
    26, 17, 0, 1, 60, 51, 30, 4,
    22, 25, 54, 21, 56, 59, 6, 63,
    57, 62, 11, 36, 20, 34, 44, 52,
]


class BilibiliError(Exception):
    def __init__(self, code, message, retryable=False):
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


class BilibiliSession:
    def __init__(self):
        self._lock = threading.Lock()
        self.cookiejar = http.cookiejar.CookieJar()
        self.nickname = None
        self._valid_cache = None
        self._browser_auth_value = None
        self._wbi_cache = None
        self._view_cache = {}
        self._subtitle_cache = {}

    # ---------- browser cookie persistence ----------
    def _cookie_pairs(self):
        pairs = []
        for cookie in self.cookiejar:
            if cookie.value:
                pairs.append('%s=%s' % (cookie.name, cookie.value))
        return pairs

    def _store_cookie_string(self, cookie_text):
        if not cookie_text:
            return
        parsed = SimpleCookie()
        try:
            parsed.load(cookie_text)
        except Exception:
            # SimpleCookie is strict about copied browser cookie strings. Fall
            # back to a small "name=value; name2=value2" parser.
            for part in cookie_text.split(';'):
                part = part.strip()
                if '=' not in part:
                    continue
                name, value = part.split('=', 1)
                self._set_cookie(name.strip(), value.strip())
            return
        for morsel in parsed.values():
            self._set_cookie(morsel.key, morsel.value, morsel['domain'] or '.bilibili.com')

    def _set_cookie(self, name, value, domain='.bilibili.com'):
        if not name or value is None:
            return
        self.cookiejar.set_cookie(http.cookiejar.Cookie(
            version=0,
            name=name,
            value=value,
            port=None,
            port_specified=False,
            domain=domain,
            domain_specified=True,
            domain_initial_dot=domain.startswith('.'),
            path='/',
            path_specified=True,
            secure=False,
            expires=None,
            discard=True,
            comment=None,
            comment_url=None,
            rest={},
            rfc2109=False,
        ))

    def load_from_browser_cookie(self, cookie_header):
        if not cookie_header or (BILI_AUTH_COOKIE not in cookie_header and BILI_AUTH_CHUNK_COOKIE not in cookie_header):
            return
        cookies = {}
        for part in cookie_header.split(';'):
            part = part.strip()
            if '=' not in part:
                continue
            key, value = part.split('=', 1)
            cookies[key.strip()] = value.strip()
        value = cookies.get(BILI_AUTH_COOKIE, '')
        if not value:
            chunks = []
            idx = 0
            while True:
                name = BILI_AUTH_CHUNK_COOKIE + str(idx)
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
            print('[bilibili] 浏览器 cookie 解析失败: %s' % e)
            return
        with self._lock:
            self.cookiejar.clear()
            self._store_cookie_string(cookie_text)
            self._browser_auth_value = value
            self._valid_cache = None
            self._wbi_cache = None
            self._subtitle_cache.clear()

    def import_cookie_text(self, cookie_text):
        cookie_text = (cookie_text or '').strip()
        if not cookie_text:
            raise BilibiliError('bad-cookie', 'Cookie 不能为空', retryable=False)
        with self._lock:
            self.cookiejar.clear()
            self._store_cookie_string(cookie_text)
            self._valid_cache = None
            self._wbi_cache = None
            self._subtitle_cache.clear()
        self.is_valid(force=True)

    def browser_cookie_headers(self, max_age=60 * 60 * 24 * 30):
        raw = '; '.join(self._cookie_pairs())
        value = base64.urlsafe_b64encode(raw.encode('utf-8')).decode('ascii').rstrip('=')
        with self._lock:
            self._browser_auth_value = value
        headers = ['%s=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' % BILI_AUTH_COOKIE]
        chunks = [value[i:i + BILI_AUTH_CHUNK_SIZE] for i in range(0, len(value), BILI_AUTH_CHUNK_SIZE)] or ['']
        for idx, chunk in enumerate(chunks):
            headers.append('%s%d=%s; Path=/; HttpOnly; SameSite=Strict; Max-Age=%d' % (
                BILI_AUTH_CHUNK_COOKIE, idx, chunk, max_age))
        for idx in range(len(chunks), BILI_AUTH_MAX_CHUNKS):
            headers.append('%s%d=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' % (
                BILI_AUTH_CHUNK_COOKIE, idx))
        return headers

    def clear_browser_cookie_headers(self):
        headers = ['%s=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' % BILI_AUTH_COOKIE]
        for idx in range(BILI_AUTH_MAX_CHUNKS):
            headers.append('%s%d=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' % (
                BILI_AUTH_CHUNK_COOKIE, idx))
        return headers

    def clear(self):
        with self._lock:
            self.cookiejar.clear()
            self.nickname = None
            self._valid_cache = (False, time.monotonic())
            self._browser_auth_value = None
            self._wbi_cache = None
            self._subtitle_cache.clear()

    # ---------- requests ----------
    def _opener(self):
        return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookiejar))

    def request_json(self, url, params=None, headers=None, timeout=READ_TIMEOUT):
        if params:
            url += ('&' if '?' in url else '?') + urllib.parse.urlencode(params)
        req_headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': BILI_BASE + '/',
            'Origin': BILI_BASE,
        }
        if headers:
            req_headers.update(headers)
        req = urllib.request.Request(url, headers=req_headers)
        try:
            with self._opener().open(req, timeout=timeout) as resp:
                raw = resp.read()
        except urllib.error.HTTPError as e:
            raise BilibiliError('upstream-http-%d' % e.code, 'B站返回 HTTP %d' % e.code, retryable=e.code >= 500)
        except urllib.error.URLError as e:
            if 'timed out' in str(e).lower():
                raise BilibiliError('upstream-timeout', 'B站请求超时', retryable=True)
            raise BilibiliError('upstream-network', 'B站网络错误: %s' % getattr(e, 'reason', e), retryable=True)
        try:
            data = json.loads(raw.decode('utf-8'))
        except (ValueError, UnicodeDecodeError) as e:
            raise BilibiliError('upstream-parse', 'B站响应解析失败: %s' % e, retryable=True)
        code = data.get('code')
        if code not in (0, None):
            message = data.get('message') or data.get('msg') or 'B站接口失败'
            raise BilibiliError('upstream-denied', 'B站接口返回: %s' % message, retryable=False)
        return data

    def fetch_json_url(self, url):
        if url.startswith('//'):
            url = 'https:' + url
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme not in ('http', 'https'):
            raise BilibiliError('bad-url', '无效字幕 URL', retryable=False)
        if not _allowed_bili_media_host(parsed.hostname):
            raise BilibiliError('bad-url', '字幕 URL 域名不允许', retryable=False)
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': BILI_BASE + '/',
        })
        try:
            with self._opener().open(req, timeout=READ_TIMEOUT) as resp:
                raw = resp.read(1024 * 1024)
        except urllib.error.URLError as e:
            raise BilibiliError('upstream-network', '字幕下载失败: %s' % getattr(e, 'reason', e), retryable=True)
        try:
            return json.loads(raw.decode('utf-8'))
        except (ValueError, UnicodeDecodeError):
            raise BilibiliError('upstream-parse', '字幕格式解析失败', retryable=True)

    # ---------- account ----------
    def is_valid(self, force=False):
        with self._lock:
            if not force and self._valid_cache and time.monotonic() - self._valid_cache[1] < 30:
                return self._valid_cache[0]
            has_login_cookie = any(c.name == 'SESSDATA' and c.value for c in self.cookiejar)
            if not has_login_cookie:
                self.nickname = None
                self._valid_cache = (False, time.monotonic())
                return False
        try:
            data = self.request_json(BILI_API_BASE + '/x/web-interface/nav')
            payload = data.get('data') or {}
            valid = bool(payload.get('isLogin'))
            with self._lock:
                self.nickname = payload.get('uname') if valid else None
                self._valid_cache = (valid, time.monotonic())
            return valid
        except BilibiliError as e:
            with self._lock:
                self._valid_cache = (False, time.monotonic())
                self.nickname = None
            if e.code == 'upstream-denied':
                return False
            raise

    # ---------- WBI ----------
    def _wbi_keys(self):
        with self._lock:
            if self._wbi_cache and time.monotonic() - self._wbi_cache[1] < 6 * 60 * 60:
                return self._wbi_cache[0]
        data = self.request_json(BILI_API_BASE + '/x/web-interface/nav')
        wbi = ((data.get('data') or {}).get('wbi_img') or {})
        img_key = _key_from_url(wbi.get('img_url') or '')
        sub_key = _key_from_url(wbi.get('sub_url') or '')
        if not img_key or not sub_key:
            raise BilibiliError('wbi-key-failed', '获取 B站 WBI key 失败', retryable=True)
        mixin = _mixin_key(img_key + sub_key)
        with self._lock:
            self._wbi_cache = (mixin, time.monotonic())
        return mixin

    def signed_params(self, params):
        params = dict(params or {})
        params['wts'] = int(time.time())
        mixin = self._wbi_keys()
        clean = {}
        for key, value in params.items():
            text = str(value)
            clean[key] = ''.join(ch for ch in text if ch not in "!'()*")
        query = urllib.parse.urlencode(sorted(clean.items()))
        clean['w_rid'] = hashlib.md5((query + mixin).encode('utf-8')).hexdigest()
        return clean


bilibili = BilibiliSession()


def resolve_video(user_input):
    bvid = _resolve_bvid(user_input)
    view = get_video_view(bvid)
    pages = []
    for idx, page in enumerate(view.get('pages') or [], start=1):
        cid = int(page.get('cid') or 0)
        if not cid:
            continue
        pages.append({
            'page': int(page.get('page') or idx),
            'cid': cid,
            'title': page.get('part') or view.get('title') or ('P%d' % idx),
            'duration': int(page.get('duration') or view.get('duration') or 0),
            'subtitles': [],
        })
    if not pages and view.get('cid'):
        pages.append({
            'page': 1,
            'cid': int(view.get('cid')),
            'title': view.get('title') or bvid,
            'duration': int(view.get('duration') or 0),
            'subtitles': [],
        })
    for page in pages:
        try:
            page['subtitles'] = get_subtitle_list('%s:%s' % (bvid, page['cid']))
        except BilibiliError:
            page['subtitles'] = []
    subtitles = pages[0].get('subtitles') if pages else []
    return {
        'source': 'bilibili',
        'bvid': bvid,
        'aid': int(view.get('aid') or 0),
        'title': view.get('title') or bvid,
        'artist': ((view.get('owner') or {}).get('name') or 'Bilibili'),
        'cover': view.get('pic') or '',
        'duration': int(view.get('duration') or 0),
        'pages': pages,
        'subtitles': subtitles,
    }


def get_video_view(bvid):
    if not SAFE_BVID_RE.match(bvid or ''):
        raise BilibiliError('bad-id', '无效的 BV 号', retryable=False)
    cached = bilibili._view_cache.get(bvid)
    if cached and time.monotonic() - cached[1] < 600:
        return cached[0]
    data = bilibili.request_json(BILI_API_BASE + '/x/web-interface/view', {'bvid': bvid})
    view = data.get('data') or {}
    if not view:
        raise BilibiliError('not-found', '没有找到这个 B站视频', retryable=False)
    bilibili._view_cache[bvid] = (view, time.monotonic())
    return view


def get_song_detail(track_id):
    bvid, cid = _parse_track_id(track_id)
    view = get_video_view(bvid)
    page = _find_page(view, cid)
    return {
        'id': '%s:%s' % (bvid, cid),
        'bvid': bvid,
        'cid': cid,
        'name': (page.get('part') if page else None) or view.get('title') or bvid,
        'artist': ((view.get('owner') or {}).get('name') or 'Bilibili'),
        'cover': view.get('pic') or '',
        'duration': int((page or {}).get('duration') or view.get('duration') or 0),
        'source': 'bilibili',
    }


def get_cover_url(track_id):
    return get_song_detail(track_id).get('cover') or ''


def get_song_url(track_id, level='standard'):
    bvid, cid = _parse_track_id(track_id)
    view = get_video_view(bvid)
    aid = int(view.get('aid') or 0)
    params = {
        'bvid': bvid,
        'cid': cid,
        'fnval': 16,
        'fourk': 1,
    }
    if aid:
        params['avid'] = aid
    try:
        signed = bilibili.signed_params(params)
        data = bilibili.request_json(BILI_API_BASE + '/x/player/wbi/playurl', signed)
    except BilibiliError:
        data = bilibili.request_json(BILI_API_BASE + '/x/player/playurl', params)
    payload = data.get('data') or {}
    dash = payload.get('dash') or {}
    if level == 'video':
        item = _pick_video_stream(dash.get('video') or [])
        if not item:
            return None
        url = item.get('baseUrl') or item.get('base_url')
        return _media_url_info(url, item, 'video', 'video')
    item = _pick_audio_stream(dash.get('audio') or [])
    if item:
        url = item.get('baseUrl') or item.get('base_url')
        return _media_url_info(url, item, 'standard', 'audio')
    durl = payload.get('durl') or []
    if durl and durl[0].get('url'):
        return {
            'url': durl[0].get('url'),
            'level': 'standard',
            'requested_level': level or 'standard',
            'trial': False,
            'type': 'audio',
            'br': 0,
            'size': int(durl[0].get('size') or 0),
        }
    return None


def get_subtitle_list(track_id):
    bvid, cid = _parse_track_id(track_id)
    cache_key = '%s:%s' % (bvid, cid)
    cached = bilibili._subtitle_cache.get(cache_key)
    if cached and time.monotonic() - cached[1] < 600:
        return cached[0]
    params = {'bvid': bvid, 'cid': cid}
    try:
        view = get_video_view(bvid)
        aid = int(view.get('aid') or 0)
        if aid:
            params['aid'] = aid
    except BilibiliError:
        pass
    subtitle_payload = None
    attempts = []
    try:
        attempts.append((BILI_API_BASE + '/x/player/wbi/v2', bilibili.signed_params(params)))
    except BilibiliError:
        pass
    attempts.append((BILI_API_BASE + '/x/player/v2', params))
    if params.get('aid'):
        attempts.append((BILI_API_BASE + '/x/v2/dm/view', {
            'aid': params['aid'],
            'oid': cid,
            'type': 1,
        }))
    last_error = None
    for api_url, api_params in attempts:
        try:
            data = bilibili.request_json(api_url, api_params)
        except BilibiliError as e:
            last_error = e
            continue
        subtitle_payload = ((data.get('data') or {}).get('subtitle') or {})
        if subtitle_payload.get('subtitles'):
            break
    if subtitle_payload is None:
        if last_error:
            raise last_error
        subtitle_payload = {}
    subtitles = subtitle_payload.get('subtitles') or []
    result = []
    for item in subtitles:
        url = _normalize_bili_url(item.get('subtitle_url') or '')
        track_key = _subtitle_track_key(item, url, len(result))
        result.append({
            'id': str(item.get('id') or ''),
            'trackKey': track_key,
            'key': track_key,
            'lan': item.get('lan') or '',
            'label': item.get('lan_doc') or item.get('lan') or '字幕',
            'url': url,
        })
    bilibili._subtitle_cache[cache_key] = (result, time.monotonic())
    return result


def get_lyrics(track_id, duration=None, subtitle_id=None):
    subtitles = get_subtitle_list(track_id)
    if not subtitles:
        return {'mode': 'line', 'lines': []}
    subtitle_id = str(subtitle_id or '').strip()
    subtitle = None
    if subtitle_id:
        subtitle = next((item for item in subtitles if _subtitle_matches(item, subtitle_id)), None)
    if not subtitle:
        subtitle = subtitles[0]
    data = bilibili.fetch_json_url(subtitle.get('url') or '')
    lines = []
    for item in data.get('body') or []:
        try:
            start = float(item.get('from') or 0)
            end = float(item.get('to') or start + 2)
        except (TypeError, ValueError):
            continue
        text = str(item.get('content') or '').strip()
        if not text:
            continue
        lines.append({
            'start': start,
            'end': end,
            'text': text,
            'translation': '',
            'words': [{'text': text, 'start': start, 'end': end}],
        })
    if duration and lines and lines[-1]['end'] < duration:
        lines[-1]['end'] = float(duration)
    return {'mode': 'line', 'lines': lines}


def _normalize_bili_url(url):
    url = (url or '').strip()
    if url.startswith('//'):
        return 'https:' + url
    if url.startswith('/'):
        return 'https://i0.hdslb.com' + url
    return url


def _subtitle_track_key(item, url, index):
    stable_id = str(item.get('id_str') or item.get('id') or '').strip()
    if stable_id:
        text = stable_id
    else:
        parsed = urllib.parse.urlparse(url or '')
        raw = [
            str(item.get('lan') or ''),
            str(item.get('lan_doc') or ''),
            parsed.path or '',
            'subtitle-%d' % (index + 1),
        ]
        text = '|'.join(part for part in raw if part)
    return hashlib.sha1(text.encode('utf-8')).hexdigest()[:16]


def _subtitle_matches(item, requested):
    requested = str(requested or '').strip()
    if not requested:
        return False
    candidates = {
        str(item.get('trackKey') or ''),
        str(item.get('key') or ''),
        str(item.get('id') or ''),
        str(item.get('lan') or ''),
        str(item.get('label') or ''),
        str(item.get('url') or ''),
    }
    return requested in candidates


def _media_url_info(url, item, requested_level, media_type):
    if not url:
        return None
    mime = item.get('mimeType') or item.get('mime_type') or ''
    return {
        'url': url,
        'level': requested_level,
        'requested_level': requested_level,
        'trial': False,
        'type': media_type,
        'mime': mime,
        'br': int(item.get('bandwidth') or 0),
        'size': 0,
    }


def _pick_audio_stream(items):
    if not items:
        return None
    return sorted(items, key=lambda item: int(item.get('bandwidth') or 0), reverse=True)[0]


def _pick_video_stream(items):
    if not items:
        return None
    return sorted(items, key=lambda item: (int(item.get('width') or 0) * int(item.get('height') or 0), int(item.get('bandwidth') or 0)), reverse=True)[0]


def _find_page(view, cid):
    for page in view.get('pages') or []:
        if int(page.get('cid') or 0) == int(cid):
            return page
    return None


def _resolve_bvid(user_input):
    value = (user_input or '').strip()
    match = BVID_FIND_RE.search(value)
    if match:
        return match.group(0)
    parsed = urllib.parse.urlparse(value)
    if parsed.scheme not in ('http', 'https') or not _allowed_input_host(parsed.hostname):
        raise BilibiliError('bad-input', '请输入 BV 号或 B站链接', retryable=False)
    if parsed.hostname == 'b23.tv':
        value = _resolve_short_url(value)
        match = BVID_FIND_RE.search(value)
        if match:
            return match.group(0)
    raise BilibiliError('bad-input', '没有从链接中找到 BV 号', retryable=False)


def _resolve_short_url(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'})
    try:
        with urllib.request.urlopen(req, timeout=READ_TIMEOUT) as resp:
            final_url = resp.geturl()
    except urllib.error.URLError as e:
        raise BilibiliError('upstream-network', '短链解析失败: %s' % getattr(e, 'reason', e), retryable=True)
    parsed = urllib.parse.urlparse(final_url)
    if not _allowed_input_host(parsed.hostname):
        raise BilibiliError('bad-input', '短链跳转到了非 B站域名', retryable=False)
    return final_url


def _parse_track_id(track_id):
    match = SAFE_TRACK_RE.match(track_id or '')
    if not match:
        raise BilibiliError('bad-id', '无效的 B站 track id', retryable=False)
    return match.group(1), int(match.group(2))


def _allowed_input_host(host):
    host = (host or '').lower()
    return host in ALLOWED_INPUT_HOSTS or host.endswith('.bilibili.com')


def _allowed_bili_media_host(host):
    host = (host or '').lower()
    return (
        host.endswith('.bilibili.com')
        or host.endswith('.bilivideo.com')
        or host.endswith('.bilivideo.cn')
        or host.endswith('.hdslb.com')
        or host.endswith('.biliimg.com')
        or host.endswith('.szbdyd.com')
        or host.endswith('.ourdvsss.com')
        or host.endswith('.akamaized.net')
        or host.endswith('.bilivideo.com.cn')
        or host in ('bilibili.com', 'bilivideo.com', 'bilivideo.cn', 'hdslb.com', 'i0.hdslb.com')
    )


def _key_from_url(url):
    path = urllib.parse.urlparse(url).path
    name = path.rsplit('/', 1)[-1]
    return name.split('.', 1)[0]


def _mixin_key(raw):
    return ''.join(raw[i] for i in MIXIN_KEY_ENC_TAB if i < len(raw))[:32]
