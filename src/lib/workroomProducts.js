// 只收起已回传截图的独立链接行；正文、代码和未收取文件仍照常展示。
export function productText(text, files = []) {
  const names = new Set(files.map(a => a.name));
  let inCode = false, noted = false;
  return String(text || '').split('\n').flatMap(line => {
    if (/^\s*```/.test(line)) { inCode = !inCode; return [line]; }
    if (inCode) return [line];
    const m = line.match(/^\s*(?:[-*]|\d+\.)?\s*\[[^\]]+\]\(([^)]+)\)\s*$/);
    const target = m?.[1];
    if (!target || !target.includes('/.qisuo-previews/') || !names.has(target.split('/').at(-1))) return [line];
    if (noted) return [];
    noted = true;
    return ['截图见本轮「任务产物」。'];
  }).join('\n');
}
