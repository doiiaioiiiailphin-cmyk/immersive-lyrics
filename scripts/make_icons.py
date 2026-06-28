from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter
import math


ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / 'build'
PNG = BUILD / 'icon.png'
ICO = BUILD / 'icon.ico'
SIZE = 1024


def rounded_mask(size, radius):
    mask = Image.new('L', (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def linear_gradient(top, bottom):
    img = Image.new('RGBA', (SIZE, SIZE))
    px = img.load()
    for y in range(SIZE):
        t = y / (SIZE - 1)
        col = tuple(round(top[i] * (1 - t) + bottom[i] * t) for i in range(4))
        for x in range(SIZE):
            px[x, y] = col
    return img


def draw_soft_highlight(base):
    glow = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(glow)
    draw.ellipse((-90, -120, 720, 610), fill=(255, 255, 255, 72))
    draw.ellipse((540, 30, 1240, 640), fill=(179, 239, 255, 42))
    glow = glow.filter(ImageFilter.GaussianBlur(42))
    base.alpha_composite(glow)


def draw_wave(base):
    wave = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(wave)
    pts = [
        (88, 705), (245, 555), (402, 615), (560, 490),
        (715, 365), (850, 290), (936, 250),
        (936, 704), (934, 752), (918, 808), (884, 858),
        (838, 900), (780, 932), (704, 936),
        (320, 936), (244, 932), (186, 900), (140, 858),
        (106, 808), (90, 752),
    ]
    draw.polygon(pts, fill=(255, 255, 255, 72))
    base.alpha_composite(wave)


def music_note_path(scale=1):
    # Cubic Bezier samples for a curved glass note.
    def bez(p0, p1, p2, p3, steps=18):
        out = []
        for i in range(steps + 1):
            t = i / steps
            x = (1 - t) ** 3 * p0[0] + 3 * (1 - t) ** 2 * t * p1[0] + 3 * (1 - t) * t ** 2 * p2[0] + t ** 3 * p3[0]
            y = (1 - t) ** 3 * p0[1] + 3 * (1 - t) ** 2 * t * p1[1] + 3 * (1 - t) * t ** 2 * p2[1] + t ** 3 * p3[1]
            out.append((x * scale, y * scale))
        return out

    left = []
    left += bez((700, 148), (628, 214), (542, 250), (446, 262), steps=12)
    left += bez((446, 262), (397, 268), (372, 314), (372, 360), steps=10)
    left += [(372 * scale, 646 * scale)]
    left += bez((372, 646), (322, 610), (238, 620), (184, 676), steps=12)
    left += bez((184, 676), (116, 748), (150, 834), (250, 838), steps=14)
    left += bez((250, 838), (348, 842), (418, 778), (418, 704), steps=12)
    left += [(418 * scale, 416 * scale)]
    left += bez((418, 416), (420, 385), (438, 362), (472, 356), steps=8)
    left += bez((472, 356), (544, 344), (606, 320), (664, 284), steps=10)
    left += [(664 * scale, 598 * scale)]
    left += bez((664, 598), (614, 566), (532, 578), (482, 634), steps=12)
    left += bez((482, 634), (415, 708), (452, 790), (550, 792), steps=14)
    left += bez((550, 792), (646, 794), (716, 730), (716, 654), steps=12)
    left += [(716 * scale, 188 * scale)]
    left += bez((716, 188), (716, 154), (706, 144), (700, 148), steps=5)
    return left


def draw_note(base):
    shadow = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    pts = music_note_path()
    sd.polygon([(x, y + 42) for x, y in pts], fill=(25, 132, 184, 58))
    shadow = shadow.filter(ImageFilter.GaussianBlur(34))
    base.alpha_composite(shadow)

    note = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    nd = ImageDraw.Draw(note)
    nd.polygon(pts, fill=(235, 250, 255, 172))
    nd.line(pts + [pts[0]], fill=(255, 255, 255, 210), width=26, joint='curve')
    nd.line([(458, 400), (538, 386), (620, 348), (694, 296)], fill=(255, 255, 255, 160), width=17)
    nd.arc((218, 644, 390, 816), start=202, end=324, fill=(255, 255, 255, 118), width=13)
    nd.arc((518, 608, 690, 780), start=202, end=324, fill=(255, 255, 255, 108), width=13)
    note = note.filter(ImageFilter.GaussianBlur(0.2))
    base.alpha_composite(note)


def main():
    BUILD.mkdir(exist_ok=True)
    base = linear_gradient((250, 253, 255, 255), (180, 228, 255, 255))
    draw_soft_highlight(base)
    draw_wave(base)
    draw_note(base)
    mask = rounded_mask(SIZE, 232)
    base.putalpha(mask)
    base.save(PNG)
    sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    base.save(ICO, sizes=sizes)
    print(f'generated {PNG}')
    print(f'generated {ICO}')


if __name__ == '__main__':
    main()
