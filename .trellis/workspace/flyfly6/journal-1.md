# Journal - flyfly6 (Part 1)

> AI development session journal
> Started: 2026-10-28

---



## Session 1: T1–T3 工作台插件落地：面板与 tab、Git 客户端、全局笔记
<!-- trellis-session: v=2 fp=e354f8750473bf6b -->

**Date**: 2026-11-04
**Task**: T1–T3 工作台插件落地：面板与 tab、Git 客户端、全局笔记
**Branch**: `main`

### Summary

交付可安装的 dsh-workbench 插件：项目侧栏 + 按项目隔离的 tab 工作区，文件/树/搜索/Markdown/终端/浏览器/会话 tab，fork dsh-ide-git 的 Git 工具窗口，BlockNote 笔记库；四个任务全部完成并归档。

### Main Changes

- 父任务：仓库改为包根、cordis bundle patch、宿主 /dsh-workbench/api 路由与信任围栏
- T1：tab 模型与持久化、Explorer/Search tab、shiki 高亮、GFM 预览、终端与内嵌会话、浏览器 tab
- T2：vendor dsh-ide-git v0.21.1 宿主+客户端，接成 git tab，push/pull 默认隐藏且宿主 403
- T3：笔记库（可配置目录、原子写 + etag 冲突、.trash）、BlockNote 单栏编辑器与笔记列表

### Git Commits

| Hash | Message |
|------|---------|
| `c2b36a1` | feat(plan): Workbench Workspace 插件规划与设计稿 |
| `c15efe9` | feat(plugin): scaffold dsh-workbench host+client halves |
| `c50501a` | feat(workbench): project sidebar + per-project tab workspace shell |
| `52c8d29` | refactor: make the repository root the package root |
| `6d3637b` | feat(build): shadcn/ui + Tailwind toolchain, panel rewritten in TSX |
| `f8a8207` | feat(code view): shiki syntax highlighting, theme-aware |
| `9a5e401` | feat(search): host search op, search tab and Ctrl+P quick open |
| `8e89d90` | feat(search): prefer the host's ripgrep, bundle one as fallback |
| `eb78ca0` | feat(markdown): GFM preview tab with shiki code blocks |
| `f5cda76` | docs: decide BlockNote scope — editor only, previews stay markdown-it |
| `9d8c2b4` | feat(t1): browser tab, startup entry, explorer context menu |
| `28f2a58` | feat(t1): session tab as a single-instance handle |
| `8f5756e` | docs(s9): record the four failed embedding paths for the session tab |
| `7fc9e6f` | feat(session): embed the host conversation in the session tab |
| `3f934b4` | feat(terminal): embedded terminal tab over the host terminal service |
| `a9898e4` | feat(t1): wrap/goto shortcuts, markdown scroll memory, reveal in system |
| `85474ed` | docs(spec): conversation embedding and terminal binding recipes |
| `bb4b08b` | feat(t1): search glob filter; drop the stalled file-change watch |
| `c4a6b2a` | feat(t2): mount the forked git host half |
| `755d84c` | feat(t2): the git tab, its badge and the status-bar branch |
| `ef8d0fe` | docs(t2): upstream sync notes, notices and verified contract |
| `4b5c5a6` | feat(t3): the notes vault on the host half |
| `1cc01d6` | feat(t3): the notes list and the BlockNote editor |
| `176aafb` | docs(task): close the workbench parent plan |

### Testing

- [OK] pnpm check：build + typecheck + 40 条 node --test（host/tabs/search/git/notes）全绿
- [OK] 手工验收：tab 布局刷新恢复、终端回显、Git 暂存/取消暂存、笔记重载/覆盖两条冲突分支

### Status

[OK] **Completed**

### Next Steps

- v0.2 规划已建档（11-03-workspace-v02 等），尚未开工


## Session 2: Bootstrap: fill project spec (backend + frontend)
<!-- trellis-session: v=2 fp=d2c245644e629ddd -->

**Date**: 2026-11-04
**Task**: Bootstrap: fill project spec (backend + frontend)
**Branch**: `main`

### Summary

把 .trellis/spec/ 的 11 个模板文件按 dsh-panes 真实代码填满，归档 00-bootstrap-guidelines。

### Main Changes

- backend spec：两个半边与 op 表、无数据库的持久化规则（layout schemaVersion / notes etag）、ApiError+NotesError 信封与信任围栏、console+[dsh-panes] 日志约定、pnpm check 门禁
- frontend spec：src 分区与新增 tab kind 的四处改动、CJS factory 下必须的 React 命名空间导入、Tailwind token + preflight off、模块 store + useX 绑定、strict 类型的边界归一化
- 两个 index.md 状态列改为 Filled，prd.md 三处 checklist 打勾

### Git Commits

| Hash | Message |
|------|---------|
| `3d7c246` | docs(spec): fill dsh-panes project guidelines |
| `6ab305e` | chore(task): archive 00-bootstrap-guidelines |

### Testing

- [OK] [OK] .trellis/spec 内部链接 0 断链，占位符 0 残留
- [OK] [SKIP] 未跑 pnpm check：本次仅改 Markdown，无代码改动

### Status

[OK] **Completed**

### Next Steps

- v0.2 任务（11-03-workspace-v02 及其子任务）尚未开始实施
