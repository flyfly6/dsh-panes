# T3 — 会话 tab 的侧栏会话（sidenote 式）

> 父任务 `11-03-workspace-v02`。参考实现：[dsh-sidenote](https://github.com/g-yixuan/dsh-sidenote)（MIT，**仅作交互参考**；若复用代码须补 NOTICE）。

## Goal

在会话 tab 里，把「读到一个疑问就地聊透、有结论再带回主线」做成工作台的一部分：右栏开侧聊（继承当前会话历史、独立多轮、可多开），划选引用、结论回流主输入框。

## Requirements

- **R1 布局**：会话 tab 内右侧 dock，宽 320–480（可拖、默认 380），可折叠；窄容器（<900px）改为覆盖式抽屉；`Alt+S` 在主/侧输入之间切换焦点；折叠态有一条 6px 的「有未读回答」指示条。
- **R2 侧聊生命周期**：
  - 由当前主会话**fork**：继承历史（默认折叠成「继承的上下文」分区，可展开），侧聊内可继续多轮、切模型/权限、看到工具卡与审批（全部沿用宿主 UI）。
  - 一个主会话可开多个侧聊（标签条 + 关闭/重开最近 5 个），每个侧聊是独立 session。
  - 持久化：`localStorage` 记「主会话 → 侧聊 sessionId 列表 + 标题」，刷新/重启后恢复；已存在但宿主侧不可用时显示「无法恢复」而不是静默丢弃。
  - 关闭侧聊 = 释放 retain（不删除 session），并提供「保存为正式会话」入口（若宿主 API 支持）。
- **R3 引用与回流**：
  - 在主对话里划选 → 悬浮动作「问一下」→ 引用气泡进入侧聊 composer（多条可累积、可预览/移除）。
  - 侧聊内划选 → 「带回主对话」→ 以「问题+回答」成对进入主 composer 上方的待发送区；发送失败保留。
  - 引用气泡的视觉与设计稿同一套（`--muted` 底、左侧 2px accent）。
- **R4 渲染复用**：**不重写聊天**。侧聊面板走与 v1 会话 tab 同一条路：session 作用域 child slot + `ctx.sessions.retain(sessionId)` + `SessionProvider` + `renderFactorySlot('conversation.content', { variant: 'embedded', phase, hero }, { slots: { views } })`。同一 panel 内两个 conversation 实例必须互不串流（spike S2）。
- **R5 宿主能力探测（决定形态）**：
  - `ctx.sessions` 是否有 fork/child 创建 API（`create({ parentSessionId, inherit })` 之类）；
  - 主 composer 是否可被外部注入一条带引用的待发送消息（`conversation.input` 的 slot / controller）。
  - 两者缺失时的**降级**：侧聊 = 新建空会话 + 首条消息预填「以下是主线摘要：…」；回流 = 复制到剪贴板 + 提示。降级要在 UI 明说，不假装是 fork。
- **R6 生命周期**：tab 关闭 / 插件禁用 → 释放 retain、清订阅、停掉侧聊的流式连接；侧聊 session 本身保留在宿主里（用户可回主界面找）。
- **R7 文案与无障碍**：`Alt+S`、`Esc`（折叠侧聊）、标签可用键盘切换；全部文案进 locale。

## Acceptance Criteria

- [ ] 会话 tab 里点「侧聊」→ 右侧出现侧聊，主对话仍可继续发消息，两边的流式输出不串。
- [ ] 侧聊里能看到继承的历史（折叠区），能读到「继承自 <主会话标题>」。
- [ ] 开第二个侧聊 → 两个标签可切换，各自保留消息与滚动位置。
- [ ] 刷新页面 → 侧聊标签还在，点开能继续对话（或明确提示无法恢复）。
- [ ] 主对话划选 → 「问一下」→ 侧聊 composer 出现引用气泡；侧聊划选 → 「带回主对话」→ 主 composer 上方出现待发送引用对。
- [ ] 关闭会话 tab → 侧聊的流式连接停止（Network 无持续请求）；插件禁用后无残留。
- [ ] 窄容器（<900px）下侧聊变抽屉且不遮挡 composer 的发送按钮。

## Spikes

- **S1 sessions API**：枚举 `ctx.sessions`（`model` / `retain` / 是否有 create/fork），并验证 fork 出的 session 能否拿到继承历史。
- **S2 双实例**：一个 panel 内同时挂主会话与侧聊两个 `SessionProvider`，验证消息流、composer 焦点、审批卡片互不干扰。
- **S3 composer 注入**：`conversation.input` 相关 slot/controller 能否写入「引用对」，以及是否会被用户正在输入的草稿覆盖。
- **S4 划选事件**：在宿主消息流里做 selection 监听是否稳定（React 重渲染时选区丢失？）。

## Out of Scope

- 注释持久化到笔记库、跨会话的侧聊归档、侧聊之间的消息转发。
- 侧聊的独立模型凭据管理（沿用宿主）。
- 移动端布局。

## Risks

- 宿主不给 fork API → 侧聊价值下降（没有继承历史），需在发布说明里讲清楚，并优先向宿主提需求。
- 划选与宿主自身的文本选择/复制交互冲突 → 只在「非输入框、选区非空」时出悬浮动作，且 `Esc` 可关。

## 2026-11-05 实施记录（v1）

宿主能力探测结果（`cordis_inspect_query` client Service 目录）：

- `ctx.sessions.fork({ sessionId, atSeq?, increaseTitle?, allowMigration? }): Promise<SessionId>` ✅
- `ctx.uiWorkspace.forkSession(sessionId, onCreated?, options?): Promise<SessionId>` ✅
- 「主 composer 注入待发送消息」❌ —— 没有 `conversation.input` / composer controller 之类的写入口，
  只有读（`binding.eventSource`）。R3 的"引用回流主输入框"失去宿主支撑。

因此 v1 只交付"能就地聊"的部分，**R3 整条不做**：

| 需求 | 状态 |
|---|---|
| R1 右栏 dock（380 固定宽）+ 收起 | ✅ `SessionTabView`；未做拖宽（320–480）与窄容器抽屉 |
| R2 由主会话 fork、可多开（本会话内 N 个）、关闭即释放 retain | ✅ `ctx.uiWorkspace.forkSession`；持久化为 `localStorage['dsh-panes:sides']`（主会话 → 侧聊 id 列表），**不在宿主侧** |
| R2 「保存为正式会话」入口 | ❌ 宿主已有别的入口（默认界面的会话列表），不做 |
| R3 划选引用 / 结论回流 | ❌ 无 composer 写入口，见上 |
| R3 折叠态未读指示条 | ❌ |
| R4 复用 `SessionProvider` + `renderSlot('workbench.conversation')` | ✅ 与主会话同一条渲染路径 |
| R5 降级：新建空会话 + 预填摘要 | 不需要（fork 存在），未实现 |

`Alt+S` 切换 dock；焦点在 input/textarea/contenteditable 时不拦截（不抢宿主输入框的 ⌥S）。

已知边界：侧聊 id 列表随 `localStorage` 走，清站点数据即丢（与 v0.2 之前的布局一个毛病；布局已迁宿主，侧聊列表还没）。
