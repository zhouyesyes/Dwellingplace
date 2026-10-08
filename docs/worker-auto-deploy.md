# 中转自动更新：以后不用再手动粘贴代码

设置一次以后，GitHub 上的 `relay/worker.js` 一更新（合并 PR 之后），Cloudflare 会自己把中转换成最新版。全程在网页上点，手机、平板都可以。

你在 Worker 里已经填好的东西（`RELAY_TOKEN` 密码、搜索的 Key、KV 里存的闹钟和订阅）都会保留。

## 先准备两样东西

1. **Worker 的名字**：Cloudflare → **Workers 和 Pages** → 你的中转。页面最上面那个名字，一个字都不能差
2. **KV 的 ID**：Cloudflare 左边菜单 → **存储和数据库** → **KV** → 唤醒用的那个（比如 `qisuo`）。名字旁边或点进去能看到一串 32 位的字母数字，就是 ID，复制下来

## 连接 GitHub

1. 打开你的中转 Worker → **设置**（Settings）→ **构建**（Build）→ **Git 存储库** 旁边点 **连接**（Connect）
2. 第一次会让你授权 GitHub：选你的账号，**只选** `Dwellingplace` 这一个仓库就够了
3. 回到 Cloudflare，按下面填。**Cloudflare 会预先填好 `npm run build`、根目录 `/` 这些默认值，一定要改掉**，不然它会把栖所网页当成中转部署上去，把中转顶掉：

| 项目 | 填什么 |
|---|---|
| Git 帐户 / 存储库 | 你的账号 / `Dwellingplace` |
| 分支（Branch） | `main` |
| 构建命令（Build command） | 空着 |
| 部署命令（Deploy command） | `node config.mjs && npx wrangler deploy` |
| 路径 / 根目录（Path / Root directory） | `relay` |
| 构建变量（Builds 里的 Variables and secrets） | 添加两个（每个变量**上面那格填名字，下面那格填值**）：名字 `WORKER_NAME`、值 Worker 的名字；名字 `KV_ID`、值 KV 的 ID |
| 构建监视路径（Build watch paths，如果有） | 包含 `relay/*` |
| （可选）构建变量 `RELAY_DOMAIN` | 自己域名下的中转地址，比如 `relay.qisuo.xyz`。每次部署都会带上这个地址，国内不开梯子也能连。加好后把栖所里的「中转地址」换成 `https://relay.qisuo.xyz` |
| （可选）构建变量 `RELAY_REGION` | 指定中转在哪个云区域附近运行，比如 `aws:us-east-1`。一般不用填，让 Cloudflare 自己选离你最近的 |

4. 点 **连接**（Connect）。之后 `relay/` 里的代码有改动（合并 PR）才会构建；想马上构建，去 **Deployments / Builds** 点最新一条的 **Retry build**
5. 在 **部署**（Deployments）或 **构建**（Builds）里看到成功的勾就好了

## 确认一下

栖所 → 设置 → 工具 → 中转 → **测试连接**。能连上就说明好了。

## 出了问题

- **Worker 的设置页写着「only has static assets」，绑定和定时任务都没了**：构建命令、根目录用了默认值，栖所网页被部署成了中转。按上面的表改好（构建命令清空、根目录 `relay`），重新构建一次；然后到 Worker 的 **Settings → Variables and secrets** 看 `RELAY_TOKEN` 还在不在，不在就重新添加（类型选 Secret，值是栖所里填的中转密码）。KV 里的闹钟和通知订阅不会丢
- **构建日志里写「名字和值可能填反了」**：变量的上下两格填反了，删掉重填

- **构建失败，日志里写「缺少构建变量」**：`WORKER_NAME` 或 `KV_ID` 没填，或者填在了运行时变量里。要填在**构建**变量里
- **构建失败，说名字不匹配**：`WORKER_NAME` 和 Worker 的名字不一样，复制最上面那个名字重新填
- **唤醒不动了**：去 **设置 → 触发事件** 看看还有没有 `*/5 * * * *`，没有就按 [wake.md](wake.md) 第 3 步加回来
- 想停掉自动更新：**设置 → 构建 → 断开连接**。中转还是照常运行，只是不再自动更新
