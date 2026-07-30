# -*- coding: utf-8 -*-
"""Local-only offline video rendering jobs with persistent task history."""
import glob
import json
import os
import re
import shutil
import subprocess
import threading
import time
import uuid

from . import middleware
from .middleware import DATA_DIR
from .offline_cache import OfflineCacheError, ensure_cached_cover, list_cached_tracks


RENDER_ROOT = os.path.abspath(os.path.join(DATA_DIR, 'render_output'))
JOBS_PATH = os.path.abspath(os.path.join(DATA_DIR, 'render_jobs.json'))
SCRIPT_PATH = os.path.abspath(os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts', 'render_song_video.js'))
RESOLUTIONS = {
    '1080p': (1920, 1080),
    '2k': (2560, 1440),
    '4k': (3840, 2160),
}
FPS_VALUES = {24, 30, 60}
MAX_PERSISTED_JOBS = 120
_jobs = {}
_lock = threading.RLock()
_last_saved_at = 0.0


class VideoRenderError(Exception):
    def __init__(self, code, message, retryable=False):
        self.code = code
        self.message = message
        self.retryable = retryable
        super().__init__(message)


def cached_tracks():
    return list_cached_tracks()


def list_jobs():
    with _lock:
        jobs = sorted(_jobs.values(), key=lambda item: float(item.get('createdAt') or 0), reverse=True)
        return [_public_job(job) for job in jobs]


def start_render(media_id, resolution='4k', fps=60, test=False, preview_seconds=None, start=0, end=None):
    resolution = str(resolution or '4k').lower()
    if resolution not in RESOLUTIONS:
        raise VideoRenderError('BAD_REQUEST', '仅支持 1080p、2K 和 4K', False)
    try:
        fps = int(fps)
    except (TypeError, ValueError):
        fps = 0
    if fps not in FPS_VALUES:
        raise VideoRenderError('BAD_REQUEST', '仅支持 24、30 和 60 帧', False)
    if preview_seconds is None:
        preview_seconds = 3 if test else 0
    try:
        preview_seconds = int(preview_seconds or 0)
    except (TypeError, ValueError):
        raise VideoRenderError('BAD_REQUEST', '预览时长无效', False)
    if preview_seconds not in (0, 3, 30):
        raise VideoRenderError('BAD_REQUEST', '预览仅支持 3 秒或 30 秒', False)
    try:
        start = max(0.0, float(start or 0))
    except (TypeError, ValueError):
        raise VideoRenderError('BAD_REQUEST', '开始时间无效', False)
    if end in (None, ''):
        end = None
    else:
        try:
            end = float(end)
        except (TypeError, ValueError):
            raise VideoRenderError('BAD_REQUEST', '结束时间无效', False)
        if end <= start:
            raise VideoRenderError('BAD_REQUEST', '结束时间必须晚于开始时间', False)

    try:
        track = ensure_cached_cover(media_id)
    except OfflineCacheError as exc:
        raise VideoRenderError(exc.code, exc.message, exc.retryable)

    with _lock:
        if any(job['status'] in ('queued', 'running') for job in _jobs.values()):
            raise VideoRenderError('CONFLICT', '已有视频正在渲染，请等待或取消当前任务', False)
        os.makedirs(RENDER_ROOT, exist_ok=True)
        job_id = uuid.uuid4().hex
        width, height = RESOLUTIONS[resolution]
        safe_title = _safe_filename(track.get('title') or 'song')
        suffix = '-%ds-test' % preview_seconds if preview_seconds else ''
        output_name = '%s-%s-%dfps%s-%s.mp4' % (safe_title, resolution, fps, suffix, job_id[:8])
        output_path = _safe_output_path(output_name)
        job = {
            'id': job_id,
            'mediaId': media_id,
            'title': track.get('title'),
            'artist': track.get('artist'),
            'resolution': resolution,
            'width': width,
            'height': height,
            'fps': fps,
            'test': preview_seconds > 0,
            'previewSeconds': preview_seconds,
            'start': start,
            'end': end,
            'status': 'queued',
            'stage': '等待渲染',
            'progress': 0,
            'frame': 0,
            'totalFrames': 0,
            'outputName': output_name,
            '_outputPath': output_path,
            '_process': None,
            '_cancelled': False,
            'createdAt': time.time(),
            'updatedAt': int(time.time()),
        }
        _jobs[job_id] = job
        _save_jobs_locked(force=True)
    threading.Thread(target=_run_job, args=(job_id, track), daemon=True).start()
    return _public_job(job)


def get_job(job_id):
    with _lock:
        job = _jobs.get(str(job_id or ''))
        if not job:
            raise VideoRenderError('NOT_FOUND', '渲染任务不存在', False)
        return _public_job(job)


def cancel_job(job_id):
    with _lock:
        job = _jobs.get(str(job_id or ''))
        if not job:
            raise VideoRenderError('NOT_FOUND', '渲染任务不存在', False)
        if job.get('status') not in ('queued', 'running'):
            return _public_job(job)
        job['_cancelled'] = True
        process = job.get('_process')
        job.update(stage='正在取消', updatedAt=int(time.time()))
        _save_jobs_locked(force=True)
    if process and process.poll() is None:
        if os.name == 'nt':
            subprocess.run(
                ['taskkill', '/PID', str(process.pid), '/T', '/F'],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
            )
        else:
            process.terminate()
    with _lock:
        job.update(status='cancelled', stage='已取消', completedAt=int(time.time()), updatedAt=int(time.time()))
        _save_jobs_locked(force=True)
        return _public_job(job)


def output_file(job_id):
    with _lock:
        job = _jobs.get(str(job_id or ''))
        if not job or job.get('status') != 'complete':
            raise VideoRenderError('NOT_FOUND', '视频尚未生成', False)
        path = _safe_output_path(job['outputName'])
        if path != job['_outputPath'] or not os.path.isfile(path):
            raise VideoRenderError('NOT_FOUND', '视频文件不存在', False)
        return path, job['outputName']


def _run_job(job_id, track):
    audio_path = track['_audioPath']
    with _lock:
        job = _jobs[job_id]
        if job['_cancelled']:
            return
        job.update(status='running', stage='准备离线资源', updatedAt=int(time.time()))
        _save_jobs_locked(force=True)
        args = [
            shutil.which('node') or 'node', SCRIPT_PATH,
            '--base-url', middleware.EXPECTED_ORIGIN,
            '--media-id', job['mediaId'],
            '--audio', audio_path,
            '--track-json', json.dumps({key: value for key, value in track.items() if not key.startswith('_')}, ensure_ascii=False),
            '--ffmpeg', _media_tool('ffmpeg'),
            '--ffprobe', _media_tool('ffprobe'),
            '--output', job['_outputPath'],
            '--width', str(job['width']),
            '--height', str(job['height']),
            '--fps', str(job['fps']),
            '--start', str(job['start']),
        ]
        if job.get('end') is not None:
            args.extend(['--end', str(job['end'])])
        if track.get('_coverPath'):
            args.extend(['--cover', track['_coverPath']])
        if job['previewSeconds']:
            args.extend(['--duration', str(job['previewSeconds'])])
    try:
        process = subprocess.Popen(
            args,
            cwd=os.path.dirname(os.path.dirname(__file__)),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding='utf-8',
            errors='replace',
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
        )
        with _lock:
            job['_process'] = process
        last_line = ''
        output_lines = []
        for line in process.stdout or ():
            line = line.strip()
            if not line:
                continue
            last_line = line
            output_lines.append(line)
            if len(output_lines) > 120:
                output_lines.pop(0)
            try:
                event = json.loads(line)
            except ValueError:
                continue
            with _lock:
                if event.get('type') == 'progress':
                    job['stage'] = str(event.get('stage') or job['stage'])
                    job['frame'] = int(event.get('frame') or 0)
                    job['totalFrames'] = int(event.get('totalFrames') or job['totalFrames'] or 0)
                    job['progress'] = max(0, min(100, float(event.get('progress') or 0)))
                elif event.get('type') == 'metadata':
                    job['duration'] = event.get('duration')
                    job['clipDuration'] = event.get('clipDuration')
                    job['totalFrames'] = int(event.get('totalFrames') or 0)
                elif event.get('type') == 'error':
                    job['error'] = str(event.get('message') or '渲染失败')
                job['updatedAt'] = int(time.time())
                _save_jobs_locked()
        code = process.wait()
        with _lock:
            job['_process'] = None
            if job['_cancelled']:
                job.update(status='cancelled', stage='已取消', completedAt=int(time.time()))
            elif code == 0 and os.path.isfile(job['_outputPath']):
                job.update(
                    status='complete',
                    stage='渲染完成',
                    progress=100,
                    frame=job.get('totalFrames') or job.get('frame') or 0,
                    size=os.path.getsize(job['_outputPath']),
                    completedAt=int(time.time()),
                )
            else:
                job.update(
                    status='failed',
                    stage='渲染失败',
                    error=(job.get('error') or '\n'.join(output_lines[-80:]) or last_line or '渲染进程异常退出'),
                    completedAt=int(time.time()),
                )
            job['updatedAt'] = int(time.time())
            _save_jobs_locked(force=True)
    except Exception as exc:
        with _lock:
            job['_process'] = None
            job.update(status='failed', stage='渲染失败', error=str(exc), completedAt=int(time.time()), updatedAt=int(time.time()))
            _save_jobs_locked(force=True)
    finally:
        if job.get('status') != 'complete':
            for path in (job['_outputPath'], job['_outputPath'] + '.part.mp4'):
                try:
                    if os.path.exists(path):
                        os.remove(path)
                except OSError:
                    pass


def _public_job(job):
    return {key: value for key, value in job.items() if not key.startswith('_')}


def _persisted_job(job):
    data = _public_job(job)
    data.pop('canCancel', None)
    return data


def _save_jobs_locked(force=False):
    global _last_saved_at
    now = time.monotonic()
    if not force and now - _last_saved_at < 0.8:
        return
    os.makedirs(DATA_DIR, exist_ok=True)
    ordered = sorted(_jobs.values(), key=lambda item: float(item.get('createdAt') or 0), reverse=True)[:MAX_PERSISTED_JOBS]
    payload = {'version': 1, 'jobs': [_persisted_job(job) for job in ordered]}
    tmp_path = JOBS_PATH + '.tmp'
    with open(tmp_path, 'w', encoding='utf-8') as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(',', ':'))
    os.replace(tmp_path, JOBS_PATH)
    _last_saved_at = now


def _load_jobs():
    changed = False
    os.makedirs(RENDER_ROOT, exist_ok=True)
    raw_jobs = []
    try:
        with open(JOBS_PATH, 'r', encoding='utf-8') as handle:
            payload = json.load(handle)
        raw_jobs = payload.get('jobs') if isinstance(payload, dict) else []
    except (OSError, ValueError):
        raw_jobs = []
    if not isinstance(raw_jobs, list):
        raw_jobs = []
    for raw in raw_jobs[:MAX_PERSISTED_JOBS]:
        if not isinstance(raw, dict):
            continue
        job_id = str(raw.get('id') or '')
        output_name = str(raw.get('outputName') or '')
        if not re.match(r'^[0-9a-f]{32}$', job_id) or not output_name:
            continue
        try:
            output_path = _safe_output_path(output_name)
        except VideoRenderError:
            continue
        job = dict(raw)
        job.update(_outputPath=output_path, _process=None, _cancelled=False)
        if job.get('status') in ('queued', 'running'):
            job.update(status='failed', stage='任务已中断', error='本地服务重启，上一轮渲染任务未完成', completedAt=int(time.time()))
            changed = True
        if job.get('status') == 'complete' and not os.path.isfile(output_path):
            job.update(status='failed', stage='输出文件缺失', error='任务记录存在，但生成的视频文件已被移动或删除')
            changed = True
        _jobs[job_id] = job
    if _discover_outputs_locked():
        changed = True
    if changed or not os.path.isfile(JOBS_PATH):
        _save_jobs_locked(force=True)


def _discover_outputs_locked():
    changed = False
    known = {str(job.get('outputName') or '') for job in _jobs.values()}
    pattern = re.compile(r'^(.*)-(1080p|2k|4k)-(\d+)fps(?:-(\d+)s-test)?-([0-9a-f]{8})\.mp4$', re.IGNORECASE)
    for name in os.listdir(RENDER_ROOT):
        if name in known or not name.lower().endswith('.mp4'):
            continue
        path = _safe_output_path(name)
        if not os.path.isfile(path):
            continue
        match = pattern.match(name)
        if not match:
            continue
        title, resolution, fps, preview_seconds, _prefix = match.groups()
        stat = os.stat(path)
        job_id = uuid.uuid5(uuid.NAMESPACE_URL, 'immersive-render:' + name).hex
        width, height = RESOLUTIONS.get(resolution.lower(), RESOLUTIONS['1080p'])
        _jobs[job_id] = {
            'id': job_id,
            'mediaId': '',
            'title': title,
            'artist': '',
            'resolution': resolution.lower(),
            'width': width,
            'height': height,
            'fps': int(fps),
            'test': bool(preview_seconds),
            'previewSeconds': int(preview_seconds or 0),
            'start': 0,
            'end': None,
            'status': 'complete',
            'stage': '渲染完成',
            'progress': 100,
            'frame': 0,
            'totalFrames': 0,
            'outputName': name,
            'size': stat.st_size,
            'createdAt': stat.st_mtime,
            'updatedAt': int(stat.st_mtime),
            'completedAt': int(stat.st_mtime),
            '_outputPath': path,
            '_process': None,
            '_cancelled': False,
        }
        changed = True
    return changed


def _media_tool(name):
    found = shutil.which(name)
    if found:
        return found
    pattern = os.path.join(
        os.environ.get('LOCALAPPDATA') or os.path.expanduser('~\\AppData\\Local'),
        'Microsoft', 'WinGet', 'Packages', 'Gyan.FFmpeg*', '**', 'bin', name + '.exe'
    )
    matches = glob.glob(pattern, recursive=True)
    if matches:
        return matches[0]
    raise VideoRenderError('INTERNAL', '未找到 %s，请先安装 FFmpeg' % name, False)


def _safe_filename(value):
    value = ''.join('_' if ch in '<>:"/\\|?*' or ord(ch) < 32 else ch for ch in str(value))
    value = value.strip(' .')[:80]
    return value or 'song'


def _safe_output_path(filename):
    root = os.path.abspath(RENDER_ROOT)
    path = os.path.abspath(os.path.join(root, filename))
    if not path.startswith(root + os.sep):
        raise VideoRenderError('BAD_REQUEST', '无效输出路径', False)
    return path


with _lock:
    _load_jobs()