# T5 — tab 条：重命名 + 完整右键菜单

> 父任务 `11-03-workspace-v02`。纯客户端、无宿主契约变化、无 spike —— 最小的一个子任务，可以和 T4/T1 一起发版。

## Goal

tab 条从「能开能关能拖」补成一个能日常用的条：**右键出菜单**（重命名 / 关闭 / 关闭其他 / 关闭左侧 / 关闭右侧 / 关闭全部 / 复制路径 / 重新打开），**标题可改**且改过的标题在重开与重启后都保留，拖拽有落点反馈。

## Background — v1 的现状

- `src/tabs.ts` 已有 `renameTab()`，但**没有任何 UI 入口**（死代码）。
- 关闭相关只有 `⋯` 菜单里的「关闭其他 / 全部关闭」，没有「关闭当前 / 关闭左侧 / 关闭右侧」；tab 上没有右键菜单。
- 拖拽重排**已经能用**（`draggable` + `dragstart/drop` → `moveTab`），但拖动时没有落点指示线，拖出可视区不会自动横向滚动。
- **一个真实缺陷**：`openTab()` 命中已存在 tab 时会 `title: input.title` 覆盖标题 —— 也就是说就算今天能重命名，重新打开同一个文件就把名字改回去了。重命名必须落在独立的 `titleOverride` 字段上。

## Requirements

- **R1 右键菜单**（`role="menu"`，Radix `ContextMenu` 或现有 `DropdownMenu` 手动定位）：
  | 项 | 行为 |
  |---|---|
  | 重命名 | 进入行内编辑（同 R2） |
  | 关闭 | 走统一关闭路径（R4） |
  | 关闭其他 | 保留该 tab |
  | 关闭左侧 / 关闭右侧 | 按当前条带顺序，不含自身 |
  | 全部关闭 | 全部（含自身） |
  | 复制路径 | 仅 `file` / `note` / `explorer`（复制绝对/相对路径，toast 确认） |
  | 在系统中显示 | 仅 `file`（复用宿主 `path.reveal`） |
  | 重新打开已关闭 | 等价 `⋯` 菜单的同名项 |
  危险项（关闭其他/左右/全部）在 hover 时不改变颜色语义，数量 >1 时文案带数量（「关闭左侧 3 个」）。
- **R2 重命名**：双击标题或按 `F2` 进入行内 `input`（预填当前显示标题、全选）；`Enter` 提交、`Esc` 取消、失焦提交；空串或纯空白 → 视为「恢复默认标题」；提交后写 `titleOverride`，并**立即持久化**。
  - `openTab()` 命中已存在 tab 时不再覆盖标题，`TabModel` 新增 `titleOverride?: string`；显示标题 = `titleOverride ?? computedTitle`。
  - 菜单里提供「恢复默认标题」（仅当有 override 时显示）。
  - 重命名不改变 tab 身份（`id` 不变），不影响去重。
- **R3 关闭语义**（全部走 `closeOne(id)` 同一条路径，确保终端的 `close()` 与笔记的 dirty 确认不会被绕过）：
  - 批量关闭先**汇总一次确认**：「将关闭 3 个 tab，其中 1 个笔记未保存」，列出标题；确认后逐个关闭。
  - 关闭后活动 tab：若自身还在则不动；否则取右侧最近的、没有则左侧最近的。
  - 批量关闭也必须逐个释放：终端模型 `close()`、笔记 dirty 清理、侧聊 retain（T3 落地后）。
- **R4 拖拽重排**：
  - 拖动中在被拖 tab 上给半透明（`opacity: .6`），在落点画 2px accent 竖线（左/右半边判定插入位）。
  - 靠近条带两端 24px 内自动横向滚动。
  - 拖出条带外释放 = 取消（不关闭、不移动）。
  - 键盘替代：`⌥⌘←` / `⌥⌘→` 把当前 tab 前移/后移一位。
- **R5 键盘与无障碍**：tab 条 `role="tablist"`；每个 tab `role="tab"` + `aria-selected` + `tabIndex`（roving：仅活动 tab `tabIndex=0`）；`←/→` 在 tab 之间移动焦点、`Enter/Space` 激活；`Shift+F10` 或菜单键打开右键菜单；`F2` 重命名；重命名输入框有 `aria-label`。
- **R6 持久化与恢复**：`titleOverride` 与顺序随布局持久化（T4 的 `layout.set`），重启后保留；tab 的 kind/contentId 都不变，所以恢复策略不受影响。
- **R7 边界**：单 tab 时「关闭其他/左/右」置灰；未注册 kind 的 tab 也能重命名、关闭（菜单按 kind 裁剪可用项）；重命名输入过程中 `⌘W`/`F2` 不触发面板级快捷键。

## Acceptance Criteria

- [x] 右键任一 tab → 菜单出现，含重命名/关闭/关闭其他/关闭左侧/关闭右侧/全部关闭；位置在光标处且不超出窗口。
- [x] 双击标题或 `F2` 改名 → `Enter` → 标题变化；关闭再重开**同一个文件** → 仍是改后的名字；刷新与重启后仍是改后的名字。
- [x] 「恢复默认标题」→ 变回文件名/笔记标题。
- [x] 5 个 tab 中右键第 3 个 → 「关闭左侧」→ 前两个消失，后三个顺序不变，活动 tab 合理。
- [x] 其中一个笔记有未保存改动时批量关闭 → **只弹一次**确认并说明数量，取消则一个都不关。
- [x] 终端 tab 被批量关闭 → 对应进程结束（`ps` 验证），无残留。
- [x] 拖动 tab 有插入指示线、能拖到首位/末位、拖出条带释放不改变顺序；`⌥⌘←/→` 等价可用。
- [x] 键盘：焦点在 tab 条时 `←/→` 移动、`Enter` 激活、`Shift+F10` 打开菜单；读屏能读出「已选中」。
- [x] `pnpm check` 通过；`test/tabs.test.mjs` 增补：`titleOverride` 在重开时不被覆盖、`closeToLeft/closeToRight` 的边界、批量关闭的活动 tab 选择。

## Spikes

无。全部是既有模型（`tabs.ts` 纯函数）+ 既有组件（Radix menu、Button）的组合；唯一需要确认的是 `⌥⌘←` 是否与宿主快捷键冲突（实现时在页面上试一次即可，冲突就换 `⌥⇧←`）。

## Out of Scope

- 固定 tab（pinned）、tab 分组/颜色、拆分视图、跨项目拖动 tab、tab 预览缩略图。
- 多选 tab 批量操作（框选/Cmd 点选）。
- 重命名影响 `contentId`（改标题不改身份是刻意设计）。

## 实施记录（2026-11-05）

- 模型层（`src/tabs.ts`）：`TabModel.titleOverride?`、`displayTitle()`、`renameTab()`（空串=恢复默认）、`tabsLeftOf()`/`tabsRightOf()`/`shiftTab()`；`openTab` 命中已有 tab 时只更新默认 title 与 params，不动 override；序列化与解析保留 override。
- 面板层（`src/panel/WorkbenchPanel.tsx`）：右键菜单（重命名/恢复默认/关闭/关闭其他/关闭左 N/关闭右 N/全部关闭/复制路径/在系统中显示/重开）、双击或 F2 行内重命名（Enter 提交、Esc 取消、失焦提交、输入框内快捷键不冒泡）、拖拽落点竖线 + 两端 24px 自动横向滚动 + dragEnd 清理、`⌥⌘←/→` 重排、`←/→` 移动焦点（roving `tabIndex`）、`Shift+F10` 开菜单、批量关闭一次确认（含未保存笔记数量）并逐个走 `closeOne({force:true})` 以释放终端模型。
- 复制路径成功/失败用面板内 toast（1.8s）。
- 测试：`test/tabs.test.mjs` 新增「重命名在重开与刷新后保留」「关闭左/右范围与键盘重排边界、关闭后的活动 tab 选择」，45 pass。
- 未做：`在系统中显示` 只对 `file` tab 出现（note 走笔记列表的菜单）；跨栏（split 副栏）里的 tab 暂未提供右键菜单，沿用 C 组的「移到另一栏」。
