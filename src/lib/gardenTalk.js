// 已停用的小房间存档。这里只读取旧记录、接收升级前已完成的旧任务，不启动模型或工具。
import { reactive } from "vue";
import { store, uid } from "../store/index.js";
import { get, set, onRemoteChange } from "./kv.js";
const idOf = (role, key) => `${role.id}:${key}`;
// ---------- 对话记录（单独存，会同步）----------
const talks = reactive({});
// 别的设备同步来了新的：已经打开过的这份对话，原地换成新的
onRemoteChange(k => {
  if (!k.startsWith("gtalk:")) return;
  const id = k.slice(6);
  if (talks[id]) get(k).then(v => talks[id].splice(0, talks[id].length, ...(v || [])));
});
export async function loadGRoom(role, key) {
  const id = idOf(role, key);
  if (!talks[id]) talks[id] = (await get(`gtalk:${id}`)) || [];
  return talks[id];
}
export const saveGRoom = (role, key) => set(`gtalk:${idOf(role, key)}`, JSON.parse(JSON.stringify(talks[idOf(role, key)] || [])));

export const gSum = (role, key) => store.gardenTalk?.[idOf(role, key)] || null;

export async function ingestWakeRoom(role, item, key) {
  const list = await loadGRoom(role, key);
  if (list.some(m => m.wakeId === item.id)) return;
  const text = String(item.text || "").replace(/\[(心得|房间|转到)[:：][^\]]*\]/g, "").trim();
  const notes = [{ text: "升级前已完成的旧房间任务" }, ...(item.notes || []), ...(item.error ? [{ text: item.error }] : [])];
  const quiet = item.silent || !text;
  list.push({ id: uid(), wakeId: item.id, from: "ai", text: quiet ? "" : text, notes, ts: item.ts });
  await saveGRoom(role, key);
  return { quiet, said: text, notes };
}
