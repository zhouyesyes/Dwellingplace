// 回复里的小效果：**加粗**、*斜体*、~~划掉~~、`代码`（只认一行之内的，别的原样显示）
const esc = s => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export function inlineMd(text) {
  return esc(String(text || ""))
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/~~([^~\n]+?)~~/g, "<del>$1</del>");
}

// 一段话里的「块」：# 标题、表格、- 列表、1. 列表、> 引用、--- 分隔线；别的行照原样（行内效果照上面）。
// 输出的 HTML 放在 white-space: pre-wrap 的气泡里：普通行之间留换行，块和块之间不多加空行
const isRow = l => /^\s*\|.*\|\s*$/.test(l);
const isSep = l => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const cellsOf = r => r.trim().replace(/^\||\|$/g, "").split("|").map(c => inlineMd(c.trim()));
export function blockMd(text) {
  const lines = String(text || "").split("\n");
  const out = []; // { block: html } 或 { line: html }
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    let m;
    if (isRow(l) && i + 1 < lines.length && isSep(lines[i + 1])) {
      const head = cellsOf(l);
      const body = [];
      for (i += 2; i < lines.length && isRow(lines[i]); i++) body.push(cellsOf(lines[i]));
      out.push({ block: `<div class="md-tbl"><table><thead><tr>${head.map(c => `<th>${c}</th>`).join("")}</tr></thead><tbody>${body.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` });
      continue;
    }
    if ((m = l.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/))) { out.push({ block: `<div class="md-h md-h${Math.min(m[1].length, 3)}">${inlineMd(m[2])}</div>` }); i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { out.push({ block: `<hr class="md-hr">` }); i++; continue; }
    const list = (re, tag) => {
      const items = [];
      for (; i < lines.length && re.test(lines[i]); i++) items.push(inlineMd(lines[i].replace(re, "")));
      out.push({ block: `<${tag} class="md-list">${items.map(x => `<li>${x}</li>`).join("")}</${tag}>` });
    };
    if (/^\s*[-*•·]\s+/.test(l)) { list(/^\s*[-*•·]\s+/, "ul"); continue; }
    if (/^\s*\d+[.)、]\s*/.test(l) && /^\s*\d+[.)、]\s*\S/.test(l)) { list(/^\s*\d+[.)、]\s*/, "ol"); continue; }
    if (/^\s*>\s?/.test(l)) {
      const q = [];
      for (; i < lines.length && /^\s*>\s?/.test(lines[i]); i++) q.push(inlineMd(lines[i].replace(/^\s*>\s?/, "")));
      out.push({ block: `<blockquote class="md-quote">${q.join("<br>")}</blockquote>` });
      continue;
    }
    out.push({ line: inlineMd(l) });
    i++;
  }
  let html = "";
  out.forEach((x, k) => {
    if (x.line != null) html += (k > 0 && out[k - 1].line != null ? "\n" : "") + x.line;
    else html += x.block;
  });
  return html;
}
