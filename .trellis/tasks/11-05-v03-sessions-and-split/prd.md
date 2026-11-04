# v0.3-C 会话 tab：真新建、历史入口、滚动恢复、分栏

父任务：`11-05-v03-iteration`（v0.3 迭代，C 组）。

## Goal

「新建会话」真的新建（不再复用上一个会话）；能打开历史会话；切回会话 tab 停在原滚动位置；tab 支持左右 / 上下分栏与跨栏移动。

## 已确认事实（调研见父任务 `research/session-tabs.md`）

- 旧 `createTab('session')` 直接取 `project.sessionIds[0]`，所以永远打开"上一个会话"。
- 宿主客户端的 `uiWorkspace.connectWorkspace(workspaceId)` 就是"新建会话"：复用同目录下未开始的空白会话，没有就新建，**返回 sessionId**（见 app.asar 的 `connectBlank` / `createInWorkspace`）。
- 会话标题来自会话日志的 `session/title` 事件；客户端没有读标题的服务，但 `SessionReference.binding.eventSource` 里有事件窗口。
- 宿主没有暴露 transcript 的滚动容器，只能按形状定位。

## Requirements

1. 新建会话 tab：调 `uiWorkspace.connectWorkspace(activeProjectId)`，用返回的 id 开 tab；拿不到时给出可见提示，不再静默复用旧会话。
2. `+` 菜单新增「打开历史会话」，列出本项目会话（最多 12 条）。
3. 会话 tab 从 `session/title` 事件回填 tab 标题（breadcrumb 同源）。
4. 切换会话 tab 恢复滚动位置（模块级 Map，按 sessionId 记）。
5. 分栏：`tabs.ts` 增加 `pane` 与 `split`；菜单提供「拆分：左右 / 上下」「移到另一栏」「取消拆分」；第二栏有自己的 tab 条与关闭按钮，关空后自动解除拆分。

## Acceptance Criteria

- [x] 点「新建会话」得到的是一个新/空白会话，而不是项目里第一个会话。
- [x] 「打开历史会话」能打开本项目任一已有会话。
- [x] 会话页刷新出新标题后，tab 与 breadcrumb 跟着改名。
- [x] 切走再切回会话 tab，滚动位置保持在原来的行附近。
- [x] 拆分后两栏各自有 tab 条与内容；关掉第二栏最后一个 tab 后回到单栏；布局能随刷新恢复（`test/tabs.test.mjs` 覆盖）。
- [x] `pnpm typecheck` / `pnpm test` 通过（43 pass）。

## Non-goals / 已知限制（见父任务 `issues.md`）

- 历史会话列表只显示 `会话 · <id8>`：客户端拿不到标题列表，需要宿主接口（已记录）。
- 跨栏只能通过菜单移动，不能拖拽跨栏；栏内拖拽排序沿用旧实现。
- 滚动容器是按形状猜的（`findScroller` + 轮询 3s），宿主暴露滚动容器后应替换。
