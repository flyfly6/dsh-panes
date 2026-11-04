# T2 — Monaco LSP（可选增强）

> 父任务 `11-03-workspace-v02`（`design.md` §3.2/§5 为准）。**默认关闭**：不装 server、不拉额外字节的用户不应感受到任何变化。

## Goal

打开 `lsp.enabled` 后，file tab 的 Monaco 接上真实 language server，得到跨文件语义能力（hover / 定义跳转 / 诊断 / 补全）；关闭时退回 Monaco 内建 worker（TS/JSON/CSS/HTML 的本地语义），编辑器始终可用。

## Requirements

- **R1 设置项**（插件设置卡「编辑器」分组，全部 volatile）：
  - `lsp.enabled`（默认 false）
  - `lsp.servers`（多行文本或 JSON：`{ "typescript": ["typescript-language-server", "--stdio"], "go": ["gopls"] }`；argv 数组，**永不拼 shell**）
  - `lsp.idleTimeoutMs`（默认 600000）
  - `lsp.maxServers`（默认 2，按 `(root, language)` 计）
- **R2 宿主 LSP 管理器**（`src/lsp/host.ts`）：
  - 启动：`spawn(argv[0], argv.slice(1), { cwd: root, env: 受限 })`，`initialize` 握手（30s 超时），失败即 `lsp/unavailable` 并清理。
  - JSON-RPC 分帧（`Content-Length`）收发；`textDocument/didOpen` / `didChange`（增量或全量二选一，先全量）由客户端驱动。
  - 单 server 一个队列；stdout 按帧切分，stderr 收纳到最后 200 行用于错误提示。
  - 生命周期：idle 超时 kill、`lsp.stop`、插件 disposer 全部 kill、宿主退出不残留。
  - 围栏：`root` / `file` 必须绝对且在 realpath(root) 内；`language` 必须在 `lsp.servers` 里。
- **R3 传输**：先用 S3 结论定通道（WebSocket > SSE > 150ms 长轮询）。长轮询兜底时 `lsp.poll` 必须无丢失（`since` 游标）且单次 ≤200 KB。
- **R4 Monaco 侧**：`src/lsp/client.ts` 是最小 LSP 客户端（`initialize` / `textDocument/*` / `hover` / `definition` / `completion` / `publishDiagnostics` → `monaco.editor.setModelMarkers`）。**不引入** `monaco-languageclient`，除非 S4 证明它能在 AMD 环境里以可接受体积工作。
- **R5 降级与提示**：二进制不存在 / 握手失败 / 开关关闭 → 状态栏显示「LSP 不可用」，编辑器与 Monaco 内建语义照常；不弹 modal、不阻塞打开文件。
- **R6 信任提示**：首次开启 `lsp.enabled` 时在设置卡里写明「会执行你在 `lsp.servers` 里填的命令」，与终端同级别的信任说明。
- **R7 文档**：README 「Known limits」补一条：不自动安装 language server；本任务不验证具体 server 的兼容矩阵（typescript-language-server / gopls 各测一例即可）。

## Acceptance Criteria

- [ ] 默认（`lsp.enabled=false`）：打开工作台与文件，`ps` 里没有任何 LSP 子进程；Monaco 内建 TS 补全可用。
- [ ] 开启并配置 `typescript-language-server`：`.ts` 文件里 hover 有类型、`F12` 能跳定义、故意写错类型出现诊断标记；关闭 tab 后进程退出。
- [ ] 配置一个不存在的二进制：状态栏提示 LSP 不可用，文件仍可编辑保存。
- [ ] 空闲超过 `idleTimeoutMs` 后进程被回收，再次编辑可自动重启。
- [ ] 插件禁用 → 全部 server 退出（`ps` 验证）；`pnpm check` 通过；新增 `test/lsp.test.mjs`（握手、idle 回收、围栏、二进制缺失）。

## Spikes

- **S1 通道**：宿主 webServer 能否 handle WebSocket upgrade / SSE（写一个最小 echo 路由验证）。
- **S2 进程模型**：`spawn` 的 server 在 Desktop(electron) 宿主下是否随插件禁用被 kill；`detached: false` + `SIGTERM` 是否够。
- **S3 体积**：最小 LSP 客户端 + Monaco 语言特性组合的首屏增量（应接近 0，全部在编辑态之后）。
- **S4 备选**：`monaco-languageclient` 在 AMD/vendor 方式下的可行性与体积（不达标就维持自研最小客户端）。

## Out of Scope

- 自动下载/安装 server、版本管理、容器内 LSP。
- code action / rename / formatting / inlay hints（v0.2 只做 hover/definition/diagnostics/completion）。
- 多根工作区（一次一个 workspace root）。

## Risks

- 长轮询模式在 150ms 下对 `didChange` 高频输入有延迟 → 输入时只发全量 `didChange`，hover/definition 才走实时请求；必要时把轮询降到 80ms 并只在有未读消息时忙轮询。
- 用户填的命令跑飞（死循环/吃内存）→ 只做 `maxServers` 与 idle 回收，不做 CPU 限额（在 README 写明）。

## 2026-11-05 搁置说明

T1 落地时改用"文本框 + `file.write`"而不是 Monaco（理由见 `../11-03-monaco-editor/prd.md`）。
本任务的宿主前提（Monaco 的 worker、model、`editor.*` 设置）不存在，因此一并搁置，不单独开工。
真要做补全/跳转时，把 T1+T2 合成一个任务重新设计：要么完整接 Monaco（含 vendor 路由与 worker），
要么接宿主自己的语言服务（若宿主未来暴露），不要在文本框上自己写 LSP 客户端。
