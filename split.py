# -*- coding: utf-8 -*-
"""
Split the standalone HTML into a multi-file project.

Byte-safe strategy: read the whole file as raw UTF-8 text (decoded from UTF-8,
matching its declared charset) so Chinese lyric characters pass through untouched.
Slices of the decoded string are written back as UTF-8.
"""
import base64
import os
import re

SRC = "standalone_清透配色_去灰版.html"

with open(SRC, "r", encoding="utf-8") as f:
    html = f.read()

os.makedirs("css", exist_ok=True)
os.makedirs("js", exist_ok=True)
os.makedirs("assets", exist_ok=True)

# ---------------------------------------------------------------------------
# 1) <style>...</style>  -> css/styles.css
# ---------------------------------------------------------------------------
style_match = re.search(r"<style>(.*?)</style>", html, re.DOTALL)
assert style_match, "style block not found"
css_text = style_match.group(1).strip() + "\n"

# ---------------------------------------------------------------------------
# 2) cover image: data:image/jpeg;base64,....   -> assets/cover.jpg
# ---------------------------------------------------------------------------
cover_match = re.search(r'src="(data:image/jpeg;base64,([A-Za-z0-9+/=]+))"', html)
assert cover_match, "cover base64 not found"
cover_b64 = cover_match.group(2)
cover_bytes = base64.b64decode(cover_b64)

# ---------------------------------------------------------------------------
# 3) audio: <audio ... src="data:audio/mp4;base64,....">  -> assets/audio.mp4
# ---------------------------------------------------------------------------
audio_match = re.search(r'src="(data:audio/mp4;base64,([A-Za-z0-9+/=]+))"', html)
assert audio_match, "audio base64 not found"
audio_b64 = audio_match.group(2)
audio_bytes = base64.b64decode(audio_b64)

# ---------------------------------------------------------------------------
# 4) <script> blocks:  first = silk-background, second = player
# ---------------------------------------------------------------------------
scripts = re.findall(r"<script>(.*?)</script>", html, re.DOTALL)
assert len(scripts) == 2, f"expected 2 script blocks, found {len(scripts)}"
silk_js = scripts[0].strip() + "\n"
player_js = scripts[1].strip() + "\n"

# ---------------------------------------------------------------------------
# Write assets + css + js
# ---------------------------------------------------------------------------
with open("assets/cover.jpg", "wb") as f:
    f.write(cover_bytes)
with open("assets/audio.mp4", "wb") as f:
    f.write(audio_bytes)
with open("css/styles.css", "w", encoding="utf-8") as f:
    f.write(css_text)
with open("js/silk-background.js", "w", encoding="utf-8") as f:
    f.write(silk_js)
with open("js/player.js", "w", encoding="utf-8") as f:
    f.write(player_js)

# ---------------------------------------------------------------------------
# 5) Build index.html
#    - strip the <style>...</style> block, replace with <link>
#    - replace cover data uri with relative path
#    - replace audio data uri with relative path
#    - replace the two <script> blocks with <script src=...>
# ---------------------------------------------------------------------------
out = html

# remove inline style block (and the blank line it leaves)
out = re.sub(r"<style>.*?</style>\s*", "", out, count=1, flags=re.DOTALL)
# inject stylesheet link + a banner comment in place of removed style
out = out.replace(
    "<head>\n",
    "<head>\n<link rel=\"stylesheet\" href=\"css/styles.css\">\n",
    1,
)

# cover image
out = out.replace(cover_match.group(1), "assets/cover.jpg")
# audio
out = out.replace(audio_match.group(1), "assets/audio.mp4")

# script blocks -> external. We rewrite them in order of appearance.
def _replace_script(text, idx, src_path):
    pattern = re.compile(r"<script>.*?</script>", re.DOTALL)
    matches = list(pattern.finditer(text))
    m = matches[idx]
    return text[: m.start()] + f'<script src="{src_path}"></script>' + text[m.end():]

out = _replace_script(out, 0, "js/silk-background.js")
out = _replace_script(out, 0, "js/player.js")  # after first replacement, player is now at index 0

with open("index.html", "w", encoding="utf-8") as f:
    f.write(out)

# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------
def kb(n):
    return f"{n/1024:.1f} KB"

print("Done. Output sizes:")
print(f"  index.html            {kb(len(out.encode('utf-8'))):>10}")
print(f"  css/styles.css        {kb(len(css_text.encode('utf-8'))):>10}")
print(f"  js/silk-background.js {kb(len(silk_js.encode('utf-8'))):>10}")
print(f"  js/player.js          {kb(len(player_js.encode('utf-8'))):>10}")
print(f"  assets/cover.jpg      {kb(len(cover_bytes)):>10}")
print(f"  assets/audio.mp4      {kb(len(audio_bytes)):>10}")
print(f"  total audio b64 input -> decoded bytes: {len(audio_bytes)}")
