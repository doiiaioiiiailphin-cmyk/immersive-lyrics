# -*- coding: utf-8 -*-
"""QQ Music provider.

This module uses QQ Music web endpoints directly. QQ does not provide a stable
public playback API, so playback URL acquisition is best-effort and returns a
clear unavailable reason when vkey is denied.
"""
import base64
import binascii
import concurrent.futures
import copy
import hashlib
import http.cookiejar
import json
import os
import random
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from http.cookies import SimpleCookie
from .qq_mqtt import QQLoginMqttSession, QQMqttError


QQ_BASE = 'https://y.qq.com'
QQ_U_BASE = 'https://u.y.qq.com'
QQ_API_URL = 'https://u.y.qq.com/cgi-bin/musics.fcg'
READ_TIMEOUT = 15
QQ_LYRIC_TIMEOUT = 6
QQ_QRC_FAST_WAIT = 1.2
QQ_LRC_WAIT = 5.5
DATA_DIR = os.environ.get('PLAYER_DATA_DIR') or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data')
QQ_AUTH_COOKIE = 'qq_auth'
QQ_AUTH_CHUNK_COOKIE = 'qq_auth_'
QQ_AUTH_CHUNK_SIZE = 3000
QQ_AUTH_MAX_CHUNKS = 16
SAFE_MID_RE = re.compile(r'^[A-Za-z0-9_-]{4,80}$')
DETAIL_CACHE_TTL = 60 * 60
LYRICS_CACHE_TTL = 60 * 60
SONG_URL_CACHE_TTL = 180
SIGN_PART_1_INDEXES = (23, 14, 6, 36, 16, 40, 7, 19)
SIGN_PART_2_INDEXES = (16, 1, 32, 12, 19, 27, 8, 5)
SIGN_SCRAMBLE_VALUES = (
    89, 39, 179, 150, 218, 82, 58, 252, 177, 52,
    186, 123, 120, 64, 242, 133, 143, 161, 121, 179,
)
_detail_cache = {}
_detail_cache_lock = threading.Lock()
_lyrics_cache = {}
_lyrics_cache_lock = threading.Lock()
_lyrics_translation_pending = {}
_lyrics_executor = concurrent.futures.ThreadPoolExecutor(max_workers=4, thread_name_prefix='qqlyrics')
_song_url_cache = {}
_song_url_cache_lock = threading.Lock()
_QQ_TRANS_LINE_RE = re.compile(r'^\[(\d{1,2}):(\d{2})[.:](\d{1,3})\](.*)$')


class QQMusicError(Exception):
    def __init__(self, code, message, retryable=False):
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


class QQMusicSession:
    def __init__(self):
        self._lock = threading.Lock()
        self.cookiejar = http.cookiejar.CookieJar()
        self.nickname = None
        self._valid_cache = None
        self._valid_cache_ttl = 30
        self._qr_sessions = {}
        self.guid = _make_guid()
        self.music_id = 0
        self.music_key = ''
        self.refresh_token = ''
        self.refresh_key = ''
        self.login_type = 0
        self.expires_at = None

    # ---------- browser cookie persistence ----------
    def _store_cookie_string(self, cookie_text):
        if not cookie_text:
            return
        parsed = SimpleCookie()
        try:
            parsed.load(cookie_text)
        except Exception as e:
            print('[qq] 解析 cookie 失败: %s' % e)
            return
        for morsel in parsed.values():
            domain = morsel['domain'] or '.qq.com'
            path = morsel['path'] or '/'
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
                expires=None,
                discard=True,
                comment=None,
                comment_url=None,
                rest={},
                rfc2109=False,
            ))

    def _cookie_pairs(self):
        pairs = []
        for c in self.cookiejar:
            if c.value:
                pairs.append('%s=%s' % (c.name, c.value))
        return pairs

    def load_from_browser_cookie(self, cookie_header):
        if not cookie_header or (QQ_AUTH_COOKIE not in cookie_header and QQ_AUTH_CHUNK_COOKIE not in cookie_header):
            return
        cookies = {}
        for part in cookie_header.split(';'):
            part = part.strip()
            if '=' not in part:
                continue
            k, v = part.split('=', 1)
            cookies[k.strip()] = v.strip()
        value = cookies.get(QQ_AUTH_COOKIE, '')
        if not value:
            chunks = []
            idx = 0
            while True:
                name = QQ_AUTH_CHUNK_COOKIE + str(idx)
                if name not in cookies:
                    break
                chunks.append(cookies[name])
                idx += 1
            value = ''.join(chunks)
        if not value:
            return
        try:
            padding = '=' * (-len(value) % 4)
            decoded = base64.urlsafe_b64decode((value + padding).encode('ascii')).decode('utf-8')
        except Exception as e:
            print('[qq] 浏览器 cookie 解析失败: %s' % e)
            return
        with self._lock:
            self.cookiejar.clear()
            try:
                payload = json.loads(decoded)
            except (ValueError, json.JSONDecodeError):
                payload = {'cookies': decoded}
            self._store_cookie_string(payload.get('cookies') or '')
            token = payload.get('token') or {}
            self.music_id = int(token.get('music_id') or 0)
            self.music_key = str(token.get('music_key') or '')
            self.refresh_token = str(token.get('refresh_token') or '')
            self.refresh_key = str(token.get('refresh_key') or '')
            self.login_type = int(token.get('login_type') or 0)
            self.expires_at = token.get('expires_at')
            self._valid_cache = None

    def browser_cookie_headers(self, max_age=60 * 60 * 24 * 30):
        raw = json.dumps({
            'cookies': '; '.join(self._cookie_pairs()),
            'token': {
                'music_id': self.music_id,
                'music_key': self.music_key,
                'refresh_token': self.refresh_token,
                'refresh_key': self.refresh_key,
                'login_type': self.login_type,
                'expires_at': self.expires_at,
            },
        }, ensure_ascii=False, separators=(',', ':'))
        value = base64.urlsafe_b64encode(raw.encode('utf-8')).decode('ascii').rstrip('=')
        headers = ['%s=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' % QQ_AUTH_COOKIE]
        chunks = [value[i:i + QQ_AUTH_CHUNK_SIZE] for i in range(0, len(value), QQ_AUTH_CHUNK_SIZE)] or ['']
        for idx, chunk in enumerate(chunks):
            headers.append('%s%d=%s; Path=/; HttpOnly; SameSite=Strict; Max-Age=%d' % (
                QQ_AUTH_CHUNK_COOKIE, idx, chunk, max_age))
        for idx in range(len(chunks), QQ_AUTH_MAX_CHUNKS):
            headers.append('%s%d=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' % (
                QQ_AUTH_CHUNK_COOKIE, idx))
        return headers

    def clear_browser_cookie_headers(self):
        headers = ['%s=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' % QQ_AUTH_COOKIE]
        for idx in range(QQ_AUTH_MAX_CHUNKS):
            headers.append('%s%d=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' % (
                QQ_AUTH_CHUNK_COOKIE, idx))
        return headers

    def clear(self):
        with self._lock:
            self.cookiejar.clear()
            self.nickname = None
            self.music_id = 0
            self.music_key = ''
            self.refresh_token = ''
            self.refresh_key = ''
            self.login_type = 0
            self.expires_at = None
            for session in self._qr_sessions.values():
                mqtt = session.get('mqtt')
                if mqtt:
                    mqtt.close()
            self._qr_sessions.clear()
            self._valid_cache = (False, time.monotonic())

    # ---------- requests ----------
    def _opener(self):
        return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookiejar))

    def request_json(self, url, method='GET', params=None, data=None, headers=None, timeout=READ_TIMEOUT):
        if params:
            url += ('&' if '?' in url else '?') + urllib.parse.urlencode(params)
        body = None
        req_headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://y.qq.com/',
            'Origin': 'https://y.qq.com',
        }
        if headers:
            req_headers.update(headers)
        if data is not None:
            body = json.dumps(data, ensure_ascii=False).encode('utf-8')
            req_headers['Content-Type'] = 'application/json'
        try:
            resp = self._opener().open(urllib.request.Request(url, data=body, headers=req_headers, method=method), timeout=timeout)
            raw = resp.read()
            text = raw.decode('utf-8', 'replace').strip()
            if text.startswith('callback(') and text.endswith(')'):
                text = text[9:-1]
            return json.loads(text)
        except urllib.error.URLError as e:
            if 'timeout' in str(e).lower():
                raise QQMusicError('upstream-timeout', 'QQ音乐请求超时', retryable=True)
            raise QQMusicError('upstream-network', 'QQ音乐网络错误: %s' % getattr(e, 'reason', e), retryable=True)
        except (ValueError, json.JSONDecodeError) as e:
            raise QQMusicError('upstream-parse', 'QQ音乐响应解析失败: %s' % e, retryable=True)

    def gateway_request(self, body, use_login=True):
        body = dict(body or {})
        comm = {
            'ct': 19,
            'cv': 2201,
            'chid': '0',
            'guid': self.guid,
        }
        if use_login and self.music_id and self.music_key:
            comm.update({
                'uin': str(self.music_id),
                'g_tk': _hash33(self.music_key),
            })
        custom_comm = body.get('comm')
        if isinstance(custom_comm, dict):
            comm.update(custom_comm)
        body['comm'] = comm
        payload = json.dumps(body, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        url = QQ_API_URL + '?sign=' + urllib.parse.quote(_qq_sign(body))
        headers = {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; WOW64; Trident/5.0)',
            'Referer': 'https://y.qq.com/',
        }
        if use_login and self.music_id and self.music_key:
            headers['Cookie'] = self._login_cookie()
        try:
            response = urllib.request.urlopen(
                urllib.request.Request(url, data=payload, headers=headers, method='POST'),
                timeout=READ_TIMEOUT,
            )
            return json.loads(response.read().decode('utf-8', 'replace'))
        except urllib.error.URLError as e:
            if 'timeout' in str(e).lower():
                raise QQMusicError('upstream-timeout', 'QQ音乐请求超时', retryable=True)
            raise QQMusicError(
                'upstream-network',
                'QQ音乐网络错误: %s' % getattr(e, 'reason', e),
                retryable=True,
            )
        except (ValueError, json.JSONDecodeError) as e:
            raise QQMusicError('upstream-parse', 'QQ音乐响应解析失败: %s' % e, retryable=True)

    def _login_cookie(self):
        return 'uin=%s; qqmusic_key=%s; qm_keyst=%s; tmeLoginType=%s' % (
            self.music_id,
            self.music_key,
            self.music_key,
            self.login_type or 6,
        )

    def _set_login_token(self, data):
        self.music_id = int(data.get('musicid') or 0)
        self.music_key = str(data.get('musickey') or '')
        self.refresh_token = str(data.get('refresh_token') or '')
        self.refresh_key = str(data.get('refresh_key') or '')
        self.login_type = int(data.get('loginType') or data.get('login_type') or 6)
        expires_at = int(data.get('expired_at') or 0)
        key_expires = int(data.get('keyExpiresIn') or 0)
        created_at = int(data.get('musickeyCreateTime') or 0)
        if expires_at > 0:
            self.expires_at = expires_at
        elif key_expires > 0:
            self.expires_at = (created_at or int(time.time())) + key_expires
        else:
            self.expires_at = None
        if not self.music_id or not self.music_key:
            raise QQMusicError('login-failed', 'QQ音乐登录响应缺少必要凭证')
        self._store_cookie_string(self._login_cookie())
        self._valid_cache = (True, time.monotonic())

    def _refresh_login_token(self):
        if not (self.music_id and self.music_key and self.refresh_token and self.refresh_key):
            return False
        response = self.gateway_request({
            'result': {
                'module': 'music.login.LoginServer',
                'method': 'Login',
                'param': {
                    'refresh_key': self.refresh_key,
                    'refresh_token': self.refresh_token,
                    'musickey': self.music_key,
                    'musicid': self.music_id,
                },
            },
            'comm': {'tmeLoginType': self.login_type or 6},
        })
        data = ((response.get('result') or {}).get('data') or {})
        if not data.get('musickey'):
            return False
        self._set_login_token(data)
        return True

    # ---------- auth ----------
    def is_valid(self, force=False):
        now = time.monotonic()
        if not force and self._valid_cache:
            valid, ts = self._valid_cache
            if now - ts < self._valid_cache_ttl:
                return valid
        valid = self.has_login_cookie()
        if valid and self.expires_at and self.expires_at <= int(time.time()) + 60:
            try:
                valid = self._refresh_login_token()
            except QQMusicError:
                valid = False
        self._valid_cache = (valid, now)
        return valid

    def has_login_cookie(self):
        if self.music_id and self.music_key:
            return True
        names = {c.name for c in self.cookiejar if c.value}
        return bool(names.intersection({'uin', 'qm_keyst', 'qqmusic_key', 'p_uin', 'wxuin'}))

    def create_qr(self, login_type='qq'):
        login_type = login_type if login_type in ('qq', 'wechat') else 'qq'
        if login_type == 'wechat':
            return self._create_wechat_placeholder_qr()
        return self._create_qq_qr()

    def _create_qq_qr(self):
        response = self.gateway_request({
            'result': {
                'module': 'music.login.LoginServer',
                'method': 'CreateQRCode',
                'param': {
                    'tmeAppID': 'qqmusic',
                    'ct': 19,
                    'cv': 2201,
                },
            },
        }, use_login=False)
        result = response.get('result') or {}
        data = result.get('data') or {}
        qrcode = data.get('qrcode') or ''
        qrcode_id = data.get('qrcodeID') or ''
        if not qrcode or not qrcode_id:
            raise QQMusicError(
                'qr-create-failed',
                data.get('errMsg') or result.get('msg') or 'QQ音乐未返回登录二维码',
                retryable=True,
            )
        key = 'qq:' + qrcode_id
        self._qr_sessions[key] = {
            'type': 'qq',
            'qrcode_id': qrcode_id,
            'created': time.monotonic(),
            'expires_in': int(data.get('expiresIn') or 900),
            'mqtt': QQLoginMqttSession(qrcode_id),
            'lock': threading.Lock(),
        }
        return {
            'unikey': key,
            'qrcode_b64': _format_qrcode_image(qrcode),
            'poll_interval': 1500,
            'login_type': 'qq',
        }

    def _login_with_mobile_ticket(self, qrcode_id, music_id, music_key):
        response = self.gateway_request({
            'result': {
                'module': 'music.login.LoginServer',
                'method': 'Login',
                'param': {
                    'musicid': int(music_id),
                    'qrCodeID': qrcode_id,
                    'token': music_key,
                },
            },
            'comm': {'tmeLoginType': 6},
        }, use_login=False)
        result = response.get('result') or {}
        data = result.get('data') or {}
        if not data.get('musickey'):
            raise QQMusicError(
                'login-failed',
                data.get('errMsg') or result.get('msg') or 'QQ音乐登录失败',
                retryable=True,
            )
        self._set_login_token(data)
        return {
            'code': 803,
            'message': '登录成功',
            'nickname': self.nickname,
        }

    def _create_wechat_placeholder_qr(self):
        # QQ Music's WeChat QR flow is frequently changed and often requires
        # browser-only anti-abuse scripts. Keep the UI route but report clearly
        # during polling instead of pretending to authenticate.
        key = 'wechat:' + str(int(time.time() * 1000))
        self._qr_sessions[key] = {'type': 'wechat', 'created': time.monotonic()}
        content = 'https://y.qq.com/'
        return {
            'unikey': key,
            'qrcode_b64': _make_qrcode_base64(content),
            'poll_interval': 1800,
            'login_type': 'wechat',
        }

    def check_qr(self, key):
        session = self._qr_sessions.get(key)
        if not session:
            return {'code': 800, 'message': '二维码已过期'}
        if session.get('type') == 'wechat':
            return {'code': 800, 'message': '微信扫码登录暂不可用，请先使用 QQ 扫码'}
        if time.monotonic() - session.get('created', 0) > session.get('expires_in', 900):
            mqtt = session.get('mqtt')
            if mqtt:
                mqtt.close()
            self._qr_sessions.pop(key, None)
            return {'code': 800, 'message': '二维码已过期'}
        mqtt = session.get('mqtt')
        if not mqtt:
            return {'code': 800, 'message': 'QQ扫码会话已失效'}
        try:
            with session['lock']:
                event = mqtt.poll()
        except QQMqttError as e:
            raise QQMusicError('upstream-network', str(e), retryable=True)
        state = event.get('state')
        if state == 'scanned':
            return {'code': 802, 'message': '已扫码，等待手机确认'}
        if state in ('expired', 'canceled'):
            self._qr_sessions.pop(key, None)
            return {'code': 800, 'message': '二维码已过期' if state == 'expired' else '登录已取消'}
        if state == 'failed':
            self._qr_sessions.pop(key, None)
            return {'code': 800, 'message': 'QQ音乐登录失败，请刷新二维码重试'}
        if state == 'cookies':
            try:
                result = self._login_with_mobile_ticket(
                    session.get('qrcode_id', ''),
                    event.get('music_id'),
                    event.get('music_key'),
                )
            finally:
                self._qr_sessions.pop(key, None)
            return result
        return {'code': 801, 'message': '等待扫码'}


def search_songs(keyword, page=1, limit=30):
    data = qq.gateway_request({
        'result': {
            'method': 'DoSearchForQQMusicDesktop',
            'module': 'music.search.SearchCgiService',
            'param': {
                'grp': 0,
                'num_per_page': limit,
                'page_num': page,
                'query': keyword,
                'search_type': 0,
                'searchid': _search_id(),
            },
        },
    })
    result = data.get('result') or {}
    body = (result.get('data') or {}).get('body') or {}
    if data.get('code') != 0 or result.get('code') not in (0, None):
        raise QQMusicError(
            'search-failed',
            'QQ音乐搜索失败: code=%s/%s' % (data.get('code'), result.get('code')),
        )
    items = ((body.get('song') or {}).get('list') or [])
    return [_simplify_song(item) for item in items]


def get_song_detail(songmid):
    if not _safe_mid(songmid):
        raise QQMusicError('bad-song-id', '无效的 QQ 音乐 ID')
    cache_key = str(songmid)
    with _detail_cache_lock:
        cached = _detail_cache.get(cache_key)
        if cached and time.monotonic() - cached[0] < DETAIL_CACHE_TTL:
            return copy.deepcopy(cached[1])
    data = qq.request_json(QQ_U_BASE + '/cgi-bin/musicu.fcg', method='POST', data={
        'comm': {'ct': 24, 'cv': 0, 'format': 'json'},
        'songinfo': {
            'module': 'music.pf_song_detail_svr',
            'method': 'get_song_detail_yqq',
            'param': {'song_mid': songmid},
        },
    })
    track = (((data.get('songinfo') or {}).get('data') or {}).get('track_info') or {})
    if not track:
        raise QQMusicError('not-found', 'QQ 音乐歌曲不存在', retryable=False)
    detail = _simplify_song(track)
    with _detail_cache_lock:
        _detail_cache[cache_key] = (time.monotonic(), copy.deepcopy(detail))
    return detail


def get_cover_url(songmid):
    try:
        detail = get_song_detail(songmid)
        return detail.get('cover') or ''
    except QQMusicError:
        return ''


def get_lyrics(songmid, duration=None, numeric_id=None):
    if not _safe_mid(songmid):
        raise QQMusicError('bad-song-id', '无效的 QQ 音乐 ID')
    cache_key = (str(songmid), round(float(duration or 0), 1))
    with _lyrics_cache_lock:
        cached = _lyrics_cache.get(cache_key)
        if cached and time.monotonic() - cached[0] < LYRICS_CACHE_TTL:
            return copy.deepcopy(cached[1])
    song_id = str(numeric_id or '').strip()
    if song_id and not re.match(r'^\d{1,20}$', song_id):
        song_id = ''
    qrc_future = None
    if not song_id:
        song_id_future = _lyrics_executor.submit(_get_song_numeric_id, songmid)
        _cache_qrc_after_song_id(cache_key, song_id_future, duration)
    else:
        qrc_future = _lyrics_executor.submit(_get_qrc_lyrics, song_id, '', duration, QQ_LYRIC_TIMEOUT)
        done, _ = concurrent.futures.wait([qrc_future], timeout=QQ_QRC_FAST_WAIT)
        if done:
            qrc = _future_result(qrc_future)
            if qrc and qrc.get('lines'):
                _cache_lyrics(cache_key, qrc)
                return qrc

    lrc_future = _lyrics_executor.submit(_get_lrc_lyrics, songmid, duration, QQ_LYRIC_TIMEOUT)
    done, _ = concurrent.futures.wait([lrc_future], timeout=QQ_LRC_WAIT)
    if done:
        parsed = _future_result(lrc_future)
        if parsed is not None:
            _cache_lyrics(cache_key, parsed)
            if qrc_future:
                _cache_qrc_when_ready(cache_key, qrc_future)
            return parsed

    if qrc_future:
        qrc = _future_result(qrc_future)
        if qrc and qrc.get('lines'):
            _cache_lyrics(cache_key, qrc)
            return qrc

    _cache_qrc_when_ready(cache_key, qrc_future)
    if lrc_future.done():
        parsed = _future_result(lrc_future) or {'mode': 'none', 'lines': []}
        _cache_lyrics(cache_key, parsed)
    else:
        _cache_lrc_when_ready(cache_key, lrc_future)
        parsed = {'mode': 'none', 'lines': []}
    return parsed


def _get_lrc_lyrics(songmid, duration=None, timeout=QQ_LYRIC_TIMEOUT):
    data = qq.request_json('https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg', params={
        'songmid': songmid,
        'format': 'json',
        'nobase64': 1,
        'g_tk': 5381,
    }, headers={'Referer': 'https://y.qq.com/portal/player.html'}, timeout=timeout)
    lyric = data.get('lyric') or ''
    trans = data.get('trans') or ''
    if data.get('retcode') not in (0, None) and not lyric:
        return {'mode': 'none', 'lines': []}
    from .lyrics_parser import parse_netease_lyrics
    return parse_netease_lyrics(lyric, '', trans, duration=duration)


def _cache_lyrics(cache_key, parsed):
    payload = copy.deepcopy(parsed)
    if payload and payload.get('lines'):
        with _lyrics_cache_lock:
            pending = _lyrics_translation_pending.pop(cache_key, None)
        if pending:
            merged = _merge_translation_text(payload, pending[1])
            if merged:
                payload = merged
    with _lyrics_cache_lock:
        _lyrics_cache[cache_key] = (time.monotonic(), copy.deepcopy(payload))


def _future_result(future):
    if not future:
        return None
    try:
        return future.result(timeout=0)
    except concurrent.futures.TimeoutError:
        return None
    except Exception as e:
        print('[qq] lyric worker fallback: %s' % e)
        return None


def _cache_qrc_when_ready(cache_key, future):
    if not future:
        return
    if future.done():
        _cache_qrc_result(cache_key, _future_result(future))
        return

    def on_done(done_future):
        _cache_qrc_result(cache_key, _future_result(done_future))

    future.add_done_callback(on_done)


def _cache_lrc_when_ready(cache_key, future):
    if not future:
        return

    def on_done(done_future):
        parsed = _future_result(done_future)
        if parsed is not None:
            _cache_lyrics(cache_key, parsed)

    future.add_done_callback(on_done)


def _cache_qrc_after_song_id(cache_key, future, duration=None):
    if not future:
        return

    def on_done(done_future):
        song_id = str(_future_result(done_future) or '').strip()
        if not song_id:
            return
        qrc = _get_qrc_lyrics(song_id, duration=duration, timeout=QQ_LYRIC_TIMEOUT)
        _cache_qrc_result(cache_key, qrc)

    future.add_done_callback(lambda done_future: _lyrics_executor.submit(on_done, done_future))


def get_song_url(songmid, level='standard'):
    if not _safe_mid(songmid):
        raise QQMusicError('bad-song-id', '无效的 QQ 音乐 ID')
    cache_key = (str(qq.music_id or ''), str(songmid), level or 'standard')
    with _song_url_cache_lock:
        cached = _song_url_cache.get(cache_key)
        if cached and time.monotonic() - cached[0] < SONG_URL_CACHE_TTL:
            return copy.deepcopy(cached[1])
    if level in ('jyeffect', 'sky', 'dolby', 'hires', 'lossless'):
        filenames = [
            'F000%s%s.flac' % (songmid, songmid),
            'M800%s%s.mp3' % (songmid, songmid),
            'M500%s%s.mp3' % (songmid, songmid),
        ]
    elif level in ('exhigh', 'higher'):
        filenames = [
            'M800%s%s.mp3' % (songmid, songmid),
            'M500%s%s.mp3' % (songmid, songmid),
        ]
    else:
        filenames = ['M500%s%s.mp3' % (songmid, songmid)]
    filenames.append('RS02%s.mp3' % songmid)
    song_types = [0] * len(filenames)
    song_types[-1] = 1
    data = qq.gateway_request({
        'result': {
            'module': 'music.vkey.GetVkey',
            'method': 'UrlGetVkey',
            'param': {
                'uin': str(qq.music_id or ''),
                'songmid': [songmid] * len(filenames),
                'songtype': song_types,
                'guid': qq.guid,
                'filename': filenames,
                'ctx': 0,
            },
        },
    })
    payload = ((data.get('result') or {}).get('data') or {})
    sip = payload.get('sip') or ['https://isure.stream.qqmusic.qq.com/']
    for item in payload.get('midurlinfo') or []:
        purl = item.get('purl') or item.get('wifiurl') or item.get('flowurl')
        if purl:
            base = sip[0] if sip else ''
            result = {
                'url': purl if purl.startswith('http') else base + purl,
                'level': level or 'standard',
                'requested_level': level or 'standard',
                'trial': str(item.get('filename') or '').startswith('RS02'),
                'type': item.get('filename', '').rsplit('.', 1)[-1] or 'audio',
                'br': 0,
                'size': 0,
            }
            with _song_url_cache_lock:
                _song_url_cache[cache_key] = (time.monotonic(), copy.deepcopy(result))
            return result
    return None


def _simplify_song(raw):
    mid = raw.get('songmid') or raw.get('mid') or raw.get('strMediaMid') or raw.get('media_mid')
    album = raw.get('album') or {}
    albummid = raw.get('albummid') or album.get('mid') or raw.get('albumMid') or ''
    singers = raw.get('singer') or raw.get('singers') or []
    if isinstance(singers, list):
        artist = ' / '.join((s.get('name') or s.get('title') or '') for s in singers if isinstance(s, dict))
    else:
        artist = ''
    pay = raw.get('pay') or {}
    play_locked = bool(pay.get('payplay') or pay.get('pay_play'))
    return {
        'id': str(mid or ''),
        'songmid': str(mid or ''),
        'qqSongId': raw.get('id') or raw.get('songid') or raw.get('songId') or '',
        'name': raw.get('songname') or raw.get('name') or raw.get('title') or '',
        'artist': artist,
        'album': raw.get('albumname') or album.get('name') or '',
        'cover': _cover_url(albummid),
        'duration': raw.get('interval') or raw.get('duration') or 0,
        'source': 'qq',
        'vip': {
            'required': play_locked,
            'label': 'VIP' if play_locked else '',
            'reason': '你尚未开启QQ音乐VIP' if play_locked else '',
        },
        'quality': {'label': ''},
    }


def _get_song_numeric_id(songmid):
    try:
        detail = get_song_detail(songmid)
        value = detail.get('qqSongId')
        return str(value) if value else ''
    except QQMusicError:
        return ''


def _get_qrc_lyrics(song_id, trans_text='', duration=None, timeout=QQ_LYRIC_TIMEOUT):
    try:
        data = _download_qrc_payloads(song_id, timeout=timeout)
        payload = data.get('content') or b''
        if not payload:
            return None
        from .qq_qrc import parse_qrc
        qrc_text = _decode_qrc_payload_text(payload)
        if not trans_text and data.get('translation'):
            trans_text = _decode_qrc_payload_text(data.get('translation') or b'')
        parsed = parse_qrc(qrc_text, trans_text=trans_text, duration=duration)
        if parsed.get('mode') == 'word' and parsed.get('lines') and _qrc_looks_complete(parsed, duration):
            return parsed
        if trans_text:
            return {'mode': 'translation', 'lines': [], '_translation_text': trans_text}
    except Exception as e:
        print('[qq] QRC lyric fallback: %s' % e)
    return None


def _qrc_looks_complete(parsed, duration=None):
    lines = parsed.get('lines') or []
    if not lines:
        return False
    try:
        duration_value = float(duration or 0)
    except (TypeError, ValueError):
        duration_value = 0
    if duration_value > 60:
        last_end = float(lines[-1].get('end') or lines[-1].get('start') or 0)
        if len(lines) < 3 or last_end < min(duration_value * 0.45, duration_value - 30):
            return False
    return True


def _cache_qrc_result(cache_key, qrc):
    if not qrc:
        return
    if qrc.get('mode') == 'word' and qrc.get('lines'):
        _cache_lyrics(cache_key, qrc)
        return
    trans_text = qrc.get('_translation_text') or ''
    if not trans_text:
        return
    with _lyrics_cache_lock:
        cached = _lyrics_cache.get(cache_key)
        parsed = copy.deepcopy(cached[1]) if cached else None
        if not parsed:
            now = time.monotonic()
            _lyrics_translation_pending[cache_key] = (now, trans_text)
            for key, (created, _) in list(_lyrics_translation_pending.items()):
                if now - created > 60:
                    _lyrics_translation_pending.pop(key, None)
    merged = _merge_translation_text(parsed, trans_text)
    if merged:
        _cache_lyrics(cache_key, merged)


def _merge_translation_text(parsed, trans_text):
    if not parsed or not parsed.get('lines'):
        return None
    translations = _parse_qq_translation_text(trans_text)
    if not translations:
        return None
    merged = copy.deepcopy(parsed)
    changed = False
    for line in merged.get('lines') or []:
        if line.get('translation'):
            continue
        text = _match_qq_translation(translations, line.get('start'))
        if text:
            line['translation'] = text
            changed = True
    return merged if changed else None


def _parse_qq_translation_text(text):
    result = []
    for raw in str(text or '').replace('\r', '').split('\n'):
        match = _QQ_TRANS_LINE_RE.match(raw.strip())
        if not match:
            continue
        body = (match.group(4) or '').strip()
        if not body or body == '//':
            continue
        frac = match.group(3)
        millis = int(frac[:3].ljust(3, '0'))
        start = int(match.group(1)) * 60 + int(match.group(2)) + millis / 1000
        result.append((round(start, 3), body))
    return result


def _match_qq_translation(translations, start):
    try:
        start = float(start)
    except (TypeError, ValueError):
        return ''
    best_text = ''
    best_delta = 0.75
    for trans_start, text in translations:
        delta = abs(trans_start - start)
        if delta <= best_delta:
            best_delta = delta
            best_text = text
    return best_text


def _decode_qrc_payload_text(payload):
    if not payload:
        return ''
    from .qq_qrc import decode_qrc_payload, extract_qrc_text
    decoded = decode_qrc_payload(payload)
    text = extract_qrc_text(decoded)
    if text:
        return text
    try:
        return extract_qrc_text(bytes(payload).decode('utf-8', 'replace'))
    except Exception:
        return ''


def _download_qrc_payloads(song_id, timeout=QQ_LYRIC_TIMEOUT):
    url = 'https://c.y.qq.com/qqmusic/fcgi-bin/lyric_download.fcg?' + urllib.parse.urlencode({
        'version': '15',
        'miniversion': '82',
        'lrctype': '4',
        'musicid': str(song_id),
    })
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://y.qq.com/',
    }
    raw = qq._opener().open(urllib.request.Request(url, headers=headers, method='GET'), timeout=timeout).read()
    text = raw.decode('utf-8', 'replace').replace('<!--', '').replace('-->', '').strip()
    def pick(name):
        match = re.search(
            r'<%s\b[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</%s>' % (name, name),
            text,
            re.S,
        )
        if not match or not match.group(1).strip():
            return b''
        value = match.group(1).strip()
        compact = ''.join(value.split())
        if len(compact) % 2 == 0 and re.fullmatch(r'[0-9A-Fa-f]+', compact or ''):
            return binascii.unhexlify(compact.encode('ascii'))
        return value.encode('utf-8', 'replace')

    return {
        'content': pick('content'),
        'translation': pick('contentts'),
        'romanization': pick('contentroma'),
    }


def _cover_url(albummid):
    if not albummid:
        return ''
    return 'https://y.qq.com/music/photo_new/T002R300x300M000%s.jpg?max_age=2592000' % urllib.parse.quote(str(albummid))


def _safe_mid(songmid):
    return bool(songmid and SAFE_MID_RE.match(str(songmid)))



def _format_qrcode_image(value):
    value = str(value or '').strip()
    if value.startswith('data:image/'):
        return value
    compact = ''.join(value.split())
    if re.match(r'^[A-Za-z0-9+/]+={0,2}$', compact or ''):
        try:
            raw = base64.b64decode(compact, validate=True)
            if raw.startswith(b'\x89PNG') or raw.startswith(b'\xff\xd8'):
                mime = 'image/png' if raw.startswith(b'\x89PNG') else 'image/jpeg'
                return 'data:%s;base64,%s' % (mime, compact)
        except Exception:
            pass
    return _make_qrcode_base64(value)


def _make_guid():
    chars = 'ABCDEF1234567890'
    return ''.join(random.choice(chars) for _ in range(32))


def _hash33(value):
    result = 5381
    for char in value or '':
        result = ((result * 33) + ord(char)) & 0x7fffffff
    return result


def _search_id():
    day_millis = 24 * 60 * 60 * 1000
    e = random.randint(1, 20)
    n = random.randint(0, 4194304)
    now = int(time.time() * 1000) % day_millis
    return str(e * 18014398509481984 + n * 4294967296 + now)


def _qq_sign(body):
    payload = json.dumps(body, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    digest = hashlib.sha1(payload).hexdigest().upper()
    part1 = ''.join(digest[i] for i in SIGN_PART_1_INDEXES if i < len(digest))
    part2 = ''.join(digest[i] for i in SIGN_PART_2_INDEXES)
    scrambled = bytes(
        SIGN_SCRAMBLE_VALUES[i] ^ int(digest[i * 2:i * 2 + 2], 16)
        for i in range(20)
    )
    encoded = base64.b64encode(scrambled).decode('ascii')
    encoded = ''.join(char for char in encoded if char not in '/\\+=')
    return ('zzc' + part1 + encoded + part2).lower()


def _qq_uin():
    if qq.music_id:
        return str(qq.music_id)
    for c in qq.cookiejar:
        if c.name in ('uin', 'p_uin') and c.value:
            return c.value.lstrip('o')
    return '0'


def _make_qrcode_base64(content):
    import io
    import qrcode
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


qq = QQMusicSession()
