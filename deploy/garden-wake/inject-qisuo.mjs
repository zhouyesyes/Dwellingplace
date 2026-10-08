#!/usr/bin/env node
// 花园唤醒桥的 injector：桥收到「轮到你了」，把这一行 JSON 交给我；我请栖所的中转把对应的 AI 叫醒。
// 需要的环境变量：QISUO_RELAY_URL（中转地址）、QISUO_RELAY_TOKEN（中转密码）、QISUO_ROLE_ID（栖所里这个 AI 的编号）
// 成功退出 0；失败退出 1 并把原因写到 stderr（桥会再试一次，不会无限重试）
let input = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) input += chunk;
const fail = msg => { process.stderr.write(String(msg).slice(0, 300) + "\n"); process.exit(1); };

let env;
try { env = JSON.parse(input.split("\n")[0]); } catch { fail("读不懂桥发来的内容"); }
if (env?.type !== "garden_wake") fail("不是 garden_wake");

const url = (process.env.QISUO_RELAY_URL || "").trim().replace(/\/+$/, "");
const token = (process.env.QISUO_RELAY_TOKEN || "").trim();
const roleId = (process.env.QISUO_ROLE_ID || "").trim();
if (!url || !token || !roleId) fail("缺少 QISUO_RELAY_URL / QISUO_RELAY_TOKEN / QISUO_ROLE_ID");

try {
  const r = await fetch(`${url}/wake/poke`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Relay-Token": token },
    body: JSON.stringify({ roleId, reason: env.reason, message: env.message }),
    signal: AbortSignal.timeout(10 * 60_000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) fail(`中转返回 ${r.status}：${j.error || ""}`);
  process.stdout.write(`叫醒了（${j.item?.silent ? "没发消息" : "发了消息"}）\n`);
  process.exit(0);
} catch (e) {
  fail("连不上中转：" + (e.message || e));
}
