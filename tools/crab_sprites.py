# 用法：python3 tools/crab_sprites.py <预览图输出目录> .    （第二个参数是栖所的目录：会写 public/pet/crab/*.png、src/assets/memory/crab-*.png 和 src/lib/crabFrames.js）
# 小螃蟹（cc）：只用平涂橘粉（#D97757）和黑色，没有描边、阴影、高光；扁方块身体、两颗竖条小黑眼、两侧短钳子、底下四条短腿。
# 动作和时长照小章鱼（tools/pet_sprites.py）一一对应，只是换成螃蟹的样子；站在输入框上沿的右边，脚底第 16 行（和小章鱼一样）。
# 颜色的规矩：身体上的细节用黑色（眼睛、书、信封）；伸到身体外面的东西（键盘、终端、星星、泡泡、牌子）用橘粉，
# 这样深色模式里也看得见（黑色放在深色底上会消失）。自己画的像素，不用官方图片。
import sys, os, json, re
from PIL import Image
OUT, ROOT = sys.argv[1], sys.argv[2]
BG = (238, 236, 229)
PAL = {'C': (217, 119, 87), 'E': (24, 24, 28)}
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

def star(f, x, y, big=False):
    f.put(x, y, 'C')
    if big:
        for a, b in ((-1, 0), (1, 0), (0, -1), (0, 1)): f.put(x + a, y + b, 'C')

def ring(f, x, y):
    for a, b in ((0, -1), (-1, 0), (1, 0), (0, 1)): f.put(x + a, y + b, 'C')

def zz(f, x, y):
    for j, r in enumerate(["CCCC", "...C", "..C.", ".C..", "CCCC"]):
        for i, c in enumerate(r): f.put(x + i, y + j, c)

# ---------- 侧面（敲键盘、用工具、共写）：侧过身面朝左 ----------
SBX, SBY = 17, 7   # 侧身身体左上角：12 宽 7 高
KY = 14            # 键盘那一行

def laptop(f, press=None):
    """面前一台小笔记本：左边立着屏幕（橘粉框、黑底，里面两行字），底下一排键（橘粉和黑相间），钳子点到哪一格，哪一格亮一下"""
    f.box(4, 7, 9, 13, 'C')
    f.rect(5, 8, 8, 12, 'E')
    for x in (5, 6, 7): f.put(x, 9, 'C'); f.put(x, 11, 'C')   # 屏幕里两行字
    for x in range(4, 16): f.put(x, KY + 1, 'C')              # 底座
    for x in range(5, 16): f.put(x, KY, 'E' if (x % 2 == 0) != (press == x) else 'C')   # 键：黑橘相间，被点的那格翻成橘粉

def side(f=None, tap=None, lifted=(), eye='dot', dy=0, dx=0, pen=False, clawup=False):
    """tap：钳子点的是哪一格键（x 坐标）；None 是抬着。lifted：抬起来的腿（0~3）"""
    f = f or F()
    x0, y0 = SBX + dx, SBY + dy
    f.rect(x0, y0, x0 + 11, y0 + 6, 'C')
    if eye == 'dot': f.put(x0 + 3, y0 + 3, 'E'); f.put(x0 + 3, y0 + 4, 'E')   # 低头看键盘
    elif eye == 'up': f.put(x0 + 3, y0 + 1, 'E'); f.put(x0 + 3, y0 + 2, 'E')
    else:
        for a in (0, 1): f.put(x0 + 3 + a, y0 + 4, 'E')
    # 前钳子：抬着在身前，点下去就够到键盘
    if clawup:
        f.rect(x0 - 2, y0 - 2, x0 - 1, y0 - 1, 'C'); f.put(x0 - 1, y0, 'C'); f.put(x0 - 1, y0 + 1, 'C'); f.put(x0 - 1, y0 + 2, 'C')
    else:
        cy = 5 if tap is not None else 3
        f.rect(x0 - 2, y0 + cy, x0 - 1, y0 + cy + 1, 'C')
        for r in range(3, cy): f.put(x0 - 1, y0 + r, 'C')
    if pen:   # 握着一支笔：黑色小斜线
        f.put(x0 - 3, y0 + 7, 'E'); f.put(x0 - 2, y0 + 6, 'E'); f.put(x0 - 1, y0 + 5, 'E')
    for i, lx in enumerate((1, 4, 7, 10)):
        for j in range(1 if i in lifted else 2): f.put(x0 + lx, y0 + 7 + j, 'C')
    return f

def typing(tapkey, lifted=(), dx=0, dy=0, sparks=0, eye='dot'):
    f = F(); laptop(f, tapkey)
    side(f, tap=tapkey, lifted=lifted, dx=dx, dy=dy, eye=eye)
    if sparks == 1: f.put(14, 10, 'C'); f.put(13, 9, 'C')
    if sparks == 2: f.put(12, 11, 'C'); f.put(15, 8, 'C')
    return f

S = {}   # 动作名 -> [(帧, 毫秒)]

# 1 待机：站着，偶尔轻轻上下一格、眨眼
S['idle'] = [(front(), 900), (front(dy=-1), 650), (front(), 700), (front(eye='blink'), 140), (front(), 1200)]

# 2 开心：眼睛 ^^，轻轻弹一下，头顶闪一颗小星星（播一次）
def happy(dy, st):
    f = front(dy=dy, eye='happy')
    if st == 1: star(f, 22, 3 + dy)
    if st == 2: star(f, 22, 2 + dy, True)
    return f
S['happy'] = [(happy(0, 0), 260), (happy(-1, 1), 220), (happy(0, 2), 260), (happy(-1, 1), 220), (happy(0, 0), 600)]

# 3 害羞：脸红，眼睛偷偷往旁边看，腿缩一缩，眨一下（播一次）
S['shy'] = [(front(blush=True), 500), (front(blush=True, lookx=-1, legs=(1, 1, 1, 1)), 1200),
            (front(blush=True, lookx=-1, eye='blink', legs=(1, 1, 1, 1)), 140), (front(blush=True, lookx=-1, legs=(1, 1, 1, 1)), 900)]

# 4 困了：眼睛一条线，身子一压一抬，头顶飘 z
def sleepy(k):
    f = front(eye='shut', bh=6 if k % 2 else 7, dy=1 if k % 2 else 0, ey=1)
    zz(f, 28 + k % 2, 0 + (1 - k % 2))
    return f
S['sleepy'] = [(sleepy(0), 800), (sleepy(1), 800)]

# 5 在想：眼睛往上看，头顶三个小点轮流跳
def think(k):
    f = front(looky=-1)
    for i, x in enumerate((17, 20, 23)): f.put(x, 3 - (1 if i == k else 0), 'C')
    return f
S['think'] = [(think(i % 3), 400) for i in range(6)]

# 6 吐泡泡（播一次）
def bubble(k):
    f = front()
    if k == 0: f.put(28, 7, 'C')
    if k == 1: ring(f, 30, 5)
    if k == 2: ring(f, 30, 2); f.put(28, 6, 'C')
    if k == 3: ring(f, 30, 4)
    return f
S['bubble'] = [(bubble(0), 500), (bubble(1), 500), (bubble(2), 500), (bubble(3), 500), (front(), 800), (front(eye='blink'), 140), (front(), 700)]

# 7 出错着急：X 眼，左右抖，头顶一个大惊叹号
def err(dx):
    f = F(); crab(f, dx=dx, eye='x', cl=(1, 1))
    for y in (0, 1, 2, 3): f.put(20 + dx, y, 'C'); f.put(21 + dx, y, 'C')
    f.rect(20 + dx, 5, 21 + dx, 6, 'C')
    return f
S['error'] = [(err(-1), 70), (err(1), 70), (err(-1), 70), (err(1), 70), (err(0), 2400)]

# 8 两条敲：侧着身，两条腿轮流点；安静、认真
S['type2'] = [(typing(12 if t % 2 == 0 else 14, lifted=(0,) if t % 2 == 0 else (1,)), 160) for t in range(6)]

# 9 四条敲：四条腿都跟着点，钳子也快，身子左右晃一格，偶尔飞出小火花
def four(t):
    st = [(t + o) % 4 < 2 for o in (0, 2, 1, 3)]
    return typing(11 + (t % 4), lifted=tuple(i for i, v in enumerate(st) if v), dx=-1 if (t // 2) % 2 else 0, sparks=1 if t in (1, 5) else 2 if t == 3 else 0)
S['type4'] = [(four(t), 90) for t in range(8)]

# 10 用工具：一只钳子敲键盘，另一只往上指着飘在旁边的小终端；终端里的光标一闪一闪
def tool(t):
    f = F(); laptop(f, 12 if t % 2 == 0 else None)
    side(f, tap=12 if t % 2 == 0 else None, clawup=False)
    f.box(1, 0, 12, 5, 'C'); f.rect(2, 1, 11, 4, 'E')              # 终端
    for x in range(3, 8): f.put(x, 2, 'C')
    for x in range(3, 5): f.put(x, 3, 'C')
    if t % 4 < 2: f.put(9, 3, 'C')
    for x, y in ((14, 6), (15, 5), (14, 4)): f.put(x, y, 'C')   # 另一只钳子指着终端（身前一道短斜线）
    f.rect(12, 3, 13, 4, 'C')
    return f
S['tool'] = [(tool(t), 220) for t in range(8)]

# 11 共读：两只钳子捧着摊开的书，眼睛往下看；隔一会儿翻一页
def book(f, flip=0):
    f.box(16, 10, 25, 13, 'E')   # 摊开的书：黑框，中间一道书脊（上沿在书脊处凹下去），页上有字
    for y in (11, 12): f.put(20, y, 'E'); f.put(21, y, 'E')
    f.put(20, 10, 'C'); f.put(21, 10, 'C')
    for x in (17, 18, 19, 22, 23, 24): f.put(x, 11, 'E')
    if flip == 1: f.put(24, 10, 'E'); f.put(25, 9, 'E')
    if flip == 2: f.put(17, 10, 'E'); f.put(16, 9, 'E')
    return f
def reading(eye='dot', flip=0): f = F(); crab(f, eye=eye, cl=(4, 4), ey=1); return book(f, flip)
S['read'] = [(reading(), 1400), (reading('blink'), 140), (reading(), 1200), (reading(flip=1), 220), (reading(flip=2), 220), (reading(), 1200)]

# 12 共写：侧着身，面前一张稿纸，一只钳子握着笔一点点写；写完停一下，笔抬起来、眼睛往上想
def write(k, pause=False):
    f = F()
    for x in range(4, 16): f.put(x, KY + 1, 'C')   # 稿纸（橘粉的一条）
    for x in range(5, 5 + min(k, 7)):   # 一点点写出来的字
        if x % 3 != 0: f.put(x, KY, 'E')
    side(f, tap=None if pause else 1, eye='up' if pause else 'dot', pen=not pause, clawup=pause)
    return f
S['write'] = [(write(k), 260) for k in range(1, 8)] + [(write(7, True), 1400)]

# 13 等待消息：缩成小小一团，只露眼睛；偶尔探出一只钳子看一眼
def wait(peek=0, blink=False):
    f = F(); x0, y0 = BX, BY + 3
    f.rect(x0, y0, x0 + 13, y0 + 3, 'C')
    for x in (x0 + 3, x0 + 10):
        f.put(x, y0 + 2, 'E')
        if not blink: f.put(x, y0 + 1, 'E')
    if peek: f.rect(x0 + 14, y0 + 1, x0 + 15, y0 + 2, 'C')
    return f
S['wait'] = [(wait(), 2600), (wait(blink=True), 140), (wait(), 1500), (wait(1), 500), (wait(), 300), (wait(1), 300), (wait(), 2000)]

# 14 做成了：轻轻弹起一格，两只钳子举起来，头顶闪一颗小星星（播一次）
def yay(dy, st):
    f = F(); crab(f, dy=dy, eye='happy', cl=(-2, -2), legs=(2, 2, 2, 2))
    if st == 1: star(f, 20, 2 + dy)
    if st == 2: star(f, 20, 1 + dy, True)
    return f
S['success'] = [(front(), 300), (yay(-1, 1), 180), (yay(-1, 2), 300), (yay(0, 1), 260), (front(eye='happy'), 900), (front(), 900)]

# 15 收到信：^^ 眼，两只钳子抱着小信封，左右轻轻晃（播一次）
def letter(dx):
    f = F(); crab(f, dx=dx, eye='happy', cl=(4, 4), legs=(2, 1, 1, 2))
    x0 = BX + dx + 4
    f.box(x0, BY + 3, x0 + 5, BY + 6, 'E')
    f.put(x0 + 1, BY + 4, 'E'); f.put(x0 + 2, BY + 5, 'E'); f.put(x0 + 3, BY + 5, 'E'); f.put(x0 + 4, BY + 4, 'E')
    return f
S['letter'] = [(letter(0), 300), (letter(-1), 260), (letter(0), 260), (letter(1), 260), (letter(0), 260), (letter(-1), 260), (letter(0), 700)]

# 16 提醒睡觉：面无表情，一只钳子举着「睡觉」小牌子（月亮 + z），其余稳稳站着
def sign(blink=False, up=0):
    f = F(); crab(f, dx=-5, eye='blink' if blink else 'dot', cl=(3, 3))
    for y in range(7 - up, 14): f.put(25, y, 'C')   # 竿子（右钳子握着）
    f.rect(21, 0 - up, 30, 6 - up, 'C'); f.rect(22, 1 - up, 29, 5 - up, 'E')   # 牌子：橘粉框、黑底
    for x, y in ((23, 2), (24, 2), (23, 3), (23, 4), (24, 4)): f.put(x, y - up, 'C')   # 月亮（弯弯的一牙）
    for x, y in ((26, 2), (27, 2), (28, 2), (27, 3), (26, 4), (27, 4), (28, 4)): f.put(x, y - up, 'C')   # Z
    return f
S['bedtime'] = [(sign(), 900), (sign(up=1), 300), (sign(), 900), (sign(up=1), 300), (sign(True), 140), (sign(), 1500)]

# 走路：腿一前一后地挪，身体轻轻一颠
S['walk'] = [(front(legs=(2, 1, 2, 1)), 170), (front(dy=-1, legs=(1, 1, 1, 1)), 130), (front(legs=(1, 2, 1, 2)), 170), (front(dy=-1, legs=(1, 1, 1, 1)), 130)]

# ---------- 跟水温变：每种一小段（时长在 crabFrames.js 里）----------
M = {}
def bottle(dy=0, eye='dot'):   # 漂流瓶：右钳子抱着一个小瓶子，轻轻晃
    f = F(); crab(f, dy=dy, eye=eye, cl=(3, 1))
    f.box(29, 5 + dy, 31, 11 + dy, 'C'); f.put(30, 4 + dy, 'C')
    return f
M['m-bottle'] = [(bottle(), 900), (bottle(dy=-1), 700), (bottle(), 900), (bottle(eye='blink'), 140), (bottle(), 1000)]
def night(k):   # 夜潮：缩成一小团，闭着眼打盹，头上飘一个小 z
    f = F(); x0, y0 = BX, BY + 2
    f.rect(x0, y0, x0 + 13, y0 + 4, 'C')
    for x in (x0 + 3, x0 + 10):
        for a in (-1, 0, 1): f.put(x + a, y0 + 2, 'E')
    if k == 1: f.put(29, 4, 'C')
    if k == 2: zz(f, 28, 1)
    return f
M['m-night'] = [(night(0), 900), (night(1), 800), (night(2), 1000), (night(1), 800)]
def ebb(k):   # 退潮：趴着没精神，眼睛朝下，慢慢呼吸
    f = F(); crab(f, dy=1 + (k % 2), bh=6 - (k % 2), eye='down', ey=1, legs=(1, 1, 1, 1), cl=(3, 3))
    return f
M['m-ebb'] = [(ebb(0), 1700), (ebb(1), 1500)]
def sunny(l, r, dy=0):   # 晴水：两只钳子轮着举起来晃一晃，头顶一个小太阳
    f = F(); crab(f, dy=dy, eye='happy', cl=(-2 if l else 3, -2 if r else 3))
    f.rect(19, 0, 22, 2, 'C')   # 小太阳：一小块橘粉，四边各一粒光
    for x, y in ((18, 1), (23, 1)): f.put(x, y + dy, 'C')
    return f
M['m-sunny'] = [(sunny(1, 0), 260), (sunny(0, 1), 260), (sunny(1, 0), 260), (sunny(0, 1), 260), (sunny(1, 1, -1), 300), (sunny(1, 1), 300)]
def rain(k):   # 下雨：头上一小朵云，雨滴一滴一滴落下来
    f = front()
    f.rect(17, 1, 24, 2, 'C'); f.rect(18, 0, 23, 0, 'C')
    for x, y in ((19, 3 + k), (22, 3 + (k + 1) % 3)): f.put(x, y, 'C')
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
        crab(f, eye='happy', **kw); star(f, x0 + 7, top - 3, True)
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
