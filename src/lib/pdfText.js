// 从 PDF 里取出文字：有的接口（比如 ChatGPT 会员那条）不收 PDF 文件，就把字取出来当文字发过去。
// pdf.js 比较大，用到的时候才下载
export async function pdfText(blob, maxChars = 200_000) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.min.mjs");
  const worker = (await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
  const pages = [];
  let n = 0;
  for (let i = 1; i <= doc.numPages && n < maxChars; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    // 同一行的字连起来，换行的地方换行
    let line = "", lastY = null;
    const lines = [];
    for (const it of tc.items) {
      const y = it.transform?.[5];
      if (lastY != null && Math.abs(y - lastY) > 2) { lines.push(line); line = ""; }
      line += it.str;
      if (it.hasEOL) { lines.push(line); line = ""; }
      lastY = y;
    }
    if (line) lines.push(line);
    const t = lines.map(s => s.trim()).filter(Boolean).join("\n");
    pages.push(t);
    n += t.length;
  }
  return pages.join("\n\n").slice(0, maxChars);
}
