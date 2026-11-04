# v0.3 迭代：问题与遗留记录

> 用户指示：遇到问题先记录、不阻塞推进，最后统一处理。追加式记录，最新的写在最上面。

## 2026-11-05

### 1. 笔记「左侧操作按钮尺寸太大」指向不明（待确认）

原话在笔记里，但代码里有两处"左侧按钮"候选：编辑器块左侧的 BlockNote 菜单（`+` / 拖拽把手），和笔记列表工具栏。本轮**没有动**，因为压错目标的代价是又一次视觉回归。需要一句话确认：是块侧菜单还是列表工具栏？

### 2. 笔记重命名 / 移动后，已打开的旧 tab 变孤儿（已知，未修）

`notes.rename` / `notes.move` 会改文件路径，而 tab 用 `contentId = rel 路径`。列表会打开新路径，但旧 tab 仍指向不存在的文件。根治需要"关闭或迁移某个 tab"的接口（v0.2 T5 `titleOverride` / tab 操作那一批里有），本轮不擅自加。

### 3. 旧笔记迁移方式偏离父 PRD（已实现的折中）

父 PRD 写的是"按 frontmatter 项目字段归入，缺失进 `_inbox`"；实际实现是**所有扁平旧笔记统一进 `_inbox`**——因为现有笔记里没有项目字段，按字段归入等于全进 inbox。差别只在"未来是否补一个 project 字段"，迁移行为一致：不删文件。

### 4. v0.2 的 7 个任务仍停在 planning（未动）

`.trellis/tasks/11-03-*`（Monaco、LSP、侧聊、启动恢复、tab 操作、git 自有化）都还是 planning，本轮 v0.3 未触碰。若"完成所有已规划任务"包含它们，需要单独排期：Monaco/LSP/侧聊都是多天量级，且与 v0.3 的 C 组（新建会话、滚动恢复、tab 拆分）有交叠。

### 5. 断头路结论已过时（对 D 组是利好）

v0.2 PRD 记的"客户端没有注册工作区的 API"不再成立：实测客户端有 `ctx.workspaces.create({ path })`、`ctx.uiWorkspace.pickDirectory()`、`ctx.uiWorkspace.startSession(workspaceId)`。"添加项目""新建项目""新建会话"都能真修好，不需要宿主新开接口。

### 6. 主题切换作用于宿主偏好（设计取舍，非缺陷）

状态栏点击走 `ctx.theme.setTheme('light' | 'dark')`，改的是**宿主全局偏好**（`system` 时按当前解析结果切到相反一侧）。如果用户期望"只切工作台"，需要另一套实现（`ctx.theme.overrideTokens` 只能换 token，不能换 light/dark 语义）。当前按"和默认界面一致"处理。

### 7. `trellis_task_update` 在本项目不可用（工具限制）

调用返回 `项目不在 allowlist 内；请先在 Web 设置或配置里把项目根加入 trellis-workflow.allowlist`，所以 `task.json.steps` 无法用工具写入，步骤清单只能落在各任务 `prd.md`。`task.py` CLI 也没有 steps 子命令。

### 8. 提交授权（已确认）

用户 2026-11-05 明确："A 组任务以及后续任务都可以提交，不需要再由我确认"。本轮起按工作单元直接提交，归档仍走 Trellis 惯例。
