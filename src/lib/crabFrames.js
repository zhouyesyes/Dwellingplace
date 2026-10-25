// 小螃蟹桌宠的动作：帧条在 public/pet/crab/<名字>.png（每帧 32×20 像素），这里记每帧停多久；once 的播一次就回去
// 由 tools/crab_sprites.py 生成，改动作请改脚本再导出
export const CRAB_FRAMES = {"idle": {"durs": [1000, 600, 800, 140, 900, 500, 700, 500, 1200]}, "wiggle": {"durs": [90, 90, 90, 90, 140, 110, 160, 100], "once": true}, "leanin": {"durs": [100, 100, 100, 120], "once": true}, "leanout": {"durs": [80, 90, 90, 90], "once": true}, "type": {"durs": [80, 70, 90, 70, 100, 70, 80, 120, 90, 70, 80, 100, 140, 70, 80, 90]}};
