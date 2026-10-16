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
export async function setMany(entries, expected = []) {
  await transactionStore('readwrite', kv => new Promise((resolve, reject) => {
    const tx = kv.transaction;
    tx.oncomplete = resolve;
    tx.onabort = tx.onerror = () => reject(tx.error || new Error('保存事务已取消'));
    const fail = e => { tx.abort(); reject(e); };
    const write = () => {
      try { for (const [k, v] of entries) kv.put(v, k); }
      catch (e) { fail(e); }
    };
    let pending = expected.length;
    if (!pending) write();
    for (const [k, value] of expected) {
      const request = kv.get(k);
      request.onsuccess = () => {
        if (JSON.stringify(request.result) !== JSON.stringify(value)) return fail(new Error('旧书数据已变化，请重新预览'));
        if (!--pending) write();
      };
    }
  }));
  for (const [k] of entries) {
    try { tell(k); } catch (e) { console.error("事务已保存，同步通知失败", e); }
  }
}
