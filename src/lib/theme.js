// 主题：浅色 / 深色 / 跟随系统。选的存在这台设备上（localStorage「qisuo-theme」），index.html 里一打开就先读，免得闪白。
// 颜色都在 styles/base.css 的变量里：:root 是浅色，:root[data-theme="dark"] 是深色
import { ref } from "vue";

const KEY = "qisuo-theme";
const read = () => { try { return localStorage.getItem(KEY) || "system"; } catch { return "system"; } };
export const themePref = ref(read()); // "light" | "dark" | "system"
const media = window.matchMedia?.("(prefers-color-scheme: dark)");

function apply(animate) {
  const dark = themePref.value === "dark" || (themePref.value === "system" && !!media?.matches);
  const root = document.documentElement;
  if ((root.dataset.theme === "dark") === dark) return;
  if (animate) {
    root.classList.add("theme-switching");
    setTimeout(() => root.classList.remove("theme-switching"), 220);
  }
  root.dataset.theme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#1b1e25" : "#f3f1ee");
}
export function setTheme(v) {
  themePref.value = v;
  try { localStorage.setItem(KEY, v); } catch { /* 存不了就只管这一次 */ }
  apply(true);
}
export const isDark = () => document.documentElement.dataset.theme === "dark";
// 跟随系统时，系统那边切了这边也跟着切
media?.addEventListener?.("change", () => { if (themePref.value === "system") apply(true); });
apply(false);
