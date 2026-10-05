# 部署心潮·念（给 AI 接上心潮和记忆库）

[心潮·念](https://github.com/tianyupaipai-cmd/xinchao-nian) 是跑在你自己服务器上的「心潮（情绪、驱力）+ 记忆库」。每个 AI 部署一份，记忆完全分开。部署好以后，在栖所里把它当成一个 MCP 接给对应的 AI。

需要准备：

- 一台境外服务器（Ubuntu，装好 Docker），比如腾讯云轻量「Ubuntu24.04-Docker」镜像
- 一个域名（比如 `qisuo.xyz`）
- 一个整理记忆用的小模型 Key（OpenAI 兼容格式，建议 deepseek-chat 这种不带思考的模型）

整体是这样连起来的：

```
栖所 / AI ──https──> Cloudflare ──隧道──> 你的服务器 ──> 心潮·念（每个 AI 一份）
```

隧道的好处：服务器不用开任何端口，https 证书 Cloudflare 自动给。

---

## 第 1 步：把域名交给 Cloudflare 管

1. 打开 Cloudflare → **添加域**（Add a domain），输入你买的域名，选 **Free** 免费计划
2. Cloudflare 会给你两个「名称服务器」（nameserver），形如 `xxx.ns.cloudflare.com`，记下来
3. 回到买域名的地方（腾讯云：域名注册 → 我的域名 → 管理 → **修改 DNS 服务器**），把原来的两个换成 Cloudflare 给的两个
4. 等它生效（几分钟到几小时）。Cloudflare 上这个域名显示 **有效 / Active** 就好了

## 第 2 步：在服务器上部署

1. 腾讯云控制台 → 轻量应用服务器 → 你的服务器 → **登录**（会打开一个网页版的终端）
2. 把下面这一行整行复制、粘贴进去，回车：

   ```bash
   bash <(curl -fsSL https://raw.githubusercontent.com/zhouyesyes/Dwellingplace/main/deploy/xinchao/setup.sh)
   ```

3. 按提示回答几个问题：

   | 问题 | 第一份（心晴） | 第二份（小机） |
   | --- | --- | --- |
   | 英文代号 | `xin` | `ji` |
   | 端口 | `18110` | `18111` |
   | AI 的名字 | 心晴 | 小机 |
   | TA 怎么称呼你 | 你想要的称呼 | 你想要的称呼 |
   | 网址 | `xin.你的域名` | `ji.你的域名` |
   | 小模型 | 接口地址、模型名、Key | 同左 |

4. 第一次要下载、构建几分钟。最后会显示一段「连接信息」，**先别关**，后面要用。这段信息也存在服务器上，以后想再看，运行最后提示的那句 `cat …` 就行

> 连接信息里的地址和口令等于钥匙：不要发给别人，也不要截图发到群里。

## 第 3 步：Cloudflare 隧道（只做一次，两份共用）

1. Cloudflare → **Zero Trust**（第一次进要选免费计划，可能要填一张卡，但不扣钱）
2. **网络（Networks）→ 隧道（Tunnels）→ 创建隧道**，类型选 **Cloudflared**，名字随便，比如 `qisuo`
3. 选安装方式 **Docker**，页面会给一行 `docker run cloudflare/cloudflared:latest tunnel ... --token 一长串`。只需要复制最后那串 token，然后在服务器的终端里运行（把 `你的token` 换掉）：

   ```bash
   sudo docker run -d --name cloudflared --restart unless-stopped --network host cloudflare/cloudflared:latest tunnel --no-autoupdate run --token 你的token
   ```

   Cloudflare 页面上显示「已连接 / Connected」就好了，点下一步

4. **添加公共主机名（Public Hostname）**：
   - 子域：`xin`　域：选你的域名
   - 服务类型：`HTTP`　URL：`localhost:18110`
   - 保存
5. 以后部署第二份时，回到这个隧道 → 公共主机名 → 再加一条：`ji` → `HTTP` → `localhost:18111`

**怎么确认成功了**：手机浏览器打开 `https://xin.你的域名/health`，看到 `"ok":true` 就通了。

## 第 4 步：在栖所里接上

1. 栖所「设置 → 工具 → 添加 MCP」
2. 名字、地址照着「连接信息」里【栖所 → 添加 MCP】那一段填；请求头不用填
3. 「哪些角色可以用」只勾这一份对应的 AI
4. 点 **测试并读取工具**，能读到 `xinchao_context` 等工具就成功了，保存

之后可以在聊天里让 TA 调一次 `xinchao_context` 看看自己此刻的状态。心潮·念还自带两份给 AI 读的说明：《小机手册》和《窗口里会出现什么》（在它的仓库 `xinchao/docs/` 里），可以发给 TA 读。

---

## 常见问题

**`/health` 打不开**：先在服务器上运行 `curl http://127.0.0.1:18110/health`。服务器上能通、外面不通，是隧道的问题（第 3 步）；服务器上也不通，看日志：`cd ~/xinchao-xin && sudo docker compose logs --tail 50`。

**测试 MCP 时 401**：地址最后那一长串要完整复制，不能多空格。

**服务器重启以后**：心潮·念和隧道都会自动重新启动，不用管。

**占多少内存**：心潮那部分限制在 128MB 以内；记忆库不在本机跑模型，也不大。两份加隧道，4G 内存的服务器很宽裕。
