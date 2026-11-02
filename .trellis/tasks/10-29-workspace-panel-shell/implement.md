# Implementation Plan — T1 Workspace Panel Shell + Code View/Search

> 技术设计与宿主契约以父任务 `10-29-tern-workspace-plugin/design.md` 为准；设计稿 `designs/tern-workspace.pen`（P1/P2/P5/P6/P7）。

## 1. 面板壳 + 启动进入

- [ ] `lib/client.js`：ModuleLoader 工厂 + locale 注册 + `ctx.slots.inject('main', …)` 注册 `main` 面板（key `tern-workspace`）。
- [ ] 骨架：`Sidebar | (TabBar / Breadcrumb / Content) / StatusBar`，处理 `--dsh-frame-top-clearance`。
- [ ] 启动进入：`config.startup === 'workspace'`（默认）时 layout ready 后 `selectPanel('tern-workspace')`，并收起 dsh 左栏（S10 结论决定是否可程序化）。
- [ ] 返回：`selectPanel(null)` + 恢复左栏；`Esc` 仅在面板聚焦且无弹层时生效。
- [ ] 验证：安装 → dsh 左栏出现入口 → 打开即进入 → 控制台无报错（S1）。

## 2. 项目模型 + 侧栏

- [ ] 读宿主 workspace 注册表 → 项目列表（名称/路径/tab 数/running）。
- [ ] 侧栏 UI：头部（返回 / PROJECTS / 加项目 / 折叠）、过滤框、项目行、`Add project`、底部「应用」区（`ctx.slots.entries('main')` 动态渲染，S11）、用户/设置。
- [ ] 拖拽调宽（200–320，3px 热区，双击复位）+ 折叠成 52px 图标条；宽度与折叠态持久化。
- [ ] 切换项目：切换整套 tab 集合（先持久化旧项目状态）。

## 3. tab 模型 + `+` 菜单

- [ ] `tabs` store：`open/close/activate/rename/move/reopenLast`，按 `${projectId}:${kind}:${contentId}` 去重。
- [ ] `ternTabs` 注册表 + `create` 契约（T2/T3 依赖）。
- [ ] `+` 菜单：Session / Open file / Explorer / Terminal / Browser / Source Control / Note / New note / New project。
- [ ] localStorage `schemaVersion: 2`（activeProjectId + projects 映射）；读回时丢弃未知 kind。
- [ ] 快捷键：`Ctrl+Tab` / `Ctrl+W` / `Ctrl+Shift+T` / `Ctrl+B`，终端聚焦时让位。

## 4. Explorer tab

- [ ] 树：懒加载 `workspaceFiles.list`、折叠状态本地保存、忽略目录可配置、文件类型图标。
- [ ] 右键菜单：打开 / 在树中定位 / 复制路径 / 在系统打开。
- [ ] 单击打开 file tab（幂等）。

## 5. Search tab

- [ ] 宿主 `search` op（`mode:'name'` 与 `mode:'content'`）：rg → 解析 `--json`；无 rg 回退 JS 扫描（并发 4、单文件 ≤2MiB、跳过二进制）。
- [ ] 取消：`requestId` + 取消即 kill 子进程；输出上限 500 条 / 8MiB。
- [ ] UI：查询条（Aa / .* / glob / 结果计数）+ 左侧分组结果（命中块高亮）+ 右侧预览（命中行高亮）；`Ctrl+Shift+F` 打开。
- [ ] `Ctrl+P` 快速打开浮层（文件名模糊，上限 50）。

## 6. 代码视图

- [ ] 分页读取 + 追加、行号 gutter、当前行高亮、缩进参考线、面包屑、`Ctrl+G`、`Alt+Z`、长行降级。
- [ ] shiki 初始化（按需语言 + 双主题随 `data-ds-dark-theme`）。
- [ ] `changes` 订阅：外部修改提示「已变化，点击重载」。

## 7. Markdown 预览

- [ ] markdown-it + GFM + sanitize；相对图片经 `/api/file`；代码块接 shiki。
- [ ] 预览/源码切换 + `Ctrl+Shift+V`，滚动位置记忆。
- [ ] 导出一套块渲染组件，供 T3 的 Notion 编辑器复用。

## 8. 会话 / 终端 / 浏览器 tab

- [ ] 会话：`SessionProvider` + 宿主 `Conversation.View`；先按 S9 结论决定「双实例」还是「portal 换宿主」。
- [ ] 终端：复用 terminal controller（list → attach → 读写）；关闭调终止；不可用降级为跳转按钮。
- [ ] 浏览器：iframe + 自管历史 + 地址栏；URL 只允许 http/https。

## 9. 验证

```powershell
pnpm build
dsh plugin --profile desktop add C:\projects\dsh-workspace\dsh-tern-workspace
# 手工跑 T1 Acceptance Criteria
```

- [ ] R1.1–R1.14 全通过。
- [ ] 关闭面板后无遗留订阅（`ctx.effect` 清理、watch 解绑、子进程结束）。
- [ ] 六屏截图与设计稿叠图比对（容差：布局 ≤2px、颜色 ≤3ΔE）。
- [ ] 回滚点：每节结束一次本地提交。
