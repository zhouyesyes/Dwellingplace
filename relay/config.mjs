// 给 Cloudflare 自动部署用：根据构建变量生成 wrangler.json，然后 `npx wrangler deploy`
// 构建变量（在 Worker 的「设置 → 构建」里填）：
//   WORKER_NAME  Worker 的名字（和 Cloudflare 里的一模一样）
//   KV_ID        绑定为 KV 的那个 KV 命名空间的 ID
//   RELAY_DOMAIN （可选）自己域名下的中转地址，比如 relay.qisuo.xyz：国内不用梯子也能连
//   RELAY_REGION （可选）指定中转在哪个云区域附近运行，比如 aws:us-east-1；不填就由 Cloudflare 自己选（离你最近）
// 已经在网页上填好的变量和机密（RELAY_TOKEN、搜索 Key……）会保留，不会被覆盖
import { writeFileSync } from "node:fs";

const name = (process.env.WORKER_NAME || "").trim();
const kv = (process.env.KV_ID || "").trim();
const region = (process.env.RELAY_REGION || "").trim();
const domain = (process.env.RELAY_DOMAIN || "").trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
if (!name) throw new Error("缺少构建变量 WORKER_NAME：填 Worker 的名字");
if (!kv) throw new Error("缺少构建变量 KV_ID：填 KV 命名空间的 ID（存储和数据库 → KV 里能看到）");
// 常见填反：把 KV 的 ID 填进了名字那格、把 Worker 名填进了值那格
if (/^[0-9a-f]{32}$/i.test(name)) throw new Error("WORKER_NAME 看起来是 KV 的 ID：变量的名字和值可能填反了");
if (!/^[0-9a-f]{32}$/i.test(kv)) throw new Error("KV_ID 应该是 32 位的字母数字：变量的名字和值可能填反了");

const config = {
  name,
  main: "worker.js",
  compatibility_date: "2025-01-01",
  keep_vars: true,
  kv_namespaces: [{ binding: "KV", id: kv }],
  triggers: { crons: ["*/5 * * * *"] },
  workers_dev: true, // 原来的 xxx.workers.dev 地址也留着
  ...(domain ? { routes: [{ pattern: domain, custom_domain: true }] } : {}),
  observability: { enabled: true },
  ...(region && region !== "auto" ? { placement: { region } } : {}),
};
writeFileSync(new URL("./wrangler.json", import.meta.url), JSON.stringify(config, null, 2));
console.log(`wrangler.json 已生成：${name}（KV 已绑定，每 5 分钟运行一次${domain ? `，地址 https://${domain}` : ""}${region && region !== "auto" ? `，在 ${region} 附近运行` : ""}）`);
