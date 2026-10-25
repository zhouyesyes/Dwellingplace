# 用法：python3 tools/crab_sprites.py <预览图输出目录> .    （第二个参数是栖所的目录：会写 public/pet/crab/*.png、src/assets/memory/crab-*.png 和 src/lib/crabFrames.js）
# 小螃蟹（cc）：只用一种平涂橘粉色（#D97757），没有描边、阴影、高光、渐变；扁长方块身体、两颗竖条小黑方眼、两侧短钳子、底下四条短腿，
# 有的底下垫一条黑色细横线当影子。表情只有几种：平常竖条眼、开心 ^^、闭眼一条线。道具只有几格像素、一两种颜色，不抢螃蟹。自己画的像素，不用官方图片。
# 桌宠站在左边（和小章鱼站右边对称）；敲键盘时身体往前倾趴下，四条小腿轮流敲面前的小键盘
import sys, os
from PIL import Image
OUT, ROOT = sys.argv[1], sys.argv[2]
BG = (238, 236, 229)
PAL = {
 'C': (217, 119, 87),                                   # 螃蟹：只这一种颜色（#D97757）
 'E': (24, 24, 28),                                     # 小黑眼、影子线
 'g': (150, 154, 164),                                  # 键盘：平时浅灰，敲下去变深一下
 'Y': (236, 196, 90), 'A': (92, 96, 108), 'w': (198, 205, 216), 'B': (112, 160, 214), 'R': (214, 84, 84),   # 道具：一两格的小东西
}
W, H = 32, 20
FEET = 16   # 脚底下面那一行：站在东西上时对齐到上沿（和小章鱼一样）

class F:
    def __init__(s): s.px = {}
    def put(s, x, y, c):
        if 0 <= x < W and 0 <= y < H and c != '.': s.px[(x, y)] = c
    def rows(s, rs, x0, y0):
        for j, r in enumerate(rs):
            for i, c in enumerate(r): s.put(x0 + i, y0 + j, c)
    def render(s):
        im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        for (x, y), c in s.px.items(): im.putpixel((x, y), PAL[c] + (255,))
        return im

LEGX = [3, 7, 10, 14]   # 四条腿（1 格宽），和身体（2~15）左右严格对称

def crab(f, ox, oy, eye='dot', legs=(0, 0, 0, 0), bh=7, claw=(0, 0), shear=0, ldx=0, shadow=True, ey=2, cdy=0):
    """螃蟹本体。(ox,oy) 是左上角；bh 身体高度；legs 每条：0 站着(2 格) 1 抬起(1 格) 2 踩下(3 格)；
    claw 左右钳子：0 放下 1 举起；shear 往前倾时上面两行往右挪 1 格；ldx 腿整体挪的格数；shadow 脚下垫一条黑细线；ey 眼睛从第几行起；cdy 钳子整体下移"""
    for y in range(bh):
        sx = shear if y < 2 else 0
        for x in range(2, 16): f.put(ox + x + sx, oy + y, 'C')
    # 眼睛（身体里 x=5 和 x=12，左右对称）
    for x in (5, 12):
        X = ox + x + shear
        if eye == 'dot':
            f.put(X, oy + ey, 'E'); f.put(X, oy + ey + 1, 'E')
        elif eye == 'down':
            f.put(X, oy + ey + 1, 'E'); f.put(X, oy + ey + 2, 'E')
        elif eye == 'blink':
            f.put(X, oy + ey + 1, 'E')
        elif eye == 'happy':   # ^
            f.put(X - 1, oy + ey + 1, 'E'); f.put(X, oy + ey, 'E'); f.put(X + 1, oy + ey + 1, 'E')
        elif eye == 'shut':    # 闭眼一条线
            for a in (-1, 0, 1): f.put(X + a, oy + ey + 1, 'E')
    # 钳子：短短一小截
    cy = (1 if claw[0] else 3) + cdy
    f.rows(["CC", "CC"], ox + 0, oy + cy)
    cy = (1 if claw[1] else 3) + cdy
    f.rows(["CC", "CC"], ox + 16, oy + cy)
    # 腿
    low = 0
    for i, lx in enumerate(LEGX):
        n = [2, 1, 3][legs[i]]
        low = max(low, n)
        f.put(ox + lx + ldx, oy + bh, 'C')
        for y in range(n): f.put(ox + lx + ldx, oy + bh + y, 'C')
    if shadow:
        for x in range(3, 15): f.put(ox + x, oy + bh + 2, 'E')

OX, OY = 1, 6   # 站着：身体 6~12 行，腿 13~14 行，影子线在 15 行，脚底在第 16 行
KB0, KB1 = 0, 23   # 小键盘在脚边，比身体宽出一截

def stand(dx=0, dy=0, **kw): f = F(); crab(f, OX + dx, OY + dy, **kw); return f

# 敲键盘：侧过身面朝左（照小续发的那段动图）：方块身体、左边探出一小截钳子、一只眼睛、四条腿；
# 身体是一个方方正正的长方块，不削角、不斜；钳子前面是一小块键盘（一条斜斜的屏幕线 + 一小截键），钳子点下去键就变深一下
SX, SY = 9, 6   # 侧身时身体左上角
def side(f=None, ox=SX, oy=SY, tap=False, lifted=(), eye='dot', kb=True, dy=0):
    f = f or F()
    oy += dy
    if kb:
        by = oy + 8   # 键盘在钳子前面的脚边
        for i in range(4): f.put(ox - 6 + i, by, 'A' if tap else 'g')
        for i in range(3): f.put(ox - 7 - i, by - 1 - i, 'g')
    for y in range(7):
        for x in range(12): f.put(ox + x, oy + y, 'C')   # 一个方方正正的长方块
    f.rows(["CC", "CC"], ox - 2, oy + 3 + (1 if tap else 0))   # 探出来的钳子
    X = ox + 6
    if eye == 'dot': f.put(X, oy + 2, 'E'); f.put(X, oy + 3, 'E')
    else: f.put(X, oy + 3, 'E'); f.put(X + 1, oy + 3, 'E')   # 闭眼：一小横
    for i, lx in enumerate((1, 4, 7, 10)):
        for y in range(1 if i in lifted else 2): f.put(ox + lx, oy + 7 + y, 'C')
    return f
def lean(legs=(0, 0, 0, 0), dy=0, eye='dot', kb=True):
    pressed = [i for i, v in enumerate(legs) if v == 2]
    return side(tap=len(pressed) >= 1 and dy == 0, lifted=pressed[:1], eye=eye, kb=kb, dy=dy)

S = {}   # 动作名 -> [(帧, 毫秒)]
# ---------- 跟水温变：每种一小段，道具只有几格（时长在 crabFrames.js 里）----------
M = {}
# 漂流瓶：右钳子抱着一个小瓶子，轻轻晃
def bottle(dy=0, eye='dot'):
    f = stand(dy=dy, eye=eye, claw=(0, 1))
    y0 = OY + dy + 1
    f.put(OX + 19, y0, 'B')
    for y in range(1, 4):
        for x in range(OX + 18, OX + 21): f.put(x, y0 + y, 'B')
    return f
M['m-bottle'] = [(bottle(), 900), (bottle(dy=-1), 700), (bottle(), 900), (bottle(eye='blink'), 140), (bottle(), 1000)]
# 夜潮：缩成一小团，闭着眼打盹，头上飘一个小 z
def night(k):
    f = stand(dy=2, bh=5, eye='shut', ey=1, legs=(1, 1, 1, 1), cdy=0)
    if k == 1: f.put(OX + 17, OY - 2, 'g')
    if k == 2: f.rows(["ggg", ".g.", "ggg"], OX + 17, OY - 4)
    return f
M['m-night'] = [(night(0), 900), (night(1), 800), (night(2), 1000), (night(1), 800)]
# 退潮：趴着没精神，眼睛朝下，钳子垂着，慢慢呼吸
def ebb(k):
    return stand(dy=1 + (k % 2), bh=6 - (k % 2), eye='down', ey=1, legs=(1, 1, 1, 1), cdy=1)
M['m-ebb'] = [(ebb(0), 1700), (ebb(1), 1500)]
# 晴水：两只钳子轮着举起来晃一晃，头顶一个小太阳
def sunny(l, r, dy=0):
    f = stand(dy=dy, eye='happy', claw=(l, r))
    f.rows(["YY", "YY"], OX + 19, OY - 4)
    return f
M['m-sunny'] = [(sunny(1, 0), 260), (sunny(0, 1), 260), (sunny(1, 0), 260), (sunny(0, 1), 260), (sunny(1, 1, -1), 300), (sunny(1, 1), 300)]
# 下雨：头上一小朵云，雨滴一滴一滴落下来
def rain(k):
    f = stand(eye='dot')
    f.rows(["..www..", ".wwwwww"], OX + 5, OY - 5)
    for x, y in ((OX + 7, OY - 3 + k), (OX + 10, OY - 3 + (k + 1) % 3)): f.put(x, y, 'B')
    return f
M['m-rain'] = [(rain(0), 300), (rain(1), 300), (rain(2), 300)]

# 待机：站着，偶尔轻轻上下一格、眨眼、左右晃一格
S['idle'] = [(stand(), 1000), (stand(dy=-1), 600), (stand(), 800), (stand(eye='blink'), 140), (stand(), 900),
             (stand(dx=1), 500), (stand(), 700), (stand(dx=-1), 500), (stand(), 1200)]
# 点一下：扭一扭身子，小腿左右轮着抬，钳子举一下
S['wiggle'] = [(stand(dx=-1, legs=(1, 0, 0, 1), claw=(1, 0)), 90), (stand(dx=1, legs=(0, 1, 1, 0), claw=(0, 1)), 90),
               (stand(dx=-1, legs=(1, 0, 0, 1), claw=(1, 0)), 90), (stand(dx=1, legs=(0, 1, 1, 0), claw=(0, 1)), 90),
               (stand(dx=0, dy=-2, eye='happy', claw=(1, 1)), 140), (stand(dy=-1, eye='happy', claw=(1, 1)), 110), (stand(eye='happy'), 160), (stand(), 100)]
# 转身侧过去，键盘这时候冒出来
S['leanin'] = [(stand(dy=1), 100), (side(kb=False, dy=1), 100), (side(dy=1), 100), (side(), 120)]
S['leanout'] = [(side(), 80), (side(dy=1), 90), (side(kb=False, dy=1), 90), (stand(dy=1), 90)]
# 敲键盘：四条腿一下一下轮流敲，节奏有长有短，偶尔两条一起；身体跟着一抖一抖
_T = [((2, 0, 0, 0), 0, 80), ((0, 0, 2, 0), -1, 70), ((0, 2, 0, 0), 0, 90), ((0, 0, 0, 2), -1, 70), ((0, 2, 0, 2), 0, 100),
      ((2, 0, 0, 0), -1, 70), ((0, 0, 2, 0), 0, 80), ((0, 0, 0, 0), -1, 120), ((2, 0, 2, 0), 0, 90), ((0, 1, 0, 2), -1, 70),
      ((0, 2, 0, 0), 0, 80), ((0, 0, 2, 0), -1, 100), ((0, 0, 0, 0), 0, 140), ((0, 0, 0, 2), -1, 70), ((2, 0, 0, 0), 0, 80), ((0, 1, 2, 0), -1, 90)]
S['type'] = [(lean(legs=lg, dy=dy, eye='shut' if i % 7 == 6 else 'dot'), d) for i, (lg, dy, d) in enumerate(_T)]


# ---------- 时间线小标志：每种一只，带一个很小的道具（32×20，和小章鱼那套一样大）----------
IX, IY = 7, 8   # 螃蟹在小图里的位置（头顶留出道具的地方）
def icon(prop):
    f = F()
    X = lambda x: IX + x   # 身体里的 x 换算成小图里的 x
    if prop == 'book':   # 读写：侧过身，面前一小块键盘
        side(f, ox=12, oy=7, tap=True, lifted=(1,))
        return f
    eye, claw = 'dot', (0, 0)
    if prop == 'moment': eye = 'happy'; claw = (1, 1)
    crab(f, IX, IY, eye=eye, claw=claw)
    if prop == 'pin':   # 头顶一颗小星星
        f.rows([".Y.", "YYY", ".Y."], X(8), IY - 5)
    if prop == 'like':   # 戴耳机：头顶一道细弧，两边小耳罩
        for x in range(X(3), X(15)): f.put(x, IY - 1, 'A')
        for x in (X(2), X(15)): f.put(x, IY, 'A')
        f.rows(["AA", "AA", "AA"], X(1), IY + 1); f.rows(["AA", "AA", "AA"], X(15), IY + 1)
    if prop == 'promise':   # 小安全帽 + 一把小锤
        f.rows([".YYYYYY.", "YYYYYYYY"], X(4), IY - 2)
        f.rows(["AAA", "AAA"], X(18), IY - 3)
        for y in range(IY - 1, IY + 3): f.put(X(19), y, 'A')
    if prop == 'feel':   # 旁边一朵小云，掉一滴小雨
        f.rows([".ww.", "wwww"], X(18), IY - 3)
        f.put(X(19), IY, 'B')
    if prop == 'moment':   # 开心 ^^，头上三粒小彩点
        for x, y, c in ((X(3), IY - 3, 'R'), (X(8), IY - 4, 'Y'), (X(13), IY - 3, 'B')): f.put(x, y, c)
    return f

ICONS = {'pin': 'pin', 'like': 'like', 'promise': 'promise', 'feel': 'feel', 'moment': 'moment', 'book': 'book', 'daily': 'daily'}

# ---------- 输出 ----------
if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    pdir = os.path.join(ROOT, 'public/pet/crab'); os.makedirs(pdir, exist_ok=True)
    adir = os.path.join(ROOT, 'src/assets/memory'); os.makedirs(adir, exist_ok=True)
    meta = {}
    for name, fr in {**S, **M}.items():
        strip = Image.new('RGBA', (W * len(fr), H), (0, 0, 0, 0))
        for i, (f, d) in enumerate(fr): strip.paste(f.render(), (i * W, 0))
        strip.save(os.path.join(pdir, name + '.png'))
        meta[name] = {'durs': [d for _, d in fr]}
        if name in ('leanin', 'wiggle'): meta[name]['once'] = True
        if name == 'leanout': meta[name]['once'] = True
        sheet = Image.new('RGB', (W * 6 * len(fr), H * 6), BG)
        r = strip.resize((W * 6 * len(fr), H * 6), Image.NEAREST); sheet.paste(r, (0, 0), r)
        sheet.save(os.path.join(OUT, f'pet-{name}.png'))
    for k in ICONS:
        icon(k).render().save(os.path.join(adir, f'crab-{k}.png'))
    for tag, bg in (('light', BG), ('dark', (28, 28, 32))):
        sheet = Image.new('RGB', (W * 6 * 7, H * 6), bg)
        for i, k in enumerate(ICONS):
            r = icon(k).render().resize((W * 6, H * 6), Image.NEAREST); sheet.paste(r, (i * W * 6, 0), r)
        sheet.save(os.path.join(OUT, f'icons-{tag}.png'))
    import json
    with open(os.path.join(ROOT, 'src/lib/crabFrames.js'), 'w') as fh:
        fh.write("// 小螃蟹桌宠的动作：帧条在 public/pet/crab/<名字>.png（每帧 32×20 像素），这里记每帧停多久；once 的播一次就回去\n// 由 tools/crab_sprites.py 生成，改动作请改脚本再导出\n")
        fh.write("export const CRAB_FRAMES = " + json.dumps(meta, ensure_ascii=False) + ";\n")
