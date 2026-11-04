# Workspace v0.2 — 可编辑工作台（Monaco + LSP）与侧栏会话

> **定位：v1 发布之后的迭代**（首个可安装版本 = 三个 T1/T2/T3 子任务归档后的 `0.1.0`）。
> 本任务只做计划，不写代码；`task.py start` 之前不占用 v1 的收尾工作。

## Goal

把工作台从「只读的浏览/查看器」推进成「能改代码、能就近追问」的地方，分三块交付：

1. **file tab 可编辑**：引入 **Monaco**，但不把它打进 `client.js` —— 由宿主半边把 `monaco-editor` 的 AMD 产物当静态资源发出去，客户端按需用 `<script>` 加载。顺带补上宿主侧第一个文件写入口（原子写 + 版本冲突）。
2. **可选 LSP**：默认关闭。关闭时用 Monaco 自带的 TS/JSON/CSS/HTML worker 就够；打开后由宿主按语言拉起真实 language server，编辑器获得 hover / 定义跳转 / 诊断 / 补全。
3. **会话 tab 的侧栏会话**：对齐 [dsh-sidenote](https://github.com/g-yixuan/dsh-sidenote) 的核心体验 —— 在当前会话旁边开侧聊（继承历史、独立多轮），划选引用，结论带回主对话。
4. **启动恢复**：应用重启后回到上次离开的工作台 —— 项目、全部 tab、活动 tab、侧栏状态一个不少；布局不再绑在 `localStorage` 的 origin 上。
5. **Git tab 自有化**：以当前 fork 的 `dsh-ide-git` v0.21.1 代码为基线，**不再同步上游**；把它的视觉收进工作台的设计 token（密度、颜色、字体、明暗），必要时用本插件技术栈（TSX + Tailwind + shadcn + shiki）逐块重构。

## Background — v1 已确认的事实（来自 T1/T2/T3 的实测，不是猜测）

- **浏览器半边是单文件 CJS**：`tsdown` 以 `inlineDynamicImports: true` 打进 `lib/client.bundle.js`，再由 `scripts/wrap-client.mjs` 包成 `factory(require)`。没有 module graph、没有 `import()`、没有 Worker 运行时 —— 这是 Monaco 不能直接 `import` 的硬约束。
- **整包体积 2.23 MB gzip**，其中 BlockNote + yjs ≈ 1.5 MB，且**开机就下载**（`React.lazy` 只推迟求值）。任何再加进 bundle 的重依赖都要按「首屏字节」计价。
- **宿主没有文件写能力**：`/dsh-workbench/api` 只有 `search` / `notes.*` / `path.reveal`；`remote.workspaceFiles` 只读。笔记的写路径（临时文件 + rename 原子写、etag 409、frontmatter 保留）可以整段复用。
- **会话内嵌已经打通**：`workbench.conversation` 这个 session 作用域 child slot + `ctx.sessions.retain` + `renderFactorySlot('conversation.content', { variant: 'embedded', phase, hero }, { slots: { views } })` 能在 tab 里渲染完整宿主对话（含 composer、审批、模式 chip）。见 `src/panel/ConversationSlot.tsx`。
- **`ctx.layout.panels` 有 `toggleSidebar`**（v1 实测，S10 的旧结论有误）：进入工作台自动收起 dsh 左栏、离开恢复。
- **`ctx.workspaces` 只有 `ctx / list / model / name`**：客户端半边**没有**注册工作区的 API，`Add project` 目前只能明确报错。这是 v0.2 的独立遗留项，不在本任务范围内。
- **路由形态**：`ctx.webServer.register({ kind: 'prefix', path, handler })`，POST + `x-dsh-plugin` 头 + loopback/same-origin 围栏；目前**没有**验证过静态文件、WebSocket upgrade、SSE 三种能力 —— LSP 的传输层必须先用 spike 探明。
- **Git 面板不可被“加载”**：上游 client bundle 只 `return { name, inject, apply }`，`Panel`/`LocaleLive` 在 factory 闭包里，没有服务出口（v0.21.1 与 v0.23.0 均已核实）；插件之间也没有跨 bundle 的 `require`。所以复用它的 UI 只有两条路：自己持有一份代码（现状），或上游开服务门（未发生）。既然决定不再跟版，这份 fork 就是我们的基线。
- **Git 面板的样式是“另一个产品的”**：16.5k 行预编译 JS，自带 `dig-` 前缀 CSS 与上游密度，颜色混用上游变量与 `--dsw-alias-*`，没有 `--workbench-*` token。抽出来的成本与收益见 T6。

## Key Decisions

- **D1 Monaco 走宿主静态路由，不进 bundle**（用户已选方案 2）。产物放包内 `lib/vendor/monaco/`，由 `/dsh-workbench/vendor/monaco/*` 提供服务；客户端只在**第一次进入编辑态**时注入 AMD loader。这样 worker 是真的 Worker（`MonacoEnvironment.getWorkerUrl` 指向同源路由），首屏字节不变。
- **D2 写文件是一次独立能力，先于编辑器**：`file.write` 单独可测（host 测试 + 手工 `curl`），编辑器只是它的一个调用方。冲突语义与笔记一致：etag 不一致 → 409 → 客户端给「重载 / 覆盖」两条路，绝不静默覆盖。
- **D3 LSP 默认关闭、按语言配置、随 tab 生命周期起停**。v1 只支持用户自己在设置里写下的 server 命令（argv 数组，非 shell 字符串），**不自动下载/安装** language server。
- **D4 侧栏会话复用宿主的对话渲染，不重写 chat**：与 v1 的 session tab 同一条路径（session 作用域 slot + `SessionProvider` + `renderFactorySlot`）。dsh-sidenote（MIT）只作**交互参考**，不复制其代码；若最终复用其片段，必须补 `NOTICE.md`。
- **D5 三块互不阻塞**：T1 可独立合入并发布；T2、T3 各自带开关/降级路径，任一未完成都不影响 v0.2 的可用性。
- **D6 Git tab 自有化，先样式后结构**（用户 2026-11-03 决策）：git tab 当下保持现状不动；此后以当前 fork 代码为唯一基线，**停止同步上游**（`UPSTREAM.md` 由同步手册改为来源与变更记录）。视觉上必须对齐工作台 token 与设计稿 P3/D3；样式层解决不了的部分，用本插件技术栈逐块重构，不做大爆炸重写。数据层（宿主路由/队列/守卫）不动。

## Task Map

| 子任务 | 范围 | 依赖 |
|---|---|---|
| T1 `11-03-monaco-editor` | 宿主静态路由 + `file.write` + Monaco 懒加载 + 编辑/保存/冲突 UX；bundle 不增重 | 无（定义 vendor 路由与写入口契约） |
| T2 `11-03-monaco-lsp` | LSP 管理器（宿主）+ 传输层 + Monaco 诊断/跳转；设置项 `lsp.*` | 依赖 T1 的编辑态与 Monaco 实例 |
| T3 `11-03-side-conversation` | 会话 tab 右侧侧聊：fork/多标签/引用/回流/持久化 | 依赖 v1 的 conversation child slot；需先探 `ctx.sessions` 的 fork 能力 |
| T4 `11-03-session-restore` | 启动恢复全部 tab：宿主侧布局文件 + 分类型恢复策略 + 开关 | 无（只依赖一次宿主读写；可最先发版） |
| T5 `11-03-tab-actions` | tab 条交互：重命名（`titleOverride` 持久化）+ 右键菜单（关闭左/右/其他/全部、复制路径）+ 拖拽落点与键盘 | 无（纯客户端，可先合） |
| T6 `11-03-git-tab-native` | 冻结 fork 为自有基线；面板样式对齐 token（密度/颜色/字体/明暗/滚动条）；按收益排序抽取提交框、变更分组、动作条为 TSX；行为零回归 | 无（只改渲染层，不动宿主半与其它 tab） |

## Requirements（跨子任务）

- **R1 不改宿主**：仍然只是「一个可安装的包」；Monaco / LSP / 侧聊都走插件自己的路由与 slot，不 patch `app.asar`、不动别人 profile 的其他 bundle。
- **R2 首屏不退化**：v0.2 完成后，打开工作台仍只下载现有约 2.2 MB gzip；Monaco 与 LSP 客户端代码只在用到时拉取。用一个可重复的测量脚本（DevTools network → gzip 传输量）记录在 `implement.md` 里。
- **R3 写操作有围栏**：任何落盘路径必须解析后仍在「本次会话的工作区根」内（realpath 比对，拒绝符号链接穿越），与笔记 .trash / etag 同一套错误码风格。
- **R4 生命周期干净**：关闭 tab / 禁用插件 → 编辑器 dispose、worker 终止、LSP 进程结束、会话 retain 释放；不留孤儿进程与订阅。
- **R5 文案走 locale**：新增 UI 文案一律进 `src/locale.ts`（zh/en），宿主侧不出现用户可见的自然语言。
- **R6 可降级**：Monaco 资源 404 / CSP 拦截 / LSP 二进制缺失 / fork API 不可用 —— 每一种都退回到 v1 的可用形态（只读高亮视图 / 无 LSP 的编辑器 / 无侧聊的会话 tab），并在 UI 说清原因。
- **R7 Git tab 只有一套视觉**：面板内不出现上游主色与字号；明暗随宿主；diff/图谱的语义色集中在 `src/git/theme.ts`；与 Explorer、搜索、笔记列表使用同一把密度尺子（22–26px 行、6px 圆角、6px 滚动条）。

## Acceptance Criteria（父任务只验集成）

- [ ] v1 的 39 条测试仍全绿，`pnpm check` 通过；`lib/client.js` 体积增幅 ≤ 50 KB gzip。
- [ ] 首次打开工作台（未进编辑态）时，Network 面板里**没有** `vendor/monaco/*` 请求。
- [ ] 打开一个 `.ts` 文件 → 点编辑 → 有补全与语法高亮（Monaco 自带 worker）→ 改一行 → `⌘S` → `git diff` 能看到改动。
- [ ] 关闭 LSP 开关（默认）时，宿主没有任何 language server 子进程；打开并配置后，同一文件出现真实诊断。
- [ ] 会话 tab 里开一个侧聊，主对话与侧聊可同时多轮、互不串流；刷新页面后侧聊列表仍在。
- [ ] 禁用插件后：无残留子进程、宿主正常启动、`git status` 干净（vendor 产物已入库/已 gitignore 二选一并写明）。
- [ ] Git tab 与 `designs/exports/u53yI9.png` 同屏对比：布局误差 ≤ 4px，颜色全部来自 token 表（`theme.ts` 例外）；浅/深两套都成立；T2 的功能清单一条不少。

## Out of Scope

- 自动安装/升级 language server、LSP 市场、远程/容器内语言服务。
- 多人协作、代码评审评论、diff 编辑、多文件重构、LSP code action 的批量应用。
- `Add project`（宿主缺 `workspaces.add`，另开任务）。
- 继续同步 `dsh-ide-git` 上游版本（D6 已冻结；未来若要某个上游修复，按「读 diff → 手工移植 → 记一条变更」处理）。
- 交互式 rebase / 三方冲突编辑器 / blame / 多仓库并行（沿用 v1 边界）。
- 侧聊的注释持久化到笔记库（v0.3 可考虑）。

## Risks / Spikes

- **S1 静态资源路由**：`kind: 'prefix'` 的 handler 能否稳定服务 `.js/.css/.ttf/.json` 这类资源（Content-Type、缓存、路径围栏、ByteRange）？失败退路：把 Monaco 打成 base64 内联进一个 vendor JS（体积换可行性）。
- **S2 Worker 可用性**：同源路由返回的 worker 脚本能否 `new Worker(url)`（CSP / `worker-src` / 跨路径 importScripts）？失败退路：`MonacoEnvironment.getWorker` 退化为 `editor.worker` 的 `importScripts` 空实现（失去 TS 语义，保住高亮与编辑）。
- **S3 LSP 传输**：宿主 webServer 是否支持 WebSocket upgrade 或 SSE？都不行则用 150ms 长轮询（记录延迟上限）。
- **S4 会话 fork**：`ctx.sessions` 是否暴露「以父会话为上下文新建会话」？没有则侧聊退化为「新建会话 + 主线摘要预填」，并在 PRD 里标注体验差异。
- **S5 输入框注入**：能否把「引用对」放进主 composer 而不接管它（`conversation.input` slot 是否可写）？不行则回流退化为「复制到剪贴板 + 提示」。
- **S6 Git 面板样式覆盖率**：上游 `dig-` 样式与内联样式的混排，能否只靠一层 CSS 覆盖就对齐？先做 T6a 探明；覆盖不到三成再进入抽取。

## 发布切分

1. **v0.2.0** = T4（启动恢复）+ T1（可编辑）+ T5（tab 条交互）—— 三块互不依赖，T5 → T4 → T1 是推荐合入顺序（先补手感，再补恢复，最后上编辑器）。
2. **v0.2.1** = T2（LSP，开关默认关）。
3. **v0.3.0** = T3（侧栏会话）—— 取决于 S4/S5 的探测结果，必要时先发「独立会话侧聊」版本。
4. **v0.3.x / v0.4.0** = T6 分三步：T6a 样式对齐（patch 版本）→ T6b 抽取提交框/变更分组/动作条 → T6c 视情况抽 diff 与分支树。T6 与 T1–T5 互不阻塞，可以并行。

## 2026-11-05 实机验证（spike profile，127.0.0.1:58999）

T5 / T4 / T1 / T3 全部在真机面板上走了一遍（Chrome DevTools MCP，页面 http://127.0.0.1:58999）。

- **通过**：项目列表与 tab 计数；`+` 菜单（含历史会话列表）；资源管理器左右分栏 + 内部 tab + 排序 + 跳顶/底；file tab 编辑（`⌘S` 原子写、外部改动后出现冲突条并可「重新载入 / 用我的版本覆盖」）；tab 右键菜单（重命名 / 关闭范围 / 复制路径 / 重开）；行内重命名后 breadcrumb 与内部文件名同步；拆分视图（左右实测，两栏各带 strip）；`⌥⌘←` 移动 tab；布局连同 `titleOverride` 跨刷新保留（宿主 `layout.json`）；新建会话 tab 打开空白会话且 composer 可用；会话标题随 `session/title` 事件回填（标签变成 `hi`）。
- **修掉的真 bug**：
  1. `tabs.splitRow / splitCol / movePane / unsplit` 四个键在 `src/locale.ts` 里不存在 → `⋯` 菜单原样显示键名。已补齐 zh/en，并新增 `test/locale.test.mjs`（源码里每个 `t('ns.key')` 必须在字典里 + 两本字典键集相等），把这类静默失败变成红灯。
  2. `+` 菜单历史会话标签显示 `会话 · session-`（`slice(0, 8)` 全落在 `session-` 前缀上）→ 先剥前缀再截断。
  3. 侧聊 dock 写死 `w-[380px]`，在已拆分的半栏里把主会话挤成窄条（占位文字换行成三行）→ 改为 `w-2/5 min-w-[220px] max-w-[380px]`。
- **缺口（不阻塞发布，已记录）**：分叉侧聊需要目标会话至少有一轮完整对话，spike profile 没有 API key 造不出完成轮次，因此 fork 只验证到「宿主拒绝 + 界面给出可见提示」；上一轮失败提示已从静默吞掉改成 dock 内一行说明（并且 `client.tsx` 的 catch 会 `console.warn` 真实原因）。
