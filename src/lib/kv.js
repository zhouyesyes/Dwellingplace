// 本地存储（IndexedDB）的一层薄壳：存、删的时候顺便告诉「同步」哪一样变了
// sync: 开头的是同步自己的记账，只在这台设备上，不往外传
import { get as idbGet, set as idbSet, del as idbDel } from "idb-keyval";

const listeners = new Set();
export const isLocalKey = k => k.startsWith("sync:");
export const onLocalChange = fn => listeners.add(fn);
const tell = k => { if (!isLocalKey(k)) for (const fn of listeners) fn(k); };

export const get = idbGet;
export async function set(k, v) { await idbSet(k, v); tell(k); }
export async function del(k) { await idbDel(k); tell(k); }
