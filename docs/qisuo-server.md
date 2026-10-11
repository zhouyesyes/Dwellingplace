# 把栖所放到自己的服务器上

做两件事：

1. **网页从自己的服务器打开**（`https://app.你的域名`），不再从 GitHub Pages 打开，国内打开更稳
2. **API 从服务器转发**：服务器在海外（比如日韩、新加坡、美国），能直接连 OpenRouter，手机不开梯子也能和用 GPT 的 TA 聊天

代码在 `deploy/qisuo-server/`：`server.mjs` 只用 Node 自带的东西，放网页、转发 API；`setup.sh` 用 Docker 装好。

## 安装

在服务器终端粘贴：

```sh
bash <(curl -fsSL https://raw.githubusercontent.com/zhouyesyes/Dwellingplace/main/deploy/qisuo-server/setup.sh)
```

它会问两个问题（端口、网址），然后：

- 下载最新的栖所、构建、启动（`--restart unless-stopped`，服务器重启后会自己起来）
- 生成一个**转发口令**，试一下能不能连上 OpenRouter
- 把新网址加进每一份心潮的 `DASHBOARD_ALLOWED_ORIGINS`，重启心潮（不然新网址连不上心潮）
- 把要做的事写进 `~/qisuo-server/栖所服务器信息.txt`

## 装完以后

1. **Cloudflare 隧道加一条公共主机名**：`app` → `HTTP` → `localhost:18200`（和装心潮时一样的地方）
2. 手机打开 `https://app.你的域名/health`，看到 `"ok":true` 就通了
3. **搬数据**：旧栖所「设置 → 备份 → 导出」，新网址「设置 → 备份 → 导入」
4. **改 API 地址**：「设置 → API」里把 OpenRouter 的接口地址换成信息文件里那个 `https://app.你的域名/p/口令/openrouter/v1`，Key 不用改
5. 新网址重新「添加到主屏幕」，唤醒页重新打开推送通知

## 转发是怎么回事

`/p/<口令>/<去哪>/…` 原样转发到下面几家，流式回复一块块往回送：

| 去哪 | 转到 |
|---|---|
| `openrouter` | `https://openrouter.ai/api` |
| `openai` | `https://api.openai.com` |
| `anthropic` | `https://api.anthropic.com` |
| `deepseek` | `https://api.deepseek.com` |
| `gemini` | `https://generativelanguage.googleapis.com` |

口令不对就拒绝，别的网站也转不了，不会被别人拿去当跳板。Key 只是路过，服务器不存。

## 他的浏览器（`/p/<口令>/chrome/`）

安装时问「要给他装一个浏览器吗」选 y，就会多一个 `qisuo-chrome` 容器：没有屏幕的 Chromium + [chrome-mcp-bridge](https://github.com/AZHi-xinxin/chrome-mcp-bridge)（固定在 2.4.1）。

- 只在 docker 内部网络 `qisuo-net` 里，不开端口；bridge 自己没有口令，只能经过栖所服务器带口令的 `/p/<口令>/chrome/` 转发
- 登录状态存在 `~/qisuo-server/chrome-profile/`；内存上限 1.5G
- 栖所「设置 → 工具 → 浏览器」点「接上浏览器」；「登录小红书」打开登录页，下面是他浏览器的画面：点截图 = 点网页，能填字、按回车（填短信验证码用）。这部分是 `chrome/remote.py`（内部 9225 端口，经 `/p/口令/chromectl/` 转发）
- 工具返回的图片会交给模型看（要支持看图的模型），聊天里点开小记能看到他看了什么
- 不想要了：settings.env 里 `CHROME=n`，再运行一次安装

## 多设备同步（`/p/<口令>/sync`）

手机、iPad、电脑在「设置 → 同步」里填同一个地址 `https://app.你的域名/p/口令/sync`，就共用一份栖所。

- 存在服务器的 `~/qisuo-server/data/sync/` 里：设置（meta）、每个对话的聊天记录、图片、文件各一样，每改一次编一个号
- 栖所打开、切回来、每 20 秒问一次「有什么新的」；这边改了过 1.5 秒交上去
- 两台设备同时改了同一样：后交的被退回（409），取回来合并再交。聊天记录按条合并；设置按字段三方合并
- 第一次连上：服务器空着 → 把这台的交上去；这台是新的 → 取服务器上的；两边都有 → 让你选（合并 / 用服务器的 / 用这台的）
- 「备份 → 导入」会清掉这台设备的同步设置，导入后重新连上，选「用这台的」

## ChatGPT 会员额度（`/p/<口令>/chatgpt/v1`）

用 OpenAI 官方的「Sign in with ChatGPT」把 ChatGPT 会员（Plus 等）的额度接进栖所，不按 token 另外付钱。

1. 「设置 → API」新建一条：接口格式选 OpenAI，地址填 `https://app.你的域名/p/口令/chatgpt/v1`，Key 随便填（比如 `plan`）
2. 点「用 ChatGPT 登录」→ 在打开的页面登录、同意 → 最后跳到一个打不开的 `127.0.0.1` 页面，把地址栏整串地址复制
3. 粘回栖所，点「完成」，再拉取模型、选一个

- 登录信息（通行证）只存在服务器的 `~/qisuo-server/data/` 里（权限 600），不进浏览器、不进备份；快过期自己续
- 额度和 ChatGPT 本身共用：Plus 每 5 小时、每周都有上限。用了多少、给栖所单独设上限：chatgpt.com → 设置 → 用量
- 会员额度不能生图、不能用 OpenAI 的文件搜索 / 代码解释器
- 栖所还是按 `/chat/completions` 发，服务器转成 Responses API（`store:false`）再按原样流回来，所以唤醒、群聊都不用改

## 更新

再运行一次安装那一行：口令、端口、网址都不变，只换成最新的栖所。
