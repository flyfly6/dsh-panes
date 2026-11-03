# Implementation Plan — T3 Global Markdown Notes (Notion 式)

> 状态：**已实现**（2026-11-03）。存储走 (a)：`.md` 为唯一正本，块→Markdown 由 BlockNote 自身转换。
>
> 与初版计划的两处偏离，都是选型变化带来的**删减**：
> 1. 编辑器用 **BlockNote**（用户指定），因此不再自写 `parseMarkdown / serializeBlocks / 块模型 / contentEditable 逐块编辑`——`src/notes/` 下没有块模型代码。
> 2. 块 ↔ Markdown 的双向映射由 `editor.tryParseMarkdownToBlocks` / `blocksToMarkdownLossy` 承担；「原始块只读兜底」改为**一次性 lossy 警告**（见 §2）。

## 1. 宿主笔记服务（`src/notes.ts`）

- [x] 库目录：`config.notesVaultPath` → 否则 `$DSH_HOME/notes`（`~/.dsh/notes` 兜底）；首次调用 `mkdir -p`。
- [x] 路径围栏：必须相对、不含 NUL、不含 `..`、不以 `.trash` 开头、必须以 `.md` 结尾，解析后仍在库内；越界返回 `notes/bad-path`。
- [x] `notes.list`：递归列 `.md`（跳过 `.` 开头的目录与文件），返回 `{path,title,updatedAt,size,excerpt}`，按更新时间倒序。
- [x] `notes.read` / `notes.write`：读返回 `{body, meta, etag, mtimeMs}`；写走「临时文件 + rename」原子写，`etag` 不一致返回 `notes/conflict`（409），**不覆盖**。
- [x] `notes.create` / `notes.rename` / `notes.delete`：slug（保留 CJK）+ 冲突追加 `-2/-3`；重命名同步文件名与 frontmatter `title`；删除移到 `库/.trash/<ISO>-<name>.md`。
- [x] `notes.search`：标题 + 正文扫描，返回命中行号与片段，上限 200 条并标记 `truncated`。
- [x] `notes.config`：返回生效的 `vaultPath` / `configured` / `defaultPath`（设置页与列表状态栏用）。
- [x] frontmatter：`splitFrontmatter` / `readMeta` / `upsertFrontmatter` —— **未知字段与顺序原样保留**，只更新 `title`/`created`/`updated`。
- [x] **edit never sees frontmatter**：客户端只编辑 body，宿主负责拼回 frontmatter（编辑器不可能破坏用户的 YAML）。

## 2. 块编辑器（BlockNote，`src/notes/NoteEditor.tsx`）

- [x] `@blocknote/react` + `@blocknote/ariakit`（`BlockNoteView`），Mantine 版在 React 18 下起不来，见 §5。
- [x] 读：`tryParseMarkdownToBlocks(body)` → 块序列；写：`blocksToMarkdownLossy()` → body → `notes.write`。
- [x] **lossy 警告而非只读模式**：解析后往返比对（忽略空白差异）不一致时，顶部提示「含编辑器无法完整表达的语法，保存会规范化」；仍可编辑。表格、任务列表、代码块都能往返，实测表格笔记不触发警告，脚注/原始 HTML 触发。
- [x] 大标题输入框（32px，无边框）+ 块序列；不提供源码视图、不显示行号；块手柄/斜杠命令由 BlockNote 自带（v1.1 增强项顺带有了）。
- [x] 保存：800ms debounce + `Ctrl/Cmd+S`；状态栏显示 未保存/保存中/已保存/冲突；程序化重载期间抑制自动保存（`quiet` ref）。
- [x] 冲突：`notes/conflict` → 顶部条「重载 / 用当前内容覆盖」，重载重新读盘并替换块，覆盖则空 etag 重写。

## 3. 两个 tab

- [x] `notes`（列表，order 50）：搜索框（180ms debounce）、排序（最近更新 / 标题）、新建、行内菜单（重命名 / 删除），底部显示库路径与条数。
- [x] `note`（编辑器，order 51）：`contentId = <relPath>`，同一笔记复用同一 tab；`dirty` 时关闭前 `confirm`。
- [x] `+` 菜单加「笔记」「新建笔记」两项；新建笔记走 `notes.create` 后直接开 tab。
- [x] 编辑器用 `React.lazy` 加载（见 §5 原因），tab 内容外面套 `Guarded` 错误边界。

## 4. 设置项

- [x] `notesVaultPath`（`src/config.ts`，volatile）：空 = 默认库；任意绝对目录。切换后列表 `notes.list` 下一次调用即生效（无重启）。
- [ ] 目录选择器 / 「打开目录」按钮未接（目录输入框可用，直接填绝对路径）。

## 5. 踩到的坑（都已修，记进 spec）

1. **row config 的值是 volatile ref**（`{get()}`），不是普通值：`JSON.stringify` 出来是 `{}`。宿主侧统一用 `plainConfig()` / `configValue()` 解引用。
2. **BlockNote 会带进 node 内置模块**：`lib0`（yjs）解析到 `node:crypto` 的 node 条件 → 打包期用 wrapper 的 `require` 分派 shim（`{webcrypto: globalThis.crypto}`）。
3. **`process` 缺失**与 **`react-dom/client` 被二次打包**：后者与宿主 React 18 的 `ReactSharedInternals.S` 撞车，渲染即崩。外部化 `react-dom/*` 全部子路径。
4. **`@blocknote/mantine` 在这套组合下起不来**（`Cannot read properties of undefined (reading 'S')`），换成 `@blocknote/ariakit`；同时把编辑器改成 `React.lazy`，让编辑器自身的求值失败只毁一个 tab，不毁面板启动。
5. CSS：BlockNote/Mantine 的样式是 `@import` 链，`scripts/build-styles.mjs` 里加了递归 CSS import 内联器（bundle 只能带文本）。

## 6. 验证（实测）

- [x] 首次调用自动建库（`/tmp/wb-notes-vault`），空状态 + 「新建」按钮。
- [x] 新建 → 输入 → 800ms 后自动保存 → 文件落地：frontmatter `title/created/updated` + body；`updated` 每次保存重写。
- [x] `# ` → 标题、`- ` → 列表、`[] ` → 任务项、```` ``` ```` → 代码块；勾选任务后文件变 `* [x] todo item`，重开后保持。
- [x] 外部改动 + 继续编辑 → 冲突条；「重载」后编辑器内容变为磁盘版本；「覆盖」后磁盘变为本地版本（外部标记消失）。
- [x] 含未知 frontmatter（`aliases` / `custom`）与表格的笔记：表格以真表格渲染、保存后字段与表格都在（单元格空白被规范化）。
- [x] 检索：标题与正文都能命中并打开。
- [x] 跨工作区：切到另一个项目打开「笔记」，同一批笔记仍在（库在 `$DSH_HOME` 下，与工作区无关）。
- [x] 删除：`notes.delete` → 文件进 `.trash/<ISO>-<name>.md`，列表不再显示。
- [x] 状态自检：`pnpm check`（11 条 notes 测试 + 既有 28 条）。

## 7. 未做 / 已知

- 目录选择器与「打开目录」按钮（§4）。
- 删除/重命名的 UI 走 `window.confirm` / `window.prompt`（面板内没有通用对话框组件；自动化测试里 dialog 会被自动 dismiss）。
- 体积代价：整包 **8.1 MB raw / 2.23 MB gzip**（BlockNote + yjs + Mantine 余留 约 1.5 MB gzip）。`React.lazy` 只是把「求值」推迟，单文件 bundle 的下载仍在启动时。
- 大库（>200 条）未做虚拟滚动；`notes.list` 一次性返回全部条目。
