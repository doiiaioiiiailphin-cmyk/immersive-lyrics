# -*- coding: utf-8 -*-
"""QQ Music QRC lyric decoding and parsing.

The QQ web lyric API only returns line-level LRC. QQ's PC lyric download
endpoint can return encrypted QRC, which carries word-level timings. This
module keeps that provider-specific work out of qq_client.py.
"""
import html
import re
import zlib


_QRC_LINE_RE = re.compile(r'^\[(\d+),(\d+)\](.*)$')
_QRC_WORD_RE = re.compile(r'\((\d+),(\d+)(?:,\d+)?\)')
_LRC_LINE_RE = re.compile(r'^\[(\d+):(\d+)[.:](\d+)\](.*)$')
_LYRIC_CONTENT_RE = re.compile(r'LyricContent="(.*?)"', re.S)

def decode_qrc_payload(payload):
    """Decode encrypted QQ QRC bytes into text."""
    if not payload:
        return ''
    try:
        from . import qq_qrc_des
        for name in ('s_box1', 's_box2', 's_box3', 's_box4', 's_box5', 's_box6', 's_box7', 's_box8'):
            value = getattr(qq_qrc_des, name, None)
            if value is not None and not isinstance(value, list):
                setattr(qq_qrc_des, name, [int(item) for item in value])
        data = bytes(qq_qrc_des.lyric_decode(bytearray(payload), len(payload)))
        try:
            raw = zlib.decompress(data, zlib.MAX_WBITS | 32)
        except zlib.error:
            raw = zlib.decompress(data)
        return raw.decode('utf-8', 'replace')
    except Exception:
        return ''


def extract_qrc_text(decoded):
    """Extract QRC body from QQ's XML-ish wrapper, or convert LRC fallback."""
    text = str(decoded or '').strip()
    if not text:
        return ''
    if text.startswith('<?xml') or 'LyricContent=' in text:
        match = _LYRIC_CONTENT_RE.search(text)
        if match:
            return html.unescape(match.group(1)).replace('&#10;', '\n')
    if _LRC_LINE_RE.search(text):
        return _lrc_to_qrc(text)
    return text


def parse_qrc(qrc_text, trans_text='', duration=None):
    """Parse QQ QRC text into the app lyric structure."""
    trans_map = _parse_lrc_translation(trans_text)
    lines = []
    for raw_line in str(qrc_text or '').replace('\r', '').split('\n'):
        line = raw_line.strip()
        if not line:
            continue
        match = _QRC_LINE_RE.match(line)
        if not match:
            continue
        line_start_ms = int(match.group(1))
        line_duration_ms = max(0, int(match.group(2)))
        body = match.group(3)
        marks = list(_QRC_WORD_RE.finditer(body))
        words = []
        previous_end = 0
        for mark in marks:
            word_text = body[previous_end:mark.start()]
            previous_end = mark.end()
            if not word_text:
                continue
            start_ms = int(mark.group(1))
            duration_ms = int(mark.group(2))
            start = round(start_ms / 1000, 3)
            end = round((start_ms + duration_ms) / 1000, 3)
            if end <= start:
                end = round(start + 0.05, 3)
            words.append({'text': word_text, 'start': start, 'end': end})
        if words:
            start = round(line_start_ms / 1000, 3)
            end = max(round((line_start_ms + line_duration_ms) / 1000, 3), words[-1]['end'])
            lines.append({
                'start': start,
                'end': end,
                'text': ''.join(word['text'] for word in words),
                'translation': _match_translation(trans_map, start),
                'romanization': '',
                'words': words,
            })
    if not lines:
        return {'mode': 'none', 'lines': []}
    lines.sort(key=lambda item: item['start'])
    for idx, line in enumerate(lines[:-1]):
        next_start = lines[idx + 1]['start']
        if line['end'] > next_start:
            line['end'] = next_start
            if line['words'] and line['words'][-1]['end'] > next_start:
                line['words'][-1]['end'] = next_start
    if duration is not None:
        try:
            duration = float(duration)
            if duration > 0 and lines[-1]['end'] > duration:
                lines[-1]['end'] = duration
        except (TypeError, ValueError):
            pass
    return {'mode': 'word', 'lines': lines}


def _lrc_to_qrc(text):
    rows = []
    for line in str(text or '').replace('\r', '').split('\n'):
        match = _LRC_LINE_RE.match(line.strip())
        if not match:
            continue
        mm, ss, frac, body = match.groups()
        start_ms = (int(mm) * 60 + int(ss)) * 1000 + _frac_ms(frac)
        if body:
            rows.append((start_ms, body))
    if not rows:
        return ''
    output = []
    for idx, (start_ms, body) in enumerate(rows):
        end_ms = rows[idx + 1][0] if idx + 1 < len(rows) else start_ms + 3000
        output.append('[%d,%d]%s' % (start_ms, max(50, end_ms - start_ms), body))
    return '\n'.join(output)


def _parse_lrc_translation(text):
    result = []
    for line in str(text or '').replace('\r', '').split('\n'):
        clean = line.strip()
        match = _LRC_LINE_RE.match(clean)
        if match:
            mm, ss, frac, body = match.groups()
            if body and body != '//':
                result.append(((int(mm) * 60 + int(ss)) + _frac_ms(frac) / 1000, body))
            continue
        qrc_match = _QRC_LINE_RE.match(clean)
        if qrc_match:
            body = _QRC_WORD_RE.sub('', qrc_match.group(3)).strip()
            if body and body != '//':
                result.append((int(qrc_match.group(1)) / 1000, body))
    return result


def _match_translation(translations, start):
    best_text = ''
    best_delta = None
    for t, text in translations:
        delta = abs(t - start)
        if delta <= 0.7 and (best_delta is None or delta < best_delta):
            best_delta = delta
            best_text = text
    return best_text


def _frac_ms(frac):
    value = str(frac or '')
    if len(value) <= 2:
        return int(value.ljust(2, '0')) * 10
    return int(value[:3].ljust(3, '0'))
