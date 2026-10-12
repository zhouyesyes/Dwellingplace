// 输入框跟着字变高：iPhone 的 Safari 还不认 field-sizing，只好自己量。v-auto-grow="最高多少像素"
export const vAutoGrow = {
  mounted(el, { value }) {
    el._fit = () => {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight + 1, value || 99999) + "px";
      el.style.overflowY = el.scrollHeight > (value || 99999) ? "auto" : "hidden";
    };
    el.addEventListener("input", el._fit);
    requestAnimationFrame(el._fit);
  },
  updated(el) { requestAnimationFrame(() => el._fit?.()); },
  unmounted(el) { el.removeEventListener("input", el._fit); },
};
