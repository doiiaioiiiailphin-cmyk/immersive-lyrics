# -*- coding: utf-8 -*-
"""生成完整单文件 HTML：所有歌曲的音频/封面/歌词/JS/CSS 全部内联。
输出 standalone.html，支持歌单切换（3首歌），双击即可用。"""
import base64, re, os, json

base = os.path.dirname(os.path.abspath(__file__))

def read(p):
    with open(os.path.join(base, p), 'r', encoding='utf-8') as f:
        return f.read()

html = read('index.html')
css = read('css/styles.css')
silk_js = read('js/silk-background.js')
player_js = read('js/player.js')

# 歌曲列表（硬编码，与 index.html 的 PLAYLIST 一致）
SONGS = [
    ('22803908', '天使にふれたよ!', '放課後ティータイム', 'assets/audio-22803908.m4a', 'assets/cover-22803908.jpg'),
    ('442869469', 'Reminder', 'The Weeknd', 'assets/audio-442869469.m4a', 'assets/cover.jpg'),
    ('2308549', 'My Heart Will Go On', 'Céline Dion', 'assets/audio-2308549.m4a', 'assets/cover-2308549.jpg'),
]

def data_uri(path, mime):
    with open(os.path.join(base, path), 'rb') as f:
        return f'data:{mime};base64,' + base64.b64encode(f.read()).decode()

# 构建内联 PLAYLIST（audio/cover 转 data URI）+ 歌词全局变量
playlist_js_lines = ['window.PLAYLIST = [']
lyrics_js = ''
for i, (sid, title, artist, audio, cover) in enumerate(SONGS):
    comma = ',' if i < len(SONGS) - 1 else ''
    playlist_js_lines.append(
        f"  {{id:'{sid}',title:'{title}',artist:'{artist}',"
        f"audio:'{data_uri(audio,'audio/mp4')}',cover:'{data_uri(cover,'image/jpeg')}'}}{comma}"
    )
    # 歌词
    lyric_path = os.path.join(base, 'js', f'lyrics-timed-{sid}.js')
    if os.path.exists(lyric_path):
        lyric_src = read(f'js/lyrics-timed-{sid}.js')
        lyrics_js += lyric_src + '\n'
playlist_js_lines.append('];')
playlist_inline = '\n'.join(playlist_js_lines) + '\n' + lyrics_js

# 改写 html：内联 CSS/JS，PLAYLIST 替换为内联 data URI 版本 + 歌词
out = html
out = re.sub(r'<link rel="stylesheet" href="css/styles\.css">',
             '<style>\n' + css.strip() + '\n</style>', out)
# 替换 PLAYLIST 块（含原注释和 script 标签）为内联版（data URI + 歌词全局变量）
out = re.sub(r'<!-- 歌单[\s\S]*?window\.PLAYLIST\s*=\s*\[[\s\S]*?\];[\s\S]*?</script>',
             '<!-- 歌单(内联) -->\n<script>\n' + playlist_inline + '</script>', out)
# 内联原 <img class="cover" src="assets/..."> 为第一首歌的封面 data URI
out = re.sub(r'<img class="cover" src="assets/[^"]*"',
             '<img class="cover" src="' + data_uri('assets/cover-22803908.jpg', 'image/jpeg') + '"', out)
# 内联 script
out = out.replace('<script src="js/silk-background.js"></script>',
                  '<script>\n' + silk_js.strip() + '\n</script>')
out = out.replace('<script src="js/player.js"></script>',
                  '<script>\n' + player_js.strip() + '\n</script>')
# 移除残留 lyrics script 标签
out = re.sub(r'<script src="js/lyrics-timed[^"]*"[^>]*></script>\n?', '', out)

with open('standalone.html', 'w', encoding='utf-8') as f:
    f.write(out)

sz = len(out.encode('utf-8'))
print(f'已生成 standalone.html ({sz//1024//1024}MB {sz%1024//1024}KB)')
ext = re.findall(r'(?:src|href)="(?!data:|#)[^"]+"', out)
print(f'  残留外部引用: {ext if ext else "无 ✅"}')
print(f'  内联 script: {len(re.findall(r"<script>", out))}')
