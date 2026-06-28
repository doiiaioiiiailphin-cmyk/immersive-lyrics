# -*- coding: utf-8 -*-
"""合并为30秒版的单文件 HTML：CSS/JS 内联，封面+30秒音频 base64 嵌入。
输出 standalone_30s.html。"""
import base64, re, os

base = os.path.dirname(os.path.abspath(__file__))

def read(p):
    with open(os.path.join(base, p), 'r', encoding='utf-8') as f:
        return f.read()

html = read('index.html')
css = read('css/styles.css')
silk_js = read('js/silk-background.js')
lyrics_js = read('js/lyrics-timed.js')
player_js = read('js/player.js')

with open(os.path.join(base, 'assets/cover.jpg'), 'rb') as f:
    cover_b64 = base64.b64encode(f.read()).decode()
with open(os.path.join(base, 'assets/audio_30s.m4a'), 'rb') as f:
    audio_b64 = base64.b64encode(f.read()).decode()

out = html
out = re.sub(r'<link rel="stylesheet" href="css/styles\.css">',
             f'<style>\n{css.strip()}\n</style>', out)
out = out.replace('src="assets/cover.jpg"',
                  f'src="data:image/jpeg;base64,{cover_b64}"')
out = out.replace('src="assets/audio_full.m4a"',
                  f'src="data:audio/mp4;base64,{audio_b64}"')

def replace_script(text, src_path, content):
    return text.replace(f'<script src="{src_path}"></script>',
                        f'<script>\n{content.strip()}\n</script>')

out = replace_script(out, 'js/silk-background.js', silk_js)
out = replace_script(out, 'js/lyrics-timed.js', lyrics_js)
out = replace_script(out, 'js/player.js', player_js)

with open('standalone_30s.html', 'w', encoding='utf-8') as f:
    f.write(out)

def kb(n): return f'{n/1024:.1f} KB'
print('已生成 standalone_30s.html')
print(f'  总大小: {kb(len(out.encode("utf-8")))}')
print(f'  音频(30s) base64: {kb(len(audio_b64))}')
ext = re.findall(r'(?:src|href)="(?!data:|#)[^"]+"', out)
print(f'  残留外部引用: {ext if ext else "无 ✅"}')
