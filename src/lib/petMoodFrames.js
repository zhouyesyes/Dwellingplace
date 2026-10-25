// 小章鱼跟水温变的动作：帧条在 public/pet/m-<水温>.png（每帧 32×20 像素），这里记每帧停多久
// 由 tools/mood_sprites.py 生成；没有水温时不用这些，还是原来的待机
export const PET_MOOD_FRAMES = {"m-bottle": {"durs": [900, 700, 900, 140, 1000]}, "m-night": {"durs": [900, 800, 1000, 800]}, "m-ebb": {"durs": [1700, 1500]}, "m-sunny": {"durs": [280, 280, 280, 280]}, "m-rain": {"durs": [300, 300, 300]}};
