# -*- coding: utf-8 -*-
"""Read Bilibili cookies from local Chromium browsers on Windows.

Only Bilibili-related cookies are returned to callers. The raw values never go
back to the frontend; routes import the resulting cookie header into the
existing HttpOnly cookie persistence.
"""
import base64
import ctypes
import json
import os
import shutil
import sqlite3
import tempfile
from ctypes import wintypes

from Crypto.Cipher import AES

from .bilibili_client import BilibiliError


BILI_COOKIE_NAMES = {
    'SESSDATA',
    'bili_jct',
    'DedeUserID',
    'DedeUserID__ckMd5',
    'sid',
    'buvid3',
    'buvid4',
    'b_nut',
}


class DATA_BLOB(ctypes.Structure):
    _fields_ = [('cbData', wintypes.DWORD), ('pbData', ctypes.POINTER(ctypes.c_char))]


def import_bilibili_cookies_from_browser():
    errors = []
    for browser_name, root in _browser_roots():
        if not os.path.isdir(root):
            continue
        try:
            master_key = _load_master_key(root)
        except Exception as e:
            errors.append('%s Local State: %s' % (browser_name, e))
            master_key = None
        for profile in _profiles(root):
            try:
                cookies = _read_profile_cookies(profile, master_key)
            except Exception as e:
                errors.append('%s/%s: %s' % (browser_name, os.path.basename(profile), e))
                continue
            if _has_login_cookie(cookies):
                text = '; '.join('%s=%s' % (name, value) for name, value in cookies.items())
                return {
                    'cookie_text': text,
                    'source': '%s %s' % (browser_name, os.path.basename(profile)),
                    'count': len(cookies),
                    'names': sorted(cookies.keys()),
                }
    reason = '未找到 B 站登录 Cookie'
    if errors:
        reason += '；' + '；'.join(errors[:3])
    raise BilibiliError('cookie-not-found', reason, retryable=False)


def _browser_roots():
    local = os.environ.get('LOCALAPPDATA') or ''
    if not local:
        return []
    return [
        ('Chrome', os.path.join(local, 'Google', 'Chrome', 'User Data')),
        ('Edge', os.path.join(local, 'Microsoft', 'Edge', 'User Data')),
    ]


def _profiles(root):
    names = ['Default']
    try:
        names.extend(name for name in os.listdir(root) if name.startswith('Profile '))
    except OSError:
        pass
    for name in names:
        path = os.path.join(root, name)
        if os.path.isfile(os.path.join(path, 'Network', 'Cookies')):
            yield path


def _load_master_key(root):
    state_path = os.path.join(root, 'Local State')
    with open(state_path, 'r', encoding='utf-8') as fh:
        state = json.load(fh)
    encoded = ((state.get('os_crypt') or {}).get('encrypted_key') or '')
    if not encoded:
        return None
    raw = base64.b64decode(encoded)
    if raw.startswith(b'DPAPI'):
        raw = raw[5:]
    return _crypt_unprotect_data(raw)


def _read_profile_cookies(profile, master_key):
    cookie_db = os.path.join(profile, 'Network', 'Cookies')
    fd, temp_path = tempfile.mkstemp(prefix='bili-cookies-', suffix='.sqlite')
    os.close(fd)
    try:
        shutil.copy2(cookie_db, temp_path)
        conn = sqlite3.connect(temp_path)
        try:
            rows = conn.execute(
                "select host_key, name, value, encrypted_value from cookies "
                "where host_key like '%bilibili.com'"
            ).fetchall()
        finally:
            conn.close()
    finally:
        try:
            os.remove(temp_path)
        except OSError:
            pass
    cookies = {}
    for host, name, value, encrypted_value in rows:
        if name not in BILI_COOKIE_NAMES:
            continue
        plain = value or _decrypt_cookie_value(encrypted_value, master_key)
        if plain:
            cookies[name] = plain
    return cookies


def _decrypt_cookie_value(encrypted_value, master_key):
    if not encrypted_value:
        return ''
    raw = bytes(encrypted_value)
    if raw.startswith((b'v10', b'v11')) and master_key:
        nonce = raw[3:15]
        payload = raw[15:]
        ciphertext, tag = payload[:-16], payload[-16:]
        cipher = AES.new(master_key, AES.MODE_GCM, nonce=nonce)
        return cipher.decrypt_and_verify(ciphertext, tag).decode('utf-8', 'replace')
    try:
        return _crypt_unprotect_data(raw).decode('utf-8', 'replace')
    except Exception:
        return ''


def _crypt_unprotect_data(data):
    blob_in = DATA_BLOB(len(data), ctypes.cast(ctypes.create_string_buffer(data), ctypes.POINTER(ctypes.c_char)))
    blob_out = DATA_BLOB()
    if not ctypes.windll.crypt32.CryptUnprotectData(
        ctypes.byref(blob_in), None, None, None, None, 0, ctypes.byref(blob_out)
    ):
        raise ctypes.WinError()
    try:
        return ctypes.string_at(blob_out.pbData, blob_out.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(blob_out.pbData)


def _has_login_cookie(cookies):
    return bool(cookies.get('SESSDATA') and cookies.get('DedeUserID'))
