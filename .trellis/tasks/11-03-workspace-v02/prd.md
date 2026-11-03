# Workspace v0.2 — 可编辑工作台（Monaco + LSP）与侧栏会话

> **定位：v1 发布之后的迭代**（首个可安装版本 = 三个 T1/T2/T3 子任务归档后的 `0.1.0`）。
> 本任务只做计划，不写代码；`task.py start` 之前不占用 v1 的收尾工作。

## Goal

把工作台从「只读的浏览/查看器」推进成「能改代码、能就近追问」的地方，分三块交付：

1. **file tab 可编辑**：引入 **Monaco**，但不把它打进 `client.js` —— 由宿主半边把 `monaco-editor` 的 AMD 产物当静态资源发出去，客户端按需用 `<script>` 加载。顺带补上宿主侧第一个文件写入口（原子写 + 版本冲突）。
2. **可选 LSP**：默认关闭。关闭时用 Monaco 自带的 TS/JSON/CSS/HTML worker 就够；打开后由宿主按语言拉起真实 language server，编辑器获得 hover / 定义跳转 / 诊断 / 补全。
3. **会话 tab 的侧栏会话**：对齐 [dsh-sidenote](https://github.com/g-yixuan/dsh-sidenote) 的核心体验 —— 在当前会话旁边开侧聊（继承历史、独立多轮），划选引用，结论带回主对话。

## Background — v1 已确认的事实（来自 T1/T2/T3 的实测，不是猜测）

- **浏览器半边是单文件 CJS**：`tsdown` 以 `inlineDynamicImports: true` 打进 `lib/client.bundle.js`，再由 `scripts/wrap-client.mjs` 包成 `factory(require)`。没有 module graph、没有 `import()`、没有 Worker 运行时 —— 这是 Monaco 不能直接 `import` 的硬约束。
- **整包体积 2.23 MB gzip**，其中 BlockNote + yjs ≈ 1.5 MB，且**开机就下载**（`React.lazy` 只推迟求值）。任何再加进 bundle 的重依赖都要按「首屏字节」计价。
- **宿主没有文件写能力**：`/dsh-workbench/api` 只有 `search` / `notes.*` / `path.reveal`；`remote.workspaceFiles` 只读。笔记的写路径（临时文件 + rename 原子写、etag 409、frontmatter 保留）可以整段复用。
- **会话内嵌已经打通**：`workbench.conversation` 这个 session 作用域 child slot + `ctx.sessions.retain` + `renderFactorySlot('conversation.content', { variant: 'embedded', phase, hero }, { slots: { views } })` 能在 tab 里渲染完整宿主对话（含 composer、审批、模式 chip）。见 `src/panel/ConversationSlot.tsx`。
- **`ctx.layout.panels` 有 `toggleSidebar`**（v1 实测，S10 的旧结论有误）：进入工作台自动收起 dsh 左栏、离开恢复。
- **`ctx.workspaces` 只有 `ctx / list / model / name`**：客户端半边**没有**注册工作区的 API，`Add project` 目前只能明确报错。这是 v0.2 的独立遗留项，不在本任务范围内。
- **路由形态**：`ctx.webServer.register({ kind: 'prefix', path, handler })`，POST + `x-dsh-plugin` 头 + loopback/same-origin 围栏；目前**没有**验证过静态文件、WebSocket upgrade、SSE 三种能力 —— LSP 的传输层必须先用 spike 探明。

## Key Decisions

- **D1 Monaco 走宿主静态路由，不进 bundle**（用户已选方案 2）。产物放包内 `lib/vendor/monaco/`，由 `/dsh-workbench/vendor/monaco/*` 提供服务；客户端只在**第一次进入编辑态**时注入 AMD loader。这样 worker 是真的 Worker（`MonacoEnvironment.getWorkerUrl` 指向同源路由），首屏字节不变。
- **D2 写文件是一次独立能力，先于编辑器**：`file.write` 单独可测（host 测试 + 手工 `curl`），编辑器只是它的一个调用方。冲突语义与笔记一致：etag 不一致 → 409 → 客户端给「重载 / 覆盖」两条路，绝不静默覆盖。
- **D3 LSP 默认关闭、按语言配置、随 tab 生命周期起停**。v1 只支持用户自己在设置里写下的 server 命令（argv 数组，非 shell 字符串），**不自动下载/安装** language server。
- **D4 侧栏会话复用宿主的对话渲染，不重写 chat**：与 v1 的 session tab 同一条路径（session 作用域 slot + `SessionProvider` + `renderFactorySlot`）。dsh-sidenote（MIT）只作**交互参考**，不复制其代码；若最终复用其片段，必须补 `NOTICE.md`。
- **D5 三块互不阻塞**：T1 可独立合入并发布；T2、T3 各自带开关/降级路径，任一未完成都不影响 v0.2 的可用性。

## Task Map

| 子任务 | 范围 | 依赖 |
|---|---|---|
| T1 `11-03-monaco-editor` | 宿主静态路由 + `file.write` + Monaco 懒加载 + 编辑/保存/冲突 UX；bundle 不增重 | 无（定义 vendor 路由与写入口契约） |
| T2 `11-03-monaco-lsp` | LSP 管理器（宿主）+ 传输层 + Monaco 诊断/跳转；设置项 `lsp.*` | 依赖 T1 的编辑态与 Monaco 实例 |
| T3 `11-03-side-conversation` | 会话 tab 右侧侧聊：fork/多标签/引用/回流/持久化 | 依赖 v1 的 conversation child slot；需先探 `ctx.sessions` 的 fork 能力 |

## Requirements（跨子任务）

- **R1 不改宿主**：仍然只是「一个可安装的包」；Monaco / LSP / 侧聊都走插件自己的路由与 slot，不 patch `app.asar`、不动别人 profile 的其他 bundle。
- **R2 首屏不退化**：v0.2 完成后，打开工作台仍只下载现有约 2.2 MB gzip；Monaco 与 LSP 客户端代码只在用到时拉取。用一个可重复的测量脚本（DevTools network → gzip 传输量）记录在 `implement.md` 里。
- **R3 写操作有围栏**：任何落盘路径必须解析后仍在「本次会话的工作区根」内（realpath 比对，拒绝符号链接穿越），与笔记 .trash / etag 同一套错误码风格。
- **R4 生命周期干净**：关闭 tab / 禁用插件 → 编辑器 dispose、worker 终止、LSP 进程结束、会话 retain 释放；不留孤儿进程与订阅。
- **R5 文案走 locale**：新增 UI 文案一律进 `src/locale.ts`（zh/en），宿主侧不出现用户可见的自然语言。
- **R6 可降级**：Monaco 资源 404 / CSP 拦截 / LSP 二进制缺失 / fork API 不可用 —— 每一种都退回到 v1 的可用形态（只读高亮视图 / 无 LSP 的编辑器 / 无侧聊的会话 tab），并在 UI 说清原因。

## Acceptance Criteria（父任务只验集成）

- [ ] v1 的 39 条测试仍全绿，`pnpm check` 通过；`lib/client.js` 体积增幅 ≤ 50 KB gzip。
- [ ] 首次打开工作台（未进编辑态）时，Network 面板里**没有** `vendor/monaco/*` 请求。
- [ ] 打开一个 `.ts` 文件 → 点编辑 → 有补全与语法高亮（Monaco 自带 worker）→ 改一行 → `⌘S` → `git diff` 能看到改动。
- [ ] 关闭 LSP 开关（默认）时，宿主没有任何 language server 子进程；打开并配置后，同一文件出现真实诊断。
- [ ] 会话 tab 里开一个侧聊，主对话与侧聊可同时多轮、互不串流；刷新页面后侧聊列表仍在。
- [ ] 禁用插件后：无残留子进程、宿主正常启动、`git status` 干净（vendor 产物已入库/已 gitignore 二选一并写明）。

## Out of Scope

- 自动安装/升级 language server、LSP 市场、远程/容器内语言服务。
- 多人协作、代码评审评论、diff 编辑、多文件重构、LSP code action 的批量应用。
- `Add project`（宿主缺 `workspaces.add`，另开任务）。
- 侧聊的注释持久化到笔记库（v0.3 可考虑）。

## Risks / Spikes

- **S1 静态资源路由**：`kind: 'prefix'` 的 handler 能否稳定服务 `.js/.css/.ttf/.json` 这类资源（Content-Type、缓存、路径围栏、ByteRange）？失败退路：把 Monaco 打成 base64 内联进一个 vendor JS（体积换可行性）。
- **S2 Worker 可用性**：同源路由返回的 worker 脚本能否 `new Worker(url)`（CSP / `worker-src` / 跨路径 importScripts）？失败退路：`MonacoEnvironment.getWorker` 退化为 `editor.worker` 的 `importScripts` 空实现（失去 TS 语义，保住高亮与编辑）。
- **S3 LSP 传输**：宿主 webServer 是否支持 WebSocket upgrade 或 SSE？都不行则用 150ms 长轮询（记录延迟上限）。
- **S4 会话 fork**：`ctx.sessions` 是否暴露「以父会话为上下文新建会话」？没有则侧聊退化为「新建会话 + 主线摘要预填」，并在 PRD 里标注体验差异。
- **S5 输入框注入**：能否把「引用对」放进主 composer 而不接管它（`conversation.input` slot 是否可写）？不行则回流退化为「复制到剪贴板 + 提示」。

## 发布切分

1. **v0.2.0** = T1（可编辑）。
2. **v0.2.1** = T2（LSP，开关默认关）。
3. **v0.3.0** = T3（侧栏会话）—— 取决于 S4/S5 的探测结果，必要时先发「独立会话侧聊」版本。
