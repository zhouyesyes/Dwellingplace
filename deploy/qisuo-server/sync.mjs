// 多设备同步：栖所的每一样东西（设置、每个对话的聊天记录、图片、文件）在服务器上各存一份，
// 每改一次编一个号（rev）。设备记着自己看到第几号了，来问「之后有什么新的」，改了就交上来。
// 两台设备同时改了同一样东西：后交的那台会被告知「有人先改了」（409），由它取回来合并再交。
//
// 路径（都在 /p/<口令>/sync 下面）：
//   GET    /changes?since=N          → { seq, items: [{ k, rev, del? }] }  N 号之后改过的
//   GET    /item?k=…                 → 原样的内容（X-Rev 头是它的号）
//   PUT    /item?k=…&base=R          存进来；R 是设备以为的当前号（0 = 还没有，* = 不管）；对不上 → 409 { rev }
//   DELETE /item?k=…&base=R          删掉（留个记号，别的设备才知道要删）
import { readFileSync, writeFileSync, renameSync, mkdirSync, createReadStream, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const DIR = join(process.env.DATA_DIR || "/app/data", "sync");
const INDEX = join(DIR, "index.json");
const MAX = 64 * 1024 * 1024; // 一样东西最大 64MB

let index = null; // { seq, items: { key: { rev, type, size, del? } } }
function load() {
  if (index) return index;
  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  try { index = JSON.parse(readFileSync(INDEX, "utf8")); } catch (e) {
    if (e.code !== "ENOENT") throw e; // 索引损坏时停下来，不能当成空云端覆盖旧数据
    index = { seq: 0, items: {} };
  }
  return index;
}
function atomic(f, data) {
  const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, data, { mode: 0o600 });
  renameSync(tmp, f);
}
const saveIndex = () => atomic(INDEX, JSON.stringify(index));
const fileOf = k => join(DIR, createHash("sha256").update(k).digest("hex"));

async function readBody(req) {
  const cs = [];
  let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > MAX) throw Object.assign(new Error("太大了（超过 64MB）"), { status: 413 });
    cs.push(c);
  }
  return Buffer.concat(cs);
}

export async function handleSync(req, res, rest, query, CORS, authorize) {
  const send = (code, obj) => { res.writeHead(code, { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(obj)); };
  try {
    const ix = load();
    if (rest === "/changes" && req.method === "GET") {
      const since = Number(query.get("since")) || 0;
      const items = Object.entries(ix.items).filter(([, v]) => v.rev > since).map(([k, v]) => ({ k, rev: v.rev, ...(v.del ? { del: true } : {}) })).sort((a, b) => a.rev - b.rev);
      return send(200, { seq: ix.seq, items });
    }
    if (rest !== "/item") return send(404, { error: { message: "没有这个地址" } });
    const k = query.get("k");
    if (!k || k.length > 300) return send(400, { error: { message: "缺少 k" } });
    const cur = ix.items[k];
    if (req.method === "GET") {
      if (!cur || cur.del) return send(404, { error: { message: "没有这一样" }, rev: cur?.rev || 0 });
      res.writeHead(200, { ...CORS, "Content-Type": cur.type || "application/octet-stream", "Content-Length": cur.size, "X-Rev": String(cur.rev), "Cache-Control": "no-store" });
      return createReadStream(fileOf(k)).pipe(res);
    }
    if (req.method !== "PUT" && req.method !== "DELETE") return send(405, { error: { message: "不支持" } });
    const base = query.get("base");
    const body = req.method === "PUT" ? await readBody(req) : null; // 先收完再比号：中间别人交的也算
    authorize?.(); // 上传期间可能刚被撤销，落盘前再确认一次
    const now = ix.items[k];
    const curRev = now?.rev || 0;
    if (base !== "*" && Number(base) !== curRev) return send(409, { error: { message: "别的设备先改了" }, rev: curRev });
    ix.seq += 1;
    if (req.method === "PUT") {
      atomic(fileOf(k), body);
      ix.items[k] = { rev: ix.seq, type: String(req.headers["content-type"] || "application/octet-stream").slice(0, 100), size: body.length };
    } else {
      try { unlinkSync(fileOf(k)); } catch { /* 本来就没有 */ }
      ix.items[k] = { rev: ix.seq, del: true };
    }
    saveIndex();
    return send(200, { rev: ix.seq });
  } catch (e) {
    if (res.headersSent) { try { res.end(); } catch { /* 断了 */ } return; }
    return send(e.status || 500, { error: { message: e.message } });
  }
}
