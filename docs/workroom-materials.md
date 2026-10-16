# 把原始素材交给 Codex

这套改动在本地实现；未部署、未重启生产服务。以后由她推上线并更新服务器安装后，新的 bridge 和网页一起使用。不添加依赖，不修改旧附件，不迁移或删除旧数据。

## 两种用法

**任务附件**：工作间选项目，在任务列表下「新任务的原始附件」选文件，为每个文件填用途，然后点「新任务」命名。创建后原件已保存，点底部发送开始任务，或在「任务原始附件」点「通知 Codex / 重试」。也可以打开已有任务，在附件区填用途，点「上传并通知 Codex」。运行中上传会用 `turn/steer` 插入当前轮；空闲时开始新一轮。原有底部 ＋ 仍支持一条消息最多四个附件和各自用途。和他一起工作时，附件交给他商量；他派单时将同一组附件 ID 传给 Codex，未派单的文件保持待通知，可直接点通知按钮。

上传成功和通知成功分别记录。只有 app-server 接受 `turn/start` 或 `turn/steer` 后才标记「已通知 Codex」、写入用户消息事件。失败保留原件并显示待通知，可重试，不必重传；上传后刷新页面仍可找回。已通知只代表 Codex 接收了输入，不表示它已执行加工。

**项目素材收件箱**：工作间选「栖所」→「项目素材收件箱」→填用途、上传原件。点「复制路径」，把路径放入同项目的派单文字，Codex 在项目目录可直接读取；派单被接收后自动标记「已用于任务」。或在收件箱选择同项目任务，点「附加并通知任务」，任务运行中也适用。任务详情点「从项目素材选择」可直接挑素材。

任务附件可点「保存到项目收件箱」。素材可重命名显示名称（必须保留扩展名，原始名称/文件路径不变），点「保存到素材库」变成已归档。保存/归档建立硬链接，原路径保留；任务附件引用同一原件，不复制文件字节。不同上传即使同名也使用不同 UUID 目录；重复保存同一个附件会复用登记记录。

缩略图仅用 CSS 缩放，点图预览；「预览」在受保护窗口打开；「下载原件」强制下载。图片、文本等均原样落盘，不经聊天截图或有损转码。任务列表、附件区可以刷新状态。

## 数据位置和生命周期

沿用安装已创建的 root 所有目录 `/work/.qisuo-attachments`，按任务、项目分别隔离。素材按项目命名空间管理在源码目录之外，避免误入 Git、构建或部署。以默认 WORK_DIR 为例：

| 内容 | 位置 |
| --- | --- |
| 新任务原件 | `/work/.qisuo-attachments/tasks/<任务ID>/<文件UUID>/<原名>` |
| 收件箱 | `/work/.qisuo-attachments/projects/栖所/inbox/<UUID>/<原名>` |
| 正式素材库 | `/work/.qisuo-attachments/projects/栖所/library/<UUID>/<原名>` |
| 收件箱直接上传的来源原件 | `/work/.qisuo-attachments/tasks/materials-栖所/<UUID>/<原名>` |
| 任务附件元数据、通知状态 | `/bridge/attachments/<任务ID>/<UUID>.json` |
| 项目素材状态与来源关联 | `/bridge/materials/栖所/<UUID>.json` |

实际根目录由既有 `WORK_DIR`、`BRIDGE_DATA` 决定。UI 复制素材的 `projectPath`（归档后 `libraryProjectPath`），例如 `../.qisuo-attachments/projects/栖所/inbox/<UUID>/原图.png`，相对于 `/work/栖所`。API 也提供原件绝对 `path`，供工具直接读取；浏览器请求只使用文件 ID，不接受客户端提供的磁盘路径。重命名只改变显示名，永久路径中的原始名不变。

元数据包括 id/name/originalName/type/size/purpose/createdAt/path/projectPath、sourceTask/originalPath/tasks/usedTasks；状态为 pending（待整理）、used（已用于任务）、archived（已归档）。tasks 记录来源及所有挂接任务（包括通知失败的待通知引用），usedTasks 仅记录新协议下派单被接受的任务；既有数据不会凭空补猜历史使用情况。实际使用不表示 Codex 已读完或已生成产物。任务附件的 notificationRevision 防止旧通知返回覆盖新用途/待通知状态。

**默认永久保留**：任务完成、中断、归档和素材归档都不会删除原件；移除待发送列表只移除本次选择，不删除服务器已上传文件。收件箱支持单项/多选删除：POST `…/:id/delete` 只设置该项目素材的 `deletedAt`，列表过滤它；原件、正式库链接和历史任务附件都保留，不释放磁盘空间。删除前界面确认，批量逐项处理并显示失败项，失败不会回滚成功项。重复删除安全；删除后拒绝重命名/归档/挂接，从已有任务主动再次保存到收件箱可恢复入口。没有定时清理；失败中断留下的原件也保留。未来清理必须由她明确发起并先备份。目前没有清理实现，也没有验证过可直接照做的自动清理流程。不得只看 status、tasks 或 usedTasks 就删除文件：必须扫描全部任务附件元数据、项目素材元数据和路径派单记录，核对 path/originalPath/libraryPath 及相对路径，涵盖未通知、失败、中断、已归档的任务。任何仍被登记的路径都不得 unlink；只剩另一硬链接并不能让被删除的旧路径继续可读。若未来要解除引用，必须先安全更新全部引用、确认旧路径不再被使用，再移除对应链接；全部链接被移除后才释放磁盘空间。当前只有单文件限制，没有总配额/到期自动清理，需按服务器磁盘容量管理。

## 限额与安全

- 每文件非空且最多 **20 MiB（20 × 1024² 字节）**；原有消息最多四附件，收件箱一次上传一个。用途最多 2000 字符，名称最多 120 字符。
- 仅 PNG/JPEG/GIF/WebP、MP4/WebM、PDF/TXT/MD/CSV/JSON/ZIP；扩展名与 MIME 匹配，二进制检查文件头，文本拒绝 NUL，JSON 必须可解析。不支持 HTML/SVG/脚本/可执行文件，不解压、不自动运行上传内容。
- 上传名称规范化并清理分隔符/控制字符/前导点；重命名严格拒绝路径和改扩展名。UUID 隔离、wx 排他创建、硬链接不覆盖已有文件。
- 目录/文件归 root、目录 0755、文件 0644，Codex 只读；读取、写入、硬链接固定 Linux 目录描述符，O_NOFOLLOW 拒绝符号链接与越界，并检查所有权/写权限。此处为 API 归属与受控目录安全，不是操作系统级任务/项目保密隔离：所有 Codex 任务共用 UID 1001，0644 文件可由该用户直接读取其他任务/项目的已知素材路径。若要求互相不可读，需另行设计独立 UID/容器或按任务挂载，当前未实现。旧附件原路径继续支持。
- 沿用服务器及 bridge 鉴权，检查任务/项目归属；受保护查看带 nosniff、no-store、CSP sandbox，下载加 Content-Disposition。无公开素材服务、临时签名链接或新增凭据日志。

## 给后续贴纸系统的接口

以下均经过既有鉴权前缀 `/codex`；项目名 URL 编码。优先用素材 ID 和下列接口，别扫描源码或依赖某次缩略图 URL。

| 方法/路径 | 用途 |
| --- | --- |
| GET `/projects/:project/materials` | 查询素材元数据、状态、稳定原件路径及任务关联 |
| POST 同一路径 `?name=...&purpose=...` | 原始二进制上传，Content-Type 为文件 MIME |
| GET `/projects/:project/materials/:id` | 受保护预览；加 `?download=1` 下载原件 |
| POST `…/:id/delete` `{}` | 从当前项目收件箱移除，保留原件和历史引用 |
| POST `…/:id/rename` `{name}` | 改显示名 |
| POST `…/:id/archive` `{}` | 保存到正式库，保留原件与旧路径 |
| POST `…/:id/attach` `{taskId,purpose}` | 挂接同项目任务，不复制字节；返回附件元数据，状态待通知 |
| GET `/threads/:task/attachments` | 包括未通知原件在内的持久附件列表 |
| POST 同一路径 `?name=...&purpose=...` | 原始二进制上传 |
| GET `/threads/:task/attachments/:id` | 查看；加 `?download=1` 下载 |
| POST `…/:id/material` `{}` | 保存附件到项目收件箱 |
| POST `/threads/:task/send` `{text,attachments:[id]}` | 正式通知 Codex；运行时 steer，空闲时 start |

贴纸加工读 `path` / `libraryPath`，结果写新文件，不改只读原件。保留素材 ID 和输入任务 ID，可追溯来源。Web 贴纸读取字节走受保护 GET；不要把服务器磁盘路径当成浏览器图片 URL。`attach` 和 `send` 为分步接口，调用者必须检查 send 成功并显示失败重试，不能把仅挂接误报为通知完成。

## 本地验收边界

`node scripts/workroom-attachments-check.mjs` 使用无敏感 PNG 跑真实服务端处理函数和临时文件，断言原字节、用途/路径/localImage、运行中 steer 参数、通知失败恢复、同名隔离、硬链接、归档后旧路径、项目归属、预览下载、符号链接拒绝；仅 Codex RPC 被模拟，不启动第二个 Codex 或生产 bridge。

`node scripts/workroom-progress-check.mjs` 覆盖他派单时原附件 ID/用途透传与原进度；原界面、截图产物收取测试也回归。项目没有独立类型检查配置，运行 Vite 构建及 Node 语法检查。

```sh
node scripts/ui-preview.cjs --task 01a143b9-f117-7043-a6cb-e59c578bb7f1 --route /work --fixture workroom-materials
node scripts/ui-preview.cjs --task 01a143b9-f117-7043-a6cb-e59c578bb7f1 --route /work --fixture workroom-attachments
```

fixture 只使用脚本内虚构任务和绘制的测试 PNG；在空白浏览器内拦截本地 mock API，不读取生产配置。两次各六张手机/平板/桌面浅深色图，沿用任务清单自动回传。手机浅色还验收真实文件选择上传、预览、附加通知、重命名、归档及横向溢出；截图前保留初始状态，交互断言在截图后执行。真实生产 app-server 的通知与跨重启恢复需她以后更新服务后验收，本轮未部署。

## 修改文件

- `deploy/qisuo-server/codex/bridge.mjs`：共用原件上传/受保护读取、任务隔离与通知确认、项目收件箱/归档/来源引用 API。
- `src/components/WorkroomMaterials.vue`、`src/views/WorkroomView.vue`：收件箱和任务附件区、新建任务附件与用途、原图预览下载、挂接/重试。
- `src/lib/workroom.js`、`src/lib/workTogether.js`：前端 API、用途与原附件 ID 透传。
- `scripts/workroom-attachments-check.mjs`、`scripts/workroom-progress-check.mjs`：文件双通道、运行通知、安全及伙伴派单专项。
- `scripts/preview-artifacts-check.mjs`、`scripts/workroom-ui-check.cjs`：适配描述符所有权 fixture 和新增文件输入框，保留原回归断言。
- `scripts/ui-preview.cjs`、`scripts/fixtures/workroom-materials.cjs`：隔离界面 fixture、交互验收与截图回传。
- `docs/workroom-materials.md`、`docs/ui-preview.md`、`docs/worklog.md`：存储/接口/用法/验收边界与施工记录。

最终验收的逐项功能/安全/六条验收矩阵、复现缺陷和本地/替身/线上边界见 [workroom-materials-acceptance.md](workroom-materials-acceptance.md)。
