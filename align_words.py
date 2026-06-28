# -*- coding: utf-8 -*-
"""把 faster-whisper 的逐词识别(words.json) 与标准歌词对齐，输出 js/lyrics-timed.js
每个标准歌词词都获得精确 start/end 时间戳。"""
import io, sys, json, re
import difflib
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

words = json.load(open('words.json', encoding='utf-8'))

# 标准歌词（英文, 中文, 句开始时间）—— 与 player.js 的 data 一致
LYRICS = [
    ("制作：Doc McKinney / Mano / Cirkut", "", 0.0),
    ("•••", "", 0.0),
    ("Recommend play my song on the radio", "强烈推荐广播上放我的歌", 23.7),
    ("You too busy tryna find that blue-eyed soul", "而你还在寻找灵魂深处的声音", 26.7),
    ("I let my black hair grow and my weed smoke", "我蓄起长发 点燃香烟", 29.7),
    ("And I swear too much on the regular", "而我小事总爱发誓", 32.7),
    ("We gon' let them hits fly", "我们让它尽情迸发", 35.7),
    ("We next so, then it gotta go", "接下来 随它而去", 39.8),
    ("I just won a new award for a kids show", "我刚为儿童节目拿了新奖", 41.8),
    ("Talking 'bout a face numb off a bag of blow", "谈论着一张被可卡因麻痹的脸", 44.8),
    ("I'm like goddamn, bitch, I am not a Teen Choice", "我心想该死 我可不是青少年之选", 47.8),
    ("I am not a bubble cup, I'm mixing up the potion", "我可不像纸杯般脆弱 正在调制魔药", 52.3),
    ("I'm like, niggas tryna sound like all my ocean", "我心想 这些人想模仿我的浪潮", 106.0),
    ("Everybody knows it, all these niggas only", "所有人都知道 这些家伙只会", 108.4),
    ("Platinum off a mixtape, sipping on that codeine", "靠混音带拿白金 喝着可待因", 111.3),
    ("Pourin' up my trophies, rollin' up my nosebleed", "倒满我的奖杯 卷起钞票到流鼻血", 114.4),
    ("I'ma keep on singin' while I'm burning up that OG", "我要继续歌唱 燃尽那株 OG", 117.4),
    ("All my niggas scared that they may not be alone", "我的人都怕自己不够独特", 120.4),
    ("Rock a chain around the neck, makin' sure I'm good to my city", "脖子挂着链子 确保对城市尽责", 123.0),
    ("I fuck every girl I know", "我跟我认识的每个女孩都上床", 130.5),
    ("Used to rock around with a smile, mattress on the floor", "曾经挂着微笑四处游荡 床垫铺地板", 131.9),
    ("Now my shit straight, eating all day, trying to lose weight", "如今我一切顺遂 整天吃还想减肥", 134.9),
]


def normalize(w):
    """小写、去标点，用于模糊匹配"""
    return re.sub(r"[^a-z0-9']", '', w.lower())


def split_std(line):
    """标准歌词行 → 词列表（保留原文显示，含标点）"""
    # 按 "'" 和空格切，保留缩写如 I'm, gon', 'bout
    return [t for t in re.findall(r"\S+", line)]


def align_sentence(std_words, rec_words):
    """对齐一句：标准词序列 vs 识别词序列(带时间)，返回每个标准词的 [start,end]
    用 difflib 在归一化后的词上做序列对齐。"""
    if not rec_words:
        # 这句没有识别词（前导/间奏行），用行的开始时间填充所有词
        return None  # 调用方处理

    std_norm = [normalize(w) for w in std_words]
    rec_norm = [normalize(w['word']) for w in rec_words]

    sm = difflib.SequenceMatcher(a=std_norm, b=rec_norm, autojunk=False)
    # 建立 std索引 -> 匹配到的 rec词列表 的映射
    std_to_rec = {i: [] for i in range(len(std_words))}
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == 'equal':
            for k in range(i2 - i1):
                std_to_rec[i1 + k].append(rec_words[j1 + k])
        elif tag == 'replace':
            # 一对多/多对一：把这段 rec 词平均分配给这段 std 词
            std_seg = list(range(i1, i2))
            rec_seg = rec_words[j1:j2]
            # 把 rec_seg 尽量均匀分给 std_seg
            for idx, si in enumerate(std_seg):
                # 每个标准词负责一段识别词
                share = len(rec_seg) // len(std_seg) if std_seg else 0
                start_i = idx * share if idx < len(std_seg) - 1 else idx * share
                end_i = (idx + 1) * share if idx < len(std_seg) - 1 else len(rec_seg)
                std_to_rec[si] = rec_seg[start_i:end_i] or std_to_rec[si]
        # insert/delete: 不映射，后面用插值补

    result = []
    for i, w in enumerate(std_words):
        recs = std_to_rec.get(i, [])
        if recs:
            s = min(r['start'] for r in recs)
            e = max(r['end'] for r in recs)
        else:
            result.append(None)  # 待插值
            continue
        result.append((round(s, 2), round(e, 2)))

    # 插值补 None：用前后已知时间点线性插值
    # 找该句整体的起止
    line_start = min(r['start'] for r in rec_words)
    line_end = max(r['end'] for r in rec_words)
    n = len(std_words)
    for i in range(n):
        if result[i] is not None:
            continue
        # 前一个已知词的 end
        prev_t = result[i - 1][1] if (i > 0 and result[i - 1]) else line_start
        # 下一个已知词的 start
        next_t = None
        for j in range(i + 1, n):
            if result[j] is not None:
                next_t = result[j][0]
                break
        if next_t is None:
            next_t = line_end
        # 该词占据 [prev_t, next_t] 区间的一部分（前 60%）
        s = round(prev_t, 2)
        e = round(prev_t + (next_t - prev_t) * 0.6, 2)
        if e <= s:
            e = round(s + 0.12, 2)  # 最小 120ms 时长，避免零长度
        result[i] = (s, e)
    # 再扫一遍：确保没有任何 start>=end 的零长度词
    for i in range(n):
        s, e = result[i]
        if e <= s:
            result[i] = (s, round(s + 0.15, 2))
    return result


# 按句开始时间切分识别词
def words_in_range(s, e):
    return [w for w in words if s <= w['start'] < e]


out = []
prev_end_time = 0
for idx, (en, cn, start) in enumerate(LYRICS):
    # 该句的结束时间 = 下一句的开始（或最后一句用音频末尾 232）
    end = LYRICS[idx + 1][2] if idx + 1 < len(LYRICS) else 232.0
    std_words = split_std(en)

    if start == 0.0 or not std_words:
        # 前导行（制作信息/•••），无逐词
        out.append({"en": en, "cn": cn, "words": []})
        continue

    rec = words_in_range(start, end)
    aligned = align_sentence(std_words, rec)
    if aligned is None:
        # 无识别词覆盖，用句开始时间均分
        per = (end - start) / max(len(std_words), 1)
        aligned = [(round(start + i * per, 2), round(start + (i + 1) * per, 2)) for i in range(len(std_words))]

    # 后处理：修复跨间奏的孤立词段（如行11 "I am not"@52 + "a bubble cup"@100）
    # 扫描相邻词时间跳变 >4s：跳变前若是少数词(孤立尾音)→平移到后段前；跳变后若是少数词(孤立补字)→压缩间隙
    n = len(aligned)
    if n >= 3:
        for i in range(1, n):
            gap = aligned[i][0] - aligned[i - 1][1]
            if gap > 4.0:
                front = i
                back = n - i
                if front <= back and front <= 4:
                    # 前段少数词：整体平移到跳变后段之前衔接
                    front_span = aligned[front - 1][1] - aligned[0][0]
                    target_start = aligned[i][0] - front_span - 0.3
                    shift = target_start - aligned[0][0]
                    for k in range(front):
                        s, e = aligned[k]
                        aligned[k] = (round(s + shift, 2), round(e + shift, 2))
                elif back <= 4:
                    # 后段少数词：把它们的 start 往前拉，填补间隙（保留轻微停顿 0.4s）
                    prev_end = aligned[i - 1][1]
                    for k in range(i, n):
                        s, e = aligned[k]
                        dur = e - s
                        new_s = round(prev_end + 0.4, 2) if k == i else round(aligned[k - 1][1] + 0.05, 2)
                        aligned[k] = (new_s, round(new_s + dur, 2))
                break  # 一句只处理第一个大跳变

    word_data = [[std_words[i], aligned[i][0], aligned[i][1]] for i in range(len(std_words))]
    out.append({"en": en, "cn": cn, "words": word_data})

# 输出 js/lyrics-timed.js
with open('js/lyrics-timed.js', 'w', encoding='utf-8') as f:
    f.write('// 逐词歌词数据：每个词 [文本, start秒, end秒]，由 faster-whisper 识别对齐生成\n')
    f.write('window.LYRICS = ')
    json.dump(out, f, ensure_ascii=False, indent=1)
    f.write(';\n')

# 诊断：打印前3句的对齐结果
print("=== 对齐诊断（前3个有词的句）===")
shown = 0
for item in out:
    if not item['words']:
        continue
    print("\n句:", item['en'])
    for w, s, e in item['words']:
        print(f"  {s:>6.2f}-{e:<6.2f}  {w}")
    shown += 1
    if shown >= 3:
        break

total_words = sum(len(it['words']) for it in out)
print(f"\n总行数: {len(out)}, 总词数: {total_words}")
print("已输出 js/lyrics-timed.js")
