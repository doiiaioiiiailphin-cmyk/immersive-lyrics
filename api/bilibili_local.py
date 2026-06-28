# -*- coding: utf-8 -*-
"""Local Bilibili media imports.

The frontend never sends local paths. It submits a BV/link, options, and small
uploaded subtitle/cover files. This module downloads media into
data/bilibili_media/{mediaId}/ and deletes only files registered in manifest.
"""
import hashlib
import json
import os
import re
import shutil
import threading
import time
import urllib.error
import urllib.parse
import uuid

from .bilibili_client import (
    BILI_BASE,
    BilibiliError,
    bilibili,
    get_cover_url,
    get_lyrics,
    get_song_url,
    resolve_video,
)


DATA_DIR = os.environ.get('PLAYER_DATA_DIR') or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data')
MEDIA_ROOT = os.path.join(DATA_DIR, 'bilibili_media')
JOBS = {}
JOBS_LOCK = threading.Lock()
SAFE_MEDIA_ID = re.compile(r'^[0-9a-f]{24}$')


def start_local_import(user_input, cid=None, download_video=False, subtitle_source='video', subtitle_id=None, subtitle_upload=None, cover_upload=None):
    subtitle_source = (subtitle_source or 'video').strip().lower()
    if subtitle_source not in ('video', 'upload', 'none'):
        raise BilibiliError('bad-input', '字幕来源只能是 video、upload 或 none', retryable=False)
    if subtitle_source == 'upload' and not (subtitle_upload and subtitle_upload.get('data')):
        raise BilibiliError('bad-input', '请选择要上传的字幕文件', retryable=False)
    job_id = uuid.uuid4().hex
    job = {
        'job_id': job_id,
        'status': 'queued',
        'step': 'queued',
        'progress': 0,
        'message': '等待下载',
        'result': None,
        'error': None,
        'created_at': time.time(),
        'updated_at': time.time(),
    }
    with JOBS_LOCK:
        JOBS[job_id] = job
    threading.Thread(
        target=_run_import,
        args=(job_id, user_input, cid, bool(download_video), subtitle_source, subtitle_id, subtitle_upload, cover_upload),
        daemon=True,
    ).start()
    return dict(job)


def get_import_job(job_id):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if not job:
            raise BilibiliError('not-found', '导入任务不存在', retryable=False)
        return dict(job)


def local_media_path(media_id, kind):
    if kind not in ('audio', 'video', 'cover', 'lyrics'):
        raise BilibiliError('bad-id', '无效的媒体类型', retryable=False)
    manifest = _load_manifest(media_id)
    entry = (manifest.get('files') or {}).get(kind)
    if not entry:
        raise BilibiliError('not-found', '本地媒体不存在', retryable=False)
    rel = entry.get('path') if isinstance(entry, dict) else entry
    path = _safe_join(_media_dir(media_id), rel)
    if not os.path.isfile(path):
        raise BilibiliError('not-found', '本地媒体文件已不存在', retryable=False)
    mime = (entry.get('mime') if isinstance(entry, dict) else '') or ''
    if not mime or mime == 'application/octet-stream':
        mime = _mime_from_name(path) or _mime_for_kind(kind)
    return path, mime


def get_local_lyrics(media_id):
    path, _ = local_media_path(media_id, 'lyrics')
    with open(path, 'r', encoding='utf-8') as fh:
        data = json.load(fh)
    return {'mode': data.get('mode') or 'line', 'lines': data.get('lines') or []}


def delete_local_media(media_id):
    _validate_media_id(media_id)
    media_dir = _safe_join(_real(MEDIA_ROOT), media_id)
    if not os.path.exists(media_dir):
        return {'deleted': False, 'missing': True}
    manifest_path = _safe_join(media_dir, 'manifest.json')
    if not os.path.isfile(manifest_path):
        raise BilibiliError('bad-id', '缺少 manifest，拒绝删除未登记目录', retryable=False)
    with open(manifest_path, 'r', encoding='utf-8') as fh:
        manifest = json.load(fh)
    deleted = []
    for entry in (manifest.get('files') or {}).values():
        rel = entry.get('path') if isinstance(entry, dict) else entry
        if not rel:
            continue
        path = _safe_join(media_dir, rel)
        if os.path.isfile(path):
            os.remove(path)
            deleted.append(os.path.basename(path))
    if os.path.isfile(manifest_path):
        os.remove(manifest_path)
        deleted.append('manifest.json')
    try:
        os.rmdir(media_dir)
    except OSError:
        pass
    return {'deleted': True, 'missing': False, 'files': deleted}


def media_id_for(track_id):
    return hashlib.sha256(track_id.encode('utf-8')).hexdigest()[:24]


def _run_import(job_id, user_input, requested_cid, download_video, subtitle_source, subtitle_id, subtitle_upload, cover_upload):
    staging = None
    try:
        os.makedirs(MEDIA_ROOT, exist_ok=True)
        _job(job_id, status='running', step='resolve', progress=5, message='解析 B 站链接')
        resolved = resolve_video(user_input)
        page = _select_page(resolved, requested_cid)
        track_id = '%s:%s' % (resolved['bvid'], page['cid'])
        media_id = media_id_for(track_id)
        staging = _safe_join(_real(MEDIA_ROOT), media_id + '.part-' + job_id[:8])
        if os.path.isdir(staging):
            shutil.rmtree(staging)
        os.makedirs(staging, exist_ok=True)
        files = {}

        _job(job_id, step='audio', progress=15, message='下载音频')
        audio_info = get_song_url(track_id, level='standard')
        if not audio_info or not audio_info.get('url'):
            raise BilibiliError('no-audio', 'B 站未返回可用音频地址', retryable=False)
        audio_name, audio_mime = _download(audio_info['url'], staging, 'audio.m4a', 'audio', job_id, 15, 52)
        files['audio'] = {'path': audio_name, 'mime': audio_mime or 'audio/mp4'}

        _job(job_id, step='lyrics', progress=57, message='写入歌词')
        if subtitle_source == 'none':
            lyrics = {'mode': 'line', 'lines': []}
        elif subtitle_source == 'upload':
            lyrics = _lyrics_from_upload(subtitle_upload) or {'mode': 'line', 'lines': []}
        else:
            lyrics = get_lyrics(track_id, duration=page.get('duration') or resolved.get('duration'), subtitle_id=subtitle_id)
        _atomic_json(os.path.join(staging, 'lyrics.json'), lyrics or {'mode': 'line', 'lines': []})
        files['lyrics'] = {'path': 'lyrics.json', 'mime': 'application/json'}

        _job(job_id, step='cover', progress=66, message='写入封面')
        if cover_upload and cover_upload.get('data'):
            cover_name = _safe_file_name('cover', cover_upload.get('filename'), cover_upload.get('content_type'), '.jpg')
            _atomic_bytes(os.path.join(staging, cover_name), cover_upload['data'])
            cover_mime = cover_upload.get('content_type') or _mime_from_name(cover_name) or 'image/jpeg'
        else:
            cover_name, cover_mime = _download(resolved.get('cover') or get_cover_url(track_id), staging, 'cover.jpg', 'cover', job_id, 66, 76)
        files['cover'] = {'path': cover_name, 'mime': cover_mime or 'image/jpeg'}

        video_url = None
        if download_video:
            _job(job_id, step='video', progress=78, message='下载背景视频')
            video_info = get_song_url(track_id, level='video')
            if not video_info or not video_info.get('url'):
                raise BilibiliError('no-video', 'B 站未返回可用视频地址', retryable=False)
            video_name, video_mime = _download(video_info['url'], staging, 'video.mp4', 'video', job_id, 78, 94)
            files['video'] = {'path': video_name, 'mime': video_mime or 'video/mp4'}
            video_url = '/api/bilibili/media/%s/video' % media_id

        manifest = {
            'mediaId': media_id,
            'trackId': track_id,
            'bvid': resolved.get('bvid'),
            'aid': resolved.get('aid'),
            'cid': int(page.get('cid') or 0),
            'title': page.get('title') or resolved.get('title') or resolved.get('bvid'),
            'uploader': resolved.get('artist') or 'Bilibili',
            'duration': int(page.get('duration') or resolved.get('duration') or 0),
            'coverUrl': resolved.get('cover') or '',
            'downloadedVideo': bool(download_video),
            'subtitleSource': subtitle_source,
            'subtitleId': str(subtitle_id or '') if subtitle_source == 'video' else '',
            'files': files,
            'createdAt': int(time.time()),
        }
        _atomic_json(os.path.join(staging, 'manifest.json'), manifest)
        target = _media_dir(media_id)
        if os.path.exists(target):
            delete_local_media(media_id)
            if os.path.exists(target):
                shutil.rmtree(target)
        os.replace(staging, target)
        staging = None

        track = {
            'source': 'bilibili',
            'id': track_id,
            'bilibiliId': track_id,
            'localMediaId': media_id,
            'bvid': resolved.get('bvid'),
            'aid': resolved.get('aid'),
            'cid': int(page.get('cid') or 0),
            'title': manifest['title'],
            'artist': manifest['uploader'],
            'duration': manifest['duration'],
            'audio': '/api/bilibili/media/%s/audio' % media_id,
            'cover': '/api/bilibili/media/%s/cover' % media_id,
            'lyrics': '/api/bilibili/media/%s/lyrics' % media_id,
            'backgroundVideo': bool(download_video),
            'video': video_url,
        }
        _job(job_id, status='done', step='done', progress=100, message='导入完成', result={'track': track, 'manifest': manifest})
    except Exception as e:
        if staging and os.path.isdir(staging):
            try:
                shutil.rmtree(staging)
            except OSError:
                pass
        message = e.message if isinstance(e, BilibiliError) else str(e)
        _job(job_id, status='failed', step='failed', progress=100, message=message, error=message)


def _select_page(resolved, requested_cid):
    pages = resolved.get('pages') or []
    if not pages:
        raise BilibiliError('not-found', 'B 站视频没有可导入分 P', retryable=False)
    if not requested_cid:
        return pages[0]
    try:
        cid = int(requested_cid)
    except (TypeError, ValueError):
        raise BilibiliError('bad-id', '无效的 cid', retryable=False)
    for page in pages:
        if int(page.get('cid') or 0) == cid:
            return page
    raise BilibiliError('bad-id', 'cid 不属于当前视频', retryable=False)


def _download(url, directory, fallback_name, kind, job_id, start, end):
    if not url:
        raise BilibiliError('bad-url', '%s地址为空' % _kind_label(kind), retryable=False)
    if url.startswith('//'):
        url = 'https:' + url
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ('http', 'https') or not _allowed_media_host(parsed.hostname):
        raise BilibiliError('bad-url', 'B 站媒体地址不被允许: %s' % (parsed.hostname or ''), retryable=False)
    target = os.path.join(directory, fallback_name)
    part = target + '.part'
    req = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': BILI_BASE + '/',
        'Origin': BILI_BASE,
    })
    try:
        with bilibili._opener().open(req, timeout=20) as resp, open(part, 'wb') as fh:
            total = int(resp.headers.get('Content-Length') or 0)
            mime = (resp.headers.get('Content-Type') or '').split(';', 1)[0]
            done = 0
            while True:
                chunk = resp.read(256 * 1024)
                if not chunk:
                    break
                fh.write(chunk)
                done += len(chunk)
                if total:
                    pct = done / float(total)
                    _job(job_id, progress=int(start + (end - start) * min(1, pct)), message='下载%s %d%%' % (_kind_label(kind), pct * 100))
    except urllib.error.URLError as e:
        try:
            os.remove(part)
        except OSError:
            pass
        raise BilibiliError('upstream-network', '%s下载失败: %s' % (_kind_label(kind), getattr(e, 'reason', e)), retryable=True)
    os.replace(part, target)
    name = _rename_by_mime(target, fallback_name, mime)
    return name, mime or _mime_from_name(name)


def _lyrics_from_upload(upload):
    if not upload or not upload.get('data'):
        return None
    text = upload['data'].decode('utf-8-sig', 'replace').replace('\r', '').strip()
    if not text:
        return {'mode': 'line', 'lines': []}
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict) and isinstance(parsed.get('lines'), list):
            return {'mode': parsed.get('mode') or 'line', 'lines': parsed.get('lines') or []}
    except (TypeError, ValueError):
        pass
    lines = []
    if re.search(r'^\[\d{1,2}:\d{2}(?:\.\d+)?\]', text, re.M):
        for raw in text.split('\n'):
            matches = list(re.finditer(r'\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]', raw))
            lyric = re.sub(r'\[[^\]]+\]', '', raw).strip()
            for match in matches:
                if not lyric:
                    continue
                start = int(match.group(1)) * 60 + int(match.group(2)) + int((match.group(3) or '0').ljust(3, '0')) / 1000
                lines.append(_line(start, start + 2.5, lyric))
    else:
        for block in re.split(r'\n\s*\n', text):
            rows = [row.strip() for row in block.split('\n') if row.strip() and not row.strip().isdigit()]
            timing = next((row for row in rows if '-->' in row), '')
            if not timing:
                continue
            start_s, end_s = [part.strip() for part in timing.split('-->', 1)]
            content = ' '.join(row for row in rows if row != timing and row != 'WEBVTT')
            if content:
                lines.append(_line(_time_value(start_s), _time_value(end_s), content))
    lines.sort(key=lambda item: item['start'])
    return {'mode': 'line', 'lines': lines}


def _line(start, end, text):
    start = float(start or 0)
    end = max(float(end or start + 2), start + 0.2)
    return {'start': start, 'end': end, 'text': text, 'translation': '', 'words': [{'text': text, 'start': start, 'end': end}]}


def _time_value(value):
    value = value.split()[0].replace(',', '.')
    parts = [float(part) for part in value.split(':')]
    if len(parts) == 3:
        return parts[0] * 3600 + parts[1] * 60 + parts[2]
    if len(parts) == 2:
        return parts[0] * 60 + parts[1]
    return parts[0] if parts else 0


def _job(job_id, **changes):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if not job:
            return
        job.update(changes)
        job['updated_at'] = time.time()


def _load_manifest(media_id):
    manifest = _safe_join(_media_dir(media_id), 'manifest.json')
    if not os.path.isfile(manifest):
        raise BilibiliError('not-found', '本地媒体 manifest 不存在', retryable=False)
    with open(manifest, 'r', encoding='utf-8') as fh:
        return json.load(fh)


def _media_dir(media_id):
    _validate_media_id(media_id)
    return _safe_join(_real(MEDIA_ROOT), media_id)


def _validate_media_id(media_id):
    if not SAFE_MEDIA_ID.match(media_id or ''):
        raise BilibiliError('bad-id', '无效的 mediaId', retryable=False)


def _safe_join(root, rel):
    root = _real(root)
    path = _real(os.path.join(root, rel or ''))
    if os.path.commonpath([root, path]) != root:
        raise BilibiliError('bad-id', '媒体路径越界，已拒绝', retryable=False)
    return path


def _real(path):
    return os.path.realpath(os.path.abspath(path))


def _atomic_json(path, data):
    _atomic_bytes(path, json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode('utf-8'))


def _atomic_bytes(path, data):
    part = path + '.part'
    with open(part, 'wb') as fh:
        fh.write(data)
    os.replace(part, path)


def _safe_file_name(stem, filename, content_type, fallback):
    ext = os.path.splitext(filename or '')[1].lower()
    if not re.match(r'^\.[a-z0-9]{1,8}$', ext or ''):
        ext = _ext_from_mime(content_type) or fallback
    return stem + ext


def _rename_by_mime(path, name, mime):
    ext = _ext_from_mime(mime)
    if not ext or name.lower().endswith(ext):
        return name
    new_name = os.path.splitext(name)[0] + ext
    os.replace(path, os.path.join(os.path.dirname(path), new_name))
    return new_name


def _ext_from_mime(mime):
    return {
        'audio/mp4': '.m4a',
        'audio/mpeg': '.mp3',
        'video/mp4': '.mp4',
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/webp': '.webp',
    }.get((mime or '').lower().split(';', 1)[0])


def _mime_from_name(name):
    return {
        '.m4a': 'audio/mp4',
        '.mp3': 'audio/mpeg',
        '.mp4': 'video/mp4',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.webp': 'image/webp',
        '.json': 'application/json',
    }.get(os.path.splitext(name or '')[1].lower(), '')


def _mime_for_kind(kind):
    return {'audio': 'audio/mp4', 'video': 'video/mp4', 'cover': 'image/jpeg', 'lyrics': 'application/json'}.get(kind, 'application/octet-stream')


def _kind_label(kind):
    return {'audio': '音频', 'video': '视频', 'cover': '封面'}.get(kind, kind)


def _allowed_media_host(host):
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
