# 用法：pip install pillow；python3 tools/pet_sprites.py <预览图输出目录> .    （第二个参数是栖所的目录：会写 public/pet/*.png 和 src/lib/petFrames.js）
# 小章鱼桌宠（第二稿）：正面就是你喜欢的那版（两格触手、带帽檐）；敲键盘侧过身，面朝左敲一台小笔记本
import sys, os, zipfile
from PIL import Image
OUT = sys.argv[1]
BG = (238, 236, 229)
PAL = {
 'B': (74, 99, 135), 'S': (60, 82, 114),   # 身体 / 侧面（暗一点，看得出是侧着）
 'D': (58, 79, 110), 'K': (47, 63, 88),    # 触手尖 / 后排触手
 'E': (28, 28, 34), 'P': (222, 150, 160),  # 眼睛 / 腮红
 'M': (150, 152, 160), 'm': (190, 192, 198), 'L': (96, 98, 108), 'H': (206, 220, 236),  # 笔记本：屏幕、键盘面、底、亮起的键
 'w': (248, 244, 232), 'O': (186, 164, 128), 'T': (44, 48, 58), 'C': (140, 214, 160), 'h': (170, 180, 196), 'N': (214, 96, 96),
 'G': (150, 150, 160), 'g': (90, 90, 100), 'R': (214, 76, 76), 'Y': (236, 200, 110), 'W': (200, 214, 232),
}
W, H = 32, 20
HEAD = [
"......BBBBBB......",
"....BBBBBBBBBB....",
"...BBBBBBBBBBBB...",
"..BBBBBBBBBBBBBB..",
"..BBBBBBBBBBBBBB..",
"..BBBBBBBBBBBBBB..",
"..BBBBBBBBBBBBBB..",
"..BBBBBBBBBBBBBB..",
".BBBBBBBBBBBBBBBB.",
]
LEGS = ["..B...B....B...B..", ".D....D....D....D."]   # 你选的两格触手：外面两条往外勾
BOT = len(HEAD) - 1
class F:
    def __init__(s, ox, oy): s.px = {}; s.ox, s.oy = ox, oy
    def put(s, x, y, c):
        x += s.ox; y += s.oy
        if 0 <= x < W and 0 <= y < H: s.px[(x, y)] = c
    def grid(s, rows, dx=0, dy=0):
        for y, r in enumerate(rows):
            for x, c in enumerate(r):
                if c != '.': s.put(x + dx, y + dy, c)
FX, FY = 12, 5   # 正面：靠右站（桌宠平时多待在右边）
def front(dy=0, eye='dot', legs=LEGS, lookx=0, looky=0, squash=0):
    f = F(FX, FY + dy)
    f.grid(HEAD[squash:], dy=squash); f.grid(legs, dy=len(HEAD))
    y = 4 + looky
    for x in (6 + lookx, 11 + lookx):
        if eye == 'dot': f.put(x, y, 'E'); f.put(x, y + 1, 'E')
        elif eye == 'blink': f.put(x, y + 1, 'E')
        elif eye == 'happy': f.put(x, y, 'E'); f.put(x - 1, y + 1, 'E'); f.put(x + 1, y + 1, 'E')
        elif eye == 'line': f.put(x - (1 if x < 9 else 0), y + 1, 'E'); f.put(x + (0 if x < 9 else 1), y + 1, 'E')
        elif eye == 'square':
            for a in (0, 1): f.put(x + a - (0 if x < 9 else 1), y, 'E'); f.put(x + a - (0 if x < 9 else 1), y + 1, 'E')
        elif eye == 'x':
            for a, b in ((-1, -1), (1, -1), (0, 0), (-1, 1), (1, 1)): f.put(x + a, y + b, 'E')
    return f
def blush(f): f.put(4, 7, 'P'); f.put(13, 7, 'P'); return f
def zz(f, x, y):
    for j, r in enumerate(["GGGG", "...G", "..G.", ".G..", "GGGG"]):
        for i, c in enumerate(r):
            if c == 'G': f.put(x + i, y + j, 'G')
    return f

S = {}
# ---------- 正面 ----------
S['1-待机'] = [(front(), 900), (front(dy=-1), 650), (front(), 700), (front(eye='blink'), 140), (front(), 1200)]
def happy(dy, star):
    f = front(dy=dy, eye='happy')
    if star == 1: f.put(15, -2, 'Y'); f.put(16, -3, 'Y')
    if star == 2: f.put(16, -3, 'Y'); f.put(15, -3, 'Y'); f.put(16, -2, 'Y'); f.put(17, -3, 'Y'); f.put(16, -4, 'Y')
    return f
S['2-开心'] = [(happy(0, 0), 260), (happy(-1, 1), 220), (happy(0, 2), 260), (happy(-1, 1), 220), (happy(0, 0), 600)]
TUCK = ["..D...D....D...D.."]  # 害羞：触手缩到一格
S['3-害羞'] = [(blush(front()), 500), (blush(front(lookx=-1, legs=TUCK)), 1200), (blush(front(lookx=-1, eye='blink', legs=TUCK)), 140), (blush(front(lookx=-1, legs=TUCK)), 900)]
def sleepy(k):
    f = front(eye='line', squash=1 if k % 2 else 0, dy=0)
    return zz(f, 14 + k % 2, -4 + (1 - k % 2))
S['4-困了'] = [(sleepy(0), 800), (sleepy(1), 800)]
def think(k):
    f = front(looky=-1)
    for i, x in enumerate((6, 9, 12)): f.put(x, -3, 'g' if i == k else 'G')
    return f
S['5-思考'] = [(think(0), 400), (think(1), 400), (think(2), 400), (think(0), 400), (think(1), 400), (think(2), 400)]
def ring(f, x, y):
    for a, b in ((0, -1), (-1, 0), (1, 0), (0, 1)): f.put(x + a, y + b, 'W')
def bubble(k):
    f = front()
    if k == 0: f.put(14, 1, 'W')
    if k == 1: ring(f, 15, -1)
    if k == 2: ring(f, 16, -4); f.put(14, 0, 'W')
    if k == 3: ring(f, 15, -2)
    return f
S['6-吐泡泡'] = [(bubble(0), 500), (bubble(1), 500), (bubble(2), 500), (bubble(3), 500), (front(), 800), (front(eye='blink'), 140), (front(), 700)]
def err(dx):
    f = front(eye='x'); f.ox += dx
    for y in (-5, -4, -3): f.put(8, y, 'R'); f.put(9, y, 'R')
    f.put(8, -1, 'R'); f.put(9, -1, 'R')
    return f
S['7-报错'] = [(err(-1), 70), (err(1), 70), (err(-1), 70), (err(1), 70), (err(0), 2400)]

# ---------- 侧面敲键盘 ----------
# 侧过身面朝左：身体右边四列暗一点（侧面），眼睛挪到左边、往下看；小笔记本就在身前：一条斜斜的屏幕 + 一排键
SIDE = [''.join('S' if (c == 'B' and x >= 13) else c for x, c in enumerate(r)) for r in HEAD]
SX, SY = 14, 5
KEY = BOT + 1   # 键盘那一行
# 敲键盘的两条触手：都从身体左下角伸出来，斜斜往下点键盘（短，不伸长鼻子）
ARMS = {
 'A': ([(0, BOT, 'B'), (-1, BOT - 1, 'D')], [(0, BOT, 'B'), (-1, KEY, 'D')], -2),
 'B': ([(1, BOT - 1, 'B'), (0, BOT - 2, 'D')], [(1, BOT - 1, 'B'), (0, BOT - 1, 'B'), (-1, BOT, 'B'), (-2, KEY, 'D')], -3),
}
def side(press, dx=0, sparks=0, feet=(False, False)):
    g = F(SX, SY)
    for x in range(-6, 0): g.put(x, KEY, 'm')          # 键
    for x in range(-7, 1): g.put(x, KEY + 1, 'L')      # 底座
    for k in range(4): g.put(-7 - (k + 1) // 2, KEY - 1 - k, 'M')  # 屏幕（斜着立起来）
    f = F(SX + dx, SY)
    f.grid(SIDE)
    for x in (4, 9): f.put(x, 5, 'E'); f.put(x, 6, 'E')   # 低头看键盘
    # 站着的前排两条（四条敲时也跟着点一点）+ 后排露出来的一条深色
    for x, lift in zip((6, 11), feet):
        f.put(x, BOT + 1, 'B'); f.put(x - (1 if lift else 0), BOT + 2 - (1 if lift else 0), 'D')
    f.put(15, BOT + 1, 'K'); f.put(16, BOT + 2, 'K')
    for name, down in press.items():
        up_px, down_px, key = ARMS[name]
        for x, y, c in (down_px if down else up_px): f.put(x, y, c)
        if down: g.put(key + dx, KEY, 'H')
    if sparks == 1: f.put(-4, -1, 'Y'); f.put(-3, -2, 'Y')
    if sparks == 2: f.put(0, -3, 'Y')
    g.px.update(f.px)
    return g
# 两条敲：两条轮流点；安静、认真
S['8-两条敲'] = [(side({'A': t % 2 == 0, 'B': t % 2 == 1}), 160) for t in range(6)]
# 四条敲：两条敲键盘、站着的两条也错着拍子点；身体左右晃一格，偶尔飞出小火花
def four(t):
    st = [(t + o) % 4 < 2 for o in (0, 2, 1, 3)]
    return side({'A': st[0], 'B': st[1]}, dx=-1 if (t // 2) % 2 else 0, sparks=1 if t in (1, 5) else 2 if t == 3 else 0, feet=(st[2], st[3]))
S['9-四条敲'] = [(four(t), 90) for t in range(8)]

# ---------- 第二批 ----------
def rect(f, x0, y0, x1, y1, c):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1): f.put(x, y, c)

# 10 调用工具（侧着）：一条敲键盘，另一条往上指着飘在旁边的小终端；终端里的光标一闪一闪
def tool(t):
    g = side({'A': t % 2 == 0})
    f = F(SX, SY)
    for x, y, c in ((1, BOT - 1, 'B'), (0, BOT - 2, 'B'), (-1, BOT - 3, 'B'), (-2, BOT - 4, 'D')): f.put(x, y, c)  # 指着终端
    rect(f, -12, -3, -4, 1, 'T')
    for x in range(-11, -7): f.put(x, -2, 'h')
    for x in range(-11, -9): f.put(x, 0, 'h')
    if t % 4 < 2: f.put(-8, 0, 'C')
    g.px.update(f.px)
    return g
S['10-调用工具'] = [(tool(t), 220) for t in range(8)]

# 11 共读：两条触手捧着摊开的书，眼睛往下看；隔一会儿翻一页
def book(f, flip=0):
    rect(f, 3, 7, 8, 8, 'w'); rect(f, 9, 7, 14, 8, 'w')
    for x in (8, 9): f.put(x, 7, 'O'); f.put(x, 8, 'O')
    rect(f, 2, 9, 15, 9, 'O')
    for x in (4, 6, 10, 12): f.put(x, 7, 'G')
    for x in (5, 11, 13): f.put(x, 8, 'G')
    f.put(2, 8, 'D'); f.put(15, 8, 'D')  # 两边捏着书的触手尖
    if flip == 1:  # 右边那页翘起来
        rect(f, 10, 7, 14, 8, 'w'); f.put(10, 6, 'w'); f.put(11, 6, 'w'); f.put(12, 5, 'w'); f.put(13, 5, 'w'); f.put(14, 6, 'D')
    if flip == 2:  # 翻到左边
        f.put(7, 5, 'w'); f.put(8, 6, 'w'); f.put(6, 5, 'w'); f.put(5, 6, 'D')
    return f
S['11-共读'] = [(book(front(looky=1)), 1400), (book(front(looky=1, eye='blink')), 140), (book(front(looky=1)), 1200),
              (book(front(looky=1), 1), 220), (book(front(looky=1), 2), 220), (book(front(looky=1)), 1200)]

# 12 共写：左边一条压着稿纸，右边一条拿笔写；写几下停一下，停的时候另外两条轻轻缠在一起、眼睛往上想
def write(k, pause=False):
    g = F(SX, SY)
    rect(g, -8, KEY, 0, KEY + 1, 'w')               # 摊在桌上的稿纸
    for x in range(-7, -7 + min(k, 6)):               # 一点点写出来的字
        if x % 3 != 0: g.put(x, KEY + 1, 'G')
    f = F(SX, SY); f.grid(SIDE)
    for x in (4, 9): f.put(x, 5 if not pause else 3, 'E'); f.put(x, 6 if not pause else 4, 'E')
    for x in (6, 11): f.put(x, BOT + 1, 'B'); f.put(x, BOT + 2, 'D')
    f.put(15, BOT + 1, 'K'); f.put(16, BOT + 2, 'K')
    if pause:  # 停下来想：笔抬起来，另外两条轻轻缠一下
        for x, y, c in ((0, BOT, 'B'), (-1, BOT - 1, 'B'), (-2, BOT - 2, 'Y'), (-3, BOT - 3, 'Y'), (-4, BOT - 4, 'N')): f.put(x, y, c)
        f.put(5, BOT + 2, 'D'); f.put(7, BOT + 2, 'D')
    else:      # 拿着一支黄铅笔，笔尖在纸上走
        px = -6 + min(k, 6)                            # 笔尖从左往右走
        for x, y, c in ((px + 2, BOT - 1, 'Y'), (px + 1, BOT, 'Y'), (px, KEY, 'N'), (px + 3, BOT - 2, 'P')): f.put(x, y, c)
        for x in range(px + 2, 1): f.put(x, BOT, 'B')  # 握笔的触手：从身体伸过来捏住笔杆
    f.put(-8, KEY - 1, 'D') if False else None
    g.px.update(f.px)
    return g
S['12-共写'] = [(write(k), 260) for k in range(1, 8)] + [(write(7, True), 1400)]

# 13 等待消息：缩成小小一团，只露眼睛；偶尔探出一条触手看一眼
BALL = [
"......BBBBBB......",
"....BBBBBBBBBB....",
"...BBBBBBBBBBBB...",
"..BBBBBBBBBBBBBB..",
"..BBBBBBBBBBBBBB..",
]
def wait(peek=0, blink=False):
    f = F(FX, FY + 6)
    f.grid(BALL)
    for x in (6, 11):
        f.put(x, 3, 'E')
        if not blink: f.put(x, 2, 'E')
    if peek: f.put(16, 4, 'B'); f.put(17, 3, 'D')
    return f
S['13-等待'] = [(wait(), 2600), (wait(blink=True), 140), (wait(), 1500), (wait(1), 500), (wait(), 300), (wait(1), 300), (wait(), 2000)]

# 14 成功完成：轻轻弹起一格，两条触手举起来，头顶闪一颗小星星（播一次）
def yay(dy, star):
    f = front(dy=dy, eye='happy', legs=["......B....B......", "......D....D......"])
    for x, y, c in ((0, 7, 'B'), (0, 6, 'B'), (-1, 5, 'D'), (17, 7, 'B'), (17, 6, 'B'), (18, 5, 'D')): f.put(x, y, c)
    if star == 1: f.put(9, -2, 'Y')
    if star == 2:
        for a, b in ((0, 0), (-1, 0), (1, 0), (0, -1), (0, 1)): f.put(9 + a, -3 + b, 'Y')
    return f
S['14-成功'] = [(front(), 300), (yay(-1, 1), 180), (yay(-1, 2), 300), (yay(0, 1), 260), (front(eye='happy'), 900), (front(), 900)]

# 15 收到信：星星眼，两条触手抱着小信封，左右轻轻晃（播一次）
def letter(dx):
    f = front(eye='happy'); f.ox += dx
    rect(f, 5, 8, 12, 11, 'w')
    for x, y in ((5, 8), (6, 9), (7, 10), (12, 8), (11, 9), (10, 10)): f.put(x, y, 'O')
    f.put(8, 10, 'P'); f.put(9, 10, 'P')
    f.put(4, 9, 'D'); f.put(13, 9, 'D')
    return f
S['15-收到信'] = [(letter(0), 300), (letter(-1), 260), (letter(0), 260), (letter(1), 260), (letter(0), 260), (letter(-1), 260), (letter(0), 700)]

# 16 提醒睡觉：面无表情，两条触手举着「睡觉」小牌子（月亮 + z），其余触手稳稳撑着
def sign(blink=False, up=0):
    f = front(eye='blink' if blink else 'dot', legs=["..B...B....B......", ".D....D....D......"])
    f.ox -= 5  # 往左挪一点，牌子举在右边
    for x, y, c in ((16, 9, 'B'), (17, 8, 'B'), (18, 8, 'B'), (19, 8, 'D')): f.put(x, y, c)  # 右边那条伸过去握着竿子
    for y in range(4 - up, 11): f.put(20, y, 'O')       # 竿子
    rect(f, 17, -4 - up, 24, 3 - up, 'O'); rect(f, 18, -3 - up, 23, 2 - up, 'w')  # 牌子
    for x, y in ((18, -2), (19, -2), (19, -1), (20, -1), (19, 0), (20, 0), (18, 1), (19, 1)): f.put(x, y - up, 'Y')  # 月亮（弯弯的一牙）
    for x, y in ((21, -2), (22, -2), (23, -2), (22, -1), (21, 0), (21, 1), (22, 1), (23, 1)): f.put(x, y - up, 'E')  # Z
    return f
S['16-提醒睡觉'] = [(sign(), 900), (sign(up=1), 300), (sign(), 900), (sign(up=1), 300), (sign(True), 140), (sign(), 1500)]

# 走路：触手一前一后地挪，身体轻轻一颠
WALK1 = ["..B...B....B...B..", "...D...D....D...D."]
WALK2 = ["..B...B....B...B..", ".D...D....D...D..."]
S['0-走路'] = [(front(legs=WALK1), 170), (front(dy=-1), 130), (front(legs=WALK2), 170), (front(dy=-1), 130)]

def render(f, s=12, bg=BG):
    im = Image.new('RGBA', (W * s, H * s), (bg + (255,)) if bg else (0, 0, 0, 0))
    for (x, y), c in f.px.items():
        if c in PAL: im.paste(PAL[c] + (255,), (x * s, y * s, (x + 1) * s, (y + 1) * s))
    return im
for d in ('动图', '动图-透明', '帧-原尺寸'): os.makedirs(f'{OUT}/{d}', exist_ok=True)
for name, frames in S.items():
    imgs = [render(f).convert('RGB') for f, _ in frames]
    imgs[0].save(f'{OUT}/动图/{name}.gif', save_all=True, append_images=imgs[1:], duration=[d for _, d in frames], loop=0)
    t = [render(f, bg=None) for f, _ in frames]
    t[0].save(f'{OUT}/动图-透明/{name}.gif', save_all=True, append_images=t[1:], duration=[d for _, d in frames], loop=0, disposal=2, transparency=0)
    strip = Image.new('RGBA', (W * len(frames), H), (0, 0, 0, 0))
    for i, (f, _) in enumerate(frames): strip.paste(render(f, s=1, bg=None), (i * W, 0))
    strip.save(f'{OUT}/帧-原尺寸/{name}.png')
s = 6
rows = list(S.items()); mw = max(len(fr) for _, fr in rows)
sheet = Image.new('RGB', (W * s * mw, H * s * len(rows)), BG)
for r, (name, frames) in enumerate(rows):
    for i, (f, _) in enumerate(frames): sheet.paste(render(f, s=s).convert('RGB'), (i * W * s, r * H * s))
sheet.save(f'{OUT}/全部帧.png')
# 每个状态挑一帧的总览（大一点）
pick = {'1-待机': 0, '2-开心': 2, '3-害羞': 1, '4-困了': 0, '5-思考': 1, '6-吐泡泡': 2, '7-报错': 4, '8-两条敲': 0, '9-四条敲': 1, '10-调用工具': 0, '11-共读': 0, '12-共写': 2, '13-等待': 1, '14-成功': 2, '15-收到信': 1, '16-提醒睡觉': 0}
s2 = 6; cols = 4
ov = Image.new('RGB', (W * s2 * cols, H * s2 * ((len(pick) + cols - 1) // cols)), BG)
for i, (n, k) in enumerate(pick.items()): ov.paste(render(S[n][k][0], s=s2).convert('RGB'), ((i % cols) * W * s2, (i // cols) * H * s2))
ov.save(f'{OUT}/一览.png')
print('ok')
# 示意：站在输入框上面靠右（左：待机，右：敲键盘）
from PIL import ImageDraw
sc = 4
mock = Image.new('RGB', (780, 520), (232, 232, 236))
d = ImageDraw.Draw(mock)
d.rounded_rectangle((24, 300, 756, 470), radius=70, fill=(255, 255, 255))
for k, (name, x) in enumerate((('1-待机', 300), ('8-两条敲', 560))):
    pet = render(S[name][0][0], s=sc, bg=None)
    mock.paste(pet, (x, 300 - (FY + BOT + 3) * sc), pet)
mock.save(f'{OUT}/示意-输入框上面.png')

# ---------- 给栖所用：透明的原尺寸帧条 + 每帧多久 ----------
import json
KEYS = {'0-走路': 'walk', '1-待机': 'idle', '2-开心': 'happy', '3-害羞': 'shy', '4-困了': 'sleepy', '5-思考': 'think', '6-吐泡泡': 'bubble', '7-报错': 'error',
        '8-两条敲': 'type2', '9-四条敲': 'type4', '10-调用工具': 'tool', '11-共读': 'read', '12-共写': 'write', '13-等待': 'wait', '14-成功': 'success', '15-收到信': 'letter', '16-提醒睡觉': 'bedtime'}
ONCE = {'happy', 'shy', 'success', 'letter', 'bubble'}
APP = sys.argv[2] if len(sys.argv) > 2 else None
if APP:
    os.makedirs(f'{APP}/public/pet', exist_ok=True)
    meta = {}
    for name, frames in S.items():
        k = KEYS[name]
        strip = Image.new('RGBA', (W * len(frames), H), (0, 0, 0, 0))
        for i, (f, _) in enumerate(frames): strip.paste(render(f, s=1, bg=None), (i * W, 0))
        strip.save(f'{APP}/public/pet/{k}.png', optimize=True)
        meta[k] = {'durs': [d for _, d in frames], **({'once': True} if k in ONCE else {})}
    with open(f'{APP}/src/lib/petFrames.js', 'w') as fp:
        fp.write('// 小章鱼桌宠的动作：每个动作一张横排的帧条（public/pet/<名字>.png，每帧 %d×%d 像素），这里记每帧停多久；once 的播一次就回去\n' % (W, H))
        fp.write('// 由 tools/pet_sprites.py 生成，改动作请改脚本再导出\n')
        fp.write(f'export const PET_W = {W};\nexport const PET_H = {H};\n')
        fp.write(f'export const PET_FEET = {FY + BOT + 3}; // 脚底下面那一行（站在东西上时，把这一行对齐到那个东西的上沿）\n')
        fp.write('export const PET_FRAMES = ' + json.dumps(meta, ensure_ascii=False) + ';\n')
