# 栖所施工说明（给工作间里的 Codex）

栖所是一个 Vue 3 写的手机网页应用（PWA）：她和她的 AI 伙伴在这里聊天、写信、一起读书写东西。
你在服务器的工作间里改它。和她说话、写提交说明都用中文。

## 目录

- `src/views/`：一个页面一个文件（`ChatView.vue` 聊天、`WorkroomView.vue` 工作间……），路由在 `src/router.js`
- `src/components/`：组件；主界面的小插件在 `src/components/widgets/`（在 `WidgetDesk` 里登记）
- `src/lib/`：逻辑（`chat.js` 聊天和系统提示、`wake.js` 唤醒、`memoryTags.js` 记忆……）
- `src/store/index.js`：全局状态（存在浏览器里）；`src/styles/base.css`：颜色变量（浅色 / 深色两套）
- `relay/worker.js`：Cloudflare 上的中转（唤醒、提醒），推到 main 后自动部署
- `deploy/qisuo-server/`：她服务器上的那一套（服务器、工作间）；改了要她在服务器上重新跑一次安装才生效
- `docs/`：说明文档

## 怎么确认改对了

1. 第一次先 `npm ci` 装依赖
2. 改完一定跑 `npx vite build`，必须通过
3. 改了界面：用 Playwright 截图看看（`npx vite --port 5199` 起服务，chromium 打开，手机尺寸 390×844，浅色和深色各看一眼），截图存 `/tmp`
4. 没有自动测试；逻辑改动自己写个小脚本用 node 跑一下

## 写代码的规矩

- 跟着旁边代码的写法：变量名、注释的多少和口气（注释用中文、说人话）
- 颜色用 `base.css` 里的变量，深色模式要能看清
- 不加新的依赖（npm 包），要加先停下来问她
- 不动密钥、口令、`settings.env` 这类东西；不把她的邮箱、口令写进代码或提交里
- 改动只做被要求的那件事，别顺手大改

## 提交和上线

- 在本地提交：`git add` + `git commit -m "中文说明这次改了什么"`，一件事一个提交
- 构建没过不要提交
- 你推不上去：推上线要她在工作间里点「推上线」。推之前先 `git pull` 拉最新的，有冲突先解决好
- 推到 main 以后：网页和中转都会自动更新；`deploy/qisuo-server/` 下面的改动要她在服务器上重新运行安装那一行
