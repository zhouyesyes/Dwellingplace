// 回复里的小效果：**加粗**、*斜体*、~~划掉~~、`代码`（只认一行之内的，别的原样显示）
const esc = s => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export function inlineMd(text) {
  return esc(String(text || ""))
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/~~([^~\n]+?)~~/g, "<del>$1</del>");
}
