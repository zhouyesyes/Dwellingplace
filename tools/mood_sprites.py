# 用法：python3 tools/mood_sprites.py <预览图输出目录> .    （第二个参数是栖所的目录）
# 小章鱼跟水温变：在原来的待机那一帧（public/pet/idle.png）上改，原来的动作一个不动。
# 会写 public/pet/m-*.png 和 src/lib/petMoodFrames.js。道具只有几格像素、一两种颜色
import sys, os, json
from PIL import Image
OUT, ROOT = sys.argv[1], sys.argv[2]
BG = (238, 236, 229)
W, H = 32, 20
BODY = (74, 99, 135); EYE = (28, 28, 34)
C = {'Y': (236, 196, 90), 'w': (198, 205, 216), 'B': (112, 160, 214), 'g': (150, 154, 164)}
idle = Image.open(os.path.join(ROOT, 'public/pet/idle.png')).convert('RGBA').crop((0, 0, W, H))

def base(squash=()):
    """从待机第一帧起步；squash：要抽掉的身体行（上面的往下落，脚不动）"""
    px = {(x, y): idle.getpixel((x, y)) for x in range(W) for y in range(H) if idle.getpixel((x, y))[3]}
    for (x, y), c in list(px.items()):
        if c[:3] == EYE: px[(x, y)] = BODY + (255,)   # 先抹掉眼睛，后面自己画
    for r in sorted(squash, reverse=True):
        px = {((x, y + 1) if y < r else (x, y)): c for (x, y), c in px.items() if y != r}
    return px
def put(px, x, y, c):
    if 0 <= x < W and 0 <= y < H: px[(x, y)] = (C[c] if c in C else EYE if c == 'E' else BODY) + (255,)
def eyes(px, kind, y=9, dy=0):
    for x in (18, 23):
        if kind == 'dot': put(px, x, y + dy, 'E'); put(px, x, y + dy + 1, 'E')
        if kind == 'blink': put(px, x, y + dy + 1, 'E')
        if kind == 'shut':
            for a in (-1, 0, 1): put(px, x + a, y + dy + 1, 'E')
        if kind == 'happy': put(px, x - 1, y + dy + 1, 'E'); put(px, x, y + dy, 'E'); put(px, x + 1, y + dy + 1, 'E')
def rows(px, rs, x0, y0):
    for j, r in enumerate(rs):
        for i, c in enumerate(r):
            if c != '.': put(px, x0 + i, y0 + j, c)
def img(px):
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    for p, c in px.items(): im.putpixel(p, c)
    return im

def bottle(blink=False):
    px = base(); eyes(px, 'blink' if blink else 'dot')
    put(px, 28, 12, 'b'); put(px, 28, 13, 'b')   # 一条触手把瓶子抱在身边
    put(px, 30, 10, 'B'); rows(px, ["BBB"] * 3, 29, 11)
    return px
def night(k):
    px = base(squash=(8,)); eyes(px, 'shut', y=9)
    if k == 1: put(px, 29, 3, 'g')
    if k == 2: rows(px, ["ggg", ".g.", "ggg"], 28, 1)
    return px
def ebb(k):
    px = base(squash=(7, 8) if k == 0 else (7, 8, 9)); eyes(px, 'dot', y=9, dy=1 if k else 0); return px
def sunny(k):
    px = base(); eyes(px, 'happy')
    arm = [[(28, 12), (29, 11), (29, 10), (29, 9)], [(28, 12), (29, 12), (30, 11), (30, 10)]][k % 2]
    for x, y in arm: put(px, x, y, 'b')
    rows(px, ["YY", "YY"], 6, 2)
    return px
def rain(k):
    px = base(); eyes(px, 'dot')
    rows(px, ["..wwww..", ".wwwwwww"], 17, 0)
    for x, y in ((19, 2 + k), (22, 2 + (k + 1) % 3)): put(px, x, y, 'B')
    return px

M = {
 'm-bottle': [(bottle(), 900), (bottle(), 700), (bottle(), 900), (bottle(True), 140), (bottle(), 1000)],
 'm-night': [(night(0), 900), (night(1), 800), (night(2), 1000), (night(1), 800)],
 'm-ebb': [(ebb(0), 1700), (ebb(1), 1500)],
 'm-sunny': [(sunny(0), 280), (sunny(1), 280), (sunny(0), 280), (sunny(1), 280)],
 'm-rain': [(rain(0), 300), (rain(1), 300), (rain(2), 300)],
}
if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    meta = {}
    for name, fr in M.items():
        strip = Image.new('RGBA', (W * len(fr), H), (0, 0, 0, 0))
        for i, (px, d) in enumerate(fr): strip.paste(img(px), (i * W, 0))
        strip.save(os.path.join(ROOT, 'public/pet', name + '.png'))
        meta[name] = {'durs': [d for _, d in fr]}
        sheet = Image.new('RGB', (W * 6 * len(fr), H * 6), BG)
        r = strip.resize((W * 6 * len(fr), H * 6), Image.NEAREST); sheet.paste(r, (0, 0), r)
        sheet.save(os.path.join(OUT, f'pet-{name}.png'))
    with open(os.path.join(ROOT, 'src/lib/petMoodFrames.js'), 'w') as fh:
        fh.write("// 小章鱼跟水温变的动作：帧条在 public/pet/m-<水温>.png（每帧 32×20 像素），这里记每帧停多久\n// 由 tools/mood_sprites.py 生成；没有水温时不用这些，还是原来的待机\n")
        fh.write("export const PET_MOOD_FRAMES = " + json.dumps(meta, ensure_ascii=False) + ";\n")
