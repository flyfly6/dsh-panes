# Technical Design — Workspace Workbench Plugin

> 父任务设计。子任务共享本文件的包结构、tab 契约与宿主 API 契约；子任务只在自己的 `implement.md` 里写增量清单。

## 1. 形态与边界

单个 npm 包 `dsh-workbench`（可发布结构，v1 用本地目录安装）。**仓库根 = 包根**：不再套一层同名目录，包文件与 `designs/`、`.trellis/` 平级。

```
（仓库根）/
├─ package.json          # main: lib/index.js, exports["./client"]: lib/client.js,
│                        # dsh.bundle.patch, dsh.client{platform,inject,external}
├─ cordis.patch.yml      # - insert: [{ id: workbench, name: dsh-workbench }]
├─ lib/                  # 构建产物（gitignored）
│  ├─ index.js           # 宿主半边：路由 + search / notes / 挂载 fork 进来的 git 半
│  └─ client.js          # 浏览器半边：面板壳 + 各 tab 类型（tabs.ts 内联进 bundle）
├─ src/
│  ├─ index.ts           # 宿主半入口
│  ├─ client.ts          # 浏览器半入口（面板 / 侧栏 / tab 条 / 文件与树视图）
│  ├─ tabs.ts            # 纯 tab 模型（可被 node --test 直接 import）
│  └─ git/               # ★ fork 自 dsh-ide-git（MIT）：host.js + panel.js
├─ test/                 # node --test：宿主路由 + tab 模型
├─ locale/               # zh/en 字典（暂内联在 client.ts，拆文件时再建）
├─ NOTICE.md             # 第三方来源与 MIT 署名
└─ README.md
```

- **宿主半边职责**：注册 HTTP 路由 `/dsh-workbench/api`（唯一前端入口）、执行 git、执行内容检索、读写笔记库、目录列表加速、配置读写。全部通过 cordis 服务（`ctx.fs`、`ctx.subprocess`、`ctx.storage`）而不是裸 `node:fs`，以便继承沙箱与工作区语义。
- **浏览器半边职责**：注册 `main` 面板与左侧栏入口、tab 模型与渲染、代码高亮、Markdown 渲染、diff 渲染、笔记编辑器、调用宿主 API。
- **不修改宿主**：不碰 `app.asar`、不改 profile 里其他 bundle；只通过 `dsh plugin add` 追加自己的依赖与 bundle 行。

## 2. 客户端结构

### 2.0 面板布局（项目侧栏 + tab 工作区）

```
┌────────────────┬────────────────────────────────────────────┐
│ PROJECTS       │ [Session][App.tsx][zsh][Git][Notes]  [+] [⋯]│
│ ─────────────  ├────────────────────────────────────────────┤
│ ▸ dsh-workspace│ src › client › App.tsx              Workspace│ ← 面包屑（按 tab 类型）
│   ~/projects/… ├────────────────────────────────────────────┤
│ ▸ weareint-web │                                            │
│   running      │        tab 内容（会话/文件/树/搜索/         │
│ ▸ mdp-backend  │        终端/浏览器/Git/笔记）                │
│                │                                            │
│ + Add project  │                                            │
├────────────────┴────────────────────────────────────────────┤
│ 项目 · 分支 +4 −1 · 2 running │ Ln 13, Col 24 · UTF-8 · Light│
└─────────────────────────────────────────────────────────────┘
```

| 区域 | 行为 |
|---|---|
| 项目侧栏（248px） | 默认 248px，可拖宽 200–320px；**头部左侧有返回按钮（回会话视图）**，右侧有折叠/展开按钮，右边缘 3px 为拖拽热区（hover 高亮，双击复位）；折叠后变 52px 图标条（首字母头像 + 选中描边），窄容器自动折叠；**底部「应用」区动态列出宿主其他 `main` 面板**；每行 = 图标 + 项目名 + 路径 + 右侧标记（tab 数 / running）；选中行左侧 2px accent |
| tab 条（42px） | 每种 tab 类型有图标与色；激活 tab = 白底（深色为编辑器底）+ 顶部 2px accent；溢出横向滚动；右侧固定 `+`（弹创建菜单）与 `⋯`（tab 列表 / 关闭其他 / 关闭全部） |
| 面包屑（30px） | 按 tab 类型变化：文件 = 路径分段；笔记 = 库路径 › 标题；Git = 仓库 › 分支；右侧放该 tab 的次要操作（已保存 / 同步状态） |
| 内容区 | 由 tab 类型渲染；无 tab 时显示项目级 Welcome（+ 菜单提示 + 最近文件） |
| 状态栏（26px） | 左：项目 · 分支 · 改动 · 运行中会话数；右：语言、行列、编码、主题切换 |

**项目与 tab 的关系（D7）**：

```
projects: Project[]                 // 来自 workspace 注册表（复用宿主 ctx.workspace）
projectTabs: Map<projectId, {
  tabs: TabModel[]                  // 该项目的 tab 集合
  activeTabId: string | null
  closed: TabModel[]                // 该项目最近关闭的 10 条
  sidebar: { width, collapsed }     // 折叠态可按项目记忆
}>

switchProject(id):
  persist(projectTabs[current])     // 只写自己的那份
  active = projectTabs[id] ?? emptyProjectState(id)
  render(active)

openTab(projectId, {kind, contentId}):
  幂等：已存在 → 激活并合并 params；否则 append + 激活
```

- 跨项目**不共享** tab；同一文件在两个项目里打开是两个 tab（contentId 带 projectId 前缀）。
- 项目删除时其 tab 集合一并丢弃（不迁移）。

### 2.0b 视觉设计稿（已确认）

设计稿：`designs/workbench.pen`；导出图在 `designs/exports/`。**一套结构 × 两套主题**：颜色全部走变量，深色版是对同一屏设置 `theme:{mode:'dark'}` 得到，不是重画。

| 屏 | 节点 | 内容 | 覆盖 |
|---|---|---|---|
| P1 浅色主界面 | `tL8yG` | 项目侧栏 + 5 个 tab（Session/App.tsx/zsh/Git/Design notes）+ 高亮代码 + 状态栏 | R1/R2/R3/R5 |
| P2 新建菜单 | `Zz4Bp` | `+` 下拉：Session / Open file / Explorer / Terminal / Browser / Source Control / Note / New note / New project | R5 |
| P3 Git tab | `u53yI9` | IDEA 动作条 + 分支树 + 提交列表/图谱/refs + 变更分组 + 提交框 | R6 |
| P4 笔记 tab | `lgBsZ` | Notion 单栏：大标题 + 标签 + 待办 + 引用 + 代码块 + 光标 | R7 |
| P5 窄容器 | `uftA1` | 52px 项目图标条 + 可滚动 tab 条 + Git 堆叠（变更在上 / 提交列表在下 / 提交框） | R1 |
| P6 搜索 tab | `pwca6` | 查询条（Aa / .* / glob / 结果计数）+ 左侧按文件分组命中（黄底命中块）+ 右侧预览与命中行高亮 | R2 |
| P7 会话 tab | `URxOs` | 会话头（标题 / 模式 / 子智能体 / 运行中 / 代理状态）+ 对话·轨迹切换 + 消息流 + 可交互输入框 | R5 |
| P8 外观设置 | `c00EdY` | 界面字体 / 代码字体（族、字号、行高）+ 实时预览 + 恢复默认/保存 | R10 |
| P9 Git 设置 | `uBPww` | 提交（AI 生成 / 模型 / 推理强度）/ 动作条顺序与显隐 / 行为 / 实验开关 | R11 |
| D1–D8 深色 | `mmze5` `H0j5b2` `AfEbo` `a9mqj` `fnObM` `Z741K` `yqEEY` `UH0SD` | P1/P3/P4/P5/P6/P7/P8/P9 的同构深色版 | D9 |

**尺寸与配色 token**（实现时映射到宿主 `--dsw-alias-*` / `--dsh-*`，不自造主题体系）：

| 项 | 浅色 | 深色 |
|---|---|---|
| 面板底 / 侧栏 / 编辑器 | `#F3F4F6` / `#FAFAFB` / `#FFFFFF` | `#15161A` / `#191A1F` / `#1C1D22` |
| tab 条 / 悬停 / 选中 | `#EFF1F4` / `#ECEEF2` / `#E7EBF3` | `#101115` / `#26282F` / `#2E3138` |
| 边框 / 强边框 | `#E3E5EA` / `#CDD1D9` | `#2A2C33` / `#3A3D46` |
| 文本 主/次/弱 | `#1B1F26` / `#5A616E` / `#8B919C` | `#E7E8EC` / `#A0A3AC` / `#6C7079` |
| 强调 / 语义 | `#3B6FF5` · 增 `#1A7F37` · 删 `#CF222E` · 标签 `#9A6700` · 远程 `#8250DF` | `#5B8CFF` · `#3FB950` · `#F0616D` · `#D6A84A` · `#A97BF5` |
| 代码高亮（GitHub 系） | 关键字 `#CF222E` 串 `#0A3069` 函数 `#8250DF` 类型 `#953800` 注释 `#6E7781` 属性 `#0550AE` | `#FF7B72` `#A5D6FF` `#D2A8FF` `#FFA657` `#8B949E` `#79C0FF` |
| 尺寸 | 侧栏 248（200–320 / 折叠 52）· tab 条 42 · 面包屑 30 · 状态栏 26 · 行高 22/25/29 | 同左 |
| 字体 | UI `Inter` 10–13px（笔记正文 14、标题 32）；代码/路径 `JetBrains Mono` 9–12.5px | 同左 |
| 选中语义 | tab 激活 = 顶部 2px accent；项目选中 = 左侧 2px accent；搜索命中行 = 左侧 3px 黄 + 8% 底 | 同左 |

### 2.1 面板与入口（已验证的挂载方式）

### 2.0c 视觉还原度与实现约束

**能做到 1:1 的部分**：布局栅格与尺寸、间距、圆角、描边、阴影、层级、状态色（选中/悬停/命中/增删）、明暗两套配色 —— 这些全是数值，直接抄 token 即可。

**需要适配的部分**（设计稿是理想态，实现要处理真实数据）：

| 项 | 设计稿 | 实现 |
|---|---|---|
| 文本长度 | 固定示例（`WorkspacePanel.tsx`、`4 个子智能体`） | 单行省略 + hover 显示全名；tab 宽度设 min/max，超出横向滚动 |
| 内容高度 | 固定 900 | 内容区 `flex:1` + 内部滚动；代码/列表虚拟滚动 |
| 滚动条 | 未画 | 自定义 6px 细滚动条，颜色取 `--workbench-border-strong`，hover 加深 |
| 空状态 / 加载态 | 未画 | 每种 tab 一张空状态（图标 + 一句引导 + 主按钮） |
| 焦点态 | 未画 | 键盘 focus ring：accent 2px、offset -2，不加额外阴影 |
| 拖拽反馈 | 未画 | tab 拖动半透明 + 落点 2px accent 竖线；侧栏拖拽时手柄变 accent |

**会打折的三处**：

1. **字体**：设计稿用 Inter + JetBrains Mono，宿主只保证字体栈、不保证有这两个字体。不打包的话字宽/行高会变，提交列表和文件树这类密集列表明显走形。**决定：打包两个 woff2 subset（latin；中文由系统字体兜底），约 120–200KB，懒加载。**
2. **图标**：设计稿用 lucide。实现打包 `lucide-react`（tree-shaking 后约 15–25KB）；个别名字有版本差异（`file-diff`、`panel-left-close`）需核对替换或自绘 3–5 个。
3. **宿主窗口 chrome**：Desktop 顶部 48px 标题栏 / macOS 红绿灯，设计稿没画。面板必须按 `--dsh-frame-top-clearance` 留白，实际顶部会比设计稿多一条空白 —— 这是宿主要求，不能压掉。

**token 落地**：pen 变量名 → 插件 CSS 变量 `--workbench-*` → 再映射宿主变量。

```css
:root {
  --workbench-bg-app: var(--dsw-alias-bg-base);
  --workbench-bg-sidebar: var(--dsw-alias-bg-layer-2, #FAFAFB);
  --workbench-accent: var(--dsw-alias-brand-primary, #3B6FF5);
  --workbench-code-keyword: #CF222E;      /* 宿主没有的语义色才硬编码，双份 */
}
body[data-ds-dark-theme] { --workbench-code-keyword: #FF7B72; }
```

**验收方法**：实现后在 1440×900 下截图，与 `designs/exports/*.png` 叠图对比（容差：布局 ≤2px、颜色 ≤3ΔE），六个主屏逐一过，写进 T1 验收项。

### 2.0d 技术栈与样式方案

| 层 | 选择 | 理由 |
|---|---|---|
| UI 框架 | **React 18**（宿主基线模块提供，`require('react')`） | 宿主就是 React；用别的框架要自己带 runtime，且拿不到宿主的 slot / context |
| 组件写法 | TSX，构建时编译成 `React.createElement` | 与官方插件一致；源码可读性优先 |
| 组件库 | **shadcn/ui**（源码进 `src/components/ui/`，底层 Radix primitives） | 无障碍、键盘交互、焦点管理都是现成的；样式可完全接管，不锁死视觉 |
| 样式 | **Tailwind CSS**（构建期编译）+ shadcn 语义变量，产物内联成字符串注入 `<style data-plugin-css>` | shadcn 的组件代码就是 Tailwind 类名，绕开它等于重写组件 |
| 样式隔离 | Tailwind **禁用 preflight**；所有组件挂 `.workbench-root` 作用域 | preflight 会全局重置标签样式，必然污染宿主 UI |
| 状态 | React state + Context；跨 tab 共享的布局用宿主 snapshot store | 面板内状态量不大，先不上 zustand |
| 图标 | `lucide-react`（tree-shaken，shadcn 默认图标集） | 设计稿就是 lucide，一套图形语言 |
| 字体 | 打包 Inter + JetBrains Mono 的 woff2 subset，`@font-face` 注入插件样式表 | 不打包会掉到系统字体，密集列表走形（见 §2.0c） |
| 高亮 / Markdown | shiki（宿主已有）、markdown-it | 与宿主预览一致 |
| 终端 | `@xterm/*` + 宿主 terminal controller | 不自己起 PTY |

**shadcn 覆盖的组件**：Button / Input / Select / Switch / Tabs / DropdownMenu / ContextMenu / Dialog / Tooltip / ScrollArea / Command（`Ctrl+P` 快速打开）/ Resizable（侧栏拖宽）/ Toast（撤回提示）/ Separator / Badge。

**仍需自绘**（shadcn 没有对应物）：代码编辑器与 diff 视图、提交图谱 lane、文件树、消息流、Markdown 预览、终端承载。

### 2.0d-1 shadcn 接入的三个必须处理点

1. **关掉 preflight**：`corePlugins: { preflight: false }`。否则 Tailwind 的 base reset 会改掉宿主的 `h1`、`button`、`body` 等全局样式，整个 dsh 界面都会歪。
2. **把 shadcn 的语义变量映射到宿主**，而不是用它的默认调色板：

```css
.workbench-root {
  --background: var(--dsw-alias-bg-base);
  --foreground: var(--dsw-alias-text-primary);
  --card: var(--dsw-alias-bg-layer-2);
  --border: var(--dsw-alias-border-l2);
  --primary: var(--dsw-alias-brand-primary);
  --primary-foreground: #fff;
  --muted: var(--dsw-alias-bg-layer-3);
  --muted-foreground: var(--dsw-alias-text-secondary);
  --ring: var(--dsw-alias-brand-primary);
  --radius: 6px;
}
```

   宿主切明暗时这些变量自己变，shadcn 组件跟着变，不用写两套。
3. **改密度**：shadcn 默认是「营销站密度」（`text-sm` + `h-9` + `p-4`）。我们的界面是 IDE 密度（11–13px、28–30px 行高、6px 圆角）。在 `tailwind.config` 里覆盖 `fontSize` / `spacing` / `borderRadius`，并把 `--radius` 设成 6px；否则每个组件都要单独写 className 覆盖，得不偿失。

**体积影响**：Radix + shadcn 组件约 +40–60KB（gzip 前），Tailwind 产物约 25–35KB（JIT 后只含用到的类）。总体仍在 400KB 量级内。

### 2.0e 字体配置落地

> 实现（2026-11-03）：配置字段 `fontUiFamily` / `fontUiSize` / `fontCodeFamily` /
> `fontCodeSize` / `fontCodeLineHeight` 进 row config，客户端每次渲染读取 volatile
> ref 并写进 `.workbench-root` 的 CSS 变量（`--wb-font-*`），因此设置卡改动立即生效、
> 不必重启。未打包 Inter / JetBrains Mono：`--wb-font-ui` 默认跟随宿主
> `--dsh-font-family-sans`，本机宿主给的就是 Inter，缺字体时落到系统栈。

设置项（`plugins.bundle.config` slot 渲染，见设计稿 `c00EdY`）：

```
font.ui.family    'follow' | 'inter' | 'system' | <自定义字体名>
font.ui.size      12 | 13 | 14（也可自定义 11–16）
font.code.family  'follow' | 'jetbrains-mono' | 'system-mono' | <自定义字体名>
font.code.size    11 | 12 | 13 | 14
font.code.lineHeight  1.5 | 1.6 | 1.8
```

变量只在面板根节点覆盖，不影响宿主其他区域：

```css
.workbench-root {
  --workbench-font-ui: var(--dsh-font-family-sans, 'Inter', system-ui, sans-serif);
  --workbench-font-code: var(--dsh-font-family-mono, 'JetBrains Mono', ui-monospace);
  --workbench-font-ui-size: var(--dsh-content-font-size, 13px);
  --workbench-font-code-size: var(--dsh-code-font-size, 12px);
  --workbench-code-line-height: 1.6;
}
.workbench-root[data-workbench-font-ui='inter'] { --workbench-font-ui: 'Inter', system-ui, sans-serif; }
.workbench-root[data-workbench-font-ui='system'] { --workbench-font-ui: system-ui, sans-serif; }
/* 自定义：设置值直接写进行内 style，绕过枚举 */
```

- `follow` 时不写任何覆盖，完全继承宿主的 `--dsh-*` 变量 —— 宿主改字号，我们跟着变。
- 改动写入后立即 `style.setProperty` 更新，同时落插件配置（`config.set`）。
- 字体名做白名单校验（防注入）；自定义值只允许字体名与逗号分隔的字体栈，不允许多余字符。

### 2.0f 配置页结构（`plugins.bundle.config` slot）

两页，设计稿：外观 `c00EdY` / Git `uBPww`（深色 `yqEEY` / `UH0SD`）。页签与内容之间**只保留一条分隔线**，不再留空占位。

| 页 | 字段 | 说明 |
|---|---|---|
| 外观与字体 | `font.ui.family` / `font.ui.size` | 跟随 dsh / Inter / 系统 / 自定义 |
| | `font.code.family` / `font.code.size` / `font.code.lineHeight` | 跟随 dsh / JetBrains Mono / 系统等宽 / 自定义 |
| | `startup` | `workspace`（默认）\| `last` \| `conversation` |
| Git | `git.aiCommit.enabled` | AI 生成提交信息总开关 |
| | `git.aiCommit.model` / `.reasoning` | 跟随当前会话 / 指定模型；off·low·high·max |
| | `git.rail` | 动作条顺序与显隐（拖拽排序、眼睛图标切换） |
| | `git.behavior.autoRefresh` | 提交后自动刷新 |
| | `git.behavior.diffContext` | 3 / 5 / 8 行 |
| | `git.behavior.largeDiffLimit` | 400KB / 1MB / 不截断 |
| | `git.experimentalRemoteOps` | 默认关；开启后 push / pull 出现在动作条（带警告文案） |

上游 `dsh-ide-git` 的 row Config 里 `conversationTab` / `immersive` / `composerStatus` 三个 placement 字段随 fork 一并删除 —— 它们描述「面板挂在哪」，而我们的挂载点固定为 `git` tab。

### 2.1 面板与入口（已验证的挂载方式）

```js
ctx.effect(() => ctx.slots.inject('main', function* () {
  yield ctx.slots.register({
    name: 'main',
    key: 'workbench',
    label: 'Workspace',           // 左侧栏面板行的标题（走 locale）
    locale: NS,
    store,                        // 面板级 snapshot store
    children: { /* 面板内子 slot，见 2.3 */ },
  }, WorkspacePanel)
}))
```

- 左侧栏会出现同名面板行（图标来自 `sidebar.panellist` slot，可选注册一个 glyph）。
- `ctx.layout.selectPanel('workbench')` 进入；`ctx.layout.selectPanel(null)` 回会话视图（会话 tab 的跳转语义）。
- 面板必须按布局包约定处理 `--dsh-frame-top-clearance` 顶部留白（Desktop 的 caption / macOS 红绿灯）。

### 2.1b 与 dsh 默认页互切

```
启动：const mode = config.startup ?? 'workspace'     // 'workspace' | 'last' | 'conversation'
      if (mode === 'workspace' || (mode === 'last' && lastPanel() === 'workbench'))
        layoutReady.then(() => enterWorkspace())

进入：ctx.layout.selectPanel('workbench')
      → 记住 dsh 左栏折叠态；若未折叠，ctx.layout.toggleSidebar() 收起
离开：ctx.layout.selectPanel(null)        // 回会话视图
      → 恢复进入前的左栏折叠态
```

- 本面板是 `main` slot 的 keyed 面板，与「插件 / 自动化任务 / 记忆系统 / MCP 连接器」**平级**；`ui-sidebar` 会把所有 `main` 面板渲染成左栏行，所以入口天然存在，不需要额外注册。
- 「应用」区动态渲染宿主其余全局面板，零硬编码：

```js
ctx.slots.entries('main')
  .filter(e => e.options.key !== 'workbench')
  .map(e => ({ key: e.options.key, label: resolveSlotLabel(e.options.label) }))
// 点击 → ctx.layout.selectPanel(key)
```

  宿主新装插件注册的新面板会自动出现在这里；面板被禁用/卸载时自动消失。
- 风险：`toggleSidebar()` 是否允许插件程序化调用、折叠后是否仍是 56px rail，需实测（S10）。若不允许，退化为「面板内提供『展开 dsh 侧栏』按钮 + 接受双栏」。

### 2.2 tab 模型

```
WorkspacePanel
├─ TabStrip            (横向滚动、拖拽重排、中键关闭、右键菜单)
├─ TabContent          (按 tab.kind 渲染)
└─ StatusBar (可选)    (分支、git 状态摘要、保存状态)
```

Store（zustand 或宿主 snapshot store，二者择一，落地时统一）：

```ts
type TabKind =
  | 'session'   // 宿主会话页（可交互）
  | 'file'      // 文件查看/编辑视图
  | 'explorer'  // 文件树
  | 'search'    // 文件名 + 内容检索
  | 'terminal'
  | 'browser'
  | 'git'
  | 'note'

interface TabModel {
  id: string                 // `${projectId}:${kind}:${contentId}`
  kind: TabKind
  title: string              // 可被用户重命名覆盖，覆盖值单独存 titleOverride
  contentId: string          // 文件绝对路径 / sessionId / URL / 笔记 relPath / 'git'
  params?: Record<string, unknown>  // 如 file 的 line、search 的 query
  pinned?: boolean
  dirty?: boolean            // 笔记未保存
}

interface ProjectState {
  tabs: TabModel[]
  activeTabId: string | null
  closed: TabModel[]         // 该项目最近关闭的 10 条
  sidebar: { width: number; collapsed: boolean }
}

interface WorkspaceLayout {
  activeProjectId: string | null
  projects: Record<string, ProjectState>   // 按项目隔离
  schemaVersion: 2
}
```

- 幂等打开：`openTab(projectId, {kind, contentId})` 命中已有 tab 则激活并合并 `params`（如再次点击同一文件的不同行）。
- 持久化：`localStorage` 存 `WorkspaceLayout`（含每个项目的 tab 集合与侧栏宽度/折叠态）；terminal / browser tab 恢复时只恢复「记得的 shell / URL」，不保证进程重连。
- 关闭语义：笔记 tab 关闭前若 `dirty` 需确认；终端 tab 关闭时调用 terminal controller 终止会话。

### 2.3 tab 类型注册契约（T2/T3 依赖此契约）

```js
// 每个 tab 类型自注册，面板只负责壳
ctx.reflect.provide('workbenchTabs', registry)  // 或内部模块直接 import
registry.register({
  kind: 'git',
  icon: Component,
  order: 40,
  match: (target) => boolean,           // 供 openTarget 的兜底匹配
  create: (host, tab) => ({ title, component, onClose?, onPersist? }),
  children: { 'git.toolbar.actions': { kind: 'list', scope: 'root' } },  // 子 slot 可选
})
```

子任务新增 tab 类型只做三件事：注册类型、提供组件、在 `children` 里声明自己的子 slot，不修改面板壳代码。

### 2.3b 项目模型契约（复用宿主 workspace 注册表）

```js
// 项目直接来自宿主 workspace 注册表（与左栏会话列表同源），不新建一套
const projects = ctx.workspace.list()          // [{ id, path, name }]
projects.forEach(p => store.ensureProject(p.id))
store.projectState(projectId)                  // { tabs, activeTabId, closed, sidebar }
```

- `Add project` 走宿主目录选择器 → `ctx.workspace.register(path)`，成功后立即出现在侧栏。
- 项目删除时其 tab 集合一并丢弃；不迁移、不合并。

### 2.3c 会话 tab 的复用方式（关键）

会话 tab **不重写对话 UI**，而是挂载宿主的会话页组件：

```js
const Conversation = require('@deepseek-ai/dsh-client-ui-conversation')
<SessionProvider sessionId={tab.contentId}>
  <Conversation.View />
</SessionProvider>
```

- 宿主在会话页上注册的全部 slot（代理状态胶囊、对话/轨迹切换、模式与子智能体 chip、审批卡片、计划、交付物、消息反馈…）**自动继承**；本插件既不重复实现，也不依赖它们的具体名字。
- 已知风险与对策：
  - **双实例**：主视图与 tab 各挂一份 → composer 焦点、流式订阅可能重复。先用 Spike S9 实测同 session 多实例；冲突时改为「同一实例换宿主」——tab 激活时把会话页 portal 进 tab 容器，主视图留占位，反之亦然。
  - **滚动与草稿**：独立实例各存各的；走 portal 方案则天然共享。
  - **布局假设**：会话页假定自己占满主区，tab 容器需给 `height: 100%` 且不加额外 padding。

### 2.4 文件与预览

- 数据源统一走 `remote.workspaceFiles.read(sessionId, path, { offset, limit })` 分页（一次 400–800 行），`stat` 拿 version/bytes，`changes` 订阅变更用于「文件已变化」提示。
- 高亮：shiki（`codeToHast`/`codeToHtml`）在 Web Worker 或空闲时执行；语言按扩展名 + shebang 推断，未命中回退纯文本；超长行（> 5k 字符）截断高亮、只保留纯文本渲染。
- Markdown：`markdown-it` + GFM 插件（或宿主已有的 micromark 依赖，若在共享表内则复用），相对图片经 `/api/file` 取；代码块复用同一 shiki 实例；输出 sanitize 后再插入 DOM。
- 「文件 tree」：`remote.workspaceFiles.list` 懒加载；文件名的模糊搜索在客户端对已列出的节点做，未展开目录的深搜走宿主 `search` op 的 `mode: 'name'`。

## 3. 宿主 API 契约

单一路由 `POST /dsh-workbench/api`，请求体 `{ op, args }`，响应 `{ ok: true, ...} | { ok: false, code, message, details? }`。

- 必须要求 `x-dsh-plugin: dsh-workbench` 头（CSRF 门），与官方/第三方插件一致。
- 所有 `op` 入参中的路径必须解析后校验：文件读允许工作区外（与宿主 `workspaceFiles` 一致），但 **list / search / watch 必须限制在该会话工作区内**；笔记库路径必须限制在配置的 vault 内，拒绝 `..` 逃逸与符号链接穿越。

| op | 入参 | 出参 | 归属 |
|---|---|---|---|
| `search` | `{ sessionId, mode: 'content'\|'name', query, regex?, caseSensitive?, globs?, maxResults? }` | `{ hits: [{ path, line, column, text, submatches? }], truncated }` | T1 |
| `git.status` | `{ sessionId }` | `{ branch, upstream?, ahead, behind, staged[], unstaged[], untracked[] }` | T2 |
| `git.diff` | `{ sessionId, path, staged? }` | `{ hunks[] }`（unified 原文 + 结构化行） | T2 |
| `git.graph` | `{ sessionId, limit?, cursor? }` | `{ commits: [{ sha, parents, refs, author, time, subject }], next? }` | T2 |
| `git.stage` / `git.unstage` / `git.commit` / `git.branch.create` / `git.checkout` / `git.fetch` | `{ sessionId, ... }` | `{ ok, status }`（成功后直接回最新 status，省一次往返） | T2 |
| `notes.list` / `notes.read` / `notes.write` / `notes.create` / `notes.delete` / `notes.rename` / `notes.search` | `{ ... }` | 笔记元数据或正文 | T3 |
| `config.get` / `config.set` | `{ key, value }` | 生效中的配置 | T1 |

> 注：上表 `git.*` 行仅描述**能力**；实现上它们由 fork 进来的 `/dsh-ide-git/api/<method>` 提供（`summary/branches/log/commitDetail/diff/compare/stage/commit/checkout/branch*/tag*/stash*/fetch/...`），本插件自有路由只保留 `search` / `notes.*` / `config.*`。两套路由共用同一套 CSRF 头与错误码包装。

实现要点：

- **git**：`ctx.subprocess` 以 argv 数组直接调 `git`（绝不拼 shell 字符串），`cwd` = 会话工作区；`GIT_TERMINAL_PROMPT=0`、`-c core.quotepath=false`；超时与输出上限（如 8 MiB）保护；`fetch` 走宿主已有代理环境变量；对不存在 git / 非 git 仓库返回可读错误码而非抛异常。
- **search**：优先用 `@vscode/ripgrep` 的二进制（`--json --max-count --glob --hidden=false`）；不可用时回退 JS 遍历 + `fs.read`（限并发 4、限文件大小 2 MiB、跳过二进制）。结果流式分片返回，客户端 `AbortController` 取消即终止子进程。
- **notes**：`.md` 文件 + frontmatter（`gray-matter` 或自写极简解析，避免额外依赖树）；写入走原子写（临时文件 + rename）；`write` 前比较 mtime/etag，冲突时返回 `conflict` 让客户端提示覆盖/重载。

## 3.3b 笔记编辑器选型（BlockNote）与 Markdown 预览的边界

用户指定 T3 的 Notion 式编辑器用 [BlockNote](https://github.com/TypeCellOS/BlockNote)（MPL-2.0，ProseMirror/Tiptap 之上）。实测与结论（2026-11-03）：

| 项 | 事实 |
|---|---|
| 只读复用 | 可行：`editor.isEditable = false`，用 `@blocknote/shadcn` 与现有 Tailwind/shadcn 工具链同栈 |
| 体积 | 只读 `BlockNoteView`（core + react + shadcn，react 外置）打包 **4.15 MB raw / 894 KB gzip**；当前整包 406 KB gzip |
| Markdown 能力 | 官方自述解析器是 **minimal + lossy**（CommonMark + GFM 基础子集），更丰富的 markdown 官方建议「先用 markdown-it/marked 解析成 HTML，再 `tryParseHTMLToBlocks`」 |

- **仓库文件预览继续用 markdown-it**（已实现，40KB 量级，GFM 覆盖更全、DOMPurify 消毒后直接出 HTML）；BlockNote 只出现在笔记 tab。
- 视觉一致靠样式层：`.wb-markdown` 的排版规则同样作用于 BlockNote 只读态，不追求同一渲染器。
- **存储已决（用户选定，2026-11-03）**：**(a) `.md` 为唯一正本、只用受支持子集**。块 ↔ Markdown 由 BlockNote 自身转换（`tryParseMarkdownToBlocks` / `blocksToMarkdownLossy`），不自写块模型；frontmatter 由宿主独占（编辑器只碰 body，未知字段与顺序原样保留）；往返比对只用于**提示**（表格/任务列表/代码块可往返，脚注与原始 HTML 会规范化）。
- **实现中修正的两条选型**：① UI kit 用 `@blocknote/ariakit`（`@blocknote/mantine` 在这套组合下渲染即抛 `Cannot read properties of undefined (reading 'S')`）；② `react-dom/*` 必须整族外部化（二次打包的 react-dom 与宿主 React 18 的 `ReactSharedInternals.S` 冲突），`node:crypto` / `process` 由 wrapper 兜底 shim。
- **实测体积**：整包 8.1 MB raw / **2.23 MB gzip**（BlockNote + yjs ≈ 1.5 MB gzip）。代价记录在此，作为「是否值得」的唯一依据。

## 3.4 Git 半（fork 自 dsh-ide-git，MIT）

来源与边界：`https://github.com/KannaKuron/dsh-ide-git` v0.21.1（MIT）。**整体 vendor 进 `src/git/`**，只做接入改造，不重写面板与 git 逻辑。

| 上游部分 | 处理 |
|---|---|
| 宿主半 `src/index.js` | 保留：前缀路由 `POST /dsh-ide-git/api/<method>`（32 方法：`summary/branches/log/commitDetail/diff/compare/stage/commit/checkout/branch*/tag*/stash*/fetch/pull/push/reset/revert/cherry-pick/commit-models/commit-efforts/version`）、argv-only `spawn('git', ...)`、同仓写操作串行队列、diff ≤400KB 截断、`engines.dsh` 兼容门槛。改为**被我们的宿主插件 `ctx.plugin(gitHost, config)` 挂载**，不再自带 bundle 行。 |
| 客户端面板 `src/client.js` | 保留 UI（动作条 / 分支树 / 提交列表 + lane 图谱 / 提交详情 / 变更四分组 / 提交框 / 撤回浮窗 / ResizeObserver 自适应 columns\|stack），改动：① `window.__ModuleLoader__.load` 包装 → `export default function createGitPanel(require)`，由我们的适配层调一次；② 四个座位（better-sidebar tab、原生右侧栏 + 预览 tab、`conversation.view`、输入框胶囊）全部删除，改由 `workbenchTabs.register({kind:'git', render})` 直接渲染 `LocaleLive`；③ 命名空间改名（`RAIL_NS`→`workbench`、`SETTINGS_BUNDLE`→`dsh-workbench`、`LOCALE_NS`→`dsh-workbench.git`），`API_BASE` 保持 `dsh-ide-git/api`；④ placement 设置分组换成「远程操作」开关。 |
| 依赖 | 去掉 `dsh-better-sidebar` peer；`@deepseek-ai/dsh-client-ui-primitives`（`DiffBlock`/`FileTypeIcon`）改为可选 require + 自带降级渲染（与上游同样的 try/catch 姿态）。 |
| 配置 | 上游的 row Config 由 `src/config.ts` 生成（`RAIL_CONFIG_IDS` + `commitModel/commitReasoning/commitPrompt` + `experimentalRemoteOps`）；`conversationTab` / `immersive` / `composerStatus` 三个 placement 字段连同其写入点删除。**命名空间 = 我们的 loader row id `workbench`**，设置卡 key = 包名 `dsh-workbench`。 |
| push / pull | 代码保留，UI 默认隐藏（D3）：动作条、所有右键菜单（`openMenuAt` 单点过滤）、提交框「提交并推送」三处；`experimentalRemoteOps=true` 才出现。**宿主侧也拦**：`assertRemoteOpsAllowed` 对 push/pull/pushTags/remote*/`commit{push}` 返回 `disabled-by-config`（403）——两层锁，UI 隐藏不是唯一防线。 |

**上游同步策略（S6）**：仓库内维护 `src/git/UPSTREAM.md`，记录①同步基线 commit/版本；②我们相对上游的改动清单（上面三处 + 配置 + 隐藏项），以「补丁点清单」形式描述（文件 + 函数 + 行为），不追求自动 merge；③每次同步后跑我们的 T2 验收清单。上游客户端是单文件大文件，**禁止**在不记录的情况下改动其内部函数，避免下次同步丢改动。

**实现结果（2026-11-03，T2）**：`src/git/{host.js,panel.js,LICENSE,UPSTREAM.md}` vendor 完成；宿主半由 `src/index.ts` 以 `ctx.plugin(gitHost, config)` 挂载（`ctx.effect` 的 disposer 里 `fiber.dispose()`），路由与全部守卫为上游原样；客户端面板由 `src/git/tab.tsx` 适配（`scope:{cwd,sessionId}` + `visible:true`）。额外修了上游两处空仓库缺陷（unborn branch、无提交的 `log`）。实测：17 处改动的真实仓库里分支树/提交列表/变更分组/暂存-取消暂存/双击 diff/设置页远程开关全部走通；`test/git.test.mjs`（6 条）覆盖信任围栏、配置闸门、空仓库与非仓库路径。

数据流：客户端面板 → `POST /dsh-ide-git/api/<method>`（同源、带 `x-dsh-plugin` 头）→ 宿主 spawn git → 结构化结果。仓库根由客户端传入 `cwd`（当前会话工作区），宿主侧校验路径为绝对路径、ref 不以 `-` 开头、无控制字符、路径不越出仓库。

## 4. 数据流

```
用户点击文件
  → registry.openTarget() → tabs.openTab({kind:'file', contentId:absPath})
  → 文件 tab 组件: workspaceFiles.stat → read(page 1) → shiki 高亮 → 渲染
  → 滚动到底 → read(offset=next) 追加

内容检索
  → 搜索面板 debounce 250ms → POST /api {op:'search'}
  → 宿主 ripgrep → 分片返回 → 列表渲染（虚拟滚动，上限 500）
  → 点击命中 → openTab({kind:'file', contentId, params:{line}})

Git 操作
  → 按钮 → POST /api {op:'git.stage'} → 宿主执行 → 返回新 status
  → store 更新 → diff/graph 视图失效重取
```

## 5. 兼容性与约束

- `dsh.client.inject` 只声明真实需要的模块（布局、slots、locale、renderer、session、remotes），其余依赖自带打包；`external` 仅用于平台基线表内的模块。
- 版本对齐：`peerDependencies` 写 `@deepseek-ai/cordis ~4.0.5` 与用到的 `0.2.1-rc.3` 包；`engines.dsh` 由安装期校验。
- 主题：只用 `--dsw-alias-*` / `--dsh-*` 变量与 `data-ds-dark-theme`，提供浅/深两套自绘色（diff 的增删底色、graph 分支色）。
- 国际化：所有用户可见文案进 `locale/{zh,en}.json`，通过 `ctx.locale.register(NS, dict)` + `bind(NS)` 取用。
- 可访问性：tab 条用 `role="tablist"`，键盘 `Ctrl+Tab` / `Ctrl+W` / `Ctrl+Shift+T` 与快捷键服务对齐。

## 6. 关键取舍

| 取舍 | 选择 | 理由 |
|---|---|---|
| 面板布局 | VSCode 式（Activity Bar + 侧栏 + 编辑区 + 状态栏），文件树进侧栏 | 用户明确要求；侧栏常驻比「文件树占一个 tab」更接近真实 IDE 心智，也让 Git/Notes 视图有统一落点 |
| 复用宿主 dock tab 组件 vs 自建 | 自建 tab 壳，复用宿主数据层 | dock tab 绑定 per-session 布局与 `sidebarRightTabs` 注册表，重托成本高于收益；数据层（Remote）已足够稳定（对应 S1） |
| Git：fork vs 依赖 vs 自研 | fork 两半进本包 | 单包交付、完全可控；上游已是 v0.21.1 的成熟实现（32 API + 图谱 + 撤回 + 自适应布局），自研等于重做一遍并落后；ET 许可证允许（NOTICE 署名） |
| 终端实现深度 | 优先复用宿主 terminal controller（Remote + xterm 渲染）；若 xterm 不可用则降级为「打开右侧栏终端」 | 自己起 PTY 会与宿主终端生命周期/限额重复（对应 S2） |
| 内容检索位置 | 宿主侧 ripgrep，而非客户端递归 `read` | `workspaceFiles.list` 只有直接子项，客户端递归会打爆 Remote 往返 |
| 布局存储 | 前端 localStorage 为主 | 面板几何本来就是 transient（宿主 layout README 明确），跨设备同步不在 v1 |
| 单一 HTTP 路由多 op vs REST 多路由 | 两个前缀路由：`/dsh-workbench/api`（自有 op）+ `/dsh-ide-git/api`（fork 保留） | 不改上游协议可降低 sync 成本；两者都做 CSRF 头与错误码统一处理 |
| push/pull | 代码保留、UI 默认隐藏 | 凭据/代理/冲突未验证，但删代码会让 upstream 同步变复杂（D3） |

## 7. 停用与回滚

- 禁用：`dsh plugin --profile desktop remove dsh-workbench` 或客户端插件页关闭该 bundle → patch 行消失，宿主启动不受影响（客户端半边懒加载，不注册任何全局副作用）。
- 数据回滚：笔记是独立 `.md` 文件，卸载不删库；布局在 localStorage，卸载后残留无害。
- 破坏性 git 操作（checkout 覆盖本地改动）在 v1 一律先 `git status --porcelain` 检查并在 UI 里二次确认，不做自动 stash。

## 8. 实现前必须完成的最小实验（Spike）

| # | 实验 | 通过判据 | 失败时的退路 |
|---|---|---|---|
| S1 | 用最小 `main` 面板 + 一次 `workspaceFiles.read` 打通「安装 → 左侧栏出现入口 → 读文件上屏」 | Desktop 客户端里 30 分钟内可见 | 检查 `dsh.client.inject` 与 ModuleLoader id 是否匹配 |
| S2 | 在客户端 bundle 内 `require('shiki')` / `require('@xterm/xterm')` | 能拿到导出并渲染 | 自带打包进 `client.js`，只留 react 为 external |
| S3 | 打开右侧栏终端并与其 controller 交互，确认可复用 | 能列出 shell 并附着 | 终端 tab 降级为「跳转右侧栏终端」 |
| S3′ | 客户端能否直接驱动终端（2026-11-03 探测） | **可以**：`ctx.remote.terminal` 暴露 `create/list/attach/close/rename/retain/shells`，`@deepseek-ai/dsh-api-terminal-controller` 可 require（`ClientTerminals`）；`terminal` 不是独立客户端服务，必须走 `remote.terminal` | 自绘 xterm 承载（S2 已确认 `@xterm/*` 需打包） |
| S4 | 本地目录安装进 desktop profile 并热更新 | 改代码后刷新生效 | 退化为重启客户端验证 |
| S5 | `require('@deepseek-ai/dsh-client-ui-primitives')` 取 `DiffBlock` / `FileTypeIcon` | 拿到组件 | 自绘 diff 与文件图标（上游已用 try/catch 姿态，可直接照抄降级） |
| S6 | fork 的上游面板去掉 betterSidebar/native 注册后，能否原样拿到数据 | 面板在最小宿主里渲染出分支树与提交列表 | 先只接 `summary`/`branches`/`log` 三个方法，验证通路后再接其余 |
| S7 | 侧栏 reveal/自动切视图的手感 | 打开文件后 300ms 内高亮到位且不打断用户操作 | 关闭自动 reveal，只保留手动「在文件中显示」按钮 |
| S8 | Desktop 的 webview 是否可编程创建 | 能开 URL | 浏览器 tab 仅用 iframe（web 语义） |
| S9 | 同一 session 能否同时挂两份宿主会话页（主视图 + tab） | 两边都能收发消息、不重复订阅、焦点不打架 | **实测结论（2026-11-03）：不可行且不需要**。① 宿主在其他 `main` 面板激活时**根本不挂载**对话 DOM（工作台打开时 composer 不存在），portal 无源可搬；② `@deepseek-ai/dsh-client-ui-conversation` 只导出控制器/注册表（`ConversationController`、`ConversationViewRegistry`…），**没有可复用的 View 组件**，要内嵌就得重写对话 UI，违反 design §2.3c。→ 会话 tab 退化为**单实例句柄**（用户决定：同一 session 只允许一个 tab），点开回到宿主会话视图。③ 另试过 4 条内嵌路径，全部不通（2026-11-03）：`renderFactorySlot('main','conversation')` 返回的 `FactoryOutlet` 在我们的面板里渲染为空（用 `'schedules'` 做对照同样为空，说明 keyed 槽不跨面板派发）；`ctx.slots.entries('main')` 能取到 conversation 条目的 `component`，但它内部调用 slot 注入的 `useSessions/useConversation/useInput/sessionId…`，旁路渲染必崩；portal 无 DOM 可搬；应用无会话深链，iframe 只能塞下整个 app。**④ 但开源仓库里有受支持的路径**（`packages/client/ui-subagent/src/client/sidebar-chat/index.tsx` 的「侧栏子会话聊天」就是同一需求）：父面板声明一个 **session 作用域的 child slot**，就会拿到 `SessionProvider` + `renderSlot` 两个标准 prop；用 `ctx.sessions.retain(sessionId, { source })` 拿到 `SessionReference`，再 `<SessionProvider session={reference}>{renderSlot(childKey)}</SessionProvider>`；child 组件内按 ui-subagent 的写法调用 `renderFactorySlot('conversation.content', { variant: 'embedded', phase, hero }, { slots: { views } })`。**已实测成功**：会话 tab 里出现完整对话（标题、模式、composer、发送按钮）。会话 tab 因此从占位卡升级为真内嵌，用户规则（同一 session 一个 tab）不变。 |
| S10 | `ctx.layout.toggleSidebar()` 能否被插件程序化调用，折叠后布局如何 | 进入面板时左栏收起、离开恢复 | 不折叠，面板内提供「展开/收起 dsh 侧栏」按钮，接受双栏 |

> **S10 更正（2026-11-03 复核）**：动作在 `ctx.layout.panels`（`toggleSidebar` / `setSidebar` / `selectPanel`），不在 `ctx.layout` 上；只有「当前是否折叠」的状态读不到。客户端因此在挂载时量 `.workbench-root` 的 x 坐标判断，必要时 `toggleSidebar()` 一次，卸载时还原。
>
> **路由围栏的实际口径**：宿主半边拿不到 workspace 注册表（`ctx.workspaces` 只有 `model` / `name`，没有 add/list），所以 `search` 与 `notes.*` 接受客户端给的绝对路径，只靠「插件头 + 同源」两道门；design §3「list/search 必须限制在该会话工作区内」在当前宿主 API 下无法实现，已在 README 的 Known limits 里降级为已知事实。
| S11 | `ctx.slots.entries('main')` 能否拿到其他全局面板的 key 与 label | 「应用」区能列出插件/自动化任务/MCP 等 | 硬编码已知面板 key 作为兜底清单 |
