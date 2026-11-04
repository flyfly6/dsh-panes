# T1 — file tab 可编辑：先要能改，再谈 Monaco

> 父任务 `11-03-workspace-v02`。原计划是"Monaco over 宿主静态资源 + file.write 冲突检测"，
> 2026-11-05 实际落地时按最小可用原则改写（见文末「与原计划的差异」）。

## Goal

file tab 从只读查看变成可编辑：点铅笔进入编辑态、`⌘S` 原子落盘、磁盘被外部改动时给冲突条而不是静默覆盖。
不引入 5 MB 的 Monaco vendor 目录，也不改 bundle 体积。

## What shipped

| 项 | 实现 |
|---|---|
| `file.stat` | `src/files.ts`：返回 `{ etag, size, updatedAt }`，etag = `round(mtimeMs):size`（与笔记同一套） |
| `file.write` | 绝对 `root` + 相对 `path`；realpath 围栏（`..`、绝对路径、父目录符号链接全部拒绝）；8 MiB 上限；`tmp + chmod(before.mode) + rename` 原子写；etag 不匹配 → HTTP 409 且 body 里带**磁盘当前文本** |
| 编辑态 | `src/panel/FileView.tsx`：状态栏铅笔按钮进入编辑（`state.eof` 才允许，避免只读到一页就整篇覆盖）；文本框用 `wb-code` 等宽字体；`⌘S`/`Ctrl+S` 保存、`Esc` 退出；编辑键盘事件 `stopPropagation` 防面板快捷键 |
| 冲突 | 顶部冲突条「磁盘上的这个文件已经变了」+ 重新载入 / 用我的版本覆盖（后者以空 etag 强写） |
| 状态栏 | `已保存` / `已修改`，与笔记共用一套措辞风格 |
| 入口 | 顶层 file tab 与资源管理器内栏的 FileView 都拿到 `root`，都能编辑 |

## Acceptance Criteria

- [x] 打开一个文本文件 → 铅笔 → 改内容 → `⌘S` → `git diff` 可见，状态栏从 `已修改` 变 `已保存`。
- [x] 外部改同一个文件后再 `⌘S` → 冲突条出现；「重新载入」拿到磁盘版本，「用我的版本覆盖」强写成功。
- [x] `../outside.ts`、绝对路径、父目录符号链接、>8 MiB、非字符串内容都被拒绝（`test/filewrite.test.mjs`）。
- [x] 755 脚本编辑后仍然是 755（保留 mode）。
- [x] `pnpm check` 通过；54 pass。

## Known limits

- **没有语法高亮与补全**：编辑态是纯文本框，退出编辑才回到 shiki 只读视图。
- **关闭 tab 不提示未保存内容**：草稿只活在 FileView 的 state 里，关掉即丢。
- **没有 `editor.*` 设置项**（wordWrap / minimap / tabSize / enabled）。
- **没有 model 缓存与 worker 生命周期**：不涉及。

## 与原计划的差异（为什么不做 Monaco）

- R1–R4/R6/R8（vendor 静态路由、AMD loader、自定义主题、设置项、model 生命周期）全部是为 Monaco 服务的，
  体量约等于再写一个视图组件库；而用户笔记里 20 条问题没有一条要求"带补全的编辑器"，
  真正的缺口只是"文件是只读的"。
- T2（monaco-lsp）因此一并搁置：没有 Monaco 就没有它的宿主。等真有人需要补全/跳转时，
  Monaco 与 LSP 应作为同一个任务重新评估，而不是先铺 vendor 再补功能。
