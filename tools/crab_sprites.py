# 用法：python3 tools/crab_sprites.py <预览图输出目录> .    （第二个参数是栖所的目录：会写 public/pet/crab/*.png、src/assets/memory/crab-*.png 和 src/lib/crabFrames.js）
# 小螃蟹（cc）：橘粉色方块身体、两个黑色小方眼、两侧小钳子、底下四条小腿。自己画的像素，不用官方图片。
# 桌宠站在左边（和小章鱼站右边对称）；敲键盘时身体往前倾趴下，四条小腿轮流敲面前的小键盘
import sys, os
from PIL import Image
OUT, ROOT = sys.argv[1], sys.argv[2]
BG = (238, 236, 229)
PAL = {
 'C': (226, 128, 102), 'S': (190, 98, 76), 'L': (240, 156, 128),   # 身体 / 暗面（底边、腿）/ 亮面（高光）
 'E': (28, 28, 34),
 'k': (214, 218, 226), 'g': (168, 172, 184), 'b': (104, 108, 120), 'H': (255, 255, 255),   # 键帽 / 键缝 / 键盘底 / 被敲亮的键
 'Y': (236, 200, 110), 'y': (200, 160, 70),                               # 星星、安全帽
 'A': (70, 74, 84), 'a': (120, 124, 136),                                  # 耳机、锤头
 'W': (250, 250, 252), 'w': (196, 204, 216),                               # 云
 'R': (214, 76, 76), 'G': (110, 190, 130), 'B': (96, 150, 220),            # 小彩灯
 'N': (150, 104, 66),                                                      # 锤柄
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

LEGX = [3, 6, 10, 13]   # 四条腿（2 格宽），左右对称

def crab(f, ox, oy, eye='dot', legs=(0, 0, 0, 0), bh=8, claw=(0, 0), shear=0, ldx=0):
    """螃蟹本体。(ox,oy) 是左上角；bh 身体高度；legs 每条：0 站着(2 格) 1 抬起(1 格，悬空) 2 踩下(3 格)；
    claw 左右钳子：0 放下 1 举起；shear 往前倾时上面两行往右挪 1 格（身体歪向键盘）；ldx 腿整体挪的格数（扭一扭）"""
    for y in range(bh):
        sx = shear if y < 2 else 0
        row = 'S' if y == bh - 1 else 'C'
        for x in range(2, 16): f.put(ox + x + sx, oy + y, row)
        if y == 0:
            for x in (2, 15): f.px.pop((ox + x + sx, oy + y), None)   # 顶上两个角抹圆一点
            for x in range(3, 8): f.put(ox + x + sx, oy, 'L')
    # 眼睛：两个黑色小方块
    ey = 2 if bh == 8 else 2
    ex = shear
    if eye == 'dot':
        rs = (ey, ey + 1)
    elif eye == 'down':
        rs = (ey + 1, ey + 2)
    elif eye == 'blink':
        rs = (ey + 1,)
    elif eye == 'happy':
        rs = (ey, ey + 1)
    for x in (5, 11):
        for y in rs:
            for a in (0, 1): f.put(ox + x + a + ex, oy + y, 'E')
    if eye == 'happy':   # 弯弯的笑眼：中间空出来
        for x in (5, 11):
            f.px.pop((ox + x + ex, oy + ey + 1), None); f.px.pop((ox + x + 1 + ex, oy + ey + 1), None)
            f.put(ox + x + ex, oy + ey + 1, 'C'); f.put(ox + x + 1 + ex, oy + ey + 1, 'C')
            f.put(ox + x + ex, oy + ey, 'E'); f.put(ox + x + 1 + ex, oy + ey, 'E')
    # 钳子
    cy = (2 if claw[0] else 3)
    f.rows(["C.", "CC", "CC"], ox + 0, oy + cy)
    cy = (2 if claw[1] else 3)
    f.rows([".C", "CC", "CC"], ox + 16, oy + cy)
    # 腿
    for i, lx in enumerate(LEGX):
        n = [2, 1, 3][legs[i]]
        for a in (0, 1):
            for y in range(n): f.put(ox + lx + a + ldx, oy + bh + y, 'S')

def keyboard(f, x0, x1, lit=()):
    for x in range(x0, x1 + 1):
        f.put(x, 14, 'g' if (x - x0) % 3 == 2 else 'k')
        f.put(x, 15, 'b')
    for x in lit:
        for a in (0, 1): f.put(x + a, 14, 'H')

OX, OY = 1, 6   # 站着：身体 6~13 行，腿 14~15 行，脚底在第 16 行
KB0, KB1 = 0, 23   # 小键盘在脚边，比身体宽出一截（旁边也是键盘）

def stand(dx=0, dy=0, **kw): f = F(); crab(f, OX + dx, OY + dy, **kw); return f

# 趴着：身体往下压一点（少一行）、上面歪向键盘、眼睛朝下看；腿够到键盘
LEANY = 6   # 趴下之后身体顶端所在的行
def lean(legs=(0, 0, 0, 0), dy=0, eye='down', claw=(0, 0), kb=True, level=2):
    f = F()
    if kb: keyboard(f, KB0, KB1)
    bh = 7 if level == 2 else 8
    top = {0: OY, 1: OY + 1, 2: LEANY}[level] + dy
    lg = tuple({0: 1, 1: 1, 2: 0}[v] if level == 2 else 0 for v in legs)   # 趴着：没敲的腿悬着（1 格），敲下去的腿踩到键帽上（2 格）
    crab(f, OX, top, eye=eye, legs=lg, bh=bh, claw=claw, shear=1 if level else 0)
    return f

S = {}   # 动作名 -> [(帧, 毫秒)]
# 待机：站着，偶尔轻轻上下一格、眨眼、左右晃一格
S['idle'] = [(stand(), 1000), (stand(dy=-1), 600), (stand(), 800), (stand(eye='blink'), 140), (stand(), 900),
             (stand(dx=1), 500), (stand(), 700), (stand(dx=-1), 500), (stand(), 1200)]
# 点一下：扭一扭身子，小腿左右轮着抬，钳子举一下
S['wiggle'] = [(stand(dx=-1, legs=(1, 0, 0, 1), claw=(1, 0), ldx=-1), 90), (stand(dx=1, legs=(0, 1, 1, 0), claw=(0, 1), ldx=1), 90),
               (stand(dx=-1, legs=(1, 0, 0, 1), claw=(1, 0), ldx=-1), 90), (stand(dx=1, legs=(0, 1, 1, 0), claw=(0, 1), ldx=1), 90),
               (stand(dx=0, dy=-2, eye='happy', claw=(1, 1)), 140), (stand(dy=-1, eye='happy', claw=(1, 1)), 110), (stand(eye='happy'), 160), (stand(), 100)]
# 趴下：先蹲一点，再压低，键盘这时候冒出来
S['leanin'] = [(stand(dy=1, eye='dot'), 100), (lean(level=1, kb=False, eye='down'), 100), (lean(level=2, dy=-1, eye='down'), 100), (lean(), 120)]
S['leanout'] = [(lean(), 80), (lean(level=2, dy=-1), 90), (lean(level=1, kb=False, eye='dot'), 90), (stand(dy=1), 90)]
# 敲键盘：四条腿一下一下轮流敲，节奏有长有短，偶尔两条一起；身体跟着一抖一抖
_T = [((2, 0, 0, 0), 0, 80), ((0, 0, 2, 0), -1, 70), ((0, 2, 0, 0), 0, 90), ((0, 0, 0, 2), -1, 70), ((0, 2, 0, 2), 0, 100),
      ((2, 0, 0, 0), -1, 70), ((0, 0, 2, 0), 0, 80), ((0, 0, 0, 0), -1, 120), ((2, 0, 2, 0), 0, 90), ((0, 1, 0, 2), -1, 70),
      ((0, 2, 0, 0), 0, 80), ((0, 0, 2, 0), -1, 100), ((0, 0, 0, 0), 0, 140), ((0, 0, 0, 2), -1, 70), ((2, 0, 0, 0), 0, 80), ((0, 1, 2, 0), -1, 90)]
S['type'] = [(lean(legs=lg, dy=dy, claw=(0, 0) if i % 5 else (1, 0), eye='down' if i % 7 else 'dot'), d) for i, (lg, dy, d) in enumerate(_T)]

# ---------- 时间线小标志：每种一只，带小道具（32×20，和小章鱼那套一样大）----------
IX, IY = 7, 8   # 螃蟹在小图里的位置（头顶留出道具的地方）
def icon(prop):
    f = F()
    eye, legs, claw, shear, bh, ky = 'dot', (0, 0, 0, 0), (0, 0), 0, 8, 0
    if prop == 'book':   # 读写：趴着敲小键盘
        eye, legs, bh, shear = 'down', (1, 1, 0, 1), 7, 1
        for x in range(IX - 1, IX + 22): f.put(x, 17, 'g' if (x - IX) % 3 == 1 else 'k'); f.put(x, 18, 'b')
        crab(f, IX, IY + 1, eye=eye, legs=legs, bh=bh, shear=shear)
        return f
    if prop == 'moment': eye = 'happy'; claw = (1, 1)
    crab(f, IX, IY, eye=eye, legs=legs, claw=claw)
    X = lambda x: IX + x   # 身体里的 x 换算成小图里的 x
    if prop == 'pin':   # 头顶小星星
        f.rows([".Y.", "YYY", ".Y."], X(8), IY - 5)
    if prop == 'like':   # 戴耳机：头顶一道弧，两边两个耳罩
        for x in range(X(3), X(15)): f.put(x, IY - 2, 'A')
        for x in (X(2), X(15)): f.put(x, IY - 1, 'A'); f.put(x, IY, 'A')
        f.rows(["AA", "AA", "AA", "AA"], X(0) - 0, IY + 0); f.rows(["AA", "AA", "AA", "AA"], X(16), IY + 0)
        for y in (IY, IY + 1, IY + 2, IY + 3):
            f.put(X(0) + 1, y, 'a'); f.put(X(16), y, 'a')
    if prop == 'promise':   # 安全帽 + 手里一把小锤
        f.rows(["..YYYYYY..", ".YYYYYYYY."], X(3), IY - 3)
        f.rows(["yyyyyyyyyyyy"], X(2), IY - 1)
        f.rows(["aaaa", "aaaa"], X(16), IY - 4)
        f.rows(["NN", "NN", "NN", "NN"], X(17), IY - 2)
    if prop == 'feel':   # 旁边飘小云 + 一串小点
        f.rows([".WW..", "WWWWW", "wwwww"], X(19), IY - 3)
        f.put(X(19), IY + 1, 'w'); f.put(X(18), IY + 3, 'w')
    if prop == 'moment':   # 头上小彩灯：一根线，吊着几颗彩色灯泡
        for x in range(X(2), X(16)): f.put(x, IY - 2, 'A')
        for x, c in ((X(3), 'R'), (X(6), 'Y'), (X(9), 'G'), (X(12), 'B'), (X(15), 'R')): f.put(x, IY - 1, c)
    return f

ICONS = {'pin': 'pin', 'like': 'like', 'promise': 'promise', 'feel': 'feel', 'moment': 'moment', 'book': 'book', 'daily': 'daily'}

# ---------- 输出 ----------
if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    pdir = os.path.join(ROOT, 'public/pet/crab'); os.makedirs(pdir, exist_ok=True)
    adir = os.path.join(ROOT, 'src/assets/memory'); os.makedirs(adir, exist_ok=True)
    meta = {}
    for name, fr in S.items():
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
