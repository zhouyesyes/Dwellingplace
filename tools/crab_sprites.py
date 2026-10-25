# 用法：python3 tools/crab_sprites.py <预览图输出目录> .    （第二个参数是栖所的目录：会写 public/pet/crab/*.png、src/assets/memory/crab-*.png 和 src/lib/crabFrames.js）
# 小螃蟹（cc）：只用平涂橘粉（#D97757）和黑色，没有描边、阴影、高光；扁方块身体、两颗竖条小黑眼、两侧短钳子、底下四条短腿。
# 动作和时长照小章鱼（tools/pet_sprites.py）一一对应，只是换成螃蟹的样子；站在输入框上沿的右边，脚底第 16 行（和小章鱼一样）。
# 时间线小标志：只用橘粉和黑色（下面 crab() 那套）。
# 桌宠（10/26 照她挑的草图重画，下面 pet() 那套）：身子 11×7 方一点、两道竖条眼、四条细腿；脸红粉、泡泡淡蓝，
# 敲键盘时半侧身对着一台打开的小电脑（侧面看：屏幕斜着立起来），腿往后斜一格。伸到身子外面的东西不用黑色，深色模式里也看得见。
# 自己画的像素，不用官方图片。
import sys, os, json, re, hashlib
from PIL import Image
OUT, ROOT = sys.argv[1], sys.argv[2]
BG = (238, 236, 229)
PAL = {'C': (217, 119, 87), 'E': (24, 24, 28),
       # 桌宠的点缀色（10/26 她挑的）：脸红粉、泡泡和汗滴淡蓝、小电脑灰、信和牌子白、星星黄、爱心红
       'P': (242, 150, 160), 'B': (150, 200, 235), 'G': (128, 128, 136), 'g': (190, 190, 196), 'W': (250, 248, 242), 'Y': (240, 190, 80), 'R': (226, 96, 110)}
W, H = 32, 20

class F:
    def __init__(s): s.px = {}
    def put(s, x, y, c):
        if 0 <= x < W and 0 <= y < H and c != '.': s.px[(x, y)] = c
    def rect(s, x0, y0, x1, y1, c):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1): s.put(x, y, c)
    def box(s, x0, y0, x1, y1, c):   # 空心框
        for x in range(x0, x1 + 1): s.put(x, y0, c); s.put(x, y1, c)
        for y in range(y0, y1 + 1): s.put(x0, y, c); s.put(x1, y, c)
    def render(s):
        im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        for (x, y), c in s.px.items(): im.putpixel((x, y), PAL[c] + (255,))
        return im

# ---------- 正面 ----------
BX, BY = 14, 7        # 身体左上角：身体 14 宽（x 14~27）、7 高；两边钳子各 2 宽，一共 x 12~29，和小章鱼一样靠右
LEG = (1, 4, 9, 12)   # 四条腿在身体里的列（左右对称）

def eyes(f, x0, y0, eye, lookx=0, looky=0, ey=2):
    for x in (x0 + 3 + lookx, x0 + 10 + lookx):
        y = y0 + ey + looky
        if eye == 'dot': f.put(x, y, 'E'); f.put(x, y + 1, 'E')
        elif eye == 'blink': f.put(x, y + 1, 'E')
        elif eye == 'down': f.put(x, y + 1, 'E'); f.put(x, y + 2, 'E')
        elif eye == 'happy': f.put(x, y + 1, 'E'); f.put(x - 1, y + 2, 'E'); f.put(x + 1, y + 2, 'E')   # ^
        elif eye == 'shut':
            for a in (-1, 0, 1): f.put(x + a, y + 1, 'E')
        elif eye == 'x':
            for a, b in ((-1, 0), (1, 0), (0, 1), (-1, 2), (1, 2)): f.put(x + a, y + b, 'E')

def claw(f, x, y0, side, cy):
    """钳子 2×2：cy 是它在身体里的第几行（3 = 放下，-2 = 高高举起）；够不到身体的地方补一小截胳膊"""
    if cy < 2:   # 举起来：钳子往外挪一格，胳膊斜着连回身体（中间留一点空，看得出是举着的）
        o = -1 if side == 'l' else 1
        f.rect(x + o, y0 + cy, x + o + 1, y0 + cy + 1, 'C')
        ax = x + 1 if side == 'l' else x
        f.put(ax + o, y0 + cy + 2, 'C'); f.put(ax, y0 + cy + 3, 'C')
        return
    f.rect(x, y0 + cy, x + 1, y0 + cy + 1, 'C')
    ax = x + 1 if side == 'l' else x   # 贴着身体那一列
    for r in range(cy + 2, 4): f.put(ax, y0 + r, 'C')

def crab(f, dx=0, dy=0, eye='dot', cl=(3, 3), legs=(2, 2, 2, 2), bh=7, lookx=0, looky=0, ey=2, blush=False):
    x0, y0 = BX + dx, BY + dy
    f.rect(x0, y0, x0 + 13, y0 + bh - 1, 'C')
    eyes(f, x0, y0, eye, lookx, looky, ey)
    claw(f, x0 - 2, y0, 'l', cl[0]); claw(f, x0 + 14, y0, 'r', cl[1])
    for i, c in enumerate(LEG):
        for j in range(legs[i]): f.put(x0 + c, y0 + bh + j, 'C')
    if blush:   # 脸红：眼睛下面两边各一小道黑色
        for x in (x0 + 1, x0 + 2, x0 + 11, x0 + 12): f.put(x, y0 + ey + 3, 'E')
    return f

def front(**kw): f = F(); crab(f, **kw); return f

# ---------- 桌宠（10/26 重画）----------
PX, PY, PW, PH = 17, 7, 11, 7   # 正面身子左上角：11 宽 7 高（x 17~27），两边钳子在 16 和 28；腿在第 14、15 行，脚底第 15 行

def pet(f=None, dx=0, dy=0, eye='dot', cl=('mid', 'mid'), legs=(2, 2, 2, 2), blush=False, bh=PH, lx=0):
    """正面的小螃蟹。eye：dot 竖条 / blink 眨眼 / up 往上看 / down 往下看 / happy ^^ / shut 一条线 / shy 害羞 / x 出错
    cl：左右钳子 mid 平时 / up 举起来 / hold 放低抱东西 / none 不画（被别的东西挡着）"""
    f = f or F()
    x0, y0 = PX + dx, PY + dy + (PH - bh)
    f.rect(x0, y0, x0 + PW - 1, y0 + bh - 1, 'C')
    for i, ex in enumerate((x0 + 2 + lx, x0 + 8 + lx)):
        ey = y0 + 2
        if eye == 'dot': f.rect(ex, ey, ex, ey + 1, 'E')
        elif eye == 'up': f.rect(ex, ey - 1, ex, ey, 'E')
        elif eye == 'down': f.rect(ex, ey + 1, ex, ey + 2, 'E')
        elif eye == 'blink': f.put(ex, ey + 1, 'E')
        elif eye == 'happy': f.put(ex, ey, 'E'); f.put(ex - 1, ey + 1, 'E'); f.put(ex + 1, ey + 1, 'E')
        elif eye == 'shut': f.rect(ex - 1, ey + 1, ex + 1, ey + 1, 'E')
        elif eye == 'shy': f.put(ex, ey + 1, 'E'); f.put(ex + (1 if i == 0 else -1), ey + 1, 'E')
        elif eye == 'x':
            for a, b in ((-1, 0), (1, 0), (0, 1), (-1, 2), (1, 2)): f.put(ex + a, ey + b, 'E')
    if blush:   # 脸红：眼睛下面两团粉
        for x in (x0 + 1, x0 + 2, x0 + 8, x0 + 9): f.put(x, y0 + 4, 'P')
    for side, c in zip((-1, 1), cl):
        cx = x0 - 1 if side < 0 else x0 + PW
        if c == 'mid': f.rect(cx, y0 + 2, cx, y0 + 3, 'C')
        elif c == 'up': f.rect(cx, y0 - 1, cx, y0 + 1, 'C'); f.put(cx + side, y0 - 2, 'C')
        elif c == 'hold': f.rect(cx, y0 + 3, cx, y0 + 4, 'C')
    for o, h in zip((1, 3, 7, 9), legs):
        f.rect(x0 + o, y0 + bh, x0 + o, y0 + bh + h - 1, 'C')
    return f

def computer(f, key=None):
    """打开的小电脑（侧面看）：底座平放，上面一层浅灰是键盘面；屏幕从左边的合页往后斜着立起来。key：按下去那颗键亮一下"""
    f.rect(11, 15, 16, 15, 'G'); f.rect(12, 14, 16, 14, 'g')
    for x, y in ((11, 14), (11, 13), (10, 12), (10, 11), (9, 10), (9, 9)): f.put(x, y, 'G')
    if key is not None: f.put(key, 14, 'W')

def typer(f=None, press=True, key=15, eye='dot', pen=False, clawup=False):
    """半侧身朝左：两只眼都偏左，后面露一只小钳子；四条细腿两格短，往后斜一格（像往前使劲）；前钳子一按一抬"""
    f = f or F()
    x0, y0 = 18, PY
    f.rect(x0, y0, x0 + 10, y0 + 6, 'C')
    ey = y0 + 1 if eye == 'up' else y0 + 2
    if eye == 'blink': f.put(x0 + 1, y0 + 3, 'E'); f.put(x0 + 5, y0 + 3, 'E')
    else: f.rect(x0 + 1, ey, x0 + 1, ey + 1, 'E'); f.rect(x0 + 5, ey, x0 + 5, ey + 1, 'E')
    f.rect(x0 + 11, y0 + 2, x0 + 11, y0 + 3, 'C')
    for o in (1, 4, 7, 10): f.put(x0 + o, 14, 'C'); f.put(x0 + o + 1, 15, 'C')
    if clawup: f.rect(x0 - 1, y0 + 1, x0 - 1, y0 + 2, 'C'); f.put(x0 - 2, y0, 'C')
    elif press: f.rect(15, 12, x0 - 1, 12, 'C'); f.put(15, 13, 'C')
    else: f.rect(15, 11, x0 - 1, 11, 'C'); f.put(15, 12, 'C')
    if pen: f.put(14, 14, 'E'); f.put(15, 13, 'E')
    return f

def typing(press, key=15, spark=0):
    f = F(); computer(f, key if press else None); typer(f, press=press)
    if spark == 1: f.put(13, 11, 'g')
    if spark == 2: f.put(12, 10, 'g'); f.put(14, 9, 'g')
    return f

def star(f, x, y, big=False, c='Y'):
    f.put(x, y, c)
    if big:
        for a, b in ((-1, 0), (1, 0), (0, -1), (0, 1)): f.put(x + a, y + b, c)

def bubble_at(f, x, y):   # 一个小泡泡：淡蓝的一圈
    for a, b in ((0, -1), (-1, 0), (1, 0), (0, 1)): f.put(x + a, y + b, 'B')

def zz(f, x, y, c='g'):   # 一个 Z：4 宽 4 高，中间斜着
    for j, r in enumerate(["XXXX", "..X.", ".X..", "XXXX"]):
        for i, ch in enumerate(r):
            if ch == 'X': f.put(x + i, y + j, c)

S = {}   # 动作名 -> [(帧, 毫秒)]

# 1 待机：站着，偶尔轻轻上下一格、眨眼
S['idle'] = [(pet(), 900), (pet(dy=-1), 650), (pet(), 700), (pet(eye='blink'), 140), (pet(), 1200)]

# 2 开心：眼睛 ^^，钳子举起来，轻轻弹一下，旁边闪小黄星（播一次）
def happy(dy, st):
    f = pet(dy=dy, eye='happy', cl=('up', 'up'))
    if st == 1: star(f, 14, 4 + dy); star(f, 30, 3 + dy)
    if st == 2: star(f, 14, 3 + dy, True); star(f, 30, 2 + dy)
    return f
S['happy'] = [(happy(0, 0), 260), (happy(-1, 1), 220), (happy(0, 2), 260), (happy(-1, 1), 220), (happy(0, 0), 600)]

# 3 害羞：脸红（粉），眼睛往下躲，钳子放低，腿缩一缩，眨一下（播一次）
S['shy'] = [(pet(blush=True, eye='shy', cl=('hold', 'hold')), 500), (pet(blush=True, eye='shy', cl=('hold', 'hold'), legs=(1, 1, 1, 1), dy=1), 1200),
            (pet(blush=True, eye='shut', cl=('hold', 'hold'), legs=(1, 1, 1, 1), dy=1), 140), (pet(blush=True, eye='shy', cl=('hold', 'hold'), legs=(1, 1, 1, 1), dy=1), 900)]

# 4 困了：眼睛一条线，身子一压一抬，头顶飘一个灰 Z
def sleepy(k):
    f = pet(eye='shut', bh=6 if k else 7, legs=(1, 1, 1, 1) if k else (2, 2, 2, 2), dy=1 if k else 0)
    zz(f, 28, 1 + k)
    return f
S['sleepy'] = [(sleepy(0), 800), (sleepy(1), 800)]

# 5 在想：眼睛往上看，头顶三个小点轮流跳
def think(k):
    f = pet(eye='up', lx=-1)
    for i, x in enumerate((19, 22, 25)): f.put(x, 4 - (1 if i == k else 0), 'C')
    return f
S['think'] = [(think(i % 3), 400) for i in range(6)]

# 6 吐泡泡：淡蓝的小泡泡一个个往上飘（播一次）
def bubble(k):
    f = pet()
    if k == 0: f.put(29, 6, 'B')
    if k == 1: bubble_at(f, 30, 4)
    if k == 2: bubble_at(f, 30, 2); f.put(29, 6, 'B')
    if k == 3: bubble_at(f, 30, 3)
    return f
S['bubble'] = [(bubble(0), 500), (bubble(1), 500), (bubble(2), 500), (bubble(3), 500), (pet(), 800), (pet(eye='blink'), 140), (pet(), 700)]

# 7 出错着急：X 眼，左右抖，旁边一滴淡蓝汗
def err(dx):
    f = pet(dx=dx, eye='x')
    f.rect(30 + dx, 4, 30 + dx, 5, 'B'); f.put(30 + dx, 6, 'B')
    return f
S['error'] = [(err(-1), 70), (err(1), 70), (err(-1), 70), (err(1), 70), (err(0), 2400)]

# 8 两条敲：半侧身对着小电脑，前钳子一按一抬，安静、认真
S['type2'] = [(typing(t % 2 == 0, key=15), 160) for t in range(6)]

# 9 四条敲：按得更快，按的键换着亮，偶尔冒一点小火花
S['type4'] = [(typing(t % 2 == 0, key=(14, 15, 16, 15)[t % 4], spark=1 if t in (1, 5) else 2 if t == 3 else 0), 90) for t in range(8)]

# 10 用工具：一边敲，一边头顶飘着一个小终端，光标一闪一闪
def tool(t):
    f = typing(t % 2 == 0, key=15)
    f.rect(2, 0, 12, 5, 'G'); f.rect(3, 1, 11, 4, 'E')
    f.put(4, 2, 'C'); f.put(5, 3, 'C'); f.put(4, 4, 'C')   # >
    if t % 4 < 2: f.rect(7, 4, 8, 4, 'C')                   # 光标
    return f
S['tool'] = [(tool(t), 220) for t in range(8)]

# 11 共读：钳子放低捧着一本摊开的书，眼睛往下看；隔一会儿翻一页
def reading(eye='down', flip=0):
    f = pet(eye=eye, cl=('hold', 'hold'))
    f.rect(18, 10, 26, 13, 'W'); f.rect(22, 10, 22, 13, 'G')
    for x in (19, 20, 24, 25): f.put(x, 11, 'g'); f.put(x, 12, 'g')
    if flip == 1: f.put(25, 9, 'W'); f.put(24, 9, 'W')
    if flip == 2: f.put(19, 9, 'W'); f.put(20, 9, 'W')
    return f
S['read'] = [(reading(), 1400), (reading('blink'), 140), (reading(), 1200), (reading(flip=1), 220), (reading(flip=2), 220), (reading(), 1200)]

# 12 共写：半侧身，面前一张白稿纸，一只钳子握着笔一点点写；写完停一下，笔抬起来、眼睛往上想
def write(k, pause=False):
    f = F()
    f.rect(8, 15, 16, 15, 'W')
    for x in range(9, 9 + min(k, 7)):
        if x % 3: f.put(x, 15, 'G')
    typer(f, press=not pause, pen=not pause, clawup=pause, eye='up' if pause else 'dot')
    return f
S['write'] = [(write(k), 260) for k in range(1, 8)] + [(write(7, True), 1400)]

# 13 等待消息：缩成小小一团，只露眼睛；偶尔探出一只钳子看一眼
def wait(peek=0, blink=False):
    f = F(); x0, y0 = PX, PY + 4
    f.rect(x0, y0, x0 + PW - 1, y0 + 4, 'C')
    for x in (x0 + 2, x0 + 8):
        f.put(x, y0 + 2, 'E')
        if not blink: f.put(x, y0 + 1, 'E')
    if peek: f.rect(x0 + PW, y0 + 1, x0 + PW, y0 + 2, 'C')
    return f
S['wait'] = [(wait(), 2600), (wait(blink=True), 140), (wait(), 1500), (wait(1), 500), (wait(), 300), (wait(1), 300), (wait(), 2000)]

# 14 做成了：弹起一格，两只钳子举起来，头顶闪一颗小黄星（播一次）
def yay(dy, st):
    f = pet(dy=dy, eye='happy', cl=('up', 'up'))
    if st == 1: star(f, 22, 2 + dy)
    if st == 2: star(f, 22, 2 + dy, True)
    return f
S['success'] = [(pet(), 300), (yay(-1, 1), 180), (yay(-1, 2), 300), (yay(0, 1), 260), (pet(eye='happy'), 900), (pet(), 900)]

# 15 收到信：^^ 眼，两只钳子把一封宽宽的白信封举过头顶（V 字封口、粉红小爱心），左右轻轻晃（播一次）
def letter(dx):
    f = pet(dx=dx, eye='happy', cl=('up', 'up'))
    x0 = PX + dx + 1
    f.rect(x0, 0, x0 + 8, 4, 'W')
    for i in range(4): f.put(x0 + i, i, 'G'); f.put(x0 + 8 - i, i, 'G')
    f.put(x0 + 4, 3, 'R')
    return f
S['letter'] = [(letter(0), 300), (letter(-1), 260), (letter(0), 260), (letter(1), 260), (letter(0), 260), (letter(-1), 260), (letter(0), 700)]

# 16 提醒睡觉：右钳子举着一块「Zz」小白牌子，牌子整块在头顶上面，不挡脑袋；偶尔眨眼，牌子晃一下
def sign(blink=False, sway=0):
    f = pet(eye='blink' if blink else 'dot', cl=('mid', 'none'))
    f.rect(28, 5, 28, 9, 'C')                       # 举牌子的胳膊
    x0 = 20 + sway
    f.rect(x0, 0, x0 + 11, 5, 'W')
    for x, y in ((1, 1), (2, 1), (3, 1), (4, 1), (3, 2), (2, 3), (1, 4), (2, 4), (3, 4), (4, 4)): f.put(x0 + x, y, 'E')       # Z
    for x, y in ((6, 2), (7, 2), (8, 2), (7, 3), (6, 4), (7, 4), (8, 4)): f.put(x0 + x, y, 'E')                              # z
    return f
S['bedtime'] = [(sign(), 900), (sign(sway=-1), 300), (sign(), 900), (sign(sway=-1), 300), (sign(True), 140), (sign(), 1500)]

# 走路：腿一长一短地挪，身体轻轻一颠
S['walk'] = [(pet(legs=(2, 1, 2, 1)), 170), (pet(dy=-1, legs=(2, 2, 2, 2)), 130), (pet(legs=(1, 2, 1, 2)), 170), (pet(dy=-1, legs=(2, 2, 2, 2)), 130)]

# ---------- 跟水温变：每种一小段（时长在 crabFrames.js 里）----------
M = {}
def bottle(dy=0, eye='dot'):   # 漂流瓶：右钳子抱着一个淡蓝小瓶子，轻轻晃
    f = pet(dy=dy, eye=eye, cl=('mid', 'hold'))
    f.rect(29, 7 + dy, 30, 11 + dy, 'B'); f.put(29, 6 + dy, 'g'); f.put(30, 6 + dy, 'g')
    return f
M['m-bottle'] = [(bottle(), 900), (bottle(dy=-1), 700), (bottle(), 900), (bottle(eye='blink'), 140), (bottle(), 1000)]
def night(k):   # 夜潮：缩成一小团，闭着眼打盹，头上飘一个小 z
    f = F(); x0, y0 = PX, PY + 3
    f.rect(x0, y0, x0 + PW - 1, y0 + 5, 'C')
    for x in (x0 + 2, x0 + 8): f.rect(x - 1, y0 + 2, x + 1, y0 + 2, 'E')
    if k == 1: f.put(29, 6, 'g')
    if k == 2: zz(f, 28, 3)
    return f
M['m-night'] = [(night(0), 900), (night(1), 800), (night(2), 1000), (night(1), 800)]
def ebb(k):   # 退潮：趴着没精神，眼睛朝下，慢慢呼吸
    return pet(dy=1 + k, bh=6 - k, eye='down', legs=(1, 1, 1, 1))
M['m-ebb'] = [(ebb(0), 1700), (ebb(1), 1500)]
def sunny(l, r, dy=0):   # 晴水：两只钳子轮着举起来晃一晃，头顶一个小黄太阳
    f = pet(dy=dy, eye='happy', cl=('up' if l else 'mid', 'up' if r else 'mid'))
    f.rect(21, 0, 23, 2, 'Y'); f.put(20, 1, 'Y'); f.put(24, 1, 'Y')
    return f
M['m-sunny'] = [(sunny(1, 0), 260), (sunny(0, 1), 260), (sunny(1, 0), 260), (sunny(0, 1), 260), (sunny(1, 1, -1), 300), (sunny(1, 1), 300)]
def rain(k):   # 下雨：头上一小朵灰云，淡蓝雨滴一滴一滴落下来
    f = pet()
    f.rect(18, 1, 26, 2, 'g'); f.rect(19, 0, 25, 0, 'g')
    for x, y in ((20, 3 + k), (24, 3 + (k + 1) % 3)): f.put(x, y, 'B')
    return f
M['m-rain'] = [(rain(0), 300), (rain(1), 300), (rain(2), 300)]

# ---------- 时间线小标志：每种一只，32×20，身体和左右钳子正好在正中间（和小章鱼的一样大）----------
IDX, IDY = -5, 1   # 整只往左挪到画面正中、往下挪一点，头顶留位置给小道具
def icon(kind):
    f = F()
    kw = dict(dx=IDX, dy=IDY)
    x0 = BX + IDX       # 身体左边
    top = BY + IDY      # 身体顶
    if kind == 'pin':      # 常驻：头顶一颗小星星
        crab(f, eye='happy', **kw); star(f, x0 + 7, top - 3, True, 'C')
    elif kind == 'like':   # 喜好：脸红
        crab(f, blush=True, **kw)
    elif kind == 'promise':   # 约定：两只钳子抱着一封信
        crab(f, eye='happy', cl=(4, 4), **kw)
        bx = x0 + 4
        f.box(bx, top + 3, bx + 5, top + 6, 'E')
        f.put(bx + 1, top + 4, 'E'); f.put(bx + 2, top + 5, 'E'); f.put(bx + 3, top + 5, 'E'); f.put(bx + 4, top + 4, 'E')
    elif kind == 'feel':   # 心事：头顶冒「…」
        crab(f, **kw)
        for x in (x0 + 4, x0 + 7, x0 + 10): f.put(x, top - 2, 'C')
    elif kind == 'moment':   # 时刻：举着钳子欢呼，眼睛 ^^
        crab(f, eye='happy', cl=(-2, -2), **kw)
    elif kind == 'book':   # 读写：两只钳子捧着一本书，眼睛往下看
        crab(f, eye='dot', ey=1, cl=(4, 4), **kw)
        g = F(); g.box(x0 + 2, top + 3, x0 + 11, top + 6, 'E')
        for y in (top + 4, top + 5): g.put(x0 + 6, y, 'E'); g.put(x0 + 7, y, 'E')
        g.put(x0 + 6, top + 3, 'C'); g.put(x0 + 7, top + 3, 'C')
        for x in (x0 + 3, x0 + 4, x0 + 5, x0 + 8, x0 + 9, x0 + 10): g.put(x, top + 4, 'E')
        f.px.update(g.px)
    elif kind == 'daily':   # 日常：抱着一本小本子
        crab(f, cl=(4, 3), **kw)
        nx = x0 + 5
        f.rect(nx, top + 3, nx + 3, top + 6, 'E'); f.put(nx + 1, top + 4, 'C'); f.put(nx + 2, top + 4, 'C')
    return f

ICONS = ['pin', 'like', 'promise', 'feel', 'moment', 'book', 'daily']

# ---------- 输出 ----------
if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    pdir = os.path.join(ROOT, 'public/pet/crab')
    if os.path.isdir(pdir):
        for n in os.listdir(pdir): os.remove(os.path.join(pdir, n))
    os.makedirs(pdir, exist_ok=True)
    adir = os.path.join(ROOT, 'src/assets/memory'); os.makedirs(adir, exist_ok=True)
    # 时长和小章鱼同一个动作一模一样（帧数也一样），水温那几个用自己的
    octo = json.loads(re.search(r'PET_FRAMES = (\{.*\});', open(os.path.join(ROOT, 'src/lib/petFrames.js')).read()).group(1))
    meta = {}
    for name, fr in {**S, **M}.items():
        strip = Image.new('RGBA', (W * len(fr), H), (0, 0, 0, 0))
        for i, (f, d) in enumerate(fr): strip.paste(f.render(), (i * W, 0))
        strip.save(os.path.join(pdir, name + '.png'))
        meta[name] = {'durs': [d for _, d in fr]}
        if name in octo:
            assert len(octo[name]['durs']) == len(fr), (name, len(octo[name]['durs']), len(fr))
            meta[name] = octo[name]
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
    with open(os.path.join(ROOT, 'src/lib/crabFrames.js'), 'w') as fh:
        fh.write("// 小螃蟹桌宠的动作：帧条在 public/pet/crab/<名字>.png（每帧 32×20 像素），这里记每帧停多久；once 的播一次就回去\n// 和小章鱼的动作一一对应（时长也一样，水温那几个除外）；由 tools/crab_sprites.py 生成，改动作请改脚本再导出\n")
        fh.write("export const CRAB_FRAMES = " + json.dumps(meta, ensure_ascii=False) + ";\n")
        # 图片的版本号：每次重画都变，手机就不会把旧图拿来按新格数切（以前切出来一格里挤着两只）
        ver = hashlib.sha1(b"".join(open(os.path.join(pdir, n + ".png"), "rb").read() for n in sorted(meta))).hexdigest()[:8]
        fh.write(f'export const CRAB_VER = "{ver}";\n')
