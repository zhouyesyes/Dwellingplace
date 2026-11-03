// 返回上一页；如果是直接打开的页面（没有上一页），就回到指定页面
export function goBack(router, fallback) {
  if (window.history.state?.back) router.back();
  else router.replace(fallback);
}

// 手机上从屏幕左边缘往右一划 = 返回（像 Obsidian 手机版；iOS 网页应用自带的返回手势不一定有）
import { onMounted, onBeforeUnmount } from "vue";
export function useSwipeBack(onBack) {
  let sx = 0, sy = 0, on = false;
  const start = e => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; on = sx < 28; };
  const end = e => {
    if (!on) return;
    on = false;
    const t = e.changedTouches[0];
    if (t.clientX - sx > 80 && Math.abs(t.clientY - sy) < 60) onBack();
  };
  onMounted(() => { document.addEventListener("touchstart", start, { passive: true }); document.addEventListener("touchend", end, { passive: true }); });
  onBeforeUnmount(() => { document.removeEventListener("touchstart", start); document.removeEventListener("touchend", end); });
}
