// 全屏编辑：openEditor(text, { title, placeholder }) -> Promise<string | null>
import { reactive } from "vue";

export const editorState = reactive({ open: false, text: "", title: "", placeholder: "", resolve: null });

export function openEditor(text, { title = "", placeholder = "" } = {}) {
  return new Promise(resolve => {
    Object.assign(editorState, { open: true, text: text || "", title, placeholder, resolve });
  });
}

export function closeEditor(save) {
  const done = editorState.resolve;
  const text = editorState.text;
  Object.assign(editorState, { open: false, resolve: null });
  done?.(save ? text : null);
}
