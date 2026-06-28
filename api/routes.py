# -*- coding: utf-8 -*-
"""API 路由注册。

本模块注册所有 /api/* 路由。每个路由处理函数:
    参数: handler (http.server 请求处理器), match (前缀匹配时的剩余路径)
    职责: 解析参数 → 调用业务逻辑 → 用 send_json/ok/error 响应
    异常: raise ApiError 或 NetEaseError（后者由 _handle_api 捕获转 502）

注意: 媒体路由（stream/cover）的 auth_kind='media'，不要求 token。
"""
import cgi
import json
import os
import re
import time
import urllib.parse
from .router import register, ok, error, send_json, ApiError
from .middleware import sec
from .rate_limit import qr_poll_min_interval, search_limiter
from .netease_client import netease, NetEaseError
from .netease_client import get_lyrics, search_songs, get_song_detail, get_song_url
from .qq_client import qq, QQMusicError
from .qq_client import get_lyrics as qq_get_lyrics
from .qq_client import search_songs as qq_search_songs
from .qq_client import get_song_detail as qq_get_song_detail
from .qq_client import get_song_url as qq_get_song_url
from .qq_client import get_cover_url as qq_get_cover_url
from .bilibili_client import bilibili, BilibiliError
from .bilibili_client import resolve_video as bilibili_resolve_video
from .bilibili_client import get_lyrics as bilibili_get_lyrics
from .bilibili_client import get_song_detail as bilibili_get_song_detail
from .bilibili_client import get_song_url as bilibili_get_song_url
from .bilibili_client import get_cover_url as bilibili_get_cover_url
from .bilibili_local import start_local_import as bilibili_start_local_import
from .bilibili_local import get_import_job as bilibili_get_import_job
from .bilibili_local import local_media_path as bilibili_local_media_path
from .bilibili_local import get_local_lyrics as bilibili_get_local_lyrics
from .bilibili_local import delete_local_media as bilibili_delete_local_media
from .offline_cache import cache_track as offline_cache_track
from .offline_cache import local_audio_path as offline_local_audio_path
from .offline_cache import local_media_path as offline_local_media_path
from .offline_cache import delete_cached_media as offline_delete_cached_media
from .offline_cache import OfflineCacheError
from .browser_cookie_reader import import_bilibili_cookies_from_browser
from .cover_proxy import proxy_cover
from .rate_limit import search_limiter
from .stream_proxy import proxy_stream, prewarm_stream, wait_for_prewarm


def _read_json_body(handler):
    """读取并解析 POST body 为 dict。body 为空返回 {}。"""
    length = int(handler.headers.get('Content-Length', 0) or 0)
    if length == 0:
        return {}
    if length > 65536:
        raise ApiError('BAD_REQUEST', '请求体过大')
    raw = handler.rfile.read(length)
    try:
        return json.loads(raw.decode('utf-8'))
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise ApiError('BAD_REQUEST', '请求体不是有效 JSON')



def _read_multipart_form(handler):
    content_type = handler.headers.get('Content-Type') or ''
    if 'multipart/form-data' not in content_type:
        raise ApiError('BAD_REQUEST', '请求必须是 multipart/form-data')
    length = int(handler.headers.get('Content-Length', 0) or 0)
    if length > 8 * 1024 * 1024:
        raise ApiError('BAD_REQUEST', '上传文件过大')
    form = cgi.FieldStorage(
        fp=handler.rfile,
        headers=handler.headers,
        environ={'REQUEST_METHOD': 'POST', 'CONTENT_TYPE': content_type, 'CONTENT_LENGTH': str(length)},
        keep_blank_values=True,
    )
    fields = {}
    files = {}
    for key in form.keys():
        item = form[key]
        if isinstance(item, list):
            item = item[0]
        if getattr(item, 'filename', None):
            data = item.file.read()
            if key == 'subtitle_file' and len(data) > 1024 * 1024:
                raise ApiError('BAD_REQUEST', '字幕最大 1MB')
            if key == 'cover_file' and len(data) > 5 * 1024 * 1024:
                raise ApiError('BAD_REQUEST', '封面最大 5MB')
            files[key] = {'filename': item.filename or '', 'content_type': item.type or '', 'data': data}
        else:
            fields[key] = str(item.value or '')
    return fields, files


def _send_local_media_file(handler, path, mime, ranged=False):
    size = os.path.getsize(path)
    range_header = handler.headers.get('Range') if ranged else ''
    start = 0
    end = size - 1
    status = 200
    if range_header:
        match = re.match(r'^bytes=(\d*)-(\d*)$', range_header.strip())
        if not match:
            handler.send_response(416)
            handler.send_header('Content-Range', 'bytes */%d' % size)
            handler.end_headers()
            return
        left, right = match.groups()
        if left == '' and right == '':
            handler.send_response(416)
            handler.send_header('Content-Range', 'bytes */%d' % size)
            handler.end_headers()
            return
        if left == '':
            length = min(int(right), size)
            start = max(0, size - length)
        else:
            start = int(left)
            if right:
                end = min(size - 1, int(right))
        if start >= size or start > end:
            handler.send_response(416)
            handler.send_header('Content-Range', 'bytes */%d' % size)
            handler.end_headers()
            return
        status = 206
    length = max(0, end - start + 1)
    handler.send_response(status)
    handler.send_header('Content-Type', mime or 'application/octet-stream')
    handler.send_header('Content-Length', str(length))
    handler.send_header('Cache-Control', 'public, max-age=86400')
    handler.send_header('X-Content-Type-Options', 'nosniff')
    if ranged:
        handler.send_header('Accept-Ranges', 'bytes')
    if status == 206:
        handler.send_header('Content-Range', 'bytes %d-%d/%d' % (start, end, size))
    handler.end_headers()
    with open(path, 'rb') as fh:
        fh.seek(start)
        remaining = length
        while remaining > 0:
            chunk = fh.read(min(256 * 1024, remaining))
            if not chunk:
                break
            try:
                handler.wfile.write(chunk)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                handler.close_connection = True
                break
            remaining -= len(chunk)


def _handle_netease_error(handler, e):
    """把 NetEaseError 转成统一 API 错误响应。"""
    if e.code == 'upstream-timeout':
        send_json(handler, error('UPSTREAM_TIMEOUT', e.args[0] if e.args else '上游超时', True), status=504)
    elif e.code in ('upstream-network', 'upstream-parse'):
        send_json(handler, error('UPSTREAM_ERROR', e.args[0] if e.args else '上游异常', True), status=502)
    else:
        send_json(handler, error('UPSTREAM_ERROR', str(e), e.retryable), status=502)


def _handle_provider_error(handler, e):
    if isinstance(e, NetEaseError):
        _handle_netease_error(handler, e)
        return
    if isinstance(e, QQMusicError):
        if e.code == 'upstream-timeout':
            send_json(handler, error('UPSTREAM_TIMEOUT', e.message, True), status=504)
        elif e.code in ('upstream-network', 'upstream-parse'):
            send_json(handler, error('UPSTREAM_ERROR', e.message, e.retryable), status=502)
        else:
            send_json(handler, error('UPSTREAM_ERROR', e.message, e.retryable), status=502)
        return
    if isinstance(e, BilibiliError):
        if e.code in ('bad-input', 'bad-id', 'bad-url', 'bad-cookie', 'cookie-not-found'):
            send_json(handler, error('BAD_REQUEST', e.message, False), status=400)
        elif e.code == 'not-found':
            send_json(handler, error('NOT_FOUND', e.message, False), status=404)
        elif e.code == 'upstream-denied':
            send_json(handler, error('UPSTREAM_ERROR', e.message, False), status=403)
        elif e.code == 'upstream-timeout':
            send_json(handler, error('UPSTREAM_TIMEOUT', e.message, True), status=504)
        elif e.code in ('upstream-network', 'upstream-parse'):
            send_json(handler, error('UPSTREAM_ERROR', e.message, e.retryable), status=502)
        else:
            send_json(handler, error('UPSTREAM_ERROR', e.message, e.retryable), status=502)
        return
    raise e


def _handle_offline_cache_error(handler, e):
    if e.code == 'BAD_REQUEST':
        send_json(handler, error('BAD_REQUEST', e.message, e.retryable), status=400)
    elif e.code == 'NOT_FOUND':
        send_json(handler, error('NOT_FOUND', e.message, e.retryable), status=404)
    elif e.code == 'UPSTREAM_TIMEOUT' or e.code == 'upstream-timeout':
        send_json(handler, error('UPSTREAM_TIMEOUT', e.message, True), status=504)
    elif e.code == 'NO_PERMISSION':
        send_json(handler, error('FORBIDDEN', e.message, False), status=403)
    else:
        send_json(handler, error('UPSTREAM_ERROR', e.message, e.retryable), status=502)


def _provider_from_query(query):
    provider = (query.get('provider') or 'netease').strip().lower()
    if provider not in ('netease', 'qq', 'bilibili'):
        raise ApiError('BAD_REQUEST', 'provider 只能是 netease、qq 或 bilibili')
    return provider


def _provider_name(provider):
    if provider == 'qq':
        return 'QQ音乐'
    if provider == 'bilibili':
        return '哔哩哔哩'
    return '网易云音乐'


def _provider_client(provider):
    if provider == 'qq':
        return qq
    if provider == 'bilibili':
        return bilibili
    return netease


# ============================================================
# 登录态
# ============================================================
@register('GET', '/api/status', 'api')
def api_status(handler, match):
    """检查登录态。30s 缓存，?force=1 强制重新验证。"""
    query = urllib_query(handler)
    provider = _provider_from_query(query)
    force = query.get('force') == '1'
    try:
        client = _provider_client(provider)
        valid = client.is_valid(force=force)
    except (NetEaseError, QQMusicError, BilibiliError) as e:
        _handle_provider_error(handler, e)
        return
    send_json(handler, ok({
        'logged_in': valid,
        'nickname': client.nickname if valid else None,
        'provider': provider,
    }))


@register('POST', '/api/logout', 'api')
def api_logout(handler, match):
    """退出登录：清空 cookiejar + 删持久化文件。"""
    query = urllib_query(handler)
    provider = _provider_from_query(query)
    client = _provider_client(provider)
    client.clear()
    send_json(handler, ok({'logged_in': False, 'provider': provider}),
              extra_headers=[('Set-Cookie', h) for h in client.clear_browser_cookie_headers()])


# ============================================================
# 二维码登录
# ============================================================
@register('POST', '/api/qr/create', 'api')
def api_qr_create(handler, match):
    """生成扫码登录二维码。"""
    query = urllib_query(handler)
    provider = _provider_from_query(query)
    if provider == 'bilibili':
        raise ApiError('BAD_REQUEST', 'B站 v1 使用 Cookie 导入登录，不支持扫码')
    login_type = query.get('login_type', 'qq')
    try:
        result = qq.create_qr(login_type=login_type) if provider == 'qq' else netease.create_qr()
    except (NetEaseError, QQMusicError) as e:
        _handle_provider_error(handler, e)
        return
    send_json(handler, ok({
        'unikey': result['unikey'],
        'qrcode_b64': result['qrcode_b64'],
        # 提示前端轮询间隔
        'poll_interval': result.get('poll_interval', 1500),
        'provider': provider,
        'login_type': result.get('login_type', login_type),
    }))


@register('GET', '/api/qr/check', 'api')
def api_qr_check(handler, match):
    """轮询扫码状态。强制最低 1.5s 间隔。"""
    query = urllib_query(handler)
    provider = _provider_from_query(query)
    if provider == 'bilibili':
        raise ApiError('BAD_REQUEST', 'B站 v1 使用 Cookie 导入登录，不支持扫码')
    key = query.get('key', '').strip()
    if not key:
        raise ApiError('BAD_REQUEST', '缺少 key 参数')

    # 限流：强制最小轮询间隔
    qr_poll_min_interval.acquire()

    try:
        result = qq.check_qr(key) if provider == 'qq' else netease.check_qr(key)
    except (NetEaseError, QQMusicError) as e:
        _handle_provider_error(handler, e)
        return

    payload = {
        'code': result['code'],
        'message': result['message'],
    }
    if 'nickname' in result:
        payload['nickname'] = result['nickname']
    payload['provider'] = provider
    headers = None
    if result.get('code') == 803:
        client = _provider_client(provider)
        headers = [('Set-Cookie', h) for h in client.browser_cookie_headers()]
    send_json(handler, ok(payload), extra_headers=headers)


@register('POST', '/api/bilibili/login', 'api')
def api_bilibili_login(handler, match):
    """导入 B站 Cookie，作为可选登录态。"""
    body = _read_json_body(handler)
    cookie_text = (body.get('cookie') or '').strip()
    if not cookie_text:
        raise ApiError('BAD_REQUEST', '缺少 B站 Cookie')
    try:
        bilibili.import_cookie_text(cookie_text)
        valid = bilibili.is_valid(force=True)
    except BilibiliError as e:
        _handle_provider_error(handler, e)
        return
    headers = [('Set-Cookie', h) for h in bilibili.browser_cookie_headers()]
    if not valid:
        bilibili.clear()
        headers = [('Set-Cookie', h) for h in bilibili.clear_browser_cookie_headers()]
    send_json(handler, ok({
        'logged_in': valid,
        'nickname': bilibili.nickname if valid else None,
        'provider': 'bilibili',
    }), extra_headers=headers)



@register('POST', '/api/bilibili/cookie/import-local', 'api')
def api_bilibili_import_local_cookie(handler, match):
    try:
        imported = import_bilibili_cookies_from_browser()
        bilibili.import_cookie_text(imported.get('cookie_text') or '')
        valid = bilibili.is_valid(force=True)
    except BilibiliError as e:
        _handle_provider_error(handler, e)
        return
    send_json(handler, ok({
        'logged_in': valid,
        'nickname': bilibili.nickname if valid else None,
        'provider': 'bilibili',
        'source': imported.get('source'),
        'count': imported.get('count'),
        'names': imported.get('names') or [],
    }), extra_headers=[('Set-Cookie', h) for h in bilibili.browser_cookie_headers()])


@register('POST', '/api/bilibili/import', 'api')
def api_bilibili_import(handler, match):
    try:
        fields, files = _read_multipart_form(handler)
        user_input = (fields.get('input') or fields.get('url') or fields.get('bvid') or '').strip()
        if not user_input:
            raise ApiError('BAD_REQUEST', '缺少 B 站 BV 号或链接')
        if len(user_input) > 500:
            raise ApiError('BAD_REQUEST', 'B 站链接过长')
        cid = (fields.get('cid') or '').strip() or None
        download_video = (fields.get('background_video') or fields.get('download_video') or '').lower() in ('1', 'true', 'yes', 'on')
        subtitle_source = (fields.get('subtitle_source') or 'video').strip().lower()
        subtitle_id = (fields.get('subtitle_track') or fields.get('subtitle_id') or '').strip() or None
        job = bilibili_start_local_import(
            user_input,
            cid=cid,
            download_video=download_video,
            subtitle_source=subtitle_source,
            subtitle_id=subtitle_id,
            subtitle_upload=files.get('subtitle_file'),
            cover_upload=files.get('cover_file'),
        )
    except BilibiliError as e:
        _handle_provider_error(handler, e)
        return
    send_json(handler, ok(job))


@register('GET', '/api/bilibili/import/*', 'api')
def api_bilibili_import_status(handler, match):
    job_id = _route_id(match)
    if not re.match(r'^[0-9a-f]{32}$', job_id or ''):
        raise ApiError('BAD_REQUEST', '无效的 jobId')
    try:
        job = bilibili_get_import_job(job_id)
    except BilibiliError as e:
        _handle_provider_error(handler, e)
        return
    send_json(handler, ok(job))


@register('DELETE', '/api/bilibili/media/*', 'api')
def api_bilibili_delete_media(handler, match):
    media_id = _route_id(match).strip('/').split('/', 1)[0]
    try:
        result = bilibili_delete_local_media(media_id)
    except BilibiliError as e:
        _handle_provider_error(handler, e)
        return
    send_json(handler, ok(result))


@register('GET', '/api/bilibili/media/*', 'media')
def api_bilibili_media(handler, match):
    parts = _route_id(match).strip('/').split('/', 1)
    if len(parts) != 2:
        from .router import error, send_json
        send_json(handler, error('BAD_REQUEST', '无效的本地媒体路径', False), status=400)
        return
    media_id, kind = parts[0], parts[1].split('/', 1)[0]
    try:
        path, mime = bilibili_local_media_path(media_id, kind)
    except BilibiliError as e:
        _handle_provider_error(handler, e)
        return
    _send_local_media_file(handler, path, mime, ranged=kind in ('audio', 'video'))


@register('POST', '/api/cache-track', 'api')
def api_cache_track(handler, match):
    body = _read_json_body(handler)
    provider = (body.get('provider') or 'netease').strip().lower()
    if provider != 'bilibili':
        _require_login(provider)
    song_id = str(body.get('id') or body.get('songId') or '').strip()
    level = (body.get('level') or 'standard').strip()
    try:
        result = offline_cache_track(
            provider,
            song_id,
            level=level,
            title=body.get('title') or '',
            artist=body.get('artist') or '',
            duration=body.get('duration'),
            qq_song_id=body.get('qqSongId') or body.get('song_id'),
            cover_url=body.get('cover') or '',
        )
    except OfflineCacheError as e:
        _handle_offline_cache_error(handler, e)
        return
    send_json(handler, ok(result))


@register('GET', '/api/cache/audio/*', 'media')
def api_cache_audio(handler, match):
    media_id = _route_id(match).strip('/').split('/', 1)[0]
    try:
        path, mime = offline_local_audio_path(media_id)
    except OfflineCacheError as e:
        _handle_offline_cache_error(handler, e)
        return
    _send_local_media_file(handler, path, mime, ranged=True)


@register('GET', '/api/cache/media/*', 'media')
def api_cache_media(handler, match):
    parts = _route_id(match).strip('/').split('/', 1)
    if len(parts) != 2:
        send_json(handler, error('BAD_REQUEST', '无效缓存媒体路径', False), status=400)
        return
    media_id, kind = parts[0], parts[1].split('/', 1)[0]
    try:
        path, mime = offline_local_media_path(media_id, kind)
    except OfflineCacheError as e:
        _handle_offline_cache_error(handler, e)
        return
    _send_local_media_file(handler, path, mime, ranged=kind == 'audio')


@register('DELETE', '/api/cache/media/*', 'api')
def api_cache_delete(handler, match):
    media_id = _route_id(match).strip('/').split('/', 1)[0]
    try:
        result = offline_delete_cached_media(media_id)
    except OfflineCacheError as e:
        _handle_offline_cache_error(handler, e)
        return
    send_json(handler, ok(result))


@register('GET', '/api/bilibili/resolve', 'api')
def api_bilibili_resolve(handler, match):
    """按 BV/链接解析 B站视频元数据。无需登录，登录 Cookie 可提高可用性。"""
    query = urllib_query(handler)
    user_input = (query.get('input') or query.get('url') or query.get('bvid') or '').strip()
    if not user_input:
        raise ApiError('BAD_REQUEST', '缺少 B站 BV 号或链接')
    if len(user_input) > 500:
        raise ApiError('BAD_REQUEST', 'B站链接过长')
    try:
        result = bilibili_resolve_video(user_input)
    except BilibiliError as e:
        _handle_provider_error(handler, e)
        return
    if result.get('cover') and result.get('pages'):
        remember_cover_url('%s:%s' % (result.get('bvid'), result['pages'][0].get('cid')), result.get('cover'), provider='bilibili')
    send_json(handler, ok(result))


# ============================================================
# 工具
# ============================================================
def urllib_query(handler):
    """解析请求 URL query 为 dict。"""
    path = handler.path
    if '?' not in path:
        return {}
    qs = path.split('?', 1)[1]
    import urllib.parse
    return dict(urllib.parse.parse_qsl(qs))


def _require_login(provider='netease'):
    """检查指定 provider 登录态，未登录抛 ApiError(401)。"""
    if provider == 'bilibili':
        return
    client = _provider_client(provider)
    if not client.is_valid():
        raise ApiError('LOGIN_REQUIRED', '请先登录%s' % _provider_name(provider), retryable=False)


def _safe_song_id(provider, song_id):
    if provider == 'qq':
        if not re.match(r'^[A-Za-z0-9_-]{4,80}$', song_id or ''):
            raise ApiError('BAD_REQUEST', '无效的 QQ 音乐 ID')
    elif provider == 'bilibili':
        if not re.match(r'^BV[0-9A-Za-z]{10}:[0-9]{1,20}$', song_id or ''):
            raise ApiError('BAD_REQUEST', '无效的 B站 track id')
    else:
        if not song_id or not song_id.isdigit():
            raise ApiError('BAD_REQUEST', '无效的歌曲 ID')


def _route_id(match):
    return urllib.parse.unquote((match or '').lstrip('/'))


# ============================================================
# 歌词
# ============================================================
@register('GET', '/api/lyrics/*', 'api')
def api_lyrics(handler, match):
    """获取歌词。yrc 优先，降级 lrc，返回 {mode, lines} 结构。

    match: 前缀匹配，剩余路径是 songId。
    """
    query = urllib_query(handler)
    provider = _provider_from_query(query)
    if provider != 'qq':
        _require_login(provider)
    song_id = _route_id(match)
    _safe_song_id(provider, song_id)

    # 歌曲时长（用于最后一行结束时间），可选
    duration = None
    if query.get('duration'):
        try:
            duration = float(query['duration'])
        except ValueError:
            pass

    try:
        if provider == 'qq':
            result = qq_get_lyrics(song_id, duration=duration, numeric_id=query.get('song_id'))
        elif provider == 'bilibili':
            result = bilibili_get_lyrics(song_id, duration=duration)
        else:
            result = get_lyrics(song_id, duration=duration)
    except (NetEaseError, QQMusicError, BilibiliError) as e:
        _handle_provider_error(handler, e)
        return

    send_json(handler, ok(result))


# ============================================================
# 搜索
# ============================================================
@register('GET', '/api/search', 'api')
def api_search(handler, match):
    """搜索歌曲。后端限流 + 前端防抖。"""
    query = urllib_query(handler)
    provider = _provider_from_query(query)
    if provider == 'bilibili':
        raise ApiError('BAD_REQUEST', 'B站 v1 请使用导入链接，不支持站内搜索')
    _require_login(provider)
    q = (query.get('q') or query.get('kw') or '').strip()
    if not q:
        raise ApiError('BAD_REQUEST', '缺少搜索关键词')
    if len(q) > 100:
        raise ApiError('BAD_REQUEST', '关键词过长')

    # 限流
    if search_limiter.deny():
        raise ApiError('RATE_LIMITED', '搜索过于频繁，请稍后再试', retryable=True)

    try:
        page = int(query.get('page', '1'))
        limit = int(query.get('limit', '30'))
    except ValueError:
        raise ApiError('BAD_REQUEST', 'page/limit 必须是数字')
    page = max(1, min(page, 50))
    limit = max(1, min(limit, 50))

    try:
        songs = qq_search_songs(q, page=page, limit=limit) if provider == 'qq' else search_songs(q, page=page, limit=limit)
    except (NetEaseError, QQMusicError) as e:
        _handle_provider_error(handler, e)
        return
    for song in songs:
        remember_cover_url(song.get('id'), song.get('cover'), provider=provider)

    send_json(handler, ok({'songs': songs, 'page': page, 'provider': provider}))


# ============================================================
# 歌曲详情
# ============================================================
@register('GET', '/api/song/*', 'api')
def api_song_detail(handler, match):
    """获取单首歌详情（封面URL/时长/歌手）。"""
    query = urllib_query(handler)
    provider = _provider_from_query(query)
    _require_login(provider)
    song_id = _route_id(match)
    _safe_song_id(provider, song_id)

    try:
        if provider == 'qq':
            detail = qq_get_song_detail(song_id)
        elif provider == 'bilibili':
            detail = bilibili_get_song_detail(song_id)
        else:
            detail = get_song_detail(song_id)
    except (NetEaseError, QQMusicError, BilibiliError) as e:
        _handle_provider_error(handler, e)
        return

    send_json(handler, ok(detail))


@register('GET', '/api/song-url/*', 'api')
def api_song_url(handler, match):
    """Check whether a song has a playable URL without proxying audio bytes."""
    query = urllib_query(handler)
    provider = _provider_from_query(query)
    _require_login(provider)
    song_id = _route_id(match)
    _safe_song_id(provider, song_id)

    level = query.get('level', 'standard')
    try:
        if provider == 'qq':
            url_info = qq_get_song_url(song_id, level=level)
        elif provider == 'bilibili':
            url_info = bilibili_get_song_url(song_id, level=level)
        else:
            url_info = get_song_url(song_id, level=level)
    except (NetEaseError, QQMusicError, BilibiliError) as e:
        _handle_provider_error(handler, e)
        return

    if not url_info:
        send_json(handler, ok({
            'playable': False,
            'reason': '当前账号无法获取该歌曲播放地址（可能无版权、会员权限不足或地区限制）',
            'provider': provider,
        }))
        return
    if query.get('wait') == '1':
        prewarmed = wait_for_prewarm(song_id, level=level, provider=provider, timeout=5)
    else:
        prewarm_stream(song_id, level=level, provider=provider)
        prewarmed = False

    send_json(handler, ok({
        'playable': True,
        'prewarmed': prewarmed,
        'provider': provider,
        'level': url_info.get('level'),
        'requested_level': url_info.get('requested_level'),
        'trial': bool(url_info.get('trial')),
        'type': url_info.get('type'),
        'br': url_info.get('br'),
        'size': url_info.get('size'),
    }))


# ============================================================
# 封面代理（media 路由：仅 Cookie+Sec-Fetch-Site，不要求 token）
# ============================================================
# 封面 URL 缓存：songId -> cover_url（避免每次代理都查详情）
_cover_url_cache = {}


@register('GET', '/api/cover/*', 'media')
def api_cover(handler, match):
    """代理封面图片。防 Canvas 污染 + 防 SSRF。

    match: 剩余路径是 songId。通过歌曲详情拿封面 URL 再代理。
    封面 URL 公开，不需要登录态。
    """
    query = urllib_query(handler)
    provider = _provider_from_query(query)
    song_id = _route_id(match)
    try:
        _safe_song_id(provider, song_id)
    except ApiError:
        from .cover_proxy import _send_placeholder
        _send_placeholder(handler)
        return

    # 优先用缓存的 URL
    cache_key = provider + ':' + song_id
    cover_url = _cover_url_cache.get(cache_key)
    if not cover_url:
        try:
            if provider == 'qq':
                cover_url = qq_get_cover_url(song_id)
            elif provider == 'bilibili':
                cover_url = bilibili_get_cover_url(song_id)
            else:
                detail = get_song_detail(song_id)
                cover_url = detail.get('cover')
            if cover_url:
                _cover_url_cache[cache_key] = cover_url
        except Exception as e:
            print('[cover] 获取封面URL失败 %s: %s' % (song_id, e))

    if not cover_url:
        from .cover_proxy import _send_placeholder
        _send_placeholder(handler)
        return

    proxy_cover(cover_url, handler)


def remember_cover_url(song_id, cover_url, provider='netease'):
    """缓存歌曲的封面 URL（搜索/添加歌曲时调用，避免代理时重复查详情）。"""
    if song_id and cover_url:
        _cover_url_cache[provider + ':' + str(song_id)] = cover_url


# ============================================================
# 音频流代理（media 路由：仅 Cookie+Sec-Fetch-Site）
# ============================================================
@register('GET', '/api/stream/*', 'media')
def api_stream(handler, match):
    """代理音频流。支持 Range（拖动进度条）、403 自动刷新、品质降级。

    不要求登录态校验（登录在获取 URL 时由 netease.request 处理），
    但需要网易云已登录才能拿到播放 URL。
    """
    song_id = _route_id(match)
    query = urllib_query(handler)
    provider = _provider_from_query(query)
    try:
        _safe_song_id(provider, song_id)
    except ApiError:
        from .cover_proxy import _send_placeholder
        _send_placeholder(handler)  # 复用占位响应机制（实际音频错误有自己的格式）
        return

    # level 参数（品质）
    level = query.get('level', 'exhigh')

    try:
        proxy_stream(handler, song_id, level=level, provider=provider)
    except Exception as e:
        # 兜底：不崩溃，返回错误
        import logging
        logging.exception('[stream] 未捕获异常: %s', song_id)
        from .router import error, send_json
        try:
            send_json(handler, error('INTERNAL', '音频流错误', True), status=500)
        except (BrokenPipeError, ConnectionResetError):
            handler.close_connection = True


@register('GET', '/api/bilibili/video-stream/*', 'media')
def api_bilibili_video_stream(handler, match):
    """代理 B站视频流，用作可选视觉背景。"""
    song_id = _route_id(match)
    try:
        _safe_song_id('bilibili', song_id)
    except ApiError:
        from .router import error, send_json
        send_json(handler, error('BAD_REQUEST', '无效的 B站 track id', False), status=400)
        return
    try:
        proxy_stream(handler, song_id, level='video', provider='bilibili')
    except Exception:
        import logging
        logging.exception('[bilibili-video] 未捕获异常: %s', song_id)
        from .router import error, send_json
        try:
            send_json(handler, error('INTERNAL', '视频流错误', True), status=500)
        except (BrokenPipeError, ConnectionResetError):
            handler.close_connection = True
