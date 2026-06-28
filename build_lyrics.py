# -*- coding: utf-8 -*-
"""从网易云获取逐字歌词(yrc)+翻译(lrc)，生成 js/lyrics-timed-{id}.js

解析逻辑已抽到 api/lyrics_parser.py，本脚本只负责:
    1. fetch 网易云歌词数据
    2. 调 parse_netease_lyrics 解析
    3. 转 legacy 格式 + 应用特定歌曲补丁
    4. 写出 js 文件
"""
import io, sys, re, json, urllib.request
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# 复用共享解析模块
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from api.lyrics_parser import parse_netease_lyrics, to_legacy_format

SONG_ID = '2308549'  # My Heart Will Go On - Céline Dion
OFFSET = 0.0


def fetch(url):
    req = urllib.request.Request(url, headers={'Referer': 'https://music.163.com', 'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode('utf-8'))


print('获取歌词...')
data = fetch(f'https://music.163.com/api/song/lyric?id={SONG_ID}&lv=1&kv=1&tv=-1&yv=1&yvtc=1')
lrc_txt = data.get('lrc', {}).get('lyric', '')
yrc_txt = data.get('yrc', {}).get('lyric', '')
cn_txt = data.get('tlyric', {}).get('lyric', '')
print(f'lrc: {len(lrc_txt)} chars, yrc: {len(yrc_txt)} chars, cn: {len(cn_txt)} chars')
if not yrc_txt:
    print('警告：未获取到逐字歌词 yrc，将降级为行级歌词')

# 用共享模块解析
parsed = parse_netease_lyrics(lrc_txt, yrc_txt, cn_txt, duration=None, offset=OFFSET)
print(f'解析完成: mode={parsed["mode"]}, {len(parsed["lines"])} 行')

# 转为老格式 {en,cn,words}，保持与现有歌词文件兼容
out = to_legacy_format(parsed)

# === 泰坦尼克时间轴修复补丁 (SONG_ID=2308549) ===
# 网易云 yrc 在 "In my life"/"music"/"You're here" 三行时间轴错乱：
#   - "In my life" 的 "go on" 被拉到 140.94→160.59s（"go" 持续 20 秒，不合理）
#   - "music" 提前到 164s（应 187s，长笛间奏开始）
#   - "You're here" 提前到 175s（应 205s，真正的人声）
#   - 还塞了个 32 秒的魔鬼逗号 (176.61→208.59) 试图把 "You're here" 拖到 "And I know"(213s)
# 而 lrc + 翻译两套独立数据都一致指向正确时间，音频为完整版 280s。
# 修复：用 lrc 起点重写这 3 行的词级时间，按真实演唱节奏均分。
def patch_titanic(out):
    def find_exact(en_norm):
        """按归一化文本(小写、去标点空格)整行精确匹配。返回 index 或 -1。"""
        def norm(s):
            return re.sub(r'[^a-z]', '', s.lower())
        tgt = norm(en_norm)
        for i, it in enumerate(out):
            if norm(it['en']) == tgt:
                return i
        return -1

    # 1) "In my life we'll always go on." —— 修剪超长的 "go"
    i = find_exact("In my life we'll always go on")
    if i >= 0:
        ws = out[i]['words']
        go_idx = on_idx = dot_idx = -1
        for k, w in enumerate(ws):
            wl = w[0].lower()
            if wl == 'go' and go_idx < 0:
                go_idx = k
            elif wl == 'on' and on_idx < 0:
                on_idx = k
            elif wl == '.':
                dot_idx = k
        if go_idx >= 0:
            go_start = ws[go_idx][1]
            ws[go_idx][2] = round(go_start + 1.5, 2)   # go 唱 1.5s
        if on_idx >= 0:
            ws[on_idx][1] = ws[go_idx][2] if go_idx >= 0 else ws[on_idx][1]
            ws[on_idx][2] = 163.4                       # on 尾音到 163s
        if dot_idx >= 0:
            del ws[dot_idx]
        out[i]['en'] = ' '.join(w[0] for w in ws)

    # 2) "music" —— 整体平移到 187s（长笛间奏开始）
    i = find_exact('music')
    if i >= 0:
        out[i]['words'] = [['music', 187.0, 191.0]]
        out[i]['cn'] = ''

    # 3) "You're here, there's nothing I fear" —— 重建词级时间
    i = find_exact("You're here, there's nothing I fear")
    if i >= 0:
        out[i]['words'] = [
            ["You're",  205.0, 205.6],
            ["here",    205.6, 207.0],
            [",",       207.0, 207.1],
            ["there's", 207.1, 207.6],
            ["nothing", 207.6, 209.3],
            ["I",       209.3, 209.6],
            ["fear",    209.6, 211.3],
        ]
        out[i]['en'] = "You're here, there's nothing I fear"
        out[i]['cn'] = '你就在我身旁以至我全无畏惧'

if SONG_ID == '2308549':
    patch_titanic(out)
    print('已应用泰坦尼克时间轴修复补丁')
# === 补丁结束 ===

outFile = f'js/lyrics-timed-{SONG_ID}.js'
with open(outFile, 'w', encoding='utf-8') as f:
    f.write(f'// 逐词歌词：网易云官方yrc，已对齐音频(偏移+{OFFSET}s)。由 build_lyrics.py 生成\n')
    f.write(f'window.LYRICS_{SONG_ID} = ')  # 每首歌独立变量名，避免互相覆盖
    json.dump(out, f, ensure_ascii=False, indent=1)
    f.write(';\n')

print(f'\n生成完成: {len(out)} 行, {sum(len(it["words"]) for it in out)} 词, OFFSET=+{OFFSET}s')
print('\n=== 前5行验证 ===')
for it in out[:5]:
    t0, t1 = it['words'][0][1], it['words'][-1][2]
    print(f'[{t0}-{t1}s] {it["en"][:45]}')
