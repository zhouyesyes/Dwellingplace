import http from "node:http";
import { pipeline } from "node:stream/promises";

export async function handleDsh(req, res, path, cors) {
  const json = (status, message) => {
    res.writeHead(status, { ...cors, "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: { message } }));
  };
  if (path !== "/chat" || req.method !== "POST") return json(404, "找不到 DSH 聊天接口");
  const socketPath = process.env.DSH_SOCKET;
  if (!socketPath) return json(503, "这台栖所服务器还没启用 DSH");

  const upstream = http.request({
    socketPath, path, method: "POST",
    headers: { authorization: req.headers.authorization || "" },
  });
  const cancel = () => upstream.destroy();
  const response = new Promise((resolve, reject) => {
    upstream.once("response", resolve);
    upstream.once("error", reject);
  });
  res.once("close", cancel);
  req.once("error", cancel);
  req.pipe(upstream);
  try {
    const incoming = await response;
    res.writeHead(incoming.statusCode, {
      ...cors, "Content-Type": incoming.headers["content-type"], "Cache-Control": "no-store", "X-Accel-Buffering": "no",
    });
    await pipeline(incoming, res);
  } catch {
    if (!res.headersSent && !res.destroyed) json(503, "DSH 暂时连不上，请稍后再试");
  } finally {
    res.off("close", cancel);
    req.off("error", cancel);
    req.unpipe(upstream);
    req.resume();
  }
}
