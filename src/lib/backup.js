// 备份：把 IndexedDB 里的所有东西（数据、聊天记录、图片、文件）打包成一个 JSON 文件
import { entries, clear, setMany } from "idb-keyval";
import { store } from "../store/index.js";

const APP = "dwellingplace";

async function blobToBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

function base64ToBlob(b64, type) {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type });
}

export async function exportAll({ includeKeys = true } = {}) {
  const data = {};
  for (const [k, v] of await entries()) {
    data[k] = v instanceof Blob ? { __blob: await blobToBase64(v), type: v.type } : v;
  }
  // 用内存里最新的数据（磁盘上的可能还没来得及写）
  const meta = JSON.parse(JSON.stringify(store));
  if (!includeKeys) {
    for (const a of meta.apis) a.key = "";
    for (const s of meta.mcpServers || []) {
      for (const h of s.headers || []) h.value = "";
      // 写在网址里的口令：心潮的 /mcp/口令、邮箱脚本的 ?key=
      s.url = (s.url || "").replace(/\/mcp\/[^/?#]+/, "/mcp/").replace(/([?&]key=)[^&#]*/, "$1");
    }
    for (const r of meta.roles || []) if (r.xinchao) r.xinchao.dashToken = "";
    if (meta.tools?.relay) meta.tools.relay.token = "";
    if (meta.tools?.search) meta.tools.search.key = "";
  }
  data.meta = meta;
  const json = JSON.stringify({ app: APP, version: 1, exportedAt: new Date().toISOString(), data });
  return new Blob([json], { type: "application/json" });
}

export async function readBackup(file) {
  const j = JSON.parse(await file.text());
  if (j?.app !== APP || !j.data?.meta) throw new Error("这不是栖所的备份文件");
  return j;
}

export async function restoreAll(backup) {
  const pairs = Object.entries(backup.data).map(([k, v]) => [k, v && v.__blob ? base64ToBlob(v.__blob, v.type) : v]);
  await clear();
  await setMany(pairs);
}
