// 对话的「版本树」：修改消息、重新生成都不删除旧的，而是在同一个位置多一个版本。
// 每条消息有 parentId（回复的是哪一条，第一条是 "root"）；
// thread.sel[parentId] 记着这个位置选的是哪个版本，没选过就看最新的那个。
export const ROOT = "root";

export const parentOf = m => m.parentId ?? ROOT;

export function childrenOf(all, pid) {
  return all.filter(m => parentOf(m) === pid);
}

// 当前显示的这一条路径
export function activePath(all, sel = {}) {
  const byParent = new Map();
  for (const m of all) {
    const p = parentOf(m);
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p).push(m);
  }
  const path = [];
  let p = ROOT;
  for (;;) {
    const kids = byParent.get(p);
    if (!kids?.length) break;
    const chosen = kids.find(k => k.id === sel[p]) || kids[kids.length - 1];
    path.push(chosen);
    p = chosen.id;
  }
  return path;
}

// 某条消息在同一位置的所有版本，以及它是第几个
export function versionsOf(all, m) {
  const sibs = childrenOf(all, parentOf(m));
  return { list: sibs, index: sibs.indexOf(m) };
}

// 删除一条消息以及它后面的所有分支
export function removeSubtree(all, id) {
  const dead = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const m of all) if (!dead.has(m.id) && dead.has(parentOf(m))) { dead.add(m.id); grew = true; }
  }
  for (let i = all.length - 1; i >= 0; i--) if (dead.has(all[i].id)) all.splice(i, 1);
}

// 旧版本的数据是一条直线、提示条单独成一条：转换成树，提示条挂到前一条消息的 notes 上
export function migrateFlat(all) {
  if (!all.length || all.some(m => m.parentId !== undefined)) return false;
  const out = [];
  let prev = null;
  for (const m of all) {
    if (m.from === "event") {
      if (prev) (prev.notes ??= []).push({ text: m.text, sources: m.sources, calAction: m.calAction });
      continue;
    }
    m.parentId = prev ? prev.id : ROOT;
    out.push(m);
    prev = m;
  }
  all.splice(0, all.length, ...out);
  return true;
}
