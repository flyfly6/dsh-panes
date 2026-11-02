# Workspace Workbench Plugin

## Goal

交付一个可安装的 dsh 插件，把 DeepSeek Harness 客户端变成一个多 tab 的工作台：在一个全屏、tab 化的 Workspace 面板里浏览与检索项目代码（多语言语法高亮、Markdown 渲染预览），把文件 / 终端 / 会话 / 浏览器 / Git / 笔记统一组织成可切换、可持久化的 tab；并提供 Git 基本操作与提交图、以及全局的 Notion 风格 Markdown 笔记。

用户价值：把编码过程中「看代码、搜代码、跑命令、查页面、提交、记笔记」这些动作从多窗口来回切换收敛到同一处，并用 tab 保存工作现场，刷新或换会话后能恢复。

## Background — 已确认事实

取证材料在 `research/dsh-asar/`（从本机 `resources/app.asar` 中 dsh `0.2.1-rc.3` 提取的官方包 README / package.json / client bundle 片段），结论：

- **插件 = cordis 包的宿主半边 + 浏览器半边**。宿主半边 `lib/index.js`；浏览器半边 `lib/client.js` 由 `package.json` 的 `dsh.client`（`platform: web`、`inject`、可选 `external`）声明，经 `dsh-client-modules` 组进 boot graph 并用 `window.__ModuleLoader__.load({ id, factory })` 注册；`dsh.bundle.patch` 指向 `cordis.patch.yml` 的 `- insert:` 行，`dsh plugin --profile <p> add <spec>` 即可安装（支持本地绝对路径）。
- **可以注册全屏主面板**：`ctx.slots.inject('main', function* () { yield ctx.slots.register({ name: 'main', key, label, locale, store, children }, Component) })`，`ctx.layout.selectPanel(key)` 切换，`selectPanel(null)` 回会话；注册的 `main` 面板会自动出现在左侧栏的面板列表里（每行图标来自 `sidebar.panellist` slot）。官方 Plugins 页就是这样挂的。
- **宿主已提供数据能力**：`remote.workspaceFiles` 的 `read`（按行分页、带 version/eof）、`readBytes`、`stat`、`list`（仅目录直接子项）、`changes`（文件/目录 watch 流）；`/api/file` 取绝对路径文件；`dsh-api-terminal-controller` 管用户终端；`dsh-client-ui-sidebar-browser` 已实现 iframe/webview 两类浏览器承载；`dsh-subprocess` 可起子进程；`dsh-storage-json`/`dsh-storage-domain` 可持久化；宿主插件可注册 HTTP 路由（官方与第三方实例都用 `/dsh-<name>/api` + `x-dsh-plugin` 头做 CSRF 门）。
- **已内置但形态受限的能力**：右侧栏本身是带 tab 的 dock，已有 Files / Document Preview（Markdown、代码、图片、PDF、Office、HTML）/ Terminal / Browser 四种 tab 类型；这些 tab 绑定在 `sidebarRightTabs` 与 per-session dock 上，宽 264–420px，**不是**可自由组织的整屏工作台，也**不能**把会话放进去。
- **完全缺失**：Git 任何界面（status/diff/graph/stage/commit）、笔记、以及客户端侧的代码内容检索（`workspaceFiles` 只有目录直接子项 `list`，没有递归搜索；内容搜索只有 Agent 侧工具）。
- **客户端栈**：React 18 + zustand + shiki（语法高亮已在依赖内）+ @xterm；主题走 `--dsw-alias-*` token 与 `--dsh-*` 变量；插件通过注入 `<style data-plugin-css>` 带主题变量。
- **交付环境**：用户实际使用的是 Desktop 客户端（profile `desktop`，GUI 在 `http://127.0.0.1:57438`）；npm CLI 不允许管理 desktop profile，需用 Desktop 自带的 command runtime 或客户端插件页安装。

## Key Decisions

- **D1 工作台落点**：新增一个全屏 Workspace 主面板（`main` keyed slot + `ctx.layout.selectPanel`），面板自带 tab 条与内容区。右侧栏 dock 保持原样、不改造。
- **D2 交付分期**：分三个子任务交付，各自独立验收 —— T1 面板骨架 + 代码查看/检索 + Markdown 预览；T2 Git 客户端；T3 全局笔记。
- **D3 Git 边界**：v1 对外只暴露本地写闭环（status/diff/graph/stage/unstage/commit/分支与 tag/fetch）；fork 进来的代码里 push / pull 等远程写操作**默认隐藏**（凭据、代理、non-fast-forward、冲突未验证），保留实现、由设置项显式开启为实验特性。
- **D4 笔记存储**：一条笔记一个 `.md` 文件，带 YAML frontmatter（标题/标签/时间）；笔记库目录可配置，默认 `$DSH_HOME/notes`；全局跨工作区共享。
- **D5 交付与验收**：仓库按可发布 npm 包结构组织，但 v1 只验收「本地目录安装进当前 Desktop 客户端」可用；npm 发布不在 v1 验收范围。
- **D6 面板形态（项目侧栏 + tab 工作区）**：Workspace 面板 = 左侧「项目列表」侧栏（可拖宽 200–320px、可折叠成 52px 图标条）+ 主区（tab 条 + 面包屑 + 内容）+ 底部状态栏。侧栏只承担项目切换与项目级状态，**不再做 Explorer / Search / Git / Notes 四视图切换**；文件树、搜索、Git、笔记一律以 tab 形式打开。
- **D7 项目维度 tab 集合**：tab 归属于项目 —— 切换项目即切换整套 tab（各自保留 `activeTabId`、滚动位置与关闭栈），跨项目不共享。新建 tab 走 tab 条右侧 `+` 的下拉菜单：Session / Open file / Explorer / Terminal / Browser / Source Control / Note / New note。
- **D8 Git 实现（fork 复用）**：整体 fork `dsh-ide-git`（MIT，v0.21.1）的宿主半（32 个 git API、argv spawn、同仓串行写、大仓分页）与客户端面板（分支树 / 提交图谱 / 变更 / diff / 提交框 / 撤回浮窗）进本插件，只把注册方式改造成 Workspace 的 `git` tab，并保留 MIT 署名与「上游同步」说明。
- **D9 主题**：浅色为默认，深色同构换肤；两套共用一组语义 token，代码高亮也随主题切换（GitHub Light / Dark 两套配色）。
- **D10 与 dsh 默认页的关系**：本面板是宿主 `main` slot 里的一个**全局面板**，与「插件 / 自动化任务 / 记忆系统 / MCP 连接器」平级：`ctx.layout.selectPanel(id)` 互切，`selectPanel(null)` 回会话。进入时自动折叠 dsh 左侧栏（否则会出现双左栏），离开时恢复；面板内提供返回入口与「应用」区（动态列出宿主已注册的 `main` 面板，点击即切换，不硬编码任何插件名）。**启动默认直接进入 Workspace**（`startup: 'workspace'`），设置项可改为 `last`（记住上次）或 `conversation`（保持 dsh 默认）。

- **D11 设计已确认（2026-11-02）**：9 屏设计稿（P1–P9）与 8 屏深色版（D1–D8）经用户逐轮确认定稿，见 `designs/workbench.pen` 与 `designs/exports/`。实现阶段以 `design.md` §2.0b–§2.0f 为准，不得偏离既定 IA（项目侧栏 + tab 工作区）与视觉规格。

## Task Map

| 子任务 | 范围 | 依赖 |
|---|---|---|
| T1 `10-29-workspace-panel-shell` | 项目侧栏 + tab 工作区骨架（tab 条 / `+` 菜单 / 按项目隔离的 tab 集合 / 面包屑 / 状态栏）；Explorer tab（文件树）；Search tab（文件名 + 内容检索）；语法高亮代码视图；Markdown 预览；终端 / 浏览器 / 会话 tab | 无（定义 tab 类型与项目模型契约） |
| T2 `10-29-git-client` | fork `dsh-ide-git` 宿主半 + 客户端面板，改造为 Workspace 的 `git` tab；JetBrains 式分支树/图谱/变更/提交框；push/pull 默认隐藏 | 依赖 T1 的 tab 注册契约 |
| T3 `10-29-global-notes` | 笔记库（可配置目录）、Notion 式单栏编辑器、笔记列表 tab、自动保存与检索 | 依赖 T1 的 tab 契约 |

## Requirements

- **R1 tab 工作区**：全屏 Workspace 面板 = 项目侧栏（头部有折叠/展开按钮，右边缘 3px 拖拽热区，可拖宽 200–320px、可折叠成 52px 图标条）+ 主区 tab 条 + 面包屑 + 内容 + 状态栏；tab 支持打开、切换、关闭、重命名、拖动重排，同一内容重复打开复用已有 tab；**tab 集合按项目隔离**，布局（项目 → tab 列表 / activeTabId / 侧栏宽度与折叠态）持久化，刷新后恢复。
- **R2 项目与检索**：侧栏列出已注册项目（名称 / 路径 / tab 数 / 运行中标记），支持过滤、添加、切换；文件树以 `Explorer` tab 打开（懒加载、忽略 `.git`/`node_modules` 等可配置目录、图标按类型着色、右键菜单含打开/复制路径/在系统打开）；文件名模糊搜索（快速打开 `Ctrl+P`）；内容检索（`Ctrl+Shift+F`）在 `Search` tab 内展示「文件 + 行号 + 命中行片段」，点击命中跳到该文件对应行；检索可取消、有结果上限。
- **R3 代码查看与语法高亮（对齐 VSCode 阅读体验）**：编辑器区按扩展名/文件名确定语言并高亮，覆盖 ts/tsx/js/jsx/vue/json/css/scss/less/html/md/yaml/toml/ini/py/go/rs/java/kt/cs/rb/php/sh/sql/dockerfile 等；左侧行号 gutter、行高亮、缩进参考线、面包屑（路径分段可点）、当前行信息、`Alt+Z` 换行开关、`Ctrl+G` 跳转行、括号/缩进保持只读的视觉语法折叠（可选）、大文件按页加载且首屏不阻塞面板；状态栏显示语言、行列、编码、文件大小。
- **R4 Markdown 预览**：`.md`/`.mdx` 默认渲染视图（GFM：表格、任务列表、代码块高亮、删除线、自动链接、脚注），相对图片/链接按源文件目录解析；提供 VSCode 式「预览 / 源码」切换按钮与 `Ctrl+Shift+V` 快捷键。
- **R5 tab 类型与 `+` 菜单**：会话、文件、文件树、搜索、终端、浏览器（HTTP(S) URL）、Git、笔记均为独立 tab 类型，可在同一项目内共存；tab 条右侧 `+` 弹出菜单创建任意类型；**会话 tab 内嵌 dsh 会话页并可交互** —— 直接在该 tab 内发消息、看流式输出与工具调用，与主视图共享同一会话状态（不是只读镜像）。会话页上的插件注入位（代理状态与切换、对话/轨迹切换、模式与子智能体 chip、审批卡片、计划、交付物等）**随宿主会话页一并继承，不在本插件里二次实现**。
- **R6 Git 客户端（JetBrains 风格，fork 自 dsh-ide-git）**：分支树（HEAD / 本地 / 远程 / 标签 分组，ahead/behind 角标）、IDEA 列序的提交列表 + lane 拓扑图谱 + ref 徽章、提交详情与逐行 diff、变更四分组（冲突/已暂存/更改/未跟踪）+ 行内暂存/取消暂存/丢弃、提交框（`Ctrl+Enter`、`--amend`）、左侧 IDEA 式动作条（按可用高度收纳进 `⋯`，可排序可显隐）、破坏性操作确认与「删除分支/贮藏 30 分钟内可撤回」；窄容器自动切换堆叠布局。v1 默认隐藏 push / pull（见 D3）。
- **R7 全局笔记（Notion 式单栏）**：笔记列表作为 `Notes` tab（或 `+` 菜单的 New note 直达）；编辑为**单栏所见即所得** —— 大标题、块式正文（段落 / 待办 / 引用 / 代码块 / 分隔线）、无源码视图与行号；自动保存并显示状态；按标题与内容检索；跨工作区可见。
- **R8 一致性**：全部 UI 使用宿主主题 token（明/暗自动跟随）、字体 token、既有快捷键习惯；文案走 locale 注册（zh/en），不硬编码中文。
- **R9 可安装性**：单个 npm 包，`dsh.bundle.patch` + `dsh.client` 声明齐全；本地目录安装进 Desktop 客户端后刷新即生效；不修改 dsh 安装目录下的任何文件；禁用该插件不影响宿主启动。
- **R10 字体配置**：设置页可**分别**配置「界面字体」与「代码字体」的字体族、字号（代码另含行高）；默认跟随 dsh 的对应设置；内置 Inter 与 JetBrains Mono，也可选系统字体或填自定义字体名；改动实时生效并持久化，无需重启。
- **R11 插件配置页**：分「外观与字体」「Git」两页。外观页含 UI/代码字体、字号、行高与启动行为（`workspace` / `last` / `conversation`）；Git 页含 AI 提交信息开关与模型/推理强度、动作条顺序与显隐、提交后自动刷新、diff 上下文行数、大 diff 截断阈值、实验性远程操作开关（默认关）。所有字段即时生效、持久化，且不改动宿主设置。

## Acceptance Criteria

按子任务验收（各自 PRD 内详列），父任务只验收跨子任务的集成行为：

- [ ] 面板与默认页可互切：从 dsh 左侧栏面板列表点 Workspace 进入；面板顶部返回按钮或 `Esc` 回到会话视图；进入时 dsh 左栏自动折叠、离开时恢复。
- [ ] 侧栏「应用」区列出宿主已注册的其他全局面板（插件 / 自动化任务 / 记忆系统 / MCP 连接器…），点击即切到对应面板；宿主新装插件新增的面板无需改代码即可出现。
- [ ] 安装一个包即可获得全部能力；客户端左侧栏出现 Workspace 面板入口，点击后进入全屏工作台，`Esc`/返回可回到会话视图。
- [ ] 面板布局为「项目侧栏 + tab 工作区」：侧栏列出项目并可拖宽/折叠成 52px 图标条，主区有 tab 条、`+` 按钮、面包屑与底部状态栏。
- [ ] 项目隔离生效：在 A 项目开 3 个 tab，切到 B 项目只看到 B 的 tab；切回 A 时 tab 列表、顺序与 activeTabId 原样恢复。
- [ ] `+` 菜单可创建全部类型（Session / Open file / Explorer / Terminal / Browser / Source Control / Note），新建的 tab 落在当前项目下。
- [ ] 浅色与深色主题均可用，切换后无需刷新；代码高亮、diff、图谱配色随主题同步。
- [ ] 快捷键可用：`Ctrl+P` 快速打开、`Ctrl+Shift+F` 搜索、`Ctrl+G` 跳行、`Alt+Z` 换行、`Ctrl+W` 关闭 tab、`Ctrl+Shift+T` 重开。
- [ ] 同一条 tab 条内可同时存在：会话、文件、文件树、搜索、终端、浏览器、Git、笔记；可切换、关闭、拖动重排，刷新页面后布局恢复。
- [ ] 内容检索命中项点击后定位到正确文件与行号（同一命中在两次点击中行为一致）。
- [ ] Git 视图为 JetBrains 式工具窗口：分支树 + 提交图谱 + 变更分组 + 提交框同屏；完成一次「改动 → 暂存 → 提交」闭环后状态与图谱同步更新，无需手动刷新；push/pull 默认不可见。
- [ ] 在 A 工作区写下的笔记，切到 B 工作区的会话后仍能在笔记列表中打开同一内容。
- [ ] 三个子任务全部关闭（禁用插件）后，宿主正常启动与使用，无残留报错。
- [ ] 卸载插件（`dsh plugin remove` 或客户端插件页卸载）后 profile 配置回到安装前状态。

## Out of Scope

- 代码编辑与保存回写、LSP 补全/跳转定义/重构（工作台以查看为主）。
- push / pull 等远程写操作：fork 代码内保留实现，但 v1 UI 默认隐藏且不做凭据/冲突验证。
- 交互式 rebase、submodule、LFS、三方冲突解决编辑器、多仓库并行管理。
- 笔记的协作、云同步、Notion database 视图、块级拖拽富文本。
- 移动端与其他非 Web 载体；right-sidebar dock 的改造。

## Risks / Deferred Technical Items

以下不是产品问题，而是实现期需要先用最小实验确认的技术未知；它们不改变 v1 行为，但会影响 T1 的工作量估算：

- **S1** 插件客户端能否直接复用宿主已注册的 dock tab 组件（Document Preview / Terminal / Browser 的 body）。初步判断只能复用数据层（Remote）而不能复用 UI，需实验确认后再定终端与浏览器的实现深度。
- **S2** `@xterm/*` 与 shiki 是否在平台共享模块基线表内、能否被插件 `require`；若不能，需自带打包或改用宿主暴露的封装。
- **S3** 会话列表与「切回会话」的导航 API（`ctx.layout.selectPanel(null)` 之外是否需要 session controller）。
- **S4** Desktop profile 的本地目录安装路径与 HMR 生效条件（客户端插件改动是否需要重启进程）。
- **S5** `@deepseek-ai/dsh-client-ui-primitives` 是否可被插件 `require`（`dsh-ide-git` 正是这样拿到 `DiffBlock` / `FileTypeIcon` 的，且做了 try/catch 降级）；不可用时 diff 与文件图标需自绘。
- **S6** fork 上游同步策略：`dsh-ide-git` 单文件客户端约 300KB 且迭代快（v0.21.1）。需要确定「同步基线 + 差异补丁清单」的记录方式，否则后续上游升级会变成手工重做。
- **S7** 侧栏与 active tab 同步的焦点策略细节（自动 reveal 是否打断用户正在浏览的目录、Git/Notes 视图自动切换的抑制窗口）需要实测手感后微调。
- **S8** 会话页多实例：主视图与 tab 同时挂同一 session 时，composer 焦点与流式订阅是否重复；若冲突，退化为「同一实例换宿主」（portal）方案。
