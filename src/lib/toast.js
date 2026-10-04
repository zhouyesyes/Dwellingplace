import { ref } from "vue";

export const toastText = ref("");
let timer;
export function toast(text, ms = 2200) {
  toastText.value = text;
  clearTimeout(timer);
  timer = setTimeout(() => (toastText.value = ""), ms);
}
