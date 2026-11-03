# T4 — 启动时恢复上次关闭时的全部 tab

> 父任务 `11-03-workspace-v02`。**优先级最高、依赖最少**：不碰 Monaco/LSP，只需要宿主的一次读写，可以独立发版。

## Goal

关掉 DSH、第二天再打开，工作台还是昨天离开的样子：同一个项目、同一批 tab、同一个活动 tab、侧栏宽度与折叠态都在。不是「刷新页面能恢复」（v1 已经做到），而是**应用重启、端口变化、清过站点数据之后依然恢复**。

## Background — v1 的现状与差距

- 布局已经在 `localStorage`（`dsh-workbench:layout`，`schemaVersion: 2`），**页面刷新能恢复**（T1 验收项），机制是 `WorkbenchPanel` 挂载时 `parseLayout(readStored)`。
- 差距一：**存储介质不对**。localStorage 绑 origin（`127.0.0.1:<port>`），宿主换端口、换浏览器 profile、清站点数据就全丢；Desktop 每次启动的端口是变的。
- 差距二：**部分 tab 无法恢复出内容**，而且不会告诉用户为什么：
  - `search`：查询词、glob、Aa/.* 开关都在组件 state 里，恢复后是一个空搜索框。
  - `terminal`：`contentId` 只是 `term-<id>`，恢复时会拿它去 `webTerminals.view()` 新建/附着模型 —— 启动时静默拉一串 shell 是不可接受的。
  - `browser`：只存了当前 URL，后退/前进历史丢失。
  - `session`：session 可能已被删；`file`：文件可能已被删/改名，现在恢复出来是一个报错页。
- 差距三：没有**退出前的最后状态**保证。布局是每次变更写 localStorage，崩溃/强退时最后一次变更可能没落盘（无 debounce 问题，但也有窗口）。
- 差距四：没有**开关**。不想要恢复的人只能手动关 tab。

## Requirements

- **R1 恢复范围**：启动后恢复「上次关闭时的活动项目 + 该项目的全部 tab（顺序、活动 tab）+ 侧栏宽度/折叠态」。其他项目的历史 tab 集合保持持久化，但**不抢焦点**。
- **R2 宿主侧持久化**（核心变更）：布局改存宿主，位置 `$DSH_HOME/workbench/layout.json`（与 notes vault 同级，profile 无关），读写走插件自己的路由：
  - `layout.get` → `{ layout, schemaVersion, savedAt, origin }`；`layout.set { layout }` → 原子写（temp+rename），保留上一版为 `layout.json.bak`。
  - 上限 256 KB（超过 → 丢弃 `closed` 栈与最旧项目的非活动 tab，并在响应里说明）。
  - 首次启动做一次 **localStorage → 宿主** 的迁移（读 schemaVersion 2/3，写成功后清 key，失败保留）。
  - localStorage 退化为**兜底**：宿主不可达时继续用旧的，UI 不报错。
- **R3 分类型恢复策略**（写进 `tabs.ts` 的纯函数 + 测试）：

  | kind | 恢复行为 |
  |---|---|
  | `file` / `note` | 恢复 path + `params.line`；文件/笔记不存在 → 保留 tab，内容区显示「已不存在」卡片 + 「关闭 / 重新定位」 |
  | `search` | 把 `query / globs / regex / caseSensitive` 写进 `params` 一起持久化，恢复后**直接重跑这次检索**（可配置：`restore.autoRunSearch` 默认 true） |
  | `terminal` | **默认不启动进程**：恢复为卡片「终端已结束 · 重开」，点一下才建新模型；设置 `restore.terminals: 'card' \| 'resume'`（默认 card） |
  | `browser` | 恢复 URL **与历史数组**（`params.history` / `params.index`），后退/前进可用 |
  | `session` | 恢复前用宿主会话列表校验；不存在 → 卡片「会话已删除」，不自动 retain |
  | `git` / `explorer` / `notes` | 直接恢复；`explorer` 展开路径若实现（见 R6）一并恢复 |
  | `note` 的未保存文本 | **不恢复**（显式 Out of Scope：不存用户未落盘的内容） |
- **R4 写入时机**：布局变更 debounce 500ms 写宿主；`visibilitychange → hidden` 与 `beforeunload` 各补一次同步刷新（`navigator.sendBeacon` 或 `keepalive: true` 的 fetch，宿主同步落盘）。强退最多丢最后 500ms 的变更。
- **R5 启动时机**：恢复要在首帧之前完成 —— 面板挂载前先 `layout.get`（客户端 `apply` 里预取，结果缓存给面板首帧），避免「先空状态再闪回 tab」。若 `startup: 'conversation'`，**不开面板也不写布局**（用户没进工作台，恢复留给下次进入）。
- **R6 Explorer 展开态（可裁剪）**：`explorer` tab 的 `params.expanded: string[]`（上限 200 条）一起持久化，恢复后按需懒加载展开到该层级；不做就写进 Known limits。
- **R7 开关与逃生口**：设置 `restore.enabled`（默认 true）；`⋯` 菜单加「重置布局」（清宿主布局 + 本地兜底，确认后回到空工作台）；启动时按住 `Shift` 跳过恢复（一次有效）。
- **R8 多窗口**：一次只允许一个写入者（最后写入者赢）。布局文件写入带 `savedAt`，恢复时若 `savedAt` 比内存新（另一个窗口刚写过）→ 以磁盘为准并提示一次。不做实时同步。
- **R9 隐私**：布局里只有路径、URL、查询词与 sessionId；不写文件内容、不写笔记正文、不写 token。README 写明这一点。

## Acceptance Criteria

- [ ] 打开 5 个 tab（file / search / terminal / browser / notes）→ 退出 DSH（正常退出）→ 重新启动 → 5 个 tab 按原顺序回来，活动 tab 与退出时一致，侧栏宽度/折叠态一致。
- [ ] 同一次重启后：`search` tab 自动重跑上次的查询并出结果；`terminal` 是「重开」卡片且 `ps` 里没有多余 shell；`browser` 的后退按钮可用。
- [ ] `kill -9` 宿主进程 → 重启 → 最多丢最后 500ms 的布局变更，其余完整恢复。
- [ ] 手动删掉一个已打开的文件、一个已打开的会话 → 重启 → 对应 tab 是「已不存在/已删除」卡片，其余 tab 不受影响。
- [ ] 换端口启动（`--port` 另一值）→ 布局仍恢复（证明不再依赖 origin）。
- [ ] `startup: 'conversation'` 时重启：不自动开面板、布局文件不被写坏；从侧栏进入工作台仍能看到全部 tab。
- [ ] `restore.enabled = false` 或启动时按住 Shift → 空工作台，且磁盘布局**不被清空**（下次开回来还在）。
- [ ] 「重置布局」→ 确认后空工作台，`$DSH_HOME/workbench/layout.json` 被重置为 v3 空布局。
- [ ] `pnpm check` 通过；新增 `test/layout.test.mjs`（迁移、裁剪、原子写、savedAt 冲突）与 `test/tabs.test.mjs` 的类型化恢复用例。

## Spikes

- **S1 原子写 + 大小**：256 KB 布局在本机读写耗时（应 <5ms），以及 `sendBeacon` 到插件路由是否带得上 `x-dsh-plugin` 头（带不上则退化为 `fetch(keepalive)`）。
- **S2 会话列表校验**：客户端有没有「当前会话列表」可用（`useWorkspaces` 的 items 有 `sessionIds`，但侧聊/已删会话要单独看）——决定 `session` tab 的校验精度。
- **S3 预取时序**：`apply` 里 `layout.get` 的完成时刻是否早于面板首帧；不能的话用「首帧骨架 + 300ms 内替换」并记录体验。

## Out of Scope

- 未保存的编辑内容（note / Monaco 草稿）跨重启恢复。
- 多设备/跨 profile 同步（宿主文件是本机的；同步交给已有的 profile 同步机制）。
- 窗口几何（面板尺寸以外的宿主窗口位置/大小由宿主负责）。
- 崩溃恢复的完整事务语义（这里是「最后写入者赢」，不是 WAL）。

## Risks

- 布局文件成了单一故障点 → `layout.json.bak` + 解析失败回落到空布局 + 不覆盖坏文件（另存 `layout.json.bad-<ts>`）。
- 大仓用户可能有几十个 tab → 256 KB 上限下的裁剪策略必须可预期（先丢 closed 栈，再丢非活动项目的非活动 tab）。
