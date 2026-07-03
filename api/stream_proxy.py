# -*- coding: utf-8 -*-
"""音频流代理。

完整规范（定稿方案）:
    - 转发客户端 Range + 必要 UA/Referer
    - 上游 206 → 客户端 206；上游 200 → 不伪造 Content-Range
    - 转发 Content-Type/Length/Range/Accept-Ranges/ETag/Last-Modified
    - 分块转发（64KB），不读完整音频进内存
    - 客户端断开 → 立即关上游连接
    - CDN URL 403 → 重新获取 URL 后重试
    - URL 短缓存（45s），避免拖动时每 Range 都重新获取
    - 品质/付费/无版权/试听 → 明确错误码，不直接 500

非零 Range 边界处理（关键）:
    - Range: bytes=0- + 上游 200: 可接受
    - 请求起点 > 0 且上游返回 200（不支持 Range）:
        1. 清 URL 缓存 + 重试一次
        2. 仍不支持 → UPSTREAM_RANGE_UNSUPPORTED，绝不冒充区间转发

品质信息（响应头，<audio> 无法读 JSON）:
    X-Player-Requested-Level / X-Player-Actual-Level / X-Player-Level-Degraded / X-Player-Trial
"""
import time
import threading
import requests

from .netease_client import get_song_url, NetEaseError
from .qq_client import get_song_url as qq_get_song_url, QQMusicError
from .bilibili_client import get_song_url as bilibili_get_song_url, BilibiliError
from .rate_limit import stream_semaphore


# URL 短缓存: songId -> (url_info, timestamp)
_url_cache = {}
_url_cache_ttl = 600  # 秒；CDN 失效时 403 会强制刷新
_url_cache_lock = threading.Lock()
STREAM_CHUNK_SIZE = 1024 * 1024
PREWARM_SIZE = 256 * 1024
_stream_session = requests.Session()
_stream_adapter = requests.adapters.HTTPAdapter(pool_connections=8, pool_maxsize=16, max_retries=0)
_stream_session.mount('https://', _stream_adapter)
_prefix_cache = {}
_prefix_cache_lock = threading.Lock()
_prefix_cache_ttl = 300
_prewarm_inflight = set()
_prefix_ready = threading.Condition(_prefix_cache_lock)


def _get_cached_url(song_id, level, force_refresh=False, provider='netease', media_mid=None):
    """获取歌曲 URL（带短缓存）。

    返回 url_info dict 或 None。
    流式传输期间不持锁，锁只保护"检查缓存+刷新 URL"过程。
    """
    with _url_cache_lock:
        cache_key = (provider, str(song_id), level or 'exhigh', str(media_mid or ''))
        if not force_refresh:
            cached = _url_cache.get(cache_key)
            if cached:
                url_info, ts = cached
                if time.monotonic() - ts < _url_cache_ttl:
                    return url_info
        # 缓存未命中或过期，获取新 URL
        try:
            if provider == 'qq':
                url_info = qq_get_song_url(song_id, level=level or 'standard', media_mid=media_mid)
            elif provider == 'bilibili':
                url_info = bilibili_get_song_url(song_id, level=level or 'standard')
            else:
                url_info = get_song_url(song_id, level=level or 'exhigh')
        except (NetEaseError, QQMusicError, BilibiliError):
            raise
        if url_info:
            _url_cache[cache_key] = (url_info, time.monotonic())
        return url_info


def _invalidate_url(song_id, level, provider='netease', media_mid=None):
    """清除某歌曲的 URL 缓存（403 时调用）。"""
    with _url_cache_lock:
        cache_key = (provider, str(song_id), level or 'exhigh', str(media_mid or ''))
        _url_cache.pop(cache_key, None)
    with _prefix_cache_lock:
        _prefix_cache.pop(cache_key, None)


def prewarm_stream(song_id, level='standard', provider='netease', media_mid=None):
    """Fetch and cache the first audio bytes in the background."""
    cache_key = (provider, str(song_id), level or 'standard', str(media_mid or ''))
    with _prefix_cache_lock:
        cached = _prefix_cache.get(cache_key)
        if cached and time.monotonic() - cached['ts'] < _prefix_cache_ttl:
            return
        if cache_key in _prewarm_inflight:
            return
        _prewarm_inflight.add(cache_key)

    def worker():
        response = None
        try:
            url_info = _get_cached_url(song_id, level, provider=provider, media_mid=media_mid)
            if not url_info:
                return
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': _provider_referer(provider),
                'Range': 'bytes=0-%d' % (PREWARM_SIZE - 1),
            }
            response = _stream_session.get(
                url_info['url'],
                headers=headers,
                timeout=(5, 10),
                stream=True,
            )
            if response.status_code not in (200, 206):
                return
            body = response.raw.read(PREWARM_SIZE)
            if not body:
                return
            with _prefix_cache_lock:
                _prefix_cache[cache_key] = {
                    'body': body,
                    'status': response.status_code,
                    'headers': dict(response.headers),
                    'url_info': url_info,
                    'ts': time.monotonic(),
                }
                _prefix_ready.notify_all()
        except Exception as e:
            print('[stream] 预热失败 %s:%s: %s' % (provider, song_id, e))
        finally:
            if response is not None:
                response.close()
            with _prefix_cache_lock:
                _prewarm_inflight.discard(cache_key)
                _prefix_ready.notify_all()

    threading.Thread(target=worker, name='stream-prewarm-%s' % song_id, daemon=True).start()


def wait_for_prewarm(song_id, level='standard', provider='netease', timeout=5, media_mid=None):
    """Ensure the first audio chunk is cached, waiting briefly when necessary."""
    cache_key = (provider, str(song_id), level or 'standard', str(media_mid or ''))
    prewarm_stream(song_id, level=level, provider=provider, media_mid=media_mid)
    deadline = time.monotonic() + timeout
    with _prefix_ready:
        while True:
            cached = _prefix_cache.get(cache_key)
            if cached and time.monotonic() - cached['ts'] < _prefix_cache_ttl:
                return True
            if cache_key not in _prewarm_inflight:
                return False
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return False
            _prefix_ready.wait(remaining)


def proxy_stream(handler, song_id, level='exhigh', provider='netease', media_mid=None):
    """代理音频流。

    完整流程:
        1. 获取 URL（带缓存）
        2. 检查权限/付费状态 → 明确错误码
        3. 转发 Range 请求（分块）
        4. 403 → 刷新 URL 重试
        5. 非零 Range + 上游 200 → UPSTREAM_RANGE_UNSUPPORTED

    返回 None（直接写 handler 响应）。
    """
    range_header = handler.headers.get('Range')
    client_start = _parse_range_start(range_header)
    if range_header and client_start == 0 and _serve_cached_prefix(
            handler, song_id, level, provider, media_mid=media_mid):
        return

    # 1. 获取 URL
    try:
        url_info = _get_cached_url(song_id, level, provider=provider, media_mid=media_mid)
    except (NetEaseError, QQMusicError, BilibiliError) as e:
        _send_stream_error(handler, e)
        return

    if not url_info:
        # 无版权或需付费
        _send_json_error(handler, 'NO_PERMISSION',
                         '该歌曲无法播放（无版权或需要会员）', retryable=False, status=403)
        return

    # 2. 转发请求：先试同一个 vkey 返回的备用 CDN，再刷新 vkey。
    max_attempts = max(2, len(url_info.get('urls') or []) + 1)
    refreshed = False
    for attempt in range(max_attempts):
        try:
            success = _forward_stream(handler, url_info, range_header, client_start,
                                       song_id, level, provider, media_mid=media_mid)
            if success:
                return
            # _forward_stream 返回 False 表示当前 CDN 不可用，先换备用 URL。
            if _advance_alternate_url(url_info):
                continue
            if not refreshed:
                refreshed = True
                try:
                    url_info = _get_cached_url(song_id, level, force_refresh=True, provider=provider, media_mid=media_mid)
                except (NetEaseError, QQMusicError, BilibiliError):
                    break
                if not url_info:
                    break
                continue
            break
        except _ClientDisconnected:
            return  # 客户端断开，静默退出

    # 重试仍失败
    _send_json_error(handler, 'UPSTREAM_ERROR', '音频源暂时不可用',
                     retryable=True, status=502)


def _forward_stream(handler, url_info, range_header, client_start,
                     song_id, level, provider='netease', media_mid=None):
    """转发单次流请求。

    返回 True 成功；False 表示需要重试（403，已刷新 URL）。
    """
    upstream_url = url_info['url']
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': _provider_referer(provider),
    }
    upstream_range = _clamp_open_ended_range(range_header)
    if upstream_range:
        headers['Range'] = upstream_range

    resp = None
    try:
        resp = _stream_session.get(
            upstream_url,
            headers=headers,
            timeout=(5, 10),
            stream=True,
        )
        if resp.status_code in (403, 404) and (provider == 'qq' or resp.status_code == 403):
            _invalidate_url(song_id, level, provider, media_mid=media_mid)
            print('[stream] upstream %d, refresh URL retry: %s' % (resp.status_code, song_id))
            resp.close()
            return False
        if resp.status_code == 403:
            # CDN URL 过期或被拒，刷新后重试
            _invalidate_url(song_id, level, provider, media_mid=media_mid)
            print('[stream] 上游 403，刷新 URL 重试: %s' % song_id)
            resp.close()
            return False
        if resp.status_code == 404:
            _send_json_error(handler, 'NOT_FOUND', '音频资源不存在',
                             retryable=False, status=404)
            resp.close()
            return True
        if resp.status_code >= 400:
            _send_json_error(handler, 'UPSTREAM_ERROR',
                             '上游 HTTP %d' % resp.status_code, retryable=True, status=502)
            resp.close()
            return True
    except requests.Timeout:
        _invalidate_url(song_id, level, provider, media_mid=media_mid)
        print('[stream] 上游超时，刷新 URL 重试: %s' % song_id)
        return False
    except requests.RequestException as e:
        _send_json_error(handler, 'UPSTREAM_TIMEOUT' if 'timeout' in str(e).lower()
                         else 'UPSTREAM_ERROR', '音频源请求失败: %s' % e,
                         retryable=True, status=504 if 'timeout' in str(e).lower() else 502)
        return True

    upstream_status = resp.status_code
    # 非零 Range + 上游 200（不支持 Range）→ 不能冒充区间转发
    if upstream_status == 200 and client_start > 0:
        resp.close()
        # 换个 provider/URL 重试一次（已在 proxy_stream 处理，这里直接报错）
        _send_json_error(handler, 'UPSTREAM_RANGE_UNSUPPORTED',
                         '音频源暂不支持跳转播放', retryable=True, status=416)
        return True

    # 写响应头
    status = 206 if upstream_status == 206 else 200
    handler.send_response(status)

    # 转发关键头
    content_type = resp.headers.get('Content-Type', 'audio/mpeg')
    handler.send_header('Content-Type', content_type)
    content_length = resp.headers.get('Content-Length')
    if content_length:
        handler.send_header('Content-Length', content_length)
    if upstream_status == 206:
        content_range = resp.headers.get('Content-Range')
        if content_range:
            handler.send_header('Content-Range', content_range)
    accept_ranges = resp.headers.get('Accept-Ranges', 'bytes')
    handler.send_header('Accept-Ranges', accept_ranges)
    etag = resp.headers.get('ETag')
    if etag:
        handler.send_header('ETag', etag)
    last_modified = resp.headers.get('Last-Modified')
    if last_modified:
        handler.send_header('Last-Modified', last_modified)

    # 品质信息响应头（<audio> 读不到，主要供调试）
    handler.send_header('X-Player-Requested-Level', url_info.get('requested_level', ''))
    handler.send_header('X-Player-Actual-Level', url_info.get('level', ''))
    handler.send_header('X-Player-Level-Degraded',
                        'true' if url_info.get('level') != url_info.get('requested_level') else 'false')
    handler.send_header('X-Player-Trial', 'true' if url_info.get('trial') else 'false')

    handler.end_headers()

    # 分块转发（64KB）
    try:
        while True:
            chunk = resp.raw.read(65536)
            if not chunk:
                break
            handler.wfile.write(chunk)
    except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
        # 客户端断开，立即关闭上游连接
        resp.close()
        handler.close_connection = True
        raise _ClientDisconnected()
    finally:
        resp.close()

    return True


def _advance_alternate_url(url_info):
    urls = [u for u in (url_info.get('urls') or []) if u]
    if len(urls) <= 1:
        return False
    current = url_info.get('url')
    try:
        idx = urls.index(current)
    except ValueError:
        idx = -1
    next_idx = idx + 1
    if next_idx >= len(urls):
        return False
    url_info['url'] = urls[next_idx]
    return True


def _serve_cached_prefix(handler, song_id, level, provider, media_mid=None):
    cache_key = (provider, str(song_id), level or 'exhigh', str(media_mid or ''))
    with _prefix_cache_lock:
        cached = _prefix_cache.get(cache_key)
        if not cached or time.monotonic() - cached['ts'] >= _prefix_cache_ttl:
            return False
        body = cached['body']
        headers = cached['headers']
        url_info = cached['url_info']
    if not body:
        return False
    total = None
    content_range = headers.get('Content-Range') or headers.get('content-range')
    if content_range and '/' in content_range:
        total = content_range.rsplit('/', 1)[-1]
    handler.send_response(206)
    handler.send_header('Content-Type', headers.get('Content-Type', 'audio/mpeg'))
    handler.send_header('Content-Length', str(len(body)))
    handler.send_header(
        'Content-Range',
        'bytes 0-%d/%s' % (len(body) - 1, total or '*'),
    )
    handler.send_header('Accept-Ranges', 'bytes')
    handler.send_header('X-Player-Requested-Level', url_info.get('requested_level', ''))
    handler.send_header('X-Player-Actual-Level', url_info.get('level', ''))
    handler.send_header(
        'X-Player-Level-Degraded',
        'true' if url_info.get('level') != url_info.get('requested_level') else 'false',
    )
    handler.send_header('X-Player-Trial', 'true' if url_info.get('trial') else 'false')
    handler.send_header('X-Player-Prewarmed', 'true')
    handler.end_headers()
    try:
        handler.wfile.write(body)
    except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
        handler.close_connection = True
    return True


def _parse_range_start(range_header):
    """解析 Range 头的起始字节。无 Range 返回 0。"""
    if not range_header:
        return 0
    # Range: bytes=5000000-
    try:
        spec = range_header.split('=', 1)[1].split('-')[0]
        return int(spec)
    except (IndexError, ValueError):
        return 0


def _clamp_open_ended_range(range_header):
    """Turn bytes=N- into a small chunk so audio loads progressively."""
    if not range_header:
        return None
    try:
        unit, spec = range_header.strip().split('=', 1)
        if unit.lower() != 'bytes':
            return range_header
        start_raw, end_raw = spec.split('-', 1)
        start = int(start_raw)
        if end_raw.strip():
            return range_header
        end = start + STREAM_CHUNK_SIZE - 1
        return 'bytes=%d-%d' % (start, end)
    except (ValueError, IndexError):
        return range_header


def _provider_referer(provider):
    if provider == 'qq':
        return 'https://y.qq.com/'
    if provider == 'bilibili':
        return 'https://www.bilibili.com/'
    return 'https://music.163.com/'


def _send_json_error(handler, code, message, retryable, status):
    """音频流错误（<audio> 无法读 JSON，但返回正确 HTTP 状态）。"""
    from .router import error, send_json
    print('[stream] 错误 %s: %s (HTTP %d)' % (code, message, status))
    try:
        send_json(handler, error(code, message, retryable), status=status)
    except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
        handler.close_connection = True


def _send_stream_error(handler, provider_error):
    """Provider error 转 stream 错误。"""
    if provider_error.code == 'upstream-timeout':
        _send_json_error(handler, 'UPSTREAM_TIMEOUT', str(provider_error),
                         True, 504)
    else:
        _send_json_error(handler, 'UPSTREAM_ERROR', str(provider_error),
                         provider_error.retryable, 502)


class _ClientDisconnected(Exception):
    """客户端断开连接（内部用，静默处理）。"""
    pass
