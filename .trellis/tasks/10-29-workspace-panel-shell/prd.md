# T1 — Workspace Panel Shell + Code View/Search

## Goal

注册一个全屏 Workspace 主面板，按**项目侧栏 + tab 工作区**布局建立三套契约：项目模型（复用宿主 workspace 注册表）、tab 类型注册、按项目隔离的 tab 集合。在其上交付项目列表与 `+` 新建菜单、Explorer（文件树）、Search（内容检索）、语法高亮代码视图、Markdown 渲染预览，以及终端 / 浏览器 / 会话三种 tab。

父任务：`10-29-tern-workspace-plugin`（架构与宿主契约见父任务 `design.md`，设计稿见 `designs/tern-workspace.pen`）。

## Requirements

- **R1.1 面板与入口**：`main` 面板注册成功，dsh 左侧栏面板列表出现「Workspace」；点击进入，`ctx.layout.selectPanel(null)` 或 `Esc` 回会话视图；进入时收起 dsh 左栏、离开恢复；面板遵守 `--dsh-frame-top-clearance`，不压 Desktop 标题栏。
- **R1.2 骨架**：左侧项目侧栏（默认 248px、可拖宽 200–320px、头部折叠/展开按钮 + 右边缘 3px 拖拽热区、折叠后 52px 图标条）+ 主区 tab 条（42px，右端 `+` 与 `⋯`）+ 面包屑（30px）+ 内容区 + 状态栏（26px）。
- **R1.3 项目模型**：项目来自宿主 workspace 注册表（`ctx.workspace`），侧栏每行显示名称 / 路径 / tab 数 / running 标记；支持过滤、`Add project`（走宿主目录选择器）、切换。不新建项目注册表。
- **R1.4 项目维度 tab 集合**：每个项目独立维护 `{ tabs, activeTabId, closed, sidebar }`；切换项目即切换整套 tab；布局持久化到 localStorage（`schemaVersion: 2`），刷新后恢复。
- **R1.5 tab 模型**：支持打开 / 切换 / 关闭 / 重命名 / 拖动重排 / 重开（最近 10 条）；同一 `{kind, contentId}` 复用并激活；tab 类型至少含 `session / file / explorer / search / terminal / browser / git / note`（后两个由 T2/T3 注册）。
- **R1.6 tab 类型注册契约**：`ternTabs.register({kind, icon, order, match, create, children})`；新增类型不改面板壳代码。T2/T3 依赖此契约。
- **R1.7 `+` 菜单**：Session / Open file… / Explorer / Terminal / Browser / Source Control / Note，另含 New note / New project；新建的 tab 落在当前项目。
- **R1.8 文件树（Explorer tab）**：以当前项目根懒加载目录（`workspaceFiles.list`），默认隐藏 `.git`/`node_modules`/`.next`/`dist`（可配置）；图标按类型着色；单击打开文件 tab；右键菜单：打开、在树中定位、复制路径、在系统打开。
- **R1.9 文件名搜索**：`Ctrl+P` 快速打开，模糊匹配（宿主 `search` op `mode:'name'`），上限 50，回车打开第一条。
- **R1.10 内容检索（Search tab）**：`Ctrl+Shift+F` 打开；关键词（可选正则、大小写、包含/排除 glob），左侧按文件分组展示行号与命中行（命中块高亮），右侧同 tab 内预览命中文件并高亮该行；上限 500 且标注 `truncated`；新查询或 `Esc` 取消并终止宿主子进程。
- **R1.11 代码视图**：按扩展名/文件名/shebang 选语言高亮；行号 gutter、当前行高亮、缩进参考线、面包屑（可点）；`Alt+Z` 换行、`Ctrl+G` 跳行；分页加载（每页 ≤800 行）、超长行降级纯文本；外部修改提示「已变化，点击重载」；状态栏显示语言/行列/编码/大小。
- **R1.12 Markdown 预览**：`.md`/`.mdx` 默认渲染（GFM：表格、任务列表、代码块高亮、删除线、脚注、自动链接），相对图片/链接按源文件目录解析；「预览 / 源码」切换 + `Ctrl+Shift+V`。
- **R1.13 终端 / 浏览器 / 会话 tab**：终端 tab 起 shell、跑命令、关闭即结束进程（不可用时降级为「打开右侧栏终端」）；浏览器 tab 打开 HTTP(S) URL 并有后退/刷新/地址栏；**会话 tab 内嵌宿主会话页并可交互**（复用 `ui-conversation` + `SessionProvider`，slot 注入的代理状态、对话/轨迹、审批等随之继承）。
- **R1.14 一致性与可访问性**：主题 token、明暗跟随、locale（zh/en）、`role="tablist"`/`role="tab"` 键盘可达；`Ctrl+Tab` 切 tab、`Ctrl+W` 关闭、`Ctrl+Shift+T` 重开、`Ctrl+B` 折叠侧栏，终端聚焦时让位。

## Acceptance Criteria

- [ ] 安装并刷新客户端后，dsh 左栏出现 Workspace 入口；进入后是空面板（项目侧栏 + 空状态），无控制台报错；`Esc` 能回会话视图且 dsh 左栏恢复。
- [ ] 侧栏可拖宽、可折叠成图标条；宽度与折叠态刷新后保持。
- [ ] 在项目 A 开 3 个 tab，切到项目 B 只见 B 的 tab；切回 A 时 tab 列表、顺序与 activeTabId 原样恢复。
- [ ] `+` 菜单能创建 Session / Explorer / Terminal / Browser / Note；新建 tab 落在当前项目。
- [ ] 打开 `package.json`、一个 `.ts`、一个 `.md`：分别是纯文本 / 高亮 / Markdown 渲染；面包屑分段可点。
- [ ] Explorer 里连点同一文件两次只产生一个 tab；点击不同行时定位到对应行。
- [ ] `Ctrl+P` 能按文件名片段定位；`Ctrl+Shift+F` 返回按文件分组的结果，点击后右侧预览并高亮该行。
- [ ] 检索进行中输入新关键词，旧请求被取消（宿主子进程结束，无残留）。
- [ ] 会话 tab 内可发消息并看到流式输出；代理状态胶囊与「对话/轨迹」切换在该 tab 内可见可用。
- [ ] 终端 tab 关闭后进程结束；`Alt+Z` / `Ctrl+G` / `Ctrl+Shift+V` / `Ctrl+B` 均生效。
- [ ] 刷新页面后 tab 列表、顺序、活动 tab、侧栏宽度与折叠态恢复；浅色与深色主题下均可读。

## Out of Scope

- 代码编辑与保存回写、LSP 能力（折叠仅视觉只读）。
- Git 面板（T2）与笔记（T3）的内容，只提供它们的注册契约与落点。
- dsh 右侧栏 dock 的改造。

## Dependencies / Risks

- 依赖父任务 `design.md` 的 Spike：S1（面板注册）、S2（shiki/xterm）、S3（终端 controller）、S4（本地安装热更新）、S9（会话页多实例）、S10（侧栏折叠）、S11（main 面板枚举）。
- S2 失败：shiki 自带打包；xterm 不可用则终端 tab 降级为跳转按钮。
- S9 冲突：改用「同一实例换宿主」的 portal 方案。
- S10 不可用：不折叠 dsh 左栏，改为面板内提供展开/收起按钮。
