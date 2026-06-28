# -*- coding: utf-8 -*-
import hashlib
import json
import os
import re
import shutil
import time

import requests

from .middleware import DATA_DIR
from .netease_client import (
    get_song_url as netease_get_song_url,
    get_song_detail as netease_get_song_detail,
    get_lyrics as netease_get_lyrics,
    NetEaseError,
)
from .qq_client import (
    get_song_url as qq_get_song_url,
    get_cover_url as qq_get_cover_url,
    get_lyrics as qq_get_lyrics,
    QQMusicError,
)
from .bilibili_client import (
    get_song_url as bilibili_get_song_url,
    get_cover_url as bilibili_get_cover_url,
    get_lyrics as bilibili_get_lyrics,
    BilibiliError,
)


CACHE_ROOT = os.path.join(DATA_DIR, 'offline_cache')
MAX_AUDIO_BYTES = 350 * 1024 * 1024
MAX_COVER_BYTES = 15 * 1024 * 1024
CHUNK_SIZE = 256 * 1024


class OfflineCacheError(Exception):
    def __init__(self, code, message, retryable=False):
        self.code = code
        self.message = message
        self.retryable = retryable
        super().__init__(message)


def cache_track(provider, song_id, level='standard', title='', artist='', duration=None, qq_song_id=None, cover_url=''):
    provider = _safe_provider(provider)
    song_id = _safe_song_id(provider, song_id)
    level = _safe_level(level)
    media_id = media_id_for(provider, song_id, level)
    media_dir = _media_dir(media_id)
    manifest_path = os.path.join(media_dir, 'manifest.json')

    manifest = None
    if os.path.exists(manifest_path):
        try:
            manifest = _read_manifest(media_id)
        except OfflineCacheError:
            manifest = None
    if manifest and _has_manifest_file(media_dir, manifest, 'audio'):
        changed = _ensure_sidecars(provider, song_id, media_dir, manifest, duration=duration, qq_song_id=qq_song_id, cover_url=cover_url)
        if changed:
            _write_manifest(media_dir, manifest)
        return _public_payload(media_id, manifest)

    os.makedirs(media_dir, exist_ok=True)
    _clear_partial_files(media_dir)
    url_info = _song_url(provider, song_id, level)
    if not url_info or not url_info.get('url'):
        raise OfflineCacheError('NO_PERMISSION', '无法获取歌曲播放地址，可能需要会员或暂无版权', False)

    mime = _mime_from_info(url_info)
    ext = _extension_for_audio_mime(mime)
    filename = 'audio' + ext
    tmp_path = os.path.join(media_dir, filename + '.part')
    final_path = os.path.join(media_dir, filename)
    _download(url_info['url'], tmp_path, provider, MAX_AUDIO_BYTES, '音频')
    os.replace(tmp_path, final_path)

    manifest = {
        'mediaId': media_id,
        'provider': provider,
        'songId': song_id,
        'level': level,
        'title': str(title or ''),
        'artist': str(artist or ''),
        'createdAt': int(time.time()),
        'files': {
            'audio': {
                'path': filename,
                'mime': mime,
                'size': os.path.getsize(final_path),
            },
        },
    }
    _ensure_sidecars(provider, song_id, media_dir, manifest, duration=duration, qq_song_id=qq_song_id, cover_url=cover_url)
    _write_manifest(media_dir, manifest)
    return _public_payload(media_id, manifest)


def media_id_for(provider, song_id, level='standard'):
    raw = '%s:%s:%s' % (_safe_provider(provider), song_id, _safe_level(level))
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()[:32]


def local_audio_path(media_id):
    return local_media_path(media_id, 'audio')


def local_media_path(media_id, kind):
    kind = str(kind or '').strip().lower()
    if kind not in ('audio', 'cover', 'lyrics'):
        raise OfflineCacheError('BAD_REQUEST', '无效缓存资源类型', False)
    manifest = _read_manifest(media_id)
    entry = manifest.get('files', {}).get(kind) or {}
    rel = entry.get('path')
    if not rel:
        raise OfflineCacheError('NOT_FOUND', '缓存资源不存在', False)
    path = _safe_join(_media_dir(media_id), rel)
    if not os.path.exists(path):
        raise OfflineCacheError('NOT_FOUND', '缓存文件不存在', False)
    return path, entry.get('mime') or 'application/octet-stream'


def delete_cached_media(media_id):
    media_dir = _media_dir(media_id)
    manifest_path = os.path.join(media_dir, 'manifest.json')
    if not os.path.exists(manifest_path):
        return {'deleted': False, 'missing': True}
    manifest = _read_manifest(media_id)
    for entry in (manifest.get('files') or {}).values():
        rel = entry.get('path') if isinstance(entry, dict) else ''
        if rel:
            _safe_join(media_dir, rel)
    shutil.rmtree(media_dir)
    return {'deleted': True, 'mediaId': media_id}


def _public_payload(media_id, manifest):
    files = manifest.get('files', {}) or {}
    return {
        'mediaId': media_id,
        'provider': manifest.get('provider'),
        'songId': manifest.get('songId'),
        'level': manifest.get('level'),
        'audio': '/api/cache/media/%s/audio' % media_id,
        'cover': '/api/cache/media/%s/cover' % media_id if files.get('cover') else None,
        'lyrics': '/api/cache/media/%s/lyrics' % media_id if files.get('lyrics') else None,
        'size': (files.get('audio') or {}).get('size') or 0,
        'cached': True,
    }


def _ensure_sidecars(provider, song_id, media_dir, manifest, duration=None, qq_song_id=None, cover_url=''):
    changed = False
    files = manifest.setdefault('files', {})
    if not _has_manifest_file(media_dir, manifest, 'cover'):
        cover = _cache_cover(provider, song_id, media_dir, cover_url=cover_url)
        if cover:
            files['cover'] = cover
            changed = True
    if not _has_manifest_file(media_dir, manifest, 'lyrics'):
        lyrics = _cache_lyrics(provider, song_id, media_dir, duration=duration, qq_song_id=qq_song_id)
        if lyrics:
            files['lyrics'] = lyrics
            changed = True
    return changed


def _has_manifest_file(media_dir, manifest, kind):
    entry = (manifest.get('files') or {}).get(kind) or {}
    rel = entry.get('path')
    return bool(rel and os.path.exists(_safe_join(media_dir, rel)))


def _cache_cover(provider, song_id, media_dir, cover_url=''):
    tmp_path = os.path.join(media_dir, 'cover.part')
    try:
        url = cover_url or _cover_url(provider, song_id)
        if not url:
            return None
        response = requests.get(url, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': _referer(provider),
        }, timeout=(8, 25), stream=True)
        try:
            if response.status_code >= 400:
                return None
            mime = (response.headers.get('Content-Type') or 'image/jpeg').split(';', 1)[0].strip() or 'image/jpeg'
            ext = _extension_for_image_mime(mime)
            final_path = os.path.join(media_dir, 'cover' + ext)
            _write_response_to_file(response, tmp_path, MAX_COVER_BYTES, '封面')
            os.replace(tmp_path, final_path)
            return {'path': 'cover' + ext, 'mime': mime, 'size': os.path.getsize(final_path)}
        finally:
            response.close()
    except Exception:
        return None
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass


def _cache_lyrics(provider, song_id, media_dir, duration=None, qq_song_id=None):
    try:
        if provider == 'qq':
            data = qq_get_lyrics(song_id, duration=duration, numeric_id=qq_song_id)
        elif provider == 'bilibili':
            data = bilibili_get_lyrics(song_id, duration=duration)
        else:
            data = netease_get_lyrics(song_id, duration=duration)
    except Exception:
        data = None
    if not data:
        data = {'mode': 'line', 'lines': [{'start': 0, 'end': 4, 'text': '暂无歌词', 'translation': ''}]}
    path = os.path.join(media_dir, 'lyrics.json')
    tmp_path = path + '.tmp'
    with open(tmp_path, 'w', encoding='utf-8') as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(',', ':'))
    os.replace(tmp_path, path)
    return {'path': 'lyrics.json', 'mime': 'application/json; charset=utf-8', 'size': os.path.getsize(path)}


def _song_url(provider, song_id, level):
    try:
        if provider == 'qq':
            return qq_get_song_url(song_id, level=level)
        if provider == 'bilibili':
            return bilibili_get_song_url(song_id, level=level)
        return netease_get_song_url(song_id, level=level)
    except (NetEaseError, QQMusicError, BilibiliError) as e:
        raise OfflineCacheError(getattr(e, 'code', 'UPSTREAM_ERROR'), str(e), getattr(e, 'retryable', True))


def _cover_url(provider, song_id):
    if provider == 'qq':
        return qq_get_cover_url(song_id)
    if provider == 'bilibili':
        return bilibili_get_cover_url(song_id)
    detail = netease_get_song_detail(song_id)
    return detail.get('cover') if detail else None


def _download(url, tmp_path, provider, max_bytes, label):
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': _referer(provider),
    }
    response = None
    completed = False
    try:
        response = requests.get(url, headers=headers, timeout=(8, 30), stream=True)
        if response.status_code >= 400:
            raise OfflineCacheError('UPSTREAM_ERROR', '%s下载失败: HTTP %d' % (label, response.status_code), True)
        written = _write_response_to_file(response, tmp_path, max_bytes, label)
        if written <= 0:
            raise OfflineCacheError('UPSTREAM_ERROR', '%s下载为空' % label, True)
        completed = True
    except requests.Timeout:
        raise OfflineCacheError('UPSTREAM_TIMEOUT', '%s下载超时' % label, True)
    except requests.RequestException as e:
        raise OfflineCacheError('UPSTREAM_ERROR', '%s下载失败: %s' % (label, e), True)
    finally:
        if response is not None:
            response.close()
        if os.path.exists(tmp_path) and not completed:
            try:
                os.remove(tmp_path)
            except OSError:
                pass


def _write_response_to_file(response, tmp_path, max_bytes, label):
    length = int(response.headers.get('Content-Length') or 0)
    if length > max_bytes:
        raise OfflineCacheError('BAD_REQUEST', '%s文件过大，未缓存' % label, False)
    written = 0
    with open(tmp_path, 'wb') as fh:
        for chunk in response.iter_content(CHUNK_SIZE):
            if not chunk:
                continue
            written += len(chunk)
            if written > max_bytes:
                raise OfflineCacheError('BAD_REQUEST', '%s文件过大，未缓存' % label, False)
            fh.write(chunk)
    return written


def _read_manifest(media_id):
    media_dir = _media_dir(media_id)
    path = os.path.join(media_dir, 'manifest.json')
    try:
        with open(path, 'r', encoding='utf-8') as fh:
            manifest = json.load(fh)
    except (OSError, ValueError):
        raise OfflineCacheError('NOT_FOUND', '缓存记录不存在', False)
    if manifest.get('mediaId') != media_id:
        raise OfflineCacheError('BAD_REQUEST', '缓存记录校验失败', False)
    return manifest


def _write_manifest(media_dir, manifest):
    path = os.path.join(media_dir, 'manifest.json')
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as fh:
        json.dump(manifest, fh, ensure_ascii=False, separators=(',', ':'))
    os.replace(tmp, path)


def _media_dir(media_id):
    if not re.match(r'^[0-9a-f]{32}$', media_id or ''):
        raise OfflineCacheError('BAD_REQUEST', '无效缓存 ID', False)
    root = os.path.abspath(CACHE_ROOT)
    path = os.path.abspath(os.path.join(root, media_id))
    if not path.startswith(root + os.sep):
        raise OfflineCacheError('BAD_REQUEST', '无效缓存路径', False)
    return path


def _safe_join(root, rel):
    root = os.path.abspath(root)
    path = os.path.abspath(os.path.join(root, rel))
    if not path.startswith(root + os.sep):
        raise OfflineCacheError('BAD_REQUEST', '无效缓存文件路径', False)
    return path


def _safe_provider(provider):
    provider = (provider or 'netease').strip().lower()
    if provider not in ('netease', 'qq', 'bilibili'):
        raise OfflineCacheError('BAD_REQUEST', '无效音乐源', False)
    return provider


def _safe_song_id(provider, song_id):
    song_id = str(song_id or '').strip()
    if provider == 'qq':
        ok = re.match(r'^[A-Za-z0-9_-]{4,80}$', song_id)
    elif provider == 'bilibili':
        ok = re.match(r'^BV[0-9A-Za-z]{10}:[0-9]{1,20}$', song_id)
    else:
        ok = song_id.isdigit()
    if not ok:
        raise OfflineCacheError('BAD_REQUEST', '无效歌曲 ID', False)
    return song_id


def _safe_level(level):
    level = str(level or 'standard').strip().lower()
    return level if re.match(r'^[a-z0-9_-]{1,24}$', level) else 'standard'


def _mime_from_info(info):
    value = str(info.get('type') or '').lower()
    if 'mpeg' in value or value == 'mp3':
        return 'audio/mpeg'
    if 'flac' in value:
        return 'audio/flac'
    if 'ogg' in value:
        return 'audio/ogg'
    return 'audio/mp4'


def _extension_for_audio_mime(mime):
    return {
        'audio/mpeg': '.mp3',
        'audio/flac': '.flac',
        'audio/ogg': '.ogg',
        'audio/mp4': '.m4a',
    }.get(mime, '.m4a')


def _extension_for_image_mime(mime):
    value = str(mime or '').split(';', 1)[0].strip().lower()
    return {
        'image/png': '.png',
        'image/webp': '.webp',
        'image/gif': '.gif',
        'image/jpeg': '.jpg',
        'image/jpg': '.jpg',
    }.get(value, '.jpg')


def _referer(provider):
    if provider == 'qq':
        return 'https://y.qq.com/'
    if provider == 'bilibili':
        return 'https://www.bilibili.com/'
    return 'https://music.163.com/'


def _clear_partial_files(media_dir):
    if not os.path.isdir(media_dir):
        return
    for name in os.listdir(media_dir):
        if name.endswith('.part') or name.endswith('.tmp'):
            try:
                os.remove(os.path.join(media_dir, name))
            except OSError:
                pass
