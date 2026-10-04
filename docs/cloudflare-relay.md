# 部署栖所的中转（Cloudflare Worker）

浏览器不能直接访问搜索服务，所以需要一个「中转」替栖所去请求。中转部署在 Cloudflare 上，**免费**，不用买服务器，第一次大约 10 分钟。

> Cloudflare 的网页界面偶尔会改版，按钮名字可能和下面略有不同，找意思相近的就行。

---

## 第 1 步：注册 Cloudflare

打开 <https://dash.cloudflare.com/sign-up>，用邮箱注册并验证邮箱。免费，不需要绑卡。

## 第 2 步：新建一个 Worker

1. 登录后，在左边菜单找到 **Workers & Pages**（「计算」下面）
2. 点 **创建**（Create）→ 选 **从 Hello World 开始**（Start with Hello World）
3. 名字随便取，比如 `qisuo-relay`，点 **部署**（Deploy）

## 第 3 步：粘贴代码

1. 部署完成后点 **编辑代码**（Edit code）
2. 把编辑器里原来的内容**全部删掉**
3. 打开本仓库的 [`relay/worker.js`](../relay/worker.js)，点右上角的「复制」按钮，粘贴进去
4. 点右上角的 **部署**（Deploy）

## 第 4 步：设置中转密码（必须）

防止别人知道你的地址后蹭着用。

1. 回到这个 Worker 的页面，点 **设置**（Settings）→ **变量和机密**（Variables and Secrets）
2. 点 **添加**（Add），类型选 **机密**（Secret）
   - 变量名：`RELAY_TOKEN`
   - 值：自己想一个密码（长一点、随便打一串字母数字就行）
3. 保存（Deploy）

## 第 5 步：搜索服务的 Key（二选一）

先去任意一家搜索服务注册拿一个 API Key，比如：

| 服务 | 说明 |
| --- | --- |
| Tavily（tavily.com） | 每月有免费额度 |
| 博查（bochaai.com） | 国内服务，中文结果好 |
| Jina（jina.ai） | 注册送免费额度 |
| Exa（exa.ai） | 偏英文内容 |
| Brave Search API | 有免费档，需要绑卡 |
| Serper（serper.dev，Google 结果） | 注册送免费次数 |

然后二选一：

- **放在 Worker 里（推荐）**：同样在「变量和机密」里添加一个**机密**，名字按下面写：
  `TAVILY_KEY` / `BOCHA_KEY` / `JINA_KEY` / `EXA_KEY` / `BRAVE_KEY` / `SERPER_KEY`
- **或者填在栖所里**：「设置 → 工具 → 搜索服务的 Key」

## 第 6 步：填进栖所

1. 在 Worker 页面上找到它的网址，形如 `https://qisuo-relay.你的名字.workers.dev`
2. 打开栖所「设置 → 工具」：
   - **中转地址**：填上面的网址
   - **中转密码**：填第 4 步设的密码
3. 点 **测试连接**，看到「连上了！」就成功了
4. 选好搜索服务，点 **测试搜索** 试一下
5. 打开 **开启联网搜索**

之后聊天时，TA 需要查资料就会自己搜，聊天里会出现「小机 搜索了「……」」，点一下可以看到来源。

---

## 常见问题

**测试连接显示「连不上中转」**
`workers.dev` 的网址在中国大陆经常连不上。可以开 VPN 再试；不想开 VPN 的话，可以给 Worker 绑一个自己的域名（Worker 设置里的「域和路由」）。

**显示「中转密码不对」**
栖所里填的密码要和 Worker 里的 `RELAY_TOKEN` 完全一样。

**测试搜索报错 401 / 403**
搜索服务的 Key 不对，或者额度用完了。

**会花钱吗？**
Cloudflare Worker 免费额度是每天 10 万次请求，正常聊天用不完。搜索服务按各家的免费额度 / 价格算。
