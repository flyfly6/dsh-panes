# T1 — file tab 可编辑：Monaco over 宿主静态资源

> 父任务 `11-03-workspace-v02`（`design.md` §1/§2/§3.1 为准）。本任务是 v0.2 的地基：宿主侧第一个「写文件」入口 + Monaco 的加载方式。

## Goal

file tab 从只读查看变成可编辑：点编辑按钮 → Monaco 从**宿主的静态路由**加载（worker 正常）→ 改 → `⌘S` 落盘；`client.js` 体积基本不变，首屏也不下载 Monaco。

## Requirements

- **R1 资源路由**：`GET /dsh-workbench/vendor/monaco/*` 服务 `lib/vendor/monaco/min/vs/**`。content-type 正确（`js/css/ttf/woff2/json/map`）、`ETag`、`cache-control: public, max-age=3600`、路径围栏（realpath 在根内、扩展名白名单，拒绝 `..`/NUL）、非 GET → 405。围栏按「同源 + 只读静态」放宽（`<script src>` 无法带 `x-dsh-plugin` 头），并在测试里钉住越界路径。
- **R2 构建**：`monaco-editor` 进 `dependencies`；新增 `scripts/copy-monaco.mjs`（`pnpm build` 末尾复制 `min/vs` → `lib/vendor/monaco/min/vs`，只拷 loader/editor.main/需要的语言与 worker，别整包 5 MB 全塞）；`package.json` 的 `files` 覆盖到这些产物。
- **R3 `file.write`**：按 `design.md` §3.1 实现（绝对路径 + 工作区 realpath 围栏、原子写、保留 mode、etag 冲突 409、8 MiB 上限、`create` 语义）。**不写任何没有显式用户动作的文件**。
- **R4 编辑器挂载**：`src/editor/monaco.ts` 负责一次性注入 AMD loader（`<script>`，URL 带 `?v=<pkg version>`）、`require.config`、`MonacoEnvironment.getWorkerUrl`、`defineTheme`（浅/深两套，颜色取 `--wb-*`/设计 token，和 shiki 的 GitHub 主题对齐）、`automaticLayout: false` + `ResizeObserver` 手动 layout。
- **R5 编辑 UX**：
  - 面包屑右侧 `编辑` / `只读` 切换（`⌘E` 可选）；进入编辑态才拉 Monaco。
  - `⌘S` / `Ctrl+S` 保存；tab 标题出现未保存圆点；关闭 tab 时三选一（保存 / 丢弃 / 取消）。
  - 状态栏追加 `已修改` / `已保存` / `冲突`，与笔记的状态文案共用一套 key。
  - 磁盘版本变化（etag 不同）→ 顶部冲突条「重新载入 / 用我的版本覆盖」，与 `NoteEditor` 的冲突条同构。
  - 撤销/重做、查找（Monaco 自带）、`Alt+Z` 换行、缩进 2/4 空格随设置。
- **R6 设置项**：`editor.enabled`（默认 true，关掉就退回只读视图）、`editor.wordWrap`、`editor.minimap`（默认 off）、`editor.tabSize`（默认 2）、复用 `fontCode*` 三项。
- **R7 只读降级**：二进制 / >8 MiB / 未连接宿主桥 / Monaco 加载失败 → 保持 v1 的 shiki 只读视图，并在状态栏说明原因（不弹 modal）。
- **R8 生命周期**：tab 关闭 → `editor.dispose()`；切 tab → 保留 model（`monaco.editor.createModel` 按 `path+etag` 缓存）但隐藏；插件禁用 → 释放全部 model 与 worker。

## Acceptance Criteria

- [ ] 打开 `src/panel/WorkbenchPanel.tsx`（约 900 行）→ 点编辑 → Monaco 出现、TS 语法高亮与括号匹配正常、`Ctrl+Space` 有补全（Monaco 自带 worker）。
- [ ] 改一行 → `⌘S` → `git diff` 可见；`etag` 冲突时给出冲突条且两条路都能走通。
- [ ] 关闭未保存的 tab 会询问；选「取消」tab 仍在、内容仍在。
- [ ] 大文件（>8 MiB）/ 二进制文件仍是只读视图，无控制台报错。
- [ ] 未点编辑时，Network 面板**无** `vendor/monaco/*` 请求；点编辑后只出现 loader/editor.main/当前语言/worker 这几条。
- [ ] `pnpm check` 通过；新增 `test/filewrite.test.mjs`（围栏、原子性、409、大小上限、mode 保留）与 `test/vendor.test.mjs`（content-type、越界拒绝、405）。

## Spikes（开工前 30 分钟内跑完，结论写回本文件）

- **S1 静态路由**：`kind: 'prefix'` 的 handler 直接 `res.end(fileBuffer)` 是否被宿主中间件干扰（压缩/安全头）？worker 用到的 `.js` 会不会被注入 CSP？
- **S2 Worker**：`new Worker('/dsh-workbench/vendor/monaco/min/vs/editor/editor.worker.js')` 在同源、无 CSP 下能否起来；`type: 'module'` 是否需要。
- **S3 AMD 体积**：`loader.js + editor.main.js + ts worker` 的 gzip 实测值（决定是否按需只带所需语言）。

## Out of Scope

- LSP（T2）、多文件重构、diff 编辑、自动保存（v0.2 只做显式保存）。
- 编辑器内的 git blame / 行内 AI 补全。

## Risks

- 宿主若对静态路由加了 CSP 或强制 `content-type: application/json`，Monaco 加载会整体失败 → 退路：把 `loader.js + editor.main.js` 以字符串内联进一个 vendor JS，由客户端 `new Function` 执行（牺牲体积换可行性，需在 PRD 更新）。
- 大文件把 Monaco 内存打爆 → 只允许 ≤8 MiB 进编辑态，其余只读。
