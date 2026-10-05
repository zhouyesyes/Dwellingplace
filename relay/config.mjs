// 给 Cloudflare 自动部署用：根据构建变量生成 wrangler.json，然后 `npx wrangler deploy`
// 构建变量（在 Worker 的「设置 → 构建」里填）：
//   WORKER_NAME  Worker 的名字（和 Cloudflare 里的一模一样）
//   KV_ID        绑定为 KV 的那个 KV 命名空间的 ID
// 已经在网页上填好的变量和机密（RELAY_TOKEN、搜索 Key……）会保留，不会被覆盖
import { writeFileSync } from "node:fs";

const name = (process.env.WORKER_NAME || "").trim();
const kv = (process.env.KV_ID || "").trim();
if (!name) throw new Error("缺少构建变量 WORKER_NAME：填 Worker 的名字");
if (!kv) throw new Error("缺少构建变量 KV_ID：填 KV 命名空间的 ID（存储和数据库 → KV 里能看到）");

const config = {
  name,
  main: "worker.js",
  compatibility_date: "2025-01-01",
  keep_vars: true,
  kv_namespaces: [{ binding: "KV", id: kv }],
  triggers: { crons: ["*/5 * * * *"] },
  observability: { enabled: true },
};
writeFileSync(new URL("./wrangler.json", import.meta.url), JSON.stringify(config, null, 2));
console.log(`wrangler.json 已生成：${name}（KV 已绑定，每 5 分钟运行一次）`);
