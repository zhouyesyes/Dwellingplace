// 本地存储（IndexedDB）的一层薄壳：存、删的时候顺便告诉「同步」哪一样变了
// sync: 开头的是同步自己的记账，只在这台设备上，不往外传
import { get as idbGet, set as idbSet, del as idbDel, createStore } from "idb-keyval";

const listeners = new Set();
export const isLocalKey = k => k.startsWith("sync:");
export const onLocalChange = fn => listeners.add(fn);
const tell = k => { if (!isLocalKey(k)) for (const fn of listeners) fn(k); };

export const get = idbGet;
export async function set(k, v) { await idbSet(k, v); tell(k); }
export async function del(k) { await idbDel(k); tell(k); }

// 远端落盘单独通知缓存，不算本地编辑，避免再次上传形成循环。
const remoteListeners = new Set();
export const onRemoteChange = fn => remoteListeners.add(fn);
export const notifyRemoteChange = k => { for (const fn of remoteListeners) fn(k); };

// 同一事务提交正文、书架和可恢复快照，失败时 IndexedDB 自动回滚。
const transactionStore = createStore('keyval-store', 'keyval');
// edit 必须同步完成；读取、并发校验和全部写入共用一个写事务。
export async function editMany(keys, edit, signal) {
  let changes;
  const result = await transactionStore('readwrite', kv => new Promise((resolve, reject) => {
    const tx = kv.transaction;
    const cancel = () => { try { tx.abort(); } catch { /* 已完成的事务不能再中止 */ } };
    signal?.addEventListener('abort', cancel, { once: true });
    const cleanup = () => signal?.removeEventListener('abort', cancel);
    tx.oncomplete = () => { cleanup(); resolve(changes?.result); };
    tx.onabort = tx.onerror = () => { cleanup(); reject(tx.error || new Error('保存期间数据发生变化，事务已取消，请重新预览')); };
    if (signal?.aborted) { cancel(); return; }
    const values = new Map();
    const run = () => {
      try {
        changes = edit(values);
        for (const [k, v] of changes.entries || []) kv.put(v, k);
        for (const k of changes.remove || []) kv.delete(k);
      } catch (e) { tx.abort(); reject(e); }
    };
    let pending = keys.length;
    if (!pending) run();
    for (const k of keys) {
      const request = kv.get(k);
      request.onsuccess = () => { values.set(k, request.result); if (!--pending) run(); };
    }
  }));
  for (const k of [...(changes.entries || []).map(([k]) => k), ...(changes.remove || [])]) {
    try { tell(k); } catch (e) { console.error("事务已保存，同步通知失败", e); }
  }
  return result;
}
export async function setMany(entries, expected = [], signal) {
  return editMany(expected.map(([k]) => k), values => {
    for (const [k, value] of expected) {
      if (JSON.stringify(values.get(k)) !== JSON.stringify(value)) throw new Error('旧书数据已变化，请重新预览');
    }
    return { entries };
  }, signal);
}
