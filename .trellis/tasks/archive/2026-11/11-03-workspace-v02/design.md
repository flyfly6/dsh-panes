# Technical Design — Workspace v0.2

> 共享设计：三个子任务都改这一份文件里的路由表、包结构与安全姿态；各自只在自己的 `prd.md` 里追加细节。

## 1. 包结构增量

```
lib/
├─ index.js                 # 宿主半（+ 静态资源路由 + file.write + lsp.* 管理器）
├─ client.js                # 浏览器半（体积基本不变；Monaco 用时才拉）
└─ vendor/
   ├─ monaco/min/vs/loader.js
   ├─ monaco/min/vs/editor/editor.main.js
   ├─ monaco/min/vs/{language,base,platform}/…
   └─ monaco/min/vs/{editor,language,json,css,html,ts}/…worker.js
```

- `monaco-editor` 放 **`dependencies`**（不是 devDependencies）：安装时随 profile 落地，构建期由 `scripts/copy-monaco.mjs` 从 `node_modules/monaco-editor/min/vs` 拷到 `lib/vendor/monaco/min/vs`（`lib/` 已是 gitignore 的构建产物；`files` 已含 `lib`）。
- `tsdown` **不打包** Monaco：AMD loader 是运行时 `<script>`，与 tsdown 无关。
- 体积记账：`lib/vendor/monaco` ≈ 5 MB 磁盘 / 首次编辑态拉 1–1.5 MB gzip（只拉 `loader.js` + `editor.main.js` + 当前语言 + 相关 worker）。

## 2. 路由表（宿主半）

| 路由 | 方法 | 用途 | 归属 |
|---|---|---|---|
| `/dsh-workbench/api` | POST | 现有 `{op,args}`：`search` / `notes.*` / `path.reveal` / **`file.write`** / **`lsp.*`** | T1 / T2 |
| `/dsh-workbench/vendor/monaco/*` | GET | Monaco AMD 产物（js/css/ttf/json/worker） | T1 |
| `/dsh-workbench/lsp/stream`（待 S3 定） | GET | 若为 SSE/WebSocket：LSP 消息流；否则不注册 | T2 |

静态路由的实现要点（与现有 JSON 路由共用围栏：loopback 或 `Sec-Fetch-Site: same-origin`；**GET 不带 `x-dsh-plugin`**，浏览器 `<script src>` 发不出自定义头，因此围栏按「同源 + 只读静态」放宽，但仍拒绝 `..`、拒绝非白名单扩展名）：

```ts
ctx.webServer.register({
  kind: 'prefix',
  path: '/dsh-workbench/vendor/monaco',
  handler: (req, res) => serveVendor(req, res, { root: monacoRoot }),
})
```

`serveVendor` 负责：解码 + 规范化路径 → 解析后必须仍在 `monacoRoot` 内（realpath）→ 扩展名白名单（`.js .css .ttf .woff2 .json .map`）→ `content-type` 映射 → `ETag`（mtime+size）与 `cache-control: public, max-age=3600`（`?v=` 变了就换 URL）→ 404/405 干净收尾 → 流式 `readFile`（单文件 ≤ 8 MB）。

## 3. 数据契约

### 3.1 `file.write`

```jsonc
// request
{ "op": "file.write",
  "args": { "root": "/abs/workspace", "path": "/abs/workspace/src/a.ts",
            "text": "…", "etag": "1712345678901:1234", "create": false } }
// 200
{ "ok": true, "data": { "etag": "…", "size": 1234, "mtimeMs": 1712345679999 } }
// 409 conflict（磁盘上的 etag 与请求不一致）
{ "ok": false, "code": "file/conflict", "message": "the file changed on disk" }
```

- 路径围栏：`path` 与 `root` 都必须绝对；`realpath(root)` 后 `realpath(dirname(path))` 必须仍在 root 内（避免 symlink 逃逸）；目标若是符号链接 → 拒绝。
- 写入：临时文件 `<name>.<pid>.<rand>.tmp` → `fsync`（可选）→ `rename`；保留原文件 mode；`create: true` 时才允许新文件，且父目录必须已存在。
- 冲突：`etag = round(mtimeMs) + ":" + size`（与 notes 一致），不一致即 409；`etag` 省略表示「强制覆盖」（UI 只在用户点「覆盖」时省略）。
- 上限 8 MiB（超过 → `file/too-large`，编辑器也据此保持只读）。

### 3.2 `lsp.*`（T2 细化）

```jsonc
{ "op": "lsp.start", "args": { "root": "/abs/workspace", "language": "typescript", "file": "/abs/…/a.ts" } }
// → { serverId, capabilities }
{ "op": "lsp.send", "args": { "serverId": "...", "messages": [/* LSP JSON-RPC */] } }
{ "op": "lsp.poll", "args": { "serverId": "...", "since": 12 } }   // 长轮询兜底
{ "op": "lsp.stop", "args": { "serverId": "..." } }
```

一个 `(root, language)` 一个 server；空闲 10 分钟回收；`ctx.effect` 的 disposer 里全部 kill。

### 3.3 `layout.get` / `layout.set`（T4）

```jsonc
{ "op": "layout.get" }
// → { layout, schemaVersion: 3, savedAt: 1730…, origin: "host" }
{ "op": "layout.set", "args": { "layout": { … }, "savedAt": 1730… } }
// → { savedAt, bytes }
```

- 文件：`$DSH_HOME/workbench/layout.json`（`layout.json.bak` 留上一版，解析失败另存 `layout.json.bad-<ts>` 且不覆盖）。
- 原子写（temp + rename）；上限 256 KB，超出先裁 `closed` 栈、再裁非活动项目的非活动 tab，响应里带 `trimmed: true`。
- 迁移：客户端首次发现宿主没有布局时，把 `localStorage` 的 `schemaVersion 2` 布局 `set` 上去，成功后清 key。
- 写入者约定：单写入者、最后写入者赢；`savedAt` 只用于识别「磁盘比内存新」的那一次提示。

## 4. 客户端结构增量

```
src/
├─ editor/
│  ├─ monaco.ts        # AMD loader 注入、require.config、MonacoEnvironment、主题（读 CSS 变量）
│  ├─ MonacoView.tsx   # 打开/保存/冲突/只读降级；接管 FileView 的 file tab 渲染
│  └─ language.ts      # 扩展名 → monaco languageId（复用 highlight.ts 的表）
├─ lsp/
│  ├─ client.ts        # 最小 JSON-RPC 客户端（initialize/didOpen/hover/definition/publishDiagnostics）
│  └─ transport.ts     # SSE / WebSocket / 长轮询 三选一（按 S3 结论）
└─ session/
   ├─ SideChat.tsx     # 侧聊面板（复用 workbench.conversation slot 的渲染路径）
   └─ sideStore.ts     # 每个主会话 → 侧聊列表（localStorage）
```

**Monaco 加载约束**：不得出现 `import 'monaco-editor'`。用 `document.createElement('script')` 注入 `loader.js`，`window.require.config({ paths: { vs: <vendor>/min/vs } })`，`window.require(['vs/editor/editor.main'], cb)`；`MonacoEnvironment.getWorkerUrl = (moduleId, label) => <vendor>/min/vs/<label>/<label>.worker.js`。CSP 若禁 `unsafe-eval`（AMD 解析依赖），退路见 PRD S1/S2。

## 5. 安全姿态

- 写文件与 LSP 都只接受**调用方声明的工作区根**，并在宿主侧 realpath 校验（与 v1 `search` 的现状不同 —— 那里接受任意绝对目录，v0.2 起新能力一律收紧；`search` 顺带在同一 PR 里加围栏）。
- LSP 命令来自用户设置，等价于「用户自己开的终端」：argv 数组、无 shell、`cwd` 限定工作区、启动前在 UI 标注「这一步会执行你填的命令」。
- 所有新路由复用同一套错误包装（`{ok:false,code,message}`），不抛未捕获异常。

## 6. 构建与验证

```bash
pnpm build            # 新增 copy-monaco（构建后钩子）
pnpm typecheck
pnpm test             # 新增 file.write / vendor 路由 / LSP 管理器的 node --test
node scripts/measure-boot.mjs   # 记录首屏 gzip 字节（Network 面板等价物）
```

手工验收：DevTools → Network 按 gzip 计，打开工作台（不编辑）与进入编辑态各录一次。

## 7. Git tab 自有化（T6）

> 决策：冻结 `dsh-ide-git` v0.21.1 的 fork 为唯一基线，不再同步上游；视觉对齐工作台，必要时用本插件技术栈重构。详见 `11-03-git-tab-native/prd.md`。

### 7.1 现状与目标

| 维度 | 现在（fork 原样） | 目标 |
|---|---|---|
| 颜色 | 上游主色 + `--dsw-alias-*` 混用，部分硬编码 | 工作台 token 表；语义色集中 `src/git/theme.ts` |
| 密度 | 上游的 30–34px 行、13.5px 正文 | 22–26px 行、11–13px，和 Explorer/搜索/笔记同一把尺子 |
| 明暗 | 部分依赖上游变量，切换后有色差 | 两套同构，无需刷新；shiki 随主题 |
| 代码 | 16.5k 行预编译 JS，`dig-` 前缀 CSS 内联注入 | 逐块抽成 TSX（props 进、事件出），旧实现删除 |
| 所有权 | 上游补丁点 + 同步手册 | 我们的代码；`UPSTREAM.md` 只记来源与变更 |

### 7.2 三层结构（自下而上，谁都不许跨层）

1. **数据层（不动）**：`src/git/host.js` 的路由与方法表、`src/git/status.ts` 的摘要缓存。契约是 `POST /dsh-ide-git/api/<method>` + `{ cwd, sessionId }`。
2. **面板外壳（少量改动）**：容器自测（`ResizeObserver` → columns / stack / compact）、动作条容量、tab 生命周期。保留上游实现，只换样式入口。
3. **渲染块（逐步替换）**：提交框 → 变更四分组 → 动作条 → diff → 分支树 → 提交列表/图谱。每替换一块，上游同名的旧实现即删除。

### 7.3 样式落地方式

```css
/* 第一阶段：作用域覆盖。面板根节点已在我们子树内，加一层命名空间即可压过上游内联样式。 */
#workbench-git-tab .dig-panel { background: var(--background); color: var(--foreground); }
#workbench-git-tab .dig-row { min-height: 24px; font-size: 12px; }
/* 语义色只在 theme.ts 里定义，CSS 通过属性选择器取两套值 */
#workbench-git-tab [data-git-tone='added'] { color: var(--git-added); }
body[data-ds-dark-theme] #workbench-git-tab { --git-added: #3FB950; --git-removed: #F0616D; }
```

```ts
// src/git/theme.ts —— 面板里唯一的十六进制颜色来源
export const GIT_TONES = {
  light: { added: '#1A7F37', removed: '#CF222E', tag: '#9A6700', remote: '#8250DF', head: '#1A7F37' },
  dark: { added: '#3FB950', removed: '#F0616D', tag: '#D6A84A', remote: '#A97BF5', head: '#3FB950' },
  lanes: ['#3B6FF5', '#8250DF', '#1A7F37', '#9A6700', '#CF222E', '#0550AE'],
} as const
```

### 7.4 抽取顺序与判定

| 顺序 | 块 | 为什么先它 | 完成判据 |
|---|---|---|---|
| 1 | 提交框 | 结构简单、交互密集（`⌘↵` / `--amend` / 远控开关三处联动），样式差距最刺眼 | TSX 组件 + locale；上游旧块删除；T2 的三条闸门仍生效 |
| 2 | 变更四分组 | 与 Explorer 列表天然同构，能直接用我们的行组件 | 分组/行内 stage/unstage/discard 行为一致；hover/选中态与 Explorer 一致 |
| 3 | 动作条 | 纯图标 + 收纳逻辑，样式独立 | 收纳阈值、排序、显隐与配置卡一致 |
| 4 | diff | 可复用 shiki，但要保住 400 KB 截断与折叠 | 行号/上下文/hunk 高亮/复制/换行齐全 |
| 5 | 分支树 / 提交列表 | 依赖上游 store 与图谱算法，风险最高 | 只在 1–4 完成后评估 |

判定口径：一块「样式层能对齐」就**不抽**；抽出必须减少总行数或明显降低后续改动成本，否则记为 debt 而不是任务。

### 7.5 验证

- `pnpm check`（每次抽取后全绿）；
- T2 的功能清单逐条回归（分支树 / 图谱 / 变更 / 提交 / 动作条 / 远控闸门 / 空仓库 / 非仓库 / 窄容器）；
- 截图对比：`u53yI9.png`（P3）与深色版，1440×900，布局误差 ≤ 4px；
- 体积：`lib/client.js` gzip 增幅 ≤ 30 KB。
