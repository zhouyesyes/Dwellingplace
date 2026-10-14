# 工作间（Codex）

他可以叫 Codex 在你服务器上一个单独的沙盒里写代码、跑命令。这一篇说服务器这边是怎么搭的。栖所里的工作间界面还在做。

## 怎么装

再运行一次栖所服务器的安装那一行，问到「要装工作间吗」时回答 `y`：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/zhouyesyes/Dwellingplace/main/deploy/qisuo-server/setup.sh)
```

实测时（`codex-lab`）已经登录过的，会把登录直接搬过来，不用再输一次码。

## 结构

```
栖所网页 ──/p/<口令>/codex/…──▶ 栖所服务器（qisuo-server）
                                  │  带着钥匙，走内部网络 codex-int
                                  ▼
                        工作间（qisuo-codex）
                          连接程序 bridge.mjs（root，去掉全部特权）
                            └─ codex app-server（codex 用户）
                                 └─ 它跑的命令（codex 用户）
                                  │  出门只能经过门卫
                                  ▼
                        门卫（qisuo-codex-gate）── 只放行 HTTPS 去 OpenAI ──▶ 外网
```

## 隔离

- **网络**：`codex-int` 是内部网络，工作间自己出不了网。门卫只放行 `openai.com`、`chatgpt.com` 这几个；别的都拦下，记在 `~/qisuo-server/codex-gate/denied.log`。要多放行，在 `settings.env` 里加 `GATE_ALLOW=registry.npmjs.org`（逗号隔开），再运行一次安装。
- **文件**：根目录只读。能写的只有项目文件夹（`~/qisuo-server/codex-work` → `/work`）、Codex 自己的登录目录和临时目录。容器里没有栖所的数据、口令和各种 Key。
- **身份**：Codex 和它跑的命令都是普通用户（1001），读不到连接程序的钥匙和记录（`/bridge`）。连接程序是 root，但去掉了全部特权，只留降成普通用户要用的两个。
- **资源**：最多 2G 内存、2 个 CPU、512 个进程。
- **审批**：项目里的只读命令（看文件、搜索、git status/diff）和跑测试直接放行；改项目里的文件直接放行（diff 都看得见）；删东西、装东西、联网、碰项目外面的，都要你点允许。规则可以在工作间里改。

为什么不用 Codex 自己的沙盒：Ubuntu 24.04 默认的安全设置（`apparmor_restrict_unprivileged_userns=1`）不让它在容器里再开一层隔离。实测后选了「容器当沙盒 + 门卫」，没有放松整台服务器的设置。

已知的限制：命令和 Codex 是同一个用户，所以命令读得到 Codex 的登录文件；有门卫在，它只能连 OpenAI，带不出去。

## 浏览器

工作间里装了一个没有界面的浏览器（Playwright + Chromium，带中文字体），和 cc 检查界面用的一样。Codex 改了网页可以自己起本地服务、按手机尺寸截图、看图检查。它是干净的，没有任何账号；他聊天时用的那个浏览器（qisuo-chrome，存着你帮他登录的网站）和工作间不通。

## 连接程序的接口

都在 `/p/<口令>/codex/` 下面，见 `deploy/qisuo-server/codex/bridge.mjs` 开头的说明：状态和额度、设备码登录、项目、线程、说话或插话、中断、审批、实时过程（SSE，断线后带着编号重连，从断点补回）。
