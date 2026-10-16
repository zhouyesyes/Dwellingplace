import { ref, computed, onMounted, onBeforeUnmount } from "vue";

// 只接管从顶部开始的明确纵向下拉；组件内部的滚动和排序交给原组件。
export function useHomePullRefresh(root, busy, refresh) {
  const distance = ref(0);
  const armed = computed(() => distance.value >= 64);
  let gesture = null;
  let suppressClick = false;
  let clickTimer;
  function reset() { gesture = null; distance.value = 0; }
  function blocked(target) {
    return !root.value || root.value.querySelector('.wdesk.editing') ||
      target.closest('button, a, input, textarea, select, [contenteditable], .wdesk, [role="dialog"]');
  }
  function atTop(target) {
    if (window.scrollY > 1 || document.scrollingElement.scrollTop > 1) return false;
    for (let el = target; el && el !== document.body; el = el.parentElement) {
      // 可滚动容器即使在顶部也不转交刷新，避免抢走其滚动意图。
      const style = getComputedStyle(el);
      if (/(auto|scroll)/.test(style.overflowY + style.overflowX) &&
          (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1)) return false;
      if (el.scrollTop > 1) return false;
    }
    return true;
  }
  function start(e) {
    reset();
    if (busy.value || e.touches.length !== 1 || blocked(e.target) || !atTop(e.target)) return;
    const t = e.touches[0];
    gesture = { id: t.identifier, x: t.clientX, y: t.clientY, target: e.target, active: false };
  }
  function move(e) {
    if (!gesture) return;
    if (busy.value || e.touches.length !== 1 || blocked(gesture.target) || !atTop(gesture.target)) return reset();
    const t = e.touches[0];
    if (t.identifier !== gesture.id) return reset();
    const dx = Math.abs(t.clientX - gesture.x), dy = t.clientY - gesture.y;
    if (!gesture.active) {
      if (dx < 10 && Math.abs(dy) < 10) return;
      if (dy <= 0 || dy < dx * 1.5) return reset();
      gesture.active = true;
    }
    if (!e.cancelable) return reset();
    e.preventDefault(); // iOS 原生回弹/浏览器刷新与这里的指示器不同时运行。
    suppressClick = true;
    distance.value = Math.min(96, Math.max(0, dy * .5));
  }
  function end(e) {
    if (!gesture) return;
    const trigger = !e.touches.length && gesture.active && armed.value && !busy.value;
    reset();
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => { suppressClick = false; }, 450);
    if (trigger) refresh();
  }
  function cancel() {
    reset();
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => { suppressClick = false; }, 450);
  }
  function click(e) {
    if (suppressClick) { e.preventDefault(); e.stopImmediatePropagation(); suppressClick = false; }
  }
  function visibility() { if (document.hidden) cancel(); }
  onMounted(() => {
    root.value.addEventListener('touchstart', start, { passive: true });
    root.value.addEventListener('touchmove', move, { passive: false });
    root.value.addEventListener('touchend', end);
    root.value.addEventListener('touchcancel', cancel);
    root.value.addEventListener('click', click, true);
    window.addEventListener('blur', cancel);
    window.addEventListener('resize', cancel);
    document.addEventListener('visibilitychange', visibility);
  });
  onBeforeUnmount(() => {
    root.value?.removeEventListener('touchstart', start);
    root.value?.removeEventListener('touchmove', move);
    root.value?.removeEventListener('touchend', end);
    root.value?.removeEventListener('touchcancel', cancel);
    root.value?.removeEventListener('click', click, true);
    window.removeEventListener('blur', cancel);
    window.removeEventListener('resize', cancel);
    document.removeEventListener('visibilitychange', visibility);
    clearTimeout(clickTimer);
  });
  return { distance, armed };
}
