// 你自己的服务器地址（带口令）：从同步地址、或者走自己服务器的 API 地址里找，像 https://app.xx.com/p/口令
import { get as idbGet } from "idb-keyval";
import { store } from "../store/index.js";

export async function serverBase() {
  const conf = await idbGet("sync:conf").catch(() => null);
  const urls = [conf?.url, ...store.apis.map(a => a.baseUrl)].filter(Boolean);
  for (const u of urls) { const m = String(u).match(/^(https?:\/\/[^/]+\/p\/[^/]+)\//); if (m) return m[1]; }
  return "";
}
