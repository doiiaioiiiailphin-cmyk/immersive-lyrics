# -*- coding: utf-8 -*-
"""歌词解析模块 - 共享给 serve.py(在线) 和 build_lyrics.py(离线)。

输出语言无关的统一结构:
    {
        "mode": "word" | "line" | "none",
        "lines": [
            {
                "start": float, "end": float,
                "text": str, "translation": str, "romanization": str,
                "words": [{"text": str, "start": float, "end": float}]
            }
        ]
    }

P0 修复要点:
    - 小数位按位数计算（.5=0.5, .50=0.50, .500=0.500），不再统一 /1000
    - 翻译匹配限制绝对时间差（≤0.5s），避免远距离泄漏
    - 支持一行多个时间戳 [00:10.00][00:20.00]chorus
    - 解析后按时间排序 + 去重
    - yrc 词文本用区间切片，不靠正则（支持文本含括号）
    - 保留原始 token，不加多余空格（中日文不被破坏）
    - 不擅自删 * 等字符
    - 元数据按结构化标签 [ar:]/[ti:] 识别，不靠正文猜测
    - duration 用 math.isfinite 校验
    - offset 解析后 clamp 到 ≥0
    - 行结束时间不超过下一行 start
"""
import math
import re

# yrc: [startMs,durMs] + body
_YRC_LINE_RE = re.compile(r'^\[(\d+),(\d+)\](.*)$')
# yrc 词标记: (startMs,durMs,0)  —— 用 finditer 定位标记位置
_YRC_MARK_RE = re.compile(r'\((\d+),(\d+),\d+\)')
# lrc 时间标签: [mm:ss.frac]  frac 可以是任意位数
_LRC_TIME_RE = re.compile(r'\[(\d+):(\d+)[.:](\d+)\]')
# 结构化元数据标签
_LRC_META_RE = re.compile(r'^\[([a-zA-Z]+):(.*)\]$')


def parse_netease_lyrics(lrc_txt, yrc_txt, trans_txt, duration=None, offset=0.0):
    """解析网易云歌词数据。"""
    # P0-98: duration 校验
    if duration is not None:
        if not isinstance(duration, (int, float)) or not math.isfinite(duration) or duration < 0 or duration > 86400:
            duration = None
    # P0-99: offset clamp
    offset = max(0.0, float(offset or 0.0))

    trans_map = _parse_lrc_timestamps(trans_txt)

    if yrc_txt and yrc_txt.strip():
        lines = _parse_yrc(yrc_txt, trans_map, offset)
        if lines:
            lines = _sort_dedupe(lines)
            _fill_end_times(lines, duration)
            return {'mode': 'word', 'lines': lines}

    if lrc_txt and lrc_txt.strip():
        lines = _parse_lrc(lrc_txt, trans_map, offset)
        if lines:
            lines = _sort_dedupe(lines)
            _fill_end_times(lines, duration)
            return {'mode': 'line', 'lines': lines}

    return {'mode': 'none', 'lines': []}


def _frac_to_seconds(frac_str):
    """P0-88: 按位数计算小数秒。
    .5 -> 0.5, .50 -> 0.50, .500 -> 0.500, .123 -> 0.123
    """
    if not frac_str:
        return 0.0
    n = len(frac_str)
    return int(frac_str) / (10 ** n)


def _parse_lrc_timestamps(text):
    """把 lrc/tlyric 文本解析为 {秒: 文本} 字典。

    P0-90: 支持一行多个时间戳 [00:10.00][00:20.00]chorus。
    P0-88: 小数位按位数计算。
    """
    result = {}
    if not text:
        return result
    for line in text.split('\n'):
        line = line.rstrip('\r')
        # 提取所有前导时间标签
        times = []
        rest = line
        while True:
            m = _LRC_TIME_RE.match(rest)
            if not m:
                break
            mm, ss, frac = int(m.group(1)), int(m.group(2)), m.group(3)
            t = mm * 60 + ss + _frac_to_seconds(frac)
            times.append(round(t, 3))
            rest = rest[m.end():]
        text_content = rest.strip()
        if text_content and text_content != '//' and times:
            for t in times:
                result[t] = text_content
    return result


def _match_translation(trans_map, line_start_raw, threshold=0.5):
    """P0-89: 翻译匹配限制绝对时间差。
    只匹配 |translation_t - line_start| <= threshold 的翻译。
    """
    best = ''
    best_diff = threshold
    for t, text in trans_map.items():
        diff = abs(t - line_start_raw)
        if diff <= best_diff:
            best_diff = diff
            best = text
    return best


def _parse_yrc(yrc_txt, trans_map, offset):
    """解析 yrc 逐字歌词。P0-95: 用标记位置区间切片，不靠正则。"""
    lines = []
    for raw_line in yrc_txt.split('\n'):
        raw_line = raw_line.rstrip('\r')
        if not raw_line.strip():
            continue
        lm = _YRC_LINE_RE.match(raw_line)
        if not lm:
            continue
        line_start_ms = int(lm.group(1))
        body = lm.group(3)
        line_start_raw = round(line_start_ms / 1000, 3)

        # 找所有词标记位置，按区间切片
        marks = list(_YRC_MARK_RE.finditer(body))
        words = []
        for i, mk in enumerate(marks):
            wstart = int(mk.group(1))
            wdur = int(mk.group(2))
            # 文本区间：从本标记结束到下一标记开始（或行尾）
            text_start = mk.end()
            text_end = marks[i + 1].start() if i + 1 < len(marks) else len(body)
            wtext = body[text_start:text_end].strip()
            if not wtext:
                continue
            ws = round(wstart / 1000 + offset, 3)
            we = round((wstart + wdur) / 1000 + offset, 3)
            if we <= ws:
                we = round(ws + 0.05, 3)
            # P0-94: 不删 * 等字符，保留原始
            words.append({'text': wtext, 'start': ws, 'end': we})

        if not words:
            continue

        # P0-93: 保留原始 token 拼接，不加空格（避免破坏中日文）
        line_text = ''.join(w['text'] for w in words)
        translation = _match_translation(trans_map, line_start_raw)
        start = round(line_start_ms / 1000 + offset, 3)
        end = words[-1]['end']

        lines.append({
            'start': start, 'end': end,
            'text': line_text, 'translation': translation,
            'romanization': '',
            'words': words,
        })
    return lines


def _parse_lrc(lrc_txt, trans_map, offset):
    """解析 lrc 行级歌词（降级模式）。P0-100: 结构化元数据标签识别。"""
    lines = []
    for line in lrc_txt.split('\n'):
        line = line.rstrip('\r')
        # P0-100: 先识别结构化元数据标签（[ar:][ti:][al:][offset:] 等），跳过
        meta = _LRC_META_RE.match(line.strip())
        if meta and not _LRC_TIME_RE.match(line):
            # 是元数据行（不以时间标签开头）
            continue
        # 提取所有前导时间标签
        times = []
        rest = line
        while True:
            m = _LRC_TIME_RE.match(rest)
            if not m:
                break
            mm, ss, frac = int(m.group(1)), int(m.group(2)), m.group(3)
            t = mm * 60 + ss + _frac_to_seconds(frac)
            times.append(round(t, 3))
            rest = rest[m.end():]
        text = rest.strip()
        if not text or not times:
            continue
        for t_raw in times:
            translation = _match_translation(trans_map, t_raw)
            start = round(t_raw + offset, 3)
            lines.append({
                'start': start, 'end': start,
                'text': text, 'translation': translation,
                'romanization': '',
                'words': [{'text': text, 'start': start, 'end': start}],
            })
    return lines


def _sort_dedupe(lines):
    """P0-91: 按时间排序 + 去重。"""
    lines.sort(key=lambda x: x['start'])
    seen = set()
    result = []
    for ln in lines:
        key = (round(ln['start'], 3), ln['text'])
        if key in seen:
            continue
        seen.add(key)
        result.append(ln)
    return result


def _fill_end_times(lines, duration):
    """补全每行的结束时间。P0-92: 非最后一行 end 不超下一行 start。"""
    if not lines:
        return
    for i in range(len(lines) - 1):
        next_start = lines[i + 1]['start']
        # 行结束 = 下一行开始，但不少于本行 start
        end = max(lines[i]['start'], min(lines[i]['end'], next_start))
        # 但若逐字末词更早结束，取下一行 start 更合理
        lines[i]['end'] = end
        if len(lines[i]['words']) == 1:
            lines[i]['words'][0]['end'] = end
    last = lines[-1]
    if last['end'] <= last['start']:
        last['end'] = duration if (duration and duration > last['start']) else last['start'] + 5
    if len(last['words']) == 1:
        last['words'][0]['end'] = last['end']


def to_legacy_format(parsed):
    """把 {mode,lines} 转回老的 {en,cn,words} 数组格式。"""
    legacy = []
    for line in parsed['lines']:
        words = [[w['text'], w['start'], w['end']] for w in line['words']]
        legacy.append({
            'en': line['text'],
            'cn': line['translation'],
            'words': words,
        })
    return legacy
