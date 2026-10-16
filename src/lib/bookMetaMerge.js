// 覆盖导入期间合并本页待保存修改与数据库新数据；同一字段冲突不能猜谁对。
export const sameMeta = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const object = v => v && typeof v === 'object' && !Array.isArray(v);
const keyed = v => Array.isArray(v) && v.every(x => object(x) && x.id != null) && new Set(v.map(x => x.id)).size === v.length;
export function mergeBookMeta(base, local, latest) {
  if (sameMeta(local, latest) || sameMeta(latest, base)) return local;
  if (sameMeta(local, base)) return latest;
  if (object(local) && object(latest)) {
    const out = {};
    for (const k of new Set([...Object.keys(base || {}), ...Object.keys(local), ...Object.keys(latest)])) {
      const value = mergeBookMeta(base?.[k], local[k], latest[k]);
      if (value !== undefined) out[k] = value;
    }
    return out;
  }
  if (keyed(local) && keyed(latest) && (base === undefined || keyed(base))) {
    const b = new Map((base || []).map(x => [x.id, x])), l = new Map(local.map(x => [x.id, x])), r = new Map(latest.map(x => [x.id, x]));
    const common = (base || []).map(x => x.id).filter(id => l.has(id) && r.has(id));
    const order = list => list.map(x => x.id).filter(id => common.includes(id));
    const localMoved = !sameMeta(order(local), common), remoteMoved = !sameMeta(order(latest), common);
    if (localMoved && remoteMoved && !sameMeta(order(local), order(latest))) throw Error('书架顺序发生并发修改');
    const primary = localMoved ? local : latest;
    const ids = [...new Set([...primary.map(x => x.id), ...local.map(x => x.id), ...latest.map(x => x.id)])];
    return ids.map(id => mergeBookMeta(b.get(id), l.get(id), r.get(id))).filter(v => v !== undefined);
  }
  throw Error('其他窗口也修改了同一内容');
}

// 合并完成后只把远端改动应用到本页，等待事务期间产生的本页新修改继续保留。
export function applyBookMeta(target, before, next) {
  for (const k of new Set([...Object.keys(before), ...Object.keys(next)])) {
    if (sameMeta(before[k], next[k])) continue;
    if (sameMeta(target[k], before[k])) {
      if (k in next) target[k] = next[k];
      else delete target[k];
    } else if (object(target[k]) && object(before[k]) && object(next[k])) applyBookMeta(target[k], before[k], next[k]);
    else if (keyed(target[k]) && keyed(before[k]) && keyed(next[k])) {
      for (const item of next[k]) {
        const old = before[k].find(x => x.id === item.id), current = target[k].find(x => x.id === item.id);
        if (old && current) applyBookMeta(current, old, item);
        else if (!old && !current) target[k].push(item);
      }
    }
  }
}
